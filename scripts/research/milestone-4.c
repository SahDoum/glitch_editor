#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <jpeglib.h>

int coefficient_open(const unsigned char *, unsigned int);
int coefficient_read_block(int, unsigned int, unsigned int, int16_t *);
int coefficient_apply(int, int, int, int, const unsigned char *, unsigned int,
                      double, unsigned int);
int coefficient_transfer_blocks(int, unsigned int, unsigned int, unsigned int,
                                unsigned int, unsigned int, unsigned int, int,
                                int);
int coefficient_set_quantization(unsigned int, int, const unsigned char *,
                                 unsigned int);
int coefficient_encode(void);
uintptr_t coefficient_output_pointer(void);
unsigned int coefficient_output_size(void);
void coefficient_close(void);

enum { COMPONENTS = 3, BLOCKS = 4, COEFFICIENTS = 64 };
typedef int16_t Blocks[COMPONENTS][BLOCKS][COEFFICIENTS];

static void check(int condition, const char *message) {
  if (!condition) {
    fprintf(stderr, "Experiment failed: %s\n", message);
    exit(EXIT_FAILURE);
  }
}

static void read_blocks(Blocks blocks) {
  for (int c = 0; c < COMPONENTS; ++c)
    for (unsigned int b = 0; b < BLOCKS; ++b)
      check(coefficient_read_block(c, b % 2, b / 2, blocks[c][b]) == 0,
            "read coefficient block");
}

static void validate_fixture(const unsigned char *data, size_t size) {
  struct jpeg_decompress_struct jpeg;
  struct jpeg_error_mgr error;
  jpeg.err = jpeg_std_error(&error);
  jpeg_create_decompress(&jpeg);
  jpeg_mem_src(&jpeg, data, size);
  check(jpeg_read_header(&jpeg, TRUE) == JPEG_HEADER_OK, "read fixture header");
  check(jpeg.image_width == 16 && jpeg.image_height == 16 &&
            jpeg.num_components == COMPONENTS && !jpeg.progressive_mode &&
            !jpeg.arith_code && jpeg.data_precision == 8,
        "expected the 16x16 baseline 4:4:4 research fixture");
  for (int c = 0; c < COMPONENTS; ++c)
    check(jpeg.comp_info[c].h_samp_factor == 1 &&
              jpeg.comp_info[c].v_samp_factor == 1,
          "expected 4:4:4 sampling");
  jpeg_destroy_decompress(&jpeg);
}

static unsigned char *read_input(const char *path, size_t *size) {
  FILE *file = fopen(path, "rb");
  check(file != NULL, "open input");
  check(fseek(file, 0, SEEK_END) == 0, "seek input");
  long length = ftell(file);
  check(length > 0 && length <= 50 * 1024 * 1024, "input size");
  check(fseek(file, 0, SEEK_SET) == 0, "rewind input");
  unsigned char *data = malloc((size_t)length);
  check(data != NULL, "allocate input");
  check(fread(data, 1, (size_t)length, file) == (size_t)length, "read input");
  check(fclose(file) == 0, "close input");
  *size = (size_t)length;
  return data;
}

static void save_output(const char *directory, const char *name) {
  char path[4096];
  int length = snprintf(path, sizeof(path), "%s/%s.jpg", directory, name);
  check(length > 0 && (size_t)length < sizeof(path), "output path too long");
  check(coefficient_encode() == 0, "encode output");
  unsigned int size = coefficient_output_size();
  const unsigned char *bytes = (const unsigned char *)coefficient_output_pointer();
  check(bytes != NULL && size > 0, "encoded output is empty");
  FILE *file = fopen(path, "wb");
  check(file != NULL, "open output");
  check(fwrite(bytes, 1, size, file) == size, "write output");
  check(fclose(file) == 0, "close output");
}

