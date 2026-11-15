import { stylesheet, tabScript } from './style.mjs';
import { escapeHtml as escape, safeUrl } from './core.mjs';

export const fallbackNotice = '要約の作成が間に合わなかったため、見出しのみ掲載しています';
export const iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="36" fill="#111"/><path d="M36 134 80 58h32l44 76h-30l-8-16H74l-8 16zm50-40h20L96 74z" fill="#fff"/><circle cx="151" cy="44" r="15" fill="#e3211b"/></svg>';
const categories = [
  ['top', '総合'], ['claude-code', 'Claude Code'], ['codex', 'Codex'],
  ['models', 'モデル'], ['tools', 'ツール'], ['oss', 'OSS'],
  ['japan', '国内'], ['ranking', '急上昇'], ['industry', '業界'],
];
const repository = 'https://github.com/RashiandLau/ai-kansoku-note';
const formatNumber = value => Number.isFinite(value) && value >= 0 ? value.toLocaleString('ja-JP') : null;

function linked(text, value, className = '') {
  const url = safeUrl(value);
  return url ? `<a${className ? ` class="${className}"` : ''} href="${escape(url)}">${escape(text)}</a>` : escape(text);
}

function jstParts(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return Object.fromEntries(new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(date).map(({ type, value: part }) => [type, part]));
}

function longDate(value) {
  const date = jstParts(`${value}T12:00:00+09:00`);
  return date ? `${date.year}年${date.month}月${date.day}日（${date.weekday}）` : '';
}

function sourceLinks(item) {
  const links = [];
  if (safeUrl(item.url)) links.push(linked('元投稿', item.url));
  if (safeUrl(item.discussion?.url)) {
    const count = formatNumber(item.discussion.count ?? item.metrics?.num_comments);
    links.push(linked(`議論 HN${count === null ? '' : ` ${count}件`}`, item.discussion.url, 'd'));
  }
  return links.length ? `<div class="links">${links.join('')}</div>` : '';
}

function image(item, top = false) {
  const imageUrl = safeUrl(item.image);
  const className = top ? 'pic' : 'th';
  return imageUrl
    ? `<img class="${className}" src="${escape(imageUrl)}" loading="lazy" referrerpolicy="no-referrer" alt="">`
    : `<span class="${className} nothumb">${escape(item.source || '記事画像')}</span>`;
}

function metadata(item, date) {
  const pieces = [`<span class="src">${escape(item.source || '')}</span>`];
  const published = jstParts(item.published);
  if (published) pieces.push(`<span>${published.month}月${published.day}日</span>`);
  if (item.version) pieces.push(`<span>${escape(item.version)}</span>`);
  const points = formatNumber(item.discussion?.points ?? item.metrics?.points);
  if (points !== null) pieces.push(`<span>HN ${points}ポイント</span>`);
  const starsToday = formatNumber(item.metrics?.starsToday);
  const rankingDay = jstParts(`${date}T12:00:00+09:00`);
  if (starsToday !== null) pieces.push(`<span class="star">${rankingDay ? `${rankingDay.day}日に` : ''}${starsToday}スター</span>`);
  if (item.metrics?.language) pieces.push(`<span>${escape(item.metrics.language)}</span>`);
  return `<div class="meta">${pieces.join('')}</div>`;
}

function fallbackHeadline(item) {
  const title = typeof item.title === 'string' ? item.title.replace(/^(Show|Ask|Launch|Tell) HN\s*[:：]\s*/i, '') : item.title;
  return title || item.id;
}

function article(item, copy, date, { top = false, rank = null } = {}) {
  const headline = copy?.headline || fallbackHeadline(item);
  const text = `${copy?.summary ? `<p>${escape(copy.summary)}</p>` : ''}${copy?.impact ? `<p class="impact">${escape(copy.impact)}</p>` : ''}`;
  const details = `${text}${metadata(item, date)}${sourceLinks(item)}`;
  if (top) return `<article class="top" id="top">${image(item, true)}<h2>${linked(headline, item.url)}</h2>${details}</article>`;
  return `<article class="item">${rank === null ? '' : `<span class="rk">${rank}</span>`}<div class="txt"><h3>${linked(headline, item.url)}</h3>${details}</div>${image(item)}</article>`;
}

function brief(item, copy, date) {
  return `<li><b>${linked(copy?.headline || fallbackHeadline(item), item.url)}</b>${copy?.summary ? `<span>${escape(copy.summary)}</span>` : ''}${copy?.impact ? `<p class="impact">${escape(copy.impact)}</p>` : ''}${metadata(item, date)}${sourceLinks(item)}</li>`;
}

