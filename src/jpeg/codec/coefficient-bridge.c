#include <stddef.h>
#include <stdio.h>
#include <setjmp.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#include <jpeglib.h>

#define MAX_COEFFICIENT_BYTES (128ULL * 1024ULL * 1024ULL)
#define MAX_JPEG_BYTES (50ULL * 1024ULL * 1024ULL)
#define MAX_EDITED_BLOCKS (8U * 1024U * 1024U)
#define MAX_TRANSFER_BLOCKS 262144U

enum {
  CODEC_OK = 0,
  CODEC_MALFORMED = -1,
  CODEC_UNSUPPORTED = -2,
  CODEC_RESOURCE_LIMIT = -3,
  CODEC_INVALID_BLOCK = -4,
  CODEC_OUTPUT_LIMIT = -5,
  CODEC_INVALID_OPERATION = -6,
  CODEC_INVALID_QUANTIZATION = -7
};

struct bridge_error_mgr {
  struct jpeg_error_mgr pub;
  jmp_buf jump_buffer;
};

struct bridge_state {
  struct jpeg_decompress_struct cinfo;
  struct bridge_error_mgr error;
  jvirt_barray_ptr *coefficients;
  unsigned char *input;
  unsigned char *output;
  unsigned long output_size;
  unsigned int quantization_tables[NUM_QUANT_TBLS][DCTSIZE2];
  int has_quantization_table[NUM_QUANT_TBLS];
  int created;
};

static struct bridge_state state;

static void bridge_error_exit(j_common_ptr cinfo) {
  struct bridge_error_mgr *error =
      (struct bridge_error_mgr *)cinfo->err;
  longjmp(error->jump_buffer, 1);
}

void coefficient_close(void) {
  if (state.created) {
    jpeg_destroy_decompress(&state.cinfo);
  }
  free(state.input);
  free(state.output);
  memset(&state, 0, sizeof(state));
}

int coefficient_open(const unsigned char *input, unsigned int input_size) {
  uint64_t coefficient_count = 0;
  int header_status;

  coefficient_close();
  if (input == NULL || input_size == 0 || input_size > MAX_JPEG_BYTES) {
    return CODEC_MALFORMED;
  }

  state.cinfo.err = jpeg_std_error(&state.error.pub);
  state.error.pub.error_exit = bridge_error_exit;
  if (setjmp(state.error.jump_buffer) != 0) {
    coefficient_close();
    return CODEC_MALFORMED;
  }

  state.created = 1;
  jpeg_create_decompress(&state.cinfo);
  for (int marker = JPEG_APP0; marker <= JPEG_APP0 + 15; marker++) {
    jpeg_save_markers(&state.cinfo, marker, 0xffff);
  }
  jpeg_save_markers(&state.cinfo, JPEG_COM, 0xffff);
  state.input = (unsigned char *)malloc(input_size);
  if (state.input == NULL) {
    coefficient_close();
    return CODEC_RESOURCE_LIMIT;
  }
  memcpy(state.input, input, input_size);
  jpeg_mem_src(&state.cinfo, state.input, input_size);

  header_status = jpeg_read_header(&state.cinfo, TRUE);
  if (header_status != JPEG_HEADER_OK) {
    coefficient_close();
    return CODEC_MALFORMED;
  }
  if (state.cinfo.data_precision != 8 || state.cinfo.progressive_mode ||
      state.cinfo.arith_code || jpeg_has_multiple_scans(&state.cinfo) ||
      state.cinfo.comps_in_scan != state.cinfo.num_components ||
      state.cinfo.Ss != 0 || state.cinfo.Se != DCTSIZE2 - 1 ||
      state.cinfo.Ah != 0 || state.cinfo.Al != 0 ||
      (state.cinfo.num_components != 1 && state.cinfo.num_components != 3)) {
    coefficient_close();
    return CODEC_UNSUPPORTED;
  }

  for (int component = 0; component < state.cinfo.num_components; component++) {
    const jpeg_component_info *info = &state.cinfo.comp_info[component];
    uint64_t padded_width =
        ((uint64_t)info->width_in_blocks + info->h_samp_factor - 1) /
        info->h_samp_factor * info->h_samp_factor;
    uint64_t padded_height =
        ((uint64_t)info->height_in_blocks + info->v_samp_factor - 1) /
        info->v_samp_factor * info->v_samp_factor;
    coefficient_count += padded_width * padded_height * DCTSIZE2;
    if (coefficient_count > MAX_COEFFICIENT_BYTES / sizeof(JCOEF)) {
      coefficient_close();
      return CODEC_RESOURCE_LIMIT;
    }
  }

  for (int table = 0; table < NUM_QUANT_TBLS; table++) {
    JQUANT_TBL *quantization_table = state.cinfo.quant_tbl_ptrs[table];
    if (quantization_table != NULL) {
      state.has_quantization_table[table] = 1;
      for (int index = 0; index < DCTSIZE2; index++) {
        state.quantization_tables[table][index] =
            quantization_table->quantval[index];
      }
    }
  }

  state.coefficients = jpeg_read_coefficients(&state.cinfo);
  if (state.coefficients == NULL) {
    coefficient_close();
    return CODEC_MALFORMED;
  }
  return CODEC_OK;
}

