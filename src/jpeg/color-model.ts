import type { JpegInspection, JpegMarker } from "./inspect";

export type JpegColorModelKind =
  "ycbcr" | "assumed-ycbcr" | "rgb" | "other" | "unknown" | "grayscale";

export interface JpegColorModel {
  readonly kind: JpegColorModelKind;
  readonly description: string;
}

export interface JpegComponentLabel {
  readonly label: string;
  readonly tone?: "blue-yellow" | "red-green";
}

function getSegmentPayload(
  bytes: Uint8Array,
  marker: JpegMarker,
): Uint8Array | null {
  if (marker.kind !== "segment") return null;
  let codeOffset = marker.startOffset + 1;
  while (codeOffset < bytes.length && bytes[codeOffset] === 0xff) {
    codeOffset += 1;
  }
  if (bytes[marker.startOffset] !== 0xff || bytes[codeOffset] !== marker.code) {
    return null;
  }
  const lengthOffset = codeOffset + 1;
  const payloadStart = lengthOffset + 2;
  if (payloadStart > marker.endOffset || marker.endOffset > bytes.length) {
    return null;
  }
  const segmentLength = bytes[lengthOffset]! * 256 + bytes[lengthOffset + 1]!;
  const segmentEnd = lengthOffset + segmentLength;
  if (
    segmentLength < 2 ||
    segmentEnd !== marker.endOffset ||
    payloadStart > segmentEnd
  ) {
    return null;
  }
  return bytes.subarray(payloadStart, segmentEnd);
}

function startsWithAscii(bytes: Uint8Array, value: string): boolean {
  if (bytes.length < value.length) return false;
  return [...value].every((character, index) => {
    return bytes[index] === character.charCodeAt(0);
  });
}

export function identifyJpegColorModel(
  bytes: Uint8Array,
  inspection: JpegInspection,
): JpegColorModel {
  if (inspection.components.length === 1) {
    return {
      kind: "grayscale",
      description: "Single-component grayscale JPEG.",
    };
  }

  const jfif = inspection.markers.some((marker) => {
    if (marker.code !== 0xe0) return false;
    const payload = getSegmentPayload(bytes, marker);
    return payload !== null && startsWithAscii(payload, "JFIF\0");
  });
  const adobeTransforms = inspection.markers.flatMap((marker) => {
    if (marker.code !== 0xee) return [];
    const payload = getSegmentPayload(bytes, marker);
    return payload && startsWithAscii(payload, "Adobe") && payload.length >= 12
      ? [payload[11]!]
      : [];
  });
  const uniqueAdobeTransforms = [...new Set(adobeTransforms)];
  const adobeTransform =
    uniqueAdobeTransforms.length === 1 ? uniqueAdobeTransforms[0] : null;

  if (uniqueAdobeTransforms.length > 1 || (jfif && adobeTransform === 0)) {
    return {
      kind: "unknown",
      description:
        "JPEG color-space markers conflict; component color roles are not inferred.",
    };
  }
  if (adobeTransform === 2) {
    return {
      kind: "other",
      description:
        "Adobe metadata indicates YCCK (transform 2), not YCbCr; component roles are not inferred.",
    };
  }
  if (adobeTransform !== null && adobeTransform !== 0 && adobeTransform !== 1) {
    return {
      kind: "other",
      description: `Adobe metadata declares color transform ${adobeTransform}; component roles are not inferred.`,
    };
  }
  if (jfif || adobeTransform === 1) {
    return {
      kind: "ycbcr",
      description: jfif
        ? "YCbCr identified from JFIF metadata."
        : "YCbCr identified from Adobe metadata.",
    };
  }
  if (adobeTransform === 0) {
    return {
      kind: "rgb",
      description:
        "Adobe metadata indicates RGB; JPEG components are not labeled Y/Cb/Cr.",
    };
  }
  return {
    kind: "assumed-ycbcr",
    description:
      "Color space is not identified by JPEG metadata; conventional Y/Cb/Cr roles are assumed for this three-component frame.",
  };
}

export function getJpegComponentLabels(
  model: JpegColorModel,
  componentCount: number,
): readonly JpegComponentLabel[] {
  if (componentCount === 1) return [{ label: "Gray" }];
  if (componentCount !== 3) {
    return Array.from({ length: componentCount }, (_, index) => ({
      label: `Component ${index + 1}`,
    }));
  }
  if (model.kind === "ycbcr" || model.kind === "assumed-ycbcr") {
    return [
      { label: "Luminance (Y)" },
      { label: "Blue chroma (Cb)", tone: "blue-yellow" },
      { label: "Red chroma (Cr)", tone: "red-green" },
    ];
  }
  if (model.kind === "rgb") {
    return [{ label: "Red" }, { label: "Green" }, { label: "Blue" }];
  }
  return Array.from({ length: componentCount }, (_, index) => ({
    label: `Component ${index + 1}`,
  }));
}

export function getQuantizationTableLabel(
  tableId: number,
  components: JpegInspection["components"],
  labels: readonly JpegComponentLabel[],
): string {
  const assigned = components.flatMap((component, index) =>
    component.quantizationTable === tableId
      ? [labels[index]?.label ?? `Component ${index + 1}`]
      : [],
  );
  const uniqueLabels = [...new Set(assigned)];
  return uniqueLabels.length
    ? `DQT ${tableId} · ${uniqueLabels.join(" / ")}`
    : `DQT ${tableId}`;
}
