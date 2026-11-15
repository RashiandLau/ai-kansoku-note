import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  compareVersions, parseClaudeChangelog, parseCodexReleases, parseHN,
  parseRss, parseTrending, parseHfModels, parsePageMetadata, isAiTitle,
} from '../scripts/lib/parsers.mjs';

const NOW = '2026-11-15T03:00:00Z';
const fixture = (name) => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

test('Claude changelog keeps both version sections and truncates source text', async () => {
  const releases = parseClaudeChangelog(await fixture('claude-code-CHANGELOG.md'));
  assert.deepEqual(releases.map((x) => x.version), ['2.1.325', '2.1.323']);
  assert.match(releases[0].sectionText, /zstd-compressed/);
  assert.ok(releases.every((x) => x.sectionText.length <= 3000));
  assert.ok(compareVersions('2.1.10', '2.1.9') > 0);
  assert.deepEqual(parseClaudeChangelog('## 1.2.9\nold\n## 1.2.10\nnew').map((x) => x.version), ['1.2.10', '1.2.9']);
});

test('Codex releases exclude drafts, prereleases and tagged previews and sort semantically', async () => {
  const releases = parseCodexReleases(await fixture('codex-releases.json'));
  assert.deepEqual(releases.map((x) => x.version), ['0.169.0', '0.168.0', '0.167.2']);
  assert.ok(releases.every((x) => x.body.length <= 3000));
  const release = (tag_name, extra = {}) => ({ tag_name, html_url: `https://github.com/openai/codex/releases/tag/${tag_name}`, published_at: NOW, ...extra });
  assert.deepEqual(parseCodexReleases([
    release('rust-v1.2.9'), release('rust-v1.2.10'),
    release('rust-v2.0.0', { draft: true }), release('rust-v2.0.1', { prerelease: true }),
    release('rust-v3.0.0-alpha.1'), release('rust-v3.0.0-beta.1'), release('rust-v3.0.0-rc.1'),
  ]).map((x) => x.version), ['1.2.10', '1.2.9']);
  assert.equal(parseCodexReleases([release('1.2.10')])[0]?.version, '1.2.10');
});

test('HN fixture selects recent AI stories by points and preserves discussion metrics', async () => {
  const stories = parseHN(await fixture('hn-front.json'), NOW);
  assert.deepEqual(stories.map((x) => x.objectID), ['50497589']);
  assert.equal(stories[0].points, 226);
  assert.equal(stories[0].num_comments, 21);
  assert.deepEqual(stories[0].metrics, { points: 226, num_comments: 21 });
  assert.deepEqual(stories[0].discussion, { url: 'https://news.ycombinator.com/item?id=50497589', count: 21, points: 226 });
});

test('AI word boundaries and 36-hour window reject incidental substrings, old and future stories', () => {
  for (const title of ['AI tools', 'LLM agent', 'GPT-5', 'Claude', 'Anthropic', 'OpenAI', 'Gemini', 'Codex', 'Copilot', 'agentic', 'a model', 'Llama', 'Qwen', 'DeepSeek', 'Mistral', 'inference', 'neural', 'transformer', 'diffusion', 'MCP', 'ML', 'machine learning', 'chatbot']) assert.equal(isAiTitle(title), true, title);
  for (const title of ['a chair', 'mail server', 'modeling', 'agentsmith', 'HTML parser', 'domain name']) assert.equal(isAiTitle(title), false, title);
  const hit = (objectID, created_at, title = 'AI story') => ({ objectID, created_at, title, points: 101, url: `https://example.com/${objectID}` });
  const items = parseHN({ hits: [
    hit('boundary', '2026-11-13T15:00:00Z'), hit('now', NOW),
    hit('old', '2026-11-13T14:59:59Z'), hit('future', '2026-11-15T03:00:01Z'),
    hit('no', NOW, 'The mail server'), hit('invalid', 'not a date'),
  ] }, NOW);
  assert.deepEqual(items.map((x) => x.objectID), ['now', 'boundary']);
});

