import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectUsageSources, createUsageFetcher, createUsageFixtureFetch, parseHatenaFeed, parseHNUsage,
  parseQiitaItems, parseSimonEntries, parseUsageArticle, parseZennArticle, publicUsageUrl, robotsPolicy,
  SIMON_ENTRIES_URL, USAGE_SOURCE_KEYS, usagePlainText } from '../scripts/lib/usage-sources.mjs';
import { usageRules } from '../scripts/lib/usage.mjs';

const fixtures = fileURLToPath(new URL('../fixtures/usage/', import.meta.url));
const now = '2026-11-26T03:00:00Z';
const saved = async (name) => readFile(path.join(fixtures, name), 'utf8');
const savedJson = async (name) => JSON.parse(await saved(name));
const response = (value, init) => new Response(typeof value === 'string' ? value : JSON.stringify(value), init);
function fakeTransport(fetchImpl, overrides = {}) {
  let time = 0;
  const pauses = [];
  return { pauses, get time() { return time; }, transport: createUsageFetcher({ fetchImpl, resolveHost: null,
    clock: () => time, sleep: async (ms) => { pauses.push(ms); time += ms; }, ...overrides }) };
}
function blankFetch(overrides = () => undefined) {
  const calls = [];
  const fetchImpl = async (target, options) => {
    calls.push(target);
    const custom = await overrides(target, options);
    if (custom) return custom;
    if (target.startsWith('https://zenn.dev/api/articles?')) return response({ articles: [], next_page: null });
    if (target.startsWith('https://qiita.com/api/v2/items?')) return response([]);
    if (target.startsWith('https://b.hatena.ne.jp/hotentry')) return response('<rss><channel></channel></rss>');
    if (target.startsWith('https://hn.algolia.com/')) return response({ hits: [], nbHits: 0 });
    if (target === SIMON_ENTRIES_URL) return response('<feed></feed>');
    if (target.startsWith('https://bookmark.hatenaapis.com/')) {
      return response(Object.fromEntries(new URL(target).searchParams.getAll('url').map((u) => [u, 0])));
    }
    if (target.endsWith('/robots.txt')) return response('User-agent: *\nDisallow: /private');
    throw new Error(`Unexpected test URL ${target}`);
  };
  return { calls, fetchImpl };
}
const collectFake = (network, options = {}) => collectUsageSources({ now, fetchImpl: network.fetchImpl, sleep: async () => {}, ...options });

test('saved Zenn and Qiita APIs retain native save counts and original authors', async () => {
  const z = parseZennArticle(await savedJson('zenn-article.json'), now);
  assert.equal(z.source, 'zenn'); assert.equal(z.metrics.saves, 41); assert.equal(z.author, 'karamage');
  assert.equal(z.metrics.observedAt, now); assert.ok(z.publishedAt); assert.ok(z.bodyAvailable);
  const q = parseQiitaItems(await savedJson('qiita-list.json'), now)[0];
  assert.equal(q.source, 'qiita'); assert.equal(q.language, 'ja'); assert.ok(q.metrics.saves >= 3);
  assert.throws(() => parseZennArticle({ article: { body_html: 'body' } }, now), /schema/);
  assert.throws(() => parseQiitaItems({}, now), /schema/);
});

test('missing platform metrics stay missing, never become zero', async () => {
  const data = await savedJson('zenn-article.json'); delete data.article.bookmarked_count;
  assert.equal(parseZennArticle(data, now).metrics.saves, undefined);
  const qiita = await savedJson('qiita-list.json'); delete qiita[0].likes_count;
  assert.equal(parseQiitaItems(qiita, now)[0].metrics.likes, undefined);
});

test('Hatena RSS supplies discovery metadata but never article publication or body', async () => {
  const rows = parseHatenaFeed(await saved('hatena.xml'));
  assert.equal(rows.length, 1); assert.equal(rows[0].source, 'hatena'); assert.ok(rows[0].metrics.hb >= 10);
  assert.equal(rows[0].publishedAt, undefined); assert.equal(rows[0].body, undefined);
  assert.throws(() => parseHatenaFeed('<rss><item></rss>'), /Incomplete/);
});

