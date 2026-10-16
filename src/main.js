const { app, BrowserWindow, WebContentsView, ipcMain, powerSaveBlocker, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
    width: 1280, height: 800, useContentSize: true, resizable: false, maximizable: false, fullscreenable: false,
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
const findEmail = async wc => { try { return await wc.executeJavaScript(`(document.body.innerText.match(/[\\w.+-]+@[\\w-]+\\.[\\w.-]+/) || [''])[0]`) || ''; } catch { return ''; } };
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
    if (isFormHost(wc.getURL()) && !onLogin(wc)) return { ok: true, email: await findEmail(wc) };       // already signed in
    authDone = false; applyBounds();                                         // show the Google login
    wc.on('did-start-navigation', early);
    for (let i = 0; i < 2400 && my === authId; i++) {
      if (isFormHost(wc.getURL()) && !onLogin(wc)) { authDone = true; applyBounds(); await settled(); return { ok: true, email: await findEmail(wc) }; }
      await sleep(250);
    }
    return { ok: false };
  } catch (e) { return { ok: false, error: e.message }; }
  finally { wc.removeListener('did-start-navigation', early); }
});
ipcMain.on('auth:cancel', () => { authId++; });

// ---------- Google Form automation ----------

const PREP = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fire = el => ['pointerdown','mousedown','pointerup','mouseup','click']
    .forEach(t => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
  for (let i = 0; i < 60 && !document.querySelectorAll('div[role="listitem"]').length; i++) await sleep(500);
  if (!document.querySelectorAll('div[role="listitem"]').length) return { error: 'Form did not load' };
  const cb = document.querySelector('div[role="checkbox"]');
  if (cb && cb.getAttribute('aria-checked') !== 'true') { fire(cb); await sleep(300); }
  return { ok: true };
})()`;

// Page-side helpers shared by the snippets below.
const Q = label => `(() => {
  const items = [...document.querySelectorAll('div[role="listitem"]')];
  const head = i => i.innerText.trim().split('\\n')[0].replace(/\\s*\\*$/, '').trim();
  return items.find(i => head(i) === ${JSON.stringify(label)}) || items.find(i => i.innerText.includes(${JSON.stringify(label)}));
})()`;
const RECT = expr => `(() => {
  const e = ${expr}; if (!e) return null;
  e.scrollIntoView({ block: 'center' });
  const r = e.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;

// Real (trusted) mouse click inside the form view; Google Forms ignores synthetic DOM events for dropdowns.
async function realClick(wc, pt) {
  const x = Math.round(pt.x), y = Math.round(pt.y);
  wc.sendInputEvent({ type: 'mouseMove', x, y });
  await sleep(80);
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await sleep(60);
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

async function pick(wc, label, cands) {
  const run = js => wc.executeJavaScript(js);
  const lb = `(${Q(label)})?.querySelector('[role="listbox"]')`;
  const names = cands.map(c => String(c).toLowerCase());
  const optExpr = `[...document.querySelectorAll('[role="option"]')].filter(o => o.offsetParent !== null)`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const box = await run(RECT(lb));
    if (!box) throw new Error('Question not found: ' + label);
    await sleep(300);
    await realClick(wc, box);
    await sleep(800);
    const idx = await run(`(() => { const n = ${JSON.stringify(names)}; const o = ${optExpr}; for (const c of n) { const i = o.findIndex(x => x.innerText.trim().toLowerCase() === c); if (i >= 0) return i; } return -1; })()`);
    if (idx < 0) {
      const avail = await run(`${optExpr}.map(o => o.innerText.trim()).slice(0, 40).join(', ')`);
      if (attempt < 2) { await sleep(500); continue; }
      throw new Error('No option for "' + label + '" matching: ' + cands.join(' / ') + '. Available: ' + avail);
    }
    const pt = await run(RECT(`${optExpr}[${idx}]`));
    await sleep(200);
    await realClick(wc, pt);
    await sleep(700);
    const ok = await run(`(() => { const t = (${lb})?.innerText.trim().toLowerCase() || ''; return t && t !== 'choose' && ${JSON.stringify(names)}.some(n => t.includes(n)); })()`);
    if (ok) return;
  }
  throw new Error('Could not select a value for "' + label + '"');
}

async function fillForm(wc, p) {
  const r = await wc.executeJavaScript(PREP);
  if (r.error) return r;
  try {
    const m = p.monthIndex + 1;
    await pick(wc, 'Choose your Name', [p.name]);
    await pick(wc, 'Day', [p.day, String(p.day).padStart(2, '0')]);
    await pick(wc, 'Month', [p.month, p.month.slice(0, 3), String(m), String(m).padStart(2, '0')]);
    return await wc.executeJavaScript(`(() => {
      const t = (${Q('Tasks Completed')}).querySelector('input[type="text"], textarea');
      t.focus(); t.select();                      // select any restored draft text so typing replaces it
      return { ok: true, multiline: t.tagName === 'TEXTAREA' };
    })()`);
  } catch (e) { return { error: e.message }; }
}

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
  if (!p.tasks?.length) return { ok: false, error: 'No tasks to send' };
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

    const r = await fillForm(wc, p);
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

// ---------- shared task file (also written by the IDE extension) ----------
const STORE = path.join(os.homedir(), '.stride', 'entries.json');
const readStore = () => { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { return null; } };
ipcMain.on('store:read', e => { e.returnValue = readStore(); });
ipcMain.on('store:write', (_e, data) => {
  try { fs.mkdirSync(path.dirname(STORE), { recursive: true }); fs.writeFileSync(STORE + '.tmp', JSON.stringify(data)); fs.renameSync(STORE + '.tmp', STORE); } catch {}
});
app.whenReady().then(() => {
  fs.watchFile(STORE, { interval: 700 }, () => { const d = readStore(); if (d && win && !win.isDestroyed()) win.webContents.send('store:changed', d); });
});

// ---------- backup: one rolling file in a folder the user picks ----------
const BACKUP_FILE = 'Stride-backup.json';
ipcMain.handle('backup:pick', async () => {
  try {
    if (win && !win.isDestroyed()) { win.show(); win.focus(); }
    const r = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, { title: 'Choose backup folder', buttonLabel: 'Select folder', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled || !r.filePaths[0] ? '' : r.filePaths[0];
  } catch (e) { return ''; }
});
ipcMain.handle('backup:write', (_e, dir, data) => {
  try {
    const f = path.join(dir, BACKUP_FILE), tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, f);   // replaces the previous backup
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('backup:read', (_e, dir) => {
  try { return { ok: true, data: JSON.parse(fs.readFileSync(path.join(dir, BACKUP_FILE), 'utf8')) }; }
  catch (e) { return { ok: false, error: e.code === 'ENOENT' ? 'No backup found in that folder.' : e.message }; }
});
ipcMain.handle('backup:pickFile', async () => {
  try {
    const r = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, { title: 'Restore from backup', buttonLabel: 'Restore', properties: ['openFile'], filters: [{ name: 'Backup (JSON)', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    return { ok: true, data };
  } catch (e) { return { ok: false, error: 'That file could not be read as a backup.' }; }
});

// accent colour shared with the IDE extension
const THEME_FILE = path.join(os.homedir(), '.stride', 'theme.json');
ipcMain.on('theme:write', (_e, t) => {
  try { fs.mkdirSync(path.dirname(THEME_FILE), { recursive: true }); fs.writeFileSync(THEME_FILE + '.tmp', JSON.stringify(t)); fs.renameSync(THEME_FILE + '.tmp', THEME_FILE); } catch {}
});
