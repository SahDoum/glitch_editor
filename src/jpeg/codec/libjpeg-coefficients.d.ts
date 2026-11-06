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
  _coefficient_apply(
    component: number,
    mode: number,
    domain: number,
    frequencyBand: number,
    blockMask: number,
    blockMaskSize: number,
    strength: number,
    seed: number,
  ): number;
  _coefficient_repeat_block(
    component: number,
    sourceX: number,
    sourceY: number,
    offsetX: number,
    offsetY: number,
    repetitions: number,
  ): number;
  _coefficient_permute_blocks(
    component: number,
    blockMask: number,
    blockMaskSize: number,
    seed: number,
  ): number;
  _coefficient_transfer_blocks(
    component: number,
    sourceX: number,
    sourceY: number,
    width: number,
    height: number,
    destinationX: number,
    destinationY: number,
    mode: number,
    action: number,
  ): number;
  _coefficient_set_quantization(
    tableId: number,
    semantics: number,
    values: number,
    valuesSize: number,
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