function hfModels(models) {
  if (!models.length) return '';
  const list = models.map(model => {
    const title = model.id || model.modelId || model.name || '';
    const meta = [];
    const likes = formatNumber(model.likes);
    const downloads = formatNumber(model.downloads);
    if (likes !== null) meta.push(`<span>いいね ${likes}</span>`);
    if (downloads !== null) meta.push(`<span>ダウンロード ${downloads}</span>`);
    if (model.pipeline_tag) meta.push(`<span>${escape(model.pipeline_tag)}</span>`);
    const created = jstParts(model.createdAt);
    if (created) meta.push(`<span>${created.month}月${created.day}日公開</span>`);
    return `<li>${linked(title, model.url)}<div class="meta">${meta.join('')}</div>${sourceLinks(model)}</li>`;
  }).join('');
  return `<div class="hf"><h3>Hugging Face の新着モデル</h3><ul>${list}</ul></div>`;
}

function footer(generatedAt) {
  const generated = jstParts(generatedAt);
  const timestamp = generated ? `${generated.year}年${generated.month}月${generated.day}日 ${generated.hour}:${generated.minute} JST` : '取得日時不明';
  return `<footer><p>掲載ルール：Claude Codeは初回2件・以後は新バージョンを最大5件、Codexは初回1件・以後は安定版の新リリースを最大3件掲載します。直近36時間のAI関連記事から、Hacker Newsの最多ポイント記事をトップにし、残りは100ポイント以上を最大8件、OpenAI・Google・Hugging Faceの公式発表を最大6件、ITmedia AI+・@ITの国内記事を最大5件掲載します。GitHub急上昇は当日のスター数でAI関連上位5件、Hugging Faceは公開14日以内の注目モデル上位3件を掲載し、画像と数値は取得時点の情報を使います。</p><p>生成日時：${escape(timestamp)}　<a href="${repository}">GitHub</a> · <a href="archive.html">過去の記事</a></p></footer>`;
}

function shell({ date, title, content, tabs = [], generatedAt }) {
  const dateHtml = date ? `<time datetime="${escape(date)}">${escape(longDate(date))}</time>` : '';
  const nav = tabs.length ? `<nav class="tabs" aria-label="カテゴリ"><div class="wrap g">${categories.filter(([id]) => tabs.includes(id)).map(([id, label], i) => `<a href="#${id}"${i ? '' : ' class="on"'}>${label}</a>`).join('')}</div></nav>` : '';
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="AI観測ノート"><meta name="theme-color" content="#111111">
<title>${escape(title || 'AI観測ノート')}</title><link rel="manifest" href="manifest.webmanifest"><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${escape(encodeURIComponent(iconSvg))}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&amp;display=swap">
<style>${stylesheet}</style></head><body>
<header class="g"><div class="wrap logo"><h1><a href="index.html">AI<span>観測</span>ノート</a></h1><div class="date">${dateHtml}<a href="archive.html">過去の記事</a></div></div></header>
${nav}<main class="g"><div class="wrap">${content}${footer(generatedAt)}</div></main><script>${tabScript}</script></body></html>\n`;
}

const fallbackCategory = kind => ({ claudecode: 'claude-code', codex: 'codex', japan: 'japan', official: 'models', hn: 'industry' })[kind] || 'tools';

export function renderDay(raw, data) {
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
  let content = data ? '' : `<p class="notice">${fallbackNotice}</p>`;
  if (top) content += article(top, articleCopy.get(top.id) || rankingCopy.get(top.id), raw.date, { top: true });
  for (const [id, label] of categories) {
    if (id === 'ranking' && (rankings.length || models.length)) {
      content += `<section class="sec rank" id="ranking"><h2>${rankings.length ? 'GitHub急上昇（AI関連）' : '急上昇'}</h2>${rankings.map(({ item, rank }) => article(item, rankingCopy.get(item.id), raw.date, { rank })).join('')}${hfModels(models)}</section>`;
      continue;
    }
    if (!groups.has(id)) continue;
    const entries = groups.get(id);
    content += `<section class="sec" id="${id}"><h2>${label}</h2>${id === 'industry' ? `<ul class="brief">${entries.map(([item, copy]) => brief(item, copy, raw.date)).join('')}</ul>` : entries.map(([item, copy]) => article(item, copy, raw.date)).join('')}</section>`;
  }
  if (!items.length && !models.length) content += '<p class="empty">まだ記事がありません。</p>';
  return shell({ date: raw.date, title: `${longDate(raw.date)} | AI観測ノート`, content, tabs, generatedAt: raw.generatedAt });
}

export function renderArchive(dates, generatedAt) {
  const content = `<section class="sec"><h2>過去の記事</h2>${dates.length ? `<ul class="archive">${dates.map(date => `<li><a href="${escape(date)}.html">${escape(longDate(date))}</a></li>`).join('')}</ul>` : '<p class="empty">まだ記事がありません。</p>'}</section>`;
  return shell({ title: '過去の記事 | AI観測ノート', content, generatedAt });
}

export function renderEmpty(generatedAt) {
  return shell({ content: '<p class="empty">まだ記事がありません。</p>', generatedAt });
}
