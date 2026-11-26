import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDay } from '../scripts/lib/render.mjs';
import { validateData } from '../scripts/validate.mjs';

// Synthetic test excerpts and copy; no full third-party article bodies.
const usageItem = (id = 'usage-one', extra = {}) => ({
  id, kind: 'usage', title: 'Claude Codeでテスト作成を試した記録',
  url: `https://example.com/${id}`, source: 'Zenn', host: 'zenn.dev', language: 'ja',
  publishedAt: '2026-11-14T16:30:00Z', route: 'A',
  metrics: { hb: 24, likes: 30, saves: 4, observedAt: '2026-11-15T03:00:00Z' },
  discussion: { url: 'https://b.hatena.ne.jp/entry/s/example.com/usage-one', source: 'hatena', count: 24 },
  excerpt: '筆者はClaude Codeでテストを作成した。生成後にテストを実行して失敗した箇所を修正したと報告している。',
  ...extra,
});
const rawDay = items => ({
  date: '2026-11-15', generatedAt: '2026-11-15T03:00:00Z', top: null, hfmodels: [],
  selected: items.map(item => item.id), items: Object.fromEntries(items.map(item => [item.id, item])),
});
const copyFor = (item, language = 'ja') => ({
  id: item.id, category: 'usage',
  headline: language === 'en' ? 'An author tries writing tests with Claude Code' : item.title,
  summary: language === 'en'
    ? 'The author reports using Claude Code to write tests for a project. After running the generated tests, the author says they fixed the failures.'
    : item.excerpt,
});
const dataFor = (items, language = 'ja') => ({ date: '2026-11-15', articles: items.map(item => copyFor(item, language)), ranking: [] });
const section = html => /<section class="sec usage" id="usage">([\s\S]*?)<\/section>/.exec(html)?.[1] || '';

for (const language of ['ja', 'en']) test(`usage renders after every article section and before ranking in ${language}`, () => {
  const usage = usageItem();
  const raw = rawDay([
    usage,
    { id: 'news', kind: 'hn', title: 'Industry headline', url: 'https://example.com/news' },
    { id: 'repo', kind: 'trending', title: 'Repository', url: 'https://example.com/repo' },
  ]);
  const data = dataFor([usage], language);
  data.articles.push({ id: 'news', category: 'industry', headline: 'An industry headline', summary: 'An industry summary.' });
  const html = renderDay(raw, data, { language });
  assert.ok(html.indexOf('id="industry"') < html.indexOf('id="usage"'));
  assert.ok(html.indexOf('id="usage"') < html.indexOf('id="ranking"'));
  assert.match(html, language === 'ja' ? /href="#usage">使い方<\/a>/ : /href="#usage">How people use AI<\/a>/);
  assert.match(section(html), language === 'ja' ? /<h2>使い方<\/h2>/ : /<h2>How people use AI<\/h2>/);
  assert.match(section(html), /class="src">Zenn<\/span>/);
  assert.match(section(html), language === 'ja' ? /11月15日/ : /November 15/);
  assert.match(section(html), language === 'ja' ? /はてブ 24/ : /Hatena 24/);
  assert.match(section(html), language === 'ja' ? /保存 4/ : /Saves 4/);
  assert.match(section(html), language === 'ja' ? />元記事<\/a>/ : />Original article<\/a>/);
  assert.match(section(html), language === 'ja' ? />議論 はてブ 24件<\/a>/ : />Discussion Hatena \(24\)<\/a>/);
  assert.doesNotMatch(section(html), /nothumb|HN 0|Likes 30|いいね/);
  assert.match(html, language === 'ja' ? /使い方は公開7日以内/ : /How people use AI includes/);
});

test('usage preserves selection order and shows one or two items without padding', () => {
  for (const count of [0, 1, 2]) {
    const items = Array.from({ length: count }, (_, n) => usageItem(`usage-${n}`, { title: `使用記録その${n}です` }));
    const html = renderDay(rawDay(items), dataFor(items));
    assert.equal((section(html).match(/<article /g) || []).length, count);
    assert.equal(html.includes('href="#usage"'), count > 0);
    assert.equal(html.includes('id="usage"'), count > 0);
    if (count === 2) assert.ok(section(html).indexOf(items[0].title) < section(html).indexOf(items[1].title));
  }
});

