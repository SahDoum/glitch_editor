#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int coefficient_open(const unsigned char *, unsigned int);
int coefficient_read_block(int, unsigned int, unsigned int, int16_t *);
int coefficient_apply(int, int, int, int, const unsigned char *, unsigned int,
                      double, unsigned int);
int coefficient_encode(void);
uintptr_t coefficient_output_pointer(void);
unsigned int coefficient_output_size(void);
void coefficient_close(void);

static void check(int condition, const char *message) {
  if (!condition) {
    fprintf(stderr, "%s\n", message);
    exit(EXIT_FAILURE);
  }
}

int main(int argc, char **argv) {
  check(argc == 3, "usage: dc-steps INPUT OUTPUT");
  FILE *file = fopen(argv[1], "rb");
  check(file != NULL && fseek(file, 0, SEEK_END) == 0, "input");
  long length = ftell(file);
  check(length > 0 && length < 1000000 && fseek(file, 0, SEEK_SET) == 0,
        "input size");
  unsigned char *bytes = malloc((size_t)length);
  check(bytes != NULL && fread(bytes, 1, (size_t)length, file) == (size_t)length,
        "read input");
  check(fclose(file) == 0, "close input");
  check(coefficient_open(bytes, (unsigned int)length) == 0, "open JPEG");
  int16_t before[4][64], after[64], other[64], other_after[64];
  const int targets[4] = {5, -5, 15, -15};
  const int expected[4] = {10, -10, 20, -20};
  const unsigned char all[4] = {1, 1, 1, 1};
  const unsigned char partial[4] = {1, 1, 1, 0};
  check(coefficient_read_block(1, 0, 0, other) == 0, "read other component");
  for (int i = 0; i < 4; ++i) {
    unsigned char mask[4] = {0, 0, 0, 0};
    mask[i] = 1;
    check(coefficient_read_block(0, i % 2, i / 2, before[i]) == 0,
          "read DC block");
    check(coefficient_apply(0, 3, 1, 3, mask, 4,
                            targets[i] - before[i][0], 1) == 0,
          "prepare DC");
    check(coefficient_read_block(0, i % 2, i / 2, before[i]) == 0,
          "read prepared block");
  }
  check(coefficient_apply(0, 6, 1, 3, partial, 4, 10, 1) == 0, "DC steps");
  for (int i = 0; i < 4; ++i) {
    check(coefficient_read_block(0, i % 2, i / 2, after) == 0, "read result");
    check(after[0] == (i == 3 ? targets[i] : expected[i]), "wrong DC rounding");
    check(memcmp(before[i] + 1, after + 1, 63 * sizeof(int16_t)) == 0,
          "AC changed");
  }
  check(coefficient_read_block(1, 0, 0, other_after) == 0, "read other");
  check(memcmp(other, other_after, sizeof(other)) == 0, "other component changed");
  check(coefficient_apply(0, 6, 0, 3, all, 4, 10, 1) != 0, "accepted AC");
  check(coefficient_apply(0, 6, 1, 3, all, 4, 0, 1) != 0, "accepted zero");
  check(coefficient_apply(0, 6, 1, 3, all, 4, 512.5, 1) != 0, "accepted fraction");
  check(coefficient_apply(0, 6, 1, 3, all, 4, 513, 1) != 0, "accepted large step");
  check(coefficient_encode() == 0, "encode output");
  unsigned int size = coefficient_output_size();
  const unsigned char *output = (const unsigned char *)coefficient_output_pointer();
  check(output != NULL && size > 0, "empty output");
  unsigned char *copy = malloc(size);
  check(copy != NULL, "allocate output");
  memcpy(copy, output, size);
  file = fopen(argv[2], "wb");
  check(file != NULL && fwrite(copy, 1, size, file) == size && fclose(file) == 0,
        "write output");
  coefficient_close();
  check(coefficient_open(copy, size) == 0, "reopen output");
  for (int i = 0; i < 4; ++i) {
    check(coefficient_read_block(0, i % 2, i / 2, after) == 0, "read encoded");
    check(after[0] == (i == 3 ? targets[i] : expected[i]), "encoded DC mismatch");
    check(memcmp(before[i] + 1, after + 1, 63 * sizeof(int16_t)) == 0,
          "encoded AC mismatch");
  }
  coefficient_close();
  check(coefficient_open(bytes, (unsigned int)length) == 0, "reopen source");
  const unsigned char first[4] = {1, 0, 0, 0};
  check(coefficient_apply(0, 0, 1, 3, first, 4, 0, 1) == 0, "zero DC");
  check(coefficient_apply(0, 3, 1, 3, first, 4, 2047, 1) == 0, "set positive DC");
  check(coefficient_apply(0, 6, 1, 3, first, 4, 500, 1) == 0, "positive limit");
  check(coefficient_read_block(0, 0, 0, after) == 0 && after[0] == 2000,
        "positive limit should stay a step multiple");
  check(coefficient_apply(0, 0, 1, 3, first, 4, 0, 1) == 0, "zero DC");
  check(coefficient_apply(0, 3, 1, 3, first, 4, -2047, 1) == 0, "set negative DC");
  check(coefficient_apply(0, 6, 1, 3, first, 4, 500, 1) == 0, "negative limit");
  check(coefficient_read_block(0, 0, 0, after) == 0 && after[0] == -2000,
        "negative limit should stay a step multiple");
  check(coefficient_apply(0, 6, 1, 3, first, 4, 1, 1) == 0, "step one");
  check(coefficient_read_block(0, 0, 0, after) == 0 && after[0] == -2000,
        "step one should preserve DC");
  coefficient_close();
  free(copy);
  free(bytes);
  puts("DC steps: rounding, mask, components, validation and encode verified");
  return EXIT_SUCCESS;
}
