import test from 'node:test';
import assert from 'node:assert/strict';
import { validateData, validateChangedFiles } from '../scripts/validate.mjs';

function sample() {
  return {
    raw: { date: '2026-11-15', selected: ['claudecode-a', 'codex-b', 'hn-c', 'trending-d'], items: {
      'claudecode-a': { kind: 'claudecode' }, 'codex-b': { kind: 'codex' },
      'hn-c': { kind: 'hn' }, 'trending-d': { kind: 'trending' },
    } },
    data: { date: '2026-11-15', articles: [
      { id: 'claudecode-a', category: 'claude-code', headline: 'Claude Code、設定の扱いを変更', summary: '利用者向けに設定の扱いを変更した。更新内容は収集したリリース情報に記載されている。', impact: '設定の読み込み条件を確認する必要がある。' },
      { id: 'codex-b', category: 'codex', headline: 'Codex、設定の扱いを変更', summary: '利用者向けに設定の扱いを変更した。更新内容は収集したリリース情報に記載されている。' },
      { id: 'hn-c', category: 'oss', headline: '開発者、モデルの実装を公開', summary: 'モデルを実装したコードが公開された。投稿には実装の概要が記載されている。' },
    ], ranking: [{ id: 'trending-d', summary: 'AIエージェント向けの開発ツールを公開しているリポジトリである。' }] },
  };
}

test('valid text-only data exactly covers selected IDs', () => {
  const { raw, data } = sample();
  assert.deepEqual(validateData(raw, data), []);
});

for (const headline of ['Claude Code 2.1.0をリリース', 'Codex 0.166.0 リリース', '開発ツール 3.0-beta_2をリリース']) {
  test(`rejects a version-only release headline: ${headline}`, () => {
    const { raw, data } = sample();
    data.articles[0].headline = headline;
    assert.ok(validateData(raw, data).some(error => /Release-only headline forbidden/.test(error)));
  });
}

for (const kind of ['claudecode', 'codex', 'hn', 'official']) {
  for (const title of ['New AI model supports image input', '新しいAIモデルが画像入力に対応']) {
    test(`rejects an unchanged ${kind} raw title: ${title}`, () => {
      const { raw, data } = sample();
      const entry = data.articles[2];
      raw.items[entry.id] = { kind, title };
      entry.category = ({ claudecode: 'claude-code', codex: 'codex' })[kind] || 'models';
      entry.headline = title;
      assert.ok(validateData(raw, data).some(error => /Headline must differ from raw title/.test(error)));
    });
  }
}

for (const source of ['ITmedia AI+', '@IT']) {
  test(`accepts an unchanged japan headline from ${source}`, () => {
    const { raw, data } = sample();
    const entry = data.articles[2];
    raw.items[entry.id] = { kind: 'japan', source, title: 'AIモデルを発表　画像入力にも対応' };
    entry.category = 'japan';
    entry.headline = raw.items[entry.id].title;
    assert.deepEqual(validateData(raw, data), []);
  });
}

for (const [title, headline] of [
  ['AIモデルを発表　画像入力にも対応', 'AIモデルを発表 画像入力にも対応'],
  ['AIモデルを発表 画像入力にも対応', '\tAIモデルを発表　 \t画像入力にも対応 \n'],
  ['　AIモデルを発表 \t　画像入力にも対応\n', 'AIモデルを発表 画像入力にも対応'],
]) {
  test(`accepts a japan headline with normalized whitespace: ${JSON.stringify([title, headline])}`, () => {
    const { raw, data } = sample();
    const entry = data.articles[2];
    raw.items[entry.id] = { kind: 'japan', title };
    entry.category = 'japan';
    entry.headline = headline;
    const before = structuredClone({ raw, data });
    assert.deepEqual(validateData(raw, data), []);
    assert.deepEqual({ raw, data }, before);
  });
}

for (const headline of [
  '画像入力に対応するAIモデルを発表',
  'AIモデルを発表画像入力にも対応',
  'AIモデルを発表、画像入力にも対応',
  'ＡＩモデルを発表 画像入力にも対応',
]) {
  test(`rejects a rewritten japan headline: ${headline}`, () => {
    const { raw, data } = sample();
    const entry = data.articles[2];
    raw.items[entry.id] = { kind: 'japan', title: 'AIモデルを発表　画像入力にも対応' };
    entry.category = 'japan';
    entry.headline = headline;
    assert.ok(validateData(raw, data).some(error => /Japan headline must match raw title/.test(error)));
  });
}