test('HN shortlist preserves matching story signals and does not turn submitter into author', async () => {
  const rows = parseHNUsage(await savedJson('hn.json'));
  assert.equal(rows[0].hnSignals[0].id, '50526152'); assert.equal(rows[0].bodyShortlist, true);
  assert.equal(rows[0].author, undefined); assert.equal(rows[0].publishedAt, undefined);
  const data = await savedJson('hn.json'); data.hits[0].num_comments = 2;
  assert.equal(parseHNUsage(data)[0].bodyShortlist, false);
  data.hits[0].num_comments = 3; data.hits[0].points = 19;
  assert.equal(parseHNUsage(data)[0].bodyShortlist, false);
  data.hits[0].points = 20; data.hits[0].title = 'AI product announcement';
  assert.equal(parseHNUsage(data)[0].bodyShortlist, false);
  assert.throws(() => parseHNUsage({ hits: [] }), /schema/);
});

test('Simon parser accepts only original publication and full content, retains all tags', async () => {
  const rows = parseSimonEntries(await saved('simon-entries.xml'));
  assert.equal(rows.length, 1); assert.equal(rows[0].feedUrl, SIMON_ENTRIES_URL); assert.equal(rows[0].author, 'Simon Willison');
  assert.ok(rows[0].tags.length); assert.ok(rows[0].bodyAvailable); assert.match(rows[0].body, /<p>/);
  const xml = '<feed><entry><title>Example</title><link href="https://simonwillison.net/example/"/><updated>2026-11-25T00:00:00Z</updated><summary>Only an excerpt</summary></entry></feed>';
  const entry = parseSimonEntries(xml)[0]; assert.equal(entry.publishedAt, undefined); assert.equal(entry.bodyAvailable, false);
  assert.throws(() => parseSimonEntries(xml.replace('simonwillison.net', 'example.com')), /Invalid Simon/);
});

test('HTML extraction scopes bodies, nested note divs and original date, without updated fallback', async () => {
  const note = parseUsageArticle(await saved('note.html'), 'https://note.com/example/n/example');
  assert.ok(note.bodyAvailable); assert.ok(note.publishedAt); assert.ok(note.author);
  const nested = '<script type="application/ld+json">{"@type":"BlogPosting","datePublished":"2026-11-25","dateModified":"2026-11-26"}</script><div id="note-body">first<div>nested</div>last</div>';
  assert.equal(parseUsageArticle(nested, 'https://note.com/p').body, 'first<div>nested</div>last');
  assert.equal(parseUsageArticle(nested.replace('datePublished', 'unknown'), 'https://note.com/p').publishedAt, undefined);
  assert.equal(parseUsageArticle('<body>Navigation and no article</body>', 'https://example.com/p').bodyAvailable, false);
});

test('cross-host canonical and paywalls fail closed, same-host canonical needs publication', () => {
  const html = '<link rel="canonical" href="https://original.example/p"><meta property="article:published_time" content="2026-11-25T00:00:00Z"><article>Body</article>';
  assert.equal(parseUsageArticle(html, 'https://copy.example/p').publishedAt, undefined);
  assert.equal(parseUsageArticle(html, 'https://original.example/p').canonicalUrl, 'https://original.example/p');
  const paid = '<script type="application/ld+json">{"@type":"Article","datePublished":"2026-11-25","isAccessibleForFree":false}</script><article>Teaser</article>';
  assert.equal(parseUsageArticle(paid, 'https://example.com/p').bodyAvailable, false);
});

test('an absent canonical link never invents an undefined relative URL', () => {
  const html = '<meta property="article:published_time" content="2026-11-25T00:00:00Z"><article>Actual body</article>';
  assert.equal(parseUsageArticle(html, 'https://example.com/posts/real').canonicalUrl, undefined);
  assert.equal(parseUsageArticle(`<link rel="canonical" href="">${html}`, 'https://example.com/posts/real').canonicalUrl, undefined);
});

