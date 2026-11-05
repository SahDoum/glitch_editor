import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageRoot = resolve(
  root,
  "node_modules/@ai-ecoverse/wasm-libjpeg-turbo",
);
const compiler = process.env.EMCC || "emcc";
const outputDirectory = resolve(root, "public/codec");
const output = resolve(outputDirectory, "libjpeg-coefficients.js");
const source = resolve(root, "src/jpeg/codec/coefficient-bridge.c");
const include = resolve(packageRoot, "include");
const library = resolve(packageRoot, "lib/libjpeg.a");

if (!existsSync(library) || !existsSync(resolve(include, "jpeglib.h"))) {
  console.error(
    "The pinned libjpeg-turbo WASM build library is missing. Run npm ci first.",
  );
  process.exitCode = 1;
} else {
  mkdirSync(outputDirectory, { recursive: true });
  const result = spawnSync(
    compiler,
    [
      source,
      `-I${include}`,
      library,
      "-O2",
      "--no-entry",
      "-sMODULARIZE=1",
      "-sEXPORT_ES6=1",
      "-sEXPORT_NAME=createLibjpegCoefficients",
      "-sENVIRONMENT=web,worker",
      "-sFILESYSTEM=0",
      "-sASSERTIONS=1",
      "-sEXPORTED_RUNTIME_METHODS=HEAPU8",
      "-sALLOW_MEMORY_GROWTH=1",
      "-sINITIAL_MEMORY=67108864",
      "-sMAXIMUM_MEMORY=536870912",
      "-sSTACK_SIZE=1048576",
      "-sEXPORTED_FUNCTIONS=_malloc,_free,_coefficient_open,_coefficient_read_block,_coefficient_apply,_coefficient_repeat_block,_coefficient_permute_blocks,_coefficient_set_quantization,_coefficient_encode,_coefficient_output_pointer,_coefficient_output_size,_coefficient_close",
      "-o",
      output,
    ],
    { cwd: root, stdio: "inherit" },
  );

  if (result.error) {
    console.error(
      `Could not run ${compiler}. Install Emscripten 4.0.23 or set EMCC to its compiler path.`,
    );
    process.exitCode = 1;
  } else if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}
