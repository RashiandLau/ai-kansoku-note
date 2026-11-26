import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { collect, createFetcher, USER_AGENT } from '../scripts/collect.mjs';
import { deduplicateSelection, normalizeUrl } from '../scripts/lib/selection.mjs';
import { parsePageMetadata, parseRss } from '../scripts/lib/parsers.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = path.join(ROOT, 'fixtures');
const NOW = '2026-11-15T03:00:00Z';
async function scratch(t) {
  const dir = await mkdtemp(path.join(ROOT, '.test-collect-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('fixture collection writes the full raw contract, bounded selections and state', async (t) => {
  const out = await scratch(t);
  const result = await collect({ fixtures: FIXTURES, now: NOW, out });
  const disk = JSON.parse(await readFile(path.join(out, 'raw', '2026-11-15.json'), 'utf8'));
  assert.deepEqual(disk, result);
  assert.equal(result.date, '2026-11-15');
  assert.equal(result.generatedAt, '2026-11-15T03:00:00.000Z');
  assert.deepEqual(result.errors, []);
  assert.equal(result.items[result.top].objectID, '50497589');
  assert.equal(result.selected[0], result.top);
  assert.equal(new Set(result.selected).size, result.selected.length);
  const selected = result.selected.map((id) => result.items[id]);
  assert.equal(selected.filter((x) => x.kind === 'claudecode').length, 2);
  assert.equal(selected.filter((x) => x.kind === 'codex').length, 1);
  assert.ok(selected.filter((x) => x.kind === 'official').length <= 6);
  assert.ok(selected.filter((x) => x.kind === 'japan').length <= 5);
  assert.ok(selected.filter((x) => x.kind === 'trending').length <= 5);
  assert.equal(result.hfmodels.length, 3);
  for (const item of selected) {
    assert.match(item.id, new RegExp(`^${item.kind}-[a-f0-9]+$`));
    for (const key of ['title', 'url', 'source', 'published', 'image', 'ogTitle', 'ogDescription', 'excerpt']) assert.equal(typeof item[key], 'string', `${item.id}.${key}`);
    assert.ok(item.metrics && typeof item.metrics === 'object');
    assert.equal(item.image, '');
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(out, 'state', 'seen.json'), 'utf8')), { claudeCode: '2.1.325', codex: '0.169.0' });
});

test('release state suppresses already seen versions and never regresses', async (t) => {
  const out = await scratch(t);
  const state = path.join(out, 'custom-state.json');
  await writeFile(state, JSON.stringify({ claudeCode: '2.1.323', codex: '0.167.1', custom: true }));
  const first = await collect({ fixtures: FIXTURES, now: NOW, out, state });
  assert.deepEqual(first.selected.map((id) => first.items[id]).filter((x) => x.kind === 'claudecode').map((x) => x.version), ['2.1.325']);
  assert.deepEqual(first.selected.map((id) => first.items[id]).filter((x) => x.kind === 'codex').map((x) => x.version), ['0.169.0', '0.168.0', '0.167.2']);
  const second = await collect({ fixtures: FIXTURES, now: '2026-11-16T03:00:00Z', out, state });
  assert.ok(Object.values(second.items).every((x) => !['claudecode', 'codex'].includes(x.kind)));
  await writeFile(state, JSON.stringify({ claudeCode: '99.0.0', codex: '99.0.0', custom: true }));
  await collect({ fixtures: FIXTURES, now: '2026-11-17T03:00:00Z', out, state });
  assert.deepEqual(JSON.parse(await readFile(state, 'utf8')), { claudeCode: '99.0.0', codex: '99.0.0', custom: true });
});

test('default output is raw/ and state/ below the current working directory', async (t) => {
  const out = await scratch(t);
  const previousDirectory = process.cwd();
  try {
    process.chdir(out);
    await collect({ fixtures: FIXTURES, now: NOW });
  } finally {
    process.chdir(previousDirectory);
  }
  assert.equal(JSON.parse(await readFile(path.join(out, 'raw', '2026-11-15.json'), 'utf8')).date, '2026-11-15');
  assert.equal(JSON.parse(await readFile(path.join(out, 'state', 'seen.json'), 'utf8')).codex, '0.169.0');
});

