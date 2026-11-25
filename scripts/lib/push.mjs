import pushConfig from '../../config/push.json' with { type: 'json' };

export const serviceWorkerSource = String.raw`const siteRoot = new URL('./', self.registration.scope);
function targetUrl(value) {
  try {
    const url = new URL(value, siteRoot);
    if (['https:', 'http:'].includes(url.protocol) && url.origin === siteRoot.origin && url.pathname.startsWith(siteRoot.pathname)) return url.href;
  } catch {}
  return new URL('index.html', siteRoot).href;
}
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() || {} : {}; } catch {}
  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'AI観測ノート';
  const body = typeof payload.body === 'string' ? payload.body : '今日の紙面が届きました';
  event.waitUntil(self.registration.showNotification(title, {
    body, data: { url: targetUrl(payload.url || 'index.html') }, icon: new URL('icon.svg', siteRoot).href,
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = targetUrl(event.notification.data?.url || 'index.html');
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const exact = windows.find(client => client.url === url);
    if (exact) return exact.focus();
    const existing = windows.find(client => {
      try { const current = new URL(client.url); return current.origin === siteRoot.origin && current.pathname.startsWith(siteRoot.pathname); }
      catch { return false; }
    });
    if (existing && typeof existing.navigate === 'function') {
      try {
        const navigated = await existing.navigate(url);
        if (navigated) return navigated.focus();
      } catch {}
    }
    return self.clients.openWindow(url);
  })());
});
`;

export const pushSection = `<section class="push-settings" aria-labelledby="push-heading"><h2 id="push-heading">通知</h2>
<button id="push-button" type="button">通知を受け取る</button><p id="push-status" role="status" aria-live="polite"></p>
<div id="push-code-panel" hidden><label for="push-code">登録コード</label><textarea id="push-code" rows="5" readonly spellcheck="false"></textarea>
<p>このコードを管理者に送ると通知が届くようになります</p><div class="push-actions"><button id="push-copy" type="button">コピー</button><button id="push-share" type="button" hidden>共有</button></div></div></section>`;

export const pushStyles = `.push-settings{margin:22px 0;padding:16px 0;border-top:1px solid #ccc}.push-settings h2{font-size:14px;margin:0 0 10px}.push-settings button{font:inherit;color:#111;background:#fff;border:1px solid #999;border-radius:2px;padding:7px 12px;cursor:pointer}.push-settings button:disabled{opacity:.55;cursor:wait}.push-settings button:focus-visible,.push-settings textarea:focus-visible{outline:2px solid #111;outline-offset:3px}.push-settings label{display:block;margin-bottom:5px;font-weight:700}.push-settings textarea{display:block;width:100%;box-sizing:border-box;font:12px/1.5 monospace;padding:8px;border:1px solid #aaa;background:#fafafa;color:#111;resize:vertical}.push-settings p{margin:8px 0;font-size:12px}.push-actions{display:flex;gap:8px}.push-settings [hidden]{display:none!important}`;

export const registrationScript = String.raw`(() => {
  const manifest = document.querySelector('link[rel="manifest"]');
  const root = new URL('./', manifest ? manifest.href : document.baseURI);
  const registered = 'serviceWorker' in navigator
    ? navigator.serviceWorker.register(new URL('sw.js', root).href, { scope: new URL('./', root).href }).catch(() => null)
    : Promise.resolve(null);
  const button = document.getElementById('push-button');
  if (!button) return;
  const status = document.getElementById('push-status');
  const panel = document.getElementById('push-code-panel');
  const code = document.getElementById('push-code');
  const share = document.getElementById('push-share');
  share.hidden = typeof navigator.share !== 'function';
  const message = text => { status.textContent = text; };
  const applicationServerKey = () => {
    const value = '${pushConfig.publicKey}'.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(value + '='.repeat((4 - value.length % 4) % 4)), char => char.charCodeAt(0));
  };
  button.addEventListener('click', async () => {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (ios && !standalone) {
      message('iPhoneでは、ホーム画面に追加したアイコンから開くと通知を設定できます');
      return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      message('このブラウザでは通知を設定できません。');
      return;
    }
    button.disabled = true;
    try {
      // Ask during the tap, before awaiting service worker activation, to retain the user gesture on iOS.
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (permission !== 'granted') {
        message(permission === 'denied' ? '通知が許可されていません。端末の設定から通知を許可してください。' : '通知の許可が必要です。もう一度ボタンを押して設定してください。');
        return;
      }
      if (!await registered) throw new Error('Service worker unavailable');
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey() });
      code.value = JSON.stringify(subscription, null, 2);
      panel.hidden = false;
      message('登録コードを表示しました。');
    } catch {
      message('通知を設定できませんでした。しばらくしてから、もう一度お試しください。');
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('push-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code.value); message('登録コードをコピーしました。'); }
    catch { message('コピーできませんでした。登録コードを選択してコピーしてください。'); }
  });
  share.addEventListener('click', async () => {
    try { await navigator.share({ title: 'AI観測ノート 登録コード', text: code.value }); message('登録コードを共有しました。'); }
    catch (error) { message(error.name === 'AbortError' ? '共有をキャンセルしました。' : '共有できませんでした。登録コードをコピーしてください。'); }
  });
})();`;
