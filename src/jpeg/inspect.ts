import { failure, success, type Result } from "../shared/result";

const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_MARKER_COUNT = 10_000;

export interface JpegComponent {
  id: number;
  horizontalSampling: number;
  verticalSampling: number;
  quantizationTable: number;
  dcHuffmanTable: number;
  acHuffmanTable: number;
  blockColumns: number;
  blockRows: number;
}

export interface JpegMarker {
  name: string;
  code: number;
  startOffset: number;
  endOffset: number;
  segmentLength: number | null;
  kind: "standalone" | "segment" | "restart";
}

export interface JpegScan {
  dataStartOffset: number;
  dataEndOffset: number;
  components: Array<{
    id: number;
    dcHuffmanTable: number;
    acHuffmanTable: number;
  }>;
}

export interface JpegQuantizationTable {
  id: number;
  values: number[];
}

export interface JpegInspection {
  process: "Baseline sequential DCT Huffman";
  width: number;
  height: number;
  precision: number;
  components: JpegComponent[];
  quantizationTables: JpegQuantizationTable[];
  markers: JpegMarker[];
  scans: JpegScan[];
  restartInterval: number;
  mcuWidth: number;
  mcuHeight: number;
  mcuColumns: number;
  mcuRows: number;
  blockGridComponentId: number;
  blockWidth: number;
  blockHeight: number;
}

const ZIGZAG_TO_NATURAL = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40,
  48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29,
  22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54,
  47, 55, 62, 63,
] as const;

const MARKER_NAMES: Record<number, string> = {
  0xc0: "SOF0",
  0xc1: "SOF1",
  0xc2: "SOF2",
  0xc3: "SOF3",
  0xc4: "DHT",
  0xc5: "SOF5",
  0xc6: "SOF6",
  0xc7: "SOF7",
  0xc9: "SOF9",
  0xca: "SOF10",
  0xcb: "SOF11",
  0xcd: "SOF13",
  0xce: "SOF14",
  0xcf: "SOF15",
  0xcc: "DAC",
  0xd8: "SOI",
  0xd9: "EOI",
  0xda: "SOS",
  0xdb: "DQT",
  0xdc: "DNL",
  0xdd: "DRI",
  0xde: "DHP",
  0xdf: "EXP",
  0xe0: "APP0",
  0xe1: "APP1",
  0xe2: "APP2",
  0xe3: "APP3",
  0xe4: "APP4",
  0xe5: "APP5",
  0xe6: "APP6",
  0xe7: "APP7",
  0xe8: "APP8",
  0xe9: "APP9",
  0xea: "APP10",
  0xeb: "APP11",
  0xec: "APP12",
  0xed: "APP13",
  0xee: "APP14",
  0xef: "APP15",
  0xfe: "COM",
};

function isStartOfFrame(code: number): boolean {
  return (
    code >= 0xc0 &&
    code <= 0xcf &&
    code !== 0xc4 &&
    code !== 0xc8 &&
    code !== 0xcc
  );
}

function markerName(code: number): string {
  if (code >= 0xd0 && code <= 0xd7) return `RST${code - 0xd0}`;
  if (code >= 0xe0 && code <= 0xef) return `APP${code - 0xe0}`;
  return (
    MARKER_NAMES[code] ??
    `FF${code.toString(16).padStart(2, "0").toUpperCase()}`
  );
}

function malformed(message: string): Result<never> {
  return failure({ code: "MALFORMED_JPEG", message });
}

function unsupported(message: string): Result<never> {
  return failure({ code: "UNSUPPORTED_FORMAT", message });
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 256 + bytes[offset + 1]!;
}

interface Frame {
  width: number;
  height: number;
  precision: number;
  components: Array<{
    id: number;
    horizontalSampling: number;
    verticalSampling: number;
    quantizationTable: number;
  }>;
}

