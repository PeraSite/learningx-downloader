import type { Lecture } from './types';

// LearningX uses Commons for files and PDFs too, not only videos.
const videoTypes = new Set(['movie', 'mp4', 'video', 'ssz', 'syncthink', 'estage', 'xenoglobal', 'oncast', 'screenlecture', 'lecturecam', 'readystream', 'webstudio', 'everlec', 'movie360', 'zoom', 'remix']);
export function commonsKind(data: any): Lecture['kind'] {
  if (data?.item_content_type !== 'commons') return;
  const type = data.item_content_data?.content_type;
  if (type === 'file' || type === 'pdf') return 'file';
  if (videoTypes.has(type)) return 'video';
}

export function resolveAttendance(lecture: Lecture, itemId: string, data: any): Lecture {
  const media = data?.item_content_data;
  if (data?.course_id !== Number(lecture.courseId) || !media) throw new Error('과목의 콘텐츠 정보를 확인할 수 없습니다.');
  if (data.lecture_period_status === 'closed' || data.opened === false || media.content_id === 'not_open' || !data.published) throw new Error('현재 열람이 허용되지 않은 콘텐츠입니다. 확장은 열람 제한을 우회하지 않습니다.');
  const kind = commonsKind(data);
  if (!kind) throw new Error('영상 또는 파일/PDF 자료만 다운로드할 수 있습니다.');
  const contentId = media.content_id;
  if (typeof contentId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(contentId)) throw new Error('Commons 콘텐츠 ID를 확인할 수 없습니다.');
  if (kind === 'file' && (typeof media.file_name !== 'string' || !media.file_name.trim())) throw new Error('자료의 원본 파일 이름을 확인할 수 없습니다.');
  return { ...lecture, kind, fileName: kind === 'file' ? media.file_name : undefined, title: String(data.title || lecture.title), attendanceItemId: itemId, sourceUrl: `https://commons.ssu.ac.kr/em/${contentId}`, duration: Number(media.duration) || undefined, week: `${data.week_position || ''}주차`, availability: 'open' };
}
