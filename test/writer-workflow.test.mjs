import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { validateWriterPr } from '../scripts/validate-writer-pr.mjs';
import { validateChangedFilesAtRoot } from '../scripts/validate.mjs';
import { writeJson } from '../scripts/lib/core.mjs';

const repo = resolve(import.meta.dirname, '..');
const date = '2026-11-15';
const id = 'hn-0123456789ab';
const editionPaths = `data/${date}.json\ndata/${date}.en.json\n`;
const collectedPaths = `${editionPaths}raw/${date}.json\nstate/seen.json\n`;

async function setup(t, baseHasRaw = true) {
  const tempParent = join(repo, '.tmp'); await mkdir(tempParent, { recursive: true });
  const temp = await mkdtemp(join(tempParent, 'writer-workflow-'));
  t.after(async () => {
    const inside = relative(tempParent, temp); assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside));
    await rm(temp, { recursive: true, force: true });
  });
  const baseRoot = join(temp, 'trusted'); const root = join(temp, 'candidate');
  await mkdir(baseRoot); await mkdir(root);
  const raw = { date, generatedAt: `${date}T00:00:00.000Z`, top: id, selected: [id], items: {
    [id]: { id, kind: 'hn', title: 'An AI development project', url: 'https://example.com/project', source: 'Hacker News',
      published: `${date}T00:00:00.000Z`, metrics: { points: 200, num_comments: 10 }, image: '', ogTitle: '', ogDescription: '', excerpt: '',
      objectID: '1', points: 200, num_comments: 10, discussion: { url: 'https://news.ycombinator.com/item?id=1', count: 10, points: 200 } },
  }, hfmodels: [], errors: [] };
  const ja = { date, articles: [{ id, category: 'tools', headline: '開発者、AI向けツールの新機能を公開', summary: 'AI関連の開発で使う機能を追加した。投稿には設定方法と新しい機能の使い方が記載されている。' }], ranking: [] };
  const en = { date, articles: [{ id, category: 'tools', headline: 'Developer adds new features to an AI development tool', summary: 'The developer says the project adds features for people building AI tools. The post describes the new functions and how to configure them.' }], ranking: [] };
  await writeJson(join(root, 'raw', `${date}.json`), raw);
  await writeJson(join(root, 'data', `${date}.json`), ja);
  await writeJson(join(root, 'data', `${date}.en.json`), en);
  if (baseHasRaw) await writeJson(join(baseRoot, 'raw', `${date}.json`), raw);
  return { temp, root, baseRoot, raw, ja, en };
}

test('trusted workflow helper validates both editions against base facts', async t => {
  const options = await setup(t);
  assert.deepEqual(await validateChangedFilesAtRoot(editionPaths, options.root), []);
  assert.equal(await validateWriterPr(editionPaths, options), date);
  assert.equal(await validateWriterPr(`data/${date}.en.json\ndata/${date}.json\n`, options), date);
});

for (const baseHasRaw of [true, false]) test(`trusted workflow helper rejects raw and state changes when base raw ${baseHasRaw ? 'exists' : 'is absent'}`, async t => {
  const options = await setup(t, baseHasRaw);
  await assert.rejects(validateWriterPr(collectedPaths, options), /Disallowed changed path/);
});

test('trusted workflow helper rejects missing base facts even when candidate raw exists', async t => {
  const options = await setup(t, false);
  const candidatePath = join(options.root, 'raw', `${date}.json`);
  const before = await readFile(candidatePath, 'utf8');
  await assert.rejects(validateWriterPr(editionPaths, options), error => /ENOENT|Cannot read raw/.test(error.message) && error.message.includes(options.baseRoot));
  assert.equal(await readFile(candidatePath, 'utf8'), before);
});

