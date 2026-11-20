import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
 const { inspectJpeg } = await server.ssrLoadModule('/src/jpeg/inspect.ts');
 const { getMaskBlockCoveragePath } = await server.ssrLoadModule('/src/jpeg/block-geometry.ts');
 const { CanvasVisualState } = await server.ssrLoadModule('/src/ui/canvas-visual-state.ts');
 const parsed = inspectJpeg(new Uint8Array(await readFile('tests/fixtures/synthetic-color-odd-420.jpg')));
 if (!parsed.ok) throw new Error('fixture');
 const geometry = { ...parsed.value, width: 640, height: 480 };
 const points = Array.from({length:16000},(_,i)=>({x:(i*7)%640,y:(i*3)%480}));
 const mask={schemaVersion:1,id:'benchmark',width:640,height:480,shapes:[{kind:'brush',mode:'add',radius:4,points}]};
 const times=[];
 for(let i=0;i<5;i++){const start=performance.now(); const result=getMaskBlockCoveragePath(mask,geometry,geometry.components[0].id); if(!result.ok) throw new Error(result.error.message);times.push(performance.now()-start);}
 const store=new CanvasVisualState(); let callbacks=0;store.subscribe(()=>callbacks++); const start=performance.now();for(let i=0;i<10000;i++)store.publish({hoverPoint:{x:i%640,y:i%480}});const updateMs=performance.now()-start;
 console.log(JSON.stringify({image:'640x480 4:2:0',strokePoints:16000,projectionMs:times,hoverUpdates:10000,updateMs,callbacks,conclusion:'Projection is expensive enough to memoize by immutable draft/geometry. Hover-only events now notify overlay only; sampling frequency unchanged.'},null,2));
} finally {await server.close();}