test('usage fallback remains in its own section and does not modify raw', () => {
  const raw = rawDay([usageItem()]);
  const before = structuredClone(raw);
  const html = renderDay(raw, null);
  assert.match(section(html), /Claude Codeでテスト作成を試した記録/);
  assert.doesNotMatch(section(html), /筆者はClaude/);
  assert.deepEqual(raw, before);
});

for (const language of ['ja', 'en']) test(`usage HN discussion uses comment count, metrics use points in ${language}`, () => {
  const item = usageItem('usage-hn', {
    metrics: { hnPoints: 60, hnComments: 9, hb: 2 },
    discussion: { url: 'https://news.ycombinator.com/item?id=123', source: 'hn', count: 9, points: 60 },
  });
  const html = section(renderDay(rawDay([item]), dataFor([item], language), { language }));
  assert.match(html, language === 'ja' ? /HN 60点/ : /HN 60 points/);
  assert.match(html, language === 'ja' ? /議論 HN 9件/ : /Discussion HN \(9\)/);
  assert.match(html, /href="https:\/\/news.ycombinator.com\/item\?id=123"/);
  assert.doesNotMatch(html, language === 'ja' ? /保存|議論 はてブ/ : /Saves|Discussion Hatena/);
});

test('usage omits missing, null, invalid, negative and zero metrics', () => {
  const item = usageItem('usage-empty', { metrics: { hb: null, hnPoints: -1, saves: '7' }, discussion: undefined });
  let html = section(renderDay(rawDay([item]), dataFor([item])));
  assert.doesNotMatch(html, /はてブ|HN |保存|議論|class="meta usage-metrics"/);
  item.metrics = { hb: 0, hnPoints: 0, saves: 0 };
  html = section(renderDay(rawDay([item]), dataFor([item])));
  assert.doesNotMatch(html, /はてブ 0|HN 0点|保存 0|class="meta usage-metrics"/);
  item.metrics = { hb: 12, hnPoints: 0, saves: 3 };
  html = section(renderDay(rawDay([item]), dataFor([item])));
  for (const value of ['はてブ 12', '保存 3']) assert.ok(html.includes(value));
  assert.doesNotMatch(html, /HN 0点/);
});

test('usage names the original publisher for HN and Hatena discoveries', () => {
  for (const [source, host, label] of [['hn', 'blog.example.com', 'blog.example.com'], ['hatena', 'note.com', 'note.com'], ['zenn', 'zenn.dev', 'Zenn'], ['simon', 'simonwillison.net', 'Simon Willison']]) {
    const item = usageItem('publisher', { source, host });
    assert.ok(section(renderDay(rawDay([item]), dataFor([item]))).includes(`<span class="src">${label}</span>`));
  }
});

test('usage escapes source text and rejects unsafe article or discussion URLs', () => {
  const item = usageItem('unsafe', {
    source: '<img onerror="bad">', url: 'javascript:alert(1)',
    discussion: { url: 'javascript:alert(2)', source: 'hatena', count: 4 },
  });
  const html = section(renderDay(rawDay([item]), dataFor([item])));
  assert.match(html, /&lt;img onerror=&quot;bad&quot;&gt;/);
  assert.doesNotMatch(html, /javascript:|<img|class="links"/);
});

test('usage text layout can wrap long titles and links at phone widths', () => {
  const html = renderDay(rawDay([usageItem()]), dataFor([usageItem()]));
  assert.match(html, /\.usage \.item\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(html, /\.links a\{[^}]*max-width:100%[^}]*box-sizing:border-box[^}]*overflow-wrap:anywhere/);
  assert.match(html, /\.txt[^}]+overflow-wrap:anywhere/);
  assert.match(html, /\.tabs \.wrap\{[^}]*overflow-x:auto/);
});