int coefficient_read_block(int component, unsigned int block_x,
                           unsigned int block_y, int16_t *output) {
  JBLOCKARRAY block_row;
  const jpeg_component_info *info;

  if (!state.created || state.coefficients == NULL || output == NULL ||
      component < 0 || component >= state.cinfo.num_components) {
    return CODEC_INVALID_BLOCK;
  }
  info = &state.cinfo.comp_info[component];
  if (block_x >= info->width_in_blocks || block_y >= info->height_in_blocks) {
    return CODEC_INVALID_BLOCK;
  }

  if (setjmp(state.error.jump_buffer) != 0) {
    return CODEC_MALFORMED;
  }
  block_row = state.cinfo.mem->access_virt_barray(
      (j_common_ptr)&state.cinfo, state.coefficients[component], block_y, 1,
      FALSE);
  for (int index = 0; index < DCTSIZE2; index++) {
    output[index] = (int16_t)block_row[0][block_x][index];
  }
  return CODEC_OK;
}

static int clamp_coefficient(int value, unsigned int index) {
  int limit = index == 0 ? 2047 : 1023;
  if (value > limit) return limit;
  if (value < -limit) return -limit;
  return value;
}

static unsigned int next_random(unsigned int *state_value) {
  unsigned int value = *state_value;
  if (value == 0) value = 0x6d2b79f5U;
  value ^= value << 13;
  value ^= value >> 17;
  value ^= value << 5;
  *state_value = value;
  return value;
}

