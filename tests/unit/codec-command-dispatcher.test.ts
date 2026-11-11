import { describe, expect, it, vi } from "vitest";
import { createFullImageMask } from "../../src/document/masks";
import {
  compileCodecCommands,
  isCodecCommandList,
  type CodecCommandModule,
} from "../../src/jpeg/codec-command-dispatcher";
import { handleCodecOperation } from "../../src/jpeg/codec-controllers/registry";
import type { JpegBlockGeometry } from "../../src/jpeg/block-geometry";
import type { JpegGlitchOperation } from "../../src/operations/jpeg-glitch";

const geometry: JpegBlockGeometry = {
  width: 16,
  height: 16,
  components: [
    {
      id: 1,
      horizontalSampling: 1,
      verticalSampling: 1,
      quantizationTable: 0,
    },
  ],
};

function createOperations(): JpegGlitchOperation[] {
  const mask = createFullImageMask(16, 16);
  if (!mask.ok) throw new Error("Could not create fixture mask.");
  return [
    {
      kind: "coefficients",
      mask: mask.value,
      componentIndex: 0,
      domain: "ac",
      mode: "zero",
      frequencyBand: "all",
      strength: 0,
      seed: 1,
    },
    {
      kind: "block-repeat",
      componentIndex: 0,
      sourceX: 0,
      sourceY: 0,
      offsetX: 1,
      offsetY: 0,
      repetitions: 1,
    },
    {
      kind: "block-permutation",
      componentIndex: 0,
      mask: mask.value,
      seed: 9,
    },
    {
      kind: "block-shift",
      componentIndex: 0,
      mask: mask.value,
      offsetX: 0,
      offsetY: 1,
    },
    {
      kind: "block-transfer",
      componentIndex: 0,
      sourceX: 0,
      sourceY: 0,
      width: 1,
      height: 1,
      destinationX: 1,
      destinationY: 0,
      mode: "all",
      action: "copy",
    },
    {
      kind: "quantization",
      tableId: 0,
      values: Array.from({ length: 64 }, () => 10),
      semantics: "reinterpret",
      pattern: "manual",
      seed: 1,
    },
  ];
}

function createCodecMock() {
  return {
    HEAPU8: new Uint8Array(256),
    _malloc: vi.fn(() => 8),
    _free: vi.fn(),
    _coefficient_apply: vi.fn(() => 0),
    _coefficient_repeat_block: vi.fn(() => 0),
    _coefficient_permute_blocks: vi.fn(() => 0),
    _coefficient_shift_blocks: vi.fn(() => 0),
    _coefficient_transfer_blocks: vi.fn(() => 0),
    _coefficient_set_quantization: vi.fn(() => 0),
  } satisfies CodecCommandModule;
}

describe("JPEG codec operation controllers", () => {
  it("compiles each operation to a structured-cloneable atomic command", () => {
    const result = compileCodecCommands(createOperations(), geometry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.map(({ kind }) => kind)).toEqual([
      "apply-coefficients",
      "repeat-block",
      "permute-blocks",
      "shift-blocks",
      "transfer-blocks",
      "set-quantization",
    ]);
    const clonedCommands = structuredClone(result.value);
    expect(isCodecCommandList(clonedCommands, geometry)).toBe(true);
  });

  it("dispatches each command to its registered controller", () => {
    const compiled = compileCodecCommands(createOperations(), geometry);
    const codec = createCodecMock();
    if (!compiled.ok) throw new Error("Could not compile fixture operations.");

    for (const command of compiled.value) {
      expect(handleCodecOperation(codec, command, geometry)).toEqual({
        ok: true,
        value: 0,
      });
    }

    expect(codec._coefficient_apply).toHaveBeenCalledOnce();
    expect(codec._coefficient_repeat_block).toHaveBeenCalledOnce();
    expect(codec._coefficient_permute_blocks).toHaveBeenCalledOnce();
    expect(codec._coefficient_shift_blocks).toHaveBeenCalledOnce();
    expect(codec._coefficient_transfer_blocks).toHaveBeenCalledOnce();
    expect(codec._coefficient_set_quantization).toHaveBeenCalledOnce();
    expect(codec._malloc).toHaveBeenCalledTimes(4);
    expect(codec._free).toHaveBeenCalledTimes(4);
  });

  it("rejects a mask that does not match the JPEG image dimensions", () => {
    const mask = createFullImageMask(8, 8);
    if (!mask.ok) throw new Error("Could not create fixture mask.");
    const result = compileCodecCommands(
      [
        {
          kind: "coefficients",
          mask: mask.value,
          componentIndex: 0,
          domain: "ac",
          mode: "zero",
          frequencyBand: "all",
          strength: 0,
          seed: 1,
        },
      ],
      geometry,
    );

    expect(result.ok).toBe(false);
  });

  it("uses each controller's validator to reject malformed commands", () => {
    expect(
      isCodecCommandList(
        [
          {
            kind: "repeat-block",
            componentIndex: 0,
            sourceX: 0,
            sourceY: 0,
            offsetX: 0,
            offsetY: 0,
            repetitions: 1,
          },
        ],
        geometry,
      ),
    ).toBe(false);
    expect(
      isCodecCommandList(
        [
          {
            kind: "set-quantization",
            tableId: 0,
            semantics: 0,
            values: new Uint8Array(64),
          },
        ],
        geometry,
      ),
    ).toBe(false);
    expect(
      isCodecCommandList(
        [
          {
            kind: "transfer-blocks",
            componentIndex: 0,
            sourceX: 0,
            sourceY: 0,
            width: 1,
            height: 1,
            destinationX: 1,
            destinationY: 0,
            mode: 0,
            action: 2,
          },
        ],
        geometry,
      ),
    ).toBe(false);
  });
});
