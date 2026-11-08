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
  check(argc == 3 || argc == 4, "usage: low-pass INPUT OUTPUT [BOOST_OUTPUT]");
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

  const unsigned char all[4] = {1, 1, 1, 1};
  const unsigned char partial[4] = {1, 0, 1, 0};
  int16_t before[4][64], after[4][64], other[4][64], other_after[4][64];
  check(coefficient_apply(0, 2, 0, 3, all, 4, 50, 42) == 0, "prepare AC");
  read_blocks(0, before);
  read_blocks(1, other);
  check(coefficient_apply(0, 7, 0, 3, all, 4, 14, 1) == 0, "cutoff 14");
  read_blocks(0, after);
  check(memcmp(before, after, sizeof(before)) == 0, "cutoff 14 changed data");
  check(coefficient_apply(0, 7, 1, 3, all, 4, 4, 1) != 0, "accepted DC");
  check(coefficient_apply(0, 7, 0, 0, all, 4, 4, 1) != 0, "accepted band");
  check(coefficient_apply(0, 7, 0, 3, all, 4, 0, 1) != 0, "accepted zero");
  check(coefficient_apply(0, 7, 0, 3, all, 4, 15, 1) != 0, "accepted 15");
  check(coefficient_apply(0, 7, 0, 3, all, 4, 4.5, 1) != 0, "accepted fraction");
  check(coefficient_apply(0, 7, 0, 3, partial, 4, 4, 1) == 0, "low-pass");
  read_blocks(0, after);
  read_blocks(1, other_after);
  check(memcmp(other, other_after, sizeof(other)) == 0, "other component changed");
  unsigned int removed = 0, retained = 0;
  for (unsigned int b = 0; b < 4; ++b) {
    for (unsigned int i = 0; i < 64; ++i) {
      unsigned int frequency = i / 8 + i % 8;
      if (partial[b] && frequency > 4) {
        check(after[b][i] == 0, "high AC not removed");
        if (before[b][i] != 0) ++removed;
      } else {
        check(after[b][i] == before[b][i], "retained coefficient changed");
        if (partial[b] && frequency > 0 && before[b][i] != 0) ++retained;
      }
    }
  }
  check(removed > 0 && retained > 0, "fixture did not exercise cutoff");
  check(coefficient_encode() == 0, "encode output");
  unsigned int size = coefficient_output_size();
  const unsigned char *output = (const unsigned char *)coefficient_output_pointer();
  unsigned char *copy = malloc(size);
  check(output != NULL && size > 0 && copy != NULL, "allocate output");
  memcpy(copy, output, size);
  file = fopen(argv[2], "wb");
  check(file != NULL && fwrite(copy, 1, size, file) == size && fclose(file) == 0,
        "write output");
  coefficient_close();
  check(coefficient_open(copy, size) == 0, "reopen output");
  read_blocks(0, before);
  check(memcmp(before, after, sizeof(before)) == 0, "encoded coefficients changed");
  read_blocks(1, other_after);
  check(memcmp(other, other_after, sizeof(other)) == 0, "encoded component changed");
  check(coefficient_apply(0, 7, 0, 3, all, 4, 1, 1) == 0, "cutoff 1");
  read_blocks(0, after);
  for (unsigned int b = 0; b < 4; ++b)
    for (unsigned int i = 0; i < 64; ++i)
      check(after[b][i] == (i / 8 + i % 8 <= 1 ? before[b][i] : 0),
            "cutoff 1 mismatch");
  coefficient_close();
  check(coefficient_open(bytes, (unsigned int)length) == 0, "reopen source");
  check(coefficient_apply(0, 2, 0, 3, all, 4, 500, 42) == 0, "prepare boost AC");
  read_blocks(0, before);
  read_blocks(1, other);
  check(coefficient_apply(0, 8, 1, 3, all, 4, 4, 1) != 0, "boost accepted DC");
  check(coefficient_apply(0, 8, 0, 0, all, 4, 4, 1) != 0, "boost accepted band");
  check(coefficient_apply(0, 8, 0, 3, all, 4, 0.9, 1) != 0, "boost accepted low");
  check(coefficient_apply(0, 8, 0, 3, all, 4, 8.1, 1) != 0, "boost accepted high");
  check(coefficient_apply(0, 8, 0, 3, partial, 4, 4, 1) == 0, "boost");
  read_blocks(0, after);
  read_blocks(1, other_after);
  check(memcmp(other, other_after, sizeof(other)) == 0, "boost changed component");
  unsigned int boosted = 0, clamped = 0;
  for (unsigned int b = 0; b < 4; ++b) {
    for (unsigned int i = 0; i < 64; ++i) {
      unsigned int frequency = i / 8 + i % 8;
      int expected = before[b][i];
      if (partial[b] && frequency == 3) {
        expected *= 4;
        if (expected > 1023) { expected = 1023; ++clamped; }
        if (expected < -1023) { expected = -1023; ++clamped; }
        if (expected != before[b][i]) ++boosted;
      } else if (partial[b] && frequency > 3) {
        expected = 0;
      }
      check(after[b][i] == expected, "boost coefficient mismatch");
    }
  }
  check(boosted > 0 && clamped > 0, "boost fixture did not exercise limits");
  coefficient_close();
  check(coefficient_open(bytes, (unsigned int)length) == 0, "reopen source");
  check(coefficient_apply(0, 2, 0, 3, all, 4, 50, 42) == 0, "prepare fractional AC");
  read_blocks(0, before);
  check(coefficient_apply(0, 8, 0, 3, partial, 4, 1.5, 1) == 0, "fractional boost");
  read_blocks(0, after);
  for (unsigned int b = 0; b < 4; ++b)
    for (unsigned int i = 0; i < 64; ++i) {
      unsigned int frequency = i / 8 + i % 8;
      int value = before[b][i];
      int expected = value;
      if (partial[b] && frequency == 3)
        expected = value >= 0 ? (value * 3 + 1) / 2 : -((-value * 3 + 1) / 2);
      else if (partial[b] && frequency > 3) expected = 0;
      check(after[b][i] == expected, "fractional boost mismatch");
    }
  check(coefficient_encode() == 0, "encode boosted output");
  size = coefficient_output_size();
  output = (const unsigned char *)coefficient_output_pointer();
  free(copy);
  copy = malloc(size);
  check(copy != NULL && output != NULL && size > 0, "copy boosted output");
  memcpy(copy, output, size);
  if (argc == 4) {
    file = fopen(argv[3], "wb");
    check(file != NULL && fwrite(copy, 1, size, file) == size && fclose(file) == 0,
          "write boosted output");
  }
  coefficient_close();
  check(coefficient_open(copy, size) == 0, "reopen boosted output");
  read_blocks(0, before);
  check(memcmp(before, after, sizeof(before)) == 0, "encoded boost mismatch");
  coefficient_close();
  free(copy);
  free(bytes);
  printf("AC low-pass: %u removed, %u retained; mask, validation and encode verified\n",
         removed, retained);
  return EXIT_SUCCESS;
}
