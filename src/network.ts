import { isAllowedMediaUrl } from './commons';
import { MAX_MERGE_BYTES } from './limits';
import type { MediaPart, JobProgress } from './types';
function checkResponse(response: Response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!isAllowedMediaUrl(response.url)) throw new Error('허용되지 않은 다운로드 리디렉션입니다.');
  if (/text\/html|application\/json|mpegurl/i.test(response.headers.get('content-type') || '')) throw new Error('영상 대신 오류 페이지 또는 미지원 재생목록이 반환되었습니다.');
}
export async function chooseDownloadUrl(part: MediaPart, signal: AbortSignal): Promise<string> {
  for(const url of part.urls) {
    if(!isAllowedMediaUrl(url)) continue;
    try {
      const response=await fetch(url,{headers:{Range:'bytes=0-1023'},credentials:'omit',signal:AbortSignal.any([signal,AbortSignal.timeout(20_000)])});
      try { checkResponse(response); return response.url; } finally { await response.body?.cancel(); }
    } catch(error) { if(signal.aborted) throw error; }
  }
  throw new Error(`${part.name}: 접근 가능한 영상 주소가 없습니다. 권한 또는 서버 상태를 확인해 주세요.`);
}
export async function fetchMedia(part: MediaPart, signal: AbortSignal, budget: { used: number }, onProgress: (p: JobProgress)=>void): Promise<Blob> {
  const errors: string[]=[];
  for(const url of part.urls) {
    if(!isAllowedMediaUrl(url)) continue;
    const before=budget.used;
    try {
      const response=await fetch(url,{credentials:'omit',signal:AbortSignal.any([signal,AbortSignal.timeout(240_000)])});
      try { checkResponse(response); } catch(error) { await response.body?.cancel(); throw error; }
      const total=Number(response.headers.get('content-length')) || undefined;
      if(total && budget.used+total>MAX_MERGE_BYTES) { await response.body?.cancel(); throw new Error('입력 합계 512 MB 제한을 넘습니다. 더 적은 영상을 선택해 주세요.'); }
      if(!response.body) throw new Error('빈 응답입니다.');
      const reader=response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[]=[];
      let loaded=0;
      try {
        while(true) {
          signal.throwIfAborted();
          const {done,value}=await reader.read();if(done) break;
          loaded+=value.byteLength;budget.used+=value.byteLength;
          if(budget.used>MAX_MERGE_BYTES) throw new Error('입력 합계 512 MB 제한을 넘습니다. 더 적은 영상을 선택해 주세요.');
          chunks.push(value as Uint8Array<ArrayBuffer>);
          onProgress({phase:'영상 받는 중',detail:part.name,loaded,total,percent:total?Math.min(100,loaded/total*100):undefined});
        }
      } catch(error) { await reader.cancel().catch(()=>{});throw error; } finally { reader.releaseLock(); }
      if(loaded===0) throw new Error('빈 영상 파일입니다.');
      return new Blob(chunks,{type:'video/mp4'});
    } catch(error) { budget.used=before;if(signal.aborted) throw error;errors.push(error instanceof Error?error.message:String(error));if(errors.at(-1)?.includes('512 MB')) throw error; }
  }
  throw new Error(`${part.name}: 다운로드 실패. ${errors.join(' / ')}`);
}