int coefficient_apply(int component, int mode, int domain, int frequency_band,
                      const unsigned char *block_mask,
                      unsigned int block_mask_size, double strength,
                      unsigned int seed) {
  unsigned int minimum_frequency;
  unsigned int maximum_frequency;
  unsigned int random_state = seed;
  const jpeg_component_info *info;

  if (!state.created || state.coefficients == NULL || block_mask == NULL ||
      component < 0 || component >= state.cinfo.num_components || mode < 0 ||
      mode > 5 || domain < 0 || domain > 1 || frequency_band < 0 ||
      frequency_band > 3 || !isfinite(strength)) {
    return CODEC_INVALID_OPERATION;
  }

  info = &state.cinfo.comp_info[component];
  if ((uint64_t)info->width_in_blocks * info->height_in_blocks !=
      block_mask_size) {
    return CODEC_INVALID_OPERATION;
  }
  if ((domain == 0 && mode == 3) ||
      (domain == 1 && frequency_band != 3) ||
      (mode == 1 && (strength < -8.0 || strength > 8.0)) ||
      (mode == 2 &&
       (strength < 1.0 || strength > 2047.0 ||
        (double)(int)strength != strength)) ||
      (mode == 3 &&
       (domain != 1 || strength < -2047.0 || strength > 2047.0 ||
        (double)(int)strength != strength)) ||
      ((mode == 4 || mode == 5) &&
       (domain != 0 || strength != 0.0 ||
        (mode == 5 && frequency_band == 3)))) {
    return CODEC_INVALID_OPERATION;
  }

  switch (frequency_band) {
  case 0:
    minimum_frequency = 1;
    maximum_frequency = 2;
    break;
  case 1:
    minimum_frequency = 3;
    maximum_frequency = 5;
    break;
  case 2:
    minimum_frequency = 6;
    maximum_frequency = 14;
    break;
  default:
    minimum_frequency = 1;
    maximum_frequency = 14;
    break;
  }

  if (setjmp(state.error.jump_buffer) != 0) {
    return CODEC_MALFORMED;
  }
  for (unsigned int block_y = 0; block_y < info->height_in_blocks;
       block_y++) {
    JBLOCKARRAY block_row = state.cinfo.mem->access_virt_barray(
        (j_common_ptr)&state.cinfo, state.coefficients[component], block_y, 1,
        TRUE);
    for (unsigned int block_x = 0; block_x < info->width_in_blocks;
         block_x++) {
      if (block_mask[block_y * info->width_in_blocks + block_x] == 0) {
        continue;
      }
      for (unsigned int index = 0; index < DCTSIZE2; index++) {
        int is_dc = index == 0;
        if ((domain == 1 && !is_dc) || (domain == 0 && is_dc)) continue;
        if (!is_dc) {
          unsigned int frequency = index / DCTSIZE + index % DCTSIZE;
          if (mode == 5) {
            if (frequency >= minimum_frequency &&
                frequency <= maximum_frequency) {
              continue;
            }
          } else if (frequency < minimum_frequency ||
                     frequency > maximum_frequency) {
            continue;
          }
        }

        int value = block_row[0][block_x][index];
        if (mode == 0) {
          value = 0;
        } else if (mode == 1) {
          double scaled = value * strength;
          value = scaled >= 0 ? (int)(scaled + 0.5) : (int)(scaled - 0.5);
        } else if (mode == 2) {
          unsigned int range = (unsigned int)strength * 2U + 1U;
          value = (int)(next_random(&random_state) % range) -
                  (int)strength;
        } else if (mode == 3) {
          value += (int)strength;
        } else if (mode == 4) {
          value = -value;
        } else {
          value = 0;
        }
        block_row[0][block_x][index] =
            (JCOEF)clamp_coefficient(value, index);
      }
    }
  }
  return CODEC_OK;
}

int coefficient_repeat_block(int component, unsigned int source_x,
                             unsigned int source_y, int offset_x, int offset_y,
                             unsigned int repetitions) {
  JBLOCK source_block;
  const jpeg_component_info *info;

  if (!state.created || state.coefficients == NULL || component < 0 ||
      component >= state.cinfo.num_components || repetitions == 0 ||
      repetitions > 256 || (offset_x == 0 && offset_y == 0) ||
      offset_x < -256 || offset_x > 256 || offset_y < -256 ||
      offset_y > 256) {
    return CODEC_INVALID_OPERATION;
  }
  info = &state.cinfo.comp_info[component];
  if (source_x >= info->width_in_blocks || source_y >= info->height_in_blocks) {
    return CODEC_INVALID_OPERATION;
  }
  for (unsigned int repetition = 1; repetition <= repetitions; repetition++) {
    int64_t target_x = (int64_t)source_x + (int64_t)offset_x * repetition;
    int64_t target_y = (int64_t)source_y + (int64_t)offset_y * repetition;
    if (target_x < 0 || target_y < 0 ||
        target_x >= info->width_in_blocks ||
        target_y >= info->height_in_blocks) {
      return CODEC_INVALID_OPERATION;
    }
  }

  if (setjmp(state.error.jump_buffer) != 0) {
    return CODEC_MALFORMED;
  }
  JBLOCKARRAY source_row = state.cinfo.mem->access_virt_barray(
      (j_common_ptr)&state.cinfo, state.coefficients[component], source_y, 1,
      FALSE);
  memcpy(source_block, source_row[0][source_x], sizeof(JBLOCK));
  for (unsigned int repetition = 1; repetition <= repetitions; repetition++) {
    unsigned int target_x =
        (unsigned int)((int64_t)source_x + (int64_t)offset_x * repetition);
    unsigned int target_y =
        (unsigned int)((int64_t)source_y + (int64_t)offset_y * repetition);
    JBLOCKARRAY target_row = state.cinfo.mem->access_virt_barray(
        (j_common_ptr)&state.cinfo, state.coefficients[component], target_y, 1,
        TRUE);
    memcpy(target_row[0][target_x], source_block, sizeof(JBLOCK));
  }
  return CODEC_OK;
}

