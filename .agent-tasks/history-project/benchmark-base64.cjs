// Run: NODE_PATH=/path/to/playwright/node_modules node .agent-tasks/history-project/benchmark-base64.cjs
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Standalone CommonJS benchmark resolves the environment-provided browser harness.
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    const result = await page.evaluate(() => {
      const input = new Uint8Array(12 * 1024 * 1024 + 2);
      for (let i = 0; i < input.length; i++) input[i] = (i * 17 + 9) % 256;
      function fallbackEncode(bytes) {
        const chunks = [];
        for (let i = 0; i < bytes.length; i += 0x7ffe) chunks.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 0x7ffe))));
        return chunks.join("");
      }
      function fallbackDecode(encoded) {
        const result = new Uint8Array(encoded.length / 4 * 3 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0));
        for (let i = 0; i < encoded.length; i += 0x7ffc) {
          const text = atob(encoded.slice(i, i + 0x7ffc));
          for (let j = 0; j < text.length; j++) result[i / 4 * 3 + j] = text.charCodeAt(j);
        }
        return result;
      }
      function measure(fn) {
        const times = [];
        let value;
        for (let n = 0; n < 5; n++) {
          const start = performance.now(); value = fn(); times.push(performance.now() - start);
        }
        return { medianMs: times.sort((a,b) => a-b)[2], value };
      }
      const fallbackEncoded = measure(() => fallbackEncode(input));
      const fallbackDecoded = measure(() => fallbackDecode(fallbackEncoded.value));
      const nativeAvailable = typeof input.toBase64 === "function" && typeof Uint8Array.fromBase64 === "function";
      if (!nativeAvailable) return { nativeAvailable, fallbackEncodeMs: fallbackEncoded.medianMs, fallbackDecodeMs: fallbackDecoded.medianMs };
      const nativeEncoded = measure(() => input.toBase64());
      const nativeDecoded = measure(() => Uint8Array.fromBase64(nativeEncoded.value, {lastChunkHandling: "strict"}));
      const equalBytes = nativeDecoded.value.length === input.length && nativeDecoded.value.every((v,i) => v === input[i]) && fallbackDecoded.value.every((v,i) => v === input[i]);
      const malformed = ["!AAA", "AA=A", "AA", "A==="];
      return { nativeAvailable, inputBytes: input.length, equalEncoded: nativeEncoded.value === fallbackEncoded.value, equalBytes,
        fallbackEncodeMs: fallbackEncoded.medianMs, fallbackDecodeMs: fallbackDecoded.medianMs,
        nativeEncodeMs: nativeEncoded.medianMs, nativeDecodeMs: nativeDecoded.medianMs,
        malformedRejected: malformed.map(value => { try { Uint8Array.fromBase64(value, {lastChunkHandling:"strict"}); return false; } catch { return true; } }),
        memory: performance.memory ? {usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize} : null,
        memoryLimitation: "Final heap sample only, not isolated peak allocation; codec/source/project copies are excluded." };
    });
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