test('uses raw kind rather than category for the japan headline rule', () => {
  const { raw, data } = sample();
  const entry = data.articles[2];
  raw.items[entry.id] = { kind: 'official', title: entry.headline };
  entry.category = 'japan';
  assert.ok(validateData(raw, data).some(error => /Headline must differ from raw title/.test(error)));
  raw.items[entry.id].kind = 'japan';
  entry.category = 'tools';
  assert.deepEqual(validateData(raw, data), []);
  entry.headline = '開発者、別のモデルの実装を公開';
  assert.ok(validateData(raw, data).some(error => /Japan headline must match raw title/.test(error)));
});

test('allows a 74-character domestic source headline but not a rewrite', () => {
  const { raw, data } = sample();
  const entry = data.articles[2];
  const title = `国内企業が開発ツールを公開　${'画像入力機能'.repeat(10)}`;
  assert.equal(Array.from(title).length, 74);
  raw.items[entry.id] = { kind: 'japan', title };
  entry.category = 'japan';
  entry.headline = title.replace('　', ' ');
  assert.deepEqual(validateData(raw, data), []);
  entry.headline = entry.headline.replace('公開', '発表');
  assert.ok(validateData(raw, data).some(error => /Japan headline must match raw title/.test(error)));
});

test('only exempts original Japanese usage headlines, keeping exact match and bans', () => {
  const { raw, data } = sample();
  const entry = data.articles[2];
  const title = `開発者がAIで画像を作成　${'画像入力機能'.repeat(10)}`;
  const item = raw.items[entry.id] = { kind: 'usage', language: 'ja', title };
  entry.category = 'usage';
  entry.headline = title;
  assert.deepEqual(validateData(raw, data), []);
  entry.headline = title.replace('　', ' ');
  assert.ok(validateData(raw, data).some(error => /Usage headline must match raw title verbatim/.test(error)));
  item.language = 'en';
  assert.ok(validateData(raw, data).some(error => /8-70 characters/.test(error)));
  item.language = 'ja';
  item.title = entry.headline = title + '—';
  assert.ok(validateData(raw, data).some(error => /Forbidden dash/.test(error)));
});

test('retains the Japanese authored headline cap even in the Japan category', () => {
  const { raw, data } = sample();
  const entry = data.articles[2];
  entry.category = 'japan';
  entry.headline = '開'.repeat(70);
  assert.deepEqual(validateData(raw, data), []);
  entry.headline += '発';
  assert.ok(validateData(raw, data).some(error => /8-70 characters/.test(error)));
});

test('rejects missing or nonstring japan raw titles without throwing', () => {
  for (const title of [undefined, null, 123]) {
    const { raw, data } = sample();
    raw.items['hn-c'] = { kind: 'japan', title };
    data.articles[2].category = 'japan';
    assert.ok(validateData(raw, data).some(error => /Japan headline must match raw title/.test(error)));
  }
});

for (const prefix of ['Show HN:', 'show hn：', 'Ask HN:', 'ASK HN：', 'Launch HN:', 'lAuNcH hN：', 'Tell HN:', 'tell hn：']) {
  test(`rejects an HN label at the start of a headline: ${prefix}`, () => {
    const { raw, data } = sample();
    data.articles[2].headline = `${prefix} 画像から図を作るツールを公開`;
    assert.ok(validateData(raw, data).some(error => /HN prefix forbidden/.test(error)));
  });
}

test('accepts a concrete release change and HN labels within a headline', () => {
  const { raw, data } = sample();
  raw.items['claudecode-a'].title = 'Claude Code 2.1.0';
  data.articles[0].headline = 'Claude Code 2.1.0、設定の読み込みを修正';
  data.articles[2].headline = '開発者がShow HNで画像変換ツールを公開';
  assert.deepEqual(validateData(raw, data), []);
});

for (const [label, mutate] of [
  ['missing article', d => d.articles.pop()],
  ['duplicate article', d => d.articles.push(d.articles[0])],
  ['unknown id', d => { d.articles[0].id = 'unknown'; }],
  ['ranking in articles', d => { d.articles[0].id = 'trending-d'; }],
  ['missing ranking', d => { d.ranking = []; }],
  ['duplicate ranking', d => d.ranking.push(d.ranking[0])],
  ['unknown category', d => { d.articles[0].category = 'misc'; }],
  ['Claude category mismatch', d => { d.articles[0].category = 'tools'; }],
  ['Codex category mismatch', d => { d.articles[1].category = 'tools'; }],
  ['impact on HN', d => { d.articles[2].impact = '操作を変更する。'; }],
  ['short headline', d => { d.articles[0].headline = '短い'; }],
  ['long headline', d => { d.articles[0].headline = 'あ'.repeat(71); }],
  ['short summary', d => { d.articles[0].summary = 'あ'.repeat(29); }],
  ['long summary', d => { d.articles[0].summary = 'あ'.repeat(261); }],
  ['long impact', d => { d.articles[0].impact = 'あ'.repeat(91); }],
  ['short ranking', d => { d.ranking[0].summary = 'あ'.repeat(19); }],
  ['long ranking', d => { d.ranking[0].summary = 'あ'.repeat(201); }],
  ['extra URL property', d => { d.articles[0].url = 'https://example.com'; }],
  ['extra top-level metadata', d => { d.image = 'bad'; }],
  ['wrong date', d => { d.date = '2026-11-14'; }],
  ['nonarray articles', d => { d.articles = {}; }],
  ['null entry', d => { d.articles[0] = null; }],
  ['nonstring field', d => { d.articles[0].headline = 123; }],
]) {
  test(`rejects ${label} with Japanese and English diagnostic`, () => {
    const { raw, data } = sample(); mutate(data);
    const errors = validateData(raw, data);
    assert.ok(errors.length > 0);
    assert.ok(errors.every(e => /[ぁ-んァ-ン一-龥]/u.test(e) && /[a-z]/i.test(e)));
  });
}

