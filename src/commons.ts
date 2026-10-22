import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { CommonsManifest, MediaPart } from './types';

const COMMONS_HOST = 'commons.ssu.ac.kr';
const MEDIA_HOSTS = new Set([COMMONS_HOST, 'ssuin-object.commonscdn.com', 'ssu-toast.commonscdn.com']);
const MEDIA_TOKEN = '[MEDIA_FILE]';
const CONTENT_ID = /^[A-Za-z0-9_-]+$/;
const PROGRESSIVE_FILE = /\.(?:mp4|m4v|mov|webm|ogv)$/i;
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false, trimValues: true, ignoreDeclaration: true, ignorePiTags: true });

type RecordNode = Record<string, unknown>;
interface Candidate { url: string; rank: number }
interface StoryFile { path: string; name: string }

function record(value: unknown): value is RecordNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function list(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return record(value) && typeof value['#text'] === 'string' ? value['#text'].trim() : '';
}
function child(value: unknown, key: string): unknown {
  return record(value) ? value[key] : undefined;
}

// Inspect the original authority too: URL normalizes an explicit :443 away,
// and otherwise accepts backslashes, whitespace and some malformed escapes.
function secureUrl(input: string, hosts: ReadonlySet<string>): URL | undefined {
  if (typeof input !== 'string' || /[\s\\\u0000-\u001f\u007f]/.test(input) || /%(?![\da-f]{2})/i.test(input)) return;
  const authority = /^https:\/\/([^/?#]+)(?:[/?#]|$)/i.exec(input)?.[1];
  if (!authority || !hosts.has(authority.toLowerCase())) return;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.has(url.hostname)) return;
    return url;
  } catch { return; }
}

export function normalizeCommonsUrl(input: string): string {
  const url = secureUrl(input, new Set([COMMONS_HOST]));
  // Match the original path, not a URL-normalized path with dot segments removed.
  const match = typeof input === 'string' ? /^https:\/\/commons\.ssu\.ac\.kr\/em\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/i.exec(input) : null;
  if (!url || !match) throw new Error('Invalid Commons URL: expected https://commons.ssu.ac.kr/em/{id}.');
  return `https://${COMMONS_HOST}/em/${match[1]}`;
}

export function isAllowedMediaUrl(input: string): boolean {
  return secureUrl(input, MEDIA_HOSTS) !== undefined;
}

