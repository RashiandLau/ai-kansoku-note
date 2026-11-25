import { stylesheet, tabScript } from './style.mjs';
import { escapeHtml as escape, safeUrl } from './core.mjs';
import { pushSection, pushStyles, registrationScript } from './push.mjs';

export const fallbackNotice = '要約の作成が間に合わなかったため、見出しのみ掲載しています';
export const iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="36" fill="#111"/><path d="M36 134 80 58h32l44 76h-30l-8-16H74l-8 16zm50-40h20L96 74z" fill="#fff"/><circle cx="151" cy="44" r="15" fill="#e3211b"/></svg>';
const categories = [
  ['top', '総合'], ['claude-code', 'Claude Code'], ['codex', 'Codex'],
  ['models', 'モデル'], ['tools', 'ツール'], ['oss', 'OSS'],
  ['japan', '国内'], ['ranking', '急上昇'], ['industry', '業界'],
];
const englishCategories = new Map([
  ['top', 'Top'], ['claude-code', 'Claude Code'], ['codex', 'Codex'],
  ['models', 'Models'], ['tools', 'Tools'], ['oss', 'OSS'],
  ['japan', 'Japan'], ['ranking', 'Trending'], ['industry', 'Industry'],
]);
const editions = {
  ja: {
    lang: 'ja', locale: 'ja-JP', name: 'AI観測ノート', masthead: 'AI<span>観測</span>ノート',
    archive: '過去の記事', categories: 'カテゴリ', source: '元投稿', image: '記事画像',
    fallback: fallbackNotice, empty: 'まだ記事がありません。',
    models: 'Hugging Face の新着モデル', trending: '急上昇', githubTrending: 'GitHub急上昇（AI関連）',
    generated: '生成日時：', unknownDate: '取得日時不明',
    policy: '掲載ルール：Claude Codeは初回2件・以後は新バージョンを最大5件、Codexは初回1件・以後は安定版の新リリースを最大3件掲載します。直近36時間のAI関連記事から、Hacker Newsの最多ポイント記事をトップにし、残りは100ポイント以上を最大8件、OpenAI・Google・Hugging Faceの公式発表を最大6件、ITmedia AI+・@ITの国内記事を最大5件掲載します。GitHub急上昇は当日のスター数でAI関連上位5件、Hugging Faceは公開14日以内の注目モデル上位3件を掲載し、画像と数値は取得時点の情報を使います。',
  },
  en: {
    lang: 'en', locale: 'en-US', name: 'AI Kansoku Note', masthead: 'AI <span>Kansoku</span> Note',
    archive: 'Archive', categories: 'Categories', source: 'Source', image: 'Article image',
    fallback: 'Summaries are not ready yet. Only source headlines are shown.', empty: 'No articles yet.',
    models: 'New models on Hugging Face', trending: 'Trending', githubTrending: 'GitHub trending (AI)',
    generated: 'Generated: ', unknownDate: 'Collection time unknown',
    policy: 'Selection: Claude Code starts with two releases, then up to five new versions; Codex starts with one release, then up to three new stable releases. From AI news in the past 36 hours, the Hacker News story with the most points leads, followed by up to eight other stories with at least 100 points, six official announcements from OpenAI, Google and Hugging Face, and five Japanese stories from ITmedia AI+ and @IT. GitHub trending includes the top five AI repositories by stars gained that day. Hugging Face includes three trending models published within 14 days. Images and counts reflect collection time.',
  },
};
const edition = language => editions[language] || editions.ja;
const categoryList = ui => categories.map(([id, label]) => [id, ui.lang === 'en' ? englishCategories.get(id) : label]);
const repository = 'https://github.com/RashiandLau/ai-kansoku-note';
const formatNumber = (value, ui) => Number.isFinite(value) && value >= 0 ? value.toLocaleString(ui.locale) : null;

function linked(text, value, className = '') {
  const url = safeUrl(value);
  return url ? `<a${className ? ` class="${className}"` : ''} href="${escape(url)}">${escape(text)}</a>` : escape(text);
}

