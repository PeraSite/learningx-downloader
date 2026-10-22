import { watch } from 'node:fs';
import { resolve } from 'node:path';
import './prepare';
async function build(){const p=Bun.spawn([process.execPath,'scripts/build.ts'],{stdout:'inherit',stderr:'inherit'});await p.exited;}
await build();
let timer: ReturnType<typeof setTimeout>;
watch('src',{recursive:true},()=>{clearTimeout(timer);timer=setTimeout(()=>void build(),300);});
const server=Bun.serve({hostname:'127.0.0.1',port:4173,async fetch(req){const url=new URL(req.url);const path=url.pathname==='/'?'/studio.html':decodeURIComponent(url.pathname);const filePath=resolve(`dist${path}`);if(!filePath.startsWith(resolve('dist')+'/'))return new Response('Not found',{status:404});const file=Bun.file(filePath);if(!await file.exists())return new Response('Not found',{status:404});return new Response(file);}});
console.log(`Preview: http://127.0.0.1:${server.port}/studio.html`);
