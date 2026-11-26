// Public source adapters. Bodies exist only during collection, never in persisted raw/state.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { usageRules, usageRegex, normalizeUsageUrl } from './usage.mjs';

const DAY = 86_400_000;
export const SIMON_ENTRIES_URL = 'https://simonwillison.net/atom/entries/';
export const USAGE_SOURCE_KEYS = ['zenn', 'qiita', 'hatenaIt', 'hatenaGeneral', 'hatenaCount', 'hn', 'simon'];
const USER_AGENT = 'ai-kansoku-note/1.0 (+https://github.com/RashiandLau/ai-kansoku-note)';
const SETTINGS = usageRules.collection;
const TOPICS = SETTINGS.zennTopics;
const AI = usageRegex(usageRules.ai_regex);
const HN_AI = usageRegex(SETTINGS.hnAiRegex);
const HN_PRACTICE = usageRegex(SETTINGS.hnPracticeRegex);
const numeric = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
const date = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : undefined;
const error = (message, status = 'missing') => Object.assign(new Error(message), { usageStatus: status });

function decode(value) {
  return String(value ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, code) => {
    if (!code.startsWith('#')) return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[code.toLowerCase()];
    const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
  });
}
export function usagePlainText(value) {
  return decode(String(value ?? '').replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[^]*?-->/g, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/gu, ' ').trim();
}
function attrs(tag) {
  return Object.fromEntries([...String(tag).matchAll(/([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map((m) => [m[1].toLowerCase(), decode(m[2] ?? m[3] ?? m[4])]));
}
function tag(block, name) { return block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, 'i'))?.[1] ?? ''; }
function url(value, base) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return '';
  try {
    const u = new URL(value, base);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : '';
  } catch { return ''; }
}
function candidate(value) {
  const link = url(value.url);
  if (!link || !value.title) return undefined;
  const host = new URL(link).hostname.toLowerCase();
  return { ...value, url: link, host, sourceGroup: ['zenn', 'qiita'].includes(value.source) ? value.source : host === 'note.com' ? 'note' : host,
    tags: value.tags ?? [], body: value.body ?? '', bodyAvailable: Boolean(value.bodyAvailable ?? value.body), metrics: value.metrics ?? {}, hnSignals: value.hnSignals ?? [] };
}

export function parseZennArticle(input, observedAt) {
  const a = input?.article;
  if (!a || typeof a.body_html !== 'string' || !date(a.published_at) || !a.path || !a.title) throw error('Invalid Zenn article schema');
  return candidate({ url: url(a.path, 'https://zenn.dev'), title: a.title, source: 'zenn', language: 'ja', author: a.user?.username,
    publishedAt: a.published_at, body: a.body_html, tags: (a.topics ?? []).map((t) => t.name),
    metrics: { likes: numeric(a.liked_count), saves: numeric(a.bookmarked_count), observedAt } });
}
export function parseQiitaItems(input, observedAt) {
  if (!Array.isArray(input)) throw error('Invalid Qiita list schema');
  return input.flatMap((a) => {
    if (!a || !a.title || !a.url || !date(a.created_at) || typeof a.rendered_body !== 'string' || !Array.isArray(a.tags)) throw error('Invalid Qiita item schema');
    const tags = a.tags.map((t) => t.name);
    if (!AI.test(`${a.title} ${tags.join(' ')}`)) return [];
    return [candidate({ url: a.url, title: a.title, source: 'qiita', language: 'ja', author: a.user?.id, publishedAt: a.created_at,
      body: a.rendered_body, tags, metrics: { likes: numeric(a.likes_count), saves: numeric(a.stocks_count), observedAt } })].filter(Boolean);
  });
}
function feedEntries(xml, element) {
  if (typeof xml !== 'string' || !/<(?:rss|feed|rdf:RDF)\b/i.test(xml) || !/<\/(?:rss|feed|rdf:RDF)\s*>/i.test(xml)) throw error('Invalid or incomplete usage feed');
  const blocks = [...xml.matchAll(new RegExp(`<${element}\\b[^>]*>([\\s\\S]*?)<\\/${element}\\s*>`, 'gi'))];
  if (blocks.length !== [...xml.matchAll(new RegExp(`<${element}\\b`, 'gi'))].length) throw error('Incomplete usage feed entry');
  return blocks.map((m) => m[1]);
}
export function parseHatenaFeed(xml) {
  return feedEntries(xml, 'item').flatMap((block) => {
    const title = usagePlainText(tag(block, 'title'));
    const link = url(decode(tag(block, 'link')).trim());
    const tags = [...block.matchAll(/<dc:subject\b[^>]*>([\s\S]*?)<\/dc:subject>/gi)].map((m) => usagePlainText(m[1]));
    if (!link || !title) throw error('Invalid Hatena RSS item');
    if (!AI.test(`${title} ${tags.join(' ')}`)) return [];
    const count = usagePlainText(tag(block, 'hatena:bookmarkcount'));
    return [{ url: link, title, source: 'hatena', language: 'ja', tags, metrics: { hb: /^\d+$/.test(count) ? Number(count) : undefined } }];
  });
}
export function parseSimonEntries(xml) {
  return feedEntries(xml, 'entry').flatMap((block) => {
    const links = [...block.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0]));
    const link = url(links.find((a) => !a.rel || a.rel === 'alternate')?.href);
    const title = usagePlainText(tag(block, 'title'));
    const publishedAt = date(usagePlainText(tag(block, 'published'))); // updated is never publication.
    const content = tag(block, 'content');
    const contentType = attrs(block.match(/<content\b[^>]*>/i)?.[0] ?? '').type;
    const body = contentType === 'html' ? decode(content) : content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    const tags = [...block.matchAll(/<category\b[^>]*>/gi)].map((m) => attrs(m[0]).term).filter(Boolean);
    if (!link || !title || new URL(link).hostname !== 'simonwillison.net') throw error('Invalid Simon entry');
    return [candidate({ url: link, title, source: 'simon', language: 'en', author: 'Simon Willison', publishedAt, tags, body,
      bodyAvailable: Boolean(content), feedUrl: SIMON_ENTRIES_URL })];
  });
}
export function parseHNUsage(input, { onInvalid = (e) => { throw e; } } = {}) {
  if (!input || !Array.isArray(input.hits) || !Number.isFinite(input.nbHits)) throw error('Invalid HN search schema');
  return input.hits.flatMap((h) => {
    if (!h?.url) return []; // Normal HN self-posts have no original article URL.
    const link = url(h.url);
    if (!link || !h.title || !date(h.created_at) || !/^\d+$/.test(String(h.objectID))) { onInvalid(error('Invalid HN story publication/id schema')); return []; }
    return [{ url: link, title: usagePlainText(h.title), source: 'hn', language: 'en',
      // HN author is a submitter, never the original article author.
      hnSignals: [{ id: String(h.objectID), points: numeric(h.points), comments: numeric(h.num_comments), submittedAt: h.created_at }],
      bodyShortlist: HN_AI.test(`${h.title} ${h.url} ${h.story_text ?? ''}`) && HN_PRACTICE.test(h.title) && h.points >= usageRules.reaction_thresholds.A.hnPoints && h.num_comments >= usageRules.reaction_thresholds.A.hnComments }];
  });
}

