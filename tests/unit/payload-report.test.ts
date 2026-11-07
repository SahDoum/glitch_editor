import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/measure-payload.mjs");
const directories: string[] = [];

function createBuild(): string {
  const directory = mkdtempSync(join(tmpdir(), "jpeg-payload-test-"));
  directories.push(directory);
  mkdirSync(join(directory, "dist/assets"), { recursive: true });
  mkdirSync(join(directory, "dist/codec"), { recursive: true });
  writeFileSync(
    join(directory, "dist/index.html"),
    '<script src="/glitch_editor/assets/main.js"></script>',
  );
  writeFileSync(join(directory, "dist/assets/main.js"), "initial");
  writeFileSync(join(directory, "dist/assets/worker.js"), "deferred");
  writeFileSync(join(directory, "dist/codec/libjpeg-coefficients.js"), "codec");
  writeFileSync(
    join(directory, "dist/codec/libjpeg-coefficients.wasm"),
    "wasm",
  );
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("production payload report", () => {
  it("reports initial and deferred assets under a repository base path", () => {
    const cwd = createBuild();
    const output = execFileSync(process.execPath, [script], {
      cwd,
      encoding: "utf8",
    });
    expect(output).toContain("| assets/main.js | initial | 7 |");
    expect(output).toContain("| assets/worker.js | deferred | 8 |");
    expect(output).toContain(
      "| codec/libjpeg-coefficients.wasm | deferred | 4 |",
    );
    expect(output).toContain("| All static files |");
  });

  it("fails when a referenced initial asset or codec is missing", () => {
    const cwd = createBuild();
    rmSync(join(cwd, "dist/codec/libjpeg-coefficients.wasm"));
    expect(() =>
      execFileSync(process.execPath, [script], { cwd, stdio: "pipe" }),
    ).toThrow(/Missing lazy codec asset/);
    rmSync(join(cwd, "dist/assets/main.js"));
    expect(() =>
      execFileSync(process.execPath, [script], { cwd, stdio: "pipe" }),
    ).toThrow(/Missing initial build asset/);
  });
});
