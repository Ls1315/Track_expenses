import { firebaseConfig } from './firebase-config.js';
import * as store from './store.js';

const VERSION = '0.2.0';
const DEFAULT_CATS = ['早餐', '午餐', '晚餐', '飲料', '零食', '交通', '日用品', '購物', '娛樂', '醫療', '房租', '水電', '電信', '其他'];

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

const state = {
  user: null,
  ctx: null,           // { uid, name, familyId }：寫入時用
  profile: null,       // users/{uid}
  family: null,        // families/{fid}
  my: [],              // 個人帳交易
  fam: [],             // 家庭帳交易
  txs: [],             // my + fam
  cats: [],
  scope: 'me',         // 記帳時存到哪本：'me' | 'family'
  filter: 'all',       // 明細／報表看哪些：'all' | 'me' | 'family'
  amount: '',          // 鍵盤輸入的數字字串
  month: monthOf(today()), // 明細／報表目前看的月份 'YYYY-MM'
};
const unsub = { profile: null, my: null, family: null, fam: null };

// ---------- 工具 ----------
function pad(n) { return String(n).padStart(2, '0'); }
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function monthOf(date) { return date.slice(0, 7); }
function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function money(n) { return '$' + n.toLocaleString('zh-TW'); }
function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function dayLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${m}/${d}（${WEEK[new Date(y, m - 1, d).getDay()]}）`;
}
function hasFamily() { return !!state.family; }
function isMine(t) { return t.scope === 'me' || t.by === state.ctx.uid; }

let toastTimer;
function toast(html, onAction) {
  const el = $('#toast');
  el.innerHTML = html + (onAction ? ' <button>復原</button>' : '');
  el.hidden = false;
  if (onAction) el.querySelector('button').onclick = () => { el.hidden = true; onAction(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

const ERRORS = {
  'permission-denied': '沒有權限（可能已不是家庭成員，或安全規則沒有設定好）',
  'unavailable': '連不上伺服器，連上網路後會自動同步',
  'auth/popup-closed-by-user': '登入視窗被關閉了',
  'auth/unauthorized-domain': '這個網址還沒加進 Firebase 的授權網域',
  'auth/network-request-failed': '網路連線失敗',
};
function errMsg(e) { return ERRORS[e?.code] || e?.message || String(e); }
// 寫入不等伺服器回應（離線時要等連上線才會完成），失敗再提示
function save(p) {
  p.catch(e => { console.error(e); toast('同步失敗：' + esc(errMsg(e))); });
}

// ---------- 畫面切換：設定說明／登入／載入中／App ----------
function gate(kind, msg = '') {
  $('#gate').hidden = kind === 'app';
  $('main').hidden = kind !== 'app';
  $('.tabs').hidden = kind !== 'app';
  $('#gate-setup').hidden = kind !== 'setup';
  $('#gate-login').hidden = kind !== 'login';
  $('#gate-loading').hidden = kind !== 'loading';
  $('#gate-msg').textContent = msg;
}

// ---------- 資料監聽 ----------
function stopAll() {
  for (const k of Object.keys(unsub)) { if (unsub[k]) unsub[k](); unsub[k] = null; }
}

function onUser(user, initErr) {
  stopAll();
  state.user = user;
  state.profile = state.family = null;
  state.my = state.fam = state.txs = [];
  if (!user) { gate('login', initErr ? '登入失敗：' + errMsg(initErr) : ''); return; }
  gate('loading');
  state.ctx = { uid: user.uid, name: user.displayName || '我', familyId: null };

  unsub.profile = store.watchProfile(user.uid, (p, meta) => {
    if (!p) {
      // 快取沒有不代表雲端沒有；確定雲端也沒有才建立
      if (!meta.fromCache) save(store.createProfile(user.uid, { cats: DEFAULT_CATS.slice(), familyId: null, scope: 'me' }));
      return;
    }
    onProfile(p, meta);
  }, e => toast('讀取個人設定失敗：' + esc(errMsg(e))));

  unsub.my = store.watchTx('me', user.uid, list => { state.my = list; mergeTx(); }, e => toast('讀取個人帳失敗：' + esc(errMsg(e))));
}

function onProfile(p, meta) {
  const first = !state.profile;
  state.profile = p;
  state.cats = Array.isArray(p.cats) ? p.cats : DEFAULT_CATS.slice();
  // 加入／建立家庭時，等伺服器確認寫入後才開始讀家庭帳，否則會被安全規則拒絕
  if ((p.familyId || null) !== state.ctx.familyId && !(p.familyId && meta.hasPendingWrites)) watchFamily(p.familyId || null);
  state.scope = p.scope === 'family' && p.familyId ? 'family' : 'me';
  if (first) gate('app');
  renderAll();
}

let retryTimer;
function watchFamily(fid, attempt = 0) {
  clearTimeout(retryTimer);
  if (unsub.family) unsub.family();
  if (unsub.fam) unsub.fam();
  unsub.family = unsub.fam = null;
  state.ctx.familyId = fid;
  state.family = null;
  state.fam = [];
  if (!fid) { mergeTx(); return; }
  unsub.family = store.watchFamily(fid, f => {
    state.family = f && f.members.includes(state.ctx.uid) ? f : null;
    renderAll();
  }, onFamilyErr);
  unsub.fam = store.watchTx('family', fid, list => { state.fam = list; mergeTx(); }, onFamilyErr);

  // 被拒（例如剛加入、伺服器還在處理，或已在別的裝置離開家庭）：稍後重試幾次
  function onFamilyErr(e) {
    console.warn('家庭帳讀取失敗', e.code);
    if (state.ctx.familyId !== fid) return;
    state.family = null;
    state.fam = [];
    mergeTx();
    renderAll();
    if (attempt < 5) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { if (state.ctx.familyId === fid) watchFamily(fid, attempt + 1); }, 1500 * (attempt + 1));
    }
  }
}

function mergeTx() {
  state.txs = state.my.concat(state.fam);
  if (state.profile) renderAll();
}

function visibleTx() {
  if (!hasFamily() || state.filter === 'all') return state.txs;
  return state.txs.filter(t => t.scope === state.filter);
}

async function saveCats() { save(store.updateProfile(state.ctx.uid, { cats: state.cats })); }

function addTx(category, amount) {
  const tx = {
    id: uid(),
    scope: hasFamily() ? state.scope : 'me',
    amount,
    category,
    date: $('#add-date').value || today(),
    note: $('#add-note').value.trim().slice(0, 500),
    createdAt: Date.now(),
  };
  if (tx.scope === 'family') { tx.by = state.ctx.uid; tx.byName = state.ctx.name; }
  save(store.putTx(tx, state.ctx));
  state.amount = '';
  $('#add-note').value = '';
  renderAdd();
  const where = tx.scope === 'family' ? '（家庭）' : '';
  toast(`已記${where}：${esc(category)} ${money(amount)}`, () => save(store.delTx(tx, state.ctx)));
}

// ---------- 記帳畫面 ----------
function renderAdd() {
  const amt = Number(state.amount || 0);
  $('#amount').textContent = money(amt);
  $('#amount').classList.toggle('zero', amt === 0);

  $('#scope').hidden = !hasFamily();
  $$('#scope button').forEach(b => b.classList.toggle('active', b.dataset.s === state.scope));

  $('#cat-grid').innerHTML = state.cats
    .map(c => `<button data-cat="${esc(c)}" ${amt ? '' : 'disabled'}>${esc(c)}</button>`).join('');

  // 常用組合：自己近 90 天記過 ≥2 次的（分類, 金額），取前 6
  const since = Date.now() - 90 * 864e5;
  const count = new Map();
  for (const t of state.txs) {
    if (t.createdAt < since || !isMine(t) || !state.cats.includes(t.category)) continue;
    const k = t.category + '\u0000' + t.amount;
    count.set(k, (count.get(k) || 0) + 1);
  }
  const top = [...count].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6);
  $('#presets').innerHTML = top.map(([k]) => {
    const [c, a] = k.split('\u0000');
    return `<button data-cat="${esc(c)}" data-amt="${a}">${esc(c)} ${money(Number(a))}</button>`;
  }).join('');
  $('#presets').hidden = top.length === 0;
}

function onKey(k) {
  if (k === 'C') state.amount = '';
  else if (k === 'B') state.amount = state.amount.slice(0, -1);
  else if (state.amount.length < 8 && !(state.amount === '' && k === '0')) state.amount += k;
  renderAdd();
}

function setScope(s) {
  if (s === state.scope) return;
  state.scope = s;
  renderAdd();
  save(store.updateProfile(state.ctx.uid, { scope: s })); // 記住上次選擇（跨裝置）
}

// ---------- 明細 ----------
function whoTag(t) {
  if (t.scope !== 'family') return '';
  const who = t.by === state.ctx.uid ? '我' : (t.byName || '家人');
  return `<span class="tag">家・${esc(who)}</span>`;
}

function renderList() {
  const txs = visibleTx().filter(t => monthOf(t.date) === state.month)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  if (!txs.length) { $('#list').innerHTML = '<p class="empty">這個月還沒有紀錄</p>'; return; }
  const byDay = new Map();
  for (const t of txs) {
    if (!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date).push(t);
  }
  $('#list').innerHTML = [...byDay].map(([date, list]) => `
    <div class="day">
      <div class="day-head"><span>${dayLabel(date)}</span><span>${money(list.reduce((s, t) => s + t.amount, 0))}</span></div>
      ${list.map(t => `
        <button class="row" data-id="${esc(t.id)}" data-scope="${t.scope}">
          <span class="row-cat">${esc(t.category)}</span>
          <span class="row-note">${whoTag(t)}${esc(t.note)}</span>
          <span class="row-amt">${money(t.amount)}</span>
        </button>`).join('')}
    </div>`).join('');
}

function findTx(id, scope) { return state.txs.find(x => x.id === id && x.scope === scope); }

function openEdit(id, scope) {
  const t = findTx(id, scope);
  if (!t) return;
  const f = $('#edit-form');
  const cats = state.cats.includes(t.category) ? state.cats : [...state.cats, t.category];
  f.category.innerHTML = cats.map(c => `<option>${esc(c)}</option>`).join('');
  f.amount.value = t.amount;
  f.category.value = t.category;
  f.date.value = t.date;
  f.note.value = t.note;
  // 只有自己記的才能在個人／家庭之間移動
  const canMove = hasFamily() && isMine(t);
  $('#edit-scope').hidden = !canMove;
  f.scope.value = t.scope;
  $('#edit-who').textContent = t.scope === 'family' && !isMine(t) ? `${t.byName || '家人'} 記的` : '';
  const dlg = $('#edit');
  dlg.dataset.id = id;
  dlg.dataset.scope = scope;
  dlg.returnValue = ''; // 不清掉的話會沿用上一次的「save」，刪除時又被寫回去
  dlg.showModal();
}

function onEditClose() {
  const dlg = $('#edit');
  if (dlg.returnValue !== 'save') return;
  const f = $('#edit-form');
  const t = findTx(dlg.dataset.id, dlg.dataset.scope);
  const amount = Math.round(Number(f.amount.value));
  if (!t || !(amount > 0)) return;
  const nt = { ...t, amount, category: f.category.value, date: f.date.value, note: f.note.value.trim().slice(0, 500) };
  const newScope = $('#edit-scope').hidden ? t.scope : f.scope.value;
  if (newScope !== t.scope) {
    nt.scope = newScope;
    if (newScope === 'family') { nt.by = state.ctx.uid; nt.byName = state.ctx.name; }
    else { delete nt.by; delete nt.byName; }
    save(store.moveTx(t, nt, state.ctx));
  } else {
    save(store.putTx(nt, state.ctx));
  }
}

function onEditDelete() {
  const dlg = $('#edit');
  const t = findTx(dlg.dataset.id, dlg.dataset.scope);
  if (!t) { dlg.close(); return; }
  // 別人記的刪掉後無法復原（安全規則只允許建立自己名下的紀錄），先確認
  if (!isMine(t) && !confirm(`這筆是 ${t.byName || '家人'} 記的，刪除後無法復原。確定刪除？`)) return;
  dlg.close('delete');
  save(store.delTx(t, state.ctx));
  const msg = `已刪除：${esc(t.category)} ${money(t.amount)}`;
  if (isMine(t)) toast(msg, () => save(store.putTx(t, state.ctx)));
  else toast(msg);
}

// ---------- 報表 ----------
function renderReport() {
  const all = visibleTx();
  const txs = all.filter(t => monthOf(t.date) === state.month);
  const total = txs.reduce((s, t) => s + t.amount, 0);
  if (!txs.length) { $('#report').innerHTML = '<p class="empty">這個月還沒有紀錄</p>'; return; }

  const sums = new Map();
  for (const t of txs) sums.set(t.category, (sums.get(t.category) || 0) + t.amount);
  const rows = [...sums].sort((a, b) => b[1] - a[1]);
  const max = rows[0][1];

  // 日平均：本月算到今天，過去月份算整月
  const [y, m] = state.month.split('-').map(Number);
  const isThisMonth = state.month === monthOf(today());
  const days = isThisMonth ? new Date().getDate() : new Date(y, m, 0).getDate();
  const prev = all.filter(t => monthOf(t.date) === shiftMonth(state.month, -1)).reduce((s, t) => s + t.amount, 0);

  // 家庭帳：各成員金額
  let people = '';
  if (hasFamily() && state.filter === 'family') {
    const byWho = new Map();
    for (const t of txs) {
      const who = t.by === state.ctx.uid ? '我' : (t.byName || '家人');
      byWho.set(who, (byWho.get(who) || 0) + t.amount);
    }
    people = `<h3>誰記的</h3><ul class="bars">${[...byWho].sort((a, b) => b[1] - a[1]).map(([w, v]) => `
      <li><div class="bar-label"><span>${esc(w)}</span><span>${money(v)}　${Math.round(v / total * 100)}%</span></div>
      <div class="bar"><i style="width:${(v / total * 100).toFixed(1)}%"></i></div></li>`).join('')}</ul><h3>分類</h3>`;
  }

  $('#report').innerHTML = `
    <div class="stats">
      <div><small>總支出</small><b>${money(total)}</b></div>
      <div><small>日平均</small><b>${money(Math.round(total / days))}</b></div>
      <div><small>上月</small><b>${money(prev)}</b></div>
    </div>
    ${people}
    <ul class="bars">
      ${rows.map(([c, v]) => `
        <li>
          <div class="bar-label"><span>${esc(c)}</span><span>${money(v)}　${Math.round(v / total * 100)}%</span></div>
          <div class="bar"><i style="width:${(v / max * 100).toFixed(1)}%"></i></div>
        </li>`).join('')}
    </ul>`;
}

// ---------- 設定 ----------
function renderSettings() {
  $('#account').textContent = `已登入：${state.ctx.name}`;

  // 家庭
  const f = state.family;
  $('#family-none').hidden = !!f;
  $('#family-has').hidden = !f;
  if (f) {
    $('#family-name').textContent = f.name;
    $('#family-members').innerHTML = f.members
      .map(u => `<li>${esc(f.memberNames?.[u] || '成員')}${u === state.ctx.uid ? '（我）' : ''}</li>`).join('');
    $('#invite-code').textContent = f.inviteCode ? f.inviteCode.replace(/(.{4})/, '$1-') : '—';
  }
  $('#import-scope').hidden = !f;
  if (!f) $('#import-scope').value = 'me';

  $('#cat-list').innerHTML = state.cats.map((c, i) => `
    <li>
      <span>${esc(c)}</span>
      <button data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
      <button data-act="down" data-i="${i}" ${i === state.cats.length - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
      <button data-act="rename" data-i="${i}">改名</button>
      <button data-act="del" data-i="${i}" class="danger">刪除</button>
    </li>`).join('');
  $('#version').textContent = VERSION;
}

async function onCatAction(act, i) {
  const name = state.cats[i];
  const cats = state.cats.slice();
  if (act === 'up' || act === 'down') {
    const j = act === 'up' ? i - 1 : i + 1;
    [cats[i], cats[j]] = [cats[j], cats[i]];
  } else if (act === 'rename') {
    const nn = (prompt('新名稱', name) || '').trim().slice(0, 30);
    if (!nn || nn === name) return;
    if (cats.includes(nn)) { alert('已有同名分類'); return; }
    cats[i] = nn;
    // 只改自己的紀錄（個人帳＋自己記的家庭帳），不動家人的
    const changed = state.txs.filter(t => t.category === name && isMine(t)).map(t => ({ ...t, category: nn }));
    if (changed.length) save(store.putMany(changed, state.ctx));
  } else if (act === 'del') {
    const used = state.txs.filter(t => t.category === name && isMine(t)).length;
    const msg = used ? `「${name}」有 ${used} 筆紀錄，刪除分類後紀錄會保留原分類名稱。確定刪除？` : `確定刪除「${name}」？`;
    if (!confirm(msg)) return;
    cats.splice(i, 1);
  }
  state.cats = cats;
  saveCats();
  renderAll();
}

function onCatAdd() {
  const nn = (prompt('分類名稱') || '').trim().slice(0, 30);
  if (!nn) return;
  if (state.cats.includes(nn)) { alert('已有同名分類'); return; }
  state.cats = [...state.cats, nn];
  saveCats();
  renderAll();
}

// ---------- 家庭 ----------
async function busy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { console.error(e); alert(errMsg(e)); } finally { btn.disabled = false; }
}

function onFamilyCreate(e) {
  const name = (prompt('家庭名稱', '我們家') || '').trim().slice(0, 30);
  if (!name) return;
  busy(e.currentTarget, async () => {
    await store.createFamily(name, state.ctx);
    toast('已建立家庭，把邀請碼給家人就能加入');
  });
}

function onFamilyJoin(e) {
  const code = prompt('輸入家人給你的 8 碼邀請碼');
  if (!code) return;
  busy(e.currentTarget, async () => {
    await store.joinFamily(code, state.ctx);
    toast('已加入家庭');
  });
}

function onCodeRotate(e) {
  if (!confirm('換新的邀請碼後，舊的碼就不能用了。繼續？')) return;
  busy(e.currentTarget, () => store.rotateCode(state.family));
}

async function onCodeShare() {
  const code = state.family?.inviteCode;
  if (!code) return;
  const text = `加入我的記帳家庭：打開記帳 App → 設定 → 用邀請碼加入，輸入 ${code}`;
  if (navigator.share) { try { await navigator.share({ text }); } catch (e) { /* 取消 */ } return; }
  try { await navigator.clipboard.writeText(code); toast('已複製邀請碼'); } catch (e) { prompt('邀請碼', code); }
}

function onFamilyRename(e) {
  const name = (prompt('家庭名稱', state.family.name) || '').trim().slice(0, 30);
  if (!name || name === state.family.name) return;
  busy(e.currentTarget, () => store.renameFamily(state.family, name));
}

function onFamilyLeave(e) {
  const last = state.family.members.length === 1;
  const msg = last
    ? '你是最後一位成員。離開後家庭帳的紀錄會留在雲端，但沒有人看得到，邀請碼也會失效。確定離開？'
    : '離開後就看不到家庭帳了（你記過的家庭紀錄會留給其他成員）。確定離開？';
  if (!confirm(msg)) return;
  busy(e.currentTarget, async () => {
    await store.leaveFamily(state.family, state.ctx);
    state.filter = 'all';
    toast('已離開家庭');
  });
}

// ---------- CSV ----------
const CSV_COLS = ['id', 'date', 'amount', 'category', 'note', 'createdAt'];
const CSV_EXTRA = ['scope', 'byName']; // 匯出時附上，匯入時不使用

function toCSV(txs) {
  const cell = v => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const cols = CSV_COLS.concat(CSV_EXTRA);
  const lines = [cols.join(',')];
  [...txs].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
    .forEach(t => lines.push(cols.map(c => cell(c === 'scope' ? (t.scope === 'family' ? 'family' : 'personal') : t[c])).join(',')));
  return '﻿' + lines.join('\r\n'); // BOM 讓 Excel 正確顯示中文
}

function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c !== ''));
}

async function onExport() {
  const name = `記帳備份-${today()}.csv`;
  const file = new File([toCSV(visibleTx())], name, { type: 'text/csv' });
  // iOS 主畫面 App 用分享選單（可存到「檔案」）最穩；不支援時退回下載
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); } catch (e) { /* 使用者取消 */ }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function onImport(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const scope = hasFamily() ? $('#import-scope').value : 'me';
  const rows = parseCSV(await f.text());
  const head = (rows.shift() || []).map(h => h.trim());
  const idx = Object.fromEntries(CSV_COLS.map(c => [c, head.indexOf(c)]));
  if (idx.date < 0 || idx.amount < 0 || idx.category < 0) { alert('CSV 格式不符：至少需要 date、amount、category 欄位'); return; }

  const existing = new Set(state.txs.filter(t => t.scope === scope).map(t => t.id));
  const list = [];
  let bad = 0;
  for (const r of rows) {
    const amount = Math.round(Number(r[idx.amount]));
    const date = (r[idx.date] || '').trim();
    const category = (r[idx.category] || '').trim().slice(0, 30);
    if (!(amount > 0 && amount < 1e8) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !category) { bad++; continue; }
    // Firestore 文件 id 不能含 /
    const rawId = idx.id >= 0 ? (r[idx.id] || '').trim() : '';
    const t = {
      id: rawId && !rawId.includes('/') ? rawId : uid(),
      scope, date, amount, category,
      note: (idx.note >= 0 ? r[idx.note] || '' : '').slice(0, 500),
      createdAt: Math.round(idx.createdAt >= 0 && Number(r[idx.createdAt]) || Date.now()),
    };
    if (scope === 'family') { t.by = state.ctx.uid; t.byName = state.ctx.name; }
    list.push(t);
  }
  const added = list.filter(t => !existing.has(t.id)).length;
  const where = scope === 'family' ? '家庭帳' : '個人帳';
  if (!confirm(`將匯入 ${list.length} 筆到「${where}」（新增 ${added}、覆蓋同 id ${list.length - added}）${bad ? `，略過 ${bad} 筆格式錯誤` : ''}。繼續？`)) return;

  const newCats = [...new Set(list.map(t => t.category))].filter(c => !state.cats.includes(c));
  if (newCats.length) { state.cats = [...state.cats, ...newCats]; saveCats(); }
  toast(`匯入中…（${list.length} 筆）`);
  try {
    await store.putMany(list, state.ctx);
    toast(`已匯入 ${list.length} 筆到${where}`);
  } catch (err) {
    console.error(err);
    alert('匯入失敗：' + errMsg(err));
  }
}

// ---------- 導覽 ----------
function show(view) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'add') $('#add-date').value = $('#add-date').value || today();
}

function renderAll() {
  if (!state.profile) return;
  if (!hasFamily()) state.filter = 'all';
  const [y, m] = state.month.split('-');
  $$('.month-label').forEach(el => { el.textContent = `${y} 年 ${Number(m)} 月`; });
  $$('.filter').forEach(el => { el.hidden = !hasFamily(); });
  $$('.filter button').forEach(b => b.classList.toggle('active', b.dataset.f === state.filter));
  renderAdd();
  renderList();
  renderReport();
  renderSettings();
}

function bind() {
  $$('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
  $('#keypad').addEventListener('click', e => { const k = e.target.dataset.k; if (k) onKey(k); });
  $('#scope').addEventListener('click', e => { const s = e.target.dataset.s; if (s) setScope(s); });
  $('#cat-grid').addEventListener('click', e => {
    const c = e.target.dataset.cat;
    if (c && Number(state.amount) > 0) addTx(c, Number(state.amount));
  });
  $('#presets').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) addTx(b.dataset.cat, Number(b.dataset.amt));
  });
  $$('.month-nav button').forEach(b => b.addEventListener('click', () => {
    state.month = shiftMonth(state.month, Number(b.dataset.m));
    renderAll();
  }));
  $$('.filter').forEach(el => el.addEventListener('click', e => {
    const f = e.target.dataset.f;
    if (f) { state.filter = f; renderAll(); }
  }));
  $('#list').addEventListener('click', e => { const r = e.target.closest('.row'); if (r) openEdit(r.dataset.id, r.dataset.scope); });
  $('#edit').addEventListener('close', onEditClose);
  $('#edit-delete').addEventListener('click', onEditDelete);
  $('#cat-list').addEventListener('click', e => { const b = e.target.closest('button'); if (b) onCatAction(b.dataset.act, Number(b.dataset.i)); });
  $('#cat-add').addEventListener('click', onCatAdd);
  $('#family-create').addEventListener('click', onFamilyCreate);
  $('#family-join').addEventListener('click', onFamilyJoin);
  $('#family-rename').addEventListener('click', onFamilyRename);
  $('#code-share').addEventListener('click', onCodeShare);
  $('#code-rotate').addEventListener('click', onCodeRotate);
  $('#family-leave').addEventListener('click', onFamilyLeave);
  $('#export').addEventListener('click', onExport);
  $('#import').addEventListener('change', onImport);
  $('#logout').addEventListener('click', () => { if (confirm('確定登出？')) store.logout(); });
  $('#login').addEventListener('click', e => busy(e.currentTarget, store.login));
  // 跨日後重新打開 App 時，日期回到今天
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.amount === '') $('#add-date').value = today();
  });
}

async function init() {
  $('#add-date').value = today();
  bind();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js');
  }
  if (!firebaseConfig) { gate('setup'); return; }
  gate('loading');
  const initErr = await store.init(firebaseConfig);
  store.onUser(user => onUser(user, initErr));
}

init();
