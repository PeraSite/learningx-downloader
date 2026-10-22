import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
await mkdir('public/ffmpeg',{recursive:true});
for(const name of ['ffmpeg-core.js','ffmpeg-core.wasm']) await cp(`node_modules/@ffmpeg/core/dist/esm/${name}`,`public/ffmpeg/${name}`);
for(const name of ['worker.js','const.js','errors.js']) await cp(`node_modules/@ffmpeg/ffmpeg/dist/esm/${name}`,`public/ffmpeg/${name}`);
function crc32(data:Uint8Array){let c=0xffffffff;for(const b of data){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer){const t=Buffer.from(type);const size=Buffer.alloc(4);size.writeUInt32BE(data.length);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([size,t,data,crc]);}
await mkdir('public/icons',{recursive:true});
for(const n of [16,48,128]){
  const raw=Buffer.alloc((n*4+1)*n);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const px=x/n,py=y/n;const i=y*(n*4+1)+1+x*4;
    const white=(px>.30&&px<.41&&py>.27&&py<.73)||(px>.49&&px<.70&&py>.27&&py<.39)||(px>.49&&px<.70&&py>.45&&py<.56)||(px>.49&&px<.70&&py>.62&&py<.73);
    raw[i]=white?255:49;raw[i+1]=white?255:130;raw[i+2]=white?255:246;raw[i+3]=255;
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(n,0);header.writeUInt32BE(n,4);header[8]=8;header[9]=6;
  await writeFile(`public/icons/${n}.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
await cp('manifest.json','public/manifest.json');
for(const file of ['README.md','THIRD_PARTY_NOTICES.md'])try{await cp(file,`public/${file}`);}catch{}
console.log('Packaged local ffmpeg core, worker, manifest and icons.');
