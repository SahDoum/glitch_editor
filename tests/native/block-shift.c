#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int coefficient_open(const unsigned char *, unsigned int);
int coefficient_read_block(int, unsigned int, unsigned int, int16_t *);
int coefficient_shift_blocks(int, const unsigned char *, unsigned int, int, int);
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
          "failed to read block");
}

int main(int argc, char **argv) {
  check(argc == 3, "usage: block-shift INPUT OUTPUT");
  FILE *file = fopen(argv[1], "rb");
  check(file != NULL && fseek(file, 0, SEEK_END) == 0, "input");
  long length = ftell(file);
  check(length > 0 && length < 1000000 && fseek(file, 0, SEEK_SET) == 0,
        "input size");
  unsigned char *bytes = malloc((size_t)length);
  check(bytes != NULL && fread(bytes, 1, (size_t)length, file) == (size_t)length,
        "read input");
  check(fclose(file) == 0, "close input");
  const unsigned char all[4] = {1, 1, 1, 1};
  const unsigned char partial[4] = {0, 0, 0, 1};
  int16_t before[4][64], after[4][64], other[4][64], untouched[4][64];
  for (int direction = -1; direction <= 1; direction += 2) {
    check(coefficient_open(bytes, (unsigned int)length) == 0, "open JPEG");
    read_blocks(1, before);
    read_blocks(0, other);
    check(coefficient_shift_blocks(1, all, 4, direction, 0) == 0, "shift");
    read_blocks(1, after);
    read_blocks(0, untouched);
    check(memcmp(other, untouched, sizeof(other)) == 0, "other component changed");
    for (unsigned int b = 0; b < 4; ++b) {
      int source = (int)b - direction;
      if ((direction == 1 && b % 2 == 0) ||
          (direction == -1 && b % 2 == 1)) source = (int)b;
      check(memcmp(after[b], before[source], sizeof(before[b])) == 0,
            "wrong block or edge behavior");
    }
    if (direction == 1) {
      check(coefficient_encode() == 0, "encode shift");
      file = fopen(argv[2], "wb");
      check(file != NULL, "open output");
      unsigned int size = coefficient_output_size();
      const void *output = (const void *)coefficient_output_pointer();
      check(output != NULL && fwrite(output, 1, size, file) == size &&
                fclose(file) == 0, "write output");
    }
    coefficient_close();
  }
  check(coefficient_open(bytes, (unsigned int)length) == 0, "reopen JPEG");
  read_blocks(1, before);
  check(coefficient_shift_blocks(1, partial, 4, 1, 0) == 0, "masked shift");
  read_blocks(1, after);
  for (int b = 0; b < 3; ++b)
    check(memcmp(after[b], before[b], sizeof(before[b])) == 0, "mask leaked");
  check(memcmp(after[3], before[2], sizeof(before[2])) == 0, "mask target");
  check(coefficient_shift_blocks(1, all, 4, 0, 0) != 0, "zero offset accepted");
  check(coefficient_shift_blocks(1, all, 3, 1, 0) != 0, "bad mask accepted");
  coefficient_close();
  free(bytes);
  puts("block shift: positive, negative, edges, mask and components verified");
  return EXIT_SUCCESS;
}
