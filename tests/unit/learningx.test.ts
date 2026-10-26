import { afterEach, expect, mock, test } from 'bun:test';
import { commonsKind, resolveAttendance } from '../../src/learningx';
import { resolveCommonsFile } from '../../src/commons';
import { startDirectDownload } from '../../src/direct';
import type { ButtonJob, Lecture } from '../../src/types';

const lecture: Lecture = { id:'module:123:456', title:'자료', courseId:'123', courseTitle:'테스트 과목' };
const item = (type = 'file', name = '수업 자료.pptx') => ({ course_id:123, item_content_type:'commons', published:true, opened:true, week_position:2, item_content_data:{ content_type:type, content_id:'test123', file_name:name } });
const source = 'https://commons.ssu.ac.kr/em/test123';
const endpoint = 'https://commons.ssu.ac.kr/index.php?module=xn_media_content2013&act=dispXn_media_content2013DownloadContent&content_id=test123';
const originalFetch = globalThis.fetch;
const originalChrome = globalThis.chrome;
afterEach(() => { globalThis.fetch = originalFetch; (globalThis as any).chrome = originalChrome; });
function response(type = 'application/octet-stream', disposition = 'attachment; filename="test.pptx"', url = endpoint, status = 200) {
  const result = new Response(null, { status, headers:{ 'content-type':type, 'content-disposition':disposition } });
  Object.defineProperty(result, 'url', { value:url });
  return result;
}

test('classifies actual content types, never titles such as 퀴즈', () => {
  for (const type of ['file', 'pdf']) expect(commonsKind(item(type))).toBe('file');
  for (const type of ['movie', 'mp4', 'everlec', 'readystream']) expect(commonsKind(item(type))).toBe('video');
  for (const type of ['quiz', 'assignment', 'text', 'weblink', 'youtube', 'embed', 'audio', undefined]) {
    expect(commonsKind({ item_content_type:'commons', title:'강의.pdf', item_content_data:{ content_type:type } })).toBeUndefined();
  }
  expect(commonsKind({ ...item(), item_content_type:'quiz' })).toBeUndefined();
  expect(commonsKind(null)).toBeUndefined();
  expect(commonsKind({})).toBeUndefined();
});

test('preserves original file names and resolves video separately', () => {
  for (const [type, name] of [['file', '자료.pptx'], ['pdf', '설명.pdf'], ['file', '실습.zip']]) {
    expect(resolveAttendance(lecture, '111', item(type, name))).toMatchObject({ kind:'file', fileName:name, sourceUrl:source, availability:'open', attendanceItemId:'111', week:'2주차' });
  }
  expect(resolveAttendance(lecture, '111', item('movie'))).toMatchObject({ kind:'video', fileName:undefined });
});

test('rejects unavailable, mismatched and unsupported items before download', () => {
  for (const data of [
    { ...item(), course_id:456 }, { ...item(), published:false }, { ...item(), opened:false },
    { ...item(), lecture_period_status:'closed' }, item('quiz'), item('file', ''),
    { ...item(), item_content_data:{ ...item().item_content_data, content_id:'not_open' } },
    { ...item(), item_content_data:{ ...item().item_content_data, content_id:'../../secret' } },
  ]) expect(() => resolveAttendance(lecture, '111', data)).toThrow();
});

test('uses the official file endpoint, checks attachment headers and never parses a video manifest', async () => {
  const fetchMock = mock(async () => response());
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const signal = new AbortController().signal;
  expect(await resolveCommonsFile(source, signal)).toBe(endpoint);
  expect(fetchMock).toHaveBeenCalledWith(endpoint, { method:'HEAD', credentials:'include', redirect:'follow', signal });
  for (const result of [response('text/html'), response('application/json'), response('text/html', ''), response('application/pdf', 'inline'), response('application/pdf', 'attachment', 'https://evil.com/test.pdf'), response('application/pdf', 'attachment', endpoint, 403)]) {
    globalThis.fetch = mock(async () => result) as unknown as typeof fetch;
    await expect(resolveCommonsFile(source, signal)).rejects.toThrow();
  }
  await expect(resolveCommonsFile('https://evil.com/em/test123', signal)).rejects.toThrow();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await expect(resolveCommonsFile(source, AbortSignal.abort())).rejects.toHaveProperty('name', 'AbortError');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('one-click file downloads keep their extension, record completion and never start ffmpeg', async () => {
  const storage: Record<string, any> = {};
  const download = mock(async (_options: any) => 42);
  const offscreen = mock(async () => { throw new Error('Files must not start ffmpeg'); });
  (globalThis as any).chrome = {
    runtime:{ id:'test-extension', sendMessage:offscreen },
    tabs:{ sendMessage:async () => ({ ok:true }) },
    storage:{ local:{ get:async (key:string) => ({ [key]:structuredClone(storage[key]) }), set:async (patch:any) => Object.assign(storage, structuredClone(patch)) } },
    downloads:{ download, search:async () => [{ id:42, byExtensionId:'test-extension', state:'complete', filename:download.mock.calls.at(-1)?.[0].filename }] },
  };
  const fetchMock = mock(async () => response());
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const sender = { tab:{ id:1 }, url:'https://canvas.ssu.ac.kr/learningx/lti/modulebuilder', documentId:'doc' } as chrome.runtime.MessageSender;
  for (const name of ['자료.pptx', '설명.pdf']) {
    const resolved = resolveAttendance(lecture, '111', item(name.endsWith('.pdf') ? 'pdf' : 'file', name));
    const id = await startDirectDownload(resolved, sender);
    let job: ButtonJob | undefined;
    for (let i=0; i<100; i++) {
      job = storage.buttonJobs?.find((j:ButtonJob) => j.id === id);
      if (job && ['complete', 'failed'].includes(job.state)) break;
      await Bun.sleep(1);
    }
    expect(job?.state).toBe('complete');
    expect(download.mock.calls.at(-1)?.[0]).toEqual({ url:endpoint, filename:`LearningX/테스트 과목/2주차/${name}`, conflictAction:'uniquify', saveAs:false });
    expect(storage.history[0].state).toBe('complete');
  }
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(offscreen).not.toHaveBeenCalled();
  await expect(startDirectDownload({ ...lecture, sourceUrl:source, availability:'open' }, sender)).rejects.toThrow('영상 또는 파일/PDF');
});