for (const forbidden of ['HTTP://example.com', '──', '—', '**強調**', '🤖', '🇯🇵', '1️⃣', '<script>alert(1)</script>']) {
  test(`rejects forbidden text: ${forbidden}`, () => {
    const { raw, data } = sample(); data.articles[0].summary += forbidden;
    assert.ok(validateData(raw, data).length > 0);
  });
}

test('boundary lengths count Unicode code points and permit numeric raw facts', () => {
  const { raw, data } = sample();
  data.articles[0].headline = '𠮷'.repeat(8);
  data.articles[0].summary = 'あ'.repeat(30);
  data.articles[0].impact = 'あ'.repeat(90);
  data.ranking[0].summary = 'あ'.repeat(200);
  assert.deepEqual(validateData(raw, data), []);
});

test('rejects malformed raw/data without throwing', () => {
  const { raw, data } = sample();
  for (const bad of [null, [], {}, 'text']) assert.ok(validateData(raw, bad).length);
  for (const bad of [null, [], {}, { ...raw, selected: ['missing'] }]) assert.ok(validateData(bad, data).length);
});

test('changed-files accepts both editions for exactly one date, including CRLF', () => {
  assert.deepEqual(validateChangedFiles('data/2026-11-15.json\r\ndata/2026-11-15.en.json\r\n'), []);
  for (const bad of ['', 'scripts/build.mjs', 'data/../data/2026-11-15.json', 'data/2026-11-15.json.exe', ' data/2026-11-15.json', 'data/2026-11-15.json\n\nREADME.md']) {
    assert.ok(validateChangedFiles(bad).length, JSON.stringify(bad));
  }
});

function englishSample() {
  const { raw, data: japaneseData } = sample();
  const data = structuredClone(japaneseData);
  for (const entry of data.articles) {
    entry.headline = 'Developer updates how the tool loads settings';
    entry.summary = 'The developer says the update changes how the tool loads its settings. The release notes describe the new behavior and its conditions.';
    if (Object.hasOwn(entry, 'impact')) entry.impact = 'Users can check which settings apply to their environment.';
  }
  for (const entry of data.ranking) entry.summary = 'The repository provides tools for developers working with AI agents. Its documentation describes the available features and setup.';
  return { raw, data, japaneseData };
}

const validateEnglish = ({ raw, data, japaneseData }) => validateData(raw, data, raw.date, { language: 'en', japaneseData });

test('accepts English article and ranking summaries with matching Japanese IDs and categories', () => {
  assert.deepEqual(validateEnglish(englishSample()), []);
});

test('English translates Japan source headlines instead of preserving Japanese titles', () => {
  const input = englishSample();
  input.raw.items['hn-c'] = { kind: 'japan', title: '国内企業、画像入力に対応するモデルを発表' };
  input.data.articles[2].category = input.japaneseData.articles[2].category = 'japan';
  input.data.articles[2].headline = 'Japanese company introduces a model with image input';
  assert.deepEqual(validateEnglish(input), []);
});

test('retains the English headline cap for a Japanese source item', () => {
  const input = englishSample();
  input.raw.items['hn-c'] = { kind: 'japan', title: '国内企業、画像入力に対応するモデルを発表' };
  input.data.articles[2].category = input.japaneseData.articles[2].category = 'japan';
  input.data.articles[2].headline = 'A'.repeat(110);
  assert.deepEqual(validateEnglish(input), []);
  input.data.articles[2].headline += 'B';
  assert.ok(validateEnglish(input).some(error => /30-110 characters/.test(error)));
});

