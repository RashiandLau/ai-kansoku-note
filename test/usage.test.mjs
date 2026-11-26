import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { usageRules, normalizeUsageUrl, bodyFeatures, qualifyUsage, assembleUsage, updateUsageState, chooseUsageDiscussion, toRawUsageItem } from '../scripts/lib/usage.mjs';

const NOW = '2026-11-26T03:00:00.000Z';
const JA = '<p>私はClaudeを使って実装した。結果を比較した。</p><pre>run</pre><pre>save</pre>' + '説明'.repeat(750);
const EN = '<p>I used Claude and measured the results.</p><pre>run</pre><pre>save</pre>' + 'word '.repeat(400);
const candidate = (overrides = {}) => ({ url: 'https://zenn.dev/alice/articles/one', title: 'Claudeを使った手順', source: 'zenn', host: 'zenn.dev', language: 'ja', author: 'alice', publishedAt: '2026-11-25T03:00:00Z', body: JA, bodyAvailable: true, tags: ['Claude'], metrics: { hb: 10, observedAt: NOW }, hnSignals: [], ...overrides });

test('small saved response fragments match Python research feature vectors exactly', () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/usage/features.json', import.meta.url), 'utf8'));
  for (const sample of fixture.cases) assert.deepEqual(bodyFeatures(sample.body, sample.title, sample.tags), sample.expected, sample.sourceFixture);
});

test('usage config fixes v2 dictionaries, thresholds, caps and explicit trusted author', () => {
  assert.equal(usageRules.version, 'usage-research-v2');
  assert.ok(usageRules.ruleVersion);
  assert.deepEqual(usageRules.body_min, { ja_nonspace_chars: 1500, en_words: 400 });
  assert.equal(usageRules.window_days, 7);
  assert.equal(usageRules.maximum_items, 5);
  assert.deepEqual(usageRules.reserved, { ja: 2, en: 1 });
  assert.equal(usageRules.maximum_per_language, 3);
  assert.equal(usageRules.maximum_per_source, 2);
  assert.equal(usageRules.maximum_per_author, 1);
  assert.equal(usageRules.trustedAuthors[0].feedUrl, 'https://simonwillison.net/atom/entries/');
});

test('URL normalization preserves and sorts meaningful query pairs while removing tracking and fragments', () => {
  assert.equal(normalizeUsageUrl('HTTPS://Example.com/path///?z=2&a=3&a=1&utm_source=x&FBCLID=y&gclid=z&ref_src=f#x'), 'https://example.com/path?a=1&a=3&z=2');
  assert.equal(normalizeUsageUrl('https://news.ycombinator.com/item?id=12'), 'https://news.ycombinator.com/item?id=12');
  assert.equal(normalizeUsageUrl('https://example.com/?b=&a=hello%20world'), 'https://example.com?a=hello+world&b=');
  assert.equal(normalizeUsageUrl('https://Example.com:443/path/?q=~*'), 'https://example.com:443/path?q=~%2A');
  assert.notEqual(normalizeUsageUrl('http://example.com/x'), normalizeUsageUrl('https://example.com/x'));
  assert.equal(normalizeUsageUrl('javascript:alert(1)'), '');
  assert.equal(normalizeUsageUrl('https://user:pass@example.com/x'), '');
});

test('body feature counts use Unicode words/characters, ignore executable text and decode entities', () => {
  const f = bodyFeatures('<p>私 AI αβ cafe &amp; hello-world</p><script>result</script><style>prompt</style><noscript>run</noscript>', '', []);
  assert.equal(f.textPreview, '私 AI αβ cafe & hello-world');
  assert.equal(f.words, 5);
  assert.equal(f.chars, 21);
  assert.equal(f.ai, true);
  assert.equal(f.practitioner, true);
  assert.equal(f.outcome, false);
  assert.equal(bodyFeatures('<p>日本AI日本</p>', '', []).ai, false);
  assert.equal(bodyFeatures('<p>生成AI</p>', '', []).ai, true);
  assert.equal(bodyFeatures('<p>İ used Aı</p>').usageClaim, true);
  assert.equal(bodyFeatures('<p title="a > b">I used Claude</p>').textPreview, 'I used Claude');
});

