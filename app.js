import { firebaseConfig } from './firebase-config.js';
import * as store from './store.js';
import { icon, catIcon } from './icons.js';

const VERSION = '0.5.0';
// 分類樹：主分類底下可以有子分類；主分類本身也能直接拿來記帳。
// 存在 users/{uid}.catTree；同時寫一份平面清單到 cats，讓舊版 App 也讀得到。
const DEFAULT_TREE = [
  { name: '餐飲', subs: ['早餐', '午餐', '晚餐', '飲料', '零食'] },
  { name: '交通', subs: [] },
  { name: '居家', subs: ['房租', '水電', '電信'] },
  { name: '購物', subs: ['日用品', '衣服', '飾品', '美妝保養', '3C 家電'] },
  { name: '娛樂', subs: [] },
  { name: '醫療', subs: [] },
  { name: '其他', subs: [] },
];
const NEW_SUBS = ['衣服', '飾品', '美妝保養', '3C 家電'];

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
  tree: [],            // 分類樹 [{ name, subs: [] }]
  cats: [],            // 分類樹攤平（主分類、子分類…）
  parent: new Map(),   // 子分類 → 主分類
  open: new Set(),     // 報表展開的主分類
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
function dayTitle(date) {
  const t = today();
  const [y, m, d] = t.split('-').map(Number);
  const yest = new Date(y, m - 1, d - 1);
  const ys = `${yest.getFullYear()}-${pad(yest.getMonth() + 1)}-${pad(yest.getDate())}`;
  return dayLabel(date) + (date === t ? ' 今天' : date === ys ? ' 昨天' : '');
}
function hasFamily() { return !!state.family; }
function isMine(t) { return t.scope === 'me' || t.by === state.ctx.uid; }
// 家庭帳顯示「誰記的」：優先用成員名單上目前的名字（改名後新舊紀錄一起更新），已離開的成員才用紀錄上存的名字
function nameOf(t) { return state.family?.memberNames?.[t.by] || t.byName || '家人'; }
function googleName() { return state.user?.displayName || '我'; }