function parseFrame(
  bytes: Uint8Array,
  payloadStart: number,
  segmentEnd: number,
): Result<Frame> {
  const payloadLength = segmentEnd - payloadStart;
  if (payloadLength < 6) {
    return malformed("The JPEG frame header is truncated.");
  }

  const precision = bytes[payloadStart]!;
  const height = readUint16(bytes, payloadStart + 1);
  const width = readUint16(bytes, payloadStart + 3);
  const componentCount = bytes[payloadStart + 5]!;

  if (
    componentCount === 0 ||
    payloadLength !== 6 + componentCount * 3 ||
    width === 0
  ) {
    return malformed("The JPEG frame dimensions or component list is invalid.");
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    return unsupported(
      "JPEG images larger than 40 megapixels are not supported.",
    );
  }
  if (height === 0) {
    return unsupported(
      "JPEG images whose height is defined later by a DNL marker are not supported.",
    );
  }

  if (precision !== 8) {
    return unsupported("Only 8-bit baseline JPEG images are supported.");
  }
  if (componentCount !== 1 && componentCount !== 3) {
    return unsupported(
      "Only grayscale and three-component JPEG images are supported.",
    );
  }

  const components: Frame["components"] = [];
  const ids = new Set<number>();
  for (let index = 0; index < componentCount; index += 1) {
    const componentOffset = payloadStart + 6 + index * 3;
    const id = bytes[componentOffset]!;
    const sampling = bytes[componentOffset + 1]!;
    const horizontalSampling = sampling >> 4;
    const verticalSampling = sampling & 0x0f;
    const quantizationTable = bytes[componentOffset + 2]!;

    if (
      ids.has(id) ||
      horizontalSampling < 1 ||
      horizontalSampling > 4 ||
      verticalSampling < 1 ||
      verticalSampling > 4 ||
      quantizationTable > 3
    ) {
      return malformed("The JPEG frame contains invalid component parameters.");
    }

    ids.add(id);
    components.push({
      id,
      horizontalSampling,
      verticalSampling,
      quantizationTable,
    });
  }

  const blocksPerMcu = components.reduce(
    (total, component) =>
      total + component.horizontalSampling * component.verticalSampling,
    0,
  );
  if (blocksPerMcu > 10) {
    return malformed("The JPEG frame exceeds the baseline MCU block limit.");
  }

  return success({ width, height, precision, components });
}

function parseQuantizationTables(
  bytes: Uint8Array,
  payloadStart: number,
  segmentEnd: number,
  tables: Map<number, number[]>,
): Result<undefined> {
  let offset = payloadStart;
  let tableCount = 0;
  while (offset < segmentEnd) {
    const descriptor = bytes[offset++]!;
    const precision = descriptor >> 4;
    const tableId = descriptor & 0x0f;
    if (precision > 1 || tableId > 3) {
      return malformed("The JPEG quantization-table descriptor is invalid.");
    }

    const tableBytes = 64 * (precision + 1);
    if (offset + tableBytes > segmentEnd) {
      return malformed("A JPEG quantization table is truncated.");
    }
    if (precision !== 0) {
      return unsupported("16-bit quantization tables are not supported.");
    }
    const values = new Array<number>(64);
    for (let index = 0; index < 64; index += 1) {
      const value = bytes[offset + index]!;
      if (value === 0) {
        return malformed("A JPEG quantization table contains a zero value.");
      }
      values[ZIGZAG_TO_NATURAL[index]!] = value;
    }
    tables.set(tableId, values);
    tableCount += 1;
    offset += tableBytes;
  }

  if (tableCount === 0) {
    return malformed("The JPEG quantization-table segment is empty.");
  }
  return success(undefined);
}

