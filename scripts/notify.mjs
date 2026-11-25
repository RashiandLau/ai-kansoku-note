import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import webPush from 'web-push';
import pushConfig from '../config/push.json' with { type: 'json' };
import { isDate, isMain } from './lib/core.mjs';

export function buildPayload(date, data, raw = {}) {
  if (!isDate(date)) throw new Error('Invalid notification date');
  const [, month, day] = date.split('-').map(Number);
  const articles = Array.isArray(data?.articles) ? data.articles : [];
  const top = articles.find(article => article?.id === raw?.top);
  const headline = top?.headline || articles[0]?.headline;
  return {
    title: `AI観測ノート ${month}月${day}日号`,
    body: typeof headline === 'string' && headline.trim() ? headline : '今日の紙面が届きました',
    url: `https://rashiandlau.github.io/ai-kansoku-note/${date}.html`,
  };
}

export function parseNotifyArgs(args) {
  let date;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && date === undefined) date = args[++i];
    else if (args[i] === '--dry-run' && !dryRun) dryRun = true;
    else throw new Error('Usage: node scripts/notify.mjs --date YYYY-MM-DD [--dry-run]');
  }
  if (!isDate(date)) throw new Error('Invalid or missing notification date');
  return { date, dryRun };
}

function subscriptionsFrom(value) {
  const invalid = () => new Error('PUSH_SUBSCRIPTIONS must be a JSON array of PushSubscription objects');
  let subscriptions;
  try { subscriptions = JSON.parse(value); }
  catch { throw invalid(); }
  if (!Array.isArray(subscriptions)) throw invalid();
  for (const subscription of subscriptions) {
    if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)
      || typeof subscription.endpoint !== 'string' || !subscription.endpoint
      || typeof subscription.keys?.p256dh !== 'string' || !subscription.keys.p256dh
      || typeof subscription.keys?.auth !== 'string' || !subscription.keys.auth) throw invalid();
    try {
      const endpoint = new URL(subscription.endpoint);
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw invalid();
    } catch { throw invalid(); }
  }
  return subscriptions;
}

async function readOptionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Could not read notification article data');
  }
}

const statusOf = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : 'unknown';

export async function notify({ date, dryRun = false, root = process.cwd(), env = process.env, logger = console, sender = webPush.sendNotification.bind(webPush) }) {
  if (!isDate(date)) throw new Error('Invalid notification date');
  if (!env.VAPID_PRIVATE_KEY?.trim() || !env.PUSH_SUBSCRIPTIONS?.trim()) {
    logger.log('Push notifications skipped: VAPID_PRIVATE_KEY or PUSH_SUBSCRIPTIONS is missing.');
    return { skipped: true, sent: 0, failed: 0 };
  }
  const subscriptions = subscriptionsFrom(env.PUSH_SUBSCRIPTIONS);
  const [data, raw] = await Promise.all([
    readOptionalJson(join(root, 'data', `${date}.json`)),
    readOptionalJson(join(root, 'raw', `${date}.json`)),
  ]);
  const payload = buildPayload(date, data, raw);
  if (dryRun) {
    logger.log(`Push dry-run: ${subscriptions.length} subscription(s); no notifications sent.`);
    return { dryRun: true, payload, sent: 0, failed: 0 };
  }
  const options = {
    TTL: 12 * 60 * 60,
    vapidDetails: { subject: pushConfig.subject, publicKey: pushConfig.publicKey, privateKey: env.VAPID_PRIVATE_KEY.trim() },
  };
  let sent = 0;
  let failed = 0;
  for (const subscription of subscriptions) {
    const hash = createHash('sha256').update(subscription.endpoint).digest('hex').slice(0, 12);
    let status;
    try {
      const result = await sender(subscription, JSON.stringify(payload), options);
      status = statusOf(result?.statusCode);
    } catch (error) {
      // Error messages and response bodies can contain the private endpoint or credentials.
      status = statusOf(error?.statusCode);
    }
    logger.log(`Push ${hash}: status ${status}`);
    if (status >= 200 && status < 300) sent++;
    else failed++;
    if (status === 404 || status === 410) logger.warn(`Push ${hash}: status ${status}; expired subscription, update PUSH_SUBSCRIPTIONS.`);
  }
  return { sent, failed, payload };
}

if (isMain(import.meta.url)) {
  try {
    const result = await notify(parseNotifyArgs(process.argv.slice(2)));
    if (result.failed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