test('all three recipe routes retain exact action, prompt, artifact and step boundaries', () => {
  assert.equal(bodyFeatures('<pre>x</pre><pre>y</pre>').recipe, true);
  assert.equal(bodyFeatures('<ol><li>run open save</li></ol><img src="x">').recipe, true);
  assert.equal(bodyFeatures('手順１ 入力 実行 設定 <a href="https://github.com/a/b">artifact</a>').recipe, true);
  assert.equal(bodyFeatures('Step 1 run open save <a href="https://gist.github.com/a">artifact</a>').recipe, true);
  assert.equal(bodyFeatures('1. run open save <a href="https://huggingface.co/spaces/a/b">artifact</a>').recipe, true);
  assert.equal(bodyFeatures('<ol>run run open</ol><img>').recipe, false);
  assert.equal(bodyFeatures('<ol>run open save</ol>').recipe, false);
  assert.equal(bodyFeatures('prompt <blockquote>make a chart</blockquote>').recipe, true);
  assert.equal(bodyFeatures('指示文 <img><img>').recipe, true);
  assert.equal(bodyFeatures('prompt <img>').recipe, false);
});

test('bounded usage claims and fixed dictionaries match the research semantics', () => {
  assert.equal(bodyFeatures('I used Claude').usageClaim, true);
  assert.equal(bodyFeatures('We Claude automated').usageClaim, true);
  assert.equal(bodyFeatures('私は Claude を使って').usageClaim, true);
  assert.equal(bodyFeatures('I ' + 'x'.repeat(101) + ' used Claude').usageClaim, false);
  assert.equal(bodyFeatures('私' + 'あ'.repeat(81) + 'Claudeを使った').usageClaim, false);
  assert.equal(bodyFeatures('neutral', 'AI workflow').usageEvidence, true);
  assert.equal(bodyFeatures('neutral', 'AI model').ai, true);
  assert.equal(bodyFeatures('model').ai, false);
  assert.equal(bodyFeatures('results', '翻訳: AI workflow').translationTitle, true);
  assert.equal(bodyFeatures('results', 'Translated workflow').translationTitle, true);
  assert.equal(bodyFeatures('results', 'AI replaced work').shift, true);
});

test('route A requires HB 10 or one HN submission with 20 points and 3 comments', () => {
  assert.equal(qualifyUsage(candidate(), NOW).route, 'A');
  assert.equal(qualifyUsage(candidate({ metrics: { hb: 9 } }), NOW), null);
  const signals = [{ id: '9', points: 20, comments: 3, submittedAt: NOW }];
  assert.equal(qualifyUsage(candidate({ metrics: {}, hnSignals: signals }), NOW).route, 'A');
  for (const change of [{ points: 19 }, { comments: 2 }, { submittedAt: '2026-11-27T00:00:00Z' }]) {
    assert.equal(qualifyUsage(candidate({ metrics: {}, hnSignals: [{ ...signals[0], ...change }] }), NOW), null);
  }
  assert.equal(qualifyUsage(candidate({ metrics: {}, hnSignals: [{ ...signals[0], points: 19, comments: 10 }, { ...signals[0], points: 50, comments: 2 }] }), NOW), null);
});

test('route B is Zenn/Qiita only, with every save/like floor and ratio required', () => {
  assert.equal(qualifyUsage(candidate({ metrics: { saves: 10, likes: 40 } }), NOW).route, 'B');
  assert.equal(qualifyUsage(candidate({ source: 'qiita', metrics: { saves: 10, likes: 5 } }), NOW).route, 'B');
  for (const metrics of [{ saves: 9, likes: 5 }, { saves: 10, likes: 4 }, { saves: 10, likes: 41 }, { saves: 10 }, { likes: 5 }]) {
    assert.equal(qualifyUsage(candidate({ metrics }), NOW), null);
  }
  assert.equal(qualifyUsage(candidate({ source: 'hatena', metrics: { saves: 100, likes: 100 } }), NOW), null);
  assert.equal(qualifyUsage(candidate({ metrics: { hb: 10, saves: 10, likes: 5 } }), NOW).route, 'A');
});