static unsigned int random_bounded(unsigned int *random_state,
                                   unsigned int bound) {
  unsigned int threshold = (unsigned int)(-bound) % bound;
  for (;;) {
    unsigned int value = next_random(random_state);
    if (value >= threshold) return value % bound;
  }
}

int coefficient_permute_blocks(int component,
                               const unsigned char *block_mask,
                               unsigned int block_mask_size,
                               unsigned int seed) {
  unsigned int * volatile block_indices = NULL;
  unsigned int selected_count = 0;
  unsigned int random_state = seed;
  const jpeg_component_info *info;

  if (!state.created || state.coefficients == NULL || block_mask == NULL ||
      component < 0 || component >= state.cinfo.num_components) {
    return CODEC_INVALID_OPERATION;
  }
  info = &state.cinfo.comp_info[component];
  if ((uint64_t)info->width_in_blocks * info->height_in_blocks !=
          block_mask_size ||
      block_mask_size > MAX_EDITED_BLOCKS) {
    return CODEC_INVALID_OPERATION;
  }
  for (unsigned int index = 0; index < block_mask_size; index++) {
    if (block_mask[index] != 0) selected_count++;
  }
  if (selected_count < 2) return CODEC_OK;
  if (setjmp(state.error.jump_buffer) != 0) {
    free((void *)block_indices);
    return CODEC_MALFORMED;
  }

  block_indices =
      (unsigned int *)malloc((size_t)selected_count * sizeof(unsigned int));
  if (block_indices == NULL) return CODEC_RESOURCE_LIMIT;
  unsigned int next_index = 0;
  for (unsigned int index = 0; index < block_mask_size; index++) {
    if (block_mask[index] != 0) block_indices[next_index++] = index;
  }

  for (unsigned int remaining = selected_count; remaining > 1; remaining--) {
    unsigned int first_index = remaining - 1;
    unsigned int second_index = random_bounded(&random_state, remaining);
    unsigned int first_flat = block_indices[first_index];
    unsigned int second_flat = block_indices[second_index];
    unsigned int first_x = first_flat % info->width_in_blocks;
    unsigned int first_y = first_flat / info->width_in_blocks;
    unsigned int second_x = second_flat % info->width_in_blocks;
    unsigned int second_y = second_flat / info->width_in_blocks;
    JBLOCKARRAY first_row = state.cinfo.mem->access_virt_barray(
        (j_common_ptr)&state.cinfo, state.coefficients[component], first_y, 1,
        TRUE);
    JBLOCKARRAY second_row = state.cinfo.mem->access_virt_barray(
        (j_common_ptr)&state.cinfo, state.coefficients[component], second_y, 1,
        TRUE);
    JBLOCK temporary;
    memcpy(temporary, first_row[0][first_x], sizeof(JBLOCK));
    memcpy(first_row[0][first_x], second_row[0][second_x], sizeof(JBLOCK));
    memcpy(second_row[0][second_x], temporary, sizeof(JBLOCK));
  }

  free((void *)block_indices);
  return CODEC_OK;
}

