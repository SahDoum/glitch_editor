interface LibjpegCoefficientsModule {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _coefficient_open(pointer: number, size: number): number;
  _coefficient_read_block(
    component: number,
    blockX: number,
    blockY: number,
    output: number,
  ): number;
  _coefficient_zero_band(
    component: number,
    frequencyBand: number,
    blockMask: number,
    blockMaskSize: number,
  ): number;
  _coefficient_encode(): number;
  _coefficient_output_pointer(): number;
  _coefficient_output_size(): number;
  _coefficient_close(): void;
}

interface LibjpegCoefficientsOptions {
  locateFile(path: string, prefix: string): string;
}

declare function createLibjpegCoefficients(
  options: LibjpegCoefficientsOptions,
): Promise<LibjpegCoefficientsModule>;

export default createLibjpegCoefficients;
