import {test,expect} from 'bun:test';
import {safeName,downloadPath,bytes,duration} from '../../src/utils';
import {assertMergeSize,MAX_MERGE_BYTES} from '../../src/limits';
test('sanitizes unsafe paths and reserved file names',()=>{expect(safeName('../foo/bar:bad?')).not.toContain('/');expect(safeName('../foo')).not.toContain('..');expect(safeName('CON')).toBe('_CON');expect(safeName('   ')).toBe('영상');expect(safeName('블레이드 러너_장면분석1')).toBe('블레이드 러너_장면분석1');});
test('output paths stay inside Downloads',()=>{const path=downloadPath('../course','../../week','../name');expect(path).toStartWith('LearningX/');expect(path).not.toContain('..');expect(path).toEndWith('.mp4');});
test('merge memory budget is enforced',()=>{expect(assertMergeSize([1,2])).toBe(3);expect(assertMergeSize([MAX_MERGE_BYTES])).toBe(MAX_MERGE_BYTES);expect(()=>assertMergeSize([MAX_MERGE_BYTES,1])).toThrow();expect(()=>assertMergeSize([NaN])).toThrow();});
test('formats byte sizes and duration',()=>{expect(bytes(1024)).toBe('1.0 KB');expect(bytes(1024*1024)).toBe('1.0 MB');expect(duration(966)).toBe('16:06');expect(duration()).toBe('');});