test('v2 rejects each absent body condition, short bodies, translations and excluded hosts', () => {
  assert.equal(qualifyUsage(candidate({ bodyAvailable: false }), NOW), null);
  assert.equal(qualifyUsage(candidate({ body: '' }), NOW), null);
  for (const key of ['ai', 'practitioner', 'outcome', 'recipe', 'usageEvidence']) {
    const features = { ...bodyFeatures(JA, candidate().title, ['Claude']), [key]: false };
    assert.equal(qualifyUsage(candidate({ body: undefined, features }), NOW), null, key);
  }
  assert.equal(qualifyUsage(candidate({ title: '翻訳: Claudeを使った手順' }), NOW), null);
  assert.equal(qualifyUsage(candidate({ body: '<pre>x</pre><pre>y</pre>私はClaudeを使った結果' }), NOW), null);
  for (const host of ['github.com', 'news.ycombinator.com', 'www.youtube.com', 'youtube.com', 'youtu.be']) {
    assert.equal(qualifyUsage(candidate({ url: `https://${host}/a/b`, host }), NOW), null, host);
  }
  assert.equal(qualifyUsage(candidate({ language: 'en', body: EN }), NOW).route, 'A');
  const features = bodyFeatures(JA, candidate().title, ['Claude']);
  assert.equal(qualifyUsage(candidate({ body: undefined, features: { ...features, chars: 1500 } }), NOW).route, 'A');
  assert.equal(qualifyUsage(candidate({ body: undefined, features: { ...features, chars: 1499 } }), NOW), null);
  assert.equal(qualifyUsage(candidate({ body: undefined, language: 'en', features: { ...features, words: 400 } }), NOW).route, 'A');
  assert.equal(qualifyUsage(candidate({ body: undefined, language: 'en', features: { ...features, words: 399 } }), NOW), null);
});

test('the publication window is closed at seven days, rejects unknown/future dates and uses conservative date-only bounds', () => {
  assert.equal(qualifyUsage(candidate({ publishedAt: '2026-11-19T03:00:00Z' }), NOW).route, 'A');
  for (const publishedAt of ['2026-11-19T02:59:59Z', '2026-11-26T03:00:01Z', '', 'not-a-date', '2026-02-30', '2026-02-30T00:00:00Z']) {
    assert.equal(qualifyUsage(candidate({ publishedAt }), NOW), null, publishedAt);
  }
  assert.equal(qualifyUsage(candidate({ publishedAt: '2026-11-24' }), NOW).route, 'A');
  assert.equal(qualifyUsage(candidate({ publishedAt: '2026-11-25' }), NOW), null);
  assert.equal(qualifyUsage(candidate({ publishedAt: '2026-11-19' }), NOW), null);
  assert.equal(qualifyUsage(candidate({ publishedAt: '2026-11-19T03:00:00' }), NOW).route, 'A');
});

test('trusted-author route C requires the exact entries feed, 800 words, an allowed tag and no rejected tag', () => {
  const simon = candidate({ url: 'https://simonwillison.net/2026/Nov/25/example/', host: 'simonwillison.net', source: 'simon', language: 'en', author: 'Simon Willison', body: 'word '.repeat(800), metrics: {}, tags: ['coding-agents'], feedUrl: 'https://simonwillison.net/atom/entries/' });
  assert.equal(qualifyUsage(simon, NOW).route, 'C');
  assert.equal(qualifyUsage(simon, NOW).strength, 0);
  for (const tag of ['coding-agents', 'ai-assisted-programming', 'vibe-coding', 'prompt-engineering']) assert.equal(qualifyUsage({ ...simon, tags: [tag] }, NOW).route, 'C');
  for (const change of [{ body: 'word '.repeat(799) }, { feedUrl: 'https://simonwillison.net/atom/everything/' }, { tags: ['llm-release', 'coding-agents'] }, { tags: ['live-blog', 'coding-agents'] }, { tags: ['AI'] }, { url: 'https://example.com/x' }, { language: 'ja' }, { publishedAt: '2026-11-18T03:00:00Z' }, { bodyAvailable: false }]) {
    assert.equal(qualifyUsage({ ...simon, ...change }, NOW), null, JSON.stringify(change));
  }
});