test('each missing or malformed source becomes a recorded error while healthy sources survive', async (t) => {
  const out = await scratch(t);
  const fixtures = path.join(out, 'fixtures');
  await mkdir(fixtures);
  await writeFile(path.join(fixtures, 'hn-front.json'), await readFile(path.join(FIXTURES, 'hn-front.json')));
  await writeFile(path.join(fixtures, 'codex-releases.json'), '{invalid json');
  await writeFile(path.join(fixtures, 'openai-news.xml'), '<rss>truncated');
  const result = await collect({ fixtures, now: NOW, out });
  assert.equal(result.errors.filter(error => !error.source.startsWith('usage')).length, 9);
  assert.ok(result.errors.every((x) => typeof x.source === 'string' && typeof x.message === 'string'));
  assert.equal(result.items[result.top].objectID, '50497589');
});

test('an official item retains HN discussion even when that HN story is below the 100-point selection threshold', async (t) => {
  const out = await scratch(t);
  const fixtures = path.join(out, 'fixtures');
  await mkdir(fixtures);
  await writeFile(path.join(fixtures, 'openai-news.xml'), await readFile(path.join(FIXTURES, 'openai-news.xml')));
  await writeFile(path.join(fixtures, 'hn-front.json'), JSON.stringify({ hits: [
    { objectID: '101', title: 'AI top story', points: 200, num_comments: 30, created_at: NOW, url: 'https://example.com/top' },
    { objectID: '102', title: 'OpenAI ChatGPT Wallet', points: 20, num_comments: 7, created_at: NOW, url: 'https://openai.com/index/introducing-chatgpt-wallet/?utm_source=hn' },
  ] }));
  const result = await collect({ fixtures, now: NOW, out });
  const official = Object.values(result.items).find((item) => item.kind === 'official');
  assert.deepEqual(official.discussion, { url: 'https://news.ycombinator.com/item?id=102', count: 7, points: 20 });
  assert.equal(Object.values(result.items).filter((item) => item.kind === 'hn').length, 1);
});

test('URL dedupe prefers official sources, carries HN discussion, remaps top and retains Claude versions', () => {
  const candidate = (id, kind, url, extra = {}) => ({ id, kind, url, ...extra });
  const discussion = { url: 'https://news.ycombinator.com/item?id=123', count: 8, points: 900 };
  const hn = candidate('hn-1', 'hn', 'https://example.com/news/?utm_source=hn#comment', { discussion });
  const official = candidate('official-1', 'official', 'https://example.com/news');
  const result = deduplicateSelection([hn, candidate('claudecode-1', 'claudecode', 'https://raw.example.com/CHANGELOG.md', { version: '1.2.1' }), candidate('claudecode-2', 'claudecode', 'https://raw.example.com/CHANGELOG.md', { version: '1.2.0' }), official], hn.id);
  assert.equal(result.top, official.id);
  assert.equal(result.selected[0], official.id);
  assert.deepEqual(result.items[official.id].discussion, discussion);
  assert.equal(result.selected.length, 3);
  assert.equal(result.items['hn-1'], undefined);
  assert.equal(normalizeUrl(hn.url), 'https://example.com/news');
  for (const kind of ['japan', 'trending']) assert.equal(deduplicateSelection([hn, candidate(`${kind}-1`, kind, official.url)], hn.id).top, `${kind}-1`);
  const remainingHN = candidate('hn-2', 'hn', 'https://example.com/other');
  const japan = candidate('japan-2', 'japan', official.url);
  assert.deepEqual(deduplicateSelection([hn, remainingHN, japan], null).selected, [remainingHN.id, japan.id]);
});

