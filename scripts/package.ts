import {mkdir,cp,rm} from 'node:fs/promises';
const manifest=await Bun.file('manifest.json').json();
await mkdir('release',{recursive:true});
for(const name of ['README.md','THIRD_PARTY_NOTICES.md','TEST_REPORT.md'])try{await cp(name,`dist/${name}`);}catch{}
const path=`release/learningx-video-extension-${manifest.version}.zip`;
await rm(path,{force:true});
const process=Bun.spawn(['zip','-qr',`../${path}`,'.'],{cwd:'dist',stdout:'inherit',stderr:'inherit'});
if(await process.exited!==0)throw new Error('ZIP creation failed');
console.log(`Unpacked extension: ${Bun.resolveSync('../dist/manifest.json',import.meta.dir)}`);
console.log(`Release: ${path} (${(Bun.file(path).size/1024/1024).toFixed(1)} MB)`);
