import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { readUsageInputs, persistCollection, mayPersistUsage } from '../scripts/lib/usage-store.mjs';

async function scratch(t) {
  const root = await mkdtemp(path.resolve('.test-usage-store-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('usage state defaults empty and bootstraps only selected facts from saved issues', async t => {
  const root = await scratch(t);
  assert.deepEqual(await readUsageInputs(root), { state: { pending: {}, seen: {} }, rawIssues: [] });
  await mkdir(path.join(root, 'raw'));
  const raw = { date: '2026-11-15', selected: ['a'], items: { a: { url: 'https://example.com/a' } } };
  await writeFile(path.join(root, 'raw', '2026-11-15.json'), JSON.stringify(raw));
  await writeFile(path.join(root, 'raw', 'not-an-issue.json'), '{');
  assert.deepEqual((await readUsageInputs(root)).rawIssues, [raw]);
});

test('malformed persisted state fails closed without overwriting it', async t => {
  const root = await scratch(t);
  await mkdir(path.join(root, 'state'));
  for (const value of ['{', '[]', '{"pending":[],"seen":{}}']) {
    await writeFile(path.join(root, 'state', 'usage.json'), value);
    await assert.rejects(readUsageInputs(root));
    assert.equal(await readFile(path.join(root, 'state', 'usage.json'), 'utf8'), value);
  }
});

test('only the collect workflow and isolated fixture outputs persist usage state', () => {
  assert.equal(mayPersistUsage({}, {}), false);
  assert.equal(mayPersistUsage({}, { GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW: 'Publish' }), false);
  assert.equal(mayPersistUsage({}, { GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW: 'Collect sources' }), true);
  assert.equal(mayPersistUsage({ fixtures: 'fixtures', out: '.tmp/demo' }, {}), true);
  assert.equal(mayPersistUsage({ fixtures: 'fixtures' }, {}), false);
});

test('fixture persistence cannot target the live checkout from another working directory', () => {
  const repo = path.resolve(import.meta.dirname, '..');
  const before = process.cwd();
  try {
    process.chdir(path.dirname(repo));
    assert.equal(mayPersistUsage({ fixtures: path.join(repo, 'fixtures'), out: repo }, {}), false);
  } finally { process.chdir(before); }
});

test('a final rename failure restores the already replaced state', async t => {
  const root = await scratch(t);
  const statePath = path.join(root, 'state.json');
  const rawPath = path.join(root, 'raw', '2026-11-15.json');
  await writeFile(statePath, '{"old":true}');
  let count = 0;
  const { rename } = await import('node:fs/promises');
  await assert.rejects(persistCollection({ rawPath, raw: {}, states: [[statePath, { updated: true }]],
    renameFile: async (...args) => { if (++count === 2) throw new Error('simulated disk failure'); return rename(...args); } }), /simulated disk failure/);
  assert.equal(await readFile(statePath, 'utf8'), '{"old":true}');
  await assert.rejects(readFile(rawPath), { code: 'ENOENT' });
});

test('concurrent persistence cannot replace the same fixed issue', async t => {
  const root = await scratch(t);
  const rawPath = path.join(root, 'raw', '2026-11-15.json');
  const outcomes = await Promise.allSettled([1, 2].map(n => persistCollection({ rawPath, raw: { n }, states: [] })));
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(x => x.status === 'rejected').length, 1);
});

test('collection persists raw and state together and refuses to replace a fixed issue', async t => {
  const root = await scratch(t);
  const rawPath = path.join(root, 'raw', '2026-11-15.json');
  const statePath = path.join(root, 'state', 'usage.json');
  await persistCollection({ rawPath, raw: { date: '2026-11-15' }, states: [[statePath, { pending: {}, seen: {} }]] });
  assert.equal(JSON.parse(await readFile(rawPath)).date, '2026-11-15');
  const before = await readFile(statePath, 'utf8');
  await assert.rejects(persistCollection({ rawPath, raw: {}, states: [[statePath, { bad: true }]] }), /already exists/);
  assert.equal(await readFile(statePath, 'utf8'), before);
});

test('a state staging failure leaves no issue and preserves previously saved state', async t => {
  const root = await scratch(t);
  const first = path.join(root, 'good.json');
  const blocked = path.join(root, 'file');
  await writeFile(first, '{"old":true}');
  await writeFile(blocked, 'not a directory');
  const rawPath = path.join(root, 'raw', '2026-11-15.json');
  await assert.rejects(persistCollection({ rawPath, raw: {}, states: [[first, {}], [path.join(blocked, 'state.json'), {}]] }));
  assert.equal(await readFile(first, 'utf8'), '{"old":true}');
  await assert.rejects(readFile(rawPath), { code: 'ENOENT' });
});
