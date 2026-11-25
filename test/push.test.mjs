import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { serviceWorkerSource, registrationScript, pushSection, pushStyles } from '../scripts/lib/push.mjs';

const origin = 'https://rashiandlau.github.io';
const scope = `${origin}/ai-kansoku-note/`;

function worker(clients = []) {
  const listeners = {};
  const notifications = [];
  const opened = [];
  const context = { URL, self: {
    registration: { scope, showNotification: async (...args) => notifications.push(args) },
    clients: { matchAll: async () => clients, openWindow: async url => opened.push(url) },
    addEventListener: (name, handler) => { listeners[name] = handler; },
  } };
  vm.runInNewContext(serviceWorkerSource, context);
  async function dispatch(name, event) {
    let done;
    listeners[name]({ ...event, waitUntil: promise => { done = promise; } });
    await done;
  }
  return { notifications, opened, dispatch };
}

function page({ english = false, ios = false, standalone = false, displayStandalone = false, permission = 'default', requestedPermission = 'granted', existing = null, supported = true, subscribeError = false, registrationError = false, share = true, copyError = false, shareError = null, noSection = false } = {}) {
  const elements = Object.fromEntries(['push-button', 'push-status', 'push-code-panel', 'push-code', 'push-copy', 'push-share'].map(id => [id, { hidden: false, value: '', textContent: '', handlers: {}, addEventListener(name, callback) { this.handlers[name] = callback; } }]));
  const subscription = { endpoint: 'https://push.example.test/subscription', keys: { p256dh: 'public', auth: 'auth' } };
  const calls = { registrations: [], permission: 0, subscribe: [], copy: [], share: [] };
  const pushManager = { getSubscription: async () => existing, subscribe: async options => { calls.subscribe.push(options); if (subscribeError) throw new Error('sensitive error'); return subscription; } };
  const navigator = { userAgent: ios ? 'iPhone' : 'Desktop', standalone, clipboard: { writeText: async text => { if (copyError) throw new Error('private clipboard error'); calls.copy.push(text); } } };
  if (supported) navigator.serviceWorker = { register: (...args) => { calls.registrations.push(args); return registrationError ? Promise.reject(new Error('registration failed')) : Promise.resolve({ pushManager }); }, ready: Promise.resolve({ pushManager }) };
  if (share) navigator.share = async value => { if (shareError) throw shareError; calls.share.push(value); };
  const Notification = { permission, requestPermission: async () => { calls.permission++; return requestedPermission; } };
  const window = { matchMedia: () => ({ matches: displayStandalone }), Notification, ...(supported ? { PushManager: function () {} } : {}) };
  const document = { baseURI: `${scope}${english ? 'en/' : ''}2026-11-15.html`, querySelector: () => ({ href: `${scope}manifest.webmanifest` }), getElementById: id => noSection ? null : elements[id] };
  vm.runInNewContext(registrationScript, { window, navigator, document, Notification, URL, Uint8Array, atob: text => Buffer.from(text, 'base64').toString('binary') });
  return { elements, calls, subscription, click: async id => elements[id].handlers.click() };
}

test('service worker shows push payload with a scoped icon and target URL', async () => {
  const app = worker();
  await app.dispatch('push', { data: { json: () => ({ title: 'AI観測ノート 11月15日号', body: '今日の見出し', url: `${scope}2026-11-15.html` }) } });
  assert.equal(app.notifications[0][0], 'AI観測ノート 11月15日号');
  assert.equal(app.notifications[0][1].body, '今日の見出し');
  assert.equal(app.notifications[0][1].data.url, `${scope}2026-11-15.html`);
  assert.equal(app.notifications[0][1].icon, `${scope}icon.svg`);
});

test('service worker handles missing or malformed push data without external navigation', async () => {
  for (const data of [undefined, { json: () => { throw new Error('invalid'); } }, { json: () => null }, { json: () => ({ url: 'https://attacker.test/path' }) }, { json: () => ({ url: `${origin}/another-site/` }) }, { json: () => ({ url: 'javascript:alert(1)' }) }]) {
    const app = worker();
    await app.dispatch('push', { data });
    assert.equal(app.notifications[0][0], 'AI観測ノート');
    assert.equal(app.notifications[0][1].data.url, `${scope}index.html`);
  }
});

