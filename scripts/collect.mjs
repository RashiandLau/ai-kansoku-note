import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { todayJst, isDate, isMain, parseArgs, writeJson } from './lib/core.mjs';
import {
  compareVersions, httpUrl, inWindow, isAiTitle, parseClaudeChangelog,
  parseCodexReleases, parseHN, parseRss, parseTrending, parseHfModels, parsePageMetadata,
} from './lib/parsers.mjs';
import { deduplicateSelection } from './lib/selection.mjs';

export const USER_AGENT = 'ai-kansoku-note/1.0 (+https://github.com/RashiandLau/ai-kansoku-note)';
const CLAUDE_URL = 'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md';
const SOURCES = [
  { key: 'claudecode', source: 'Claude Code', url: CLAUDE_URL, fixture: 'claude-code-CHANGELOG.md' },
  { key: 'codex', source: 'Codex', url: 'https://api.github.com/repos/openai/codex/releases?per_page=10', fixture: 'codex-releases.json' },
  { key: 'hn', source: 'Hacker News', url: 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=60', fixture: 'hn-front.json' },
  { key: 'openai', kind: 'official', source: 'OpenAI', url: 'https://openai.com/news/rss.xml', fixture: 'openai-news.xml' },
  { key: 'google', kind: 'official', source: 'Google AI', url: 'https://blog.google/technology/ai/rss/', fixture: 'google-ai.xml' },
  { key: 'hfblog', kind: 'official', source: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml', fixture: 'huggingface-blog.xml' },
  { key: 'aiplus', kind: 'japan', source: 'ITmedia AI＋', url: 'https://rss.itmedia.co.jp/rss/2.0/aiplus.xml', fixture: 'itmedia-aiplus.xml' },
  { key: 'ait', kind: 'japan', source: '＠IT', url: 'https://rss.itmedia.co.jp/rss/2.0/ait.xml', fixture: 'itmedia-ait.xml' },
  { key: 'trending', source: 'GitHub Trending', url: 'https://github.com/trending?since=daily', fixture: 'github-trending.html' },
  { key: 'hfmodels', source: 'Hugging Face Models', url: 'https://huggingface.co/api/models?sort=trendingScore&limit=15', fixture: 'hf-models.json' },
];

function charsetParameter(value = '') {
  const match = value.match(/(?:^|;)\s*charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s;]+))/i);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function decoderForCharset(label = '') {
  const charset = label.trim().toLowerCase();
  if (!charset) return null;
  try {
    // TextDecoder recognizes the other Shift_JIS aliases, but not cp932.
    return new TextDecoder(charset === 'cp932' ? 'shift_jis' : charset);
  } catch { return null; }
}

function decodeResponse(bytes, contentType) {
  let decoder = decoderForCharset(charsetParameter(contentType));
  if (!decoder) {
    // Latin-1 preserves byte offsets while scanning ASCII declarations. Never
    // inspect beyond the first 4 KiB, including tags that cross that boundary.
    const prefix = Buffer.from(bytes).subarray(0, 4096).toString('latin1');
    for (const meta of prefix.matchAll(/<meta(?=\s|\/?>)((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)) {
      const attributes = Object.create(null);
      for (const match of meta[1].matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
        attributes[match[1].toLowerCase()] ??= match[2] ?? match[3] ?? match[4];
      }
      decoder = decoderForCharset(attributes.charset);
      if (!decoder && attributes['http-equiv']?.trim().toLowerCase() === 'content-type') {
        decoder = decoderForCharset(charsetParameter(attributes.content));
      }
      if (decoder) break;
    }
  }
  return (decoder ?? new TextDecoder('utf-8')).decode(bytes);
}

// One semaphore covers source requests, redirects, response bodies and article metadata.
export function createFetcher({ fetchImpl = globalThis.fetch, token = process.env.GITHUB_TOKEN, timeoutMs = 20_000 } = {}) {
  let active = 0;
  const queue = [];
  async function acquire() {
    if (active >= 4) await new Promise((resolve) => queue.push(resolve));
    else active += 1;
  }
  function release() {
    const next = queue.shift();
    if (next) next();
    else active -= 1;
  }
  return async function fetchText(input) {
    const initialUrl = httpUrl(input);
    if (!initialUrl) throw new Error('Only HTTP(S) source URLs are allowed');
    await acquire();
    const controller = new AbortController();
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });
      const request = async () => {
        let url = initialUrl;
        for (let redirects = 0; redirects <= 5; redirects += 1) {
          const headers = { 'User-Agent': USER_AGENT };
          if (token && new URL(url).hostname === 'api.github.com') headers.Authorization = `Bearer ${token}`;
          const response = await fetchImpl(url, { headers, signal: controller.signal, redirect: 'manual' });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers?.get('location');
            const nextUrl = location ? httpUrl(location, url) : '';
            await response.body?.cancel();
            if (!nextUrl) throw new Error('Invalid redirect URL');
            url = nextUrl;
            continue;
          }
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`HTTP ${response.status}`);
          }
          return decodeResponse(await response.arrayBuffer(), response.headers?.get('content-type') ?? '');
        }
        throw new Error('Too many redirects');
      };
      return await Promise.race([request(), timeout]);
    } finally {
      clearTimeout(timer);
      release();
    }
  };
}

