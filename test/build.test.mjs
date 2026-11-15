import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { renderDay } from '../scripts/lib/render.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const fallback = '要約の作成が間に合わなかったため、見出しのみ掲載しています';
const item = (id, kind = 'hn', extra = {}) => ({
  id, kind, title: `Raw ${id}`, url: `https://example.com/${id}`, source: 'Example',
  published: '2026-11-14T16:30:00Z', metrics: {}, ...extra,
});
const rawDay = (date, items = []) => ({
  date, generatedAt: `${date}T03:00:00Z`, top: null,
  selected: items.map(({ id }) => id), items: Object.fromEntries(items.map(i => [i.id, i])),
  hfmodels: [], errors: [],
});
const article = (id, category = 'tools', extra = {}) => ({
  id, category, headline: `${id}の新機能を公開`,
  summary: '新しい機能が公開された。操作の手順を減らし、必要な情報を確認できる。利用条件と詳しい使い方は公式の発表記事で案内されている。', ...extra,
});
async function fixture(t, days) {
  const root = await mkdtemp(join(repo, '.test-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(['raw', 'data'].map(dir => mkdir(join(root, dir))));
  for (const [raw, data] of days) {
    await writeFile(join(root, 'raw', `${raw.date}.json`), JSON.stringify(raw));
    if (data !== undefined) await writeFile(join(root, 'data', `${raw.date}.json`), typeof data === 'string' ? data : JSON.stringify(data));
  }
  return root;
}
async function run(root) {
  const module = await import('../scripts/build.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof module.buildSite, 'function', 'buildSite must be implemented');
  const out = join(root, 'site');
  await module.buildSite({ root, out });
  return out;
}
const page = async (out, name = 'index.html') => readFile(join(await out, name), 'utf8');

test('creates a useful empty site, noindex metadata and project-relative app assets', async t => {
  const root = await fixture(t, []);
  const out = await run(root);
  const html = await page(out);
  assert.match(html, /まだ記事がありません/);
  assert.match(html, /<html lang="ja">/);
  assert.match(html, /name="robots" content="noindex"/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /rel="icon"[^>]+data:image\/svg\+xml/);
  assert.doesNotMatch(html, /href="#(?:top|claude-code|codex|models|tools|oss|japan|ranking|industry)"/);
  const manifest = JSON.parse(await page(out, 'manifest.webmanifest'));
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.display, 'standalone');
  assert.ok((await readdir(out)).includes('.nojekyll'));
});

test('uses the latest raw date for index and writes every dated page and descending archive', async t => {
  const older = rawDay('2026-11-13', [item('older')]);
  const newer = rawDay('2026-11-15', [item('newer')]);
  const root = await fixture(t, [[newer], [older]]);
  const out = await run(root);
  assert.match(await page(out), /Raw newer/);
  assert.doesNotMatch(await page(out), /Raw older/);
  assert.match(await page(out, '2026-11-13.html'), /Raw older/);
  const archive = await page(out, 'archive.html');
  assert.ok(archive.indexOf('2026-11-15.html') < archive.indexOf('2026-11-13.html'));
  assert.match(await page(out), /2026年11月15日（日）/);
  assert.match(await page(out), /2026年11月15日 12:00 JST/);
});

test('renders valid summaries with raw-only URLs, metadata, images, links and top deduplication', async t => {
  const raw = rawDay('2026-11-15', [
    item('lead', 'hn', { metrics: { points: 432 }, image: 'https://example.com/lead.jpg', discussion: { url: 'https://news.ycombinator.com/item?id=123', count: 45, points: 432 } }),
    item('release', 'codex', { version: '0.123.0' }),
    item('repo', 'trending', { source: 'owner/repo', metrics: { starsToday: 1234, language: 'TypeScript', stars: 9876 } }),
  ]);
  raw.top = 'lead';
  const data = { date: raw.date, articles: [article('lead', 'models'), article('release', 'codex', { impact: '設定項目が変わるため、更新前に利用中の設定を確認する。' })], ranking: [{ id: 'repo', summary: '作業の手順をまとめて実行できる開発ツール。設定の共有にも対応する。' }] };
  const root = await fixture(t, [[raw, data]]);
  const html = await page(run(root));
  assert.doesNotMatch(html, new RegExp(fallback));
  assert.equal((html.match(/leadの新機能を公開/g) ?? []).length, 1);
  assert.match(html, /<article class="top" id="top">/);
  assert.match(html, /href="#codex"/);
  assert.doesNotMatch(html, /href="#models"/);
  assert.match(html, /loading="lazy" referrerpolicy="no-referrer" alt=""/);
  assert.match(html, /11月15日/);
  assert.match(html, /HN 432ポイント/);
  assert.match(html, /15日に1,234スター/);
  assert.match(html, /議論 HN 45件/);
  assert.equal((html.match(/>元投稿<\/a>/g) ?? []).length, 3);
  assert.match(html, /class="impact"/);
  assert.doesNotMatch(html, /導入済み|自分の環境に影響/);
  assert.match(html, /class="th nothumb"/);
});

test('falls back to every raw headline when summaries are missing, malformed or invalid', async t => {
  for (const [index, data] of [undefined, '{broken json', { date: '2026-11-15', articles: [], ranking: [] }].entries()) {
    const raw = rawDay('2026-11-15', [item(`article-${index}`), item(`rank-${index}`, 'trending')]);
    const root = await fixture(t, [[raw, data]]);
    const html = await page(run(root));
    assert.match(html, new RegExp(fallback));
    assert.match(html, new RegExp(`Raw article-${index}`));
    assert.match(html, new RegExp(`Raw rank-${index}`));
    assert.match(html, /id="ranking"/);
  }
});

test('strips HN prefixes from fallback headlines across top, article and brief layouts', async t => {
  const prefixes = ['Show HN:', 'show hn：', 'Ask HN:', 'ASK HN：', 'Launch HN:', 'lAuNcH hN：', 'Tell HN:', 'tell hn：'];
  const raw = rawDay('2026-11-15', prefixes.map((prefix, index) => item(`prefix-${index}`, index % 2 ? 'official' : 'hn', {
    title: `${prefix} Headline ${index}`,
  })));
  raw.top = 'prefix-0';
  raw.selected.push('embedded');
  raw.items.embedded = item('embedded', 'hn', { title: 'A tool from Show HN: keeps its description' });
  const root = await fixture(t, [[raw]]);
  const rawPath = join(root, 'raw', `${raw.date}.json`);
  const before = await readFile(rawPath, 'utf8');
  const html = await page(run(root));
  assert.match(html, new RegExp(fallback));
  assert.doesNotMatch(html, />(?:Show|Ask|Launch|Tell) HN[:：]/i);
  for (const index of prefixes.keys()) assert.match(html, new RegExp(`>Headline ${index}</a>`));
  assert.match(html, />A tool from Show HN: keeps its description<\/a>/);
  assert.equal(await readFile(rawPath, 'utf8'), before);
});

test('rendering fallback headlines does not change raw titles in memory', () => {
  const raw = rawDay('2026-11-15', [item('prefix', 'hn', { title: 'Tell HN： An unchanged raw title' })]);
  const before = structuredClone(raw);
  const html = renderDay(raw, null);
  assert.match(html, />An unchanged raw title<\/a>/);
  assert.deepEqual(raw, before);
});

test('escapes untrusted content and omits unsafe URLs without losing headlines', async t => {
  const raw = rawDay('2026-11-15', [item('unsafe', 'hn', {
    title: '<script>alert("raw")</script>', source: '<img onerror="bad">',
    url: 'javascript:alert(1)', image: 'data:image/svg+xml,<svg onload="bad">',
    discussion: { url: 'javascript:alert(2)', count: '<svg onload="bad">' },
  }), item('quote', 'official', { url: 'https://example.com/?q=" onmouseover="bad', image: 'https://example.com/a.jpg?x=" onerror="bad' })]);
  const root = await fixture(t, [[raw]]);
  const html = await page(run(root));
  assert.match(html, /&lt;script&gt;alert\(&quot;raw&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img onerror=&quot;bad&quot;&gt;/);
  assert.doesNotMatch(html, /(?:href|src)="(?:javascript|data:image\/svg\+xml,<svg)/);
  assert.doesNotMatch(html, /" on(?:error|mouseover)="bad/);
  assert.doesNotMatch(html, /<script>alert/);
});

test('renders a trending top from ranking summary without duplicating its ranking entry', async t => {
  const raw = rawDay('2026-11-15', [item('top-repo', 'trending', { discussion: { url: 'https://news.ycombinator.com/item?id=9', count: 8, points: 123 } })]);
  raw.top = 'top-repo';
  const data = { date: raw.date, articles: [], ranking: [{ id: 'top-repo', summary: 'AIで開発を支援するためのツール。複数の手順をまとめて実行できる。' }] };
  const html = await page(run(await fixture(t, [[raw, data]])));
  assert.doesNotMatch(html, new RegExp(fallback));
  assert.match(html, /<article class="top" id="top">[\s\S]*Raw top-repo[\s\S]*AIで開発を支援するためのツール。/);
  assert.doesNotMatch(html, /id="ranking"/);
  assert.equal((html.match(/>元投稿<\/a>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /id="oss"/);
});

test('shows Hugging Face models inside ranking even without GitHub entries', async t => {
  const raw = rawDay('2026-11-15');
  raw.hfmodels = [{ id: 'org/model', url: 'https://huggingface.co/org/model', likes: 12, downloads: 3456, pipeline_tag: 'text-generation', createdAt: '2026-11-10T12:00:00Z' }];
  const html = await page(run(await fixture(t, [[raw, { date: raw.date, articles: [], ranking: [] }]])));
  assert.match(html, /href="#ranking"/);
  assert.match(html, /Hugging Face/);
  assert.match(html, /href="https:\/\/huggingface.co\/org\/model"/);
  assert.match(html, /org\/model/);
  assert.match(html, /text-generation/);
  assert.match(html, />元投稿<\/a>/);
});

test('preserves template geometry, responsive behavior, dark colors and scroll tabs', async t => {
  const raw = rawDay('2026-11-15', [item('claude', 'claudecode'), item('domestic', 'japan')]);
  const html = await page(run(await fixture(t, [[raw]])));
  assert.match(html, /max-width:720px/);
  assert.match(html, /grid-template-columns:minmax\(0,1fr\) 112px/);
  assert.match(html, /grid-template-columns:28px minmax\(0,1fr\) 92px/);
  assert.match(html, /position:sticky/);
  assert.match(html, /overflow-x:auto/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /safe-area-inset/);
  assert.match(html, /fonts.googleapis.com/);
  assert.match(html, /addEventListener\('scroll',mark,\{passive:true\}\)/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.match(html, /href="#claude-code"/);
  assert.match(html, /href="#japan"/);
  assert.doesNotMatch(html, /href="#codex"/);
});

test('omits missing publication and model dates instead of inventing 1970 dates', async t => {
  const raw = rawDay('2026-11-15', [item('undated', 'official', { published: null })]);
  raw.generatedAt = null;
  raw.hfmodels = [{ id: 'org/undated', url: 'https://huggingface.co/org/undated', createdAt: null }];
  const html = await page(run(await fixture(t, [[raw]])));
  assert.doesNotMatch(html, /1月1日|1970年/);
  assert.match(html, /取得日時不明/);
});

test('rejects summaries when the raw date disagrees with its dated filename', async t => {
  const raw = rawDay('2026-11-15', [item('dated')]);
  const data = { date: raw.date, articles: [article('dated')], ranking: [] };
  const root = await fixture(t, [[raw, data]]);
  await writeFile(join(root, 'raw', '2026-11-15.json'), JSON.stringify({ ...raw, date: '2026-11-14' }));
  const html = await page(run(root));
  assert.match(html, new RegExp(fallback));
  assert.match(html, /2026年11月15日（日）/);
  assert.match(html, /Raw dated/);
  assert.doesNotMatch(html, /datedの新機能を公開/);
});

test('renders only selected records in selection order', async t => {
  const raw = rawDay('2026-11-15', [item('second'), item('unselected'), item('first')]);
  raw.selected = ['first', 'second'];
  const html = await page(run(await fixture(t, [[raw]])));
  assert.doesNotMatch(html, /Raw unselected/);
  assert.ok(html.indexOf('Raw first') < html.indexOf('Raw second'));
});

test('preserves original ranking positions after moving a repository to the top', async t => {
  const raw = rawDay('2026-11-15', [item('rank-one', 'trending'), item('rank-two', 'trending'), item('rank-three', 'trending')]);
  raw.top = 'rank-two';
  const html = await page(run(await fixture(t, [[raw]])));
  const ranking = html.slice(html.indexOf('<section class="sec rank"'));
  assert.match(ranking, /class="rk">1<\/span>/);
  assert.match(ranking, /class="rk">3<\/span>/);
  assert.doesNotMatch(ranking, /Raw rank-two/);
  assert.equal((html.match(/Raw rank-two/g) ?? []).length, 1);
});
