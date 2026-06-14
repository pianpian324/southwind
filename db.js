/**
 * 盐湖记 · IndexedDB 数据层
 * 离线优先设计，所有数据本地持久化
 */
const DB_NAME = 'southwind';
const DB_VERSION = 1;

let _db = null;

/** 打开数据库连接 */
function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains('observations')) {
        const obs = db.createObjectStore('observations', { keyPath: 'id' });
        obs.createIndex('timestamp', 'timestamp', { unique: false });
        obs.createIndex('habitat', 'habitat', { unique: false });
        obs.createIndex('synced', 'synced', { unique: false });
      }
      if (!db.objectStoreNames.contains('species')) {
        const sp = db.createObjectStore('species', { keyPath: 'id' });
        sp.createIndex('category', 'category', { unique: false });
      }
      if (!db.objectStoreNames.contains('tasks')) {
        db.createObjectStore('tasks', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sounds')) {
        const sd = db.createObjectStore('sounds', { keyPath: 'id' });
        sd.createIndex('timestamp', 'timestamp', { unique: false });
        sd.createIndex('habitat', 'habitat', { unique: false });
      }
      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { keyPath: 'key' });
      }
    };
    req.onsuccess = (ev) => { _db = ev.target.result; resolve(_db); };
    req.onerror = (ev) => { reject(ev.target.error); };
  });
}

function getAll(store) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function getByKey(store, key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function put(store, value) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function getByIndex(store, index, value) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).index(index).getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

/* ─── 观测记录 ─────────────────────────────────────────────────── */

function saveObservation(obs) {
  obs.id = obs.id || 'obs_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  obs.timestamp = obs.timestamp || Date.now();
  obs.synced = obs.synced !== undefined ? obs.synced : false;
  return put('observations', obs);
}

function getObservations() {
  return getAll('observations').then(list => list.sort((a,b) => b.timestamp - a.timestamp));
}

function getObservationsByHabitat(habitat) {
  return getByIndex('observations', 'habitat', habitat);
}

function getUnsyncedObservations() {
  return getByIndex('observations', 'synced', false);
}

/* ─── 物种库 ───────────────────────────────────────────────────── */