int coefficient_transfer_blocks(int component, unsigned int source_x,
                                unsigned int source_y, unsigned int width,
                                unsigned int height,
                                unsigned int destination_x,
                                unsigned int destination_y, int mode,
                                int action) {
  JBLOCK * volatile source_snapshot = NULL;
  JBLOCK * volatile destination_snapshot = NULL;
  const jpeg_component_info *info;
  size_t block_count;

  if (!state.created || state.coefficients == NULL || component < 0 ||
      component >= state.cinfo.num_components || width == 0 || height == 0 ||
      mode < 0 || mode > 2 || action < 0 || action > 1) {
    return CODEC_INVALID_OPERATION;
  }
  info = &state.cinfo.comp_info[component];
  if (source_x >= info->width_in_blocks ||
      source_y >= info->height_in_blocks ||
      destination_x >= info->width_in_blocks ||
      destination_y >= info->height_in_blocks ||
      width > info->width_in_blocks - source_x ||
      height > info->height_in_blocks - source_y ||
      width > info->width_in_blocks - destination_x ||
      height > info->height_in_blocks - destination_y ||
      (uint64_t)width * height > MAX_TRANSFER_BLOCKS) {
    return CODEC_INVALID_OPERATION;
  }
  if (action == 1) {
    int overlaps = source_x < destination_x + width &&
                   destination_x < source_x + width &&
                   source_y < destination_y + height &&
                   destination_y < source_y + height;
    if (overlaps) {
      if (source_x == destination_x && source_y == destination_y) {
        return CODEC_OK;
      }
      return CODEC_INVALID_OPERATION;
    }
  }
  block_count = (size_t)width * height;

  if (setjmp(state.error.jump_buffer) != 0) {
    free((void *)source_snapshot);
    free((void *)destination_snapshot);
    return CODEC_MALFORMED;
  }

  source_snapshot = (JBLOCK *)malloc(block_count * sizeof(JBLOCK));
  if (source_snapshot == NULL) return CODEC_RESOURCE_LIMIT;
  if (action == 1) {
    destination_snapshot = (JBLOCK *)malloc(block_count * sizeof(JBLOCK));
    if (destination_snapshot == NULL) {
      free((void *)source_snapshot);
      return CODEC_RESOURCE_LIMIT;
    }
  }

  for (unsigned int row = 0; row < height; row++) {
    JBLOCKARRAY source_row = state.cinfo.mem->access_virt_barray(
        (j_common_ptr)&state.cinfo, state.coefficients[component],
        source_y + row, 1, FALSE);
    if (action == 1) {
      JBLOCKARRAY destination_row = state.cinfo.mem->access_virt_barray(
          (j_common_ptr)&state.cinfo, state.coefficients[component],
          destination_y + row, 1, FALSE);
      memcpy(destination_snapshot[row * width], destination_row[0][destination_x],
             (size_t)width * sizeof(JBLOCK));
    }
    memcpy(source_snapshot[row * width], source_row[0][source_x],
           (size_t)width * sizeof(JBLOCK));
  }

  for (unsigned int row = 0; row < height; row++) {
    JBLOCKARRAY destination_row = state.cinfo.mem->access_virt_barray(
        (j_common_ptr)&state.cinfo, state.coefficients[component],
        destination_y + row, 1, TRUE);
    JBLOCKARRAY source_row = action == 1
        ? state.cinfo.mem->access_virt_barray(
              (j_common_ptr)&state.cinfo, state.coefficients[component],
              source_y + row, 1, TRUE)
        : NULL;
    for (unsigned int column = 0; column < width; column++) {
      JBLOCK *source_block = &source_snapshot[row * width + column];
      JBLOCK *destination_block =
          action == 1 ? &destination_snapshot[row * width + column] : NULL;
      JBLOCK *target = &destination_row[0][destination_x + column];
      JBLOCK *origin =
          action == 1 ? &source_row[0][source_x + column] : NULL;
      unsigned int first = mode == 1 ? 0 : (mode == 2 ? 1 : 0);
      unsigned int end = mode == 1 ? 1 : DCTSIZE2;
      for (unsigned int index = first; index < end; index++) {
        (*target)[index] = (*source_block)[index];
        if (action == 1) (*origin)[index] = (*destination_block)[index];
      }
    }
  }

  free((void *)source_snapshot);
  free((void *)destination_snapshot);
  return CODEC_OK;
}

