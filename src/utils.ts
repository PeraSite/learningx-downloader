export function safeName(value: string, fallback = '영상'): string {
  const cleaned = value.normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_').replace(/\.{2,}/g, '_').replace(/^[. ]+|[. ]+$/g, '').trim();
  const shortened = Array.from(cleaned || fallback).slice(0, 100).join('');
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(shortened) ? `_${shortened}` : shortened;
}
export function bytes(value = 0): string { if (value < 1024) return `${value} B`; if(value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; const m = value / 1024 / 1024; return m >= 1024 ? `${(m / 1024).toFixed(2)} GB` : `${m.toFixed(1)} MB`; }
export function duration(value?: number): string { if (!Number.isFinite(value)) return ''; const s = Math.floor(value!); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2,'0')}`; }
export function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
export const isExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
export function assetUrl(file: string): string { return isExtension ? chrome.runtime.getURL(file) : new URL(file, location.href).href; }
export function downloadPath(course: string, week: string, title: string): string { return `LearningX/${safeName(course, 'Commons')}/${safeName(week, '영상')}/${safeName(title)}.mp4`; }
