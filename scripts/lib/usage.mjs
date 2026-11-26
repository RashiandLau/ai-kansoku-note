import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const usageRules = JSON.parse(readFileSync(new URL('../../config/usage-rules.json', import.meta.url), 'utf8'));
const DAY = 86_400_000;
const WORD = '[\\p{L}\\p{N}_]';
const BOUNDARY = `(?:(?<!${WORD})(?=${WORD})|(?<=${WORD})(?!${WORD}))`;

// Python re's Unicode \w and \b differ from JavaScript's ASCII-only versions.
export function usageRegex(pattern, flags = 'iu') {
  // Python IGNORECASE also folds the dotted/dotless Turkish I.
  const folded = flags.includes('i') ? pattern.replace(/[iI]/g, '[iIİı]') : pattern;
  return new RegExp(folded.replace(/\[\\w-\]/g, '[\\p{L}\\p{N}_-]').replace(/\\w/g, WORD).replace(/\\b/g, BOUNDARY), flags);
}

const patterns = Object.fromEntries([
  ['ai', 'ai_regex'], ['practitioner', 'practitioner_regex'], ['outcome', 'outcome_regex'],
  ['prompt', 'prompt_regex'], ['usageIntentTitle', 'usage_title_regex'], ['translationTitle', 'translation_title_reject_regex'],
  ['shift', 'shift_regex_diagnostic_only'], ['steps', 'steps_regex'],
].map(([key, config]) => [key, usageRegex(usageRules[config])]));
const claims = usageRules.usage_claim_regexes.map(pattern => usageRegex(pattern));
const actionPattern = usageRegex(usageRules.action_regex, 'giu');
const artifactPattern = new RegExp(usageRules.artifact_regex, 'u');

export function normalizeUsageUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/u.test(value)) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    const parts = /^(https?):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/iu.exec(value);
    if (!parts || !parts[2] || parts[2].includes('\\')) return '';
    const pairs = [...new URLSearchParams(parts[4] ?? '')].filter(([key]) => !/^utm_/i.test(key) && !['fbclid', 'gclid', 'ref_src'].includes(key.toLowerCase()));
    pairs.sort(([a, av], [b, bv]) => compareText(a, b) || compareText(av, bv));
    // urllib.parse.urlencode (research) keeps ~ but escapes *; URLSearchParams does the inverse.
    const quotePlus = value => encodeURIComponent(value).replace(/[!'()*]/gu, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/gu, '+');
    const query = pairs.map(([key, value]) => `${quotePlus(key)}=${quotePlus(value)}`).join('&');
    return `${parts[1].toLowerCase()}://${parts[2].toLowerCase()}${parts[3].replace(/\/+$/u, '')}${query ? `?${query}` : ''}`;
  } catch { return ''; }
}

function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function timestamp(value) {
  if (value === undefined || value === null || value === '') return NaN;
  if (typeof value === 'string') {
    const datePart = /^(\d{4}-\d{2}-\d{2})(?:T| |$)/u.exec(value)?.[1];
    if (datePart) {
      const midnight = new Date(`${datePart}T00:00:00Z`);
      if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== datePart) return NaN;
      // research-backtest.py treats timestamps without timezone information as UTC.
      if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/u.test(value)) value += 'Z';
    }
  }
  return new Date(value).getTime();
}
function asIso(value) { const time = timestamp(value); return Number.isFinite(time) ? new Date(time).toISOString() : ''; }
function metric(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } }

function verifiedAliases(candidate) {
  const canonical = normalizeUsageUrl(candidate?.url);
  if (!canonical || normalizeUsageUrl(candidate.canonicalUrl) !== canonical || !usagePublicationBounds(candidate.publishedAt)) return [];
  return [...new Set((Array.isArray(candidate.aliases) ? candidate.aliases : []).map(normalizeUsageUrl)
    .filter(alias => alias && alias !== canonical && hostOf(alias) === hostOf(canonical)))];
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', copy: '©', reg: '®', trade: '™', bull: '•', middot: '·', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', NewLine: '\n', Tab: '\t' };
function decode(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);?/giu, (original, code) => {
    if (code[0] !== '#') return entities[code] ?? original;
    const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '\ufffd';
  });
}