static void verify_output(const char *directory, const char *name,
                          const Blocks expected, int verify_table) {
  char path[4096];
  int length = snprintf(path, sizeof(path), "%s/%s.jpg", directory, name);
  check(length > 0 && (size_t)length < sizeof(path), "output path too long");
  size_t size;
  unsigned char *bytes = read_input(path, &size);
  if (verify_table) {
    struct jpeg_decompress_struct jpeg;
    struct jpeg_error_mgr error;
    jpeg.err = jpeg_std_error(&error);
    jpeg_create_decompress(&jpeg);
    jpeg_mem_src(&jpeg, bytes, size);
    check(jpeg_read_header(&jpeg, TRUE) == JPEG_HEADER_OK, "read output DQT");
    check(jpeg.quant_tbl_ptrs[1] != NULL, "output DQT 1 missing");
    for (int i = 0; i < COEFFICIENTS; ++i)
      check(jpeg.quant_tbl_ptrs[1]->quantval[i] == 20, "output DQT mismatch");
    jpeg_destroy_decompress(&jpeg);
  }
  coefficient_close();
  check(coefficient_open(bytes, (unsigned int)size) == 0, "reopen output");
  Blocks actual;
  read_blocks(actual);
  check(memcmp(expected, actual, sizeof(actual)) == 0,
        "encoded coefficients differ from experiment");
  free(bytes);
}

int main(int argc, char **argv) {
  check(argc == 3, "usage: milestone-4 INPUT_444.jpg OUTPUT_DIRECTORY");
  size_t size;
  unsigned char *input = read_input(argv[1], &size);
  validate_fixture(input, size);
  const unsigned char mask[BLOCKS] = {1, 1, 1, 1};
  const unsigned char table[COEFFICIENTS] = {
      20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20,
      20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20,
      20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20,
      20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20};
  const char *names[] = {"scale-ac", "random-ac", "dc-offset",
                         "zero-chroma", "copy-block", "dqt-reinterpret"};
  const int expected_changes[] = {35, 225, 4, 71, 13, 0};
  for (unsigned int experiment = 0; experiment < 6; ++experiment) {
    check(coefficient_open(input, (unsigned int)size) == 0, "open input");
    Blocks before, after;
    read_blocks(before);
    if (experiment == 0)
      check(coefficient_apply(1, 1, 0, 3, mask, BLOCKS, 2, 1) == 0, "scale");
    if (experiment == 1)
      check(coefficient_apply(1, 2, 0, 3, mask, BLOCKS, 4, 42) == 0,
            "randomize");
    if (experiment == 2)
      check(coefficient_apply(1, 3, 1, 3, mask, BLOCKS, 20, 1) == 0,
            "DC offset");
    if (experiment == 3)
      for (int c = 1; c < 3; ++c) {
        check(coefficient_apply(c, 0, 0, 3, mask, BLOCKS, 0, 1) == 0,
              "zero chroma AC");
        check(coefficient_apply(c, 0, 1, 3, mask, BLOCKS, 0, 1) == 0,
              "zero chroma DC");
      }
    if (experiment == 4)
      check(coefficient_transfer_blocks(1, 0, 0, 1, 1, 1, 1, 0, 0) == 0,
            "copy block");
    if (experiment == 5)
      check(coefficient_set_quantization(1, 0, table, COEFFICIENTS) == 0,
            "reinterpret DQT");
    read_blocks(after);
    int changed = 0;
    for (int c = 0; c < COMPONENTS; ++c)
      for (int b = 0; b < BLOCKS; ++b)
        for (int i = 0; i < COEFFICIENTS; ++i) {
          int expected = before[c][b][i];
          if (experiment == 0 && c == 1 && i != 0) {
            expected *= 2;
            if (expected > 1023) expected = 1023;
            if (expected < -1023) expected = -1023;
          }
          if (experiment == 1 && c == 1 && i != 0) {
            check(after[c][b][i] >= -4 && after[c][b][i] <= 4,
                  "random coefficient bounds");
            expected = after[c][b][i];
          }
          if (experiment == 2 && c == 1 && i == 0) {
            expected += 20;
            if (expected > 2047) expected = 2047;
          }
          if (experiment == 3 && c > 0) expected = 0;
          if (experiment == 4 && c == 1 && b == 3)
            expected = before[1][0][i];
          check(after[c][b][i] == expected, "unexpected coefficient change");
          changed += after[c][b][i] != before[c][b][i];
        }
    check(changed == expected_changes[experiment],
          "changed coefficient count differs from the golden fixture");
    save_output(argv[2], names[experiment]);
    verify_output(argv[2], names[experiment], after, experiment == 5);
    printf("%s: %d coefficients changed; encoded coefficients verified\n",
           names[experiment], changed);
    coefficient_close();
  }
  free(input);
  return EXIT_SUCCESS;
}
