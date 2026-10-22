import { bytes } from './utils';
export const MAX_MERGE_BYTES = 512 * 1024 * 1024;
export function assertMergeSize(sizes: number[]) {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (sizes.some(n => !Number.isFinite(n) || n < 0) || total > MAX_MERGE_BYTES) throw new Error(`브라우저 병합은 입력 합계 ${bytes(MAX_MERGE_BYTES)}까지 지원합니다. 강의를 나눠서 처리해 주세요.`);
  return total;
}
