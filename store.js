// Firebase 資料層：登入、個人帳／家庭帳的讀寫、家庭建立與邀請碼
//
// Firestore 結構
//   users/{uid}                 { cats: [...], familyId: string|null, scope: 'me'|'family' }   只有本人能讀寫
//   users/{uid}/tx/{id}         個人帳的交易                                                     只有本人能讀寫
//   families/{fid}              { name, members: [uid], memberNames: {uid: 名稱}, inviteCode, joinedWith, createdAt }
//   families/{fid}/tx/{id}      家庭帳的交易（多 by、byName 記錄是誰記的）                        只有成員能讀寫
//   invites/{code}              { familyId }  邀請碼 → 家庭；登入者知道碼才能讀單筆，不能列出
import { initializeApp } from './vendor/firebase/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut, connectAuthEmulator,
} from './vendor/firebase/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache,
  doc, collection, onSnapshot, setDoc, updateDoc, deleteDoc, getDoc, writeBatch,
  arrayUnion, arrayRemove, deleteField, connectFirestoreEmulator,
} from './vendor/firebase/firebase-firestore.js';

const TX_FIELDS = ['amount', 'category', 'date', 'note', 'createdAt'];
const BATCH_MAX = 450; // Firestore 一個 batch 上限 500 個寫入，留點餘裕

let app, auth, fs;

export function init(config) {
  app = initializeApp(config);
  auth = getAuth(app);
  let localCache;
  try {
    // 離線快取：沒網路也能看、能記，連上線後自動同步
    localCache = persistentLocalCache({ tabManager: persistentMultipleTabManager() });
  } catch (e) {
    localCache = memoryLocalCache();
  }
  fs = initializeFirestore(app, { localCache });
  // 只給自動測試用：設定裡有 emulator 時連到本機模擬器（正式設定不會有這個欄位）
  if (config.emulator) {
    connectAuthEmulator(auth, `http://${config.emulator.auth}`, { disableWarnings: true });
    const [host, port] = config.emulator.firestore.split(':');
    connectFirestoreEmulator(fs, host, Number(port));
  }
  // 用 redirect 登入回來時，把錯誤丟出來讓畫面顯示
  return getRedirectResult(auth).then(() => null, e => e);
}

// ---------- 登入 ----------
export function onUser(cb) { return onAuthStateChanged(auth, cb); }

export async function login() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // 有些環境（例如 iOS 主畫面 App）開不了彈出視窗，改用整頁跳轉
    const fallback = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'];
    if (fallback.includes(e.code)) await signInWithRedirect(auth, provider);
    else throw e;
  }
}

export function logout() { return signOut(auth); }

// ---------- 監聽 ----------
// 回傳取消監聽的函式。cb(資料) ；onErr(錯誤)
// cb(資料或 null, metadata)。metadata.fromCache：快取裡沒有不代表雲端沒有，不要因此覆蓋；
// metadata.hasPendingWrites：本機改了但伺服器還沒確認（例如剛加入家庭）
export function watchProfile(uid, cb, onErr) {
  return onSnapshot(doc(fs, 'users', uid), { includeMetadataChanges: true },
    s => cb(s.exists() ? s.data() : null, s.metadata), onErr);
}
export function watchFamily(fid, cb, onErr) {
  return onSnapshot(doc(fs, 'families', fid), s => cb(s.exists() ? { id: s.id, ...s.data() } : null), onErr);
}
export function watchTx(scope, ownerId, cb, onErr) {
  return onSnapshot(txCol(scope, ownerId), snap => {
    cb(snap.docs.map(d => ({ ...d.data(), id: d.id, scope })));
  }, onErr);
}

function txCol(scope, ownerId) {
  return scope === 'family' ? collection(fs, 'families', ownerId, 'tx') : collection(fs, 'users', ownerId, 'tx');
}

// ---------- 個人設定 ----------
export function createProfile(uid, data) { return setDoc(doc(fs, 'users', uid), data); }
export function updateProfile(uid, data) { return updateDoc(doc(fs, 'users', uid), data); }