test('notification click focuses its exact existing page, navigates another site client, or opens a window', async () => {
  const url = `${scope}2026-11-15.html`;
  let closed = 0;
  let focused = 0;
  const exact = worker([{ url, focus: async () => { focused++; } }]);
  await exact.dispatch('notificationclick', { notification: { data: { url }, close: () => { closed++; } } });
  assert.equal(closed, 1);
  assert.equal(focused, 1);
  assert.equal(exact.opened.length, 0);
  const navigations = [];
  const client = { url: `${scope}en/index.html`, navigate: async target => { navigations.push(target); return client; }, focus: async () => { focused++; } };
  const other = worker([client]);
  await other.dispatch('notificationclick', { notification: { data: { url }, close() {} } });
  assert.deepEqual(navigations, [url]);
  assert.equal(focused, 2);
  const empty = worker([{ url: `${origin}/other-project/`, focus: () => assert.fail('must not focus another app') }]);
  await empty.dispatch('notificationclick', { notification: { data: { url }, close() {} } });
  assert.deepEqual(empty.opened, [url]);
});

test('both editions register the shared root service worker with its root scope', () => {
  for (const english of [false, true]) {
    const app = page({ english, noSection: english });
    assert.equal(app.calls.registrations[0][0], `${scope}sw.js`);
    assert.equal(app.calls.registrations[0][1].scope, scope);
  }
  assert.match(pushSection, /通知を受け取る/);
  assert.match(pushSection, /登録コード/);
  assert.match(pushSection, /このコードを管理者に送ると通知が届くようになります/);
  assert.match(pushSection, /readonly/);
  assert.match(pushStyles, /textarea/);
});

test('iPhone outside standalone shows home-screen instructions without asking permission', async () => {
  const app = page({ ios: true });
  await app.click('push-button');
  assert.equal(app.calls.permission, 0);
  assert.equal(app.calls.subscribe.length, 0);
  assert.equal(app.elements['push-status'].textContent, 'iPhoneでは、ホーム画面に追加したアイコンから開くと通知を設定できます');
});

test('a user gesture requests permission, subscribes with VAPID and exposes copy/share controls', async () => {
  const app = page({ ios: true, standalone: true });
  assert.equal(app.calls.permission, 0);
  await app.click('push-button');
  assert.equal(app.calls.permission, 1);
  assert.equal(app.calls.subscribe[0].userVisibleOnly, true);
  assert.equal(Buffer.from(app.calls.subscribe[0].applicationServerKey).toString('base64url'), 'BO1fq2kebr-QV-HN7MDPMqxJf_INFK_ztWI0cwQ0zhFL9QjA6DuHYpzrKxrwotWCrOBCG0p3oWczZSCvBRQ1ei8');
  assert.deepEqual(JSON.parse(app.elements['push-code'].value), app.subscription);
  assert.equal(app.elements['push-code-panel'].hidden, false);
  await app.click('push-copy');
  await app.click('push-share');
  assert.equal(app.calls.copy[0], app.elements['push-code'].value);
  assert.equal(app.calls.share[0].text, app.elements['push-code'].value);
});

test('existing subscriptions are displayed again without another subscribe request', async () => {
  const existing = { endpoint: 'https://push.example.test/existing', keys: { p256dh: 'public', auth: 'auth' } };
  const app = page({ permission: 'granted', existing, share: false });
  await app.click('push-button');
  assert.deepEqual(JSON.parse(app.elements['push-code'].value), existing);
  assert.equal(app.calls.permission, 0);
  assert.equal(app.calls.subscribe.length, 0);
  assert.equal(app.elements['push-share'].hidden, true);
});

test('unsupported browsers, denied permission and subscription failures show plain messages', async () => {
  for (const options of [{ supported: false }, { permission: 'denied' }, { requestedPermission: 'default' }, { requestedPermission: 'denied' }, { subscribeError: true }, { registrationError: true }]) {
    const app = page(options);
    await app.click('push-button');
    assert.ok(app.elements['push-status'].textContent);
    assert.ok(!app.elements['push-status'].textContent.includes('sensitive error'));
    assert.equal(Boolean(app.elements['push-button'].disabled), false);
  }
});

test('standalone display mode permits iPhone subscriptions without navigator.standalone', async () => {
  const app = page({ ios: true, displayStandalone: true });
  await app.click('push-button');
  assert.equal(app.calls.subscribe.length, 1);
});

test('clipboard and share failures show recovery instructions and cancellation is handled', async () => {
  const app = page({ copyError: true, shareError: new Error('private share error') });
  await app.click('push-button');
  await app.click('push-copy');
  assert.match(app.elements['push-status'].textContent, /選択してコピー/);
  await app.click('push-share');
  assert.match(app.elements['push-status'].textContent, /コピーしてください/);
  assert.ok(!app.elements['push-status'].textContent.includes('private'));
  const cancelled = page({ shareError: Object.assign(new Error('cancelled'), { name: 'AbortError' }) });
  await cancelled.click('push-share');
  assert.match(cancelled.elements['push-status'].textContent, /キャンセル/);
});
