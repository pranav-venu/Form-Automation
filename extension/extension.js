const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Same file the Stride app reads and watches.
const STORE = path.join(os.homedir(), '.stride', 'entries.json');
const THEME = path.join(os.homedir(), '.stride', 'theme.json');
const readTheme = () => { try { const t = JSON.parse(fs.readFileSync(THEME, 'utf8')); return /^#[0-9a-f]{6}$/i.test(t.hex) ? { hex: t.hex, on: /^#[0-9a-f]{6}$/i.test(t.on) ? t.on : '#06242b' } : null; } catch { return null; } };
const pad = n => String(n).padStart(2, '0');
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmt = m => `${Math.floor(m / 60)}h ${pad(m % 60)}m`;

const read = () => { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')) || {}; } catch { return {}; } };
function write(data) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE + '.tmp', JSON.stringify(data));
  fs.renameSync(STORE + '.tmp', STORE);
}
const today = () => read()[todayKey()] || { tasks: [] };
const minsOf = e => (e.tasks || []).reduce((s, t) => s + t.mins, 0);

function addTask(text, mins) {
  const data = read(), k = todayKey(), e = data[k] || { tasks: [] };
  e.tasks.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: text.trim(), mins });
  e.sent = false; delete e.sentAt;                 // new work means the day is no longer fully sent
  data[k] = e; write(data);
}
function removeTask(id) {
  const data = read(), k = todayKey(), e = data[k];
  if (!e || e.sent) return;
  e.tasks = e.tasks.filter(t => t.id !== id); write(data);
}

const DURATIONS = [['15m', 15], ['30m', 30], ['45m', 45], ['1h', 60], ['1h 30m', 90], ['2h', 120], ['3h', 180], ['4h', 240]];
async function askMins(placeHolder = 'How long did it take?') {
  const pick = await vscode.window.showQuickPick(
    DURATIONS.map(([label, mins]) => ({ label, mins })).concat([{ label: 'Custom…', mins: 0 }]), { placeHolder });
  if (!pick) return 0;
  if (pick.mins) return pick.mins;
  const v = await vscode.window.showInputBox({ prompt: 'Minutes spent', validateInput: s => (/^\d+$/.test(s) && +s > 0 && +s <= 1440) ? null : 'Enter minutes, e.g. 50' });
  return v ? +v : 0;
}

// ---- git integration: offer to log each commit you make from Source Control ----
const gitApi = () => { try { return vscode.extensions.getExtension('vscode.git')?.exports.getAPI(1); } catch { return null; } };
const pickRepo = () => { const g = gitApi(); return g?.repositories.find(r => vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.fsPath.startsWith(r.rootUri.fsPath)) || g?.repositories[0]; };

async function logCommit(message) {
  const subject = message.split('\n')[0].trim();
  const text = await vscode.window.showInputBox({ prompt: 'Log this commit as a task', value: subject, valueSelection: [subject.length, subject.length] });
  if (!text?.trim()) return;
  const mins = await askMins('How long did this take?');
  if (!mins) return;
  addTask(text, mins); refreshAll();
  vscode.window.setStatusBarMessage(`$(check) Logged “${text.trim()}” · ${fmt(mins)}`, 4000);
}
let refreshAll = () => {};

function watchCommits(ctx, onCommit) {
  const g = gitApi(); if (!g) return;
  const seen = new Map();
  const track = async repo => {
    const mode = () => vscode.workspace.getConfiguration('stride').get('commitPrompt', 'ask');
    seen.set(repo, repo.state.HEAD?.commit);
    const sub = repo.state.onDidChange(async () => {
      const now = repo.state.HEAD?.commit, before = seen.get(repo);
      if (!now || now === before) return;
      seen.set(repo, now);
      if (!before || mode() === 'off') return;
      try {   // only commits you just made yourself — not pulls or checkouts
        const c = await repo.getCommit(now), me = await repo.getConfig('user.email').catch(() => '');
        const fresh = Date.now() - (c.commitDate ? +new Date(c.commitDate) : 0) < 120000;
        if (!fresh || (me && c.authorEmail && c.authorEmail.toLowerCase() !== me.trim().toLowerCase())) return;
        const act = await vscode.window.showInformationMessage(`Log this commit as a Stride task?  “${c.message.split('\n')[0]}”`, 'Log task', 'Not now');
        if (act === 'Log task') onCommit(c.message);
      } catch {}
    });
    ctx.subscriptions.push(sub);
  };
  g.repositories.forEach(track);
  ctx.subscriptions.push(g.onDidOpenRepository(track));
}