test('JSON-LD publication belongs to this article, not an unrelated or ambiguous node', () => {
  const article = (values) => `<script type="application/ld+json">${JSON.stringify({ '@graph': values })}</script><article>Body</article>`;
  const related = { '@type': 'Article', url: 'https://example.com/related', datePublished: '2026-11-25' };
  const original = { '@type': 'Article', mainEntityOfPage: { '@id': 'https://example.com/original' }, datePublished: '2026-11-01' };
  assert.equal(parseUsageArticle(article([related, original]), 'https://example.com/original').publishedAt, '2026-11-01');
  assert.equal(parseUsageArticle(article([related]), 'https://example.com/original').publishedAt, undefined);
  assert.equal(parseUsageArticle(article([{ '@type': 'Article', datePublished: '2026-11-01' }, { '@type': 'Article', datePublished: '2026-11-25' }]), 'https://example.com/original').publishedAt, undefined);
});

test('plain text ignores scripts and decodes entities', () => {
  assert.equal(usagePlainText('<p>I &amp; you</p><script>secret()</script><p>&#x41;&#65;</p>'), 'I & you AA');
});

test('robots respects specific user agent, longest allow and crawl-delay', () => {
  const robots = 'User-agent: *\nDisallow: /\nUser-agent: ai-kansoku-note\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 7';
  assert.deepEqual(robotsPolicy(robots, 'https://example.com/private/public/x'), { allowed: true, delayMs: 7000 });
  assert.equal(robotsPolicy(robots, 'https://example.com/private/x').allowed, false);
  assert.equal(robotsPolicy('User-agent: *\nDisallow: /*?secret=', 'https://example.com/p?secret=x').allowed, false);
});

test('public URL guard blocks credentials, local addresses, unusual ports and non-http schemes', () => {
  for (const u of ['http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/', 'http://10.0.0.1/', 'http://localhost/', 'https://example.com:9999/', 'file:///tmp/body', 'https://user:pass@example.com/']) assert.equal(publicUsageUrl(u), false, u);
  assert.equal(publicUsageUrl('https://example.com/article?id=5'), true);
});

test('same host is serial and spaced by one second; Hatena hosts share a five-second queue', async () => {
  const observed = []; let active = 0, maximum = 0;
  const fake = fakeTransport(async (u) => { active++; maximum = Math.max(maximum, active); observed.push([u, fake.time]); await Promise.resolve(); active--; return response('ok'); });
  await Promise.all([fake.transport.fetchText('https://example.com/a'), fake.transport.fetchText('https://example.com/b')]);
  assert.equal(maximum, 1); assert.equal(observed[1][1] - observed[0][1], 1000);
  await fake.transport.fetchText('https://b.hatena.ne.jp/hotentry.rss');
  await fake.transport.fetchText('https://bookmark.hatenaapis.com/count/entries?url=x');
  assert.equal(observed[3][1] - observed[2][1], 5000);
});

test('403 and 429 stop that host for the run without retry storms', async () => {
  for (const status of [403, 429]) {
    let count = 0;
    const fake = fakeTransport(async () => { count++; return response('no', { status, headers: { 'Retry-After': '300' } }); });
    await assert.rejects(fake.transport.fetchText('https://example.com/a'), /host paused/);
    await assert.rejects(fake.transport.fetchText('https://example.com/b'), /Source paused/);
    assert.equal(count, 1);
  }
});

test('API remaining-zero response is usable but prevents another request', async () => {
  let count = 0;
  const fake = fakeTransport(async () => { count++; return response('last response', { headers: { 'Rate-Remaining': '0' } }); });
  assert.equal((await fake.transport.fetchText('https://qiita.com/api/v2/items')).text, 'last response');
  await assert.rejects(fake.transport.fetchText('https://qiita.com/api/v2/items?page=2'), /paused/); assert.equal(count, 1);
});

test('size limits apply to content-length and streamed bytes', async () => {
  for (const headers of [{ 'Content-Length': '50' }, {}]) {
    const fake = fakeTransport(async () => response('01234567890', { headers }), { maxBytes: 5 });
    await assert.rejects(fake.transport.fetchText('https://example.com/a'), (e) => e.usageStatus === 'truncated');
  }
});

