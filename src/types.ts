export interface MediaPart { name: string; urls: string[] }
export interface CommonsManifest { contentId: string; title: string; sourceUrl: string; parts: MediaPart[] }
export interface Lecture {
  id: string; title: string; courseId?: string; courseTitle?: string; week?: string;
  moduleUrl?: string; attendanceItemId?: string; sourceUrl?: string; duration?: number;
  tabId?: number; frameId?: number; documentId?: string; availability?: 'unknown' | 'open' | 'closed';
}
export interface ResolvedLecture extends Lecture { sourceUrl: string; parts: MediaPart[] }
export interface HistoryEntry { id: string; title: string; downloadId: number; createdAt: number; state: string; fileName: string }
export interface JobProgress { phase: string; detail: string; loaded?: number; total?: number; percent?: number }
export type MergeMode = 'copy' | 'normalize';
export interface ButtonJob {
  id: string; lecture: ResolvedLecture; fileName: string; state: 'preparing'|'queued'|'merging'|'downloading'|'complete'|'failed'|'cancelled';
  detail: string; createdAt: number; tabId: number; documentId?: string; frameId?: number; downloadId?: number;
}
