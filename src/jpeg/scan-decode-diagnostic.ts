import type { ScanDecodeDiagnostic } from "./scan-corruption-worker-protocol";

export function getScanDecodeDiagnosticMessage(
  diagnostic: ScanDecodeDiagnostic,
): string {
  if (diagnostic.status === "unavailable") {
    return `Scan decode diagnostics unavailable: ${diagnostic.message}`;
  }
  if (diagnostic.status === "complete") {
    return `libjpeg-turbo decoded all rows (${diagnostic.decodedRows}/${diagnostic.expectedRows}) without warnings.`;
  }
  if (diagnostic.status === "warnings") {
    return `libjpeg-turbo decoded all rows (${diagnostic.decodedRows}/${diagnostic.expectedRows}) with ${diagnostic.warningCount} decoder warning(s).`;
  }
  if (diagnostic.status === "incomplete") {
    return `libjpeg-turbo did not complete decoding (${diagnostic.decodedRows}/${diagnostic.expectedRows} rows).`;
  }
  return `libjpeg-turbo could not fully decode the JPEG (${diagnostic.decodedRows}/${diagnostic.expectedRows} rows).`;
}

export function getScanDecodeWarningLabels(flags: number): string[] {
  const labels: string[] = [];
  if (flags & 1) labels.push("premature end of scan or file");
  if (flags & 2) labels.push("invalid Huffman code");
  if (flags & 4) labels.push("restart-marker resynchronization");
  if (flags & 8) labels.push("other decoder warning");
  return labels;
}