test('request and streamed body timeout cannot hang collection', async () => {
  const stalled = fakeTransport(async () => new Promise(() => {}), { timeoutMs: 5 });
  await assert.rejects(stalled.transport.fetchText('https://example.com/a'), /timed out/);
  const slowBody = fakeTransport(async () => new Response(new ReadableStream({ start() {} })), { timeoutMs: 5 });
  await assert.rejects(slowBody.transport.fetchText('https://example.com/a'), /timed out/);
});

test('article fetch checks robots, honors longer delay and refuses failures/forbidden paths', async () => {
  const calls = [];
  const fake = fakeTransport(async (u) => { calls.push(u); return response(u.endsWith('/robots.txt') ? 'User-agent: *\nDisallow: /private\nCrawl-delay: 4' : '<article>body</article>'); });
  await fake.transport.article('https://example.com/a'); assert.ok(fake.pauses.includes(4000));
  await assert.rejects(fake.transport.article('https://example.com/private/x'), /robots.txt forbids/); assert.equal(calls.length, 2);
  const broken = fakeTransport(async () => response('bad', { status: 500 }));
  await assert.rejects(broken.transport.article('https://example.com/a'), /500/);
  const absent = fakeTransport(async (u) => response('ok', { status: u.endsWith('robots.txt') ? 404 : 200 }));
  assert.equal(await absent.transport.article('https://example.com/a'), 'ok');
});

test('redirect checks reject cross-host/private targets and permit bounded same-host redirects', async () => {
  for (const next of ['http://127.0.0.1/x', 'https://other.example/x']) {
    const fake = fakeTransport(async () => response('', { status: 302, headers: { Location: next } }));
    await assert.rejects(fake.transport.fetchText('https://example.com/a'), /redirect rejected/);
  }
  const fake = fakeTransport(async (u) => u.endsWith('/a') ? response('', { status: 302, headers: { Location: '/b' } }) : response('body'));
  assert.equal((await fake.transport.fetchText('https://example.com/a')).text, 'body');
  const loop = fakeTransport(async () => response('', { status: 302, headers: { Location: '/a' } }));
  await assert.rejects(loop.transport.fetchText('https://example.com/a'), /Too many redirects/);
});

test('DNS results must all be public before any request', async () => {
  let fetched = false;
  const fake = fakeTransport(async () => { fetched = true; return response('body'); }, { resolveHost: async () => ['8.8.8.8', '127.0.0.1'] });
  await assert.rejects(fake.transport.fetchText('https://example.com/a'), /resolved address/); assert.equal(fetched, false);
});

test('DNS timeout and response cleanup cover rejected statuses and stalled bodies', async () => {
  const stalled = fakeTransport(async () => response('unused'), { resolveHost: async () => new Promise(() => {}), timeoutMs: 5 });
  await assert.rejects(stalled.transport.fetchText('https://example.com/a'), /timed out/);
  for (const status of [403, 429, 500, 302, 404]) {
    let cancelled = false;
    const fake = fakeTransport(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status, headers: status === 302 ? { Location: 'https://different.example/a' } : {} }));
    try { await fake.transport.fetchText('https://example.com/a', { allowMissingRobots: true }); } catch {}
    assert.equal(cancelled, true, `HTTP ${status} body was cancelled`);
  }
  let cancelled = false;
  const slow = fakeTransport(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })), { timeoutMs: 5 });
  await assert.rejects(slow.transport.fetchText('https://example.com/a'), /timed out/);
  assert.equal(cancelled, true);
});

test('article redirects re-check robots on every destination path', async () => {
  const calls = [];
  const fake = fakeTransport(async (u) => {
    calls.push(u);
    if (u.endsWith('/robots.txt')) return response('User-agent: *\nDisallow: /private');
    return response('', { status: 302, headers: { Location: '/private/secret' } });
  });
  await assert.rejects(fake.transport.article('https://example.com/public'), /robots.txt forbids/);
  assert.deepEqual(calls, ['https://example.com/robots.txt', 'https://example.com/public']);
});