function jstParts(value, ui = editions.ja) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return Object.fromEntries(new Intl.DateTimeFormat(ui.locale, {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: ui.lang === 'en' ? 'long' : 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(date).map(({ type, value: part }) => [type, part]));
}

function longDate(value, ui = editions.ja) {
  const date = jstParts(`${value}T12:00:00+09:00`, ui);
  return date ? ui.lang === 'en' ? `${date.weekday}, ${date.month} ${date.day}, ${date.year}` : `${date.year}年${date.month}月${date.day}日（${date.weekday}）` : '';
}

function sourceLinks(item, ui) {
  const links = [];
  if (safeUrl(item.url)) links.push(linked(ui.source, item.url));
  if (safeUrl(item.discussion?.url)) {
    const count = formatNumber(item.discussion.count ?? item.metrics?.num_comments, ui);
    const label = ui.lang === 'en' ? `HN discussion${count === null ? '' : ` (${count})`}` : `議論 HN${count === null ? '' : ` ${count}件`}`;
    links.push(linked(label, item.discussion.url, 'd'));
  }
  return links.length ? `<div class="links">${links.join('')}</div>` : '';
}

function image(item, ui, top = false) {
  const imageUrl = safeUrl(item.image);
  const className = top ? 'pic' : 'th';
  return imageUrl
    ? `<img class="${className}" src="${escape(imageUrl)}" loading="lazy" referrerpolicy="no-referrer" alt="">`
    : `<span class="${className} nothumb">${escape(item.source || ui.image)}</span>`;
}

function metadata(item, date, ui) {
  const pieces = [`<span class="src">${escape(item.source || '')}</span>`];
  const published = jstParts(item.published, ui);
  if (published) pieces.push(`<span>${ui.lang === 'en' ? `${published.month} ${published.day}` : `${published.month}月${published.day}日`}</span>`);
  if (item.version) pieces.push(`<span>${escape(item.version)}</span>`);
  const points = formatNumber(item.discussion?.points ?? item.metrics?.points, ui);
  if (points !== null) pieces.push(`<span>HN ${points}${ui.lang === 'en' ? ' points' : 'ポイント'}</span>`);
  const starsToday = formatNumber(item.metrics?.starsToday, ui);
  const rankingDay = jstParts(`${date}T12:00:00+09:00`, ui);
  if (starsToday !== null) pieces.push(`<span class="star">${ui.lang === 'en' ? `${starsToday} stars${rankingDay ? ` on ${rankingDay.month} ${rankingDay.day}` : ''}` : `${rankingDay ? `${rankingDay.day}日に` : ''}${starsToday}スター`}</span>`);
  if (item.metrics?.language) pieces.push(`<span>${escape(item.metrics.language)}</span>`);
  return `<div class="meta">${pieces.join('')}</div>`;
}

function fallbackHeadline(item) {
  const title = typeof item.title === 'string' ? item.title.replace(/^(Show|Ask|Launch|Tell) HN\s*[:：]\s*/i, '') : item.title;
  return title || item.id;
}

function article(item, copy, date, ui, { top = false, rank = null } = {}) {
  const headline = copy?.headline || fallbackHeadline(item);
  const text = `${copy?.summary ? `<p>${escape(copy.summary)}</p>` : ''}${copy?.impact ? `<p class="impact">${escape(copy.impact)}</p>` : ''}`;
  const details = `${text}${metadata(item, date, ui)}${sourceLinks(item, ui)}`;
  if (top) return `<article class="top" id="top">${image(item, ui, true)}<h2>${linked(headline, item.url)}</h2>${details}</article>`;
  return `<article class="item">${rank === null ? '' : `<span class="rk">${rank}</span>`}<div class="txt"><h3>${linked(headline, item.url)}</h3>${details}</div>${image(item, ui)}</article>`;
}

function brief(item, copy, date, ui) {
  return `<li><b>${linked(copy?.headline || fallbackHeadline(item), item.url)}</b>${copy?.summary ? `<span>${escape(copy.summary)}</span>` : ''}${copy?.impact ? `<p class="impact">${escape(copy.impact)}</p>` : ''}${metadata(item, date, ui)}${sourceLinks(item, ui)}</li>`;
}

function hfModels(models, ui) {
  if (!models.length) return '';
  const list = models.map(model => {
    const title = model.id || model.modelId || model.name || '';
    const meta = [];
    const likes = formatNumber(model.likes, ui);
    const downloads = formatNumber(model.downloads, ui);
    if (likes !== null) meta.push(`<span>${ui.lang === 'en' ? 'Likes' : 'いいね'} ${likes}</span>`);
    if (downloads !== null) meta.push(`<span>${ui.lang === 'en' ? 'Downloads' : 'ダウンロード'} ${downloads}</span>`);
    if (model.pipeline_tag) meta.push(`<span>${escape(model.pipeline_tag)}</span>`);
    const created = jstParts(model.createdAt, ui);
    if (created) meta.push(`<span>${ui.lang === 'en' ? `Published ${created.month} ${created.day}` : `${created.month}月${created.day}日公開`}</span>`);
    return `<li>${linked(title, model.url)}<div class="meta">${meta.join('')}</div>${sourceLinks(model, ui)}</li>`;
  }).join('');
  return `<div class="hf"><h3>${ui.models}</h3><ul>${list}</ul></div>`;
}

function footer(generatedAt, ui) {
  const generated = jstParts(generatedAt, ui);
  const timestamp = generated ? `${ui.lang === 'en' ? `${generated.month} ${generated.day}, ${generated.year}` : `${generated.year}年${generated.month}月${generated.day}日`} ${generated.hour}:${generated.minute} JST` : ui.unknownDate;
  return `<footer>${ui.lang === 'ja' ? pushSection : ''}<p>${ui.policy}</p><p>${ui.generated}${escape(timestamp)}　<a href="${repository}">GitHub</a> · <a href="archive.html">${ui.archive}</a></p></footer>`;
}

function shell({ date, title, content, tabs = [], generatedAt, ui, pageName = 'index.html' }) {
  const dateHtml = date ? `<time datetime="${escape(date)}">${escape(longDate(date, ui))}</time>` : '';
  const nav = tabs.length ? `<nav class="tabs" aria-label="${ui.categories}"><div class="wrap g">${categoryList(ui).filter(([id]) => tabs.includes(id)).map(([id, label], i) => `<a href="#${id}"${i ? '' : ' class="on"'}>${label}</a>`).join('')}</div></nav>` : '';
  const alternate = `${ui.lang === 'en' ? '../' : 'en/'}${date ? `${date}.html` : pageName}`;
  const languageLink = `<a class="language" href="${escape(alternate)}" lang="${ui.lang === 'en' ? 'ja' : 'en'}" hreflang="${ui.lang === 'en' ? 'ja' : 'en'}">${ui.lang === 'en' ? '日本語' : 'English'}</a>`;
  return `<!doctype html>
<html lang="${ui.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="${ui.name}"><meta name="theme-color" content="#111111">
<title>${escape(title || ui.name)}</title><link rel="manifest" href="${ui.lang === 'en' ? '../' : ''}manifest.webmanifest"><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${escape(encodeURIComponent(iconSvg))}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&amp;display=swap">
<style>${stylesheet}${ui.lang === 'ja' ? pushStyles : ''}</style></head><body>
<header class="g"><div class="wrap logo"><h1><a href="index.html">${ui.masthead}</a></h1><div class="date">${dateHtml}<a href="archive.html">${ui.archive}</a>${languageLink}</div></div></header>
${nav}<main class="g"><div class="wrap">${content}${footer(generatedAt, ui)}</div></main><script>${tabScript}</script><script>${registrationScript}</script></body></html>\n`;
}

const fallbackCategory = kind => ({ claudecode: 'claude-code', codex: 'codex', japan: 'japan', official: 'models', hn: 'industry' })[kind] || 'tools';

export function renderDay(raw, data, { language = 'ja' } = {}) {
  const ui = edition(language);
  const items = (Array.isArray(raw.selected) ? raw.selected : []).map(id => raw.items?.[id]).filter(item => item && typeof item === 'object');
  const itemMap = new Map(items.map(item => [item.id, item]));
  const articleCopy = new Map((data?.articles || []).map(copy => [copy.id, copy]));
  const rankingCopy = new Map((data?.ranking || []).map(copy => [copy.id, copy]));
  const top = itemMap.get(raw.top);
  const groups = new Map();
  for (const item of items) {
    if (item.id === top?.id || item.kind === 'trending') continue;
    const copy = articleCopy.get(item.id);
    const category = copy?.category || fallbackCategory(item.kind);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push([item, copy]);
  }
  const rankings = items.filter(item => item.kind === 'trending').map((item, index) => ({ item, rank: index + 1 })).filter(({ item }) => item.id !== top?.id);
  const models = Array.isArray(raw.hfmodels) ? raw.hfmodels.filter(model => model && typeof model === 'object') : [];
  const tabs = [...groups.keys(), ...(top ? ['top'] : []), ...(rankings.length || models.length ? ['ranking'] : [])];
  let content = data ? '' : `<p class="notice">${ui.fallback}</p>`;
  if (top) content += article(top, articleCopy.get(top.id) || rankingCopy.get(top.id), raw.date, ui, { top: true });
  for (const [id, label] of categoryList(ui)) {
    if (id === 'ranking' && (rankings.length || models.length)) {
      content += `<section class="sec rank" id="ranking"><h2>${rankings.length ? ui.githubTrending : ui.trending}</h2>${rankings.map(({ item, rank }) => article(item, rankingCopy.get(item.id), raw.date, ui, { rank })).join('')}${hfModels(models, ui)}</section>`;
      continue;
    }
    if (!groups.has(id)) continue;
    const entries = groups.get(id);
    content += `<section class="sec" id="${id}"><h2>${label}</h2>${id === 'industry' ? `<ul class="brief">${entries.map(([item, copy]) => brief(item, copy, raw.date, ui)).join('')}</ul>` : entries.map(([item, copy]) => article(item, copy, raw.date, ui)).join('')}</section>`;
  }
  if (!items.length && !models.length) content += `<p class="empty">${ui.empty}</p>`;
  return shell({ date: raw.date, title: `${longDate(raw.date, ui)} | ${ui.name}`, content, tabs, generatedAt: raw.generatedAt, ui });
}

export function renderArchive(dates, generatedAt, { language = 'ja' } = {}) {
  const ui = edition(language);
  const content = `<section class="sec"><h2>${ui.archive}</h2>${dates.length ? `<ul class="archive">${dates.map(date => `<li><a href="${escape(date)}.html">${escape(longDate(date, ui))}</a></li>`).join('')}</ul>` : `<p class="empty">${ui.empty}</p>`}</section>`;
  return shell({ title: `${ui.archive} | ${ui.name}`, content, generatedAt, ui, pageName: 'archive.html' });
}

export function renderEmpty(generatedAt, { language = 'ja' } = {}) {
  const ui = edition(language);
  return shell({ content: `<p class="empty">${ui.empty}</p>`, generatedAt, ui });
}
