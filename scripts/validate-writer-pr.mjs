import { resolve } from 'node:path';
import { changedPaths, requireRegularFile, validateChangedFilesAtRoot, validateFile } from './validate.mjs';
import { isMain, parseArgs } from './lib/core.mjs';

/** Run from the trusted base checkout; candidate supplies JSON only. */
export async function validateWriterPr(input, { baseRoot, root }) {
  if (!baseRoot || !root) throw new Error('Both trusted baseRoot and candidate root are required');
  baseRoot = resolve(baseRoot);
  root = resolve(root);
  if (root === baseRoot) throw new Error('Trusted and candidate checkouts must differ');
  const errors = await validateChangedFilesAtRoot(input, root);
  if (errors.length) throw new Error(errors.join('\n'));
  const date = /^data\/(\d{4}-\d{2}-\d{2})/.exec(changedPaths(input)[0])[1];
  // Facts always come directly from the trusted base; candidate raw is unused.
  await requireRegularFile(baseRoot, `raw/${date}.json`);
  errors.push(...await validateFile(date, root, { rawRoot: baseRoot }));
  if (errors.length) throw new Error(errors.join('\n'));
  return date;
}

if (isMain(import.meta.url)) {
  Promise.resolve().then(async () => {
    const options = parseArgs(process.argv.slice(2), ['root', 'base-root']);
    let input = ''; process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) input += chunk;
    console.log(await validateWriterPr(input, { root: options.root, baseRoot: options['base-root'] }));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