test('deduplication restores category ranking after replacing an earlier HN candidate', () => {
  const hn = { id: 'hn-low', kind: 'hn', url: 'https://github.com/example/low', points: 200 };
  const low = { id: 'trending-low', kind: 'trending', url: hn.url, metrics: { starsToday: 10 } };
  const high = { id: 'trending-high', kind: 'trending', url: 'https://github.com/example/high', metrics: { starsToday: 500 } };
  assert.deepEqual(deduplicateSelection([hn, high, low], null).selected, [high.id, low.id]);
  for (const kind of ['official', 'japan']) {
    const old = { id: `${kind}-old`, kind, url: hn.url, published: '2026-11-14T01:00:00Z' };
    const recent = { id: `${kind}-new`, kind, url: 'https://example.com/new', published: NOW };
    assert.deepEqual(deduplicateSelection([hn, recent, old], null).selected, [recent.id, old.id]);
  }
  const lowPoints = { id: 'hn-low-points', kind: 'hn', url: 'https://example.com/low', points: 100, published: NOW };
  const oldHigh = { id: 'hn-old-high', kind: 'hn', url: 'https://example.com/old', points: 200, published: '2026-11-14T01:00:00Z' };
  const newHigh = { id: 'hn-new-high', kind: 'hn', url: 'https://example.com/new', points: 200, published: NOW };
  assert.deepEqual(deduplicateSelection([lowPoints, oldHigh, newHigh], null).selected, [newHigh.id, oldHigh.id, lowPoints.id]);
});

test('all-section URL dedupe retains meaningful sorted queries and HN item IDs', () => {
  assert.equal(normalizeUrl('https://EXAMPLE.com/a/?z=2&a=1&utm_campaign=x&fbclid=y&gclid=z&ref_src=r#s'), 'https://example.com/a?a=1&z=2');
  const result = deduplicateSelection([
    { id: 'a', kind: 'hn', url: 'https://news.ycombinator.com/item?id=1' },
    { id: 'b', kind: 'hn', url: 'https://news.ycombinator.com/item?id=2' },
  ], null);
  assert.deepEqual(result.selected, ['a', 'b']);
});

test('a same-issue rerun reuses fixed raw without fetching or advancing state', async t => {
  const out = await scratch(t);
  const original = await collect({ fixtures: FIXTURES, now: NOW, out });
  const state = await readFile(path.join(out, 'state', 'usage.json'), 'utf8');
  const again = await collect({ now: NOW, out, usageCollector: () => { throw new Error('must not run'); } });
  assert.deepEqual(again, original);
  assert.equal(await readFile(path.join(out, 'state', 'usage.json'), 'utf8'), state);
});

test('a malformed fixed issue fails explicitly without re-fetching or overwriting it', async t => {
  const out = await scratch(t);
  await mkdir(path.join(out, 'raw'));
  const rawPath = path.join(out, 'raw', '2026-11-15.json');
  for (const value of ['null', '{}', '{"date":"2026-11-16","selected":[],"items":{}}']) {
    await writeFile(rawPath, value);
    await assert.rejects(collect({ fixtures: FIXTURES, now: NOW, out }), /Invalid existing issue/);
    assert.equal(await readFile(rawPath, 'utf8'), value);
  }
});

test('usage collection failure is recorded and does not break existing sections', async t => {
  const out = await scratch(t);
  const result = await collect({ fixtures: FIXTURES, now: NOW, out,
    usageCollector: async () => { throw new Error('fixture source unavailable'); } });
  assert.ok(result.selected.length > 0);
  assert.ok(Object.values(result.usageSources).every(status => status === 'missing'));
  assert.ok(result.errors.some(error => error.source === 'usage' && /unavailable/.test(error.message)));
});

test('usage integration bootstraps other sections, selects once and never publishes full bodies', async t => {
  const out = await scratch(t);
  const publishedAt = '2026-11-14T00:00:00Z';
  const body = '<p>私が Claude を使って構築した結果です。' + '検証の具体的な記録。'.repeat(180) + '</p><pre>run</pre><pre>save</pre>';
  const make = (url, author) => ({ url, author, title: 'Claudeを使って構築した手順と結果', source: 'zenn', language: 'ja', publishedAt, body, bodyAvailable: true, metrics: { hb: 10, observedAt: NOW } });
  const prior = make('https://zenn.dev/prior/articles/a', 'prior');
  const fresh = make('https://zenn.dev/new/articles/b', 'new');
  await mkdir(path.join(out, 'raw'));
  await writeFile(path.join(out, 'raw', '2026-11-14.json'), JSON.stringify({ date: '2026-11-14', generatedAt: publishedAt, selected: ['other'], items: { other: { ...prior, kind: 'japan', body: undefined } } }));
  const usageCollector = async () => ({ candidates: [prior, fresh], usageSources: { zenn: 'ok' }, errors: [] });
  const result = await collect({ fixtures: FIXTURES, now: NOW, out, usageCollector });
  const usage = result.selected.map(id => result.items[id]).filter(item => item.kind === 'usage');
  assert.deepEqual(usage.map(item => item.url), [fresh.url]);
  assert.equal(usage[0].route, 'A');
  assert.ok([...usage[0].excerpt].length <= 600);
  assert.equal(usage[0].body, undefined);
  assert.doesNotMatch(await readFile(path.join(out, 'state', 'usage.json'), 'utf8'), /<pre>|<p>/);
});