// Small inert HTML tokenizer: no DOM, scripts, images or external entities execute.
// Counts match the research HTMLParser, including structural tags in noscript.
function parseBody(body) {
  const result = { text: [], codeBlocks: 0, orderedLists: 0, images: 0, quotes: 0, links: [] };
  const input = String(body ?? '');
  const tokens = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?[a-z](?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+|</giu;
  let skipped = 0;
  let rawTag = '';
  for (const token of input.matchAll(tokens)) {
    const value = token[0];
    const tag = /^<(\/?)([a-z][\w:-]*)\b/iu.exec(value);
    if (rawTag) {
      if (tag?.[1] && tag[2].toLowerCase() === rawTag) { skipped = Math.max(0, skipped - 1); rawTag = ''; }
      continue;
    }
    if (tag) {
      const name = tag[2].toLowerCase();
      if (tag[1]) {
        if (['script', 'style', 'noscript'].includes(name)) skipped = Math.max(0, skipped - 1);
        continue;
      }
      if (['script', 'style', 'noscript'].includes(name)) {
        skipped += 1;
        if (name !== 'noscript') rawTag = name;
      }
      const field = { pre: 'codeBlocks', ol: 'orderedLists', img: 'images', blockquote: 'quotes' }[name];
      if (field) result[field] += 1;
      if (name === 'a') {
        const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(value);
        result.links.push(decode(href?.[1] ?? href?.[2] ?? href?.[3] ?? ''));
      }
      if (/\/\s*>$/u.test(value) && ['script', 'style', 'noscript'].includes(name)) { skipped = Math.max(0, skipped - 1); rawTag = ''; }
    } else if (!skipped && !value.startsWith('<!')) result.text.push(decode(value));
  }
  result.text = result.text.join(' ').replace(/\s+/gu, ' ').trim();
  return result;
}

export function bodyFeatures(body, title = '', tags = []) {
  const p = parseBody(body);
  const text = p.text;
  const actions = [...new Set([...text.matchAll(actionPattern)].map(match => match[0].toLowerCase()))].sort();
  const prompt = patterns.prompt.test(text);
  const steps = Boolean(p.orderedLists || patterns.steps.test(text));
  const artifact = p.links.some(link => artifactPattern.test(link));
  const limits = usageRules.recipe_thresholds;
  const recipe = p.codeBlocks >= limits.codeBlocks
    || (steps && actions.length >= limits.distinctActions && (p.codeBlocks >= limits.stepCodeBlocks || p.images >= limits.stepImages || artifact))
    || (prompt && (p.quotes >= limits.promptQuotes || p.images >= limits.promptImages));
  const usageIntentTitle = patterns.usageIntentTitle.test(title);
  const usageClaim = claims.some(pattern => pattern.test(text));
  return {
    chars: [...text.replace(/\s/gu, '')].length,
    words: [...text.matchAll(usageRegex('\\b[\\w-]+\\b', 'gu'))].length,
    codeBlocks: p.codeBlocks, orderedLists: p.orderedLists, images: p.images, quotes: p.quotes,
    ai: patterns.ai.test(`${title} ${text} ${tags.join(' ')}`), practitioner: patterns.practitioner.test(text),
    outcome: patterns.outcome.test(text), prompt, steps, artifact, actions, usageIntentTitle, usageClaim,
    usageEvidence: usageIntentTitle || usageClaim, translationTitle: patterns.translationTitle.test(title), recipe,
    shift: patterns.shift.test(`${title} ${text}`), textPreview: [...text].slice(0, 180).join(''),
  };
}

export function usagePublicationBounds(value) {
  const parsed = timestamp(value);
  if (!Number.isFinite(parsed)) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    if (new Date(parsed).toISOString().slice(0, 10) !== value) return null;
    return { earliest: parsed + usageRules.date_only_earliest_hours * 3_600_000, latest: parsed + usageRules.date_only_latest_hours * 3_600_000 };
  }
  return { earliest: parsed, latest: parsed };
}

function publicationInWindow(candidate, now) {
  const bounds = usagePublicationBounds(candidate.publishedAt);
  return Boolean(bounds && bounds.latest <= timestamp(now) && timestamp(now) - bounds.earliest <= usageRules.window_days * DAY);
}

