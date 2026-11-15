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

test('changed-files accepts only literal dated data paths, including CRLF', () => {
  assert.deepEqual(validateChangedFiles('data/2026-11-15.json\r\ndata/2026-11-14.json\r\n'), []);
  for (const bad of ['', 'scripts/build.mjs', 'data/../data/2026-11-15.json', 'data/2026-11-15.json.exe', ' data/2026-11-15.json', 'data/2026-11-15.json\n\nREADME.md']) {
    assert.ok(validateChangedFiles(bad).length, JSON.stringify(bad));
  }
});