for (const candidateRaw of ['{untrusted-invalid-json', JSON.stringify({ date, selected: [], items: {} })]) test(`trusted workflow helper ignores and preserves ${candidateRaw.startsWith('{untrusted') ? 'malformed' : 'different'} candidate raw`, async t => {
  const options = await setup(t);
  const candidatePath = join(options.root, 'raw', `${date}.json`);
  await writeFile(candidatePath, candidateRaw);
  assert.equal(await validateWriterPr(editionPaths, options), date);
  assert.equal(await readFile(candidatePath, 'utf8'), candidateRaw);
});

test('trusted workflow helper does not require or create candidate raw', async t => {
  const options = await setup(t);
  const candidatePath = join(options.root, 'raw', `${date}.json`);
  await rm(candidatePath);
  await rmdir(join(options.root, 'raw'));
  assert.equal(await validateWriterPr(editionPaths, options), date);
  await assert.rejects(readFile(candidatePath), { code: 'ENOENT' });
});

test('trusted workflow helper rejects invalid English data', async t => {
  const options = await setup(t);
  options.en.articles[0].summary = 'Too short.';
  await writeJson(join(options.root, 'data', `${date}.en.json`), options.en);
  await assert.rejects(validateWriterPr(editionPaths, options), /en:.*summary/);
});

test('trusted workflow helper rejects mismatched edition categories', async t => {
  const options = await setup(t);
  options.en.articles[0].category = 'models';
  await writeJson(join(options.root, 'data', `${date}.en.json`), options.en);
  await assert.rejects(validateWriterPr(editionPaths, options), /categories must match/);
});

for (const path of [`data/${date}.json`, `data/${date}.en.json`]) test(`trusted workflow helper requires ${path} in the changed paths`, async t => {
  const options = await setup(t);
  const input = editionPaths.split('\n').filter(line => line !== path).join('\n');
  await assert.rejects(validateWriterPr(input, options), /Both Japanese and English/);
});

for (const path of [`data/${date}.json`, `data/${date}.en.json`]) test(`trusted workflow helper requires an existing ${path}`, async t => {
  const options = await setup(t);
  await rm(join(options.root, path));
  assert.ok((await validateChangedFilesAtRoot(editionPaths, options.root)).some(error => /ENOENT|Regular file/.test(error)));
  await assert.rejects(validateWriterPr(editionPaths, options), /ENOENT|Regular file/);
});

for (const path of [`data/${date}.json`, `data/${date}.en.json`]) test(`trusted workflow helper checks regular file for ${path}`, async t => {
  const options = await setup(t);
  const target = join(options.root, path);
  await rm(target); await mkdir(target);
  assert.ok((await validateChangedFilesAtRoot(editionPaths, options.root)).some(error => /Regular file/.test(error)));
  await assert.rejects(validateWriterPr(editionPaths, options), /Regular file/);
});

test('trusted workflow helper rejects a symlinked parent directory', async t => {
  const options = await setup(t);
  const directory = join(options.root, 'data'); const moved = join(options.temp, 'linked-data');
  await rename(directory, moved);
  await symlink(moved, directory, process.platform === 'win32' ? 'junction' : 'dir');
  assert.ok((await validateChangedFilesAtRoot(editionPaths, options.root)).some(error => /Regular file/.test(error)));
  await assert.rejects(validateWriterPr(editionPaths, options), /Regular file/);
});

test('trusted workflow helper rejects a symlinked changed path', async t => {
  const options = await setup(t);
  const target = join(options.root, 'data', `${date}.en.json`); const moved = join(options.temp, 'linked.json');
  await rename(target, moved);
  if (process.platform === 'win32') {
    // Directory junctions exercise the same lstat symlink guard without the
    // Windows privilege required to create a file symlink.
    const linkedDirectory = join(options.temp, 'linked-directory');
    await mkdir(linkedDirectory); await symlink(linkedDirectory, target, 'junction');
  } else await symlink(moved, target, 'file');
  assert.ok((await validateChangedFilesAtRoot(editionPaths, options.root)).some(error => /Regular file/.test(error)));
  await assert.rejects(validateWriterPr(editionPaths, options), /Regular file/);
});