function activate(ctx) {
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  bar.command = 'stride.addTask'; bar.show();
  let view;
  const refresh = () => {
    const e = today(), n = (e.tasks || []).length;
    bar.text = `$(checklist) Stride ${n ? fmt(minsOf(e)) : '+ task'}`;
    bar.tooltip = n ? `${n} task${n > 1 ? 's' : ''} today — click to add another` : 'Add a task for today';
    view?.webview.postMessage({ type: 'state', entry: e });
  };
  const sendTheme = () => { const t = readTheme(); if (t) view?.webview.postMessage({ type: 'theme', ...t }); };

  ctx.subscriptions.push(
    bar,
    vscode.window.registerWebviewViewProvider('stride.tasks', {
      resolveWebviewView(v) {
        view = v;
        v.webview.options = { enableScripts: true };
        v.webview.html = html();
        v.webview.onDidReceiveMessage(m => {
          if (m.type === 'ready') { refresh(); sendTheme(); }
          if (m.type === 'add') { addTask(m.text, m.mins); refresh(); }
          if (m.type === 'remove') { removeTask(m.id); refresh(); }
        });
        v.onDidChangeVisibility(refresh);
      }
    }),
    vscode.commands.registerCommand('stride.focus', () => vscode.commands.executeCommand('stride.tasks.focus')),
    vscode.commands.registerCommand('stride.addTask', async () => {
      const text = await vscode.window.showInputBox({ prompt: 'What did you work on?', placeHolder: 'e.g. Fixed login bug' });
      if (!text?.trim()) return;
      const mins = await askMins();
      if (!mins) return;
      addTask(text, mins); refresh();
      vscode.window.setStatusBarMessage(`$(check) Added “${text.trim()}” · ${fmt(mins)}`, 3000);
    }),
    vscode.commands.registerCommand('stride.addFromCommit', async () => {
      const repo = pickRepo();
      if (!repo) return vscode.window.showWarningMessage('Stride: no git repository open.');
      const [c] = await repo.log({ maxEntries: 1 }).catch(() => []);
      if (!c) return vscode.window.showWarningMessage('Stride: no commits found.');
      await logCommit(c.message);
    })
  );
  watchCommits(ctx, logCommit);

  // keep the panel in sync when the app (or anything else) edits the file
  refreshAll = refresh;
  fs.watchFile(STORE, { interval: 700 }, refresh);
  ctx.subscriptions.push({ dispose: () => fs.unwatchFile(STORE, refresh) });
  fs.watchFile(THEME, { interval: 700 }, sendTheme);
  ctx.subscriptions.push({ dispose: () => fs.unwatchFile(THEME, sendTheme) });
  refresh();
}

