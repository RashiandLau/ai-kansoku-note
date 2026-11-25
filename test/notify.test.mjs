import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { buildPayload, notify, parseNotifyArgs } from '../scripts/notify.mjs';

const date = '2026-11-15';
const subscription = { endpoint: 'https://push.example.test/private-endpoint', keys: { p256dh: 'private-subscription-key', auth: 'private-auth-key' } };
const env = { VAPID_PRIVATE_KEY: 'private-vapid-key', PUSH_SUBSCRIPTIONS: JSON.stringify([subscription]) };

async function workspace(t, data = { articles: [] }, raw = {}) {
  await mkdir('.tmp', { recursive: true });
  const root = await mkdtemp(join('.tmp', 'notify-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [folder, content] of [['data', data], ['raw', raw]]) {
    await mkdir(join(root, folder));
    if (content !== null) await writeFile(join(root, folder, `${date}.json`), JSON.stringify(content));
  }
  return root;
}

function output() {
  const lines = [];
  return { lines, logger: { log: text => lines.push(text), warn: text => lines.push(text), error: text => lines.push(text) } };
}

test('notification payload uses the actual lead article and absolute dated URL', () => {
  const articles = [{ id: 'other', headline: 'Other headline' }, { id: 'lead', headline: 'Top headline' }];
  assert.deepEqual(buildPayload(date, { articles }, { top: 'lead' }), {
    title: 'AI観測ノート 11月15日号', body: 'Top headline',
    url: 'https://rashiandlau.github.io/ai-kansoku-note/2026-11-15.html',
  });
  assert.equal(buildPayload('2026-01-02', { articles }).title, 'AI観測ノート 1月2日号');
  assert.equal(buildPayload(date, { articles }).body, 'Other headline');
  assert.equal(buildPayload(date, null).body, '今日の紙面が届きました');
  assert.equal(buildPayload(date, { articles: [{ headline: '' }] }).body, '今日の紙面が届きました');
  assert.throws(() => buildPayload('2026-02-30', null), /date/i);
});

test('notify CLI accepts a boolean dry-run and rejects malformed or duplicate arguments', () => {
  assert.deepEqual(parseNotifyArgs(['--date', date, '--dry-run']), { date, dryRun: true });
  assert.deepEqual(parseNotifyArgs(['--dry-run', '--date', date]), { date, dryRun: true });
  assert.deepEqual(parseNotifyArgs(['--date', date]), { date, dryRun: false });
  for (const args of [[], ['--date'], ['--date', date, '--date', date], ['--date', date, '--dry-run', '--dry-run'], ['--date', '2026-02-30'], ['--date', date, '--root', '.'], ['--date', date, '--dry-run', 'true']]) {
    assert.throws(() => parseNotifyArgs(args));
  }
});

test('missing either secret skips delivery with a notice and never calls sender', async () => {
  for (const missing of [{}, { VAPID_PRIVATE_KEY: 'value' }, { PUSH_SUBSCRIPTIONS: '[]' }, { VAPID_PRIVATE_KEY: ' ', PUSH_SUBSCRIPTIONS: '[]' }]) {
    const { lines, logger } = output();
    const result = await notify({ date, root: 'does-not-exist', env: missing, logger, sender: () => assert.fail('must not send') });
    assert.equal(result.skipped, true);
    assert.match(lines.join('\n'), /missing|not configured/i);
  }
});

test('notify passes VAPID details, payload and 12-hour TTL to the injected sender without logging secrets', async t => {
  const root = await workspace(t, { articles: [{ id: 'lead', headline: 'Lead article' }] }, { top: 'lead' });
  const { lines, logger } = output();
  const calls = [];
  const result = await notify({ date, root, env, logger, sender: async (...args) => { calls.push(args); return { statusCode: 201 }; } });
  assert.equal(result.sent, 1);
  assert.deepEqual(calls[0][0], subscription);
  assert.equal(JSON.parse(calls[0][1]).body, 'Lead article');
  assert.equal(calls[0][2].TTL, 12 * 60 * 60);
  assert.equal(calls[0][2].vapidDetails.subject, 'https://github.com/RashiandLau/ai-kansoku-note');
  assert.equal(calls[0][2].vapidDetails.privateKey, env.VAPID_PRIVATE_KEY);
  assert.equal(calls[0][2].vapidDetails.publicKey, 'BO1fq2kebr-QV-HN7MDPMqxJf_INFK_ztWI0cwQ0zhFL9QjA6DuHYpzrKxrwotWCrOBCG0p3oWczZSCvBRQ1ei8');
  const log = lines.join('\n');
  assert.match(log, /201/);
  assert.ok(log.includes(createHash('sha256').update(subscription.endpoint).digest('hex').slice(0, 12)));
  for (const secret of [subscription.endpoint, ...Object.values(subscription.keys), env.VAPID_PRIVATE_KEY]) assert.ok(!log.includes(secret));
});

test('404 and 410 deliveries warn about expiration, continue to later subscriptions and sanitize all errors', async t => {
  const root = await workspace(t, null, null);
  const subscriptions = [404, 410, 503, 201].map(status => ({ ...subscription, endpoint: `${subscription.endpoint}/${status}` }));
  const { lines, logger } = output();
  const result = await notify({ date, root, env: { ...env, PUSH_SUBSCRIPTIONS: JSON.stringify(subscriptions) }, logger, sender: async current => {
    const statusCode = Number(current.endpoint.split('/').at(-1));
    if (statusCode !== 201) throw Object.assign(new Error(`secret ${current.endpoint} ${env.VAPID_PRIVATE_KEY}`), { statusCode, body: 'private response' });
    return { statusCode };
  } });
  assert.deepEqual({ sent: result.sent, failed: result.failed }, { sent: 1, failed: 3 });
  assert.equal(lines.filter(line => /expired/i.test(line)).length, 2);
  assert.ok(lines.some(line => /503/.test(line)));
  for (const secret of ['secret', subscription.endpoint, env.VAPID_PRIVATE_KEY, 'private response']) assert.ok(!lines.join('\n').includes(secret));
});

test('non-HTTP error messages and malformed secret values are never printed', async t => {
  const root = await workspace(t);
  for (const subscriptions of ['not-json-private-value', '{}', '[null]', '[{"endpoint":"javascript:private-key"}]', '[{"endpoint":"https://push.example.test","keys":{}}]']) {
    const { lines, logger } = output();
    await assert.rejects(notify({ date, root, env: { ...env, PUSH_SUBSCRIPTIONS: subscriptions }, logger, sender: () => assert.fail('must not send') }), error => {
      assert.match(error.message, /PUSH_SUBSCRIPTIONS/);
      assert.ok(!error.message.includes(subscriptions));
      return true;
    });
    assert.ok(!lines.join('\n').includes(subscriptions));
  }
  const { lines, logger } = output();
  const result = await notify({ date, root, env, logger, sender: async () => { throw new Error(subscription.endpoint); } });
  assert.equal(result.failed, 1);
  assert.ok(!lines.join('\n').includes(subscription.endpoint));
});

test('dry-run builds the payload and validates subscriptions without sending', async t => {
  const root = await workspace(t, { articles: [{ headline: 'Dry run lead' }] });
  const { lines, logger } = output();
  const result = await notify({ date, root, env, dryRun: true, logger, sender: () => assert.fail('dry run must not send') });
  assert.equal(result.payload.body, 'Dry run lead');
  assert.equal(result.sent, 0);
  assert.match(lines.join('\n'), /dry.run/i);
  assert.ok(!lines.join('\n').includes(subscription.endpoint));
});

test('an empty subscription list skips delivery cleanly', async t => {
  const root = await workspace(t);
  const { logger } = output();
  const result = await notify({ date, root, env: { ...env, PUSH_SUBSCRIPTIONS: '[]' }, logger, sender: () => assert.fail('empty list must not send') });
  assert.equal(result.sent, 0);
  assert.equal(result.failed, 0);
});