test('both editions validate selected usage IDs in articles with the usage category', () => {
  const items = [usageItem()];
  const raw = rawDay(items);
  const japaneseData = dataFor(items);
  assert.deepEqual(validateData(raw, japaneseData), []);
  assert.deepEqual(validateData(raw, dataFor(items, 'en'), raw.date, { language: 'en', japaneseData }), []);
});

test('Japanese usage requires a strictly verbatim Japanese-source title', () => {
  const items = [usageItem('usage-ja', { title: 'Claude Codeで　テストを作った記録' })];
  const raw = rawDay(items);
  for (const headline of ['Claude Codeで テストを作った記録', 'Claude Codeで　テストを作る方法']) {
    const data = dataFor(items); data.articles[0].headline = headline;
    assert.ok(validateData(raw, data).some(error => /Usage headline must match raw title verbatim/.test(error)));
  }
});

test('English-source usage allows an unchanged English headline and requires Japanese translation', () => {
  const item = usageItem('usage-en', { language: 'en', title: 'Writing regression tests with Claude Code' });
  const raw = rawDay([item]);
  const japaneseData = dataFor([item]);
  assert.ok(validateData(raw, japaneseData).some(error => /Headline must differ from raw title/.test(error)));
  japaneseData.articles[0].headline = 'Claude Codeで回帰テストを作成した記録';
  assert.deepEqual(validateData(raw, japaneseData), []);
  const englishData = dataFor([item], 'en'); englishData.articles[0].headline = item.title;
  assert.deepEqual(validateData(raw, englishData, raw.date, { language: 'en', japaneseData }), []);
});

for (const [name, mutate, diagnostic] of [
  ['missing usage ID', data => { data.articles = []; }, /exactly once/],
  ['duplicate usage ID', data => { data.articles.push({ ...data.articles[0] }); }, /exactly once/],
  ['usage in ranking', data => { data.ranking.push({ id: data.articles[0].id, summary: data.articles[0].summary }); data.articles = []; }, /Wrong collection/],
  ['wrong usage category', data => { data.articles[0].category = 'tools'; }, /Usage category required/],
  ['usage impact', data => { data.articles[0].impact = '操作を確認する。'; }, /Impact only allowed/],
  ['short usage headline', data => { data.articles[0].headline = '短い見出し'; }, /8-70/],
  ['long usage summary', data => { data.articles[0].summary = `${'あ'.repeat(260)}。報告している。`; }, /30-260/],
  ['one-sentence usage summary', data => { data.articles[0].summary = '筆者はClaude Codeでプロジェクトのテストを作成して実行したと報告している。'; }, /2-3 sentences/],
  ['four-sentence usage summary', data => { data.articles[0].summary = '筆者はClaude Codeを使った。テストを書いた。生成したテストを実行した。失敗した箇所を修正したと報告している。'; }, /2-3 sentences/],
]) test(`usage rejects ${name}`, () => {
  const items = [usageItem()]; const data = dataFor(items); mutate(data);
  assert.ok(validateData(rawDay(items), data).some(error => diagnostic.test(error)));
});

test('usage category cannot be assigned to a non-usage raw item', () => {
  const item = usageItem('news', { kind: 'official', title: 'A source announcement' });
  const data = dataFor([item]); data.articles[0].headline = 'AIの新機能を公開した発表';
  assert.ok(validateData(rawDay([item]), data).some(error => /Usage category reserved/.test(error)));
});

for (const word of ['革新的', '画期的', 'revolutionary']) {
  for (const language of ['ja', 'en']) test(`usage rejects ${word} in ${language}`, () => {
    const items = [usageItem()]; const raw = rawDay(items); const japaneseData = dataFor(items);
    const data = dataFor(items, language); data.articles[0].summary += word;
    assert.ok(validateData(raw, data, raw.date, { language, japaneseData }).some(error => /Hype word forbidden/.test(error)));
  });
}
