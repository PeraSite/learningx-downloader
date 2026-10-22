import { afterEach, describe, expect, mock, test } from 'bun:test';
import { isAllowedMediaUrl, normalizeCommonsUrl, parseCommonsManifest, resolveCommons } from '../../src/commons';

const SOURCE = 'https://commons.ssu.ac.kr/em/5fa15645373fb';
const ID = '5fa15645373fb';
const CDN = 'https://ssuin-object.commonscdn.com/videos';
const TOAST = 'https://ssu-toast.commonscdn.com/videos';
const COMMONS = 'https://commons.ssu.ac.kr/videos';
const ENDPOINT = `https://commons.ssu.ac.kr/viewer/ssplayer/uniplayer_support/content.php?content_id=${ID}`;
const fixture = (playing: string, service = '', id = ID) => `<?xml version="1.0"?><content><content_playing_info><content_id>${id}</content_id>${playing}</content_playing_info><content_metadata><title><![CDATA[강의 & 장면 분석]]></title></content_metadata>${service}</content>`;
const direct = (url: string, method = 'progressive') => `<html5><method>${method}</method><media_uri>${url}</media_uri></html5>`;
const story = (name: string) => `<story><main_media_list><main_media>${name}</main_media></main_media_list></story>`;
const templates = `<service_root><media><media_uri method="pseudo">${COMMONS}/[MEDIA_FILE]</media_uri><media_uri method="progressive" target="mobile">${TOAST}/[MEDIA_FILE]</media_uri><media_uri method="hls">${CDN}/[MEDIA_FILE]</media_uri><media_uri method="progressive" target="all">${CDN}/[MEDIA_FILE]</media_uri></media></service_root>`;

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function response(xml: string, url = ENDPOINT, status = 200): Response {
  const result = new Response(xml, { status });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}

describe('normalizeCommonsUrl', () => {
  test('returns a canonical source and removes query, fragment and trailing slash', () => {
    expect(normalizeCommonsUrl(`${SOURCE}/?autoplay=1#player`)).toBe(SOURCE);
    expect(normalizeCommonsUrl('HTTPS://COMMONS.SSU.AC.KR/em/abc_123-xyz')).toBe('https://commons.ssu.ac.kr/em/abc_123-xyz');
  });
  test.each([
    'http://commons.ssu.ac.kr/em/abc', 'https://commons.ssu.ac.kr:443/em/abc',
    'https://user:pass@commons.ssu.ac.kr/em/abc', 'https://commons.ssu.ac.kr.evil.com/em/abc',
    'https://ssuin-object.commonscdn.com/em/abc', 'https://commons.ssu.ac.kr./em/abc',
    'https://commons.ssu.ac.kr/em/', 'https://commons.ssu.ac.kr/em/a/b',
    'https://commons.ssu.ac.kr/em/%2e%2e', 'https://commons.ssu.ac.kr/a/../em/abc',
    'https://commons.ssu.ac.kr/em/ab%2fcd', 'https://commons.ssu.ac.kr/em/..',
    ' https://commons.ssu.ac.kr/em/abc', 'https://commons.ssu.ac.kr\\em\\abc',
    'https://commons.ssu.ac.kr/em/a\nb', 'https://commons.ssu.ac.kr/em/a?bad=%ZZ',
    'not a URL', '//commons.ssu.ac.kr/em/abc',
  ])('rejects invalid source %s', url => { expect(() => normalizeCommonsUrl(url)).toThrow(); });
});

describe('isAllowedMediaUrl', () => {
  test.each([COMMONS, CDN, TOAST])('allows only exact trusted HTTPS hosts: %s', root => {
    expect(isAllowedMediaUrl(`${root}/clip.mp4?token=abc%2Bdef`)).toBe(true);
  });
  test.each([
    'http://commons.ssu.ac.kr/a.mp4', 'https://commons.ssu.ac.kr:443/a.mp4',
    'https://commons.ssu.ac.kr:8443/a.mp4', 'https://user@ssuin-object.commonscdn.com/a.mp4',
    'https://ssu-toast.commonscdn.com.evil.com/a.mp4', 'https://evil.commons.ssu.ac.kr/a.mp4',
    'https://commons.ssu.ac.kr./a.mp4', 'https://%63ommons.ssu.ac.kr/a.mp4',
    'https://ssuin-object.commonscdn.com\\@evil.com/a.mp4', 'data:video/mp4;base64,AAA',
    'javascript:alert(1)', '/a.mp4', 'https://commons.ssu.ac.kr/a%ZZ.mp4',
  ])('rejects an unsafe media URL: %s', url => { expect(isAllowedMediaUrl(url)).toBe(false); });
});

