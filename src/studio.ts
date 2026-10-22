import './style.css';
import { normalizeCommonsUrl, resolveCommons } from './commons';
import { mergeVideos, type InputVideo } from './merger';
import { assertMergeSize } from './limits';
import { fetchMedia, chooseDownloadUrl } from './network';
import { safeName, bytes, duration, isExtension, downloadPath, message } from './utils';
import type { Lecture, ResolvedLecture, HistoryEntry, JobProgress, MergeMode } from './types';
interface QueueItem { id: string; title: string; lecture?: Lecture; file?: File; resolved?: ResolvedLecture; error?: string }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
document.querySelector('#app')!.innerHTML = `
  <main>
    <header class="topbar"><h1>LearningX 영상 다운로더</h1><div class="header-actions"><button id="open-history" class="help-button" aria-haspopup="dialog" aria-controls="history-dialog">최근 다운로드</button><button id="open-help" class="help-button" aria-haspopup="dialog" aria-controls="help-dialog">사용법</button></div></header>
    <div class="workspace">
      <section class="library" aria-label="영상 목록">
        <div class="source-tabs"><button id="tab-files" class="source-tab active">파일</button><button id="tab-links" class="source-tab">Commons 링크</button></div>
        <div id="files-pane" class="import-pane"><label class="dropzone" for="files"><strong>파일 추가</strong><span>MP4, MOV, WebM 등</span><input id="files" type="file" multiple accept="video/*,.mp4,.mov,.webm,.mkv,.ts"></label></div>
        <div id="links-pane" class="import-pane hidden"><label class="sr-only" for="links">Commons 원본 링크</label><textarea id="links" rows="3" placeholder="https://commons.ssu.ac.kr/em/영상ID"></textarea><div class="input-footer"><button id="add-links" class="button">추가</button></div></div>
        <div id="queue-toolbar" class="list-toolbar hidden"><label><input id="select-all" type="checkbox" aria-label="전체 선택"> 전체 선택 <span id="queue-count"></span></label><button id="clear" class="text-button">비우기</button></div>
        <div id="queue" class="queue"></div><p id="empty" class="empty"></p>
      </section>
      <aside class="settings" aria-label="저장 설정">
        <label class="field-label" for="output-name">파일 이름</label><div class="file-name"><input id="output-name" value="합친 영상" maxlength="100"><span>.mp4</span></div>
        <label class="field-label" for="merge-mode">병합 방식</label><select id="merge-mode"><option value="copy">원본 화질 유지</option><option value="normalize">호환 모드 · 720p</option></select>
        <fieldset class="output-options"><legend class="field-label">저장 방식</legend><div class="mode-options"><label class="mode-option"><input type="radio" name="output" value="combined" checked><span>하나로 합치기</span></label><label class="mode-option"><input type="radio" name="output" value="separate"><span>각각 저장</span></label></div></fieldset>
        <div class="summary"><span>선택한 영상</span><strong id="selected-count">0개</strong><span>용량</span><strong id="selected-size">0 B</strong></div>
        <button id="start" class="button primary" disabled>합치기</button><button id="cancel" class="button subtle hidden">취소</button>
      </aside>
    </div>
    <section id="job" class="job hidden" aria-live="polite"><div class="job-heading"><h2 id="job-phase">준비 중</h2><span id="job-percent"></span></div><p id="job-detail"></p><progress id="progress" max="100"></progress><details><summary>처리 로그</summary><pre id="logs"></pre></details></section>
    <section id="result" class="result hidden"><div class="section-head"><div><h2>미리보기</h2><p id="result-meta"></p></div><button id="save-result" class="button primary">MP4 저장</button></div><video id="preview" controls playsinline preload="metadata"></video></section>
  </main>
  <dialog id="history-dialog" aria-labelledby="history-title"><div class="dialog-heading"><h2 id="history-title">최근 다운로드</h2><div class="dialog-actions"><button id="clear-history" class="text-button hidden">기록 지우기</button><button id="close-history" class="dialog-close" aria-label="최근 다운로드 닫기" autofocus>×</button></div></div><div id="history" aria-live="polite"></div></dialog>
  <dialog id="help-dialog" aria-labelledby="help-title">
    <div class="dialog-heading"><h2 id="help-title">사용법</h2><button id="close-help" class="dialog-close" aria-label="사용법 닫기" autofocus>×</button></div>
    <div class="dialog-content">
      <section><h3>LMS에서 바로 저장</h3><p>강의 옆 다운로드 버튼을 누르세요. 조각 영상은 자동으로 합쳐 저장해요. 처리 중 다시 누르면 취소할 수 있어요.</p><p id="source-note" class="context-note"></p><button id="scan" class="text-button">LMS 목록 다시 확인</button></section>
      <section><h3>여러 영상 합치기</h3><p>파일이나 Commons 링크를 추가하고, 목록의 화살표로 순서를 바꾼 뒤 합치기를 누르세요.</p><p id="mode-description">원본 유지 모드는 같은 형식끼리 빠르게 합쳐요. 형식이 다르면 호환 모드를 선택해 주세요.</p></section>
      <section><h3>지원 범위</h3><p>입력 합계 512 MiB까지, 호환 모드는 10분·128 MiB까지 지원해요. 이 화면에서 시작한 병합은 탭을 닫으면 중단돼요.</p><p>영상은 이 기기에서 처리해요. 저장이 허용된 콘텐츠만 사용해 주세요.</p></section>
    </div>
  </dialog>
  <div id="toast" role="status" class="toast hidden"></div>`;