test('Codex release wins over its HN duplicate and retains release content, discussion and top placement', () => {
  const discussion = { url: 'https://news.ycombinator.com/item?id=123', count: 30, points: 200 };
  const release = { id: 'codex-release', kind: 'codex', url: 'https://github.com/openai/codex/releases/tag/rust-v0.169.0', version: '0.169.0', body: 'Release details' };
  const hn = { id: 'hn-release', kind: 'hn', url: `${release.url}?utm_source=hn`, discussion };
  const result = deduplicateSelection([hn, release], hn.id);
  assert.deepEqual(result.selected, [release.id]);
  assert.equal(result.top, release.id);
  assert.equal(result.items[release.id].version, '0.169.0');
  assert.equal(result.items[release.id].body, 'Release details');
  assert.deepEqual(result.items[release.id].discussion, discussion);
});

// Real Japanese bytes catch accidental UTF-8 decoding that string-only mocks hide.
const JAPANESE_SJIS = Buffer.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]);
function encodedBody(prefix, bytes = JAPANESE_SJIS, suffix = '') {
  return Buffer.concat([Buffer.from(prefix), bytes, Buffer.from(suffix)]);
}
async function fetchedBody(bytes, contentType) {
  const fetchText = createFetcher({ fetchImpl: async () => new Response(bytes, {
    headers: contentType ? { 'Content-Type': contentType } : {},
  }) });
  return fetchText('https://example.com/japanese');
}

test('fetcher decodes Japanese HTTP charset aliases from response bytes', async (t) => {
  for (const charset of ['shift_jis', 'sjis', 'x-sjis', 'windows-31j', 'cp932']) {
    await t.test(charset, async () => {
      const html = await fetchedBody(encodedBody('<title>', JAPANESE_SJIS, '</title>'), `text/html; ChArSeT = "${charset.toUpperCase()}"`);
      assert.equal(html, '<title>日本語</title>');
    });
  }
  for (const [charset, bytes] of [
    ['euc-jp', [0xc6, 0xfc, 0xcb, 0xdc, 0xb8, 0xec]],
    ['iso-2022-jp', [0x1b, 0x24, 0x42, 0x46, 0x7c, 0x4b, 0x5c, 0x38, 0x6c, 0x1b, 0x28, 0x42]],
  ]) {
    await t.test(charset, async () => {
      assert.equal(await fetchedBody(Buffer.from(bytes), `text/html; charset=${charset}`), '日本語');
    });
  }
});

test('fetcher prefers the HTTP charset over a conflicting HTML meta declaration', async () => {
  const shiftJis = await fetchedBody(encodedBody('<meta charset="utf-8"><p>', JAPANESE_SJIS, '</p>'), 'text/html; charset=shift_jis');
  assert.equal(shiftJis, '<meta charset="utf-8"><p>日本語</p>');
  const utf8 = '<meta charset="shift_jis"><p>日本語</p>';
  assert.equal(await fetchedBody(Buffer.from(utf8), 'text/html; charset=utf-8'), utf8);
});

test('fetcher sniffs both HTML meta charset forms regardless of case, quotes and attribute order', async (t) => {
  for (const meta of [
    '<meta charset="shift_jis">',
    "<META CHARSET='SJIS'>",
    '<meta data-name="source" charset=x-sjis>',
    '<meta charset="cp932" data-name="source">',
    '<meta http-equiv="Content-Type" content="text/html; charset=windows-31j">',
    "<META CONTENT='text/html; CHARSET=Shift_JIS' HTTP-EQUIV='CONTENT-TYPE'>",
    '<meta http-equiv=Content-Type content="text/html; charset=\'shift_jis\'">',
    '<meta content=charset=shift_jis http-equiv=content-type>',
  ]) {
    await t.test(meta, async () => {
      assert.equal(await fetchedBody(encodedBody(`${meta}<p>`, JAPANESE_SJIS, '</p>'), 'text/html'), `${meta}<p>日本語</p>`);
    });
  }
});

