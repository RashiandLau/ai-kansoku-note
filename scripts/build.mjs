import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateData } from './validate.mjs';
import { iconSvg, renderArchive, renderDay, renderEmpty } from './lib/render.mjs';
import { isMain, parseArgs } from './lib/core.mjs';
import { serviceWorkerSource } from './lib/push.mjs';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function buildSite({ root = process.cwd(), out = join(root, 'site') } = {}) {
  const rawDir = join(root, 'raw');
  let names;
  try { names = await readdir(rawDir); }
  catch (error) { if (error.code !== 'ENOENT') throw error; names = []; }
  const dates = names.filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).map(name => name.slice(0, -5)).sort().reverse();
  const warnings = [];
  const pages = [];
  for (const date of dates) {
    let raw;
    try {
      raw = await readJson(join(rawDir, `${date}.json`));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('raw must be an object');
    } catch (error) {
      warnings.push(`${date}: rawを読み込めません: ${error.message}`);
      raw = { date, items: {}, hfmodels: [] };
    }
    let data = null;
    try {
      const candidate = await readJson(join(root, 'data', `${date}.json`));
      const errors = validateData(raw, candidate, date);
      if (errors.length) warnings.push(`${date}: ${errors.join('; ')}`);
      else data = candidate;
    } catch (error) {
      warnings.push(`${date}: 要約を読み込めません: ${error.message}`);
    }
    let englishData = null;
    try {
      const candidate = await readJson(join(root, 'data', `${date}.en.json`));
      const errors = validateData(raw, candidate, date, { language: 'en', japaneseData: data });
      if (errors.length) warnings.push(`${date} (en): ${errors.join('; ')}`);
      else englishData = candidate;
    } catch (error) {
      warnings.push(`${date} (en): Cannot read summaries: ${error.message}`);
    }
    pages.push({ date, raw, html: renderDay({ ...raw, date }, data), englishHtml: renderDay({ ...raw, date }, englishData, { language: 'en' }) });
  }
  const englishOut = join(out, 'en');
  await mkdir(englishOut, { recursive: true });
  const generatedAt = pages[0]?.raw.generatedAt || new Date().toISOString();
  const manifest = { name: 'AI観測ノート', short_name: 'AI観測ノート', lang: 'ja', start_url: './index.html', scope: './', display: 'standalone', background_color: '#ffffff', theme_color: '#111111', icons: [{ src: './icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] };
  await Promise.all([
    ...pages.map(({ date, html }) => writeFile(join(out, `${date}.html`), html)),
    ...pages.map(({ date, englishHtml }) => writeFile(join(englishOut, `${date}.html`), englishHtml)),
    writeFile(join(out, 'index.html'), pages[0]?.html || renderEmpty(generatedAt)),
    writeFile(join(out, 'archive.html'), renderArchive(dates, generatedAt)),
    writeFile(join(englishOut, 'index.html'), pages[0]?.englishHtml || renderEmpty(generatedAt, { language: 'en' })),
    writeFile(join(englishOut, 'archive.html'), renderArchive(dates, generatedAt, { language: 'en' })),
    writeFile(join(out, '.nojekyll'), ''),
    writeFile(join(out, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`),
    writeFile(join(out, 'icon.svg'), iconSvg),
    writeFile(join(out, 'sw.js'), serviceWorkerSource),
  ]);
  return { dates, latest: dates[0] || null, out, warnings };
}

if (isMain(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2), ['root', 'out']);
    const result = await buildSite(Object.fromEntries(Object.entries(options).map(([key, value]) => [key, resolve(value)])));
    for (const warning of result.warnings) console.warn(warning);
    console.log(`Built ${result.dates.length} dated page(s) in ${result.out}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