let queue: QueueItem[]=[];
let selected=new Set<string>();
let controller: AbortController | undefined;
let resultUrl: string | undefined;
let resultName='';
let resultBlob: Blob | undefined;
let history: HistoryEntry[]=[];
const downloadUrls=new Map<number,string>();
let sourceTabId: number | undefined;
let requestedSelection: string | undefined;
let runToken=0;
let toastTimer: ReturnType<typeof setTimeout>;
function toast(text: string) { $('toast').textContent=text;$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),6500); }
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className='', text='') { const el=document.createElement(tag);el.className=className;el.textContent=text;return el; }
function updateSelection() {
  const chosen=queue.filter(q=>selected.has(q.id));
  $('selected-count').textContent=`${chosen.length}개`;
  const localSize=chosen.reduce((s,q)=>s+(q.file?.size||0),0);$('selected-size').textContent=chosen.some(q=>!q.file)?localSize?bytes(localSize)+' + 확인 전':'확인 전':bytes(localSize);
  const start=$<HTMLButtonElement>('start');start.disabled=!!controller || !chosen.length;
  start.textContent=outputMode()==='combined'?(resultUrl?'다시 합치기':'합치기'):'다운로드';start.classList.toggle('primary',!resultUrl);
  const all=$<HTMLInputElement>('select-all');all.checked=!!queue.length&&chosen.length===queue.length;all.indeterminate=!!chosen.length&&chosen.length!==queue.length;
}
function renderQueue() {
  $('queue-count').textContent=String(queue.length);$('queue-toolbar').classList.toggle('hidden',!queue.length);$('empty').classList.toggle('hidden',!!queue.length);$('queue').replaceChildren();
  queue.forEach((item,index)=>{
    const row=element('div','queue-row');
    const check=element('input');check.type='checkbox';check.checked=selected.has(item.id);check.setAttribute('aria-label',`${item.title} 선택`);check.disabled=!!controller;
    check.onchange=()=>{check.checked?selected.add(item.id):selected.delete(item.id);updateSelection();};
    const number=element('span','order-number',String(index+1).padStart(2,'0'));
    const info=element('div','video-info');info.append(element('strong','video-title',item.title));
    const label=item.error?item.error:item.file?`${bytes(item.file.size)} · 내 파일`:item.resolved?`${item.resolved.parts.length}개 미디어 조각 · ${duration(item.lecture?.duration)||'원본 확인 완료'}`:[item.lecture?.courseTitle,item.lecture?.week,'원본 확인 전'].filter(Boolean).join(' · ');
    info.append(element('span',item.error?'video-meta error':'video-meta',label));
    const actions=element('div','row-actions');
    for(const [text,delta] of [['↑',-1],['↓',1]] as const) {
      const button=element('button','icon-button',text);button.disabled=!!controller||index+delta<0||index+delta>=queue.length;button.setAttribute('aria-label',`${item.title} ${delta<0?'위로':'아래로'}`);
      button.onclick=()=>{[queue[index],queue[index+delta]]=[queue[index+delta],queue[index]];renderQueue();};actions.append(button);
    }
    const remove=element('button','icon-button remove','×');remove.setAttribute('aria-label',`${item.title} 삭제`);remove.disabled=!!controller;remove.onclick=()=>{queue=queue.filter(q=>q.id!==item.id);selected.delete(item.id);renderQueue();};actions.append(remove);
    row.append(check,number,info,actions);$('queue').append(row);
  });updateSelection();
}
function addItems(items: QueueItem[], selectNew=true) {
  for(const item of items) { const existing=queue.find(q=>q.id===item.id);if(existing){existing.lecture={...existing.lecture,...item.lecture} as Lecture;if(item.lecture?.moduleUrl)existing.resolved=undefined;continue;}queue.push(item);if(selectNew)selected.add(item.id); }
  if(requestedSelection&&queue.some(q=>q.id===requestedSelection)){selected.add(requestedSelection);requestedSelection=undefined;}
  renderQueue();
}
function outputMode() { return (document.querySelector('input[name="output"]:checked') as HTMLInputElement).value; }
function progress(p: JobProgress) {
  if(p.phase==='완료'&&resultUrl){$('job-phase').textContent=p.phase;$('job').classList.add('hidden');return;}
  $('job').classList.remove('hidden');$('job-phase').textContent=p.phase;
  $('job-detail').textContent=p.detail+(p.loaded!==undefined?` · ${bytes(p.loaded)}${p.total?' / '+bytes(p.total):''}`:'');
  const bar=$<HTMLProgressElement>('progress');
  if(p.percent===undefined){bar.removeAttribute('value');$('job-percent').textContent='';}else{bar.value=p.percent;$('job-percent').textContent=`${Math.floor(p.percent)}%`;}
}
function log(text: string) { const pre=$('logs');pre.textContent=(pre.textContent+'\n'+text).split('\n').slice(-100).join('\n'); }
async function resolveItem(item: QueueItem, signal: AbortSignal): Promise<ResolvedLecture> {
  signal.throwIfAborted();if(item.resolved&&!item.lecture?.moduleUrl)return item.resolved;
  let lecture=item.lecture!;
  if(!lecture.sourceUrl || lecture.moduleUrl) {
    if(!isExtension||!lecture.tabId)throw new Error('학교 강의 탭을 열고 다시 찾아 주세요.');
    const requestId=crypto.randomUUID();const options=lecture.documentId?{documentId:lecture.documentId}:{frameId:lecture.frameId??0};
    const response=await new Promise<any>((resolve,reject)=>{const abort=()=>{void chrome.tabs.sendMessage(lecture.tabId!,{type:'LX_CANCEL_RESOLVE',requestId},options).catch(()=>{});reject(new DOMException('작업을 취소했습니다.','AbortError'));};signal.addEventListener('abort',abort,{once:true});chrome.tabs.sendMessage(lecture.tabId!,{type:'LX_RESOLVE_LECTURE',lecture,requestId},options).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
    if(!response?.ok)throw new Error(response?.error||'강의 정보를 읽지 못했습니다. 주차학습 탭을 새로고침해 주세요.');
    lecture=response.result;item.lecture=lecture;
  }
  signal.throwIfAborted();
  const manifest=await resolveCommons(lecture.sourceUrl!,AbortSignal.any([signal,AbortSignal.timeout(30_000)]));
  signal.throwIfAborted();
  item.title=manifest.title||item.title;item.resolved={...lecture,title:item.title,sourceUrl:manifest.sourceUrl,parts:manifest.parts};renderQueue();return item.resolved!;
}
async function recordDownload(id: number,title: string,fileName: string) {
  if(isExtension){const response=await chrome.runtime.sendMessage({type:'LX_RECORD_DOWNLOAD',downloadId:id,title,fileName});if(!response?.ok)throw new Error(response?.error||'다운로드 기록 저장 실패');history=response.history;}
  renderHistory();
}
async function saveUrl(url: string,fileName: string,title: string) {
  let ownedUrl: string | undefined;
  if(url.startsWith('blob:')) { const blob=url===resultUrl&&resultBlob?resultBlob:await fetch(url).then(r=>r.blob());ownedUrl=URL.createObjectURL(blob); }
  const source=ownedUrl||url;
  if(isExtension) {
    try {const id=await chrome.downloads.download({url:source,filename:fileName,conflictAction:'uniquify',saveAs:false});if(ownedUrl)downloadUrls.set(id,ownedUrl);await recordDownload(id,title,fileName);const [download]=await chrome.downloads.search({id});if(download?.state!=='in_progress'&&ownedUrl){URL.revokeObjectURL(ownedUrl);downloadUrls.delete(id);}}
    catch(error){if(ownedUrl)URL.revokeObjectURL(ownedUrl);throw error;}
  } else {const a=document.createElement('a');a.href=source;a.download=fileName.split('/').at(-1)!;a.click();if(ownedUrl)setTimeout(()=>URL.revokeObjectURL(ownedUrl!),60_000);}
}
function showResult(blob: Blob,name: string,seconds: number,method: string,count: number) {
  if(resultUrl)URL.revokeObjectURL(resultUrl);
  resultBlob=blob;resultName=name;resultUrl=URL.createObjectURL(blob);
  $('result').classList.remove('hidden');$<HTMLVideoElement>('preview').src=resultUrl;
  $('result-meta').textContent=`${duration(seconds)} · ${bytes(blob.size)}`;
}
async function inputsFor(item: QueueItem, signal: AbortSignal, budget: {used:number}):Promise<InputVideo[]> {
  if(item.file){budget.used+=item.file.size;assertMergeSize([budget.used]);return [{name:item.file.name,blob:item.file}];}
  progress({phase:'원본 확인',detail:item.title});
  const resolved=await resolveItem(item,signal);const inputs:InputVideo[]=[];
  for(let i=0;i<resolved.parts.length;i++){const part=resolved.parts[i];const blob=await fetchMedia(part,signal,budget,p=>progress({...p,detail:`${item.title} · ${i+1}/${resolved.parts.length}`}));inputs.push({name:`${item.title} / ${part.name}`,blob});}
  return inputs;
}
function setBusy(busy:boolean){for(const id of ['scan','add-links','files','clear','select-all','merge-mode','output-name','links'])($<HTMLInputElement>(id)).disabled=busy;document.querySelectorAll<HTMLInputElement>('input[name="output"]').forEach(el=>el.disabled=busy);$<HTMLButtonElement>('save-result').disabled=busy;$('cancel').classList.toggle('hidden',!busy);renderQueue();}
async function start() {
  const chosen=queue.filter(q=>selected.has(q.id));if(!chosen.length||controller)return;
  controller=new AbortController();const currentController=controller;const token=++runToken;const signal=controller.signal;
  const mode=$<HTMLSelectElement>('merge-mode').value as MergeMode;
  $('logs').textContent='';$('result').classList.add('hidden');if(resultUrl){$<HTMLVideoElement>('preview').removeAttribute('src');URL.revokeObjectURL(resultUrl);resultUrl=undefined;resultBlob=undefined;}setBusy(true);
  chosen.forEach(q=>q.error=undefined);
  try {
    if(outputMode()==='combined') {
      const inputs:InputVideo[]=[];const budget={used:0};
      for(const item of chosen){try{inputs.push(...await inputsFor(item,signal,budget));}catch(error){item.error=message(error);throw error;}}
      const result=await mergeVideos(inputs,mode,signal,progress,log);
      showResult(result.blob,safeName($<HTMLInputElement>('output-name').value)+'.mp4',result.duration,result.method,result.inputs);
      progress({phase:'완료',detail:'병합과 재생 시간·음성 트랙 검사가 끝났습니다. 미리보기 후 MP4 저장을 눌러 주세요.',percent:100});
    } else {
      let failures=0;
      for(let index=0;index<chosen.length;index++) {
        const item=chosen[index];signal.throwIfAborted();
        try {
          progress({phase:'강의별 저장',detail:`${index+1}/${chosen.length} · ${item.title}`});
          let url:string;let temporary=false;
          if(item.file && /\.mp4$/i.test(item.file.name)){url=URL.createObjectURL(item.file);temporary=true;}
          else if(item.file){const result=await mergeVideos([{name:item.file.name,blob:item.file}],mode,signal,progress,log);showResult(result.blob,safeName(item.title)+'.mp4',result.duration,result.method,result.inputs);url=resultUrl!;}
          else {
            const resolved=await resolveItem(item,signal);
            if(resolved.parts.length===1 && /\.mp4$/i.test(resolved.parts[0].name))url=await chooseDownloadUrl(resolved.parts[0],signal);
            else {const inputs=await inputsFor(item,signal,{used:0});const result=await mergeVideos(inputs,mode,signal,progress,log);showResult(result.blob,safeName(item.title)+'.mp4',result.duration,result.method,result.inputs);url=resultUrl!;}
          }
          signal.throwIfAborted();await saveUrl(url,downloadPath(item.lecture?.courseTitle||'내 파일',item.lecture?.week||'영상',item.title),item.title);
          if(temporary)setTimeout(()=>URL.revokeObjectURL(url),60_000);
        }catch(error){if(signal.aborted)throw error;failures++;item.error=message(error);}
        renderQueue();
      }
      progress({phase:failures?'일부 실패':'다운로드 요청 완료',detail:`${chosen.length-failures}개 저장 요청 · ${failures}개 실패. 실제 완료 상태는 최근 다운로드에서 확인해 주세요.`,percent:100});
    }
  } catch(error) { progress({phase:signal.aborted?'취소됨':'작업 실패',detail:signal.aborted?'진행 중인 가져오기·병합을 중단했습니다. 이미 시작된 Chrome 다운로드는 다운로드 관리자에서 취소할 수 있습니다.':message(error)});toast(signal.aborted?'작업을 취소했어요.':message(error)); }
  finally { if(token===runToken&&controller===currentController){controller=undefined;setBusy(false);} }
}
async function refreshDetected() {
  if(!isExtension)return;
  const state=await chrome.storage.local.get(['sourceTabId','selectedLectureId','history']) as {sourceTabId?:number;selectedLectureId?:string;history?:HistoryEntry[]};sourceTabId=state.sourceTabId;requestedSelection=state.selectedLectureId;history=state.history||[];
  if(sourceTabId){const key=`lectures:${sourceTabId}`;const data=await chrome.storage.local.get(key);addItems(((data[key]||[]) as Lecture[]).map((lecture:Lecture)=>({id:lecture.id,title:lecture.title,lecture})),false);}
  $('source-note').textContent=sourceTabId?'LMS 강의 목록이 연결돼 있어요.':'연결된 LMS 탭이 없어요.';
  renderHistory();
}
async function scan() {
  if(!isExtension){toast('미리보기에서는 로컬 파일 병합을 사용할 수 있어요. 강의 감지는 확장 설치 후 가능해요.');return;}
  const tabs=await chrome.tabs.query({url:'https://canvas.ssu.ac.kr/*'});
  const tab=tabs.find(t=>t.id===sourceTabId)||tabs[0];if(!tab?.id){toast('숭실대 LearningX 주차학습 탭을 먼저 열어 주세요.');return;}
  sourceTabId=tab.id;await chrome.storage.local.set({sourceTabId});
  try {await chrome.tabs.sendMessage(tab.id,{type:'LX_SCAN'});await refreshDetected();toast('강의 목록을 새로 확인했어요. 목록에서 필요한 주차를 펼쳐 주세요.');}catch{toast('주차학습 탭을 새로고침한 다음 다시 시도해 주세요.');}
}
function renderHistory() {
  const root=$('history');root.replaceChildren();$('clear-history').classList.toggle('hidden',!history.length);
  if(!history.length){root.append(element('p','history-empty','아직 다운로드한 영상이 없어요.'));return;}
  for(const h of history) {
    const row=element('div','history-row');row.append(element('strong','',h.title));
    const label=h.state==='complete'?'저장 완료':h.state==='in_progress'?'다운로드 중':`중단: ${h.state}`;row.append(element('span','video-meta',label));
    if(isExtension){const button=element('button','text-button','폴더 열기');button.onclick=()=>chrome.downloads.show(h.downloadId);row.append(button);}root.append(row);
  }
}
$('add-links').onclick=()=>{
  if(controller)return;
  const lines=$<HTMLTextAreaElement>('links').value.split(/\s+/).filter(Boolean);if(!lines.length)return;
  const items:QueueItem[]=[];const invalid:string[]=[];
  for(const line of lines){try{const sourceUrl=normalizeCommonsUrl(line);const id=`commons:${sourceUrl}`;items.push({id,title:new URL(sourceUrl).pathname.split('/').at(-1)!,lecture:{id,title:new URL(sourceUrl).pathname.split('/').at(-1)!,sourceUrl,courseTitle:'Commons'}});}catch{invalid.push(line);}}
  addItems(items);$<HTMLTextAreaElement>('links').value=invalid.join('\n');toast(invalid.length?`${items.length}개 추가 · 지원하지 않는 링크 ${invalid.length}개를 확인해 주세요.`:`${items.length}개 링크를 추가했어요.`);
};
function addLocalFiles(files:File[]) {
  if(controller)return;
  addItems(files.map(file=>({id:`file:${crypto.randomUUID()}`,title:file.name.replace(/\.[^.]+$/,''),file})));
}
$<HTMLInputElement>('files').onchange=event=>{const input=event.target as HTMLInputElement;addLocalFiles([...input.files||[]]);input.value='';};
const dropzone=document.querySelector<HTMLLabelElement>('.dropzone')!;
dropzone.addEventListener('dragover',event=>{event.preventDefault();if(!controller){dropzone.classList.add('drag-over');if(event.dataTransfer)event.dataTransfer.dropEffect='copy';}});
dropzone.addEventListener('dragleave',()=>dropzone.classList.remove('drag-over'));
dropzone.addEventListener('drop',event=>{event.preventDefault();dropzone.classList.remove('drag-over');if(!controller&&event.dataTransfer)addLocalFiles([...event.dataTransfer.files]);});
for(const name of ['links','files'])$(`tab-${name}`).onclick=()=>{for(const n of ['links','files']){$(`tab-${n}`).classList.toggle('active',n===name);$(`${n}-pane`).classList.toggle('hidden',n!==name);}};
$<HTMLInputElement>('select-all').onchange=event=>{selected=(event.target as HTMLInputElement).checked?new Set(queue.map(q=>q.id)):new Set();renderQueue();};
$('clear').onclick=()=>{if(controller)return;queue=[];selected.clear();renderQueue();};
function bindDialog(dialogId:string,openId:string,closeId:string){const dialog=$<HTMLDialogElement>(dialogId);$(openId).onclick=()=>dialog.showModal();$(closeId).onclick=()=>dialog.close();dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();});}
bindDialog('help-dialog','open-help','close-help');
bindDialog('history-dialog','open-history','close-history');
$('scan').onclick=()=>void scan();$('start').onclick=()=>void start();$('cancel').onclick=()=>controller?.abort();
$('merge-mode').onchange=()=>{$('mode-description').textContent=$<HTMLSelectElement>('merge-mode').value==='copy'?'같은 형식의 영상을 재인코딩 없이 연결합니다. 형식이 다르면 호환 모드를 안내해요.':'해상도·프레임·음성을 720p/30fps/AAC로 통일합니다. 무음 영상에는 무음 트랙을 추가하며, 원본 화질이 달라질 수 있어요.';};
document.querySelectorAll('input[name="output"]').forEach(el=>el.addEventListener('change',updateSelection));
$('save-result').onclick=()=>{if(resultUrl)void saveUrl(resultUrl,`LearningX/${safeName(resultName.replace(/\.mp4$/,''))}.mp4`,resultName).catch(error=>toast(message(error)));};
$('clear-history').onclick=async()=>{if(isExtension){const response=await chrome.runtime.sendMessage({type:'LX_CLEAR_HISTORY'});if(!response?.ok){toast('기록을 지우지 못했어요.');return;}}history=[];renderHistory();};
window.addEventListener('beforeunload',event=>{if(controller){event.preventDefault();event.returnValue='';}});
window.addEventListener('unload',()=>{controller?.abort();if(resultUrl)URL.revokeObjectURL(resultUrl);});
if(isExtension){chrome.downloads.onChanged.addListener(delta=>{if(delta.state?.current==='complete'||delta.state?.current==='interrupted'){const url=downloadUrls.get(delta.id);if(url){URL.revokeObjectURL(url);downloadUrls.delete(delta.id);}}});chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes.history){history=(changes.history.newValue||[]) as HistoryEntry[];renderHistory();}if(changes.sourceTabId||changes.selectedLectureId||Object.keys(changes).some(k=>k.startsWith('lectures:')))void refreshDetected();});void refreshDetected();setInterval(async()=>{if(!history.some(h=>h.state==='in_progress'))return;for(const h of history.filter(h=>h.state==='in_progress')){const [d]=await chrome.downloads.search({id:h.downloadId});if(d)h.state=d.error||d.state;}renderHistory();},2000);}else{$('source-note').textContent='브라우저 미리보기 · 내 파일 가져오기와 실제 ffmpeg.wasm 병합을 사용할 수 있어요.';}
renderQueue();renderHistory();
