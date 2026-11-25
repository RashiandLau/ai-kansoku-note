import { readFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { isDate, isMain, todayJst, parseArgs } from './lib/core.mjs';

export const CATEGORIES = Object.freeze(['claude-code', 'codex', 'models', 'tools', 'oss', 'japan', 'industry']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const emoji = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3\ufe0f]/u;
const normalizeWhitespace = value => value.replace(/\s+/gu, ' ').trim();

/** Returns bilingual diagnostics; an empty array means valid. Never mutates inputs. */
export function validateData(raw, data, expectedDate = raw?.date, { language = 'ja', japaneseData } = {}) {
  const errors = [];
  const english = language === 'en';
  const fail = (jp, en) => errors.push(`${jp} / ${en}`);
  if (!object(raw) || !Array.isArray(raw.selected) || !object(raw.items)) {
    fail('rawの形式が不正です', 'Invalid raw structure'); return errors;
  }
  if (!isDate(expectedDate) || raw.date !== expectedDate) fail('rawの日付が一致しません', 'Invalid or mismatched raw date');
  if (!object(data)) { fail('dataはJSONオブジェクトが必要です', 'Data must be a JSON object'); return errors; }
  const allowedKeys = (value, keys, label) => {
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) fail(`${label}に未知の項目があります: ${key}`, `Unknown field ${label}.${key}; text only`);
    }
  };
  allowedKeys(data, ['date', 'articles', 'ranking'], 'data');
  if (!isDate(data.date) || data.date !== expectedDate) fail('dataの日付が一致しません', 'Invalid or mismatched data date');
  const selected = new Set();
  for (const id of raw.selected) {
    if (typeof id !== 'string' || !Object.hasOwn(raw.items, id) || !object(raw.items[id])) {
      fail(`rawに記事がありません: ${String(id)}`, `Missing raw item: ${String(id)}`); continue;
    }
    if (selected.has(id)) fail(`rawのIDが重複しています: ${id}`, `Duplicate raw ID: ${id}`);
    selected.add(id);
  }
  const text = (value, min, max, label) => {
    if (typeof value !== 'string') { fail(`${label}は文字列が必要です`, `${label} must be a string`); return; }
    const length = Array.from(value).length;
    if (length < min || length > max || (min > 0 && !value.trim())) fail(`${label}は${min}〜${max}文字です`, `${label} must be ${min}-${max} characters`);
    if (/http/i.test(value)) fail(`${label}にURLは書けません`, `URL forbidden in ${label}`);
    if (english && /\b(?:[a-z][a-z\d+.-]*:\/\/|www\.)/i.test(value)) fail(`${label}にURLは書けません`, `URL forbidden in ${label}`);
    if (/──|—/.test(value)) fail(`${label}に禁止ダッシュがあります`, `Forbidden dash in ${label}`);
    if (value.includes('**')) fail(`${label}に強調記号は書けません`, `Markdown emphasis forbidden in ${label}`);
    if (emoji.test(value)) fail(`${label}に絵文字は書けません`, `Emoji forbidden in ${label}`);
    if (/<\/?[a-z][^>]*>|<!--[^]*?-->/i.test(value)) fail(`${label}にHTMLタグは書けません`, `HTML tags forbidden in ${label}`);
    if (english && /\b(?:revolutionary|game[- ]changer|groundbreaking|seamless|delve|unleash|cutting[- ]edge)\b/i.test(value)) fail(`${label}に誇張表現があります`, `Hype word forbidden in ${label}`);
  };
  const summary = (value, label, ranking = false) => {
    text(value, english ? 80 : ranking ? 20 : 30, english ? 600 : ranking ? 200 : 260, label);
    if (english && typeof value === 'string') {
      const sentences = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(value.trim())];
      if (sentences.length < 2 || sentences.length > 3) fail(`${label}は2〜3文で書いてください`, `${label} must contain 2-3 sentences`);
    }
  };
  for (const group of ['articles', 'ranking']) {
    const entries = data[group];
    if (!Array.isArray(entries)) { fail(`${group}は配列が必要です`, `${group} must be an array`); continue; }
    const counts = new Map();
    for (const [index, entry] of entries.entries()) {
      const label = `${group}[${index}]`;
      if (!object(entry)) { fail(`${label}はオブジェクトが必要です`, `${label} must be an object`); continue; }
      allowedKeys(entry, group === 'articles' ? ['id', 'category', 'headline', 'summary', 'impact'] : ['id', 'summary'], label);
      const { id } = entry;
      const item = typeof id === 'string' && selected.has(id) ? raw.items[id] : null;
      if (!item) fail(`${label}に未知のIDがあります: ${String(id)}`, `Unknown ID in ${label}: ${String(id)}`);
      else if ((item.kind === 'trending') !== (group === 'ranking')) fail(`${id}の掲載先が違います`, `Wrong collection for ${id}`);
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (group === 'articles') {
        if (!CATEGORIES.includes(entry.category)) fail(`${label}のカテゴリが不正です`, `Invalid category in ${label}`);
        if (item?.kind === 'claudecode' && entry.category !== 'claude-code') fail(`${id}はclaude-codeです`, `Claude Code category required for ${id}`);
        if (item?.kind === 'codex' && entry.category !== 'codex') fail(`${id}はcodexです`, `Codex category required for ${id}`);
        text(entry.headline, english ? 30 : 8, english ? 110 : 70, `${label}.headline`);
        if (typeof entry.headline === 'string') {
          const releaseOnly = english
            ? /^.+?\s+v?\d[\w.\-]*(?:\s+(?:(?:is|was|has been|gets)\s+)?(?:now\s+)?(?:released|available|out|launched|published)|\s+release)(?:\s+(?:now|today))?[.!]?$/i.test(entry.headline)
              || /^.+?\s+(?:releases|launches|publishes)\s+(?:(?:version|v)\s*)?\d[\w.\-]*[.!]?$/i.test(entry.headline)
              || /^(?:Claude Code|Codex)\s+v?\d[\w.\-]*[.!]?$/i.test(entry.headline)
              || (entry.headline === item?.title && /^.+?\s+v?\d[\w.\-]*$/.test(entry.headline))
            : /^\S.*\d[\w.\-]*\s*を?リリース$/.test(entry.headline);
          if (releaseOnly) fail(`${label}.headlineはリリースの変更内容を書いてください`, `Release-only headline forbidden in ${label}.headline`);
          if (!english && item?.kind === 'japan') {
            if (typeof item.title !== 'string' || normalizeWhitespace(entry.headline) !== normalizeWhitespace(item.title)) {
              fail(`${label}.headlineは空白の違いを除きrawの原見出しと一致させてください`, `Japan headline must match raw title after whitespace normalization in ${label}.headline`);
            }
          } else if (entry.headline === item?.title) fail(`${label}.headlineはrawの原見出しから書き換えてください`, `Headline must differ from raw title in ${label}.headline`);
          if (/^(Show|Ask|Launch|Tell) HN\b/i.test(entry.headline)) fail(`${label}.headlineの先頭にHNの投稿区分は書けません`, `HN prefix forbidden in ${label}.headline`);
        }
        summary(entry.summary, `${label}.summary`);
        if (Object.hasOwn(entry, 'impact')) {
          if (!['claudecode', 'codex'].includes(item?.kind)) fail(`${id}にはimpactを書けません`, `Impact only allowed for Claude Code or Codex: ${id}`);
          text(entry.impact, 0, english ? 200 : 90, `${label}.impact`);
        }
      } else summary(entry.summary, `${label}.summary`, true);
    }
    for (const id of selected) {
      if ((raw.items[id].kind === 'trending') !== (group === 'ranking')) continue;
      if (counts.get(id) !== 1) fail(`${id}は${group}に1回必要です`, `${id} must occur exactly once in ${group} (found ${counts.get(id) ?? 0})`);
    }
  }
  if (english) {
    if (!object(japaneseData) || !Array.isArray(japaneseData.articles) || !Array.isArray(japaneseData.ranking)) {
      fail('英語版との照合用に日本語版が必要です', 'Japanese data required for English comparison');
    } else {
      for (const group of ['articles', 'ranking']) {
        const jaEntries = new Map(japaneseData[group].filter(object).map(entry => [entry.id, entry]));
        const enEntries = Array.isArray(data[group]) ? data[group] : [];
        if (enEntries.length !== japaneseData[group].length || enEntries.some(entry => !object(entry) || !jaEntries.has(entry.id))) fail('英語版と日本語版のIDが一致しません', `English and Japanese IDs must match in ${group}`);
        if (group === 'articles') for (const entry of enEntries) {
          if (object(entry) && jaEntries.get(entry.id)?.category !== entry.category) fail('英語版と日本語版のカテゴリが一致しません', `English and Japanese categories must match for ${entry.id}`);
        }
      }
    }
  }
  return errors;
}

