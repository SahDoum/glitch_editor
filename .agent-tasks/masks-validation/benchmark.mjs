import { createServer } from 'vite';
import { performance } from 'node:perf_hooks';
const server = await createServer({ server: { middlewareMode: true } });
try {
  const { getMaskBlockCoverage } = await server.ssrLoadModule('/src/jpeg/block-geometry.ts');
  const geometry = { width: 4000, height: 3000, components: [{ id: 1, horizontalSampling: 1, verticalSampling: 1, quantizationTable: 0 }] };
  const mask = { schemaVersion: 1, id: 'benchmark', width: 4000, height: 3000, shapes: [{ kind: 'rectangle', mode: 'add', x: 100, y: 100, width: 320, height: 240 }] };
  const reference = () => {
    const selected = new Uint8Array(500 * 375);
    const { x, y, width, height } = mask.shapes[0];
    for (let by = 0; by < 375; by += 1) {
      const top = by * 8, bottom = Math.min(3000, top + 8);
      for (let bx = 0; bx < 500; bx += 1) {
        const left = bx * 8, right = Math.min(4000, left + 8);
        const overlap = Math.max(0, Math.min(right, x + width) - Math.max(left, x)) * Math.max(0, Math.min(bottom, y + height) - Math.max(top, y));
        if (overlap >= (right - left) * (bottom - top) / 2) selected[by * 500 + bx] = 1;
      }
    }
    return selected;
  };
  const optimized = () => getMaskBlockCoverage(mask, geometry, 1, 'at-least-half').value;
  const expected = reference(), actual = optimized();
  if (expected.some((v, i) => v !== actual[i])) throw new Error('coverage mismatch');
  const measure = fn => { for (let i = 0; i < 100; i++) fn(); const times = []; for (let i = 0; i < 1000; i++) { const start = performance.now(); fn(); times.push(performance.now() - start); } return times.sort((a,b) => a-b)[500]; };
  console.log(JSON.stringify({ image:'4000x3000 grayscale', mask:'320x240', iterations:1000, referenceMedianMs:measure(reference), optimizedMedianMs:measure(optimized), note:'Full-grid reference uses one output buffer; previous production also allocated an intersection buffer.' }, null, 2));
} finally { await server.close(); }