function parseHuffmanTables(
  bytes: Uint8Array,
  payloadStart: number,
  segmentEnd: number,
  tables: Set<string>,
): Result<undefined> {
  let offset = payloadStart;
  let tableCount = 0;
  while (offset < segmentEnd) {
    if (offset + 17 > segmentEnd) {
      return malformed("A JPEG Huffman table header is truncated.");
    }

    const descriptor = bytes[offset++]!;
    const tableClass = descriptor >> 4;
    const tableId = descriptor & 0x0f;
    if (tableClass > 1 || tableId > 3) {
      return malformed("The JPEG Huffman-table descriptor is invalid.");
    }

    let symbolCount = 0;
    let availableCodes = 1;
    for (let index = 0; index < 16; index += 1) {
      const count = bytes[offset + index]!;
      symbolCount += count;
      availableCodes = availableCodes * 2 - count;
      if (availableCodes < 0) {
        return malformed("A JPEG Huffman table has oversubscribed codes.");
      }
    }
    offset += 16;
    if (symbolCount > 256 || offset + symbolCount > segmentEnd) {
      return malformed("A JPEG Huffman table has an invalid symbol list.");
    }
    if (symbolCount === 0) {
      return malformed(
        "A JPEG Huffman table cannot have an empty symbol list.",
      );
    }
    tables.add(`${tableClass}:${tableId}`);
    tableCount += 1;
    offset += symbolCount;
  }

  if (tableCount === 0) {
    return malformed("The JPEG Huffman-table segment is empty.");
  }
  return success(undefined);
}

function parseScanHeader(
  bytes: Uint8Array,
  payloadStart: number,
  segmentEnd: number,
  frame: Frame,
  quantizationTables: ReadonlyMap<number, number[]>,
  huffmanTables: Set<string>,
): Result<JpegScan["components"]> {
  const payloadLength = segmentEnd - payloadStart;
  if (payloadLength < 4) {
    return malformed("The JPEG scan header is truncated.");
  }

  const componentCount = bytes[payloadStart]!;
  if (componentCount === 0 || payloadLength !== 4 + componentCount * 2) {
    return malformed("The JPEG scan component list is invalid.");
  }

  const frameById = new Map(
    frame.components.map((component) => [component.id, component]),
  );
  const scanComponents: JpegScan["components"] = [];
  const seenIds = new Set<number>();
  for (let index = 0; index < componentCount; index += 1) {
    const componentOffset = payloadStart + 1 + index * 2;
    const id = bytes[componentOffset]!;
    const selectors = bytes[componentOffset + 1]!;
    const dcTable = selectors >> 4;
    const acTable = selectors & 0x0f;
    const component = frameById.get(id);

    if (!component || seenIds.has(id) || dcTable > 3 || acTable > 3) {
      return malformed(
        "The JPEG scan refers to an invalid component or table.",
      );
    }
    if (!quantizationTables.has(component.quantizationTable)) {
      return malformed(
        "A JPEG component refers to a missing quantization table.",
      );
    }
    if (
      !huffmanTables.has(`0:${dcTable}`) ||
      !huffmanTables.has(`1:${acTable}`)
    ) {
      return malformed("The JPEG scan refers to a missing Huffman table.");
    }

    seenIds.add(id);
    scanComponents.push({
      id,
      dcHuffmanTable: dcTable,
      acHuffmanTable: acTable,
    });
  }

  const spectralStart = bytes[payloadStart + 1 + componentCount * 2]!;
  const spectralEnd = bytes[payloadStart + 2 + componentCount * 2]!;
  const approximation = bytes[payloadStart + 3 + componentCount * 2]!;
  if (
    componentCount !== frame.components.length ||
    scanComponents.length !== frame.components.length ||
    spectralStart !== 0 ||
    spectralEnd !== 63 ||
    approximation !== 0
  ) {
    return unsupported(
      "Only a single interleaved sequential scan covering all components is supported.",
    );
  }

  return success(scanComponents);
}