test('discussion prefers qualifying HN by points, comments, then lexical ID; otherwise HB>=1', () => {
  const signals = ['8', '9', '10'].map(id => ({ id, points: 40, comments: 5, submittedAt: NOW }));
  const c = candidate({ hnSignals: signals, metrics: { hb: 20 } });
  assert.deepEqual(chooseUsageDiscussion(c, NOW), { url: 'https://news.ycombinator.com/item?id=9', source: 'hn', count: 5, points: 40 });
  assert.equal(chooseUsageDiscussion(candidate({ metrics: { hb: 1 } }), NOW).url, 'https://b.hatena.ne.jp/entry/s/zenn.dev/alice/articles/one');
  assert.equal(chooseUsageDiscussion(candidate({ url: 'http://example.com/a?x=1#foo', metrics: { hb: 1 } }), NOW).url, 'https://b.hatena.ne.jp/entry/example.com/a?x=1');
  assert.equal(chooseUsageDiscussion(candidate({ metrics: { hb: 1 }, hatenaEntryUrl: 'https://b.hatena.ne.jp/entry/123#x' }), NOW).url, 'https://b.hatena.ne.jp/entry/123');
  assert.equal(chooseUsageDiscussion(candidate({ metrics: {} }), NOW), null);
  assert.equal(chooseUsageDiscussion(candidate({ metrics: {}, hnSignals: [{ id: 'bad&id=1', points: 30, comments: 4, submittedAt: NOW }] }), NOW), null);
});

test('raw retains observed HN metrics below the discussion qualification floor and preserves missing values', () => {
  const c = candidate({ hnSignals: [{ id: '123', points: 19, comments: 2, submittedAt: NOW }] });
  const raw = toRawUsageItem({ ...c, route: 'A' }, NOW);
  assert.equal(raw.metrics.hnPoints, 19);
  assert.equal(raw.metrics.hnComments, 2);
  assert.equal(raw.discussion.source, 'hatena');
  assert.equal(Object.hasOwn(raw.metrics, 'saves'), false);
});

function ranked(n, language = 'ja', extra = {}) {
  return { ...candidate({ url: `https://site${n}.example/a`, host: `site${n}.example`, source: 'hatena', language, author: `author${n}` }), route: 'A', strength: n, firstQualifiedAt: '2026-11-25T00:00:00Z', ...extra };
}

test('assembly reserves Japanese two and English one before filling to five with language cap three', () => {
  const values = [ranked(1, 'en'), ranked(2, 'en'), ranked(3, 'ja'), ranked(4, 'ja'), ranked(5, 'ja'), ranked(6, 'ja'), ranked(7, 'en')];
  const selected = assembleUsage(values);
  assert.deepEqual(selected.map(x => x.strength), [6, 5, 7, 4, 2]);
  assert.equal(assembleUsage(values.filter(x => x.language === 'ja')).length, 3);
  assert.equal(assembleUsage([]).length, 0);
  assert.equal(assembleUsage(values.slice(0, 2)).length, 2);
});

test('assembly enforces per-service/source and per-source author caps and canonical duplicates', () => {
  const values = [1, 2, 3, 4].map(n => ranked(n, 'ja', { source: 'zenn', url: `https://zenn.dev/a${n}/articles/x`, host: 'zenn.dev' }));
  assert.equal(assembleUsage(values).length, 2);
  assert.equal(assembleUsage(values.map(x => ({ ...x, author: 'same' }))).length, 1);
  const noAuthors = [ranked(1, 'en', { author: '', host: 'blog.example', url: 'https://blog.example/1' }), ranked(2, 'en', { author: '', host: 'blog.example', url: 'https://blog.example/2' })];
  assert.equal(assembleUsage(noAuthors).length, 1);
  assert.equal(assembleUsage([ranked(1), ranked(2, 'ja', { url: 'https://site1.example/a/?utm_source=x#y' })]).length, 1);
});

test('assembly ranks route A then B then C, oldest qualification, strength, latest publication and URL', () => {
  const base = ranked(1);
  const ordered = assembleUsage([
    { ...ranked(2), route: 'C', strength: 1000 },
    { ...ranked(3), route: 'B', strength: 2000 },
    { ...base, route: 'A', strength: 1 },
  ]);
  assert.deepEqual(ordered.map(x => x.route), ['A', 'B', 'C']);
  const a = ranked(1, 'en', { firstQualifiedAt: '2026-11-24T00:00:00Z' });
  assert.equal(assembleUsage([ranked(2, 'en'), a])[0].url, a.url);
  assert.equal(assembleUsage([ranked(1, 'en'), ranked(2, 'en', { strength: 1, publishedAt: '2026-11-25T04:00:00Z' })])[0].host, 'site2.example');
  assert.equal(assembleUsage([ranked(2, 'en', { strength: 1 }), ranked(1, 'en')])[0].host, 'site1.example');
});

