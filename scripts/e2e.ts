import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const out=resolve(process.env.TEST_OUTPUT_DIR||'.test-output');await mkdir(out,{recursive:true});
const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg';const ffprobe=process.env.FFPROBE_PATH||'ffprobe';
async function command(args:string[]) {const p=Bun.spawn(args,{stdout:'pipe',stderr:'pipe'});const stdout=await new Response(p.stdout).text();const stderr=await new Response(p.stderr).text();if(await p.exited!==0)throw new Error(`${args[0]} failed: ${stderr}`);return stdout;}
for(const [name,color,duration,size,rate,audio] of [['clip1','#145744',2,'640x360',30,true],['clip2','#d2df8a',3,'640x360',30,true],['silent','#b1744c',1,'320x240',24,false]] as const){await command([ffmpeg,'-v','error','-y','-f','lavfi','-i',`color=c=${color}:s=${size}:r=${rate}:d=${duration}`,...(audio?['-f','lavfi','-i',`sine=frequency=${name==='clip1'?440:660}:sample_rate=48000:duration=${duration}`]:[]),'-c:v','libx264','-pix_fmt','yuv420p',...(audio?['-c:a','aac','-ar','48000','-ac','2','-shortest']:['-an']),join(out,`${name}.mp4`)]);}
// Chrome's native download stack bypasses Playwright route interception. Use an isolated TLS fixture server instead.
await Bun.write(join(out,'fixture.openssl.cnf'),'[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=ssuin-object.commonscdn.com\n[v3]\nsubjectAltName=DNS:ssuin-object.commonscdn.com\n');
await command(['/usr/bin/openssl','req','-config',join(out,'fixture.openssl.cnf'),'-x509','-newkey','rsa:2048','-nodes','-keyout',join(out,'fixture.key'),'-out',join(out,'fixture.crt'),'-days','1','-subj','/CN=ssuin-object.commonscdn.com']);
const mediaServer=Bun.serve({hostname:'127.0.0.1',port:0,tls:{key:Bun.file(join(out,'fixture.key')),cert:Bun.file(join(out,'fixture.crt'))},fetch(req){const name=new URL(req.url).pathname.split('/').at(-1);if(!['clip1.mp4','clip2.mp4'].includes(name||''))return new Response('not found',{status:404});return new Response(Bun.file(join(out,name!)),{headers:{'Content-Type':'video/mp4'}});}});
const extension=resolve('dist');
const context=await chromium.launchPersistentContext(join(out,`profile-${Date.now()}`),{channel:'chromium',headless:true,ignoreHTTPSErrors:true,acceptDownloads:true,downloadsPath:join(out,'downloads'),args:[`--host-resolver-rules=MAP ssuin-object.commonscdn.com 127.0.0.1:${mediaServer.port}`,'--ignore-certificate-errors',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
const results:Record<string,unknown>[]=[];const errors:string[]=[];
try {
  let [worker]=context.serviceWorkers();worker??=await context.waitForEvent('serviceworker',{timeout:30_000});
  const id=new URL(worker.url()).host;
  console.log(`Loaded extension ${id}`);
  const studio=await context.newPage();studio.on('pageerror',error=>errors.push(error.message));
  await studio.goto(`chrome-extension://${id}/studio.html`);
  await expect(studio.locator('header h1')).toHaveText('learningx-downloader');
  await expect(studio.locator('h1')).toHaveCount(1);await expect(studio.locator('.page-heading,.wordmark')).toHaveCount(0);
  const titleBox=await studio.locator('header h1').boundingBox();const historyBox=await studio.locator('#open-history').boundingBox();const helpBox=await studio.locator('#open-help').boundingBox();if(!titleBox||titleBox.y>80||!historyBox||!helpBox||historyBox.x>=helpBox.x)throw new Error('Header layout incorrect');
  await expect(studio.locator('header h1')).toHaveCSS('font-size','30px');results.push({test:'single-header-title-and-action-order',passed:true});
  await expect(studio.locator('.rail,.eyebrow,.engine-badge,.badge')).toHaveCount(0);
  await expect(studio.locator('.dropzone')).toHaveCSS('border-top-style','dashed');
  await expect(studio.locator('.settings')).toHaveCSS('background-color','rgb(249, 250, 251)');
  await expect(studio.locator('#merge-mode')).toHaveCSS('padding-right','48px');
  await expect(studio.locator('.output-options')).toHaveJSProperty('tagName','FIELDSET');
  await expect(studio.locator('#history-dialog')).not.toBeVisible();await expect(studio.locator('#history-section')).toHaveCount(0);
  await studio.getByRole('radio',{name:'각각 저장',exact:true}).check();
  await expect(studio.locator('#start')).toHaveText('다운로드');
  await studio.getByRole('radio',{name:'각각 저장',exact:true}).press('ArrowLeft');
  await expect(studio.getByRole('radio',{name:'하나로 합치기',exact:true})).toBeChecked();
  results.push({test:'storage-radio-and-layout',passed:true});
  await studio.locator('#open-help').click();
  await expect(studio.getByRole('dialog',{name:'사용법',exact:true})).toBeVisible();
  await expect(studio.locator('#close-help')).toBeFocused();
  await studio.screenshot({path:join(out,'studio-help.png'),fullPage:false});
  await studio.keyboard.press('Escape');await expect(studio.locator('#help-dialog')).not.toBeVisible();
  await expect(studio.locator('#open-help')).toBeFocused();
  await studio.locator('#open-help').click();await studio.locator('#close-help').click();await expect(studio.locator('#help-dialog')).not.toBeVisible();
  await studio.locator('#open-help').click();await studio.mouse.click(8,8);await expect(studio.locator('#help-dialog')).not.toBeVisible();
  results.push({test:'help-modal-focus-escape-and-backdrop',passed:true});
  await studio.locator('#open-history').click();await expect(studio.getByRole('dialog',{name:'최근 다운로드',exact:true})).toBeVisible();await expect(studio.locator('#close-history')).toBeFocused();await expect(studio.locator('#history')).toContainText('아직 다운로드한 파일이 없어요.');await expect(studio.locator('#clear-history')).toBeHidden();
  await studio.keyboard.press('Escape');await expect(studio.locator('#history-dialog')).not.toBeVisible();await expect(studio.locator('#open-history')).toBeFocused();
  await studio.locator('#open-history').click();await studio.locator('#close-history').click();await expect(studio.locator('#history-dialog')).not.toBeVisible();
  await studio.locator('#open-history').click();await studio.mouse.click(8,8);await expect(studio.locator('#history-dialog')).not.toBeVisible();results.push({test:'history-modal-focus-escape-backdrop-and-empty-state',passed:true});
  await studio.screenshot({path:join(out,'studio-minimal.png'),fullPage:true});
  async function clear(){await studio.locator('#clear').click();}
  async function files(paths:string[]){await studio.locator('#tab-files').click();await studio.locator('#files').setInputFiles(paths);}
  async function waitJob(expected:string,timeout=90_000){await studio.waitForFunction(expected=>{const value=document.querySelector('#job-phase')?.textContent;return value===expected||(value==='작업 실패'&&expected!=='작업 실패');},expected,{timeout});if(await studio.locator('#job-phase').textContent()!==expected)throw new Error((await studio.locator('#job-detail').textContent())+'\n'+(await studio.locator('#logs').textContent()));}
  async function exportAndProbe(name:string,seconds:number){
    await studio.locator('#save-result').click();
    await studio.waitForFunction(async()=>{const {history=[]}=await chrome.storage.local.get('history');const h=(history as {downloadId:number}[])[0];if(!h)return false;const [d]=await chrome.downloads.search({id:h.downloadId});return d?.state==='complete';},undefined,{timeout:30_000});
    const path=await studio.evaluate(async()=>{const {history}=await chrome.storage.local.get('history');const h=(history as {downloadId:number}[])[0];const [d]=await chrome.downloads.search({id:h.downloadId});return d.filename;});
    const meta=JSON.parse(await command([ffprobe,'-v','error','-show_entries','format=duration,size:stream=codec_type,width,height','-of','json',path]));
    if(Math.abs(Number(meta.format.duration)-seconds)>0.4)throw new Error(`${name}: duration mismatch ${meta.format.duration}`);
    if(!meta.streams.some((s:{codec_type:string})=>s.codec_type==='audio'))throw new Error(`${name}: audio missing`);
    await command([ffmpeg,'-v','error','-xerror','-i',path,'-f','null','-']);
    await expect(studio.locator('#history-dialog')).not.toBeVisible();await studio.locator('#open-history').click();await expect(studio.locator('#history-dialog')).toBeVisible();await expect(studio.locator('.history-row').first()).toContainText('저장 완료');await studio.screenshot({path:join(out,'studio-history-'+name+'.png'),fullPage:false});await studio.locator('#close-history').click();
    results.push({test:name,passed:true,path,meta});return path;
  }
  await files([join(out,'clip1.mp4'),join(out,'clip2.mp4')]);
  await studio.locator('#output-name').fill('로컬 무손실 병합');await studio.locator('#start').click();await waitJob('완료');
  await exportAndProbe('local-copy',5);
  await studio.locator('#preview').evaluate(async(v:HTMLVideoElement)=>{v.muted=true;await v.play();});
  await studio.waitForTimeout(500);const played=await studio.locator('#preview').evaluate((v:HTMLVideoElement)=>{v.pause();return v.currentTime>0;});if(!played)throw new Error('Preview did not play');
  await studio.screenshot({path:join(out,'studio-copy.png'),fullPage:true});
  await studio.setViewportSize({width:390,height:844});await studio.screenshot({path:join(out,'studio-mobile.png'),fullPage:true});await studio.locator('#open-help').click();await studio.screenshot({path:join(out,'studio-help-mobile.png'),fullPage:false});await studio.keyboard.press('Escape');await studio.locator('#open-history').click();await studio.screenshot({path:join(out,'studio-history-mobile.png'),fullPage:false});await studio.keyboard.press('Escape');const overflow=await studio.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(overflow)throw new Error('Mobile horizontal overflow');await studio.setViewportSize({width:1280,height:720});
  await clear();await files([join(out,'clip1.mp4'),join(out,'silent.mp4')]);await studio.locator('#start').click();await waitJob('작업 실패');await expect(studio.locator('#job-detail')).toContainText('호환 모드');results.push({test:'incompatible-copy-rejected',passed:true});
  await studio.locator('#merge-mode').selectOption('normalize');await studio.locator('#output-name').fill('호환 모드 병합');await studio.locator('#start').click();await waitJob('완료',180_000);await exportAndProbe('normalize-with-silent-input',3);
  // Cancellation must kill the wasm worker and leave the UI reusable.
  await studio.locator('#start').click();await studio.locator('#cancel').click();await waitJob('취소됨');results.push({test:'cancel',passed:true});await studio.locator('#merge-mode').selectOption('copy');
  await context.route('https://canvas.ssu.ac.kr/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/learningx/api/v1/courses/123/modules')return route.fulfill({json:[{module_items:[456,457,458].map((module_item_id,index)=>({module_item_id,content_type:'attendance_item',content_id:111+index,content_data:{item_content_type:'commons',item_content_data:{content_type:'movie'}}}))}]});
    if(url.pathname==='/courses/123/external_tools/71')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<html><head><meta charset="UTF-8"><title>LMS 원클릭 통합 테스트</title><style>body{font-family:system-ui;padding:36px;background:#f7f8f4;color:#203b30}iframe{width:100%;height:360px;border:1px solid #dfe6de;border-radius:12px;background:white}a{color:#145744}h1{font-size:28px}</style></head><body><h1>LMS 원클릭 통합 테스트</h1><p>실제 학교 화면이 아닌 테스트용 LearningX 모의 페이지입니다.</p><a href="/courses/123">테스트 과목</a><iframe title="도구 내용" src="/learningx/lti/modulebuilder"></iframe></body></html>'});
    if(url.pathname==='/learningx/lti/modulebuilder')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<html><head><meta charset="UTF-8"><style>body{font-family:system-ui;padding:24px}ul{list-style:none;padding:0}li{padding:20px;border-bottom:1px solid #e5e7eb}a{color:#203b30;text-decoration:none;font-weight:600}</style></head><body><h2>5주차 학습</h2><ul><li>5주차 <a href="/courses/123/modules/items/456">테스트 조각 강의</a></li><li>5주차 <a href="/courses/123/modules/items/457">열람 종료 강의</a></li><li>5주차 <a href="/courses/123/modules/items/458">단일 MP4 강의</a></li></ul></body></html>'});
    if(url.pathname.match(/^\/courses\/123\/modules\/items\/(456|457|458)$/))return route.fulfill({contentType:'text/html; charset=utf-8',body:`<iframe src="/learningx/lti/lecture_attendance/items/view/${url.pathname.endsWith('456')?'111':url.pathname.endsWith('457')?'112':'113'}"></iframe>`});
    if(url.pathname.match(/^\/learningx\/api\/v1\/courses\/123\/attendance_items\/(111|112|113)$/)) {
      if(route.request().headers().authorization!=='Bearer synthetic-test-session')throw new Error('Missing local session authorization');
      return route.fulfill({json:{course_id:123,item_content_type:'commons',title:url.pathname.endsWith('111')?'테스트 조각 강의':url.pathname.endsWith('112')?'열람 종료 강의':'단일 MP4 강의',published:true,lecture_period_status:url.pathname.endsWith('112')?'closed':'open',week_position:5,item_content_data:{content_type:'movie',content_id:url.pathname.endsWith('111')?'test123':url.pathname.endsWith('112')?'not_open':'testsingle',duration:5}}});
    }
    return route.fulfill({status:404,body:'not found'});
  });
  await context.addCookies([{name:'xn_api_token',value:'synthetic-test-session',domain:'canvas.ssu.ac.kr',path:'/',secure:true}]);
  await context.route('https://commons.ssu.ac.kr/**',async route=>{
    const url=new URL(route.request().url());if(!url.pathname.includes('content.php'))return route.fulfill({status:404});
    const contentId=url.searchParams.get('content_id');
    if(contentId==='testsingle')return route.fulfill({contentType:'application/xml',body:'<content><content_metadata><title>단일 MP4 강의</title></content_metadata><content_playing_info><content_id>testsingle</content_id><main_media><media_uri>https://ssuin-object.commonscdn.com/test/clip1.mp4</media_uri></main_media></content_playing_info></content>'});
    return route.fulfill({contentType:'application/xml',body:`<content><content_metadata><title>테스트 조각 강의</title></content_metadata><content_playing_info><content_id>${contentId}</content_id><story_list><story><main_media_list><main_media>clip1.mp4</main_media></main_media_list></story><story><main_media_list><main_media>clip2.mp4</main_media></main_media_list></story></story_list></content_playing_info><service_root><media><media_uri method="progressive" target="all">https://ssuin-object.commonscdn.com/test/[MEDIA_FILE]</media_uri></media></service_root></content>`});
  });
  await context.route('https://ssuin-object.commonscdn.com/test/**',async route=>route.fulfill({contentType:'video/mp4',body:await readFile(join(out,new URL(route.request().url()).pathname.split('/').at(-1)!))}));
  const source=await context.newPage();await source.goto('https://canvas.ssu.ac.kr/courses/123/external_tools/71');
  const frame=source.frameLocator('iframe');await expect(frame.getByRole('button',{name:'다운로드',exact:true})).toHaveCount(3);
  await studio.close();const pageCount=context.pages().length;
  async function buttonSaved(module:string,name:string,seconds:number){
    await frame.locator('[data-lx-download="'+module+'"]').click();
    await expect(frame.locator('[data-lx-download="'+module+'"]')).toHaveText('저장 완료',{timeout:90_000});
    if(context.pages().length!==pageCount)throw new Error('One-click download unexpectedly opened a Studio page');
    const job=await worker.evaluate(async(module)=>{const {buttonJobs=[]}=await chrome.storage.local.get('buttonJobs');return (buttonJobs as any[]).find(j=>j.lecture.moduleUrl.endsWith('/'+module));},module);
    if(job.state!=='complete')throw new Error('Button did not reach complete');
    const path=await worker.evaluate(async(id)=>{const [d]=await chrome.downloads.search({id});return d.filename;},job.downloadId);
    const meta=JSON.parse(await command([ffprobe,'-v','error','-show_entries','format=duration,size:stream=codec_type','-of','json',path]));
    if(Math.abs(Number(meta.format.duration)-seconds)>0.4||!meta.streams.some((s:any)=>s.codec_type==='audio'))throw new Error('Direct download media verification failed');
    await command([ffmpeg,'-v','error','-xerror','-i',path,'-f','null','-']);results.push({test:name,passed:true,path,meta});
  }
  await buttonSaved('458','lms-one-click-single-mp4-no-studio',2);
  await buttonSaved('456','lms-one-click-offscreen-segment-merge-no-studio',5);
  const downloadsBefore=await worker.evaluate(async()=> (await chrome.downloads.search({})).length);
  await frame.locator('[data-lx-download="457"]').click();await expect(frame.locator('[data-lx-download="457"]')).toHaveText('다시 시도');await expect(frame.locator('[data-lx-download="457"]')).toHaveAttribute('title',/열람이 허용되지/);
  const downloadsAfter=await worker.evaluate(async()=> (await chrome.downloads.search({})).length);if(downloadsAfter!==downloadsBefore)throw new Error('Closed lecture downloaded');results.push({test:'closed-lecture-rejected',passed:true});
  await source.screenshot({path:join(out,'lms-one-click.png'),fullPage:true});
  const advanced=await context.newPage();await advanced.goto('chrome-extension://'+id+'/studio.html');await advanced.locator('#clear').click();await advanced.locator('#tab-links').click();await advanced.locator('#links').fill('https://evil.com/em/x');await advanced.locator('#add-links').click();await expect(advanced.locator('.queue-row')).toHaveCount(0);results.push({test:'untrusted-link-rejected',passed:true});
  await advanced.locator('#open-history').click();await expect(advanced.locator('#history-dialog')).toBeVisible();await advanced.locator('#clear-history').click();await expect(advanced.locator('#history')).toContainText('아직 다운로드한 파일이 없어요.');await expect(advanced.locator('#clear-history')).toBeHidden();await advanced.locator('#close-history').click();results.push({test:'history-dialog-and-clear',passed:true});
  if(errors.length)throw new Error(`Browser errors: ${errors.join(' | ')}`);
  await Bun.write(join(out,'results.json'),JSON.stringify({passed:true,results,errors},null,2));console.log(JSON.stringify({passed:true,tests:results.map(r=>r.test),out},null,2));
} catch(error){await Bun.write(join(out,'results.json'),JSON.stringify({passed:false,results,errors,error:String(error)},null,2));for(const p of context.pages())try{if(p.url().includes('/studio.html'))await p.screenshot({path:join(out,'failure.png'),fullPage:true});}catch{}throw error;}finally{await context.close();mediaServer.stop();}
