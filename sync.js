/**
 * 盐湖记 · 离线同步模块
 * 在网络不可用时将操作入队，恢复后自动推送
 */

const SYNC_STORE = 'sync_queue';
let _syncRunning = false;

/* ─── 初始化同步队列 Object Store ───────────────────────────────── */

function initSyncStore() {
  return openDB().then(db => {
    if (!db.objectStoreNames.contains(SYNC_STORE)) {
      db.close();
      // Need to upgrade — close and reopen with higher version
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION + 1);
        req.onupgradeneeded = (ev) => {
          const d = ev.target.result;
          if (!d.objectStoreNames.contains(SYNC_STORE)) {
            const store = d.createObjectStore(SYNC_STORE, { keyPath: 'id', autoIncrement: true });
            store.createIndex('created', 'created', { unique: false });
          }
        };
        req.onsuccess = (ev) => { _db = ev.target.result; resolve(); };
        req.onerror = () => reject(req.error);
      });
    }
  });
}

/* ─── 入队 ──────────────────────────────────────────────────────── */

/**
 * 将离线操作加入同步队列
 * @param {'observation'|'sound'|'profile'} type
 * @param {string} action - 'insert' | 'update'
 * @param {object} payload
 */
function enqueueSync(type, action, payload) {
  return initSyncStore().then(() => {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(SYNC_STORE, 'readwrite');
      const store = tx.objectStore(SYNC_STORE);
      const req = store.put({
        type, action, payload,
        created: Date.now(),
        retries: 0
      });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

/* ─── 同步处理器 ────────────────────────────────────────────────── */

async function processSyncQueue() {
  if (_syncRunning) return;
  _syncRunning = true;

  try {
    const items = await getQueueItems();
    if (items.length === 0) { _syncRunning = false; return; }

    console.log(`🔄 Syncing ${items.length} offline items...`);

    for (const item of items) {
      try {
        await processItem(item);
        await removeQueueItem(item.id);
      } catch (e) {
        console.warn(`Sync failed for item ${item.id}:`, e.message);
        await incrementRetry(item.id);
        // If too many retries, skip
        if (item.retries >= 10) {
          console.warn(`Giving up on item ${item.id} after ${item.retries} retries`);
          await removeQueueItem(item.id);
        }
        break; // Stop processing on first failure (network may still be down)
      }
    }

    const remaining = await getQueueCount();
    if (remaining === 0) {
      console.log('✅ Sync complete');
      window.dispatchEvent(new CustomEvent('sync-complete'));
    }
  } finally {
    _syncRunning = false;
  }
}

async function processItem(item) {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase not initialized');

  switch (item.type) {
    case 'observation': {
      const { error } = await supabase.from('observations').insert(item.payload);
      if (error) throw error;
      // Also cache locally
      if (window._cacheObservation) window._cacheObservation(item.payload);
      break;
    }
    case 'sound': {
      const { error } = await supabase.from('sounds').insert(item.payload);
      if (error) throw error;
      break;
    }
    case 'profile': {
      const { error } = await supabase.from('profiles').upsert(item.payload);
      if (error) throw error;
      break;
    }
    default:
      console.warn('Unknown sync item type:', item.type);
  }
}

/* ─── 队列操作 ──────────────────────────────────────────────────── */

function getQueueItems() {
  return initSyncStore().then(() => {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(SYNC_STORE, 'readonly');
      const req = tx.objectStore(SYNC_STORE).getAll();
      req.onsuccess = () => {
        resolve(req.result.sort((a, b) => a.created - b.created));
      };
      req.onerror = () => reject(req.error);
    });
  });
}

function getQueueCount() {
  return initSyncStore().then(() => {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(SYNC_STORE, 'readonly');
      const req = tx.objectStore(SYNC_STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

function removeQueueItem(id) {
  return initSyncStore().then(() => {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(SYNC_STORE, 'readwrite');
      const req = tx.objectStore(SYNC_STORE).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

function incrementRetry(id) {
  return initSyncStore().then(() => {
    return new Promise((resolve, reject) => {
      const tx = _db.transaction(SYNC_STORE, 'readwrite');
      const store = tx.objectStore(SYNC_STORE);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (item) {
          item.retries = (item.retries || 0) + 1;
          store.put(item).onsuccess = () => resolve();
        } else {
          resolve();
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  });
}

/* ─── 网络事件监听 ───────────────────────────────────────────────── */

let _listenersRegistered = false;

function registerSyncListeners() {
  if (_listenersRegistered) return;
  _listenersRegistered = true;

  window.addEventListener('online', () => {
    console.log('🌐 Online — processing sync queue');
    updateOnlineStatus(true);
    processSyncQueue();
  });

  window.addEventListener('offline', () => {
    console.log('📴 Offline — will queue changes locally');
    updateOnlineStatus(false);
  });

  // Initial sync on load if online
  if (navigator.onLine) {
    getQueueCount().then(count => {
      if (count > 0) {
        console.log(`Found ${count} pending sync items, processing...`);
        processSyncQueue();
      }
    });
  }
}

function updateOnlineStatus(online) {
  const indicator = document.getElementById('syncIndicator');
  if (!indicator) return;
  if (online) {
    indicator.innerHTML = '<span style="color:var(--success);" title="在线">●</span>';
    indicator.title = '在线 — 数据自动同步';
  } else {
    indicator.innerHTML = '<span style="color:var(--warn);" title="离线">○</span>';
    indicator.title = '离线 — 数据将暂存本地';
  }
}