const DEFAULT_SPECIES = [
  { id:'sp_1', name:'大红鹳（火烈鸟）', category:'鸟类', habitat:['盐湖核心区','人工水域'],
    desc:'每年10月下旬抵达运城盐湖，停留至次年4月。以卤虫为食，体羽呈朱红色。',
    season:'秋冬', rarity:'common', emoji:'🦩', similar:['白琵鹭'], tags:['候鸟','旗舰种'] },
  { id:'sp_2', name:'盐地碱蓬', category:'维管束植物', habitat:['盐生草甸','盐湖核心区'],
    desc:'一年生草本，耐盐碱。秋季叶片变红，形成"红海滩"景观。是盐湖生态指示物种。',
    season:'夏秋', rarity:'common', emoji:'🌿', similar:['盐角草'], tags:['指示物种','耐盐'] },
  { id:'sp_3', name:'卤虫（丰年虾）', category:'浮游动物', habitat:['盐湖核心区'],
    desc:'盐湖关键物种，高盐度水体中大量繁殖。是火烈鸟的主要食物来源。',
    season:'春夏', rarity:'common', emoji:'🦐', similar:[], tags:['关键种','饵料生物'] },
  { id:'sp_4', name:'黑鹳', category:'鸟类', habitat:['中条山麓','人工水域'],
    desc:'国家一级保护动物，体长约1米。在运城盐湖周边有稳定越冬种群。',
    season:'秋冬', rarity:'rare', emoji:'🦅', similar:['白鹳'], tags:['保护动物','候鸟'] },
  { id:'sp_5', name:'盐角草', category:'维管束植物', habitat:['盐生草甸','盐湖核心区'],
    desc:'肉质茎叶，高度耐盐。与盐地碱蓬相似但茎节明显，秋季变红较晚。',
    season:'夏秋', rarity:'common', emoji:'🌱', similar:['盐地碱蓬'], tags:['耐盐','肉质植物'] },
  { id:'sp_6', name:'白琵鹭', category:'鸟类', habitat:['芦苇湿地','人工水域'],
    desc:'大型涉禽，嘴长而扁平呈匙状。在运城盐湖湿地常见，以小鱼虾为食。',
    season:'春秋', rarity:'uncommon', emoji:'🕊', similar:['大红鹳'], tags:['涉禽','候鸟'] },
  { id:'sp_7', name:'短耳鸮', category:'鸟类', habitat:['盐生草甸','街道绿化带'],
    desc:'中型猫头鹰，白天活动。在盐湖周边草甸和农田边缘常见。',
    season:'全年', rarity:'uncommon', emoji:'🦉', similar:['长耳鸮'], tags:['猛禽'] },
  { id:'sp_8', name:'芦苇', category:'维管束植物', habitat:['芦苇湿地','人工水域'],
    desc:'多年生禾草，是盐湖湿地的主要建群种。为多种鸟类提供栖息和筑巢场所。',
    season:'全年', rarity:'common', emoji:'🎋', similar:[], tags:['建群种','湿地植物'] },
  { id:'sp_9', name:'白尾海雕', category:'鸟类', habitat:['盐湖核心区','中条山麓'],
    desc:'国家一级保护动物，大型猛禽。冬季在盐湖上空盘旋，捕食水鸟。',
    season:'冬季', rarity:'rare', emoji:'🦅', similar:['金雕'], tags:['保护动物','猛禽'] },
  { id:'sp_10', name:'小球藻', category:'浮游植物', habitat:['盐湖核心区','人工水域'],
    desc:'单细胞绿藻，在高盐度水体中大量繁殖，使水体呈绿色。盐湖初级生产者。',
    season:'春夏', rarity:'common', emoji:'🟢', similar:['螺旋藻'], tags:['初级生产者','藻类'] },
  { id:'sp_11', name:'盐藻（杜氏藻）', category:'浮游植物', habitat:['盐湖核心区'],
    desc:'耐高盐的绿色微藻，在特定条件下积累β-胡萝卜素使水体变红。"盐湖变红"主因。',
    season:'夏秋', rarity:'common', emoji:'🔴', similar:['小球藻'], tags:['指示物种','藻类'] }
];

function initSpecies() {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('species','readwrite');
    const store = tx.objectStore('species');
    const countReq = store.count();
    countReq.onsuccess = () => {
      if (countReq.result > 0) { resolve(false); return; }
      let done = 0;
      DEFAULT_SPECIES.forEach(s => {
        const r = store.put(s);
        r.onsuccess = () => { done++; if (done===DEFAULT_SPECIES.length) resolve(true); };
        r.onerror = () => reject(r.error);
      });
    };
  }));
}

function getSpecies() { return getAll('species'); }
function getSpeciesByCategory(cat) { return getByIndex('species','category',cat); }

function searchSpecies(query) {
  return getSpecies().then(list => {
    const q = query.toLowerCase();
    return list.filter(s => s.name.includes(q) || s.desc.includes(q) || s.tags.some(t=>t.includes(q)));
  });
}

/* ─── 任务系统 ─────────────────────────────────────────────────── */

const DEFAULT_TASKS = [
  { id:'task_1', title:'冬至候鸟普查', desc:'记录3种以上候鸟', habitat:'盐湖核心区',
    icon:'🦆', xp:50, category:'节气', goal:3, progress:0 },
  { id:'task_2', title:'惊蛰昆虫苏醒', desc:'找到5种昆虫', habitat:'街道绿化带',
    icon:'🐛', xp:40, category:'节气', goal:5, progress:0 },
  { id:'task_3', title:'芒种盐藻观察', desc:'记录盐藻爆发迹象', habitat:'盐湖核心区',
    icon:'🔬', xp:60, category:'节气', goal:1, progress:0 },
  { id:'task_4', title:'湿地寻踪', desc:'在芦苇湿地记录5种生物', habitat:'芦苇湿地',
    icon:'🌾', xp:45, category:'区域', goal:5, progress:0 },
  { id:'task_5', title:'山麓探秘', desc:'在中条山麓记录3种鸟类', habitat:'中条山麓',
    icon:'⛰', xp:55, category:'区域', goal:3, progress:0 },
  { id:'task_6', title:'全梯度观测', desc:'完成全部7个生境类型记录', habitat:'全部',
    icon:'🏆', xp:100, category:'区域', goal:7, progress:0 },
];