test('trusted workflow helper rejects a non-regular trusted raw file', async t => {
  const options = await setup(t);
  const target = join(options.baseRoot, 'raw', `${date}.json`);
  await rm(target); await mkdir(target);
  await assert.rejects(validateWriterPr(editionPaths, options), /Regular file/);
});

test('trusted workflow helper rejects a symlinked trusted raw parent', async t => {
  const options = await setup(t);
  const directory = join(options.baseRoot, 'raw'); const moved = join(options.temp, 'linked-raw');
  await rename(directory, moved);
  await symlink(moved, directory, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(validateWriterPr(editionPaths, options), /Regular file/);
});

test('trusted workflow helper requires separate explicit checkouts', async t => {
  const options = await setup(t);
  await assert.rejects(validateWriterPr(editionPaths, {}), /Both trusted/);
  await assert.rejects(validateWriterPr(editionPaths, { baseRoot: options.root, root: options.root }), /must differ/);
});

test('trusted workflow helper rejects invalid edition JSON', async t => {
  const options = await setup(t);
  await writeFile(join(options.root, 'data', `${date}.en.json`), '{invalid');
  await assert.rejects(validateWriterPr(editionPaths, options), /Cannot read/);
});

test('workflow declarations retain trusted-head checks and dispatch only after merge or collector push', async () => {
  const publish = await readFile(join(repo, '.github', 'workflows', 'publish.yml'), 'utf8');
  const collect = await readFile(join(repo, '.github', 'workflows', 'collect.yml'), 'utf8');
  assert.ok(!/^  schedule:/m.test(publish));
  assert.match(publish, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(publish, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(publish, /git -C candidate diff --name-only "\$EXPECTED_BASE\.\.\.\$EXPECTED_HEAD"/);
  assert.match(publish, /diff -u <\(LC_ALL=C sort/);
  assert.match(publish, /node trusted\/scripts\/validate\.mjs --changed-files --root candidate </);
  assert.doesNotMatch(publish, /validate\.mjs --changed-files[^\n]*--base-root/);
  assert.match(publish, /node trusted\/scripts\/validate-writer-pr\.mjs --base-root trusted --root candidate/);
  assert.match(publish, /--match-head-commit "\$EXPECTED_HEAD"/);
  assert.match(publish, /gh workflow run publish\.yml --ref main -f "notify_date=\$ISSUE_DATE"/);
  assert.match(publish, /NOTIFY_DATE: \$\{\{ inputs\.notify_date \}\}/);
  assert.match(publish, /continue-on-error: true/);
  assert.match(publish, /\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\$/);
  assert.match(publish, /npm ci --omit=dev\s+node scripts\/notify\.mjs --date "\$NOTIFY_DATE"/);
  assert.ok(publish.indexOf('uses: actions/deploy-pages@v4') < publish.indexOf('name: Notify registered readers'));
  assert.match(collect, /cron: '17 20 \* \* \*'/);
  assert.match(collect, /workflow_dispatch:/);
  assert.match(collect, /TZ=Asia\/Tokyo date \+%F/);
  assert.match(collect, /echo "date=\$issue_date" >> "\$GITHUB_OUTPUT"/);
  assert.equal((collect.match(/ISSUE_DATE: \$\{\{ steps\.today\.outputs\.date \}\}/g) ?? []).length, 2);
  assert.match(collect, /node scripts\/collect\.mjs --date "\$ISSUE_DATE"/);
  assert.match(collect, /git commit -m "data: collect \$ISSUE_DATE"/);
  assert.match(collect, /\[\[ -f "raw\/\$issue_date\.json" \]\]/);
  assert.equal((collect.match(/if: steps\.today\.outputs\.collect == 'true'/g) ?? []).length, 2);
  assert.match(collect, /git push origin HEAD:main\s+# Token-authenticated pushes do not trigger another workflow\.\s+gh workflow run publish\.yml --ref main/);
});