describe('parseCommonsManifest', () => {
  test('two direct mirrors with the same basename form one part', () => {
    const xml = fixture(`<main_media><desktop>${direct(`${CDN}/ssmovie.mp4`)}<flash_fallback><method>pseudo</method><media_uri>${COMMONS}/ssmovie.mp4</media_uri></flash_fallback></desktop><mobile>${direct(`${CDN}/ssmovie.mp4`)}</mobile></main_media>`);
    expect(parseCommonsManifest(xml, SOURCE)).toEqual({
      contentId: ID, title: '강의 & 장면 분석', sourceUrl: SOURCE,
      parts: [{ name: 'ssmovie.mp4', urls: [`${CDN}/ssmovie.mp4`, `${COMMONS}/ssmovie.mp4`] }],
    });
  });
  test('preserves story order and merges matching direct mirrors without appending unrelated media', () => {
    const xml = fixture(`<story_list>${story('second.mp4')}${story('first.mp4')}</story_list><main_media><desktop>${direct(`${CDN}/second.mp4`)}</desktop><mobile>${direct(`${COMMONS}/other-path/second.mp4`)}</mobile><extra>${direct(`${CDN}/unrelated.mp4`)}</extra></main_media>`, templates);
    const result = parseCommonsManifest(xml, `${SOURCE}?x=1`);
    expect(result.sourceUrl).toBe(SOURCE);
    expect(result.parts).toEqual([
      { name: 'second.mp4', urls: [`${CDN}/second.mp4`, `${TOAST}/second.mp4`, `${COMMONS}/other-path/second.mp4`, `${COMMONS}/second.mp4`] },
      { name: 'first.mp4', urls: [`${CDN}/first.mp4`, `${TOAST}/first.mp4`, `${COMMONS}/first.mp4`] },
    ]);
  });
  test('collapses exact adjacent duplicate stories but preserves non-adjacent repeats', () => {
    const result = parseCommonsManifest(fixture(`<story_list>${story('a.mp4')}${story('a.mp4')}${story('b.mp4')}${story('a.mp4')}</story_list>`, templates), SOURCE);
    expect(result.parts.map(part => part.name)).toEqual(['a.mp4', 'b.mp4', 'a.mp4']);
  });
  test('groups direct-only filenames in their first-seen order and deduplicates exact URLs', () => {
    const xml = fixture(`<main_media><a>${direct(`${CDN}/b.mp4`)}</a><b>${direct(`${TOAST}/b.mp4`)}</b><c>${direct(`${CDN}/a.mp4`)}</c><d>${direct(`${CDN}/b.mp4`)}</d></main_media>`);
    expect(parseCommonsManifest(xml, SOURCE).parts).toEqual([
      { name: 'b.mp4', urls: [`${CDN}/b.mp4`, `${TOAST}/b.mp4`] },
      { name: 'a.mp4', urls: [`${CDN}/a.mp4`] },
    ]);
  });
  test('uses web_files fallback and supports safely encoded nested filenames', () => {
    const xml = fixture(`<story_list>${story('mobile/강의 1.mp4')}</story_list>`, `<service_root><web>${COMMONS}/web_files/</web></service_root>`);
    expect(parseCommonsManifest(xml, SOURCE).parts).toEqual([{ name: '강의 1.mp4', urls: [`${COMMONS}/media_files/mobile/${encodeURIComponent('강의 1.mp4')}`] }]);
  });
  test('does not include HLS, DASH, RTMP, unsafe hosts or unsupported method URLs', () => {
    const xml = fixture(`<main_media><a>${direct(`${CDN}/clip.mp4`)}</a><b>${direct(`${CDN}/playlist.m3u8`, 'hls')}</b><c>${direct('rtmp://commons.ssu.ac.kr/clip.mp4', 'rtmp')}</c><d>${direct(`${CDN}/clip.mpd`, 'dash')}</d><e>${direct('https://evil.com/clip.mp4')}</e><f>${direct(`${TOAST}/clip.mp4`, 'hls')}</f></main_media>`);
    expect(parseCommonsManifest(xml, SOURCE).parts).toEqual([{ name: 'clip.mp4', urls: [`${CDN}/clip.mp4`] }]);
  });
  test.each([
    '', '<content>', '<html><body>Login</body></html>', '<content/>',
    fixture('<main_media/>'),
    `${fixture(`<main_media>${direct(`${CDN}/clip.mp4`)}</main_media>`)}<unexpected/>`,
    fixture(`<main_media>${direct(`${CDN}/clip.mp4`)}</main_media>`, '', ''), fixture(`<main_media>${direct('https://evil.com/clip.mp4')}</main_media>`),
    fixture(`<main_media>${direct(`${CDN}/playlist.m3u8`)}</main_media>`),
    fixture(`<main_media>${direct('rtmp://commons.ssu.ac.kr/clip.mp4')}</main_media>`),
    fixture(`<story_list>${story('../secret.mp4')}</story_list>`, templates),
    fixture(`<story_list>${story('playlist.m3u8')}</story_list>`, templates),
    fixture(`<story_list>${story('a.mp4')}${story('b.mp4')}</story_list><main_media>${direct(`${CDN}/a.mp4`)}</main_media>`),
    fixture(`<main_media>${direct(`${CDN}/clip.mp4`)}</main_media>`, '', 'wrong-id'),
    `<!DOCTYPE content [<!ENTITY x "test">]>${fixture(`<main_media>${direct(`${CDN}/clip.mp4`)}</main_media>`)}`,
  ])('rejects malformed, incomplete or unsupported content', xml => {
    expect(() => parseCommonsManifest(xml, SOURCE)).toThrow();
  });
  test('preserves a numeric-looking content ID and falls back to it as the title', () => {
    const xml = `<content><content_playing_info><content_id>000123</content_id><main_media>${direct(`${CDN}/clip.mp4`)}</main_media></content_playing_info></content>`;
    expect(parseCommonsManifest(xml, 'https://commons.ssu.ac.kr/em/000123').title).toBe('000123');
  });
});

