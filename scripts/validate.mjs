import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { isDate, isMain, todayJst, parseArgs } from './lib/core.mjs';

export const CATEGORIES = Object.freeze(['claude-code', 'codex', 'models', 'tools', 'oss', 'japan', 'industry']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const emoji = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3\ufe0f]/u;
const normalizeWhitespace = value => value.replace(/\s+/gu, ' ').trim();

/** Returns bilingual diagnostics; an empty array means valid. Never mutates inputs. */
export function validateData(raw, data, expectedDate = raw?.date) {
  const errors = [];
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
    if (/──|—/.test(value)) fail(`${label}に禁止ダッシュがあります`, `Forbidden dash in ${label}`);
    if (value.includes('**')) fail(`${label}に強調記号は書けません`, `Markdown emphasis forbidden in ${label}`);
    if (emoji.test(value)) fail(`${label}に絵文字は書けません`, `Emoji forbidden in ${label}`);
    if (/<\/?[a-z][^>]*>|<!--[^]*?-->/i.test(value)) fail(`${label}にHTMLタグは書けません`, `HTML tags forbidden in ${label}`);
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
        text(entry.headline, 8, 70, `${label}.headline`);
        if (typeof entry.headline === 'string') {
          if (/^\S.*\d[\w.\-]*\s*を?リリース$/.test(entry.headline)) fail(`${label}.headlineはリリースの変更内容を書いてください`, `Release-only headline forbidden in ${label}.headline`);
          if (item?.kind === 'japan') {
            if (typeof item.title !== 'string' || normalizeWhitespace(entry.headline) !== normalizeWhitespace(item.title)) {
              fail(`${label}.headlineは空白の違いを除きrawの原見出しと一致させてください`, `Japan headline must match raw title after whitespace normalization in ${label}.headline`);
            }
          } else if (entry.headline === item?.title) fail(`${label}.headlineはrawの原見出しから書き換えてください`, `Headline must differ from raw title in ${label}.headline`);
          if (/^(Show|Ask|Launch|Tell) HN\b/i.test(entry.headline)) fail(`${label}.headlineの先頭にHNの投稿区分は書けません`, `HN prefix forbidden in ${label}.headline`);
        }
        text(entry.summary, 30, 260, `${label}.summary`);
        if (Object.hasOwn(entry, 'impact')) {
          if (!['claudecode', 'codex'].includes(item?.kind)) fail(`${id}にはimpactを書けません`, `Impact only allowed for Claude Code or Codex: ${id}`);
          text(entry.impact, 0, 90, `${label}.impact`);
        }
      } else text(entry.summary, 20, 200, `${label}.summary`);
    }
    for (const id of selected) {
      if ((raw.items[id].kind === 'trending') !== (group === 'ranking')) continue;
      if (counts.get(id) !== 1) fail(`${id}は${group}に1回必要です`, `${id} must occur exactly once in ${group} (found ${counts.get(id) ?? 0})`);
    }
  }
  return errors;
}

/** Checks a literal newline-delimited git/gh path list, without trimming filenames. */
export function validateChangedFiles(input) {
  const lines = String(input).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  if (lines.length === 1 && !lines[0]) return ['変更ファイルがありません / No changed files'];
  return lines.filter(path => !/^data\/\d{4}-\d{2}-\d{2}\.json$/.test(path))
    .map(path => `変更できるのはdataの日付JSONだけです: ${path} / Disallowed changed path: ${path}`);
}

export async function validateFile(date = todayJst(), root = process.cwd()) {
  if (!isDate(date)) return ['日付は実在するYYYY-MM-DDが必要です / Date must be a valid YYYY-MM-DD'];
  try {
    const [raw, data] = await Promise.all(['raw', 'data'].map(async dir => JSON.parse(await readFile(join(root, dir, `${date}.json`), 'utf8'))));
    return validateData(raw, data, date);
  } catch (error) { return [`JSONを読めません: ${error.message} / Cannot read raw/data JSON`]; }
}

async function main() {
  const args = process.argv.slice(2);
  let errors;
  let date;
  if (args.includes('--changed-files')) {
    if (args.length !== 1) throw new Error('--changed-filesは標準入力を使います / --changed-files accepts stdin only');
    let input = ''; process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) input += chunk;
    errors = validateChangedFiles(input);
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