test('meta sniffing uses only complete tags within the first 4096 response bytes', async () => {
  const meta = '<meta charset="shift_jis">';
  const inside = ' '.repeat(4096 - Buffer.byteLength(meta)) + meta;
  assert.equal(await fetchedBody(encodedBody(inside)), `${inside}日本語`);
  for (const prefix of [
    ' '.repeat(4096 - Buffer.byteLength(meta) + 1) + meta,
    ' '.repeat(4096) + meta,
    'あ'.repeat(1366) + meta,
  ]) {
    const bytes = encodedBody(prefix);
    assert.equal(await fetchedBody(bytes), bytes.toString('utf8'));
  }
});

test('fetcher falls back to UTF-8 without a usable charset declaration', async () => {
  for (const prefix of [
    '',
    '<meta charset="not-a-real-encoding">',
    '<meta content="text/html; charset=shift_jis">',
    '<meta http-equiv="refresh" content="text/html; charset=shift_jis">',
    '<meta data-charset="shift_jis">',
  ]) {
    const html = `${prefix}<p>日本語</p>`;
    assert.equal(await fetchedBody(Buffer.from(html)), html);
  }
  const html = '<p>日本語</p>';
  assert.equal(await fetchedBody(Buffer.from(html), 'text/html; charset=not-a-real-encoding'), html);
  const meta = '<meta charset="shift_jis">';
  assert.equal(await fetchedBody(encodedBody(meta), 'text/html; charset=not-a-real-encoding'), `${meta}日本語`);
});

test('Japanese response bytes reach article metadata and RSS parsers without corruption', async () => {
  const page = await fetchedBody(encodedBody('<meta charset="shift_jis"><meta property="og:title" content="', JAPANESE_SJIS, '">'));
  assert.equal(parsePageMetadata(page, 'https://example.com/article').ogTitle, '日本語');
  const rss = await fetchedBody(encodedBody('<rss><channel><item><title>', JAPANESE_SJIS,
    '</title><link>https://example.com/article</link><pubDate>Sun, 15 Nov 2026 03:00:00 GMT</pubDate></item></channel></rss>'), 'application/rss+xml; charset=cp932');
  assert.equal(parseRss(rss, 'https://example.com/rss')[0].title, '日本語');
});

test('fetcher caps concurrency at four and limits the GitHub token to api.github.com', async () => {
  let active = 0;
  let peak = 0;
  const calls = [];
  const fetchText = createFetcher({ token: 'test-token', fetchImpl: async (url, options) => {
    active += 1; peak = Math.max(peak, active); calls.push({ url, options });
    return { ok: true, status: 200, arrayBuffer: async () => { await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; return new TextEncoder().encode('body').buffer; } };
  } });
  await Promise.all(Array.from({ length: 12 }, (_, index) => fetchText(index === 0 ? 'https://api.github.com/repos/openai/codex/releases' : 'https://example.com/article')));
  assert.equal(peak, 4);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.ok(calls.slice(1).every((x) => !('Authorization' in x.options.headers)));
  assert.ok(calls.every((x) => x.options.headers['User-Agent'] === USER_AGENT));
});

test('fetch timeout covers response body and redirects do not carry GitHub credentials', async () => {
  const timeoutFetch = createFetcher({ timeoutMs: 15, fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: () => new Promise(() => {}) }) });
  await assert.rejects(timeoutFetch('https://example.com/stalled'), /timed out|timeout/i);
  const calls = [];
  const redirected = createFetcher({ token: 'test-token', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? { status: 302, headers: new Headers({ location: 'https://example.com/moved' }) } : new Response('ok');
  } });
  assert.equal(await redirected('https://api.github.com/source'), 'ok');
  assert.equal(calls[1].options.headers.Authorization, undefined);
});

test('HTTP failures cancel the unused body so connections can be released', async () => {
  let cancelled = false;
  const fetchText = createFetcher({ fetchImpl: async () => ({ ok: false, status: 503, body: { cancel: async () => { cancelled = true; } } }) });
  await assert.rejects(fetchText('https://example.com/unavailable'), /HTTP 503/);
  assert.equal(cancelled, true);
});
