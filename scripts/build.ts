import { mkdir, rm, cp } from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
await cp('public','dist',{recursive:true});
for(const [entrypoints,format] of [[['src/studio.ts','src/background.ts','src/offscreen.ts'],'esm'],[['src/content.ts'],'iife']] as const){
  const result=await Bun.build({entrypoints:[...entrypoints],outdir:'dist',target:'browser',format,splitting:format==='esm',minify:true,naming:{entry:'[name].[ext]',chunk:'assets/[name]-[hash].[ext]',asset:'assets/[name]-[hash].[ext]'}});
  if(!result.success)throw new AggregateError(result.logs,'Build failed');
  for(const output of result.outputs)console.log(`${output.path} (${(output.size/1024).toFixed(1)} KB)`);
}
const css=[...new Bun.Glob('**/*.css').scanSync('dist')];
let html=await Bun.file('studio.html').text();html=html.replace('</head>',css.map(name=>`<link rel="stylesheet" href="./${name}">`).join('')+'</head>').replace('/src/studio.ts','./studio.js');
await Bun.write('dist/studio.html',html);
console.log('Built Chrome MV3 extension with Bun.');

await cp('offscreen.html','dist/offscreen.html');
