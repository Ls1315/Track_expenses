import { db } from './db.js';

const VERSION = '0.1.0';
const DEFAULT_CATS = ['早餐', '午餐', '晚餐', '飲料', '零食', '交通', '日用品', '購物', '娛樂', '醫療', '房租', '水電', '電信', '其他'];

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

const state = {
  txs: [],
  cats: [],
  amount: '',          // 鍵盤輸入的數字字串
  month: monthOf(today()), // 明細／報表目前看的月份 'YYYY-MM'
};

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
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function dayLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${m}/${d}（${WEEK[new Date(y, m - 1, d).getDay()]}）`;
}

let toastTimer;
function toast(html, onAction) {
  const el = $('#toast');
  el.innerHTML = html + (onAction ? ' <button>復原</button>' : '');
  el.hidden = false;
  if (onAction) el.querySelector('button').onclick = () => { el.hidden = true; onAction(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

// ---------- 資料 ----------
async function load() {
  state.txs = await db.all();
  state.cats = (await db.getMeta('categories')) || DEFAULT_CATS.slice();
}
async function saveCats() { await db.setMeta('categories', state.cats); }

async function addTx(category, amount) {
  const tx = {
    id: uid(),
    amount,
    category,
    date: $('#add-date').value || today(),
    note: $('#add-note').value.trim(),
    createdAt: Date.now(),
  };
  await db.put(tx);
  state.txs.push(tx);
  state.amount = '';
  $('#add-note').value = '';
  renderAll();
  toast(`已記：${esc(category)} ${money(amount)}`, async () => {
    await db.del(tx.id);
    state.txs = state.txs.filter(t => t.id !== tx.id);
    renderAll();
  });
}

// ---------- 記帳畫面 ----------
function renderAdd() {
  const amt = Number(state.amount || 0);
  $('#amount').textContent = money(amt);
  $('#amount').classList.toggle('zero', amt === 0);

  $('#cat-grid').innerHTML = state.cats
    .map(c => `<button data-cat="${esc(c)}" ${amt ? '' : 'disabled'}>${esc(c)}</button>`).join('');

  // 常用組合：近 90 天出現 ≥2 次的（分類, 金額），取前 6
  const since = Date.now() - 90 * 864e5;
  const count = new Map();
  for (const t of state.txs) {
    if (t.createdAt < since || !state.cats.includes(t.category)) continue;
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

// ---------- 明細 ----------
function renderList() {
  const txs = state.txs.filter(t => monthOf(t.date) === state.month)
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
        <button class="row" data-id="${t.id}">
          <span class="row-cat">${esc(t.category)}</span>
          <span class="row-note">${esc(t.note)}</span>
          <span class="row-amt">${money(t.amount)}</span>
        </button>`).join('')}
    </div>`).join('');
}

function openEdit(id) {
  const t = state.txs.find(x => x.id === id);
  if (!t) return;
  const f = $('#edit-form');
  const cats = state.cats.includes(t.category) ? state.cats : [...state.cats, t.category];
  f.category.innerHTML = cats.map(c => `<option>${esc(c)}</option>`).join('');
  f.amount.value = t.amount;
  f.category.value = t.category;
  f.date.value = t.date;
  f.note.value = t.note;
  const dlg = $('#edit');
  dlg.dataset.id = id;
  dlg.showModal();
}

async function onEditClose() {
  const dlg = $('#edit');
  if (dlg.returnValue !== 'save') return;
  const f = $('#edit-form');
  const t = state.txs.find(x => x.id === dlg.dataset.id);
  const amount = Math.round(Number(f.amount.value));
  if (!t || !(amount > 0)) return;
  Object.assign(t, { amount, category: f.category.value, date: f.date.value, note: f.note.value.trim() });
  await db.put(t);
  renderAll();
}

async function onEditDelete() {
  const dlg = $('#edit');
  const t = state.txs.find(x => x.id === dlg.dataset.id);
  dlg.close();
  if (!t) return;
  await db.del(t.id);
  state.txs = state.txs.filter(x => x.id !== t.id);
  renderAll();
  toast(`已刪除：${esc(t.category)} ${money(t.amount)}`, async () => {
    await db.put(t);
    state.txs.push(t);
    renderAll();
  });
}

// ---------- 報表 ----------
function renderReport() {
  const txs = state.txs.filter(t => monthOf(t.date) === state.month);
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
  const prev = state.txs.filter(t => monthOf(t.date) === shiftMonth(state.month, -1)).reduce((s, t) => s + t.amount, 0);

  $('#report').innerHTML = `
    <div class="stats">
      <div><small>總支出</small><b>${money(total)}</b></div>
      <div><small>日平均</small><b>${money(Math.round(total / days))}</b></div>
      <div><small>上月</small><b>${money(prev)}</b></div>
    </div>
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
  if (act === 'up' || act === 'down') {
    const j = act === 'up' ? i - 1 : i + 1;
    [state.cats[i], state.cats[j]] = [state.cats[j], state.cats[i]];
  } else if (act === 'rename') {
    const nn = (prompt('新名稱', name) || '').trim();
    if (!nn || nn === name) return;
    if (state.cats.includes(nn)) { alert('已有同名分類'); return; }
    state.cats[i] = nn;
    const changed = state.txs.filter(t => t.category === name);
    changed.forEach(t => { t.category = nn; });
    await db.putMany(changed);
  } else if (act === 'del') {
    const used = state.txs.filter(t => t.category === name).length;
    const msg = used ? `「${name}」有 ${used} 筆紀錄，刪除分類後紀錄會保留原分類名稱。確定刪除？` : `確定刪除「${name}」？`;
    if (!confirm(msg)) return;
    state.cats.splice(i, 1);
  }
  await saveCats();
  renderAll();
}