int coefficient_set_quantization(unsigned int table_id, int semantics,
                                 const unsigned char *values,
                                 unsigned int values_size) {
  if (!state.created || state.coefficients == NULL ||
      table_id >= NUM_QUANT_TBLS || semantics < 0 || semantics > 1 ||
      values == NULL || values_size != DCTSIZE2 ||
      !state.has_quantization_table[table_id]) {
    return CODEC_INVALID_QUANTIZATION;
  }
  for (unsigned int index = 0; index < DCTSIZE2; index++) {
    if (values[index] == 0) return CODEC_INVALID_QUANTIZATION;
  }

  if (semantics == 1) {
    for (int component = 0; component < state.cinfo.num_components;
         component++) {
      const jpeg_component_info *info = &state.cinfo.comp_info[component];
      if (info->quant_tbl_no != (int)table_id) continue;
      if (setjmp(state.error.jump_buffer) != 0) return CODEC_MALFORMED;
      for (unsigned int block_y = 0; block_y < info->height_in_blocks;
           block_y++) {
        JBLOCKARRAY block_row = state.cinfo.mem->access_virt_barray(
            (j_common_ptr)&state.cinfo, state.coefficients[component],
            block_y, 1, TRUE);
        for (unsigned int block_x = 0; block_x < info->width_in_blocks;
             block_x++) {
          for (unsigned int index = 0; index < DCTSIZE2; index++) {
            int coefficient = block_row[0][block_x][index];
            unsigned int numerator =
                (unsigned int)abs(coefficient) *
                state.quantization_tables[table_id][index];
            unsigned int quantized =
                (numerator + values[index] / 2U) / values[index];
            int signed_value =
                coefficient < 0 ? -(int)quantized : (int)quantized;
            block_row[0][block_x][index] =
                (JCOEF)clamp_coefficient(signed_value, index);
          }
        }
      }
    }
  }
  for (unsigned int index = 0; index < DCTSIZE2; index++) {
    state.quantization_tables[table_id][index] = values[index];
  }
  return CODEC_OK;
}

int coefficient_encode(void) {
  struct jpeg_compress_struct compressor;
  struct bridge_error_mgr compressor_error;
  unsigned char *output = NULL;
  unsigned long output_size = 0;
  int compressor_created = 0;

  if (!state.created || state.coefficients == NULL) {
    return CODEC_INVALID_OPERATION;
  }
  free(state.output);
  state.output = NULL;
  state.output_size = 0;

  memset(&compressor, 0, sizeof(compressor));
  compressor.err = jpeg_std_error(&compressor_error.pub);
  compressor_error.pub.error_exit = bridge_error_exit;
  if (setjmp(compressor_error.jump_buffer) != 0) {
    if (compressor_created) {
      jpeg_destroy_compress(&compressor);
    }
    free(output);
    return CODEC_MALFORMED;
  }
  if (setjmp(state.error.jump_buffer) != 0) {
    if (compressor_created) {
      jpeg_destroy_compress(&compressor);
    }
    free(output);
    return CODEC_MALFORMED;
  }

  jpeg_create_compress(&compressor);
  compressor_created = 1;
  jpeg_mem_dest(&compressor, &output, &output_size);
  jpeg_copy_critical_parameters(&state.cinfo, &compressor);
  for (int table = 0; table < NUM_QUANT_TBLS; table++) {
    if (!state.has_quantization_table[table] ||
        compressor.quant_tbl_ptrs[table] == NULL) {
      continue;
    }
    for (int index = 0; index < DCTSIZE2; index++) {
      compressor.quant_tbl_ptrs[table]->quantval[index] =
          (UINT16)state.quantization_tables[table][index];
    }
    compressor.quant_tbl_ptrs[table]->sent_table = FALSE;
  }
  jpeg_write_coefficients(&compressor, state.coefficients);
  for (jpeg_saved_marker_ptr marker = state.cinfo.marker_list; marker != NULL;
       marker = marker->next) {
    if (marker->marker == JPEG_APP0 || marker->marker == JPEG_APP0 + 14) {
      continue;
    }
    jpeg_write_marker(&compressor, marker->marker, marker->data,
                      marker->data_length);
  }
  jpeg_finish_compress(&compressor);
  jpeg_destroy_compress(&compressor);
  if (output_size > MAX_JPEG_BYTES) {
    free(output);
    return CODEC_OUTPUT_LIMIT;
  }
  if (jpeg_finish_decompress(&state.cinfo) == FALSE) {
    free(output);
    return CODEC_MALFORMED;
  }

  state.output = output;
  state.output_size = output_size;
  return CODEC_OK;
}

uintptr_t coefficient_output_pointer(void) {
  return (uintptr_t)state.output;
}

unsigned int coefficient_output_size(void) {
  return (unsigned int)state.output_size;
}