test('saved fixtures work offline and unmapped requests never call a network fallback', async () => {
  const read = await createUsageFixtureFetch(fixtures);
  await assert.rejects(read('https://unknown.example/missing'), /Missing usage fixture/);
  let called = false;
  const result = await collectUsageSources({ now, fixtures, fetchImpl: async () => { called = true; throw new Error('network forbidden'); } });
  assert.equal(called, false); assert.deepEqual(result.errors, []); assert.deepEqual(Object.keys(result.usageSources), USAGE_SOURCE_KEYS);
  assert.ok(result.candidates.some((c) => c.source === 'zenn'));
  assert.ok(result.candidates.some((c) => c.source === 'qiita'));
  assert.ok(result.candidates.some((c) => c.source === 'simon'));
  const historical = await collectUsageSources({ now: '2026-11-15T03:00:00Z', fixtures });
  assert.deepEqual(historical.errors, []);
});

test('collection visits exactly the approved production source families and twelve Zenn topics', async () => {
  const network = blankFetch(); const result = await collectFake(network);
  assert.deepEqual(result.errors, []);
  const topics = network.calls.filter((u) => u.startsWith('https://zenn.dev/')).map((u) => new URL(u).searchParams.get('topicname'));
  assert.deepEqual(topics, usageRules.collection.zennTopics);
  assert.equal(network.calls.filter((u) => u.startsWith('https://hn.algolia.com/')).length, 7);
  assert.ok(network.calls.includes(SIMON_ENTRIES_URL));
  assert.ok(!network.calls.some((u) => /everything|dev\.to|lobste\.rs|huggingface|github\.com/.test(u)));
});

test('Zenn pages beyond first page until window boundary and fetches only likes >=5', async () => {
  const article = await savedJson('zenn-article.json'); const a = article.article;
  const network = blankFetch((target) => {
    if (target.startsWith('https://zenn.dev/api/articles?')) {
      const u = new URL(target); if (u.searchParams.get('topicname') !== 'claudecode') return response({ articles: [], next_page: null });
      return response(u.searchParams.get('page') === '1' ? { articles: [{ ...a, liked_count: 4 }], next_page: 2 } : { articles: [a, { ...a, slug: 'old', published_at: '2026-11-01T00:00:00Z' }], next_page: 3 });
    }
    if (target.startsWith('https://zenn.dev/api/articles/')) return response(article);
  });
  const result = await collectFake(network);
  assert.equal(result.usageSources.zenn, 'ok'); assert.equal(result.candidates.length, 1);
  assert.equal(network.calls.filter((u) => u.includes('/api/articles/')).length, 1);
  assert.ok(!network.calls.some((u) => u.includes('page=3')));
});

test('Zenn unresolved pagination and Qiita two-query cap are recorded as truncated', async () => {
  const q = (await savedJson('qiita-list.json'))[0];
  const network = blankFetch((target) => {
    if (target.startsWith('https://zenn.dev/api/articles?')) return response({ articles: [], next_page: Number(new URL(target).searchParams.get('page')) + 1 });
    if (target.startsWith('https://qiita.com/api/v2/items?')) return response(Array(100).fill(q));
  });
  const result = await collectFake(network, { limits: { zennPages: 1 } });
  assert.equal(result.usageSources.zenn, 'truncated'); assert.equal(result.usageSources.qiita, 'truncated');
  assert.equal(network.calls.filter((u) => u.startsWith('https://qiita.com/api/')).length, 2);
  assert.ok(network.calls.filter((u) => u.startsWith('https://qiita.com/')).every((u) => u.includes('/items?')));
});

test('one forbidden source cannot break successful sources or retry-storm', async () => {
  const network = blankFetch((u) => u.startsWith('https://zenn.dev/') ? response('no', { status: 403 }) : undefined);
  const result = await collectFake(network);
  assert.equal(result.usageSources.zenn, 'forbidden'); assert.equal(result.usageSources.simon, 'ok'); assert.equal(result.usageSources.qiita, 'ok');
  assert.equal(network.calls.filter((u) => u.startsWith('https://zenn.dev/')).length, 1);
});