test('state separates pending from seen, retains first qualification and emits no full bodies', () => {
  const many = [1, 2, 3, 4].map(n => candidate({ url: `https://zenn.dev/a${n}/articles/x`, author: `a${n}`, metrics: { hb: 10 + n, observedAt: NOW } }));
  const first = updateUsageState({ state: {}, candidates: many, now: NOW });
  assert.equal(first.items.length, 2);
  assert.equal(Object.keys(first.state.pending).length, 2);
  assert.equal(Object.keys(first.state.seen).length, 2);
  for (const value of Object.values(first.state.pending)) {
    assert.equal(value.firstQualifiedAt, NOW);
    assert.equal(value.firstSeenAt, NOW);
    assert.ok(value.bodyHash);
    assert.equal(Object.hasOwn(value, 'body'), false);
  }
  for (const item of first.items) {
    assert.match(item.id, /^usage-[a-f0-9]+$/);
    assert.equal(item.kind, 'usage');
    assert.ok([...item.excerpt].length <= 600);
    assert.equal(Object.hasOwn(item, 'body'), false);
  }
  const second = updateUsageState({ state: first.state, candidates: many.map(c => ({ ...c, metrics: { ...c.metrics, observedAt: '2026-11-27T03:00:00Z' } })), now: '2026-11-27T03:00:00Z' });
  assert.equal(second.items.length, 2);
  assert.ok(second.items.every(x => x.firstQualifiedAt === NOW));
});

test('pending daily observations can cross the threshold but stale or absent observations never qualify', () => {
  const low = candidate({ metrics: { hb: 9, observedAt: NOW } });
  const first = updateUsageState({ candidates: [low], now: NOW });
  assert.equal(first.items.length, 0);
  assert.equal(Object.keys(first.state.seen).length, 0);
  const tomorrow = '2026-11-27T03:00:00.000Z';
  const absent = updateUsageState({ state: first.state, candidates: [], now: tomorrow });
  assert.equal(absent.items.length, 0);
  assert.equal(Object.keys(absent.state.pending).length, 1);
  const stale = updateUsageState({ state: first.state, candidates: [{ ...low, metrics: { hb: 100, observedAt: NOW } }], now: tomorrow });
  assert.equal(stale.items.length, 0);
  const high = updateUsageState({ state: first.state, candidates: [{ ...low, metrics: { hb: 10, observedAt: tomorrow } }], now: tomorrow });
  assert.equal(high.items.length, 1);
  assert.equal(high.items[0].firstQualifiedAt, tomorrow);
  const late = updateUsageState({ state: first.state, candidates: [{ ...low, metrics: { hb: 100, observedAt: '2026-12-03T03:00:01Z' } }], now: '2026-12-03T03:00:01Z' });
  assert.equal(late.items.length, 0);
  assert.equal(Object.keys(late.state.pending).length, 0);
});

test('seen bootstraps all selected sections, ignores unselected IDs, blocks current issue duplicates and prunes after 14 days', () => {
  const c = candidate();
  const raw = { date: '2026-11-25', generatedAt: '2026-11-25T00:00:00Z', selected: ['a'], items: { a: { ...c, kind: 'official' }, b: { url: 'https://unselected.example/a' } } };
  const first = updateUsageState({ candidates: [c], rawIssues: [raw], now: NOW });
  assert.equal(first.items.length, 0);
  assert.equal(first.state.seen[normalizeUsageUrl(c.url)].selectedSection, 'official');
  assert.equal(Object.keys(first.state.seen).length, 1);
  const other = updateUsageState({ candidates: [c], otherItems: [{ ...c, kind: 'japan' }], now: NOW });
  assert.equal(other.items.length, 0);
  assert.equal(other.state.seen[normalizeUsageUrl(c.url)].selectedSection, 'japan');
  const pruned = updateUsageState({ state: { pending: {}, seen: { 'https://old.example/a': { selectedAt: '2026-11-11T03:00:00Z', selectedSection: 'official' } } }, now: NOW });
  assert.equal(Object.keys(pruned.state.seen).length, 0);
});

