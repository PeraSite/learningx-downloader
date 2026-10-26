import type { Lecture } from './types';
import { commonsKind, resolveAttendance } from './learningx';
// Isolated-world content script. Session material stays in this frame and is never logged or persisted.
const sourceOrigin = 'https://canvas.ssu.ac.kr';
const activeButtons=new Map<string,{button:HTMLButtonElement;controller?:AbortController;jobId?:string;active:boolean}>();
function updateButton(id:string,state:string,detail:string,jobId?:string){const entry=activeButtons.get(id);if(!entry)return;entry.jobId=jobId||entry.jobId;entry.active=!['complete','failed','cancelled'].includes(state);entry.button.disabled=false;const percent=detail.match(/\d+%/)?.[0];entry.button.textContent=state==='complete'?'저장 완료':state==='failed'?'다시 시도':state==='cancelled'?'다운로드':state==='preparing'?'확인 중':state==='queued'?'대기 중':state==='merging'?(detail.includes('받는')?'받는 중'+(percent?' '+percent:''):'합치는 중'):'받는 중';entry.button.title=detail+(entry.active?' · 다시 누르면 취소':'');entry.button.style.color=state==='failed'?'#f04452':entry.active?'#3182f6':'#4e5968';entry.button.style.background=entry.active?'#e8f3ff':'#f2f4f6';}
function wireButton(button:HTMLButtonElement,lecture:Lecture){activeButtons.set(lecture.id,{button,active:false});button.addEventListener('click',async event=>{event.preventDefault();event.stopPropagation();const state=activeButtons.get(lecture.id)!;if(state.active){state.controller?.abort();if(state.jobId)void chrome.runtime.sendMessage({type:'LX_CANCEL_DOWNLOAD',jobId:state.jobId});updateButton(lecture.id,'cancelled','취소됨');return;}const controller=new AbortController();state.controller=controller;state.active=true;state.jobId=undefined;button.textContent='확인 중';button.title='열람 권한과 원본 주소를 확인합니다';try{const resolved=await resolveLecture(lecture,controller.signal);controller.signal.throwIfAborted();const response=await chrome.runtime.sendMessage({type:'LX_DOWNLOAD',lecture:resolved});if(!response?.ok)throw new Error(response?.error||'다운로드를 시작하지 못했습니다.');state.jobId=response.jobId;if(controller.signal.aborted)void chrome.runtime.sendMessage({type:'LX_CANCEL_DOWNLOAD',jobId:state.jobId});}catch(error){updateButton(lecture.id,controller.signal.aborted?'cancelled':'failed',controller.signal.aborted?'취소됨':error instanceof Error?error.message:String(error));}finally{state.controller=undefined;}});
}
function courseDocument(): Document { try { return window.top?.document ?? document; } catch { return document; } }
function courseInfo() {
  const doc = courseDocument();
  let pathname = location.pathname;
  try { pathname = window.top?.location.pathname ?? pathname; } catch {}
  const courseId = pathname.match(/\/courses\/(\d+)/)?.[1];
  const links = [...doc.querySelectorAll<HTMLAnchorElement>('a[href]')];
  const courseTitle = links.find(a => courseId && new URL(a.href, location.origin).pathname === `/courses/${courseId}` && a.textContent?.trim())?.textContent?.trim() || doc.title.replace(/ \|.*$/, '');
  return { courseId, courseTitle };
}
async function learningxGet(path: string, signal: AbortSignal) {
  const cookie = document.cookie.split('; ').find(c => c.startsWith('xn_api_token='));
  if (!cookie) throw new Error('LearningX 로그인 세션을 확인할 수 없습니다. 주차학습 탭을 새로고침해 주세요.');
  const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
  const response = await fetch(path, { credentials:'same-origin', headers:{ Authorization:`Bearer ${token}`, Accept:'application/json' }, signal:AbortSignal.any([signal,AbortSignal.timeout(20_000)]) });
  if (!response.ok || new URL(response.url).origin !== sourceOrigin) throw new Error(`콘텐츠 정보 조회 실패 (${response.status}). 학교 로그인을 확인해 주세요.`);
  return response.json();
}
const moduleCache = new Map<string, Promise<Map<string, Pick<Lecture, 'kind' | 'attendanceItemId'>>>>();
const detailCache = new Map<string, Promise<Lecture | undefined>>();
function courseItems(courseId: string) {
  if (!moduleCache.has(courseId)) moduleCache.set(courseId, learningxGet(`/learningx/api/v1/courses/${courseId}/modules?include_detail=true`, new AbortController().signal).then(modules => {
    const items = new Map<string, Pick<Lecture, 'kind' | 'attendanceItemId'>>();
    if (Array.isArray(modules)) for (const module of modules) for (const item of module.module_items || []) {
      const kind = item.content_type === 'attendance_item' ? commonsKind(item.content_data) : undefined;
      if (kind && /^\d+$/.test(String(item.content_id))) items.set(String(item.module_item_id), { kind, attendanceItemId:String(item.content_id) });
    }
    return items;
  }).catch(() => new Map()));
  return moduleCache.get(courseId)!;
}
async function collect(): Promise<Lecture[]> {
  const info = courseInfo();
  const found = new Map<string, Lecture>();
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    let url: URL;
    try { url = new URL(a.href, location.href); } catch { continue; }
    if (url.origin !== sourceOrigin) continue;
    const match = url.pathname.match(/^\/courses\/(\d+)\/modules\/items\/(\d+)$/);
    if (!match || match[1] !== info.courseId) continue;
    const metadata = (await courseItems(match[1])).get(match[2]);
    if (!metadata?.kind) {
      a.parentElement?.querySelector(`[data-lx-download="${match[2]}"]`)?.remove();
      continue;
    }
    const title = a.textContent?.trim();
    if (!title || title.length > 300) continue;
    const row = a.closest('.xnmb-module_item-wrapper, li, tr, [data-item-id], .learning-item, .module-item') ?? a.parentElement;
    const text = row?.textContent ?? '';
    const week = text.match(/\d+주차/)?.[0];
    const availability = /학습 기간이 종료|열람 종료됨|잠김/.test(text) ? 'closed' : 'unknown';
    const lecture: Lecture = { id: `module:${match[1]}:${match[2]}`, title, courseId: match[1], courseTitle: info.courseTitle, week, moduleUrl: url.href, availability, ...metadata };
    // The Studio merges videos only; file downloads stay on the LMS page.
    if (lecture.kind === 'video') found.set(lecture.id, lecture);
    if (!a.parentElement?.querySelector(`[data-lx-download="${match[2]}"]`)) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = '다운로드'; button.dataset.lxDownload = match[2];
      button.title = lecture.kind === 'file' ? '자료 원본 다운로드' : '영상 다운로드';
      Object.assign(button.style, { marginLeft:'10px', border:'1px solid #e5e8eb', background:'#f2f4f6', color:'#4e5968', borderRadius:'7px', padding:'6px 10px', cursor:'pointer', fontSize:'13px', fontWeight:'600' });
      wireButton(button,lecture);
      a.insertAdjacentElement('afterend', button);
    }
  }
  const detailId=location.pathname.match(/^\/learningx\/lti\/lecture_attendance\/items\/view\/(\d+)/)?.[1];
  if(detailId&&info.courseId&&!document.querySelector('[data-lx-detail]')){
    const id = 'attendance:'+info.courseId+':'+detailId;
    if (!detailCache.has(id)) detailCache.set(id, resolveLecture({id,title:courseDocument().title,courseId:info.courseId,courseTitle:info.courseTitle,attendanceItemId:detailId}, new AbortController().signal).catch(() => undefined));
    const lecture = await detailCache.get(id);
    if (!lecture) return [...found.values()];
    const button=document.createElement('button');button.type='button';button.dataset.lxDetail='true';button.textContent='다운로드';Object.assign(button.style,{position:'fixed',right:'20px',bottom:'20px',zIndex:'2147483647',padding:'12px 18px',borderRadius:'10px',border:'1px solid #e5e8eb',background:'#f2f4f6',color:'#4e5968',fontWeight:'700',cursor:'pointer'});wireButton(button,lecture);document.body.append(button);
  }
  return [...found.values()];
}
let lastSignature = '';
let publishing = false;
async function publish() {
  if (publishing) return;
  publishing = true;
  try {
    const lectures = await collect();
    const signature = JSON.stringify(lectures);
    if (signature === lastSignature) return;
    lastSignature = signature;
    await chrome.runtime.sendMessage({ type:'LX_DETECTED', lectures });
  } catch {} finally { publishing = false; }
}
async function resolveLecture(lecture: Lecture, signal: AbortSignal): Promise<Lecture> {
  signal.throwIfAborted();
  if(courseInfo().courseId!==lecture.courseId)throw new Error('강의 탭이 다른 과목으로 이동했습니다. 목록을 다시 찾아 주세요.');
  const courseId = lecture.courseId;
  if (!courseId || !/^\d+$/.test(courseId)) throw new Error('과목 ID를 확인할 수 없습니다.');
  let itemId = lecture.attendanceItemId;
  if (!itemId) {
    const moduleUrl = new URL(lecture.moduleUrl ?? '');
    if (moduleUrl.origin !== sourceOrigin || !new RegExp(`^/courses/${courseId}/modules/items/\\d+$`).test(moduleUrl.pathname)) throw new Error('지원하지 않는 강의 주소입니다.');
    const response = await fetch(moduleUrl.href, { credentials:'same-origin', signal: AbortSignal.any([signal,AbortSignal.timeout(20_000)]) });
    if (!response.ok || new URL(response.url).origin !== sourceOrigin) throw new Error('강의 페이지를 불러올 수 없습니다. 학교 로그인을 확인해 주세요.');
    const html = await response.text();
    itemId = html.match(/\/learningx\/lti\/lecture_attendance\/items\/view\/(\d+)/)?.[1];
    if (!itemId) throw new Error('이 항목은 지원되는 LearningX 콘텐츠가 아니거나 정보를 찾을 수 없습니다.');
  }
  if (!/^\d+$/.test(itemId)) throw new Error('잘못된 강의 항목입니다.');
  const data = await learningxGet(`/learningx/api/v1/courses/${courseId}/attendance_items/${itemId}`, signal);
  signal.throwIfAborted();
  return resolveAttendance(lecture, itemId, data);
}
const resolutionRequests = new Map<string, AbortController>();
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if(msg?.type==='LX_BUTTON_STATUS'&&sender.url?.startsWith(chrome.runtime.getURL(''))){updateButton(msg.lectureId,msg.state,msg.detail,msg.jobId);respond({ok:true});return;}
  if (msg?.type === 'LX_SCAN') { lastSignature=''; moduleCache.clear(); detailCache.clear(); void publish(); respond({ ok:true }); }
  if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  if (msg?.type === 'LX_CANCEL_RESOLVE') { resolutionRequests.get(msg.requestId)?.abort();respond({ok:true});return; }
  if (msg?.type === 'LX_RESOLVE_LECTURE') { const controller=new AbortController();resolutionRequests.set(msg.requestId,controller);resolveLecture(msg.lecture,controller.signal).then(result => respond({ ok:true, result })).catch(error => respond({ ok:false, error:error.message })).finally(()=>resolutionRequests.delete(msg.requestId)); return true; }
});
publish();
let debounce: ReturnType<typeof setTimeout>;
new MutationObserver(() => { clearTimeout(debounce); debounce=setTimeout(publish,400); }).observe(document.documentElement,{childList:true,subtree:true});