function initTasks() {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('tasks','readwrite');
    const store = tx.objectStore('tasks');
    const cnt = store.count();
    cnt.onsuccess = () => {
      if (cnt.result>0) { resolve(false); return; }
      let done = 0;
      DEFAULT_TASKS.forEach(t => {
        const r = store.put(t);
        r.onsuccess = () => { done++; if(done===DEFAULT_TASKS.length) resolve(true); };
        r.onerror = () => reject(r.error);
      });
    };
  }));
}

function getTasks() { return getAll('tasks'); }

function updateTaskProgress(taskId, inc) {
  return getByKey('tasks', taskId).then(t => {
    if (!t) return;
    t.progress = Math.min(t.goal, (t.progress||0)+inc);
    return put('tasks', t);
  });
}

/* ─── 用户档案 ─────────────────────────────────────────────────── */

function getProfile() {
  return getByKey('profile','user').then(p => p || {
    key:'user', nickname:'盐湖探索者', avatar:'🧑‍🌾',
    joinDate:Date.now(), xp:0, level:1,
    badges:[], totalObs:0, speciesCount:0, habitats:{},
    citationCount:0, taskCompleted:0
  });
}

function updateProfile(upd) {
  return getProfile().then(p => put('profile', {...p, ...upd}));
}

/* ─── 声音记录 ─────────────────────────────────────────────────── */

function saveSound(sound) {
  sound.id = sound.id || 'snd_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
  sound.timestamp = sound.timestamp || Date.now();
  return put('sounds', sound);
}

function getSounds() {
  return getAll('sounds').then(list => list.sort((a,b)=>b.timestamp-a.timestamp));
}

/* ─── 定位与天气辅助 ────────────────────────────────────────── */

function getCurrentPosition() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat:p.coords.latitude, lng:p.coords.longitude, accuracy:p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy:true, timeout:8000 }
    );
  });
}

function getWeatherEmoji() {
  const h = new Date().getHours();
  if (h<6) return '🌙 凌晨';
  if (h<9) return '🌅 清晨';
  if (h<12) return '☀️ 上午';
  if (h<14) return '🌞 正午';
  if (h<17) return '⛅ 下午';
  if (h<19) return '🌆 黄昏';
  return '🌙 夜晚';
}

/* ─── 报告生成 ─────────────────────────────────────────────────── */

function generateReport() {
  return Promise.all([getObservations(),getProfile()]).then(([obs,p])=>({
    nickname: p.nickname,
    totalObs: obs.length,
    speciesCount: [...new Set(obs.map(o=>o.species).filter(Boolean))].length,
    habitats: [...new Set(obs.map(o=>o.habitat).filter(Boolean))],
    firstObs: obs.length ? new Date(obs[obs.length-1].timestamp).toLocaleDateString('zh-CN') : '—',
    lastObs: obs.length ? new Date(obs[0].timestamp).toLocaleDateString('zh-CN') : '—',
    citations: p.citationCount||0,
    generatedAt: new Date().toLocaleDateString('zh-CN'),
  }));
}

/* ─── 导出为文本 ─────────────────────────────────────────────────── */

function exportObservationsCSV() {
  return getObservations().then(obs => {
    const header = '时间,物种,生境,类型,经度,纬度,备注';
    const rows = obs.map(o => {
      const t = new Date(o.timestamp).toLocaleString('zh-CN');
      return `${t},${o.species||''},${o.habitat||''},${o.type||''},${o.lng||''},${o.lat||''},${o.note||''}`;
    });
    return [header, ...rows].join('\n');
  });
}