test('one failed duplicate source does not replace a healthy observation or discard meaningful query IDs', () => {
  const a = candidate();
  const failed = { ...a, source: 'hn', body: '', bodyAvailable: false, publishedAt: '', metrics: {}, tags: [] };
  const result = updateUsageState({ candidates: [a, failed], now: NOW });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].source, 'zenn');
  const different = updateUsageState({ candidates: [candidate({ url: 'https://blog.example/article?id=1', author: 'a' }), candidate({ url: 'https://blog.example/article?id=2', author: 'b' })], now: NOW });
  assert.equal(different.items.length, 2);
});

test('pending body evidence is reused only with unchanged title/tags and fresh observations', () => {
  const first = updateUsageState({ candidates: [candidate({ metrics: { hb: 9, observedAt: NOW } })], now: NOW });
  const tomorrow = '2026-11-27T03:00:00.000Z';
  const refresh = { url: candidate().url, metrics: { hb: 10, observedAt: tomorrow } };
  const cached = updateUsageState({ state: first.state, candidates: [refresh], now: tomorrow });
  assert.equal(cached.items.length, 1);
  const changed = updateUsageState({ state: first.state, candidates: [{ ...refresh, title: 'Translation' }], now: tomorrow });
  assert.equal(changed.items.length, 0);
  const missingBody = updateUsageState({ state: first.state, candidates: [{ ...refresh, bodyAvailable: false }], now: tomorrow });
  assert.equal(missingBody.items.length, 0);
});

test('verified same-host canonical aliases dedupe previous sections, same-batch observations and future rediscovery', () => {
  const original = 'https://zenn.dev/alice/articles/original';
  const canonical = 'https://zenn.dev/alice/articles/canonical';
  const c = candidate({ url: canonical, canonicalUrl: canonical, aliases: [original] });
  const blocked = updateUsageState({ candidates: [c], otherItems: [{ url: original, kind: 'official' }], now: NOW });
  assert.equal(blocked.items.length, 0);
  assert.deepEqual(blocked.state.seen[canonical].aliases, [original]);
  const existing = { pending: {}, seen: { [original]: { selectedAt: NOW, selectedSection: 'japan' } } };
  const previous = updateUsageState({ state: existing, candidates: [c], now: NOW });
  assert.equal(previous.items.length, 0);
  assert.equal(previous.state.seen[canonical].canonicalUrl, canonical);
  const selected = updateUsageState({ candidates: [candidate({ url: original, author: 'other' }), c], now: NOW });
  assert.equal(selected.items.length, 1);
  assert.equal(selected.items[0].url, canonical);
  assert.deepEqual(selected.items[0].aliases, [original]);
  assert.deepEqual(selected.state.seen[canonical].aliases, [original]);
  const tomorrow = '2026-11-27T03:00:00.000Z';
  const rediscovered = updateUsageState({ state: selected.state, candidates: [candidate({ url: original, metrics: { hb: 10, observedAt: tomorrow } })], now: tomorrow });
  assert.equal(rediscovered.items.length, 0);
  const low = updateUsageState({ candidates: [{ ...c, metrics: { hb: 9, observedAt: NOW } }], now: NOW });
  assert.deepEqual(low.state.pending[canonical].aliases, [original]);
  assert.equal(assembleUsage([{ ...c, route: 'A', strength: 10 }, { ...candidate({ url: original, author: 'other' }), route: 'A', strength: 5 }]).length, 1);
});

test('unconfirmed, publication-unknown and cross-host aliases never merge article identities', () => {
  const canonical = candidate().url;
  const seenUrl = 'https://example.com/prior';
  for (const c of [candidate({ aliases: [seenUrl], canonicalUrl: canonical }), candidate({ aliases: ['https://zenn.dev/alice/articles/prior'] }), candidate({ canonicalUrl: canonical, aliases: ['https://zenn.dev/alice/articles/prior'], publishedAt: '' })]) {
    const other = c.aliases[0];
    const result = updateUsageState({ candidates: [c], otherItems: [{ url: other, kind: 'japan' }], now: NOW });
    assert.ok(Object.hasOwn(result.state.seen, other));
    assert.equal(result.items.length, c.publishedAt ? 1 : 0);
    if (result.items[0]) assert.equal(Object.hasOwn(result.items[0], 'aliases'), false);
  }
});