function observedHN(candidate, now, qualifies = false) {
  const limits = usageRules.reaction_thresholds.A;
  return (candidate.hnSignals ?? []).filter(signal => signal && /^\d+$/u.test(String(signal.id ?? ''))
    && metric(signal.points) !== null && metric(signal.comments) !== null
    && (!qualifies || (signal.points >= limits.hnPoints && signal.comments >= limits.hnComments))
    && timestamp(signal.submittedAt) <= timestamp(now))
    .sort((a, b) => b.points - a.points || b.comments - a.comments || compareText(String(b.id), String(a.id)))[0] ?? null;
}
function qualifiedHN(candidate, now) { return observedHN(candidate, now, true); }

export function qualifyUsage(candidate, now) {
  const url = normalizeUsageUrl(candidate.url);
  if (!url || !['ja', 'en'].includes(candidate.language) || !publicationInWindow(candidate, now)
    || usageRules.excluded_article_hosts.includes(hostOf(url))) return null;
  if (candidate.bodyAvailable === false) return null;
  const features = typeof candidate.body === 'string' ? bodyFeatures(candidate.body, candidate.title, candidate.tags ?? []) : candidate.features;
  if (!features || (typeof candidate.body === 'string' && !candidate.body.trim()) || (candidate.body === undefined && candidate.bodyAvailable !== true)) return null;
  const chosenHN = qualifiedHN(candidate, now);
  const hb = metric(candidate.metrics?.hb);
  const likes = metric(candidate.metrics?.likes);
  const saves = metric(candidate.metrics?.saves);
  const a = usageRules.reaction_thresholds.A;
  const b = usageRules.reaction_thresholds.B;
  const standard = features.ai && features.practitioner && features.outcome && features.recipe && features.usageEvidence
    && !features.translationTitle && (candidate.language === 'ja' ? features.chars >= usageRules.body_min.ja_nonspace_chars : features.words >= usageRules.body_min.en_words);
  if (standard && ((hb !== null && hb >= a.hb) || chosenHN)) {
    return { route: 'A', strength: Math.max((hb ?? 0) / a.hb, (chosenHN?.points ?? 0) / a.hnPoints), chosenHN, features };
  }
  if (standard && b.sources.includes(candidate.source) && saves !== null && likes !== null
    && saves >= b.saves && likes >= b.likes && saves / Math.max(likes, 1) >= b.saveRatio) {
    return { route: 'B', strength: saves / b.saves, chosenHN: null, features };
  }
  const tags = candidate.tags ?? [];
  const trusted = usageRules.trustedAuthors.find(author => candidate.source === author.source && hostOf(url) === author.host
    && candidate.feedUrl === author.feedUrl && candidate.language === author.language
    && features.words >= author.minimumWords && author.requiredAnyTags.some(tag => tags.includes(tag))
    && !author.excludedTags.some(tag => tags.includes(tag)));
  return trusted ? { route: 'C', strength: usageRules.route_c_strength, chosenHN, features } : null;
}

export function chooseUsageDiscussion(candidate, now) {
  const hn = qualifiedHN(candidate, now);
  if (hn) return { url: `https://news.ycombinator.com/item?id=${encodeURIComponent(hn.id)}`, source: 'hn', count: hn.comments, points: hn.points };
  const hb = metric(candidate.metrics?.hb);
  if (hb === null || hb < 1) return null;
  let known = normalizeUsageUrl(candidate.hatenaEntryUrl);
  if (hostOf(known) !== 'b.hatena.ne.jp') known = '';
  const normalized = normalizeUsageUrl(candidate.url);
  if (!normalized) return null;
  const article = new URL(normalized);
  const url = known || `https://b.hatena.ne.jp/entry/${article.protocol === 'https:' ? 's/' : ''}${article.host}${article.pathname === '/' ? '' : article.pathname}${article.search}`;
  return { url, source: 'hatena', count: hb };
}

function sourceGroup(candidate) {
  const host = hostOf(candidate.url);
  if (host === 'zenn.dev' || candidate.source === 'zenn') return 'zenn';
  if (host === 'qiita.com' || candidate.source === 'qiita') return 'qiita';
  return host === 'note.com' ? 'note' : host;
}