test('HN splits saturated date ranges instead of silently dropping hits', async () => {
  let first = true;
  const network = blankFetch((u) => {
    if (u.startsWith('https://hn.algolia.com/') && first) { first = false; return response({ hits: [], nbHits: 1001 }); }
  });
  const result = await collectFake(network);
  assert.equal(result.usageSources.hn, 'ok'); assert.equal(network.calls.filter((u) => u.startsWith('https://hn.algolia.com/')).length, 9);
});

test('HN body daily budget includes unique URLs and records truncation', async () => {
  const hits = Array.from({ length: 22 }, (_, i) => ({ objectID: String(i + 1), title: 'How I used AI agents', url: `https://example.com/article-${i}`, created_at: '2026-11-25T00:00:00Z', points: 50 + i, num_comments: 5 }));
  const network = blankFetch((u) => {
    if (u.startsWith('https://hn.algolia.com/')) return response({ hits, nbHits: hits.length });
    if (u.startsWith('https://example.com/article-')) return response('<meta property="article:published_time" content="2026-11-25T00:00:00Z"><article>I used AI.</article>');
  });
  const result = await collectFake(network);
  assert.equal(result.usageSources.hn, 'truncated'); assert.equal(network.calls.filter((u) => u.startsWith('https://example.com/article-')).length, 20);
});

test('pending Zenn bodies refresh, expired entries disappear, and failed stale reactions are not reused', async () => {
  const a = parseZennArticle(await savedJson('zenn-article.json'), '2026-11-25T00:00:00Z');
  const network = blankFetch((u) => u.startsWith('https://zenn.dev/api/articles/') ? response('temporary', { status: 500 }) : undefined);
  const result = await collectFake(network, { pending: [a, { ...a, url: 'https://zenn.dev/x/articles/expired', publishedAt: '2026-11-01T00:00:00Z' }] });
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].bodyAvailable, false);
  assert.equal(result.candidates[0].metrics.saves, undefined); assert.equal(result.candidates[0].metrics.likes, undefined);
  assert.ok(!network.calls.some((u) => u.includes('expired')));
});

test('Hatena count calls batch no more than forty URLs and missing counts stay missing', async () => {
  const q = (await savedJson('qiita-list.json'))[0];
  const network = blankFetch((u) => {
    if (u.startsWith('https://qiita.com/api/v2/items?')) return response(Array.from({ length: 45 }, (_, i) => ({ ...q, url: `https://qiita.com/test/items/item${i}` })));
    if (u.startsWith('https://bookmark.hatenaapis.com/')) return response({});
  });
  const result = await collectFake(network);
  const counts = network.calls.filter((u) => u.startsWith('https://bookmark.hatenaapis.com/'));
  assert.deepEqual(counts.map((u) => new URL(u).searchParams.getAll('url').length), [40, 5]);
  assert.equal(result.usageSources.hatenaCount, 'missing'); assert.ok(result.candidates.every((c) => c.metrics.hb === undefined));
});

test('Hatena count circuit break leaves later unrequested batches missing', async () => {
  const q = (await savedJson('qiita-list.json'))[0];
  const network = blankFetch((u) => {
    if (u.startsWith('https://qiita.com/api/v2/items?')) return response(Array.from({ length: 85 }, (_, i) => ({ ...q, url: `https://qiita.com/test/items/item${i}` })));
    if (u.startsWith('https://bookmark.hatenaapis.com/')) return response('rate limited', { status: 429 });
  });
  const result = await collectFake(network);
  assert.equal(network.calls.filter((u) => u.startsWith('https://bookmark.hatenaapis.com/')).length, 1);
  assert.equal(result.usageSources.hatenaCount, 'missing'); assert.ok(result.candidates.every((c) => c.metrics.hb === undefined));
});

test('Simon summary-only entries fetch original body through robots while keeping feed provenance', async () => {
  const network = blankFetch((u) => {
    if (u === SIMON_ENTRIES_URL) return response('<feed><entry><title>How I used AI</title><link href="https://simonwillison.net/p/"/><published>2026-11-25T00:00:00Z</published><category term="coding-agents"/><summary>Excerpt</summary></entry></feed>');
    if (u === 'https://simonwillison.net/p/') return response('<meta property="article:published_time" content="2026-11-25T00:00:00Z"><article>Full body</article>');
  });
  const result = await collectFake(network); const c = result.candidates[0];
  assert.equal(c.body, 'Full body'); assert.equal(c.feedUrl, SIMON_ENTRIES_URL); assert.equal(c.author, 'Simon Willison');
  assert.ok(network.calls.includes('https://simonwillison.net/robots.txt'));
});