async function onCatAdd() {
  const nn = (prompt('分類名稱') || '').trim();
  if (!nn) return;
  if (state.cats.includes(nn)) { alert('已有同名分類'); return; }
  state.cats.push(nn);
  await saveCats();
  renderAll();
}

// ---------- CSV ----------
const CSV_COLS = ['id', 'date', 'amount', 'category', 'note', 'createdAt'];

function toCSV(txs) {
  const cell = v => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [CSV_COLS.join(',')];
  [...txs].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
    .forEach(t => lines.push(CSV_COLS.map(c => cell(t[c])).join(',')));
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
  const file = new File([toCSV(state.txs)], name, { type: 'text/csv' });
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
  const rows = parseCSV(await f.text());
  const head = rows.shift() || [];
  const idx = Object.fromEntries(CSV_COLS.map(c => [c, head.indexOf(c)]));
  if (idx.date < 0 || idx.amount < 0 || idx.category < 0) { alert('CSV 格式不符：至少需要 date、amount、category 欄位'); return; }

  const existing = new Map(state.txs.map(t => [t.id, t]));
  const list = [];
  let bad = 0;
  for (const r of rows) {
    const amount = Math.round(Number(r[idx.amount]));
    const date = r[idx.date];
    const category = (r[idx.category] || '').trim();
    if (!(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !category) { bad++; continue; }
    list.push({
      id: (idx.id >= 0 && r[idx.id]) || uid(),
      date, amount, category,
      note: idx.note >= 0 ? r[idx.note] || '' : '',
      createdAt: idx.createdAt >= 0 && Number(r[idx.createdAt]) || Date.now(),
    });
  }
  const added = list.filter(t => !existing.has(t.id)).length;
  if (!confirm(`將匯入 ${list.length} 筆（新增 ${added}、覆蓋同 id ${list.length - added}）${bad ? `，略過 ${bad} 筆格式錯誤` : ''}。繼續？`)) return;
  await db.putMany(list);
  for (const t of list) existing.set(t.id, t);
  state.txs = [...existing.values()];
  const newCats = [...new Set(list.map(t => t.category))].filter(c => !state.cats.includes(c));
  if (newCats.length) { state.cats.push(...newCats); await saveCats(); }
  renderAll();
  toast(`已匯入 ${list.length} 筆`);
}

async function renderPersist() {
  const el = $('#persist-status');
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  let msg = standalone ? '目前以主畫面 App 開啟。' : '⚠️ 目前在瀏覽器中開啟，資料可能被系統清除。請用「分享 → 加入主畫面」安裝後再使用。';
  if (navigator.storage && navigator.storage.persisted) {
    let p = await navigator.storage.persisted();
    if (!p && navigator.storage.persist) p = await navigator.storage.persist();
    msg += p ? ' 已取得永久儲存權限。' : '';
  }
  el.textContent = msg;
}

// ---------- 導覽 ----------
function show(view) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'add') $('#add-date').value = $('#add-date').value || today();
}

function renderAll() {
  const [y, m] = state.month.split('-');
  $$('.month-label').forEach(el => { el.textContent = `${y} 年 ${Number(m)} 月`; });
  renderAdd();
  renderList();
  renderReport();
  renderSettings();
}

function bind() {
  $$('.tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
  $('#keypad').addEventListener('click', e => { const k = e.target.dataset.k; if (k) onKey(k); });
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
  $('#list').addEventListener('click', e => { const r = e.target.closest('.row'); if (r) openEdit(r.dataset.id); });
  $('#edit').addEventListener('close', onEditClose);
  $('#edit-delete').addEventListener('click', onEditDelete);
  $('#cat-list').addEventListener('click', e => { const b = e.target.closest('button'); if (b) onCatAction(b.dataset.act, Number(b.dataset.i)); });
  $('#cat-add').addEventListener('click', onCatAdd);
  $('#export').addEventListener('click', onExport);
  $('#import').addEventListener('change', onImport);
  // 跨日後重新打開 App 時，日期回到今天
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.amount === '') $('#add-date').value = today();
  });
}

async function init() {
  await load();
  $('#add-date').value = today();
  bind();
  renderAll();
  renderPersist();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js');
  }
}

init();
