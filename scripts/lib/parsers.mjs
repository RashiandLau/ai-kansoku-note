// Intentionally small parsers for the fixed upstream formats; no runtime dependencies.
const AI_WORDS = /\b(?:AI|LLM|GPT|Claude|Anthropic|OpenAI|Gemini|Codex|Copilot|agents?|agentic|model|Llama|Qwen|DeepSeek|Mistral|inference|neural|transformer|diffusion|MCP|ML|machine learning|chatbot)\b/i;
const HOUR = 60 * 60 * 1000;

export function isAiTitle(title) {
  return AI_WORDS.test(String(title ?? ''));
}

export function httpUrl(value, base) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return '';
  try {
    const url = base ? new URL(value.trim(), base) : new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value ?? '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()];
    const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '\ufffd';
  });
}

function text(value) {
  return decodeEntities(String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4]);
  }
  return result;
}

function tagContent(block, name) {
  return block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, 'i'))?.[1] ?? '';
}

function iso(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

export function inWindow(published, now, hours = 36) {
  const age = new Date(now).getTime() - Date.parse(published);
  return Number.isFinite(age) && age >= 0 && age <= hours * HOUR;
}

export function compareVersions(a, b) {
  const first = String(a).split('.').map(Number);
  const second = String(b).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (first[index] || 0) - (second[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

export function parseClaudeChangelog(markdown) {
  const sections = [...String(markdown).matchAll(/^##\s+(?:v)?(\d+\.\d+\.\d+)\s*\r?$/gm)];
  if (!sections.length) throw new Error('No valid Claude Code version sections');
  return sections.map((match, index) => ({
    version: match[1],
    sectionText: markdown.slice(match.index + match[0].length, sections[index + 1]?.index ?? markdown.length).trim().slice(0, 3000),
  })).sort((a, b) => compareVersions(b.version, a.version));
}

export function parseCodexReleases(input) {
  const releases = typeof input === 'string' ? JSON.parse(input) : input;
  if (!Array.isArray(releases)) throw new Error('Expected a Codex releases array');
  return releases.filter((release) => release && !release.draft && !release.prerelease && !/(?:alpha|beta|rc)/i.test(release.tag_name ?? ''))
    .flatMap((release) => {
      const version = /^(?:rust-v)?(\d+\.\d+\.\d+)$/.exec(release.tag_name ?? '')?.[1];
      const url = httpUrl(release.html_url);
      const published = iso(release.published_at);
      return version && url && published ? [{ version, title: `Codex ${version}`, url, published, body: String(release.body ?? '').slice(0, 3000) }] : [];
    }).sort((a, b) => compareVersions(b.version, a.version));
}

export function parseHN(input, now) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  if (!data || !Array.isArray(data.hits)) throw new Error('Expected Hacker News hits');
  return data.hits.flatMap((hit) => {
    if (!hit || !isAiTitle(hit.title)) return [];
    const published = iso(hit.created_at ?? (Number.isFinite(hit.created_at_i) ? hit.created_at_i * 1000 : ''));
    if (!inWindow(published, now)) return [];
    const objectID = String(hit.objectID ?? '');
    if (!objectID) return [];
    const discussionUrl = `https://news.ycombinator.com/item?id=${encodeURIComponent(objectID)}`;
    const url = hit.url ? httpUrl(hit.url) : discussionUrl;
    if (!url) return [];
    const points = Math.max(0, Number(hit.points) || 0);
    const num_comments = Math.max(0, Number(hit.num_comments) || 0);
    return [{ title: text(hit.title), url, published, objectID, points, num_comments,
      metrics: { points, num_comments }, discussion: { url: discussionUrl, count: num_comments, points } }];
  }).sort((a, b) => b.points - a.points || Date.parse(b.published) - Date.parse(a.published));
}

export function parseRss(xml, base) {
  if (typeof xml !== 'string' || !/<(?:rss|feed|rdf:RDF)\b/i.test(xml) || !/<\/(?:rss|feed|rdf:RDF)\s*>/i.test(xml)) throw new Error('Invalid or incomplete RSS/Atom feed');
  const entries = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)];
  const openings = [...xml.matchAll(/<(?:item|entry)\b/gi)];
  if (entries.length !== openings.length) throw new Error('Incomplete feed entries');
  const parsed = entries.flatMap(([, , block]) => {
    const title = text(tagContent(block, 'title'));
    let link = text(tagContent(block, 'link'));
    if (!link) {
      const links = [...block.matchAll(/<link\b[^>]*>/gi)].map((match) => attributes(match[0]));
      link = links.find((entry) => !entry.rel || entry.rel === 'alternate')?.href ?? '';
    }
    const url = httpUrl(link, base);
    const published = iso(text(tagContent(block, 'pubDate') || tagContent(block, 'published') || tagContent(block, 'updated') || tagContent(block, 'dc:date')));
    const description = text(tagContent(block, 'description') || tagContent(block, 'summary') || tagContent(block, 'content:encoded')).slice(0, 3000);
    return title && url && published ? [{ title, url, published, description }] : [];
  });
  if (entries.length && !parsed.length) throw new Error('Feed contains no valid entries');
  return parsed;
}

export function parseTrending(html) {
  const rows = [...String(html).matchAll(/<article\b[^>]*class\s*=\s*["'][^"']*\bBox-row\b[^"']*["'][^>]*>([\s\S]*?)<\/article\s*>/gi)];
  if (!rows.length) throw new Error('No GitHub Trending repository rows');
  return rows.flatMap(([, row]) => {
    const heading = tagContent(row, 'h2');
    const anchor = heading.match(/<a\b[^>]*>/i)?.[0] ?? '';
    const href = attributes(anchor).href ?? '';
    if (!/^\/[\w.-]+\/[\w.-]+\/?$/.test(href)) return [];
    const title = href.replace(/^\/|\/$/g, '');
    const description = text(tagContent(row, 'p'));
    if (!isAiTitle(`${title} ${description}`) && !/(?:^|[^a-z0-9])(?:agent|rag|mcp|llm|ai)(?:$|[^a-z0-9])/i.test(`${title} ${description}`)) return [];
    const languageTag = row.match(/<span\b[^>]*itemprop\s*=\s*["']programmingLanguage["'][^>]*>([\s\S]*?)<\/span>/i);
    const starLink = [...row.matchAll(/<a\b[^>]*href\s*=\s*["'][^"']*\/stargazers["'][^>]*>([\s\S]*?)<\/a>/gi)][0];
    const stars = Number(text(starLink?.[1]).replace(/,/g, '')) || 0;
    const starsToday = Number(text(row).match(/([\d,]+)\s+stars?\s+today/i)?.[1]?.replace(/,/g, '')) || 0;
    const language = text(languageTag?.[1]);
    return [{ title, url: `https://github.com/${title}`, description, language, metrics: { stars, starsToday, language } }];
  }).sort((a, b) => b.metrics.starsToday - a.metrics.starsToday);
}

export function parseHfModels(input, now) {
  const models = typeof input === 'string' ? JSON.parse(input) : input;
  if (!Array.isArray(models)) throw new Error('Expected Hugging Face models array');
  return models.filter((model) => model && typeof model.id === 'string' && /^[\w.-]+\/[\w.-]+$/.test(model.id) && inWindow(model.createdAt, now, 14 * 24))
    .slice(0, 3).map((model) => ({ id: model.id, pipeline_tag: String(model.pipeline_tag ?? ''), likes: Number(model.likes) || 0,
      downloads: Number(model.downloads) || 0, createdAt: iso(model.createdAt), url: `https://huggingface.co/${model.id}` }));
}

export function parsePageMetadata(html, pageUrl) {
  const meta = {};
  for (const match of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const values = attributes(match[0]);
    const name = (values.property ?? values.name ?? '').toLowerCase();
    if (!(name in meta)) meta[name] = values.content ?? '';
  }
  const scope = tagContent(html, 'article') || tagContent(html, 'main') || tagContent(html, 'body') || html;
  const body = scope.replace(/<(script|style|noscript|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi)].map((match) => text(match[1])).filter(Boolean);
  const substantial = paragraphs.filter((paragraph) => paragraph.length >= 30);
  return { image: httpUrl(meta['og:image'] ?? meta['twitter:image'] ?? '', pageUrl),
    ogTitle: text(meta['og:title'] ?? ''), ogDescription: text(meta['og:description'] ?? meta.description ?? ''),
    excerpt: (paragraphs.length ? (substantial.length ? substantial : paragraphs).join(' ') : text(body)).slice(0, 1500) };
}
