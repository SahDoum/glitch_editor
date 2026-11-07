import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve("dist");

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return files.flat();
}

const files = (await listFiles(root)).sort();
const html = await readFile(join(root, "index.html"), "utf8");
const initial = new Set(["index.html"]);
for (const match of html.matchAll(/(?:src|href)="[^"]*\/(assets\/[^"]+)"/g)) {
  initial.add(match[1]);
}
if (initial.size === 1) {
  throw new Error("No initial assets found in dist/index.html; build first.");
}

const totals = {
  initial: { raw: 0, gzip: 0 },
  deferred: { raw: 0, gzip: 0 },
};
const found = new Set();
console.log("| Asset | Group | Bytes | Gzip bytes |");
console.log("| --- | --- | ---: | ---: |");
for (const file of files) {
  const name = relative(root, file).split("\\").join("/");
  found.add(name);
  const group = initial.has(name) ? "initial" : "deferred";
  const data = await readFile(file);
  const gzip = gzipSync(data, { level: 9 }).byteLength;
  totals[group].raw += data.byteLength;
  totals[group].gzip += gzip;
  console.log(`| ${name} | ${group} | ${data.byteLength} | ${gzip} |`);
}
for (const name of initial) {
  if (!found.has(name)) throw new Error(`Missing initial build asset: ${name}`);
}
for (const name of [
  "codec/libjpeg-coefficients.js",
  "codec/libjpeg-coefficients.wasm",
]) {
  if (!found.has(name)) throw new Error(`Missing lazy codec asset: ${name}`);
}
console.log(
  `| Initial total | | ${totals.initial.raw} | ${totals.initial.gzip} |`,
);
console.log(
  `| Deferred total | | ${totals.deferred.raw} | ${totals.deferred.gzip} |`,
);
console.log(
  `| All static files | | ${totals.initial.raw + totals.deferred.raw} | ${totals.initial.gzip + totals.deferred.gzip} |`,
);
