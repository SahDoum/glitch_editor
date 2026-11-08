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

static void read_blocks(int component, int16_t blocks[4][64]) {
  for (unsigned int i = 0; i < 4; ++i)
    check(coefficient_read_block(component, i % 2, i / 2, blocks[i]) == 0,
          "read block");
}

int main(int argc, char **argv) {
  check(argc == 3, "usage: engraving INPUT OUTPUT");
  FILE *file = fopen(argv[1], "rb");
  check(file != NULL && fseek(file, 0, SEEK_END) == 0, "input");
  long length = ftell(file);
  check(length > 0 && length < 1000000 && fseek(file, 0, SEEK_SET) == 0, "size");
  unsigned char *bytes = malloc((size_t)length);
  check(bytes != NULL && fread(bytes, 1, (size_t)length, file) == (size_t)length,
        "read input");
  check(fclose(file) == 0, "close input");
  const unsigned char all[4] = {1, 1, 1, 1};
  const unsigned char partial[4] = {1, 0, 1, 0};
  for (int mode = 9; mode <= 10; ++mode) {
    int16_t before[4][64], after[4][64], other[4][64], other_after[4][64];
    check(coefficient_open(bytes, (unsigned int)length) == 0, "open input");
    check(coefficient_apply(0, 2, 0, 3, all, 4, 500, 42) == 0, "prepare AC");
    read_blocks(0, before);
    read_blocks(1, other);
    check(coefficient_apply(0, mode, 1, 3, all, 4, 4, 1) != 0, "accepted DC");
    check(coefficient_apply(0, mode, 0, 1, all, 4, 4, 1) != 0, "accepted band");
    check(coefficient_apply(0, mode, 0, 3, all, 4, 0, 1) != 0, "accepted low");
    check(coefficient_apply(0, mode, 0, 3, all, 4, 8.1, 1) != 0, "accepted high");
    check(coefficient_apply(0, mode, 0, 3, partial, 4, 1.5, 1) == 0, "apply");
    read_blocks(0, after);
    read_blocks(1, other_after);
    check(memcmp(other, other_after, sizeof(other)) == 0, "other component changed");
    unsigned int amplified = 0, removed = 0;
    for (unsigned int b = 0; b < 4; ++b) {
      for (unsigned int i = 0; i < 64; ++i) {
        int value = before[b][i];
        int expected = value;
        if (partial[b] && i != 0) {
          int on_axis = mode == 9 ? i % 8 == 0 : i / 8 == 0;
          if (on_axis) {
            expected = value >= 0 ? (value * 3 + 1) / 2 : -((-value * 3 + 1) / 2);
            if (expected > 1023) expected = 1023;
            if (expected < -1023) expected = -1023;
            if (expected != value) ++amplified;
          } else {
            expected = 0;
            if (value != 0) ++removed;
          }
        }
        check(after[b][i] == expected, "incorrect coefficient");
      }
    }
    check(amplified > 0 && removed > 0, "insufficient fixture coverage");
    check(coefficient_encode() == 0, "encode");
    unsigned int size = coefficient_output_size();
    const unsigned char *output = (const unsigned char *)coefficient_output_pointer();
    unsigned char *copy = malloc(size);
    check(copy != NULL && output != NULL && size > 0, "output");
    memcpy(copy, output, size);
    if (mode == 9) {
      file = fopen(argv[2], "wb");
      check(file != NULL && fwrite(copy, 1, size, file) == size && fclose(file) == 0,
            "write output");
    }
    coefficient_close();
    check(coefficient_open(copy, size) == 0, "reopen output");
    read_blocks(0, before);
    read_blocks(1, other_after);
    check(memcmp(before, after, sizeof(before)) == 0, "encoded coefficients changed");
    check(memcmp(other, other_after, sizeof(other)) == 0, "encoded other changed");
    coefficient_close();
    free(copy);
    check(coefficient_open(bytes, (unsigned int)length) == 0, "open limit test");
    check(coefficient_apply(0, 2, 0, 3, all, 4, 500, 42) == 0, "prepare limit");
    read_blocks(0, before);
    check(coefficient_apply(0, mode, 0, 3, all, 4, 8, 1) == 0, "maximum gain");
    read_blocks(0, after);
    unsigned int positive_limit = 0, negative_limit = 0;
    for (unsigned int b = 0; b < 4; ++b)
      for (unsigned int i = 1; i < 64; ++i) {
        int on_axis = mode == 9 ? i % 8 == 0 : i / 8 == 0;
        if (!on_axis) continue;
        int expected = before[b][i] * 8;
        if (expected > 1023) { expected = 1023; ++positive_limit; }
        if (expected < -1023) { expected = -1023; ++negative_limit; }
        check(after[b][i] == expected, "gain limit mismatch");
      }
    check(positive_limit > 0 && negative_limit > 0, "limit cases missing");
    coefficient_close();
    printf("direction %d: %u amplified, %u removed\n", mode, amplified, removed);
  }
  free(bytes);
  return EXIT_SUCCESS;
}
