export type EffectId =
  | "pixelate"
  | "ac-scale"
  | "coefficient-randomize"
  | "dc-offset"
  | "posterization"
  | "ac-low-pass"
  | "ringing"
  | "engraving"
  | "engraving-vertical"
  | "ac-invert"
  | "ac-isolate"
  | "block-transfer"
  | "block-repeat"
  | "block-shuffle"
  | "local-shift"
  | "quantization"
  | "scan-corrupt";

export type EffectApplicationMode = "full-image" | "selection" | "gesture";

export interface EffectCatalogItem {
  readonly id: EffectId;
  readonly label: string;
  readonly description: string;
  readonly category: string;
  readonly applicationMode: EffectApplicationMode;
}

export const EFFECT_CATALOG: readonly EffectCatalogItem[] = [
  {
    id: "pixelate",
    label: "Pixelate",
    description:
      "Zero selected quantized DCT coefficients in affected blocks; this is not a pixel filter.",
    category: "Coefficients",
    applicationMode: "selection",
  },
  {
    id: "ac-scale",
    label: "Coefficient Scale",
    description:
      "Scale selected quantized DCT coefficients; choose DC or AC in the matrix.",
    category: "Coefficients",
    applicationMode: "selection",
  },
  {
    id: "coefficient-randomize",
    label: "Randomize Coefficients",
    description:
      "Replace selected quantized DCT coefficients with seeded values.",
    category: "Coefficients",
    applicationMode: "selection",
  },
  {
    id: "dc-offset",
    label: "DC Offset",
    description: "Add an offset to selected blocks' quantized DC coefficients.",
    category: "Coefficients",
    applicationMode: "selection",
  },
  {
    id: "posterization",
    label: "Posterization",
    description: "Round selected blocks' DC coefficients to steps.",
    category: "Coefficients",
    applicationMode: "selection",
  },
  {
    id: "ac-low-pass",
    label: "AC Low-pass",
    description:
      "Keep DC and AC below a configurable u+v cutoff; remove higher AC.",
    category: "Coefficients",
    applicationMode: "selection",
  },
  {
    id: "ringing",
    label: "Ringing",
    description:
      "Keep low AC, boost coefficients at u+v 3, and remove higher AC.",
    category: "Coefficients",
    applicationMode: "selection",
  },
  {
    id: "engraving",
    label: "Engraving · Horizontal",
    description: "Keep DC and AC on the u=0 frequency axis; remove other AC.",
    category: "Coefficients",
    applicationMode: "selection",
  },
  {
    id: "engraving-vertical",
    label: "Engraving · Vertical",
    description: "Keep DC and AC on the v=0 frequency axis; remove other AC.",
    category: "Coefficients",
    applicationMode: "selection",
  },
  {
    id: "ac-invert",
    label: "Invert AC",
    description: "Negate selected AC coefficients.",
    category: "Coefficients",
    applicationMode: "selection",
  },
  {
    id: "ac-isolate",
    label: "Isolate AC Band",
    description: "Clear AC coefficients outside the selected frequency band.",
    category: "Coefficients",
    applicationMode: "selection",
  },
  {
    id: "block-transfer",
    label: "Block Transfer",
    description: "Copy or swap a dragged region of DCT blocks.",
    category: "Blocks",
    applicationMode: "gesture",
  },
  {
    id: "block-repeat",
    label: "Block Repeat",
    description: "Repeat a source region at a dragged destination.",
    category: "Blocks",
    applicationMode: "gesture",
  },
  {
    id: "block-shuffle",
    label: "Block Shuffle",
    description: "Shuffle whole DCT blocks inside the selected mask.",
    category: "Blocks",
    applicationMode: "selection",
  },
  {
    id: "local-shift",
    label: "Local Shift",
    description: "Copy nearby component blocks into the selected mask.",
    category: "Blocks",
    applicationMode: "selection",
  },
  {
    id: "quantization",
    label: "Quantization Matrix",
    description: "Edit a DQT table and re-encode the JPEG.",
    category: "Quantization",
    applicationMode: "full-image",
  },
  {
    id: "scan-corrupt",
    label: "Scan Corrupt",
    description: "Experiment on the encoded entropy scan after encoding.",
    category: "Encoded data",
    applicationMode: "full-image",
  },
];