/** Checks a literal newline-delimited git/gh path list, without trimming filenames. */
export function changedPaths(input) {
  return String(input).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}

export function validateChangedFiles(input) {
  const lines = changedPaths(input);
  if (lines.length === 1 && !lines[0]) return ['変更ファイルがありません / No changed files'];
  const errors = [];
  const dates = new Set();
  const paths = new Set(lines);
  if (lines.length !== 2) errors.push('変更はdataの2ファイルだけです / Exactly two data files must change');
  if (paths.size !== lines.length) errors.push('変更パスが重複しています / Duplicate changed path');
  for (const path of lines) {
    const match = /^data\/(\d{4}-\d{2}-\d{2})(?:\.en)?\.json$/.exec(path);
    const date = match?.[1];
    if (!date || !isDate(date)) errors.push(`変更できないパスです: ${path} / Disallowed changed path: ${path}`);
    else dates.add(date);
  }
  if (dates.size !== 1) errors.push('変更は同じ1日分だけです / Changes must refer to exactly one date');
  const [date] = dates;
  if (!paths.has(`data/${date}.json`) || !paths.has(`data/${date}.en.json`)) errors.push('日本語版と英語版が必要です / Both Japanese and English data files are required');
  return errors;
}

export async function requireRegularFile(root, path) {
  const segments = path.split('/');
  for (let index = 1; index <= segments.length; index++) {
    const stat = await lstat(join(root, ...segments.slice(0, index)));
    if (stat.isSymbolicLink() || (index === segments.length ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error(`Regular file and directory parents required: ${path}`);
    }
  }
}

export async function validateChangedFilesAtRoot(input, root = process.cwd()) {
  const errors = validateChangedFiles(input);
  if (errors.length) return errors;
  for (const path of changedPaths(input)) {
    try { await requireRegularFile(root, path); }
    catch (error) { errors.push(`通常ファイルが必要です: ${path} / ${error.message}`); }
  }
  return errors;
}

export async function validateFile(date = todayJst(), root = process.cwd(), { rawRoot = root } = {}) {
  if (!isDate(date)) return ['日付は実在するYYYY-MM-DDが必要です / Date must be a valid YYYY-MM-DD'];
  try {
    const [raw, data, englishData] = await Promise.all([
      join(rawRoot, 'raw', `${date}.json`), join(root, 'data', `${date}.json`), join(root, 'data', `${date}.en.json`),
    ].map(async path => JSON.parse(await readFile(path, 'utf8'))));
    return [...validateData(raw, data, date), ...validateData(raw, englishData, date, { language: 'en', japaneseData: data }).map(error => `en: ${error}`)];
  } catch (error) { return [`JSONを読めません: ${error.message} / Cannot read raw/data JSON`]; }
}

async function main() {
  const args = process.argv.slice(2);
  let errors;
  let date;
  if (args.includes('--changed-files')) {
    args.splice(args.indexOf('--changed-files'), 1);
    const options = parseArgs(args, ['root']);
    let input = ''; process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) input += chunk;
    errors = await validateChangedFilesAtRoot(input, resolve(options.root ?? '.'));
  } else {
    date = args[0] && !args[0].startsWith('--') ? args.shift() : todayJst();
    const options = parseArgs(args, ['root']);
    errors = await validateFile(date, resolve(options.root ?? '.'));
  }
  if (errors.length) { console.error(`検証失敗 / Validation failed:\n${errors.map(error => `- ${error}`).join('\n')}`); process.exitCode = 1; }
  else console.log(`検証成功 / Validation passed${date ? `: ${date}` : ' (changed files)'}`);
}

if (isMain(import.meta.url)) main().catch(error => {
  console.error(`検証失敗 / Validation failed: ${error.message}`); process.exitCode = 1;
});