// Extract a complete balanced element; nested divs must not truncate a note body.
function elementBody(html, match) {
  if (!match) return '';
  const name = /^<(\w+)/.exec(match[0])?.[1];
  const start = match.index + match[0].length;
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 1, next;
  while ((next = re.exec(html))) {
    if (next[1]) depth--; else if (!/\/\s*>$/.test(next[0])) depth++;
    if (!depth) return html.slice(start, next.index);
  }
  return '';
}
export function parseUsageArticle(html, pageUrl) {
  const meta = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) { const a = attrs(m[0]); meta[(a.property ?? a.name ?? '').toLowerCase()] ??= a.content; }
  const json = [];
  const visit = (v) => { if (!v || typeof v !== 'object') return; if (!Array.isArray(v) && /(?:Article|BlogPosting)/i.test([v['@type']].flat().join(' '))) json.push(v); if (Array.isArray(v)) v.forEach(visit); else if (v['@graph']) visit(v['@graph']); };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { visit(JSON.parse(m[1])); } catch {} }
  const canonicalTag = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0])).find((a) => a.rel?.split(/\s+/).includes('canonical'));
  const canonicalUrl = url(canonicalTag?.href, pageUrl);
  const crossHost = canonicalUrl && new URL(canonicalUrl).hostname !== new URL(pageUrl).hostname;
  const identities = (j) => [j.url, j['@id'], j.mainEntityOfPage].flat().flatMap((v) => typeof v === 'string' ? [v] : v && typeof v === 'object' ? [v['@id'], v.url].filter(Boolean) : []);
  const articleUrls = [pageUrl, ...(!crossHost && canonicalUrl ? [canonicalUrl] : [])].map(normalizeUsageUrl);
  const matching = json.filter((j) => identities(j).some((v) => articleUrls.includes(normalizeUsageUrl(url(v, pageUrl)))));
  const anonymous = json.filter((j) => !identities(j).length);
  // Never borrow a related article's date; ambiguous unidentified nodes cannot
  // establish publication of the page being fetched.
  const article = matching.length === 1 ? matching[0] : !matching.length && anonymous.length === 1 ? anonymous[0] : {};
  const publishedAt = crossHost ? undefined : date(article.datePublished ?? meta['article:published_time'] ?? meta['datepublished'] ?? meta['pubdate']);
  const paywalled = article.isAccessibleForFree === false || article.isAccessibleForFree === 'false';
  const note = html.match(/<div\b[^>]*\bid\s*=\s*["']note-body["'][^>]*>/i);
  const simonBody = new URL(pageUrl).hostname === 'simonwillison.net' ? html.match(/<div\b[^>]*\bdata-permalink-context\s*=\s*["'][^"']+["'][^>]*>/i) : null;
  const scoped = note ?? simonBody ?? html.match(/<article\b[^>]*>/i) ?? html.match(/<main\b[^>]*>/i);
  const body = paywalled ? '' : elementBody(html, scoped).replace(/<(script|style|noscript|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const authors = [article.author].flat().filter(Boolean);
  const author = authors.map((a) => typeof a === 'string' ? a : a.name).filter(Boolean).join(', ') || meta.author;
  const keywords = Array.isArray(article.keywords) ? article.keywords : typeof article.keywords === 'string' ? article.keywords.split(',').map((v) => v.trim()) : [];
  return { title: usagePlainText(article.headline ?? meta['og:title'] ?? tag(html, 'title')), publishedAt, author, body, bodyAvailable: Boolean(body) && !paywalled,
    tags: keywords, canonicalUrl: crossHost || !publishedAt ? undefined : canonicalUrl || undefined,
    publicationRejection: crossHost ? 'cross_site_canonical_original_publication_unverified' : !publishedAt ? 'publication_unknown' : undefined };
}

export function robotsPolicy(text, target, agent = 'ai-kansoku-note') {
  const groups = []; let group;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].trim().toLowerCase(), value = match[2].trim();
    if (key === 'user-agent') {
      if (!group || group.rules.length) { group = { agents: [], rules: [] }; groups.push(group); }
      group.agents.push(value.toLowerCase());
    } else if (group) group.rules.push([key, value]);
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.toLowerCase().includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  const pathname = new URL(target).pathname + new URL(target).search;
  let winner = { length: -1, allow: true }, delayMs = SETTINGS.sameHostDelayMs;
  for (const g of chosen) for (const [key, value] of g.rules) {
    if (key === 'crawl-delay' && Number.isFinite(Number(value))) delayMs = Math.max(delayMs, Number(value) * 1000);
    if (!['allow', 'disallow'].includes(key) || !value) continue;
    const expression = value.split('*').map((p) => p.replace(/[.+?^{}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\$$/, '$');
    if (!new RegExp(`^${expression}`).test(pathname)) continue;
    const length = value.replace(/\*/g, '').length;
    if (length > winner.length || (length === winner.length && key === 'allow')) winner = { length, allow: key === 'allow' };
  }
  return { allowed: winner.allow, delayMs };
}

function publicAddress(value) {
  const ip = value.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  if (isIP(ip) === 6) return !/^(?:::|fc|fd|fe[89ab]|2001:db8)/.test(ip);
  return false;
}
export function publicUsageUrl(value) {
  const link = url(value);
  if (!link) return false;
  const u = new URL(link), host = u.hostname.toLowerCase();
  if (u.port && !['80', '443'].includes(u.port)) return false;
  if (host === 'localhost' || /\.(?:localhost|local|internal|test|invalid)$/.test(host)) return false;
  return isIP(host.replace(/^\[|\]$/g, '')) ? publicAddress(host) : host.includes('.');
}

export function createUsageFetcher({ fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), clock = Date.now,
  timeoutMs = SETTINGS.timeoutMs, maxBytes = SETTINGS.maximumBodyBytes, resolveHost = async (host) => (await lookup(host, { all: true })).map((r) => r.address) } = {}) {
  const queues = new Map(), last = new Map(), stopped = new Map(), robots = new Map(), delays = new Map(), resolved = new Set();
  const queueKey = (host) => /(?:^|\.)hatena(?:apis)?\.(?:com|ne\.jp)$/.test(host) ? 'hatena' : host;
  async function request(target, { allowMissingRobots = false } = {}) {
    if (!publicUsageUrl(target)) throw error('Non-public usage URL rejected', 'forbidden');
    const u = new URL(target), host = u.hostname, key = queueKey(host);
    const previous = queues.get(key) ?? Promise.resolve();
    const job = previous.catch(() => {}).then(async () => {
      if (stopped.has(key)) throw error(`Source paused: ${stopped.get(key)}`, stopped.get(key));
      const delay = Math.max(key === 'hatena' ? SETTINGS.hatenaDelayMs : SETTINGS.sameHostDelayMs, delays.get(host) ?? 0);
      if (last.has(key)) await sleep(Math.max(0, last.get(key) + delay - clock()));
      last.set(key, clock());
      const controller = new AbortController();
      let timer, response, reader, consumed = false;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(error('Usage request timed out')); }, timeoutMs); });
      try {
        if (resolveHost && !resolved.has(host)) {
          const addresses = await Promise.race([resolveHost(host), timeout]);
          if (!addresses.length || addresses.some((a) => !publicAddress(a))) throw error('Non-public resolved address rejected', 'forbidden');
          resolved.add(host);
        }
        response = await Promise.race([fetchImpl(target, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, application/atom+xml, application/rss+xml, text/html, text/plain' }, signal: controller.signal, redirect: 'manual' }), timeout]);
        if ([403, 429].includes(response.status)) { const status = response.status === 403 ? 'forbidden' : 'missing'; stopped.set(key, status); throw error(`HTTP ${response.status}; host paused for this run`, status); }
        if (allowMissingRobots && response.status === 404) return { text: '', status: 404, headers: response.headers };
        if (response.status >= 300 && response.status < 400) {
          const next = url(response.headers.get('location'), target);
          if (!next || !publicUsageUrl(next) || new URL(next).hostname !== host) throw error('Cross-host or unsafe redirect rejected', 'forbidden');
          return { redirect: next };
        }
        if (!response.ok) throw error(`HTTP ${response.status}`);
        if (Number(response.headers.get('content-length')) > maxBytes) throw error('Usage response exceeds size limit', 'truncated');
        let body;
        if (response.body?.getReader) {
          reader = response.body.getReader();
          const chunks = []; let total = 0;
          while (true) {
            const { done, value } = await Promise.race([reader.read(), timeout]);
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) throw error('Usage response exceeds size limit', 'truncated');
            chunks.push(value);
          }
          body = Buffer.concat(chunks).toString('utf8');
        } else {
          body = await Promise.race([response.text(), timeout]);
          if (Buffer.byteLength(body) > maxBytes) throw error('Usage response exceeds size limit', 'truncated');
        }
        consumed = true;
        const remaining = response.headers.get('rate-remaining') ?? response.headers.get('x-ratelimit-remaining');
        if (remaining !== null && Number(remaining) === 0) stopped.set(key, 'missing');
        return { text: body, status: response.status, headers: response.headers };
      } finally {
        clearTimeout(timer);
        // Cancellation is initiated even for redirects/errors and stalled streams.
        // Do not await a hostile stream's cancel hook indefinitely.
        if (!consumed) {
          controller.abort();
          const cancellation = reader ? reader.cancel() : response?.body?.cancel();
          cancellation?.catch(() => {});
        }
        if (reader) { try { reader.releaseLock(); } catch {} }
      }
    });
    queues.set(key, job);
    return job;
  }
  async function fetchText(target, options = {}) {
    let current = target;
    for (let i = 0; i < 4; i++) {
      if (options.checkRobots) await checkRobots(current);
      const response = await request(current, options);
      if (!response.redirect) return response;
      current = response.redirect;
    }
    throw error('Too many redirects', 'missing');
  }
  async function checkRobots(target) {
    const u = new URL(target);
    if (!robots.has(u.origin)) robots.set(u.origin, fetchText(`${u.origin}/robots.txt`, { allowMissingRobots: true }));
    const result = await robots.get(u.origin); // missing/failed robots fail closed; 404 explicitly permits.
    const policy = robotsPolicy(result.text, target);
    if (!policy.allowed) throw error('robots.txt forbids article fetch', 'forbidden');
    delays.set(u.hostname, policy.delayMs);
  }
  async function article(target) { return (await fetchText(target, { checkRobots: true })).text; }
  return { fetchText, article };
}

export async function createUsageFixtureFetch(directory) {
  let root = directory, manifest;
  try { manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')); }
  catch { root = path.join(directory, 'usage'); manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')); }
  return async (target) => {
    const route = manifest.routes.find((r) => r.url === target || (r.prefix && target.startsWith(r.prefix)));
    if (!route) throw error(`Missing usage fixture: ${target}`);
    const fixturePath = route.file && path.resolve(root, route.file);
    if (fixturePath && !fixturePath.startsWith(`${path.resolve(root)}${path.sep}`)) throw error('Fixture path escapes fixture directory');
    const body = route.file ? await readFile(fixturePath, 'utf8') : route.body ?? '';
    return new Response(body, { status: route.status ?? 200, headers: route.headers });
  };
}

export async function collectUsageSources({ now = new Date(), pending = [], fixtures, fetchImpl, sleep, clock, resolveHost, limits = {} } = {}) {
  const at = new Date(now).toISOString(), cutoff = Date.parse(at) - usageRules.window_days * DAY;
  const usageSources = Object.fromEntries(USAGE_SOURCE_KEYS.map((k) => [k, 'ok'])), errors = [], all = new Map();
  const severity = { ok: 0, missing: 1, truncated: 2, forbidden: 3 };
  const failed = (key, reason) => { const status = reason.usageStatus ?? 'missing'; if (severity[status] > severity[usageSources[key]]) usageSources[key] = status; errors.push({ source: key, message: reason.message, status }); };
  let transport;
  try { transport = createUsageFetcher({ fetchImpl: fixtures ? await createUsageFixtureFetch(fixtures) : fetchImpl, sleep: fixtures ? async () => {} : sleep,
    clock, resolveHost: fixtures || fetchImpl ? null : resolveHost, ...limits }); }
  catch (reason) { for (const key of USAGE_SOURCE_KEYS) failed(key, reason); return { candidates: [], usageSources, errors }; }
  const get = async (target) => (await transport.fetchText(target)).text;
  const json = async (target) => JSON.parse(await get(target));
  const inWindow = (c) => date(c.publishedAt) && Date.parse(c.publishedAt) >= cutoff && Date.parse(c.publishedAt) <= Date.parse(at);
  const keyFor = normalizeUsageUrl;
  function add(c) {
    if (!c) return;
    const k = keyFor(c.url), previous = all.get(k);
    if (previous) {
      // Platform detail wins over a discovery wrapper; reaction signals combine.
      const prefer = c.bodyAvailable && (!previous.bodyAvailable || ['zenn', 'qiita', 'simon'].includes(c.source));
      all.set(k, { ...(prefer ? c : previous), metrics: { ...previous.metrics, ...c.metrics, observedAt: at }, hnSignals: [...(previous.hnSignals ?? []), ...(c.hnSignals ?? [])] });
    } else all.set(k, candidate({ ...c, metrics: { ...c.metrics, observedAt: at } }));
  }
  const activePending = pending.filter(inWindow);
  // Reactions and bodies are refreshed; persisted prior observations are never reused as today's evidence.
  for (const p of activePending) add({ ...p, body: '', bodyAvailable: false, metrics: {}, hnSignals: [] });
  const zennTargets = new Map(activePending.filter((p) => p.source === 'zenn').map((p) => [p.url.split('/').filter(Boolean).at(-1), p]));
  async function zenn() {
    for (const topic of TOPICS) {
      try {
        let page = 1, complete = false;
        const max = limits.zennPages ?? SETTINGS.zennMaxPages;
        for (let n = 0; n < max; n++) {
          const data = await json(`https://zenn.dev/api/articles?topicname=${topic}&order=latest&page=${page}`);
          if (!Array.isArray(data.articles)) throw error('Invalid Zenn list schema');
          for (const a of data.articles) {
            if (!a.slug || !a.path || !date(a.published_at)) throw error('Invalid Zenn list article');
            if (a.liked_count >= SETTINGS.zennMinimumLikes && inWindow({ publishedAt: a.published_at })) zennTargets.set(a.slug, a);
          }
          if (!data.next_page || data.articles.some((a) => Date.parse(a.published_at) < cutoff)) { complete = true; break; }
          if (!Number.isInteger(data.next_page) || data.next_page <= page) throw error('Invalid Zenn pagination');
          page = data.next_page;
        }
        if (!complete) failed('zenn', error('Zenn page limit before publication window exhausted', 'truncated'));
      } catch (e) { failed('zenn', e); if (e.usageStatus === 'forbidden' || /paused/.test(e.message)) break; }
    }
  }
  async function qiita() {
    try {
      const since = new Date(cutoff).toISOString().slice(0, 10);
      for (let page = 1; page <= SETTINGS.qiitaMaxPages; page++) {
        const query = encodeURIComponent(`created:>=${since} stocks:>=${SETTINGS.qiitaMinimumStocks}`);
        const data = await json(`https://qiita.com/api/v2/items?query=${query}&per_page=${SETTINGS.qiitaPerPage}&page=${page}`);
        for (const c of parseQiitaItems(data, at)) if (inWindow(c)) add(c);
        if (data.length < SETTINGS.qiitaPerPage) break;
        if (page === SETTINGS.qiitaMaxPages) failed('qiita', error('Qiita two-list-request daily cap reached', 'truncated'));
      }
    } catch (e) { failed('qiita', e); }
  }
  const hatenaTargets = [];
  async function hatena(key, endpoint) {
    try { hatenaTargets.push(...parseHatenaFeed(await get(endpoint)).map((c) => ({ ...c, statusKey: key }))); }
    catch (e) { failed(key, e); }
  }
  let hnHits = [];
  async function hnRange(start, end, depth = 0) {
    const filters = encodeURIComponent(`created_at_i>=${Math.floor(start / 1000)},created_at_i<${Math.ceil(end / 1000)},points>=10`);
    const data = await json(`https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=${filters}&hitsPerPage=1000&page=0`);
    if (data.nbHits > 1000) {
      if (depth >= 12 || end - start <= 1000) throw error('HN date split still truncated', 'truncated');
      const middle = Math.floor((start + end) / 2000) * 1000;
      await hnRange(start, middle, depth + 1); await hnRange(middle, end, depth + 1); return;
    }
    if (data.exhaustiveNbHits === false || (Number.isFinite(data.nbHits) && data.hits?.length < data.nbHits)) throw error('Incomplete HN date slice', 'truncated');
    hnHits.push(...parseHNUsage(data, { onInvalid: (e) => failed('hn', e) }).filter((h) => Date.parse(h.hnSignals[0].submittedAt) <= Date.parse(at)));
  }
  async function hn() {
    try { for (let start = cutoff; start < Date.parse(at); start += DAY) await hnRange(start, Math.min(start + DAY, Date.parse(at))); }
    catch (e) { failed('hn', e); }
  }
  async function simon() {
    try {
      for (const c of parseSimonEntries(await get(SIMON_ENTRIES_URL))) {
        if (!c.publishedAt) { failed('simon', error('Simon entry publication missing; updated is not publication')); continue; }
        if (inWindow(c)) add(c);
      }
    }
    catch (e) { failed('simon', e); }
  }
  // Independent hosts can progress concurrently; the transport serializes all same-host requests.
  await Promise.all([zenn(), qiita(), hatena('hatenaIt', 'https://b.hatena.ne.jp/hotentry/it.rss'), hatena('hatenaGeneral', 'https://b.hatena.ne.jp/hotentry.rss'), hn(), simon()]);
  const discovery = new Map();
  for (const c of hatenaTargets) if ((c.metrics.hb ?? 0) >= usageRules.reaction_thresholds.A.hb) {
    const slug = new URL(c.url).hostname === 'zenn.dev' && /^\/[^/]+\/articles\/([^/]+)\/?$/.exec(new URL(c.url).pathname)?.[1];
    if (slug) zennTargets.set(slug, c);
    else discovery.set(keyFor(c.url), c);
  }
  for (const [slug] of zennTargets) {
    try { add(parseZennArticle(await json(`https://zenn.dev/api/articles/${encodeURIComponent(slug)}`), at)); }
    catch (e) { failed('zenn', e); if (e.usageStatus === 'forbidden' || /paused/.test(e.message)) break; }
  }
  // Join all observed HN signals, not only the article-fetch shortlist.
  const signals = new Map();
  for (const h of hnHits) signals.set(keyFor(h.url), [...(signals.get(keyFor(h.url)) ?? []), ...h.hnSignals]);
  const shortlist = hnHits.filter((h) => h.bodyShortlist).sort((a, b) => b.hnSignals[0].points - a.hnSignals[0].points || b.hnSignals[0].comments - a.hnSignals[0].comments || Number(a.hnSignals[0].id) - Number(b.hnSignals[0].id));
  const uniqueHN = [...new Map(shortlist.map((h) => [keyFor(h.url), h])).values()];
  const maxHN = limits.hnBodies ?? SETTINGS.hnMaximumBodies;
  if (uniqueHN.length > maxHN) failed('hn', error('HN article-fetch daily cap reached', 'truncated'));
  for (const h of uniqueHN.slice(0, maxHN)) if (!all.get(keyFor(h.url))?.bodyAvailable) discovery.set(keyFor(h.url), { ...h, statusKey: 'hn' });
  for (const c of all.values()) if (c.source === 'simon' && !c.bodyAvailable) discovery.set(keyFor(c.url), { ...c, statusKey: 'simon' });
  for (const p of activePending) if (!['qiita', 'zenn'].includes(p.source) && !all.get(keyFor(p.url))?.bodyAvailable && !discovery.has(keyFor(p.url))) {
    // HN pending articles share the same 20-body cap as newly discovered HN stories.
    if (p.source === 'hn' && [...discovery.values()].filter((v) => v.statusKey === 'hn').length >= maxHN) { failed('hn', error('HN pending body cap reached', 'truncated')); continue; }
    discovery.set(keyFor(p.url), { ...p, metrics: {}, hnSignals: [], statusKey: p.source === 'simon' ? 'simon' : p.source === 'hn' ? 'hn' : 'hatenaIt' });
  }
  for (const c of discovery.values()) {
    try {
      if (['github.com', 'news.ycombinator.com', 'youtube.com', 'www.youtube.com', 'youtu.be'].includes(new URL(c.url).hostname)) continue;
      // Qiita's two list responses are the only permitted Qiita requests, even
      // when another source discovers an individual article URL.
      if (new URL(c.url).hostname === 'qiita.com') {
        if (!all.get(keyFor(c.url))?.bodyAvailable) failed(c.statusKey, error('Qiita article absent from bounded list responses; no per-item request'));
        continue;
      }
      const parsed = parseUsageArticle(await transport.article(c.url), c.url);
      // The original author's entries feed is a publication source, unlike HN
      // or Hatena discovery dates. Use its verified published value if the
      // original article template has no machine-readable publication field.
      if (!parsed.publishedAt && c.source === 'simon' && c.feedUrl === SIMON_ENTRIES_URL && c.publishedAt && parsed.publicationRejection === 'publication_unknown') parsed.publishedAt = c.publishedAt;
      if (!parsed.bodyAvailable || !parsed.publishedAt) throw error(parsed.publicationRejection ?? 'Article body missing or excerpt-only');
      const canonical = parsed.canonicalUrl ?? c.url;
      const aliases = canonical !== c.url ? [...new Set([...(c.aliases ?? []), c.url])] : c.aliases;
      add(candidate({ ...c, ...parsed, url: canonical, aliases, title: parsed.title || c.title, author: parsed.author || c.author,
        tags: [...new Set([...(c.tags ?? []), ...parsed.tags])],
        hnSignals: [...(signals.get(keyFor(c.url)) ?? []), ...(canonical !== c.url ? signals.get(keyFor(canonical)) ?? [] : [])] }));
    } catch (e) { failed(c.statusKey, e); }
  }
  for (const c of all.values()) {
    const found = [c.url, ...(c.aliases ?? [])].flatMap((u) => signals.get(keyFor(u)) ?? []);
    if (found.length) c.hnSignals = [...new Map(found.map((h) => [h.id, h])).values()];
  }
  const urls = [...new Set([...all.values()].map((c) => c.url))];
  // RSS counts are a discovery filter; only this fresh count pass supplies the
  // final metric. Unrequested batches after a circuit break must remain missing.
  for (const c of all.values()) delete c.metrics.hb;
  for (let i = 0; i < urls.length; i += SETTINGS.hatenaCountBatchSize) {
    const batch = urls.slice(i, i + SETTINGS.hatenaCountBatchSize);
    try {
      const data = await json(`https://bookmark.hatenaapis.com/count/entries?${batch.map((u) => `url=${encodeURIComponent(u)}`).join('&')}`);
      if (!data || Array.isArray(data) || typeof data !== 'object') throw error('Invalid Hatena count schema');
      for (const link of batch) {
        const c = all.get(keyFor(link));
        if (numeric(data[link]) === undefined) { delete c.metrics.hb; failed('hatenaCount', error(`Missing Hatena count for ${link}`)); }
        else c.metrics.hb = data[link];
      }
    } catch (e) { for (const link of batch) delete all.get(keyFor(link)).metrics.hb; failed('hatenaCount', e); if (e.usageStatus === 'forbidden' || /paused/.test(e.message)) break; }
  }
  return { candidates: [...all.values()], usageSources, errors };
}