describe('resolveCommons', () => {
  const xml = fixture(`<main_media>${direct(`${CDN}/clip.mp4`)}</main_media>`);
  test('fetches only the derived endpoint without credentials and forwards the signal', async () => {
    const controller = new AbortController();
    const fetchMock = mock(async () => response(xml));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect((await resolveCommons(`${SOURCE}/?autoplay=1`, controller.signal)).parts).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(ENDPOINT, { credentials: 'omit', redirect: 'follow', signal: controller.signal });
  });
  test.each(['https://evil.com/manifest', 'http://commons.ssu.ac.kr/manifest', 'https://commons.ssu.ac.kr:443/manifest', `${CDN}/manifest`, ''])('rejects unapproved final response URL %s', async url => {
    globalThis.fetch = mock(async () => response(xml, url)) as unknown as typeof fetch;
    await expect(resolveCommons(SOURCE)).rejects.toThrow('redirect');
  });
  test('accepts a safe same-origin redirect and checks the returned XML', async () => {
    globalThis.fetch = mock(async () => response(xml, 'https://commons.ssu.ac.kr/cached/content.xml')) as unknown as typeof fetch;
    expect((await resolveCommons(SOURCE)).contentId).toBe(ID);
  });
  test('rejects HTTP failures', async () => {
    globalThis.fetch = mock(async () => response('Unavailable', ENDPOINT, 503)) as unknown as typeof fetch;
    await expect(resolveCommons(SOURCE)).rejects.toThrow('HTTP 503');
  });
  test('does not fetch an invalid source or an already-aborted signal', async () => {
    const fetchMock = mock(async () => response(xml));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(resolveCommons('https://evil.com/em/id')).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(resolveCommons(SOURCE, controller.signal)).rejects.toHaveProperty('name', 'AbortError');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test('propagates fetch cancellation and does not parse after body cancellation', async () => {
    const controller = new AbortController();
    globalThis.fetch = mock(async () => { throw new DOMException('Aborted', 'AbortError'); }) as unknown as typeof fetch;
    await expect(resolveCommons(SOURCE, controller.signal)).rejects.toHaveProperty('name', 'AbortError');
    const result = response(xml);
    result.text = async () => { controller.abort(); return xml; };
    globalThis.fetch = mock(async () => result) as unknown as typeof fetch;
    await expect(resolveCommons(SOURCE, controller.signal)).rejects.toHaveProperty('name', 'AbortError');
  });
});