export function inspectJpeg(bytes: Uint8Array): Result<JpegInspection> {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return failure({
      code: "UNSUPPORTED_FORMAT",
      message: "The selected file is not a JPEG image.",
    });
  }

  const markers: JpegMarker[] = [
    {
      name: "SOI",
      code: 0xd8,
      startOffset: 0,
      endOffset: 2,
      segmentLength: null,
      kind: "standalone",
    },
  ];
  const scans: JpegScan[] = [];
  const quantizationTables = new Map<number, number[]>();
  const huffmanTables = new Set<string>();
  let frame: Frame | null = null;
  let restartInterval = 0;
  let offset = 2;
  let sawEnd = false;

  while (offset < bytes.byteLength) {
    if (markers.length >= MAX_MARKER_COUNT) {
      return unsupported(
        "JPEG files with more than 10,000 markers are not supported.",
      );
    }
    const markerStart = offset;
    if (bytes[offset] !== 0xff) {
      return malformed("Unexpected data was found outside a JPEG scan.");
    }

    while (offset < bytes.byteLength && bytes[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= bytes.byteLength) {
      return malformed("The JPEG ends inside a marker.");
    }

    const code = bytes[offset]!;
    if (code === 0x00) {
      return malformed(
        "A stuffed byte was found outside an entropy-coded scan.",
      );
    }
    offset += 1;
    const name = markerName(code);

    if (code === 0xd9) {
      markers.push({
        name,
        code,
        startOffset: markerStart,
        endOffset: offset,
        segmentLength: null,
        kind: "standalone",
      });
      sawEnd = true;
      break;
    }
    if (code === 0xd8) {
      return malformed("A second start-of-image marker was found.");
    }
    if (code >= 0xd0 && code <= 0xd7) {
      return malformed(
        "A restart marker was found outside an entropy-coded scan.",
      );
    }
    if (code === 0x01) {
      return unsupported(
        "JPEG temporary extension markers are not supported by the inspector.",
      );
    }
    if (
      code === 0xc8 ||
      code === 0xcc ||
      code === 0xdc ||
      code === 0xde ||
      code === 0xdf ||
      (code >= 0xf0 && code <= 0xfd)
    ) {
      return unsupported(
        `${name} JPEG extension markers are not supported by the inspector.`,
      );
    }
    if (offset + 2 > bytes.byteLength) {
      return malformed(`The ${name} marker has no segment length.`);
    }

    const segmentLength = readUint16(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      return malformed(
        `The ${name} marker has an invalid or truncated segment.`,
      );
    }
    const payloadStart = offset + 2;
    const segmentEnd = offset + segmentLength;
    markers.push({
      name,
      code,
      startOffset: markerStart,
      endOffset: segmentEnd,
      segmentLength,
      kind: "segment",
    });

    if (isStartOfFrame(code)) {
      if (code !== 0xc0) {
        return unsupported(
          "Only baseline sequential DCT Huffman JPEG images are supported; progressive and other JPEG processes are not supported.",
        );
      }
      if (frame) {
        return malformed("The JPEG contains more than one frame header.");
      }
      const parsedFrame = parseFrame(bytes, payloadStart, segmentEnd);
      if (!parsedFrame.ok) return parsedFrame;
      frame = parsedFrame.value;
    } else if (code === 0xdb) {
      const result = parseQuantizationTables(
        bytes,
        payloadStart,
        segmentEnd,
        quantizationTables,
      );
      if (!result.ok) return result;
    } else if (code === 0xc4) {
      const result = parseHuffmanTables(
        bytes,
        payloadStart,
        segmentEnd,
        huffmanTables,
      );
      if (!result.ok) return result;
    } else if (code === 0xdd) {
      if (segmentLength !== 4) {
        return malformed(
          "The JPEG restart-interval segment has an invalid length.",
        );
      }
      restartInterval = readUint16(bytes, payloadStart);
    }

    offset = segmentEnd;
    if (code !== 0xda) continue;

    if (!frame) {
      return malformed("The JPEG scan appears before its frame header.");
    }
    const scanHeader = parseScanHeader(
      bytes,
      payloadStart,
      segmentEnd,
      frame,
      quantizationTables,
      huffmanTables,
    );
    if (!scanHeader.ok) return scanHeader;

    const dataStartOffset = offset;
    let scanMarkerOffset = offset;
    let nextRestartMarker = 0;
    let foundMarker = false;
    while (scanMarkerOffset < bytes.byteLength) {
      if (bytes[scanMarkerOffset] !== 0xff) {
        scanMarkerOffset += 1;
        continue;
      }

      const restartStart = scanMarkerOffset;
      let codeOffset = scanMarkerOffset;
      while (codeOffset < bytes.byteLength && bytes[codeOffset] === 0xff) {
        codeOffset += 1;
      }
      if (codeOffset >= bytes.byteLength) {
        return malformed("The JPEG ends inside entropy-coded scan data.");
      }

      const scanCode = bytes[codeOffset]!;
      if (scanCode === 0x00) {
        scanMarkerOffset = codeOffset + 1;
        continue;
      }
      if (scanCode >= 0xd0 && scanCode <= 0xd7) {
        if (markers.length >= MAX_MARKER_COUNT) {
          return unsupported(
            "JPEG files with more than 10,000 markers are not supported.",
          );
        }
        if (restartInterval === 0) {
          return malformed(
            "A JPEG restart marker appears without a restart interval.",
          );
        }
        if (scanCode !== 0xd0 + nextRestartMarker) {
          return malformed("JPEG restart markers are out of sequence.");
        }
        markers.push({
          name: markerName(scanCode),
          code: scanCode,
          startOffset: restartStart,
          endOffset: codeOffset + 1,
          segmentLength: null,
          kind: "restart",
        });
        nextRestartMarker = (nextRestartMarker + 1) % 8;
        scanMarkerOffset = codeOffset + 1;
        continue;
      }

      scans.push({
        dataStartOffset,
        dataEndOffset: restartStart,
        components: scanHeader.value,
      });
      offset = restartStart;
      foundMarker = true;
      break;
    }

    if (!foundMarker) {
      return malformed("The JPEG scan is truncated before its end marker.");
    }
  }

  if (!sawEnd) {
    return malformed("The JPEG is missing its end-of-image marker.");
  }
  if (!frame || scans.length === 0) {
    return malformed("The JPEG is missing a frame or entropy-coded scan.");
  }
  if (scans.length !== 1) {
    return unsupported("JPEG images with multiple scans are not supported.");
  }

  const maxHorizontalSampling = Math.max(
    ...frame.components.map((component) => component.horizontalSampling),
  );
  const maxVerticalSampling = Math.max(
    ...frame.components.map((component) => component.verticalSampling),
  );
  const mcuWidth = 8 * maxHorizontalSampling;
  const mcuHeight = 8 * maxVerticalSampling;
  const mcuColumns = Math.ceil(frame.width / mcuWidth);
  const mcuRows = Math.ceil(frame.height / mcuHeight);
  const blockGridComponent = frame.components[0]!;
  const scanTables = new Map(
    scans[0]!.components.map((component) => [component.id, component]),
  );
  const components: JpegComponent[] = frame.components.map((component) => ({
    ...component,
    dcHuffmanTable: scanTables.get(component.id)!.dcHuffmanTable,
    acHuffmanTable: scanTables.get(component.id)!.acHuffmanTable,
    blockColumns: mcuColumns * component.horizontalSampling,
    blockRows: mcuRows * component.verticalSampling,
  }));
  const gridComponent = components[0]!;

  return success({
    process: "Baseline sequential DCT Huffman",
    width: frame.width,
    height: frame.height,
    precision: frame.precision,
    components,
    quantizationTables: [...quantizationTables].map(([id, values]) => ({
      id,
      values,
    })),
    markers,
    scans,
    restartInterval,
    mcuWidth,
    mcuHeight,
    mcuColumns,
    mcuRows,
    blockGridComponentId: blockGridComponent.id,
    blockWidth: (8 * maxHorizontalSampling) / gridComponent.horizontalSampling,
    blockHeight: (8 * maxVerticalSampling) / gridComponent.verticalSampling,
  });
}
