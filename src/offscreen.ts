import { fetchMedia } from './network';
import { mergeVideos, type InputVideo } from './merger';
import { message } from './utils';
import type { ButtonJob } from './types';
const queue:ButtonJob[]=[];const controllers=new Map<string,AbortController>();const outputs=new Map<string,string>();let busy=false;let lastProgress=0;
const send=(msg:Record<string,unknown>)=>chrome.runtime.sendMessage(msg).catch(()=>{});
function idle(){if(!busy&&!queue.length&&!outputs.size)void send({type:'LX_OFFSCREEN_IDLE'});}
async function run(){if(busy)return;busy=true;try{while(queue.length){const job=queue.shift()!;const controller=controllers.get(job.id)!;if(controller.signal.aborted){controllers.delete(job.id);continue;}try{
  const inputs:InputVideo[]=[];const budget={used:0};const progress=(detail:string)=>{const now=Date.now();if(now-lastProgress<700)return;lastProgress=now;void send({type:'LX_OFFSCREEN_PROGRESS',jobId:job.id,detail});};
  for(let i=0;i<job.lecture.parts.length;i++){const part=job.lecture.parts[i];const blob=await fetchMedia(part,controller.signal,budget,p=>progress(`조각 ${i+1}/${job.lecture.parts.length} 받는 중${p.percent!==undefined?' '+Math.floor(p.percent)+'%':''} · 누르면 취소`));inputs.push({name:part.name,blob});}
  const result=await mergeVideos(inputs,'copy',controller.signal,p=>progress(`${p.phase} · 누르면 취소`),()=>{});controller.signal.throwIfAborted();
  const url=URL.createObjectURL(result.blob);outputs.set(job.id,url);await send({type:'LX_OFFSCREEN_READY',jobId:job.id,url});
}catch(error){await send({type:'LX_OFFSCREEN_ERROR',jobId:job.id,error:controller.signal.aborted?'취소됨':message(error)+' 형식이 다른 조각은 확장 아이콘의 고급 병합 화면에서 호환 모드를 사용해 주세요.'});}finally{controllers.delete(job.id);}}}finally{busy=false;idle();}}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||msg?.target!=='offscreen')return;
  if(msg.type==='LX_OFFSCREEN_JOB'){if(!controllers.has(msg.job.id)){queue.push(msg.job);controllers.set(msg.job.id,new AbortController());}respond({ok:true});void run();}
  if(msg.type==='LX_OFFSCREEN_CANCEL'){controllers.get(msg.jobId)?.abort();respond({ok:true});idle();}
  if(msg.type==='LX_OFFSCREEN_RELEASE'){const url=outputs.get(msg.jobId);if(url){URL.revokeObjectURL(url);outputs.delete(msg.jobId);}respond({ok:true});idle();}
});