// ---------- 交易 ----------
// ctx = { uid, name, familyId }
function txData(t, ctx) {
  const d = Object.fromEntries(TX_FIELDS.map(k => [k, t[k]]));
  if (t.scope === 'family') { d.by = t.by || ctx.uid; d.byName = t.byName || ctx.name; }
  return d;
}
function txRef(t, ctx) {
  return doc(txCol(t.scope, t.scope === 'family' ? ctx.familyId : ctx.uid), t.id);
}

// 注意：離線時寫入的 Promise 要等連上線、伺服器確認後才會完成，畫面不要等它
export function putTx(t, ctx) { return setDoc(txRef(t, ctx), txData(t, ctx)); }
export function delTx(t, ctx) { return deleteDoc(txRef(t, ctx)); }

// 換帳本（個人 ↔ 家庭）：刪舊的、建新的，同一個 id
export function moveTx(oldT, newT, ctx) {
  const b = writeBatch(fs);
  b.delete(txRef(oldT, ctx));
  b.set(txRef(newT, ctx), txData(newT, ctx));
  return b.commit();
}

export async function putMany(list, ctx) {
  for (let i = 0; i < list.length; i += BATCH_MAX) {
    const b = writeBatch(fs);
    list.slice(i, i + BATCH_MAX).forEach(t => b.set(txRef(t, ctx), txData(t, ctx)));
    await b.commit();
  }
}

// ---------- 家庭 ----------
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉容易看錯的 I O 0 1
export function newCode() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return [...a].map(n => CODE_CHARS[n % CODE_CHARS.length]).join('');
}
export function normalizeCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

export async function createFamily(name, ctx) {
  const fref = doc(collection(fs, 'families'));
  const code = newCode();
  const b = writeBatch(fs);
  b.set(fref, {
    name, members: [ctx.uid], memberNames: { [ctx.uid]: ctx.name },
    inviteCode: code, joinedWith: '', createdAt: Date.now(),
  });
  b.set(doc(fs, 'invites', code), { familyId: fref.id });
  b.update(doc(fs, 'users', ctx.uid), { familyId: fref.id });
  await b.commit();
  return fref.id;
}

// 加入家庭需要連網（要先查邀請碼對應哪個家庭）
export async function joinFamily(code, ctx) {
  code = normalizeCode(code);
  if (code.length !== 8) throw new Error('邀請碼是 8 個英數字');
  const inv = await getDoc(doc(fs, 'invites', code));
  if (!inv.exists()) throw new Error('找不到這個邀請碼，可能已更換或輸入錯誤');
  const fid = inv.data().familyId;
  const b = writeBatch(fs);
  b.update(doc(fs, 'families', fid), {
    members: arrayUnion(ctx.uid),
    [`memberNames.${ctx.uid}`]: ctx.name,
    joinedWith: code,
  });
  b.update(doc(fs, 'users', ctx.uid), { familyId: fid });
  await b.commit();
  return fid;
}

export async function rotateCode(family) {
  const code = newCode();
  const b = writeBatch(fs);
  if (family.inviteCode) b.delete(doc(fs, 'invites', family.inviteCode));
  b.set(doc(fs, 'invites', code), { familyId: family.id });
  b.update(doc(fs, 'families', family.id), { inviteCode: code });
  await b.commit();
  return code;
}

export function renameFamily(family, name) { return updateDoc(doc(fs, 'families', family.id), { name }); }

export async function leaveFamily(family, ctx) {
  const b = writeBatch(fs);
  b.update(doc(fs, 'families', family.id), {
    members: arrayRemove(ctx.uid),
    [`memberNames.${ctx.uid}`]: deleteField(),
  });
  // 最後一位成員離開時讓邀請碼失效，避免別人用舊碼加入、看到舊的家庭帳
  if (family.members.length === 1 && family.inviteCode) b.delete(doc(fs, 'invites', family.inviteCode));
  b.update(doc(fs, 'users', ctx.uid), { familyId: null, scope: 'me' });
  await b.commit();
}