function fileFromPath(input: string): StoryFile | undefined {
  try {
    const decoded = decodeURIComponent(input);
    const segments = decoded.split('/');
    if (!decoded || /[\\?#%\u0000-\u001f\u007f]/.test(decoded) || segments.some(segment => !segment || segment === '.' || segment === '..')) return;
    const name = segments[segments.length - 1];
    if (!PROGRESSIVE_FILE.test(name)) return;
    return { name, path: segments.map(segment => encodeURIComponent(segment)).join('/') };
  } catch { return; }
}

function progressiveCandidate(input: string, rank: number): Candidate | undefined {
  const url = secureUrl(input, MEDIA_HOSTS);
  if (!url || input.includes(MEDIA_TOKEN)) return;
  const basename = url.pathname.split('/').at(-1) ?? '';
  if (!fileFromPath(basename)) return;
  return { url: input, rank };
}

function methodRank(method: string, target = '', template = false): number | undefined {
  switch (method.toLowerCase()) {
    case 'progressive': return template ? (target === 'all' ? 0 : target === 'mobile' ? 1 : 2) : 3;
    case '': return 5;
    case 'pseudo': return 6;
    default: return undefined; // Never mix HLS, DASH or RTMP with progressive files.
  }
}

function collectDirect(value: unknown, inheritedMethod = ''): Candidate[] {
  if (Array.isArray(value)) return value.flatMap(item => collectDirect(item, inheritedMethod));
  if (!record(value)) return [];
  const method = text(value.method) || text(value['@_method']) || inheritedMethod;
  const result: Candidate[] = [];
  for (const uri of list(value.media_uri)) {
    const rank = methodRank(text(child(uri, '@_method')) || method);
    const candidate = rank === undefined ? undefined : progressiveCandidate(text(uri), rank);
    if (candidate) result.push(candidate);
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key !== 'media_uri' && key !== 'method' && !key.startsWith('@_')) result.push(...collectDirect(nested, method));
  }
  return result;
}

function candidatesToUrls(candidates: Candidate[]): string[] {
  return [...new Set(candidates.sort((a, b) => a.rank - b.rank).map(candidate => candidate.url))];
}

export function parseCommonsManifest(xml: string, sourceUrl: string): CommonsManifest {
  const canonicalSource = normalizeCommonsUrl(sourceUrl);
  const sourceId = canonicalSource.split('/').at(-1)!;
  if (typeof xml !== 'string' || !xml.trim() || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new Error('Invalid Commons manifest XML.');
  }
  const document: unknown = parser.parse(xml);
  if (!record(document) || Object.keys(document).length !== 1 || !('content' in document)) {
    throw new Error('Invalid Commons manifest: expected a single content root.');
  }
  const content = document.content;
  const playing = child(content, 'content_playing_info');
  if (!record(content) || !record(playing)) throw new Error('Invalid Commons manifest: missing content playing information.');
  if (playing.content_id !== undefined && !text(playing.content_id)) throw new Error('Invalid Commons manifest content ID.');
  const contentId = text(playing.content_id) || sourceId;
  if (!CONTENT_ID.test(contentId) || contentId !== sourceId) throw new Error('Commons manifest content ID does not match the source URL.');
  const title = text(child(content.content_metadata, 'title')) || contentId;

  const directByName = new Map<string, Candidate[]>();
  for (const candidate of collectDirect(playing.main_media)) {
    const name = decodeURIComponent(new URL(candidate.url).pathname.split('/').at(-1)!);
    const existing = directByName.get(name) ?? [];
    existing.push(candidate);
    directByName.set(name, existing);
  }

  const templates: Candidate[] = [];
  const service = content.service_root;
  for (const entry of list(child(child(service, 'media'), 'media_uri'))) {
    const template = text(entry);
    const rank = methodRank(text(child(entry, '@_method')), text(child(entry, '@_target')), true);
    if (rank !== undefined && template.split(MEDIA_TOKEN).length === 2 && progressiveCandidate(template.replace(MEDIA_TOKEN, 'probe.mp4'), rank)) {
      templates.push({ url: template, rank });
    }
  }
  const webRoot = secureUrl(text(child(service, 'web')), MEDIA_HOSTS);
  if (webRoot && !webRoot.search && !webRoot.hash) {
    const root = webRoot.href.replace(/\/$/, '').replace(/\/web_files$/, '');
    templates.push({ url: `${root}/media_files/${MEDIA_TOKEN}`, rank: 4 });
  }

  const sequence: StoryFile[] = [];
  let previousStory: string | undefined;
  for (const story of list(child(playing.story_list, 'story'))) {
    // Only collapse an exact adjacent duplicate story, not a later intentional repeat.
    const signature = JSON.stringify(story);
    if (signature === previousStory) continue;
    previousStory = signature;
    const files = list(child(child(story, 'main_media_list'), 'main_media'));
    for (const entry of files) {
      const raw = text(entry);
      if (!raw) continue;
      const file = fileFromPath(raw);
      if (!file) throw new Error(`Unsupported Commons story media file: ${raw}`);
      sequence.push(file);
    }
  }

  let parts: MediaPart[];
  if (sequence.length) {
    parts = sequence.map(file => {
      const candidates = templates.flatMap(template => {
        const candidate = progressiveCandidate(template.url.replace(MEDIA_TOKEN, file.path), template.rank);
        return candidate ? [candidate] : [];
      });
      candidates.push(...(directByName.get(file.name) ?? []));
      const urls = candidatesToUrls(candidates);
      if (!urls.length) throw new Error(`No supported media URL for Commons story file: ${file.name}`);
      return { name: file.name, urls };
    });
  } else {
    parts = Array.from(directByName, ([name, candidates]) => ({ name, urls: candidatesToUrls(candidates) }));
  }
  if (!parts.length) throw new Error('No supported progressive media found in Commons manifest.');
  return { contentId, title, sourceUrl: canonicalSource, parts };
}

export async function resolveCommons(sourceUrl: string, signal?: AbortSignal): Promise<CommonsManifest> {
  const canonicalSource = normalizeCommonsUrl(sourceUrl);
  const contentId = canonicalSource.split('/').at(-1)!;
  const endpoint = `https://${COMMONS_HOST}/viewer/ssplayer/uniplayer_support/content.php?content_id=${encodeURIComponent(contentId)}`;
  signal?.throwIfAborted();
  const response = await fetch(endpoint, { credentials: 'omit', redirect: 'follow', signal });
  signal?.throwIfAborted();
  if (!secureUrl(response.url, new Set([COMMONS_HOST]))) throw new Error('Unsafe Commons manifest redirect URL.');
  if (!response.ok) throw new Error(`Commons manifest request failed (HTTP ${response.status}).`);
  const xml = await response.text();
  signal?.throwIfAborted();
  return parseCommonsManifest(xml, canonicalSource);
}