for (const [label, mutate, diagnostic] of [
  ['short headline', d => { d.articles[0].headline = 'A'.repeat(29); }, /30-110/],
  ['long headline', d => { d.articles[0].headline = 'A'.repeat(111); }, /30-110/],
  ['short summary', d => { d.articles[0].summary = 'A'.repeat(79); }, /80-600/],
  ['long summary', d => { d.articles[0].summary = 'A'.repeat(601); }, /80-600/],
  ['one sentence summary', d => { d.articles[0].summary = 'The developer describes the changes to settings and the conditions under which these settings apply.'; }, /2-3 sentences/],
  ['four sentence summary', d => { d.articles[0].summary = 'The developer updates settings. The new behavior applies to local files. Users can review the release notes. The documentation lists the conditions.'; }, /2-3 sentences/],
  ['short ranking summary', d => { d.ranking[0].summary = 'A'.repeat(79); }, /80-600/],
  ['one sentence ranking summary', d => { d.ranking[0].summary = 'The repository provides development tools for people working on applications that use AI agents.'; }, /2-3 sentences/],
  ['long impact', d => { d.articles[0].impact = 'A'.repeat(201); }, /0-200/],
  ['different category', d => { d.articles[2].category = 'tools'; }, /categories must match/],
  ['missing id', d => { d.articles.pop(); }, /IDs must match/],
  ['different id', d => { d.articles[2].id = 'different'; }, /IDs must match/],
  ['impact on other article', d => { d.articles[2].impact = 'A short impact.'; }, /Impact only allowed/],
]) test(`English rejects ${label}`, () => {
  const input = englishSample(); mutate(input.data);
  assert.ok(validateEnglish(input).some(error => diagnostic.test(error)));
});

test('English comparison requires Japanese data', () => {
  const input = englishSample(); delete input.japaneseData;
  assert.ok(validateEnglish(input).some(error => /Japanese data required/.test(error)));
});

for (const word of ['revolutionary', 'game-changer', 'groundbreaking', 'seamless', 'delve', 'unleash', 'cutting-edge']) {
  for (const field of ['headline', 'summary', 'impact']) test(`English rejects hype word ${word} in ${field}`, () => {
    const input = englishSample(); input.data.articles[0][field] += ` ${word.toUpperCase()}`;
    assert.ok(validateEnglish(input).some(error => /Hype word forbidden/.test(error)));
  });
}

for (const value of ['https://example.com', 'ftp://example.com', 'www.example.com', '—', '🤖', '<b>HTML</b>', 'Show HN: Developer updates settings in the tool', 'Ask HN: Developer updates settings in the tool']) test(`English rejects prohibited text ${value}`, () => {
  const input = englishSample(); input.data.articles[0].headline = value;
  assert.ok(validateEnglish(input).length);
});

for (const headline of ['Claude Code 2.1.325 released', 'Claude Code 2.1.325 is released', 'Claude Code releases 2.1.325', 'Claude Code 2.1.325', 'Codex 0.169.0 is now available']) test(`English rejects release-only headline ${headline}`, () => {
  const input = englishSample(); input.data.articles[0].headline = headline;
  assert.ok(validateEnglish(input).some(error => /Release-only headline forbidden/.test(error)));
});

test('English accepts a release headline naming the main change and a 200-character impact', () => {
  const input = englishSample();
  input.data.articles[0].headline = 'Claude Code 2.1.325 fixes compressed response decoding';
  input.data.articles[0].impact = 'A'.repeat(200);
  assert.deepEqual(validateEnglish(input), []);
});

test('English accepts a concrete release change ending with a version number', () => {
  const input = englishSample();
  input.data.articles[0].headline = 'Claude Code 2.1.325 updates SQLite to 3.54';
  assert.deepEqual(validateEnglish(input), []);
});

const issuePaths = 'data/2026-11-15.json\ndata/2026-11-15.en.json\n';
const collectedPaths = `${issuePaths}raw/2026-11-15.json\nstate/seen.json\n`;

test('writer scope accepts exactly both editions regardless of obsolete base raw options', () => {
  for (const options of [undefined, { baseHasRaw: true }, { baseHasRaw: false }]) {
    assert.deepEqual(validateChangedFiles(issuePaths, options), []);
    assert.ok(validateChangedFiles(collectedPaths, options).some(error => /Disallowed changed path/.test(error)));
  }
});

for (const paths of [
  'data/2026-11-15.json\n', 'data/2026-11-15.en.json\n',
  `${issuePaths}raw/2026-11-15.json\n`, `${issuePaths}state/seen.json\n`,
  `${issuePaths}data/2026-11-16.json\ndata/2026-11-16.en.json\n`,
  `${issuePaths}raw/2026-11-16.json\nstate/seen.json\n`,
  `${issuePaths}data/2026-11-15.json\n`, `${issuePaths}scripts/collect.mjs\n`,
  'data/2026-02-30.json\ndata/2026-02-30.en.json\n',
  `${issuePaths}\n`, `${issuePaths}raw/../state/seen.json\n`,
]) test(`writer scope rejects incomplete, mixed, duplicate or unexpected paths ${JSON.stringify(paths)}`, () => {
  assert.ok(validateChangedFiles(paths).length);
});