function compareUsage(a, b) {
  const routes = { A: 0, B: 1, C: 2 };
  return routes[a.route] - routes[b.route]
    || (timestamp(a.firstQualifiedAt) || 0) - (timestamp(b.firstQualifiedAt) || 0)
    || b.strength - a.strength
    || (usagePublicationBounds(b.publishedAt)?.latest ?? 0) - (usagePublicationBounds(a.publishedAt)?.latest ?? 0)
    || compareText(normalizeUsageUrl(a.url), normalizeUsageUrl(b.url));
}

export function assembleUsage(candidates) {
  const eligible = [...candidates].filter(candidate => ['A', 'B', 'C'].includes(candidate.route)).sort(compareUsage);
  const selected = [], urls = new Set(), source = new Map(), author = new Map(), language = new Map();
  const count = (map, key) => map.get(key) ?? 0;
  function add(candidate) {
    const key = normalizeUsageUrl(candidate.url);
    const identities = [key, ...verifiedAliases(candidate)];
    const group = sourceGroup(candidate);
    const authorKey = `${group}:${candidate.author || group}`;
    if (!key || identities.some(url => urls.has(url)) || selected.length >= usageRules.maximum_items
      || count(source, group) >= usageRules.maximum_per_source || count(author, authorKey) >= usageRules.maximum_per_author
      || count(language, candidate.language) >= usageRules.maximum_per_language) return false;
    selected.push(candidate); identities.forEach(url => urls.add(url));
    for (const [map, value] of [[source, group], [author, authorKey], [language, candidate.language]]) map.set(value, count(map, value) + 1);
    return true;
  }
  for (const [lang, reserve] of Object.entries(usageRules.reserved)) {
    for (const candidate of eligible) {
      if (count(language, lang) >= reserve) break;
      if (candidate.language === lang) add(candidate);
    }
  }
  for (const candidate of eligible) add(candidate);
  return selected;
}

export function toRawUsageItem(candidate, now) {
  const url = normalizeUsageUrl(candidate.url);
  const excerpt = typeof candidate.body === 'string' ? parseBody(candidate.body).text : candidate.excerpt ?? candidate.features?.textPreview ?? '';
  const metrics = { observedAt: asIso(candidate.metrics?.observedAt) || asIso(now) };
  for (const name of ['hb', 'likes', 'saves']) if (metric(candidate.metrics?.[name]) !== null) metrics[name] = candidate.metrics[name];
  const hn = observedHN(candidate, now);
  if (hn) { metrics.hnPoints = hn.points; metrics.hnComments = hn.comments; }
  const result = {
    id: `usage-${hash(url).slice(0, 16)}`, kind: 'usage', title: candidate.title, url,
    source: candidate.source, host: hostOf(url), language: candidate.language,
    publishedAt: candidate.publishedAt, published: candidate.publishedAt, metrics, route: candidate.route,
    firstQualifiedAt: candidate.firstQualifiedAt, ruleVersion: usageRules.ruleVersion,
    excerpt: [...excerpt].slice(0, usageRules.excerpt_max_chars).join(''), image: '', ogTitle: '', ogDescription: '',
  };
  if (candidate.author) result.author = candidate.author;
  const aliases = verifiedAliases(candidate);
  if (aliases.length) { result.canonicalUrl = url; result.aliases = aliases; }
  const discussion = chooseUsageDiscussion(candidate, now);
  if (discussion) result.discussion = discussion;
  return result;
}

function compactCandidate(candidate, prior, now) {
  const next = {};
  for (const key of ['url', 'title', 'source', 'host', 'language', 'author', 'publishedAt', 'tags', 'feedUrl', 'hatenaEntryUrl', 'bodyAvailable', 'metrics', 'hnSignals', 'features', 'excerpt', 'bodyHash']) {
    if (candidate[key] !== undefined) next[key] = candidate[key];
  }
  const aliases = verifiedAliases(candidate);
  if (aliases.length) { next.canonicalUrl = candidate.url; next.aliases = aliases; }
  if (typeof candidate.body === 'string' && candidate.body) {
    next.features = bodyFeatures(candidate.body, candidate.title, candidate.tags ?? []);
    next.bodyHash = hash(candidate.body);
    next.excerpt = [...parseBody(candidate.body).text].slice(0, usageRules.excerpt_max_chars).join('');
    next.bodyAvailable = candidate.bodyAvailable !== false;
  }
  next.firstSeenAt = prior?.firstSeenAt || now;
  next.lastObservedAt = now;
  next.metricsObservedAt = asIso(candidate.metrics?.observedAt) || now;
  next.ruleVersion = usageRules.ruleVersion;
  if (prior?.firstQualifiedAt) next.firstQualifiedAt = prior.firstQualifiedAt;
  return next;
}

