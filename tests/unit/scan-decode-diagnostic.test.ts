import { describe, expect, it } from "vitest";
import {
  getScanDecodeDiagnosticMessage,
  getScanDecodeWarningLabels,
} from "../../src/jpeg/scan-decode-diagnostic";
import type { ScanDecodeDiagnostic } from "../../src/jpeg/scan-corruption-worker-protocol";

const diagnostic: ScanDecodeDiagnostic = {
  decoder: "libjpeg-turbo",
  status: "complete",
  decodedRows: 16,
  expectedRows: 16,
  warningCount: 0,
  warningFlags: 0,
  message: "",
};

describe("scan decode diagnostics", () => {
  it("distinguishes complete decode, warned decode, and incomplete rows", () => {
    expect(getScanDecodeDiagnosticMessage(diagnostic)).toContain("16/16");
    expect(
      getScanDecodeDiagnosticMessage({
        ...diagnostic,
        status: "warnings",
        warningCount: 2,
      }),
    ).toContain("2 decoder warning(s)");
    expect(
      getScanDecodeDiagnosticMessage({
        ...diagnostic,
        status: "incomplete",
        decodedRows: 9,
      }),
    ).toContain("9/16 rows");
    expect(
      getScanDecodeDiagnosticMessage({
        ...diagnostic,
        status: "failed",
        decodedRows: 0,
      }),
    ).toContain("0/16 rows");
  });

  it("explains unavailable checks and maps decoder warnings to safe labels", () => {
    expect(
      getScanDecodeDiagnosticMessage({
        ...diagnostic,
        status: "unavailable",
        message: "codec failed to load",
      }),
    ).toContain("codec failed to load");
    expect(getScanDecodeWarningLabels(15)).toEqual([
      "premature end of scan or file",
      "invalid Huffman code",
      "restart-marker resynchronization",
      "other decoder warning",
    ]);
  });
});