function candidate(kind, source, entry, now) {
  const identity = kind === 'claudecode' ? entry.version : entry.url;
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, 12);
  return { id: `${kind}-${hash}`, kind, title: entry.title ?? '', url: entry.url, source,
    published: entry.published ?? now, metrics: {}, image: '', ogTitle: '', ogDescription: '', excerpt: '', ...entry };
}

async function readState(filename) {
  try {
    const state = JSON.parse(await readFile(filename, 'utf8'));
    if (!state || Array.isArray(state) || typeof state !== 'object') throw new Error('State must be a JSON object');
    for (const key of ['claudeCode', 'codex']) {
      if (state[key] !== undefined && !/^\d+\.\d+\.\d+$/.test(state[key])) throw new Error(`Invalid state version: ${key}`);
    }
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export async function collect(options = {}) {
  const now = new Date(options.now ?? Date.now());
  if (!Number.isFinite(now.getTime())) throw new Error('--now must be a valid ISO date/time');
  const generatedAt = now.toISOString();
  const date = options.date ?? todayJst(now);
  if (!isDate(date)) throw new Error('--date must be a valid YYYY-MM-DD date');
  const out = path.resolve(options.out ?? '.');
  const stateFile = path.resolve(options.state ?? path.join(out, 'state', 'seen.json'));
  const state = await readState(stateFile);
  const nextState = { ...state };
  const errors = [];
  const fetched = {};
  const fetchText = createFetcher();
  await Promise.all(SOURCES.map(async (source) => {
    try {
      const input = options.fixtures ? await readFile(path.resolve(options.fixtures, source.fixture), 'utf8') : await fetchText(source.url);
      let entries;
      if (source.key === 'claudecode') {
        const releases = parseClaudeChangelog(input);
        if (!state.claudeCode || compareVersions(releases[0].version, state.claudeCode) > 0) nextState.claudeCode = releases[0].version;
        entries = releases.filter((release) => !state.claudeCode || compareVersions(release.version, state.claudeCode) > 0)
          .slice(0, state.claudeCode ? 5 : 2).map((release) => ({ ...release, title: `Claude Code ${release.version}`, url: CLAUDE_URL }));
      } else if (source.key === 'codex') {
        const releases = parseCodexReleases(input);
        if (releases.length && (!state.codex || compareVersions(releases[0].version, state.codex) > 0)) nextState.codex = releases[0].version;
        entries = releases.filter((release) => !state.codex || compareVersions(release.version, state.codex) > 0).slice(0, state.codex ? 3 : 1);
      } else if (source.key === 'hn') entries = parseHN(input, generatedAt);
      else if (source.key === 'trending') entries = parseTrending(input).slice(0, 5);
      else if (source.key === 'hfmodels') {
        fetched.hfmodels = parseHfModels(input, generatedAt);
        return;
      } else {
        entries = parseRss(input, source.url).filter((entry) => inWindow(entry.published, generatedAt));
        if (source.key === 'ait') entries = entries.filter((entry) => isAiTitle(entry.title) || /生成AI|AIエージェント|LLM/i.test(entry.title));
      }
      fetched[source.key] = entries.map((entry) => candidate(source.kind ?? source.key, source.source, entry, generatedAt));
    } catch (error) {
      errors.push({ source: source.source, message: error.message });
      fetched[source.key] = [];
    }
  }));

  const newest = (a, b) => Date.parse(b.published) - Date.parse(a.published);
  const topStory = fetched.hn?.[0];
  const official = [...(fetched.openai ?? []), ...(fetched.google ?? []), ...(fetched.hfblog ?? [])].sort(newest).slice(0, 6);
  const japan = [...(fetched.aiplus ?? []), ...(fetched.ait ?? [])].sort(newest).slice(0, 5);
  const others = (fetched.hn ?? []).filter((entry) => entry.id !== topStory?.id && entry.points >= 100).slice(0, 8);
  const selection = deduplicateSelection([
    ...(topStory ? [topStory] : []), ...(fetched.claudecode ?? []), ...(fetched.codex ?? []),
    ...official, ...others, ...japan, ...(fetched.trending ?? []),
  ], topStory?.id, fetched.hn ?? []);

  if (!options.fixtures) {
    const metadataCache = new Map();
    await Promise.all(Object.values(selection.items).map(async (item) => {
      const release = item.kind === 'claudecode' || item.kind === 'codex';
      const pageUrl = item.kind === 'claudecode' ? 'https://github.com/anthropics/claude-code' : item.kind === 'codex' ? 'https://github.com/openai/codex' : item.url;
      if (!metadataCache.has(pageUrl)) {
        metadataCache.set(pageUrl, fetchText(pageUrl).then((html) => parsePageMetadata(html, pageUrl)).catch((error) => {
          errors.push({ source: pageUrl, message: error.message });
          return null;
        }));
      }
      const metadata = await metadataCache.get(pageUrl);
      if (metadata) {
        if (release) item.image = metadata.image;
        else Object.assign(item, metadata);
      }
    }));
  }
  errors.sort((a, b) => a.source.localeCompare(b.source));
  const result = { date, generatedAt, ...selection, hfmodels: fetched.hfmodels ?? [], errors };
  await writeJson(path.join(out, 'raw', `${date}.json`), result);
  await writeJson(stateFile, nextState);
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv, ['date', 'fixtures', 'now', 'out', 'state']);
  const result = await collect(options);
  console.log(`Collected ${result.selected.length} items for ${result.date} (${result.errors.length} source errors).`);
  return result;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
