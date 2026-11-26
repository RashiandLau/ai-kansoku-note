import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkdir, readdir, readFile, writeFile, rename, rm, lstat, open } from 'node:fs/promises';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const checkout = fileURLToPath(new URL('../../', import.meta.url));
function actualPath(value) {
  let result = path.resolve(value);
  try { result = realpathSync(result); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return process.platform === 'win32' ? result.toLowerCase() : result;
}

export async function readUsageInputs(root) {
  let state;
  try {
    state = JSON.parse(await readFile(path.join(root, 'state', 'usage.json'), 'utf8'));
    if (!object(state) || !object(state.pending) || !object(state.seen)) throw new Error('Invalid usage state');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { pending: {}, seen: {} };
  }
  let names;
  try { names = await readdir(path.join(root, 'raw')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; names = []; }
  const rawIssues = [];
  for (const name of names.filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()) {
    rawIssues.push(JSON.parse(await readFile(path.join(root, 'raw', name), 'utf8')));
  }
  return { state, rawIssues };
}

// Production state belongs to collect.yml. Local fixture runs may write only
// their explicitly isolated output tree, never the checkout's live state.
export function mayPersistUsage(options, env = process.env) {
  return (env.GITHUB_ACTIONS === 'true' && env.GITHUB_WORKFLOW === 'Collect sources')
    || Boolean(options.fixtures && options.out && actualPath(options.out) !== actualPath(checkout));
}

// Stage every file before replacing state; expose the immutable issue last.
// On a reported write failure restore previous states. The workflow commits
// raw + state in one Git commit, so a killed runner cannot publish half a set.
export async function persistCollection({ rawPath, raw, states = [], renameFile = rename }) {
  await mkdir(path.dirname(rawPath), { recursive: true });
  const lockPath = `${rawPath}.lock`;
  const lock = await open(lockPath, 'wx');
  const staged = [];
  const replaced = [];
  try {
    try { await lstat(rawPath); throw new Error(`Issue already exists: ${rawPath}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const [filename, value] of [...states, [rawPath, raw]]) {
      await mkdir(path.dirname(filename), { recursive: true });
      let previous = null;
      try {
        const stat = await lstat(filename);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Not a regular file: ${filename}`);
        previous = await readFile(filename);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const temp = `${filename}.${randomUUID()}.tmp`;
      staged.push({ filename, temp, previous });
      await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    }
    for (const entry of staged) {
      await renameFile(entry.temp, entry.filename);
      replaced.push(entry);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const entry of replaced.reverse()) {
      try {
        if (entry.previous === null) await rm(entry.filename, { force: true });
        else await writeFile(entry.filename, entry.previous);
      } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'Collection persistence and rollback failed');
    throw error;
  } finally {
    try { await Promise.all(staged.map(entry => rm(entry.temp, { force: true }))); }
    finally { await lock.close(); await rm(lockPath, { force: true }); }
  }
}