test('all five RSS fixtures yield decoded titles, absolute URLs and ISO publication dates', async () => {
  const cases = [
    ['openai-news.xml', 'Introducing ChatGPT Wallet'],
    ['google-ai.xml', 'Google Search gets a major upgrade with Gemini 4 Hydrogen'],
    ['huggingface-blog.xml', 'Build a Robot Pick-and-Place Simulation with SimReady Assets'],
    ['itmedia-aiplus.xml', '【追記あり】M365障害、ChatGPT／Claudeのコネクタにも影響'],
    ['itmedia-ait.xml', 'PHP重大脆弱性は「始まり」に過ぎない？'],
  ];
  for (const [name, title] of cases) {
    const entries = parseRss(await fixture(name));
    assert.ok(entries.length > 0, name);
    assert.ok(entries[0].title.startsWith(title), name);
    assert.ok(entries.every((x) => /^https?:\/\//.test(x.url)), name);
    assert.ok(entries.every((x) => /^\d{4}-\d{2}-\d{2}T/.test(x.published)), name);
    assert.ok(entries.every((x) => !x.title.includes('CDATA')), name);
  }
});

test('RSS and Atom parse CDATA, entities, relative links and reject executable links', () => {
  const rss = '<rss><channel><item><title><![CDATA[A &amp; B]]></title><link>https://example.com/a</link><pubDate>Sun, 15 Nov 2026 01:00:00 GMT</pubDate><description><![CDATA[<p>Text &#x1f916; &lt;safe&gt;</p>]]></description></item></channel></rss>';
  assert.equal(parseRss(rss)[0].description, 'Text 🤖 <safe>');
  assert.equal(parseRss(rss)[0].title, 'A & B');
  const atom = '<feed><entry><title>AI News</title><link href="/news"/><published>2026-11-15T01:00:00Z</published><summary>Useful</summary></entry></feed>';
  assert.equal(parseRss(atom, 'https://example.com/feed')[0].url, 'https://example.com/news');
  assert.throws(() => parseRss(rss.replace('https://example.com/a', 'javascript:alert(1)')), /valid/i);
  assert.throws(() => parseRss('<rss><item>broken'), /feed|RSS|XML/i);
});

test('GitHub trending fixture extracts repository, description, language and numeric star counts', async () => {
  const repos = parseTrending(await fixture('github-trending.html'));
  const repo = repos.find((x) => x.title === 'backnotprop/plannotator');
  assert.ok(repo);
  assert.equal(repo.url, 'https://github.com/backnotprop/plannotator');
  assert.equal(repo.language, 'TypeScript');
  assert.equal(repo.metrics.language, 'TypeScript');
  assert.equal(repo.metrics.stars, 11405);
  assert.equal(repo.metrics.starsToday, 408);
  assert.match(repo.description, /agents/);
  assert.ok(repos.every((x) => Number.isFinite(x.metrics.starsToday)));
  assert.deepEqual([...repos].sort((a, b) => b.metrics.starsToday - a.metrics.starsToday), repos);
});

test('Hugging Face keeps the input ranking among models created in the past 14 days', async () => {
  const models = parseHfModels(await fixture('hf-models.json'), NOW);
  assert.deepEqual(models.map((x) => x.id), ['MiniMaxAI/MiniMax-H3-Image', 'Comfy-Org/MiniMax-H3-Image', 'NousResearch/Arete-27B']);
  assert.equal(models[0].pipeline_tag, 'text-to-image');
  assert.equal(models[0].likes, 1134);
  assert.equal(models[0].downloads, 517948);
  assert.equal(models[0].url, 'https://huggingface.co/MiniMaxAI/MiniMax-H3-Image');
  assert.deepEqual(parseHfModels([{ id: 'a/future', createdAt: '2026-11-16T00:00:00Z' }], NOW), []);
});

test('both saved article pages expose OG metadata and readable body excerpts', async () => {
  const google = parsePageMetadata(await fixture('article-gemini.html'), 'https://blog.google/');
  assert.equal(google.ogTitle, 'Introducing Gemini 4 Hydrogen');
  assert.match(google.ogDescription, /daily driver/);
  assert.match(google.image, /^https:\/\/storage.googleapis.com\//);
  assert.match(google.excerpt, /Gemini 4 Hydrogen/);
  const japan = parsePageMetadata(await fixture('article-itmedia.html'), 'https://www.itmedia.co.jp/');
  assert.match(japan.ogTitle, /Notion/);
  assert.match(japan.image, /^https:\/\/www.itmedia.co.jp\/aiplus\/article\/ogp\//);
  assert.match(japan.excerpt, /Fireworks/);
  for (const metadata of [google, japan]) {
    assert.ok(metadata.excerpt.length <= 1500);
    assert.doesNotMatch(metadata.excerpt, /<script|<p\b|function\s*\(/);
    assert.doesNotMatch(metadata.excerpt, /\s{2}/);
  }
});

test('metadata accepts reordered attributes and rejects unsafe image URLs and scripts', () => {
  const metadata = parsePageMetadata('<meta content="A &amp; B" property="og:title"><meta content="javascript:alert(1)" property="og:image"><article><script>SECRET()</script><style>.hidden{}</style><p>Hello &lt;world&gt;.</p></article>', 'https://example.com/');
  assert.equal(metadata.ogTitle, 'A & B');
  assert.equal(metadata.image, '');
  assert.equal(metadata.excerpt, 'Hello <world>.');
  assert.equal(parsePageMetadata('<meta property="og:image" content="/cover.jpg">', 'https://example.com/news').image, 'https://example.com/cover.jpg');
  assert.equal(parsePageMetadata('<p>No image</p>', 'https://example.com/news').image, '');
  assert.equal(parsePageMetadata('<meta property="og:image" content="  ">', 'https://example.com/news').image, '');
});
