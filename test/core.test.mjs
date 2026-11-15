import test from 'node:test';
import assert from 'node:assert/strict';
import { todayJst, isDate, safeUrl, escapeHtml, parseArgs } from '../scripts/lib/core.mjs';

test('JST date rolls over at 15:00 UTC and rejects invalid calendar dates', () => {
  assert.equal(todayJst('2026-11-14T14:59:59Z'), '2026-11-14');
  assert.equal(todayJst('2026-11-14T15:00:00Z'), '2026-11-15');
  assert.equal(isDate('2024-02-29'), true);
  for (const date of ['2026-02-29', '2026-11-31', '2026-1-01', '2026-11-15\n', '../2026-11-15']) assert.equal(isDate(date), false);
});

test('URL and escaping helpers prevent executable URLs and attribute breakout', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '//example.com', 'https://exa\nmple.com', null]) assert.equal(safeUrl(url), '');
  assert.equal(safeUrl('https://example.com/path?q=1#top'), 'https://example.com/path?q=1#top');
  assert.equal(escapeHtml('<img src="x">&\''), '&lt;img src=&quot;x&quot;&gt;&amp;&#39;');
});

test('CLI options reject unknown, duplicate and valueless arguments', () => {
  assert.deepEqual(parseArgs(['--root', 'space directory'], ['root']), { root: 'space directory' });
  for (const args of [['--root'], ['--unknown', 'x'], ['--root', 'a', '--root', 'b']]) assert.throws(() => parseArgs(args, ['root']));
});
