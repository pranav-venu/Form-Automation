const { app, BrowserWindow, WebContentsView, ipcMain, powerSaveBlocker, session } = require('electron');
const path = require('path');

const UA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSerqjhDUA-UjpnmSiECz69hsH-enTDEq6UnpPM1gUbE116d7w/viewform';
const PARTITION = 'persist:gform';
const OFFSCREEN = { x: -10000, y: -10000, width: 1000, height: 800 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const onLogin = wc => /accounts\.google\.com/.test(wc.getURL());

// Keep data (tasks, profile, Google login) in the folder used before the app was renamed to Stride.
app.setPath('userData', process.env.STRIDE_USER_DATA || path.join(app.getPath('appData'), 'Daily Log'));

let win, formView, quitting = false, wantRect = null, runId = 0;

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 1040, minHeight: 700,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#06080b',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));

  // The Google Form lives in a view inside this window; "hidden" = parked off-screen.
  formView = new WebContentsView({ webPreferences: { partition: PARTITION, backgroundThrottling: false } });
  formView.webContents.setUserAgent(UA);
  try { formView.setBorderRadius(16); } catch {}
  formView.setBackgroundColor('#ffffff');
  win.contentView.addChildView(formView);
  formView.setBounds(OFFSCREEN);

  // Closing hides the window so scheduled sends keep running in the background.
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.setIcon(path.join(__dirname, 'assets', 'logo.png'));
  powerSaveBlocker.start('prevent-app-suspension');
  createWindow();
  app.on('activate', () => win.show());
});
app.on('before-quit', () => { quitting = true; });

let authDone = false; // once sign-in succeeds, keep the view hidden so the form never flashes on the splash
const applyBounds = () => formView.setBounds(authDone ? OFFSCREEN : (wantRect || OFFSCREEN));
ipcMain.on('form:bounds', (_e, r) => { wantRect = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; applyBounds(); });
ipcMain.on('form:hide', () => { wantRect = null; applyBounds(); });
ipcMain.handle('form:signout', async () => {
  await session.fromPartition(PARTITION).clearStorageData();
  formView.webContents.loadURL('about:blank');
  return true;
});

// Splash sign-in: show Google's login in the embedded view until the user reaches the form.
let authId = 0;
const isFormHost = url => { try { const u = new URL(url); return u.hostname === 'docs.google.com' && u.pathname.includes('/forms'); } catch { return false; } };
ipcMain.handle('auth:start', async () => {
  const my = ++authId, wc = formView.webContents;
  const settled = async () => { // wait until the page (and any redirects) have finished loading
    for (let i = 0, calm = 0; i < 60 && calm < 2; i++) { await sleep(250); calm = wc.isLoading() ? 0 : calm + 1; }
  };
  // hidden while we find out where we land, so an already-signed-in session never flashes the form
  authDone = true; applyBounds();
  // once the login page is showing, hide the instant navigation to the form begins (before it can paint)
  const early = (_e, url, _inPlace, isMain) => { if (isMain && isFormHost(url)) { authDone = true; applyBounds(); } };
  try {
    await wc.loadURL(FORM_URL).catch(() => {});
    await settled();
    if (my !== authId) return { ok: false };
    if (isFormHost(wc.getURL()) && !onLogin(wc)) return { ok: true };       // already signed in
    authDone = false; applyBounds();                                         // show the Google login
    wc.on('did-start-navigation', early);
    for (let i = 0; i < 2400 && my === authId; i++) {
      if (isFormHost(wc.getURL()) && !onLogin(wc)) { authDone = true; applyBounds(); return { ok: true }; }
      await sleep(250);
    }
    return { ok: false };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { wc.removeListener('did-start-navigation', early); }
});
ipcMain.on('auth:cancel', () => { authId++; });

// ---------- Google Form automation ----------

const FILL = p => `(async () => {
  const P = ${JSON.stringify(p)};
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fire = el => ['pointerdown','mousedown','pointerup','mouseup','click']
    .forEach(t => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
  const items = () => [...document.querySelectorAll('div[role="listitem"]')];
  const find = label => items().find(i => i.innerText.includes(label));
  const visible = el => el.offsetParent !== null;

  for (let i = 0; i < 60 && !items().length; i++) await sleep(500);
  if (!items().length) return { error: 'Form did not load' };

  const cb = document.querySelector('div[role="checkbox"]');
  if (cb && cb.getAttribute('aria-checked') !== 'true') { fire(cb); await sleep(300); }

  async function pick(label, cands) {
    const q = find(label);
    if (!q) throw new Error('Question not found: ' + label);
    fire(q.querySelector('[role="listbox"]'));
    await sleep(700);
    const opts = [...document.querySelectorAll('[role="option"]')].filter(visible);
    for (const c of cands) {
      const o = opts.find(o => o.innerText.trim().toLowerCase() === String(c).toLowerCase());
      if (o) { fire(o); await sleep(500); return; }
    }
    throw new Error('No option for "' + label + '" matching: ' + cands.join(' / ') + '. Available: ' + opts.map(o => o.innerText.trim()).slice(0, 40).join(', '));
  }

  try {
    const m = P.monthIndex + 1;
    await pick('Choose your Name', [P.name]);
    await pick('Day', [P.day, String(P.day).padStart(2, '0')]);
    await pick('Month', [P.month, P.month.slice(0, 3), String(m), String(m).padStart(2, '0')]);
    const t = find('Tasks Completed').querySelector('input[type="text"], textarea');
    t.focus(); t.select();                      // select any restored draft text so typing replaces it
    return { ok: true, multiline: t.tagName === 'TEXTAREA' };
  } catch (e) { return { error: e.message }; }
})()`;

const SUBMIT = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const btn = [...document.querySelectorAll('[role="button"]')].find(b => /^\\s*submit\\s*$/i.test(b.innerText));
  if (!btn) return { error: 'Submit button not found' };
  ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => btn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
  for (let i = 0; i < 40; i++) { await sleep(500); if (/response has been recorded/i.test(document.body.innerText)) return { ok: true }; }
  return { error: 'Submitted but no confirmation seen' };
})()`;

const RECORDED = `/response has been recorded/i.test(document.body.innerText)`;

ipcMain.handle('form:run', async (_e, p) => {
  const my = ++runId;
  const wc = formView.webContents;
  authDone = false; applyBounds();
  try {
    await wc.loadURL(FORM_URL);

    if (onLogin(wc)) { // first run / expired session: bring the form forward so the user can sign in
      win.show(); win.webContents.send('form:need-view');
      for (let i = 0; i < 360 && onLogin(wc); i++) await sleep(500);
      if (onLogin(wc)) throw new Error('Google sign-in not completed');
      await sleep(1500);
      if (p.submit) { authDone = true; applyBounds(); }
    }

    const r = await wc.executeJavaScript(FILL(p));
    if (r.error) throw new Error(r.error);
    wc.focus();
    // "task - time," per line, last one ends with a full stop (a one-line field can't hold line breaks, so it gets ", ")
    await wc.insertText(p.tasks.join(r.multiline ? ',\n' : ', ') + '.');
    await sleep(400);

    if (p.submit) {
      const s = await wc.executeJavaScript(SUBMIT);
      if (s.error) throw new Error(s.error);
      return { ok: true, submitted: true };
    }
    // Manual mode: user presses Submit; detect it and tell the UI.
    (async () => {
      for (let i = 0; i < 1200 && my === runId; i++) {
        await sleep(1000);
        try { if (await wc.executeJavaScript(RECORDED)) { win.webContents.send('form:submitted', p.key); return; } } catch {}
      }
    })();
    return { ok: true, filled: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
