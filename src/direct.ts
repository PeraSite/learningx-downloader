import {recordHistory} from './history';
import { resolveCommons, resolveCommonsFile } from './commons';
import { chooseDownloadUrl } from './network';
import { downloadPath, safeName, message } from './utils';
import type { ButtonJob, Lecture } from './types';
let writes=Promise.resolve();
let creating:Promise<void>|undefined;
const controllers=new Map<string,AbortController>();
async function jobs():Promise<ButtonJob[]>{const state=await chrome.storage.local.get('buttonJobs');return Array.isArray(state.buttonJobs)?state.buttonJobs as ButtonJob[]:[];}
async function update(id:string,patch:Partial<ButtonJob>){let result:ButtonJob|undefined;writes=writes.catch(()=>{}).then(async()=>{const all=await jobs();result=all.find(j=>j.id===id);if(result)Object.assign(result,patch);await chrome.storage.local.set({buttonJobs:all.slice(-50)});});await writes;if(result)await notify(result);return result;}
async function notify(job:ButtonJob){try{await chrome.tabs.sendMessage(job.tabId,{type:'LX_BUTTON_STATUS',lectureId:job.lecture.id,jobId:job.id,state:job.state,detail:job.detail},job.documentId?{documentId:job.documentId}:{frameId:job.frameId??0});}catch{}}
async function ensureOffscreen(){const existing=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],documentUrls:[chrome.runtime.getURL('offscreen.html')]});if(existing.length)return;if(!creating){creating=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['WORKERS' as chrome.offscreen.Reason,'BLOBS' as chrome.offscreen.Reason],justification:'Join authorized lecture video segments locally with a bundled ffmpeg.wasm worker and retain the resulting Blob until Chrome finishes saving.'}).finally(()=>{creating=undefined;});}await creating;}
async function record(job:ButtonJob,id:number){await recordHistory(id,job.lecture.title);}
async function begin(job:ButtonJob){const controller=new AbortController();controllers.set(job.id,controller);try{
  let url: string;
  if (job.lecture.kind === 'file') {
    if (typeof job.lecture.fileName !== 'string' || !job.lecture.fileName.trim()) throw new Error('자료의 원본 파일 이름을 확인할 수 없습니다.');
    url = await resolveCommonsFile(job.lecture.sourceUrl, AbortSignal.any([controller.signal,AbortSignal.timeout(30_000)]));
    job.fileName = `LearningX/${safeName(job.lecture.courseTitle || 'Commons')}/${safeName(job.lecture.week || '자료')}/${safeName(job.lecture.fileName)}`;
    await update(job.id, { fileName:job.fileName });
  } else {
    const manifest=await resolveCommons(job.lecture.sourceUrl,AbortSignal.any([controller.signal,AbortSignal.timeout(30_000)]));
    job.lecture={...job.lecture,title:manifest.title,parts:manifest.parts};job.fileName=downloadPath(job.lecture.courseTitle||'Commons',job.lecture.week||'영상',manifest.title);
    await update(job.id,{lecture:job.lecture,fileName:job.fileName});controller.signal.throwIfAborted();
    if(manifest.parts.length===1&&/\.mp4$/i.test(manifest.parts[0].name)){
      url=await chooseDownloadUrl(manifest.parts[0],controller.signal);
    }else{
      await update(job.id,{state:'queued',detail:'자동 병합 대기 중 · 누르면 취소'});await ensureOffscreen();controller.signal.throwIfAborted();
      const response=await chrome.runtime.sendMessage({target:'offscreen',type:'LX_OFFSCREEN_JOB',job});if(!response?.ok)throw new Error('백그라운드 병합을 시작하지 못했습니다.');
      return;
    }
  }
  controller.signal.throwIfAborted();
  const id=await chrome.downloads.download({url,filename:job.fileName,conflictAction:'uniquify',saveAs:false});
  job=(await update(job.id,{state:'downloading',detail:'다운로드 중 · 누르면 취소',downloadId:id}))!;await record(job,id);
  const [download]=await chrome.downloads.search({id});if(download?.state==='complete')await update(job.id,{state:'complete',detail:'저장 완료'});
}catch(error){await update(job.id,{state:controller.signal.aborted?'cancelled':'failed',detail:controller.signal.aborted?'취소됨':message(error)});}finally{controllers.delete(job.id);}}
export async function startDirectDownload(lecture:Lecture,sender:chrome.runtime.MessageSender):Promise<string>{
  if(!sender.tab?.id||!sender.url?.startsWith('https://canvas.ssu.ac.kr/')||!lecture||typeof lecture.id!=='string'||!/^\d+$/.test(lecture.courseId||'')||!lecture.sourceUrl||lecture.availability!=='open')throw new Error('허용된 LearningX 강의 정보가 필요합니다.');
  if (lecture.kind !== 'video' && lecture.kind !== 'file') throw new Error('영상 또는 파일/PDF 자료만 다운로드할 수 있습니다.');
  const active=(await jobs()).find(j=>j.tabId===sender.tab!.id&&j.documentId===sender.documentId&&j.lecture.id===lecture.id&&!['complete','failed','cancelled'].includes(j.state));if(active)return active.id;
  const job:ButtonJob={id:crypto.randomUUID(),lecture:{...lecture,sourceUrl:lecture.sourceUrl,parts:[]},fileName:'',state:'preparing',detail:'원본 확인 중 · 누르면 취소',createdAt:Date.now(),tabId:sender.tab.id,documentId:sender.documentId,frameId:sender.frameId};
  writes=writes.catch(()=>{}).then(async()=>{const all=await jobs();all.push(job);await chrome.storage.local.set({buttonJobs:all.slice(-50)});});await writes;void begin(job);return job.id;
}
export async function cancelDirectDownload(id:string,sender:chrome.runtime.MessageSender){const job=(await jobs()).find(j=>j.id===id);if(!job||sender.tab?.id!==job.tabId||sender.documentId!==job.documentId)return;controllers.get(id)?.abort();if(job.downloadId)await chrome.downloads.cancel(job.downloadId);await chrome.runtime.sendMessage({target:'offscreen',type:'LX_OFFSCREEN_CANCEL',jobId:id}).catch(()=>{});await update(id,{state:'cancelled',detail:'취소됨'});}
export async function handleOffscreen(msg:any,sender:chrome.runtime.MessageSender){
  if(sender.url!==chrome.runtime.getURL('offscreen.html'))return;
  if(msg.type==='LX_OFFSCREEN_IDLE'){if(!(await jobs()).some(j=>['queued','merging'].includes(j.state)))await chrome.offscreen.closeDocument().catch(()=>{});return;}
  const job=(await jobs()).find(j=>j.id===msg.jobId);if(!job)return;
  if(msg.type==='LX_OFFSCREEN_PROGRESS'){if(!['cancelled','complete','failed'].includes(job.state))await update(job.id,{state:'merging',detail:msg.detail});}
  if(msg.type==='LX_OFFSCREEN_ERROR')await update(job.id,{state:job.state==='cancelled'?'cancelled':'failed',detail:String(msg.error).slice(0,600)});
  if(msg.type==='LX_OFFSCREEN_READY'){
    if(job.state==='cancelled'){await chrome.runtime.sendMessage({target:'offscreen',type:'LX_OFFSCREEN_RELEASE',jobId:job.id});return;}
    if(typeof msg.url!=='string'||!msg.url.startsWith(`blob:${chrome.runtime.getURL('')}`))throw new Error('Invalid output Blob');
    try{const id=await chrome.downloads.download({url:msg.url,filename:job.fileName,saveAs:false,conflictAction:'uniquify'});const next=(await update(job.id,{state:'downloading',detail:'저장 중 · 누르면 취소',downloadId:id}))!;await record(next,id);const [download]=await chrome.downloads.search({id});if(download?.state==='complete')await directDownloadChanged({id,state:{current:'complete'}});}catch(error){await update(job.id,{state:'failed',detail:message(error)});await chrome.runtime.sendMessage({target:'offscreen',type:'LX_OFFSCREEN_RELEASE',jobId:job.id}).catch(()=>{});}
  }
}
export async function directDownloadChanged(delta:chrome.downloads.DownloadDelta){if(!delta.state&&!delta.error)return;const job=(await jobs()).find(j=>j.downloadId===delta.id);if(!job)return;if(delta.state?.current==='complete'||delta.state?.current==='interrupted'||delta.error){const cancelled=job.state==='cancelled'||delta.error?.current==='USER_CANCELED';await update(job.id,{state:cancelled?'cancelled':delta.state?.current==='complete'?'complete':'failed',detail:cancelled?'취소됨':delta.state?.current==='complete'?'저장 완료':`다운로드 실패: ${delta.error?.current||'중단됨'}`});await chrome.runtime.sendMessage({target:'offscreen',type:'LX_OFFSCREEN_RELEASE',jobId:job.id}).catch(()=>{});}}