let toastTimer;
function toast(html, onAction) {
  const el = $('#toast');
  el.innerHTML = html + (onAction ? ' <button>復原</button>' : '');
  el.hidden = false;
  // 記帳頁：浮在鍵盤區上方，避免擋到數字鍵；其他頁用 CSS 預設位置（底部分頁上方）
  const panel = $('#view-add.active .add-panel');
  el.style.bottom = panel ? `${window.innerHeight - panel.getBoundingClientRect().top + 10}px` : '';
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

function onUser(user) {
  stopAll();
  state.user = user;
  state.profile = state.family = null;
  state.my = state.fam = state.txs = [];
  if (!user) { gate('login'); return; }
  gate('loading');
  state.ctx = { uid: user.uid, name: googleName(), familyId: null };

  unsub.profile = store.watchProfile(user.uid, (p, meta) => {
    if (!p) {
      // 快取沒有不代表雲端沒有；確定雲端也沒有才建立
      if (!meta.fromCache) save(store.createProfile(user.uid, { catTree: DEFAULT_TREE, cats: flatCats(DEFAULT_TREE), familyId: null, scope: 'me' }));
      return;
    }
    onProfile(p, meta);
  }, e => toast('讀取個人設定失敗：' + esc(errMsg(e))));

  unsub.my = store.watchTx('me', user.uid, list => { state.my = list; mergeTx(); }, e => toast('讀取個人帳失敗：' + esc(errMsg(e))));
}

function onProfile(p, meta) {
  const first = !state.profile;
  state.profile = p;
  state.ctx.name = (typeof p.nickname === 'string' && p.nickname.trim()) || googleName();
  const cats = Array.isArray(p.cats) ? p.cats.filter(c => typeof c === 'string') : flatCats(DEFAULT_TREE);
  let tree = Array.isArray(p.catTree) ? cleanTree(p.catTree) : treeFromCats(cats);
  // 舊版 App 只會改 cats：新增的分類補成主分類
  const known = new Set(flatCats(tree));
  tree = tree.concat(cats.filter(c => c && !known.has(c)).map(c => ({ name: c, subs: [] })));
  setTree(tree);
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

// ---------- 分類樹 ----------
function flatCats(tree) { return tree.flatMap(g => [g.name, ...g.subs]); }

// 從雲端讀到的資料不一定可靠：只留字串、去掉重複名稱
function cleanTree(raw) {
  const seen = new Set();
  const ok = n => typeof n === 'string' && n.trim() && !seen.has(n) && seen.add(n);
  const tree = [];
  for (const g of raw) {
    if (!g || !ok(g.name)) continue;
    tree.push({ name: g.name, subs: (Array.isArray(g.subs) ? g.subs : []).filter(ok) });
  }
  return tree;
}

// 只有平面 cats 的舊資料：依預設分組歸到主分類底下，對應不到的當主分類，保留原本順序
function treeFromCats(cats) {
  const def = new Map(DEFAULT_TREE.flatMap(g => g.subs.map(c => [c, g.name])));
  const tree = [], byName = new Map();
  const group = n => {
    if (!byName.has(n)) { const g = { name: n, subs: [] }; byName.set(n, g); tree.push(g); }
    return byName.get(n);
  };
  for (const c of [...new Set(cats)]) {
    const p = def.get(c);
    if (p && !byName.has(c)) group(p).subs.push(c);
    else group(c);
  }
  // v0.5 新增的預設子分類：舊帳號沒有的話補上
  for (const g of DEFAULT_TREE) for (const c of g.subs) {
    if (NEW_SUBS.includes(c) && !byName.has(c) && !tree.some(x => x.subs.includes(c))) group(g.name).subs.push(c);
  }
  // 預設的主分類照預設順序排前面，其他（自己加的、匯入產生的）照原本順序接在後面
  const rank = n => { const i = DEFAULT_TREE.findIndex(g => g.name === n); return i < 0 ? DEFAULT_TREE.length : i; };
  tree.sort((a, b) => rank(a.name) - rank(b.name));
  return cleanTree(tree);
}

function setTree(tree) {
  state.tree = tree;
  state.cats = flatCats(tree);
  state.parent = new Map(tree.flatMap(g => g.subs.map(c => [c, g.name])));
}

function parentOf(cat) { return state.parent.get(cat) || cat; }

function saveTree(tree) {
  setTree(tree);
  save(store.updateProfile(state.ctx.uid, { catTree: state.tree, cats: state.cats }));
}

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

  $('#add-hint').textContent = amt ? '點分類就儲存' : '輸入金額 → 點分類就儲存';
  $('#add-hint').classList.toggle('ready', amt > 0);
  // 有子分類的主分類自成一段（小標題＋主分類＋子分類）；沒有子分類的接在一起，用分隔線隔開
  const btn = c => `<button data-cat="${esc(c)}" ${amt ? '' : 'disabled'}>${catIcon(c)}<span>${esc(c)}</span></button>`;
  let grid = '', loose = false;
  for (const g of state.tree) {
    if (g.subs.length) {
      grid += `<h3 class="grid-head">${esc(g.name)}</h3>${btn(g.name)}${g.subs.map(btn).join('')}`;
      loose = false;
    } else {
      if (!loose && grid) grid += '<h3 class="grid-head"></h3>';
      grid += btn(g.name);
      loose = true;
    }
  }
  $('#cat-grid').innerHTML = grid;

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
    return `<button data-cat="${esc(c)}" data-amt="${a}">${catIcon(c, 'sm')}${esc(c)} <b>${money(Number(a))}</b></button>`;
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
  const who = t.by === state.ctx.uid ? '我' : nameOf(t);
  return `<span class="tag">家・${esc(who)}</span>`;
}

function emptyBox(text) {
  return `<div class="empty">${icon('note')}<p>${text}</p></div>`;
}

function renderList() {
  const txs = visibleTx().filter(t => monthOf(t.date) === state.month)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const total = txs.reduce((s, t) => s + t.amount, 0);
  $('#list-sum').innerHTML = `<small>本月支出</small><b>${money(total)}</b><small>${txs.length} 筆</small>`;
  if (!txs.length) { $('#list').innerHTML = emptyBox('這個月還沒有紀錄'); return; }
  const byDay = new Map();
  for (const t of txs) {
    if (!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date).push(t);
  }
  $('#list').innerHTML = [...byDay].map(([date, list]) => `
    <div class="day-head"><span>${dayTitle(date)}</span><span>${money(list.reduce((s, t) => s + t.amount, 0))}</span></div>
    <div class="card day">
      ${list.map(t => `
        <button class="row" data-id="${esc(t.id)}" data-scope="${t.scope}">
          ${catIcon(t.category)}
          <span class="row-main">
            <span class="row-cat">${esc(t.category)}</span>
            ${t.note || t.scope === 'family' ? `<span class="row-note">${whoTag(t)}${esc(t.note)}</span>` : ''}
          </span>
          <span class="row-amt">${money(t.amount)}</span>
        </button>`).join('')}
    </div>`).join('');
}

function findTx(id, scope) { return state.txs.find(x => x.id === id && x.scope === scope); }

function openEdit(id, scope) {
  const t = findTx(id, scope);
  if (!t) return;
  const f = $('#edit-form');
  const opt = c => `<option>${esc(c)}</option>`;
  f.category.innerHTML = state.tree.map(g => g.subs.length
    ? `<optgroup label="${esc(g.name)}">${opt(g.name)}${g.subs.map(opt).join('')}</optgroup>` : opt(g.name)).join('')
    + (state.cats.includes(t.category) ? '' : opt(t.category));
  f.amount.value = t.amount;
  f.category.value = t.category;
  f.date.value = t.date;
  f.note.value = t.note;
  // 只有自己記的才能在個人／家庭之間移動
  const canMove = hasFamily() && isMine(t);
  $('#edit-scope').hidden = !canMove;
  f.scope.value = t.scope;
  $('#edit-who').textContent = t.scope === 'family' && !isMine(t) ? `${nameOf(t)} 記的` : '';
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
  if (!isMine(t) && !confirm(`這筆是 ${nameOf(t)} 記的，刪除後無法復原。確定刪除？`)) return;
  dlg.close('delete');
  save(store.delTx(t, state.ctx));
  const msg = `已刪除：${esc(t.category)} ${money(t.amount)}`;
  if (isMine(t)) toast(msg, () => save(store.putTx(t, state.ctx)));
  else toast(msg);
}

// ---------- 報表 ----------
// 甜甜圈圖：前 5 名分類各一色，其餘合併成「其他」
const CHART_SLICES = 5;
function donut(rows, total) {
  const top = rows.slice(0, CHART_SLICES);
  const rest = rows.slice(CHART_SLICES).reduce((s, [, v]) => s + v, 0);
  const parts = top.map(([c, v], i) => ({ label: c, v, cls: 'c' + i }));
  if (rest) parts.push({ label: '其他分類', v: rest, cls: 'c9' });
  let off = 0;
  const arcs = parts.map(p => {
    const len = p.v / total * 100;
    // 每段留一點空隙（只有一段時不留）
    const gap = parts.length > 1 ? Math.min(0.6, len / 3) : 0;
    const el = `<circle class="${p.cls}" r="15.915" cx="21" cy="21" pathLength="100"
      stroke-dasharray="${(len - gap).toFixed(3)} ${(100 - len + gap).toFixed(3)}" stroke-dashoffset="${(-off).toFixed(3)}"/>`;
    off += len;
    return el;
  }).join('');
  const legend = parts.map(p => `<li><i class="${p.cls}"></i><span>${esc(p.label)}</span><b>${Math.round(p.v / total * 100)}%</b></li>`).join('');
  return { svg: `<svg class="donut" viewBox="0 0 42 42" aria-hidden="true"><g transform="rotate(-90 21 21)">${arcs}</g></svg>`, legend, colorOf: c => {
    const i = top.findIndex(([x]) => x === c);
    return i >= 0 ? 'c' + i : 'c9';
  } };
}

function renderReport() {
  const all = visibleTx();
  const txs = all.filter(t => monthOf(t.date) === state.month);
  const total = txs.reduce((s, t) => s + t.amount, 0);
  if (!txs.length) { $('#report').innerHTML = emptyBox('這個月還沒有紀錄'); return; }

  // 依主分類加總；展開時再看各子分類
  const sums = new Map(), subSums = new Map();
  for (const t of txs) {
    const p = parentOf(t.category);
    sums.set(p, (sums.get(p) || 0) + t.amount);
    if (!subSums.has(p)) subSums.set(p, new Map());
    const m = subSums.get(p);
    m.set(t.category, (m.get(t.category) || 0) + t.amount);
  }
  const rows = [...sums].sort((a, b) => b[1] - a[1]);
  const max = rows[0][1];

  // 日平均：本月算到今天，過去月份算整月
  const [y, m] = state.month.split('-').map(Number);
  const isThisMonth = state.month === monthOf(today());
  const days = isThisMonth ? new Date().getDate() : new Date(y, m, 0).getDate();
  const prev = all.filter(t => monthOf(t.date) === shiftMonth(state.month, -1)).reduce((s, t) => s + t.amount, 0);
  const diff = total - prev;
  const diffText = prev ? `比上月${diff >= 0 ? '多' : '少'} ${money(Math.abs(diff))}` : '上月沒有紀錄';

  // 家庭帳：各成員金額
  let people = '';
  if (hasFamily() && state.filter === 'family') {
    const byWho = new Map();
    for (const t of txs) {
      const who = t.by === state.ctx.uid ? '我' : nameOf(t);
      byWho.set(who, (byWho.get(who) || 0) + t.amount);
    }
    people = `<h2>誰記的</h2><div class="card"><ul class="bars">${[...byWho].sort((a, b) => b[1] - a[1]).map(([w, v]) => `
      <li><span class="cat-ic t0">${icon('user')}</span><div class="bar-body">
        <div class="bar-label"><span>${esc(w)} <small>${Math.round(v / total * 100)}%</small></span><b>${money(v)}</b></div>
        <div class="bar"><i style="width:${(v / total * 100).toFixed(1)}%"></i></div></div></li>`).join('')}</ul></div>`;
  }

  const d = donut(rows, total);
  $('#report').innerHTML = `
    <div class="card summary">
      <small>總支出 · ${txs.length} 筆</small>
      <div class="summary-total">${money(total)}</div>
      <div class="summary-sub"><span>日平均 <b>${money(Math.round(total / days))}</b></span><span>${diffText}</span></div>
    </div>
    <div class="card chart">
      <div class="donut-wrap">${d.svg}<div class="donut-center"><small>支出</small><b>${money(total)}</b></div></div>
      <ul class="legend">${d.legend}</ul>
    </div>
    ${people}
    <h2>分類排行</h2>
    <div class="card"><ul class="bars">
      ${rows.map(([c, v]) => {
        const subs = [...subSums.get(c)].sort((a, b) => b[1] - a[1]);
        const canOpen = subs.length > 1 || subs[0][0] !== c;
        const open = canOpen && state.open.has(c);
        const bar = (name, label, val, cls, extra = '') => `
          <li ${extra}>${catIcon(name)}<div class="bar-body">
            <div class="bar-label"><span>${label} <small>${Math.round(val / total * 100)}%</small></span><b>${money(val)}</b></div>
            <div class="bar"><i class="${cls}" style="width:${(val / max * 100).toFixed(1)}%"></i></div>
          </div></li>`;
        return bar(c, esc(c) + (canOpen ? `<span class="grp-toggle${open ? ' open' : ''}">${icon('chevron')}</span>` : ''), v, d.colorOf(c),
            canOpen ? `class="grp" data-grp="${esc(c)}" role="button" aria-expanded="${open}"` : '')
          + (open ? `<li class="sub-bars"><ul class="bars">${subs.map(([s, sv]) =>
              bar(s, s === c ? `${esc(s)}（未細分）` : esc(s), sv, d.colorOf(c))).join('')}</ul></li>` : '');
      }).join('')}
    </ul></div>`;
}

// ---------- 設定 ----------
function renderSettings() {
  $('#account').innerHTML = `${esc(state.ctx.name)}<small>${esc(state.user?.email || '')}</small>`;

  // 家庭
  const f = state.family;
  $('#family-none').hidden = !!f;
  $('#family-has').hidden = !f;
  if (f) {
    $('#family-name').textContent = f.name;
    $('#family-members').innerHTML = f.members
      .map(u => `<li>${esc(f.memberNames?.[u] || '成員')}${u === state.ctx.uid ? '<small>我</small>' : ''}</li>`).join('');
    $('#invite-code').textContent = f.inviteCode ? f.inviteCode.replace(/(.{4})/, '$1-') : '—';
  }
  $('#import-scope-row').hidden = !f;
  if (!f) $('#import-scope').value = 'me';

  // 子分類、沒有子分類的主分類：點名稱可以選「移到哪個主分類底下」
  const moveSel = (gi, si) => {
    const cur = si < 0 ? -1 : gi;
    const opts = [`<option value="-1" ${cur < 0 ? 'selected' : ''}>當主分類</option>`]
      .concat(state.tree.map((g, j) => j === gi && si < 0 ? '' : `<option value="${j}" ${j === cur ? 'selected' : ''}>放到「${esc(g.name)}」底下</option>`));
    return `<select data-gi="${gi}" data-si="${si}" aria-label="移動分類">${opts.join('')}</select>`;
  };
  const row = (name, gi, si, first, last, hasSubs) => `
    <li class="${si >= 0 ? 'sub' : ''}">
      ${catIcon(name)}
      ${hasSubs ? `<span class="cat-name">${esc(name)}</span>`
        : `<label class="cat-name movable">${esc(name)}${icon('folder', 'move-ic')}${moveSel(gi, si)}</label>`}
      ${si < 0 ? `<button data-act="addsub" data-gi="${gi}" data-si="-1" aria-label="新增子分類">${icon('plus')}</button>` : ''}
      <button data-act="up" data-gi="${gi}" data-si="${si}" ${first ? 'disabled' : ''} aria-label="上移">${icon('up')}</button>
      <button data-act="down" data-gi="${gi}" data-si="${si}" ${last ? 'disabled' : ''} aria-label="下移">${icon('down')}</button>
      <button data-act="rename" data-gi="${gi}" data-si="${si}" aria-label="改名">${icon('edit')}</button>
      <button data-act="del" data-gi="${gi}" data-si="${si}" class="danger" aria-label="刪除">${icon('trash')}</button>
    </li>`;
  $('#cat-list').innerHTML = state.tree.map((g, gi) =>
    row(g.name, gi, -1, gi === 0, gi === state.tree.length - 1, g.subs.length > 0)
    + g.subs.map((c, si) => row(c, gi, si, si === 0, si === g.subs.length - 1, false)).join('')).join('');
  $('#version').textContent = VERSION;
}

function cloneTree() { return state.tree.map(g => ({ name: g.name, subs: g.subs.slice() })); }

function askCatName(title, old = '') {
  const nn = (prompt(title, old) || '').trim().slice(0, 30);
  if (!nn || nn === old) return '';
  if (state.cats.includes(nn)) { alert('已有同名分類'); return ''; }
  return nn;
}

function onCatAction(act, gi, si) {
  const tree = cloneTree();
  const list = si < 0 ? tree : tree[gi].subs;
  const i = si < 0 ? gi : si;
  const name = si < 0 ? tree[gi].name : tree[gi].subs[si];
  if (act === 'up' || act === 'down') {
    const j = act === 'up' ? i - 1 : i + 1;
    [list[i], list[j]] = [list[j], list[i]];
  } else if (act === 'addsub') {
    const nn = askCatName(`在「${name}」底下新增子分類`);
    if (!nn) return;
    tree[gi].subs.push(nn);
  } else if (act === 'rename') {
    const nn = askCatName('新名稱', name);
    if (!nn) return;
    if (si < 0) tree[gi].name = nn; else tree[gi].subs[si] = nn;
    // 只改自己的紀錄（個人帳＋自己記的家庭帳），不動家人的
    const changed = state.txs.filter(t => t.category === name && isMine(t)).map(t => ({ ...t, category: nn }));
    if (changed.length) save(store.putMany(changed, state.ctx));
  } else if (act === 'del') {
    const used = state.txs.filter(t => t.category === name && isMine(t)).length;
    const subs = si < 0 ? tree[gi].subs : [];
    let msg = `確定刪除「${name}」？`;
    if (used) msg += `\n有 ${used} 筆紀錄，刪除分類後紀錄會保留原分類名稱。`;
    if (subs.length) msg += `\n底下的 ${subs.length} 個子分類（${subs.join('、')}）會變成主分類。`;
    if (!confirm(msg)) return;
    if (si < 0) tree.splice(gi, 1, ...subs.map(c => ({ name: c, subs: [] })));
    else tree[gi].subs.splice(si, 1);
  }
  saveTree(tree);
  renderAll();
}

// 移動：to = -1 當主分類，否則放到 tree[to] 底下
function onCatMove(gi, si, to) {
  const tree = cloneTree();
  let name;
  if (si < 0) {
    if (to < 0 || tree[gi].subs.length) return;
    name = tree[gi].name;
    tree.splice(gi, 1);
    if (to > gi) to--;
    tree[to].subs.push(name);
  } else {
    if (to === gi) return;
    name = tree[gi].subs.splice(si, 1)[0];
    if (to < 0) tree.splice(gi + 1, 0, { name, subs: [] });
    else tree[to].subs.push(name);
  }
  saveTree(tree);
  renderAll();
}

function onCatAdd() {
  const nn = askCatName('主分類名稱');
  if (!nn) return;
  saveTree([...cloneTree(), { name: nn, subs: [] }]);
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

function onMyRename(e) {
  const input = prompt('我的名字（家庭帳會顯示給家人看）。清空則改回 Google 帳號名稱', state.ctx.name);
  if (input === null) return;
  const name = input.trim().slice(0, 20);
  if (name === state.ctx.name) return;
  busy(e.currentTarget, async () => {
    await store.setMyName(state.ctx.uid, name, name || googleName(), state.family);
    toast('已更新名字');
  });
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
  if (head.includes('發票號碼') && head.includes('發票日期')) return importInvoices(head, rows, scope);
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

  await saveImported(list, where);
}

async function saveImported(list, where) {
  const newCats = [...new Set(list.map(t => t.category))].filter(c => !state.cats.includes(c));
  if (newCats.length) saveTree([...cloneTree(), ...newCats.map(c => ({ name: c, subs: [] }))]);
  toast(`匯入中…（${list.length} 筆）`);
  try {
    await store.putMany(list, state.ctx);
    toast(`已匯入 ${list.length} 筆到${where}`);
  } catch (err) {
    console.error(err);
    alert('匯入失敗：' + errMsg(err));
  }
}

// ---------- 電子發票（財政部電子發票整合服務平台「消費明細」CSV） ----------
// 每行是一個品項，折扣／優惠券／商品卡是負數的行；同一張發票加總成一筆。
// 店家 → 分類：依賣方名稱關鍵字，由上往下第一個符合的為準；都不符合歸「未分類」。
const STORE_RULES = [
  ['電信', /中華電信|台灣大哥大|遠傳|台灣之星|亞太電信|電信/],
  ['飲料', /星巴克|統一星巴克|路易莎|伯朗|清心|五十嵐|迷客夏|可不可|CoCo|茶湯會|大苑子|萬波|得正|麻古/i],
  ['餐飲', /統一超商|全家便利|萊爾富|來來超商|OK便利|麥當勞|肯德基|摩斯|漢堡王|頂呱呱|餐廳|餐飲|美食|小吃|便當|早餐/],
  ['日用品', /全聯|家樂福|好市多|大潤發|愛買|美廉社|屈臣氏|康是美|寶雅|小北百貨|生活工場|宜得利/],
  ['購物', /蝦皮|富邦媒體|網路家庭|博客來|酷澎|露天|東森得易購|優美加|百貨|三創|燦坤|全國電子|順發/],
  ['交通', /中油|台灣中油|台塑石化|全國加油|高速鐵路|台灣鐵路|臺灣鐵路|捷運|悠遊卡|一卡通|停車|客運|計程/],
  ['醫療', /醫院|診所|藥局|藥房|大樹|杏一|丁丁|躍獅|長庚|牙醫/],
  ['水電', /台灣電力|台灣自來水|臺北自來水|自來水|瓦斯|天然氣/],
  ['娛樂', /威秀|國賓影城|秀泰|新光影城|錢櫃|好樂迪/],
];

function storeCategory(seller) {
  const hit = STORE_RULES.find(([, re]) => re.test(seller));
  return hit ? hit[0] : '未分類';
}

// 「統一超商股份有限公司台北市第五十四門市」→「統一超商」
function shortSeller(name) {
  // 外商開頭「新加坡商蝦皮…」也去掉國名
  return name.replace(/(股份)?有限公司.*$/, '').replace(/^(新加坡|香港|英屬維京群島|英屬蓋曼群島|開曼群島|薩摩亞|美|日|韓|英|德|法|荷蘭|瑞士|盧森堡)商/, '').trim() || name;
}

async function importInvoices(head, rows, scope) {
  const col = n => head.indexOf(n);
  const c = { date: col('發票日期'), no: col('發票號碼'), status: col('發票狀態'), seller: col('賣方名稱'),
              amt: col('消費明細_金額'), invAmt: col('發票金額'), item: col('消費明細_品名') };
  if (c.seller < 0 || (c.amt < 0 && c.invAmt < 0)) { alert('電子發票 CSV 缺少「賣方名稱」或金額欄位'); return; }

  const invs = new Map();
  for (const r of rows) {
    const no = (r[c.no] || '').trim();
    const d = (r[c.date] || '').trim();
    if (!no || !/^\d{8}$/.test(d)) continue; // 檔尾的說明文字
    if (c.status >= 0 && /作廢/.test(r[c.status] || '')) continue;
    const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const key = `inv-${d}-${no}`.replace(/\//g, '_');
    let inv = invs.get(key);
    if (!inv) invs.set(key, inv = { id: key, date, seller: (r[c.seller] || '').trim(), total: 0, items: [] });
    const amt = Number(r[c.amt >= 0 ? c.amt : c.invAmt]);
    if (Number.isFinite(amt)) inv.total += amt;
    const name = c.item >= 0 ? (r[c.item] || '').trim() : '';
    if (name && amt > 0) inv.items.push(name);
  }

  const existing = new Set(state.txs.filter(t => t.scope === scope).map(t => t.id));
  const list = [];
  let skipped = 0, bad = 0, i = 0;
  for (const inv of invs.values()) {
    const amount = Math.round(inv.total);
    if (!(amount > 0 && amount < 1e8)) { bad++; continue; } // 加總 ≤ 0（退貨、全額折抵）
    if (existing.has(inv.id)) { skipped++; continue; }      // 已匯入過：不覆蓋，保留手動改過的分類
    const shop = shortSeller(inv.seller);
    const t = {
      id: inv.id, scope, date: inv.date, amount,
      category: storeCategory(inv.seller),
      note: (inv.items.length ? `${shop}：${inv.items.join('、')}` : shop).slice(0, 500),
      createdAt: Date.now() + i++,
    };
    if (scope === 'family') { t.by = state.ctx.uid; t.byName = state.ctx.name; }
    list.push(t);
  }

  const where = scope === 'family' ? '家庭帳' : '個人帳';
  const extra = [skipped && `${skipped} 張已匯入過`, bad && `${bad} 張金額 ≤ 0`].filter(Boolean).join('、');
  if (!list.length) { alert(`沒有可匯入的發票${extra ? `（略過：${extra}）` : ''}`); return; }
  const unc = list.filter(t => t.category === '未分類').length;
  if (!confirm(`電子發票：將匯入 ${list.length} 張到「${where}」，一張發票記一筆（折扣、商品卡已扣除）`
    + `${unc ? `，其中 ${unc} 張歸「未分類」` : ''}${extra ? `；略過 ${extra}` : ''}。繼續？`)) return;
  await saveImported(list, where);
}

// ---------- 導覽 ----------
function show(view) {
  $('#toast').style.bottom = ''; // 換頁後提示回到預設位置
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
  $('#keypad').addEventListener('click', e => { const k = e.target.closest('button')?.dataset.k; if (k) onKey(k); });
  $('#scope').addEventListener('click', e => { const s = e.target.dataset.s; if (s) setScope(s); });
  $('#cat-grid').addEventListener('click', e => {
    const c = e.target.closest('button')?.dataset.cat;
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
  $('#cat-list').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) onCatAction(b.dataset.act, Number(b.dataset.gi), Number(b.dataset.si));
  });
  $('#cat-list').addEventListener('change', e => {
    const sel = e.target.closest('select');
    if (sel) onCatMove(Number(sel.dataset.gi), Number(sel.dataset.si), Number(sel.value));
  });
  $('#report').addEventListener('click', e => {
    const g = e.target.closest('[data-grp]')?.dataset.grp;
    if (!g) return;
    if (state.open.has(g)) state.open.delete(g); else state.open.add(g);
    renderReport();
  });
  $('#cat-add').addEventListener('click', onCatAdd);
  $('#family-create').addEventListener('click', onFamilyCreate);
  $('#family-join').addEventListener('click', onFamilyJoin);
  $('#family-rename').addEventListener('click', onFamilyRename);
  $('#my-rename').addEventListener('click', onMyRename);
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
  $$('[data-ic]').forEach(el => { el.innerHTML = icon(el.dataset.ic); });
  $('#add-date').value = today();
  bind();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js');
  }
  if (!firebaseConfig) { gate('setup'); return; }
  gate('loading');
  // 不等整頁跳轉登入的結果（要連網才會回來），否則離線時 App 會卡在載入中
  const redirect = store.init(firebaseConfig);
  store.onUser(user => onUser(user));
  redirect.then(err => {
    if (err && !state.user) $('#gate-msg').textContent = '登入失敗：' + errMsg(err);
  });
}

init();