function html() {
  return /* html */`<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
.task.in{animation:slideIn .38s cubic-bezier(.2,.8,.2,1) both}
@keyframes slideIn{from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:none}}
:root{--teal:#7fe0ef;--on:#06242b;--green:#7ce3a6}
*{box-sizing:border-box}
body{margin:0;padding:14px 14px 20px;font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground)}
.head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px}
.date{font-weight:600;font-size:14px}.total{color:var(--teal);font-weight:600}
input[type=text]{width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--vscode-input-border,rgba(255,255,255,.12));background:var(--vscode-input-background);color:var(--vscode-input-foreground);font:inherit;outline:none}
input[type=text]:focus{border-color:var(--teal)}
.lbl{margin:14px 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;opacity:.6}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{width:52px;padding:5px 0;text-align:center;border-radius:999px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:12px}
.chip:hover{border-color:var(--teal)}.chip.on{background:var(--teal);border-color:var(--teal);color:var(--on);font-weight:600}
.dur{display:flex;align-items:center;gap:8px;margin-top:10px}
.dur input{width:54px;text-align:center}.dur span{opacity:.6;font-size:12px}
.field{position:relative}.field input{padding-right:42px}
button.add{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:26px;height:26px;padding:0;border:0;border-radius:50%;background:var(--teal);color:var(--on);display:grid;place-items:center;cursor:pointer;transition:filter .15s,transform .15s}
button.add svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round}
button.add:hover{filter:brightness(1.1);transform:translateY(-50%) scale(1.08)}button.add:active{transform:translateY(-50%) scale(.94)}
.err{color:#ff7b7b;font-size:12px;min-height:16px;margin-top:6px}
hr{border:0;border-top:1px solid rgba(127,127,127,.25);margin:16px 0 12px}
.task{display:flex;align-items:flex-start;gap:8px;padding:9px 10px;border-radius:9px;background:rgba(127,127,127,.1);margin-bottom:6px}
.task .body{flex:1;min-width:0}.task .nm{overflow-wrap:anywhere}.task .tm{display:block;margin-top:2px;color:var(--teal);font-size:12px}
.task .x{border:0;background:none;color:inherit;opacity:.45;cursor:pointer;font-size:13px;padding:2px 4px}.task .x:hover{opacity:1;color:#ff7b7b}
.empty{opacity:.55;text-align:center;padding:10px 0}
.sent{color:var(--green);font-size:12px;margin-bottom:8px}
</style></head><body>
<div class="head"><span class="date" id="date"></span><span class="total" id="total"></span></div>
<div class="field"><input type="text" id="name" placeholder="What did you work on?" autocomplete="off"><button class="add" id="add" title="Add task"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button></div>
<div class="lbl">Time taken</div>
<div class="chips" id="chips"></div>
<div class="dur"><input type="text" id="h" inputmode="numeric" maxlength="2" value="0"><span>h</span><input type="text" id="m" inputmode="numeric" maxlength="2" value="0"><span>min</span></div>
<div class="err" id="err"></div>
<hr>
<div class="sent" id="sent" hidden>✓ Today was already sent — new tasks will mark it as unsent.</div>
<div id="list"></div>
<script>
const vs = acquireVsCodeApi(), $ = s => document.getElementById(s);
const CH = [[15,'15m'],[30,'30m'],[45,'45m'],[60,'1h'],[120,'2h'],[180,'3h'],[240,'4h']];
let picked = new Set();
const dur = () => (+$('h').value || 0) * 60 + (+$('m').value || 0);
const setDur = t => { $('h').value = Math.floor(t / 60); $('m').value = t % 60; };
const paint = () => document.querySelectorAll('.chip').forEach(b => b.classList.toggle('on', picked.has(+b.dataset.i)));
$('chips').innerHTML = CH.map(([m, l], i) => '<button class="chip" data-i="' + i + '">' + l + '</button>').join('');
document.querySelectorAll('.chip').forEach(b => b.onclick = () => {
  const i = +b.dataset.i; picked.has(i) ? picked.delete(i) : picked.add(i);
  setDur([...picked].reduce((t, j) => t + CH[j][0], 0)); paint();
});
['h','m'].forEach(id => { $(id).onfocus = e => { e.target.value = ''; }; $(id).onblur = e => { if (e.target.value === '') e.target.value = '0'; }; });
['h','m'].forEach(id => $(id).oninput = e => { e.target.value = e.target.value.replace(/\\D/g, ''); picked.clear(); paint(); });
$('date').textContent = 'Today · ' + new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
function add() {
  const text = $('name').value.trim(), mins = dur();
  if (!text) { $('err').textContent = 'Describe the task first.'; $('name').focus(); return; }
  if (!mins) { $('err').textContent = 'Pick how long it took.'; return; }
  $('err').textContent = ''; vs.postMessage({ type: 'add', text, mins });
  $('name').value = ''; picked.clear(); setDur(0); paint(); $('name').focus();
}
$('add').onclick = add; $('name').onkeydown = e => { if (e.key === 'Enter') add(); };
const fm = m => Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
window.addEventListener('message', ({ data }) => {
  if (data.type === 'theme') { document.documentElement.style.setProperty('--teal', data.hex); document.documentElement.style.setProperty('--on', data.on); return; }
  if (data.type !== 'state') return;
  const tasks = data.entry.tasks || [];
  $('total').textContent = tasks.length ? fm(tasks.reduce((s, t) => s + t.mins, 0)) : '';
  $('sent').hidden = !data.entry.sent;
  const list = $('list'), old = new Map([...list.querySelectorAll('.task')].map(el => [el.dataset.id, el]));
  const first = new Map([...old].map(([id, el]) => [id, el.getBoundingClientRect().top]));
  const firstPaint = !list.dataset.ready; list.dataset.ready = '1';
  list.innerHTML = tasks.length ? '' : '<div class="empty">No tasks yet today.</div>';
  tasks.slice().reverse().forEach(t => {
    const d = document.createElement('div'); d.className = 'task'; d.dataset.id = t.id;
    d.innerHTML = '<div class="body"><div class="nm"></div><span class="tm">' + fm(t.mins) + '</span></div>' + (data.entry.sent ? '' : '<button class="x" title="Remove">✕</button>');
    d.querySelector('.nm').textContent = t.text;
    const x = d.querySelector('.x'); if (x) x.onclick = () => vs.postMessage({ type: 'remove', id: t.id });
    list.appendChild(d);
    if (firstPaint) return;
    if (!first.has(t.id)) d.classList.add('in');                       // new task slides in from the top
    else {                                                              // existing tasks glide down to their new spot
      const dy = first.get(t.id) - d.getBoundingClientRect().top;
      if (dy) d.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  });
});
vs.postMessage({ type: 'ready' });
</script></body></html>`;
}
exports.activate = activate;
exports.deactivate = () => {};