function observedToday(candidate, now) {
  if (!candidate.metrics?.observedAt) return true;
  const observed = timestamp(candidate.metrics.observedAt), current = timestamp(now);
  return Number.isFinite(observed) && observed <= current
    && new Date(observed + 9 * 3_600_000).toISOString().slice(0, 10) === new Date(current + 9 * 3_600_000).toISOString().slice(0, 10);
}

/** Pure transition. The collector commits raw + state; the writer never invokes this. */
export function updateUsageState({ state = {}, candidates = [], otherItems = [], rawIssues = [], now = new Date() } = {}) {
  const current = asIso(now);
  if (!current) throw new Error('Invalid usage observation time');
  const pending = {}, seen = {};
  const retention = timestamp(current) - usageRules.state_retention_days * DAY;
  // Only source-confirmed, same-host canonicals with publication evidence join URLs.
  // Build the identity relation before checking seen so both directions work.
  const parents = new Map();
  function identity(url) {
    const next = parents.get(url);
    if (!next || next === url) return url;
    const root = identity(next); parents.set(url, root); return root;
  }
  const identityRecords = [
    ...Object.entries(state.pending ?? {}).map(([url, entry]) => ({ ...entry, url })),
    ...Object.entries(state.seen ?? {}).map(([url, entry]) => ({ ...entry, url })),
    ...rawIssues.flatMap(raw => (raw.selected ?? []).map(id => raw.items?.[id]).filter(Boolean)),
    ...otherItems, ...candidates,
  ];
  for (const record of identityRecords) {
    const canonical = normalizeUsageUrl(record.url);
    for (const alias of verifiedAliases(record)) {
      const aliasRoot = identity(alias), canonicalRoot = identity(canonical);
      if (aliasRoot !== canonicalRoot) parents.set(aliasRoot, canonicalRoot);
    }
  }
  const aliasesByUrl = new Map();
  for (const alias of parents.keys()) {
    const canonical = identity(alias);
    const members = aliasesByUrl.get(canonical) ?? new Set();
    if (alias !== canonical) members.add(alias);
    aliasesByUrl.set(canonical, members);
  }
  const canonicalPublication = new Map();
  for (const record of identityRecords) if (verifiedAliases(record).length) canonicalPublication.set(identity(normalizeUsageUrl(record.url)), record.publishedAt);
  function withIdentity(record) {
    const url = identity(normalizeUsageUrl(record.url));
    const aliases = [...(aliasesByUrl.get(url) ?? [])].sort(compareText);
    return { ...record, url, ...(aliases.length ? { canonicalUrl: url, aliases } : {}) };
  }
  for (const [key, entry] of Object.entries(state.seen ?? {})) {
    const url = identity(normalizeUsageUrl(key));
    if (url && timestamp(entry.selectedAt) >= retention) {
      seen[url] = withIdentity({ ...entry, url: key });
      if (!usagePublicationBounds(seen[url].publishedAt) && canonicalPublication.has(url)) seen[url].publishedAt = canonicalPublication.get(url);
    }
  }
  function recordSeen(item, selectedAt) {
    const url = identity(normalizeUsageUrl(item?.url));
    if (!url || timestamp(selectedAt) < retention || timestamp(selectedAt) > timestamp(current)) return;
    if (!seen[url] || timestamp(selectedAt) < timestamp(seen[url].selectedAt)) {
      seen[url] = { selectedAt, selectedSection: item.kind ?? 'existing', publishedAt: item.publishedAt ?? item.published ?? '', ruleVersion: usageRules.ruleVersion };
      if (!usagePublicationBounds(seen[url].publishedAt) && canonicalPublication.has(url)) seen[url].publishedAt = canonicalPublication.get(url);
      const aliases = aliasesByUrl.get(url);
      if (aliases?.size) { seen[url].canonicalUrl = url; seen[url].aliases = [...aliases]; }
    }
  }
  for (const raw of rawIssues) {
    const selectedAt = asIso(raw.generatedAt) || asIso(raw.date);
    if (selectedAt) for (const id of raw.selected ?? []) recordSeen(raw.items?.[id], selectedAt);
  }
  for (const item of otherItems) recordSeen(item, current);
  for (const [key, prior] of Object.entries(state.pending ?? {})) {
    const url = identity(normalizeUsageUrl(key));
    const bounds = usagePublicationBounds(prior.publishedAt);
    if (url && !seen[url] && bounds && timestamp(current) - bounds.earliest <= usageRules.window_days * DAY
      && timestamp(prior.firstSeenAt ?? prior.lastObservedAt) >= retention) pending[url] = withIdentity(prior);
  }
  const observations = new Map();
  for (const original of candidates) {
    const candidate = withIdentity(original);
    const url = candidate.url;
    if (!url || seen[url]) continue;
    const prior = observations.get(url) ?? pending[url] ?? {};
    const merged = { ...prior, ...Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined)), url };
    // An observation must not inherit yesterday's reaction counts when today's fetch failed.
    merged.metrics = { ...(candidate.metrics ?? {}) };
    merged.hnSignals = candidate.hnSignals ?? [];
    if (observations.has(url)) {
      merged.metrics = { ...prior.metrics, ...merged.metrics };
      merged.hnSignals = [...(prior.hnSignals ?? []), ...merged.hnSignals];
      merged.tags = [...new Set([...(prior.tags ?? []), ...(candidate.tags ?? [])])];
      if ((!candidate.body || candidate.bodyAvailable === false) && prior.body && prior.bodyAvailable !== false) {
        merged.body = prior.body;
        merged.bodyAvailable = true;
      }
      if (!usagePublicationBounds(candidate.publishedAt) && usagePublicationBounds(prior.publishedAt)) merged.publishedAt = prior.publishedAt;
      if (['zenn', 'qiita', 'simon'].includes(prior.source) && !['zenn', 'qiita', 'simon'].includes(candidate.source)) merged.source = prior.source;
    }
    if (!candidate.body && !observations.has(url)
      && ((candidate.title && candidate.title !== prior.title) || (candidate.tags && JSON.stringify(candidate.tags) !== JSON.stringify(prior.tags)))) {
      // Title/tags participate in the features, so a changed record needs fresh body evidence.
      delete merged.features;
      merged.bodyAvailable = false;
    }
    if (prior.ruleVersion && prior.ruleVersion !== usageRules.ruleVersion && !candidate.body) { delete merged.features; merged.bodyAvailable = false; }
    observations.set(url, merged);
  }
  const eligible = [];
  for (const [url, candidate] of observations) {
    const bounds = usagePublicationBounds(candidate.publishedAt);
    if (!bounds || timestamp(current) - bounds.earliest > usageRules.window_days * DAY) { delete pending[url]; continue; }
    const entry = compactCandidate(candidate, pending[url], current);
    pending[url] = entry;
    const quality = observedToday(candidate, current) ? qualifyUsage(candidate, current) : null;
    if (!quality) continue;
    entry.firstQualifiedAt ||= current;
    eligible.push({ ...candidate, ...quality, firstQualifiedAt: entry.firstQualifiedAt });
  }
  const chosen = assembleUsage(eligible);
  const items = chosen.map(candidate => toRawUsageItem(candidate, current));
  for (const candidate of chosen) {
    const url = normalizeUsageUrl(candidate.url);
    seen[url] = { ...pending[url], selectedAt: current, selectedSection: 'usage' };
    // Seen needs identity/times, not cached excerpts or body features.
    for (const key of ['features', 'excerpt', 'metrics', 'hnSignals', 'bodyAvailable', 'tags']) delete seen[url][key];
    delete pending[url];
  }
  return { state: { ruleVersion: usageRules.ruleVersion, updatedAt: current, pending, seen }, items };
}