test('Hatena and HN discoveries never cause per-item Qiita requests', async () => {
  const network = blankFetch((u) => {
    if (u.startsWith('https://b.hatena.ne.jp/')) return response('<rss><channel><item><title>How I used AI</title><link>https://qiita.com/user/items/unknown</link><hatena:bookmarkcount>20</hatena:bookmarkcount></item></channel></rss>');
    if (u.startsWith('https://hn.algolia.com/')) return response({ hits: [{ objectID: '99', title: 'How I used AI', url: 'https://qiita.com/user/items/unknown', created_at: '2026-11-25T00:00:00Z', points: 20, num_comments: 3 }], nbHits: 1 });
  });
  const result = await collectFake(network);
  assert.ok(result.errors.some((e) => /no per-item request/.test(e.message)));
  assert.ok(network.calls.filter((u) => u.startsWith('https://qiita.com/')).every((u) => u.startsWith('https://qiita.com/api/v2/items?')));
});

test('verified same-host canonical preserves original URL alias and HN signals', async () => {
  const network = blankFetch((u) => {
    if (u.startsWith('https://hn.algolia.com/')) return response({ hits: [{ objectID: '99', title: 'How I used AI', url: 'https://example.com/alias', created_at: '2026-11-25T00:00:00Z', points: 20, num_comments: 3 }], nbHits: 1 });
    if (u === 'https://example.com/alias') return response('<link rel="canonical" href="https://example.com/original"><meta property="article:published_time" content="2026-11-25T00:00:00Z"><article>My AI body.</article>');
  });
  const result = await collectFake(network), c = result.candidates[0];
  assert.equal(c.url, 'https://example.com/original'); assert.equal(c.canonicalUrl, c.url);
  assert.deepEqual(c.aliases, ['https://example.com/alias']); assert.equal(c.hnSignals[0].id, '99');
});

test('malformed publication/id source data is reported missing while healthy feed rows survive', async () => {
  const network = blankFetch((u) => {
    if (u === SIMON_ENTRIES_URL) return response('<feed><entry><title>Invalid</title><link href="https://simonwillison.net/invalid"/><updated>2026-11-25T00:00:00Z</updated></entry><entry><title>Valid</title><link href="https://simonwillison.net/valid"/><published>2026-11-25T00:00:00Z</published><content>Body</content></entry></feed>');
    if (u.startsWith('https://hn.algolia.com/')) return response({ hits: [{ objectID: 'bad-id', title: 'How I used AI', url: 'https://example.com/post', created_at: 'bad-date', points: 30, num_comments: 3 }, { title: 'Ask HN: examples', url: null }], nbHits: 2 });
  });
  const result = await collectFake(network);
  assert.equal(result.usageSources.simon, 'missing'); assert.equal(result.usageSources.hn, 'missing');
  assert.ok(result.candidates.some((c) => c.title === 'Valid'));
  assert.ok(!result.candidates.some((c) => c.title === 'Invalid'));
});

test('Simon HTML template uses original feed published time when page has only a display date', async () => {
  const network = blankFetch((u) => {
    if (u === SIMON_ENTRIES_URL) return response('<feed><entry><title>Original entry</title><link href="https://simonwillison.net/p/"/><published>2026-11-25T11:00:00Z</published><summary>Only excerpt</summary></entry></feed>');
    if (u === 'https://simonwillison.net/p/') return response('<div class="entry entryPage"><div data-permalink-context="/p/"><p>Original full entry body</p></div><div class="entryFooter">Posted 25th November 2026</div></div>');
  });
  const result = await collectFake(network), c = result.candidates[0];
  assert.equal(c.publishedAt, '2026-11-25T11:00:00Z'); assert.equal(c.body, '<p>Original full entry body</p>');
  assert.deepEqual(result.errors, []);
});
