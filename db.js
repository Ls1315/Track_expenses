// IndexedDB 薄封裝：tx 存交易，meta 存設定（分類等）
const DB_NAME = 'ledger';
const VERSION = 1;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const s = db.createObjectStore('tx', { keyPath: 'id' });
      s.createIndex('date', 'date');
      db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    let result;
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  all: () => run('tx', 'readonly', s => s.getAll()),
  put: tx => run('tx', 'readwrite', s => s.put(tx)),
  putMany: list => run('tx', 'readwrite', s => { list.forEach(t => s.put(t)); }),
  del: id => run('tx', 'readwrite', s => s.delete(id)),
  getMeta: key => run('meta', 'readonly', s => s.get(key)),
  setMeta: (key, val) => run('meta', 'readwrite', s => s.put(val, key)),
};
