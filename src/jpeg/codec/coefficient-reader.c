#include <stddef.h>
#include <stdio.h>
#include <setjmp.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <jpeglib.h>

#define MAX_COEFFICIENT_BYTES (128ULL * 1024ULL * 1024ULL)
#define MAX_JPEG_BYTES (50ULL * 1024ULL * 1024ULL)

enum {
  CODEC_OK = 0,
  CODEC_MALFORMED = -1,
  CODEC_UNSUPPORTED = -2,
  CODEC_RESOURCE_LIMIT = -3,
  CODEC_INVALID_BLOCK = -4
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

  block_row = state.cinfo.mem->access_virt_barray(
      (j_common_ptr)&state.cinfo, state.coefficients[component], block_y, 1,
      FALSE);
  for (int index = 0; index < DCTSIZE2; index++) {
    output[index] = (int16_t)block_row[0][block_x][index];
  }
  return CODEC_OK;
}
