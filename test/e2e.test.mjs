import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from '../scripts/collect.mjs';
import { validateFile } from '../scripts/validate.mjs';
import { buildSite } from '../scripts/build.mjs';
import { escapeHtml, writeJson } from '../scripts/lib/core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const date = '2026-11-15';
const notice = '要約の作成が間に合わなかったため、見出しのみ掲載しています';

test('fixture collect → text-only data → validate → build, missing and invalid fallback', async t => {
  const tempParent = resolve(root, '.tmp');
  await mkdir(tempParent, { recursive: true });
  const tempRoot = await mkdtemp(join(tempParent, 'e2e-'));
  t.after(async () => {
    const inside = relative(tempParent, tempRoot);
    assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside));
    await rm(tempRoot, { recursive: true, force: true });
  });
  // A fetch attempt here would prove that fixture mode has leaked to the network.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Fixture tests must never fetch'); };
  try {
    await collect({ date, fixtures: join(root, 'fixtures'), now: '2026-11-15T03:00:00Z', out: tempRoot, state: join(tempRoot, 'state', 'seen.json') });
  } finally { globalThis.fetch = originalFetch; }
  const raw = JSON.parse(await readFile(join(tempRoot, 'raw', `${date}.json`), 'utf8'));
  assert.ok(raw.selected.length > 5);
  assert.equal(new Set(raw.selected).size, raw.selected.length);
  assert.equal(raw.errors.length, 0);
  const data = { date, articles: [], ranking: [] };
  for (const [index, id] of raw.selected.entries()) {
    const item = raw.items[id];
    if (item.kind === 'trending') data.ranking.push({ id, summary: 'AI関連の開発で使うソフトウェアを公開しているリポジトリである。' });
    else data.articles.push({
      id, category: ({ claudecode: 'claude-code', codex: 'codex', japan: 'japan' })[item.kind] ?? 'tools',
      headline: item.kind === 'japan' ? item.title : `統合テスト用の記事見出し${index + 1}`,
      summary: '収集した資料に基づいて記事の内容を整理した。公開内容の詳細は元投稿で確認できる。',
    });
  }
  await writeJson(join(tempRoot, 'data', `${date}.json`), data);
  const english = {
    date,
    articles: data.articles.map((article, index) => ({
      id: article.id, category: article.category,
      headline: `Project ${index + 1} updates its published software features`,
      summary: 'The project describes its software changes in the collected source material. The report records the published details and their stated conditions.',
    })),
    ranking: data.ranking.map(({ id }) => ({ id, summary: 'The project provides software for developers working with AI tools. Its repository contains the source and documentation described in the collected material.' })),
  };
  await writeJson(join(tempRoot, 'data', `${date}.en.json`), english);
  assert.deepEqual(await validateFile(date, tempRoot), []);
  await buildSite({ root: tempRoot });
  let html = await readFile(join(tempRoot, 'site', 'index.html'), 'utf8');
  for (const article of data.articles) assert.ok(html.includes(escapeHtml(article.headline)), article.id);
  for (const id of raw.selected) {
    const url = escapeHtml(raw.items[id].url);
    assert.ok(html.includes(`href="${url}"`), id);
  }
  assert.ok(html.includes('元投稿'));
  assert.ok(!html.includes(notice));
  assert.equal(await readFile(join(tempRoot, 'site', `${date}.html`), 'utf8'), html);
  const englishHtml = await readFile(join(tempRoot, 'site', 'en', 'index.html'), 'utf8');
  assert.match(englishHtml, /<html lang="en">/);
  for (const article of english.articles) assert.ok(englishHtml.includes(escapeHtml(article.headline)), article.id);
  assert.equal(await readFile(join(tempRoot, 'site', 'en', `${date}.html`), 'utf8'), englishHtml);
  assert.match(html, new RegExp(`href="en/${date}\\.html"`));
  assert.match(englishHtml, new RegExp(`href="../${date}\\.html"`));
  assert.ok((await readFile(join(tempRoot, 'site', 'sw.js'), 'utf8')).includes('notificationclick'));
  await rm(join(tempRoot, 'data', `${date}.json`));
  await buildSite({ root: tempRoot });
  html = await readFile(join(tempRoot, 'site', 'index.html'), 'utf8');
  assert.ok(html.includes(notice));
  const fallbackTitles = new Map([
    ['Show HN: DeepSeek V3 in ~200 lines of pure Jax', 'DeepSeek V3 in ~200 lines of pure Jax'],
  ]);
  for (const id of raw.selected) {
    const title = raw.items[id].title;
    assert.ok(html.includes(escapeHtml(fallbackTitles.get(title) ?? title)), id);
  }
  assert.ok(!html.includes('Show HN:'));
  await writeFile(join(tempRoot, 'data', `${date}.json`), '{invalid-json', 'utf8');
  await buildSite({ root: tempRoot });
  assert.ok((await readFile(join(tempRoot, 'site', 'index.html'), 'utf8')).includes(notice));
  await writeJson(join(tempRoot, 'data', `${date}.json`), { ...data, articles: [] });
  await buildSite({ root: tempRoot });
  assert.ok((await readFile(join(tempRoot, 'site', 'index.html'), 'utf8')).includes(notice));
});
