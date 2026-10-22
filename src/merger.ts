import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import { assetUrl } from './utils';
import { assertMergeSize } from './limits';
import type { JobProgress, MergeMode } from './types';
export interface InputVideo { name: string; blob: Blob }
interface Probe { format?: { duration?: string; size?: string }; streams?: Array<Record<string, string | number>> }
export interface MergeResult { blob: Blob; duration: number; method: MergeMode; inputs: number }
function signature(probe: Probe) {
  return JSON.stringify(probe.streams?.filter(s => s.codec_type === 'video' || s.codec_type === 'audio').map(s => {
    const fields = s.codec_type === 'video' ? ['codec_type','codec_name','profile','level','width','height','pix_fmt','r_frame_rate','time_base','extradata_hash','side_data_list','tags'] : ['codec_type','codec_name','profile','sample_rate','channels','channel_layout','time_base','extradata_hash'];
    return Object.fromEntries(fields.map(k => [k, s[k] ?? null]));
  }));
}
export async function mergeVideos(inputs: InputVideo[], mode: MergeMode, signal: AbortSignal, onProgress: (p: JobProgress) => void, onLog: (text: string) => void): Promise<MergeResult> {
  if (!inputs.length) throw new Error('병합할 영상이 없습니다.');
  assertMergeSize(inputs.map(i => i.blob.size));
  signal.throwIfAborted();
  const ffmpeg = new FFmpeg();
  const abort = () => ffmpeg.terminate();
  signal.addEventListener('abort', abort, { once: true });
  const logs: string[] = [];
  ffmpeg.on('log', ({message}) => { logs.push(message); if(logs.length > 25) logs.shift(); onLog(message); });
  // Concat percentages from ffmpeg.wasm are not reliable. Report actual processed time, not a fabricated percentage.
  ffmpeg.on('progress', ({time}) => onProgress({phase:'병합 중', detail:`처리 시간 ${(time / 1_000_000).toFixed(1)}초 · 탭을 닫지 마세요`}));
  try {
    onProgress({ phase:'엔진 준비', detail:'확장에 포함된 ffmpeg.wasm을 불러오는 중' });
    await ffmpeg.load({ coreURL:assetUrl('ffmpeg/ffmpeg-core.js'), wasmURL:assetUrl('ffmpeg/ffmpeg-core.wasm'), classWorkerURL:assetUrl('ffmpeg/worker.js') }, { signal });
    await ffmpeg.createDir('/inputs');
    const files = inputs.map((input,i) => new File([input.blob], `part_${String(i).padStart(4,'0')}.mp4`, {type:input.blob.type || 'video/mp4'}));
    const mounted = await ffmpeg.mount(FFFSType.WORKERFS, { files }, '/inputs');
    if (!mounted) throw new Error('로컬 파일 마운트 실패: WORKERFS를 사용할 수 없습니다.');
    const paths = files.map(file => `/inputs/${file.name}`);
    const probes: Probe[] = [];
    for (let i=0; i<paths.length; i++) {
      signal.throwIfAborted();
      onProgress({phase:'영상 검사',detail:`${i+1}/${paths.length} · ${inputs[i].name}`});
      const out = `probe_${i}.json`;
      const code = await ffmpeg.ffprobe(['-v','error','-show_entries','format=duration,size:stream=codec_type,codec_name,profile,level,width,height,pix_fmt,r_frame_rate,time_base,sample_rate,channels,channel_layout,extradata_hash:stream_side_data=rotation:stream_tags=rotate','-show_data_hash','sha256','-of','json','-o',out, paths[i]], 30_000, {signal});
      // This upstream core can leave Module.ret=-1 after a successful ffprobe. Validate the generated JSON rather than treating that sentinel as a failure.
      if(code !== 0 && code !== -1) throw new Error(`${inputs[i].name}: 영상 정보를 읽을 수 없습니다. (${code})`);
      const result = await ffmpeg.readFile(out,'utf8');
      const probe: Probe = JSON.parse(String(result));
      await ffmpeg.deleteFile(out);
      if (!probe.streams?.some(s => s.codec_type === 'video') || !Number(probe.format?.duration)) throw new Error(`${inputs[i].name}: 재생 가능한 영상이 아닙니다.`);
      if (probe.streams.filter(s=>s.codec_type==='video').length!==1 || probe.streams.filter(s=>s.codec_type==='audio').length>1) throw new Error('다중 영상/음성 트랙은 아직 지원하지 않습니다.');
      probes.push(probe);
    }
    const expectedDuration = probes.reduce((sum,p) => sum+Number(p.format?.duration || 0),0);
    if(mode==='copy' && probes.some(p=>signature(p)!==signature(probes[0]))) throw new Error('영상/음성 형식이 달라 무손실로 합칠 수 없습니다. 호환 모드로 다시 시도해 주세요. 음성을 임의로 제거하지 않습니다.');
    let concatPaths = paths;
    if(mode==='normalize') {
      if(expectedDuration>600||inputs.reduce((sum,i)=>sum+i.blob.size,0)>128*1024*1024)throw new Error('호환 모드는 합계 10분·128 MiB까지만 지원합니다. 긴 강의는 같은 형식끼리 빠른 병합을 사용하거나 나눠서 처리해 주세요.');
      concatPaths=[];let normalizedBytes=0;
      for(let i=0;i<paths.length;i++) {
        signal.throwIfAborted();
        onProgress({phase:'호환 변환',detail:`${i+1}/${paths.length} · 720p / H.264 / AAC 변환. 긴 영상은 오래 걸릴 수 있습니다.`});
        const output=`normalized_${i}.mp4`;
        const hasAudio=probes[i].streams!.some(s=>s.codec_type==='audio');
        const args=['-i',paths[i],...(!hasAudio?['-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000']:[]),'-map','0:v:0','-map',hasAudio?'0:a:0':'1:a:0','-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30','-c:v','libx264','-preset','ultrafast','-crf','23','-maxrate','2M','-bufsize','4M','-pix_fmt','yuv420p','-threads','1','-c:a','aac','-b:a','128k','-ar','48000','-ac','2','-t',String(Number(probes[i].format?.duration)),'-movflags','+faststart',output];
        const result=await ffmpeg.exec(args,-1,{signal});
        if(result!==0) throw new Error(`호환 변환 실패: ${inputs[i].name}. ${logs.slice(-3).join(' ')}`);
        await ffmpeg.ffprobe(['-v','error','-show_entries','format=size','-of','json','-o','size.json',output],30_000,{signal});
        const size=JSON.parse(String(await ffmpeg.readFile('size.json','utf8')));normalizedBytes+=Number(size.format?.size||0);await ffmpeg.deleteFile('size.json');
        if(!Number(size.format?.size)||normalizedBytes>192*1024*1024)throw new Error('호환 변환 결과가 브라우저 메모리 예산을 초과합니다. 더 적은 영상을 선택해 주세요.');
        concatPaths.push(output);
      }
    }
    await ffmpeg.writeFile('concat.txt',concatPaths.map(p=>`file '${p}'`).join('\n'));
    onProgress({phase:'병합 중',detail:`${inputs.length}개 파일을 ${mode==='copy'?'재인코딩 없이':'호환 형식으로'} 연결하는 중`});
    const code=await ffmpeg.exec(['-f','concat','-safe','0','-i','concat.txt','-map','0:v:0','-map','0:a:0?','-c','copy','-movflags','+faststart','output.mp4'],-1,{signal});
    if(code!==0) throw new Error(`병합 실패. ${mode==='copy'?'호환 모드로 다시 시도해 주세요.':''} ${logs.slice(-3).join(' ')}`);
    const verifyCode=await ffmpeg.ffprobe(['-v','error','-show_entries','format=duration:stream=codec_type','-of','json','-o','result.json','output.mp4'],30_000,{signal});
    if(verifyCode!==0 && verifyCode!==-1) throw new Error('병합 결과 검사에 실패했습니다.');
    const finalProbe: Probe=JSON.parse(String(await ffmpeg.readFile('result.json','utf8')));
    const actual=Number(finalProbe.format?.duration);
    if(!Number.isFinite(actual) || Math.abs(actual-expectedDuration)>Math.max(2, inputs.length*0.25)) throw new Error('병합 결과의 재생 시간이 입력 합계와 다릅니다. 결과를 저장하지 않았습니다.');
    if(probes.some(p=>p.streams?.some(s=>s.codec_type==='audio')) && !finalProbe.streams?.some(s=>s.codec_type==='audio')) throw new Error('병합 중 음성 트랙이 누락되어 저장하지 않았습니다.');
    const boundaries=[0];let cumulative=0;for(const probe of probes.slice(0,-1)){cumulative+=Number(probe.format?.duration||0);boundaries.push(Math.max(0,cumulative-0.25));}
    for(let i=0;i<boundaries.length;i++){signal.throwIfAborted();onProgress({phase:'접합부 검사',detail:`${i+1}/${boundaries.length} · 영상과 음성 디코딩 확인`});const decoded=await ffmpeg.exec(['-v','error','-xerror','-ss',String(boundaries[i]),'-i','output.mp4','-t','0.75','-map','0:v:0','-map','0:a:0?','-f','null','-'],-1,{signal});if(decoded!==0)throw new Error('병합 접합부에서 디코딩 오류가 발생했습니다. 호환 모드를 사용해 주세요.');}
    onProgress({phase:'결과 준비',detail:'재생 시간·음성 트랙 검사 완료. MP4 파일을 준비하는 중'});
    const data=await ffmpeg.readFile('output.mp4');
    if(!(data instanceof Uint8Array) || !data.byteLength) throw new Error('병합 결과가 비어 있습니다.');
    const blob=new Blob([data as Uint8Array<ArrayBuffer>],{type:'video/mp4'});
    return {blob,duration:actual,method:mode,inputs:inputs.length};
  } catch(error) {
    if(signal.aborted) throw new DOMException('작업을 취소했습니다.','AbortError');
    if(String(error).includes('memory') || String(error).includes('out of bounds')) throw new Error('브라우저 메모리가 부족합니다. 더 적은 영상을 선택해 주세요.');
    throw error;
  } finally { signal.removeEventListener('abort',abort); ffmpeg.terminate(); }
}
