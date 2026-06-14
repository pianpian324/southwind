/**
 * 盐湖记 · 数据层（Supabase + IndexedDB 双写）
 * 在线时 Supabase 优先并缓存本地，离线时使用本地存储 + 同步队列
 */

/* ════════════════════════════════════════════════════════════════════
   Supabase 初始化
   ════════════════════════════════════════════════════════════════════ */

// 从页面注入的环境变量读取（index.html 中 window.__SUPABASE_URL__ 等）
// 如果未配置（本地开发无后端），isSupabaseConfigured() 返回 false，走纯本地模式
const SUPABASE_URL = (typeof window !== 'undefined' && window.__SUPABASE_URL__) || '';
const SUPABASE_ANON_KEY = (typeof window !== 'undefined' && window.__SUPABASE_ANON_KEY__) || '';

// 如果 URL/key 为空或仍为占位，则走纯离线 IndexedDB 模式
function isSupabaseConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY
    && SUPABASE_URL.startsWith('https://')
    && SUPABASE_ANON_KEY.length > 20
    && !SUPABASE_ANON_KEY.includes('your-anon'));
}

let _supabase = null;

function getSupabase() {
  if (_supabase) return _supabase;
  if (!isSupabaseConfigured()) return null;

  // 支持两种导入方式：
  // 1. CDN UMD (window.supabase.createClient)
  // 2. ES Module (imported createClient)
  const factory = typeof window !== 'undefined' && window.supabase && window.supabase.createClient
    ? window.supabase.createClient
    : (typeof createClient !== 'undefined' ? createClient : null);

  if (!factory) return null;
  try {
    _supabase = factory(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    console.warn('Supabase client init failed:', e.message);
    return null;
  }
  return _supabase;
}

/* ════════════════════════════════════════════════════════════════════
   用户认证 — 设备匿名登录
   ════════════════════════════════════════════════════════════════════ */

let _currentUser = null;

async function ensureAuth() {
  if (_currentUser) return _currentUser;
  const sb = getSupabase();
  if (!sb) return null;

  // 尝试恢复已有 session
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    _currentUser = session.user;
    return _currentUser;
  }

  // 匿名登录：自动获得唯一设备身份（需 Supabase Dashboard 开启 Anonymous Sign-ins）
  // SDK v2 会自动将会话持久化到 localStorage
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) {
    console.warn('⚠️ 匿名登录失败（Supabase 未配置或 Anonymous Sign-ins 未开启）:', error.message);
    return null;
  }
  _currentUser = data?.user || null;
  if (_currentUser) {
    console.log('🔐 匿名身份已创建:', _currentUser.id);
    await ensureProfile(_currentUser.id);
  }
  return _currentUser;
}

async function ensureProfile(deviceId) {
  const sb = getSupabase();
  const { data } = await sb.from('profiles').select('*').eq('device_id', deviceId).single();
  if (!data) {
    await sb.from('profiles').insert({
      device_id: deviceId,
      nickname: '盐湖探索者',
      avatar: '🧑‍🌾',
      xp: 0, level: 1,
      badges: [],
      habitats: {},
      citation_count: 0,
      task_completed: 0
    });
    // Also init task progress for all tasks
    const { data: tasks } = await sb.from('tasks').select('id');
    if (tasks) {
      const progressRows = tasks.map(t => ({
        id: `${deviceId}_${t.id}`,
        device_id: deviceId,
        task_id: t.id,
        progress: 0,
        completed: false
      }));
      await sb.from('task_progress').upsert(progressRows, { onConflict: 'id' });
    }
  }
}

/* ════════════════════════════════════════════════════════════════════
   IndexedDB 底层（保留离线能力）
   ════════════════════════════════════════════════════════════════════ */

const DB_NAME = 'southwind';
const DB_VERSION = 3;

let _db = null;

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
      if (!db.objectStoreNames.contains('task_progress')) {
        const tp = db.createObjectStore('task_progress', { keyPath: 'id' });
        tp.createIndex('task_id', 'task_id', { unique: false });
        tp.createIndex('device_id', 'device_id', { unique: false });
      }
      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { keyPath: 'key' });
      }
      // sync_queue 由 sync.js 初始化
      if (!db.objectStoreNames.contains('sync_queue')) {
        db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
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

/* ════════════════════════════════════════════════════════════════════
   物种库 API
   ════════════════════════════════════════════════════════════════════ */

async function getSpecies() {
  const sb = getSupabase();
  if (sb && navigator.onLine) {
    try {
      const { data } = await sb.from('species').select('*').order('id');
      if (data && data.length > 0) {
        // 缓存到本地
        data.forEach(s => put('species', s).catch(() => {}));
        return data;
      }
    } catch (e) { console.warn('Failed to fetch species from Supabase:', e.message); }
  }
  // Fallback to local cache
  const cached = await getAll('species');
  if (cached.length > 0) return cached;

  // Bootstrap from default data
  const defaults = [
    { id:'sp_1', name:'大红鹳（火烈鸟）', category:'鸟类', habitat:['盐湖核心区','人工水域'], description:'每年10月下旬抵达运城盐湖，停留至次年4月。以卤虫为食，体羽呈朱红色。', season:'秋冬', rarity:'common', emoji:'🦩', similar:['白琵鹭'], tags:['候鸟','旗舰种'] },
    { id:'sp_2', name:'盐地碱蓬', category:'维管束植物', habitat:['盐生草甸','盐湖核心区'], description:'一年生草本，耐盐碱。秋季叶片变红，形成"红海滩"景观。', season:'夏秋', rarity:'common', emoji:'🌿', similar:['盐角草'], tags:['指示物种','耐盐'] },
    { id:'sp_3', name:'卤虫（丰年虾）', category:'浮游动物', habitat:['盐湖核心区'], description:'盐湖关键物种，高盐度水体中大量繁殖。是火烈鸟的主要食物来源。', season:'春夏', rarity:'common', emoji:'🦐', similar:[], tags:['关键种','饵料生物'] },
    { id:'sp_4', name:'黑鹳', category:'鸟类', habitat:['中条山麓','人工水域'], description:'国家一级保护动物。在运城盐湖周边有稳定越冬种群。', season:'秋冬', rarity:'rare', emoji:'🦅', similar:['白鹳'], tags:['保护动物','候鸟'] },
    { id:'sp_5', name:'盐角草', category:'维管束植物', habitat:['盐生草甸','盐湖核心区'], description:'肉质茎叶，高度耐盐。与盐地碱蓬相似但茎节明显。', season:'夏秋', rarity:'common', emoji:'🌱', similar:['盐地碱蓬'], tags:['耐盐','肉质植物'] },
    { id:'sp_6', name:'白琵鹭', category:'鸟类', habitat:['芦苇湿地','人工水域'], description:'大型涉禽，嘴长而扁平呈匙状。在运城盐湖湿地常见。', season:'春秋', rarity:'uncommon', emoji:'🕊', similar:['大红鹳（火烈鸟）'], tags:['涉禽','候鸟'] },
    { id:'sp_7', name:'短耳鸮', category:'鸟类', habitat:['盐生草甸','街道绿化带'], description:'中型猫头鹰，白天活动。在盐湖周边草甸和农田边缘常见。', season:'全年', rarity:'uncommon', emoji:'🦉', similar:['长耳鸮'], tags:['猛禽'] },
    { id:'sp_8', name:'芦苇', category:'维管束植物', habitat:['芦苇湿地','人工水域'], description:'多年生禾草，是盐湖湿地的主要建群种。', season:'全年', rarity:'common', emoji:'🎋', similar:[], tags:['建群种','湿地植物'] },
    { id:'sp_9', name:'白尾海雕', category:'鸟类', habitat:['盐湖核心区','中条山麓'], description:'国家一级保护动物，大型猛禽。冬季在盐湖上空盘旋。', season:'冬季', rarity:'rare', emoji:'🦅', similar:['金雕'], tags:['保护动物','猛禽'] },
    { id:'sp_10', name:'小球藻', category:'浮游植物', habitat:['盐湖核心区','人工水域'], description:'单细胞绿藻，在高盐度水体中大量繁殖。盐湖初级生产者。', season:'春夏', rarity:'common', emoji:'🟢', similar:['螺旋藻'], tags:['初级生产者','藻类'] },
    { id:'sp_11', name:'盐藻（杜氏藻）', category:'浮游植物', habitat:['盐湖核心区'], description:'耐高盐微藻，积累β-胡萝卜素使水体变红。', season:'夏秋', rarity:'common', emoji:'🔴', similar:['小球藻'], tags:['指示物种','藻类'] }
  ];
  defaults.forEach(s => put('species', s).catch(() => {}));
  return defaults;
}

/* ════════════════════════════════════════════════════════════════════
   任务 API
   ════════════════════════════════════════════════════════════════════ */

async function getTasks() {
  const sb = getSupabase();
  if (sb && navigator.onLine) {
    try {
      const { data } = await sb.from('tasks').select('*').order('sort_order');
      if (data && data.length > 0) {
        data.forEach(t => put('tasks', t).catch(() => {}));
        return data;
      }
    } catch (e) { console.warn('Failed to fetch tasks:', e.message); }
  }
  const cached = await getAll('tasks');
  if (cached.length > 0) return cached;

  const defaults = [
    { id:'task_1', title:'冬至候鸟普查', description:'记录3种以上候鸟', habitat:'盐湖核心区', icon:'🦆', xp:50, category:'节气', goal:3 },
    { id:'task_2', title:'惊蛰昆虫苏醒', description:'找到5种昆虫', habitat:'街道绿化带', icon:'🐛', xp:40, category:'节气', goal:5 },
    { id:'task_3', title:'芒种盐藻观察', description:'记录盐藻爆发迹象', habitat:'盐湖核心区', icon:'🔬', xp:60, category:'节气', goal:1 },
    { id:'task_4', title:'湿地寻踪', description:'在芦苇湿地记录5种生物', habitat:'芦苇湿地', icon:'🌾', xp:45, category:'区域', goal:5 },
    { id:'task_5', title:'山麓探秘', description:'在中条山麓记录3种鸟类', habitat:'中条山麓', icon:'⛰', xp:55, category:'区域', goal:3 },
    { id:'task_6', title:'全梯度观测', description:'完成全部7个生境类型记录', habitat:'全部', icon:'🏆', xp:100, category:'区域', goal:7 }
  ];
  defaults.forEach(t => put('tasks', t).catch(() => {}));
  return defaults;
}

async function getTaskProgress() {
  // 本地聚合 fallback（无需 Supabase 连接也可工作）
  const cached = await getAll('task_progress');
  if (cached && cached.length > 0) return cached;

  const tasks = await getTasks();
  const tasks_ = tasks || [];
  const defaultProgress = tasks_.map(t => ({
    id: `local_${t.id}`, device_id: 'local_user',
    task_id: t.id, progress: Math.round(Math.random() * t.goal), completed: false,
  }));
  // 对 1/3 的任务标记为已完成，增加演示感
  defaultProgress.forEach((p, i) => {
    const task = tasks_[i];
    if (!task) return;
    if (i % 3 === 0) { p.progress = task.goal; p.completed = true; }
  });
  for (const r of defaultProgress) { await put('task_progress', r).catch(() => {}); }
  return defaultProgress;
}

async function updateTaskProgress(taskId, inc) {
  const user = await ensureAuth();
  if (!user) return;
  const sb = getSupabase();
  const progressId = `${user.id}_${taskId}`;

  // Get current progress
  const { data: current } = await sb.from('task_progress').select('progress,completed').eq('id', progressId).single();
  if (!current) return;

  const task = await sb.from('tasks').select('goal').eq('id', taskId).single();
  const goal = task?.data?.goal || 999;
  const newProgress = Math.min(goal, (current.progress || 0) + inc);
  const completed = newProgress >= goal;

  const { error } = await sb.from('task_progress').upsert({
    id: progressId,
    device_id: user.id,
    task_id: taskId,
    progress: newProgress,
    completed,
    updated_at: new Date().toISOString()
  });

  if (!error && completed) {
    // Award XP
    const xp = task?.data?.xp || 0;
    await sb.rpc('add_xp', { p_device_id: user.id, p_xp: xp });
  }
}

/* ════════════════════════════════════════════════════════════════════
   观测记录 API
   ════════════════════════════════════════════════════════════════════ */

async function saveObservation(obs) {
  const user = await ensureAuth();
  obs.id = obs.id || 'obs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  obs.device_id = user ? user.id : null;
  obs.created_at = obs.created_at || new Date().toISOString();

  // Try Supabase
  const sb = getSupabase();
  if (sb && navigator.onLine) {
    try {
      const { error } = await sb.from('observations').insert(obs);
      if (!error) {
        // Cache locally for offline access
        put('observations', obs).catch(() => {});
        // Update task progress based on habitat & species
        await _autoAdvanceTasks(obs);
        return obs.id;
      }
      throw error;
    } catch (e) {
      console.warn('Supabase save failed, queuing offline:', e.message);
    }
  }

  // Offline: cache locally + enqueue for sync
  await put('observations', obs);
  if (typeof enqueueSync !== 'undefined') {
    enqueueSync('observation', 'insert', obs).catch(() => {});
  }
  return obs.id;
}

async function _autoAdvanceTasks(obs) {
  const tasks = await getTasks();
  const user = await ensureAuth();
  if (!user) return;

  for (const t of tasks) {
    let matched = false;
    if (t.id === 'task_6') {
      // "全梯度观测" — count unique habitats
      const sb = getSupabase();
      const { data: allObs } = await sb.from('observations')
        .select('habitat').eq('device_id', user.id);
      const uniqueHabitats = new Set(allObs?.map(o => o.habitat).filter(Boolean));
      const progressId = `${user.id}_${t.id}`;
      const newProg = uniqueHabitats.size;
      await sb.from('task_progress').upsert({
        id: progressId, device_id: user.id, task_id: t.id,
        progress: Math.min(t.goal, newProg), completed: newProg >= t.goal,
        updated_at: new Date().toISOString()
      });
      continue;
    }
    if (obs.habitat && t.habitat === obs.habitat) matched = true;
    if (obs.bio_type && t.title.includes('昆虫') && obs.bio_type === '昆虫') matched = true;
    if (matched) {
      await updateTaskProgress(t.id, 1);
    }
  }
}

async function getObservations() {
  const sb = getSupabase();
  if (sb && navigator.onLine) {
    try {
      const { data } = await sb.from('observations')
        .select('*').order('created_at', { ascending: false }).limit(200);
      if (data) {
        // Cache recent observations locally
        data.slice(0, 50).forEach(o => put('observations', o).catch(() => {}));
        return data;
      }
    } catch (e) { console.warn('Failed to fetch observations:', e.message); }
  }
  // Fallback to local cache (with timestamps sorted)
  const cached = await getAll('observations');
  if (cached && cached.length > 0) {
    return cached.sort((a, b) => {
      const da = a.created_at || a.timestamp || 0;
      const db = b.created_at || b.timestamp || 0;
      return new Date(db) - new Date(da);
    });
  }

  // Bootstrap: sample community observations (for offline / first-run demo)
  const now = new Date();
  const seed = [
    { id:'obs_seed_1', species_id:'sp_1', species_name:'大红鹳（火烈鸟）', habitat:'盐湖核心区', bio_type:'鸟类', emoji:'🦩', method:'photo', note:'约 40 只聚集在盐湖南岸，正在觅食。', created_at: new Date(now - 1000*60*60*2).toISOString(), device_id:'device_demo' },
    { id:'obs_seed_2', species_id:'sp_2', species_name:'盐地碱蓬', habitat:'盐生草甸', bio_type:'维管束植物', emoji:'🌿', method:'photo', note:'近岸盐生草甸已大片变红，约至膝高。', created_at: new Date(now - 1000*60*60*5).toISOString(), device_id:'device_demo' },
    { id:'obs_seed_3', species_id:'sp_4', species_name:'黑鹳', habitat:'中条山麓', bio_type:'鸟类', emoji:'🦅', method:'photo', note:'山麓树林边缘出现 2 只黑鹳，停留约 15 分钟后飞走。', created_at: new Date(now - 1000*60*60*26).toISOString(), device_id:'device_demo2' },
    { id:'obs_seed_4', species_id:'sp_6', species_name:'白琵鹭', habitat:'芦苇湿地', bio_type:'鸟类', emoji:'🕊', method:'text', note:'在芦苇荡西北角与火烈鸟混群。', created_at: new Date(now - 1000*60*60*34).toISOString(), device_id:'device_demo2' },
    { id:'obs_seed_5', species_id:'sp_7', species_name:'短耳鸮', habitat:'街道绿化带', bio_type:'鸟类', emoji:'🦉', method:'text', note:'清晨在绿化带边缘发现，疑似在捕食啮齿类。', created_at: new Date(now - 1000*60*60*48).toISOString(), device_id:'device_demo3' },
    { id:'obs_seed_6', species_id:'sp_3', species_name:'卤虫（丰年虾）', habitat:'盐湖核心区', bio_type:'浮游动物', emoji:'🦐', method:'text', note:'取样观察：每升水体中约 2000 只幼体。', created_at: new Date(now - 1000*60*60*55).toISOString(), device_id:'device_demo' },
    { id:'obs_seed_7', species_id:'sp_11', species_name:'盐藻（杜氏藻）', habitat:'盐湖核心区', bio_type:'浮游植物', emoji:'🔴', method:'photo', note:'3 号池水体呈明显橙红色，疑似盐藻大量繁殖。', created_at: new Date(now - 1000*60*60*60).toISOString(), device_id:'device_demo3' },
  ];
  for (const o of seed) { await put('observations', o).catch(() => {}); }
  return seed;
}

/**
 * 获取本周社区达人榜 — 纯 Supabase 聚合
 */
async function getLeaderboard() {
  const sb = getSupabase();
  if (sb && navigator.onLine) {
    try {
      // 本周起始日期
      const now = new Date();
      const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
      const { data } = await sb.from('observations')
        .select('device_id, profiles(nickname, avatar)')
        .gte('created_at', weekStart.toISOString())
        .order('created_at', { ascending: false });

      if (data && data.length > 0) {
        const counts = {};
        data.forEach(o => {
          if (!counts[o.device_id]) {
            counts[o.device_id] = {
              count: 0,
              nickname: o.profiles?.nickname || '匿名观测者',
              avatar: o.profiles?.avatar || '🧑‍🌾'
            };
          }
          counts[o.device_id].count++;
        });
        return Object.entries(counts)
          .map(([device_id, info]) => ({ device_id, ...info }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);
      }
    } catch (e) { console.warn('Failed to fetch leaderboard:', e.message); }
  }

  // 离线回退：本地聚合观测
  const all = await getAll('observations');
  if (all && all.length > 0) {
    const counts = {};
    const demoProfiles = {
      device_demo: { nickname: '盐池老张', avatar: '🌿' },
      device_demo2: { nickname: '博物志', avatar: '🦉' },
      device_demo3: { nickname: '柳先生', avatar: '🦩' },
    };
    all.forEach(o => {
      const key = o.device_id || 'local_user';
      if (!counts[key]) {
        counts[key] = {
          count: 0,
          nickname: demoProfiles[key]?.nickname || '匿名观测者',
          avatar: demoProfiles[key]?.avatar || '🧑‍🌾'
        };
      }
      counts[key].count++;
    });
    return Object.entries(counts)
      .map(([device_id, info]) => ({ device_id, ...info }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }
  return [];
}

/**
 * 获取社区聚合统计
 */
async function getCommunityStats() {
  const sb = getSupabase();
  if (sb && navigator.onLine) {
    try {
      const [{ count: totalObs }, { data: speciesData }, { count: deviceCount }] = await Promise.all([
        sb.from('observations').select('*', { count: 'exact', head: true }),
        sb.from('observations').select('species_id').not('species_id', 'is', null),
        sb.from('profiles').select('*', { count: 'exact', head: true })
      ]);

      const uniqueSpecies = new Set(speciesData?.map(o => o.species_id).filter(Boolean));

      return {
        totalObs: totalObs || 0,
        speciesCount: uniqueSpecies.size,
        deviceCount: deviceCount || 0
      };
    } catch (e) { console.warn('Failed to fetch community stats:', e.message); }
  }

  // 离线回退：从本地 IndexedDB 聚合
  const all = await getAll('observations');
  const uniqueSpecies = new Set((all || []).map(o => o.species_id).filter(Boolean));
  const uniqueDevices = new Set((all || []).map(o => o.device_id).filter(Boolean));
  return {
    totalObs: (all || []).length,
    speciesCount: uniqueSpecies.size,
    deviceCount: uniqueDevices.size || 3,
  };
}

/* ════════════════════════════════════════════════════════════════════
   声音记录 API
   ════════════════════════════════════════════════════════════════════ */

async function saveSound(sound) {
  const user = await ensureAuth();
  sound.id = sound.id || 'snd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  sound.device_id = user ? user.id : null;
  sound.created_at = sound.created_at || new Date().toISOString();

  const sb = getSupabase();
  if (sb && navigator.onLine) {
    try {
      const { error } = await sb.from('sounds').insert(sound);
      if (!error) { put('sounds', sound).catch(() => {}); return sound.id; }
      throw error;
    } catch (e) { console.warn('Sound save failed, queuing:', e.message); }
  }

  await put('sounds', sound);
  if (typeof enqueueSync !== 'undefined') {
    enqueueSync('sound', 'insert', sound).catch(() => {});
  }
  return sound.id;
}

async function getSounds() {
  const sb = getSupabase();
  if (sb && navigator.onLine) {
    try {
      const { data } = await sb.from('sounds').select('*').order('created_at', { ascending: false }).limit(50);
      if (data) { data.slice(0, 20).forEach(s => put('sounds', s).catch(() => {})); return data; }
    } catch (e) { console.warn('Failed to fetch sounds:', e.message); }
  }
  const cached = await getAll('sounds');
  if (cached && cached.length > 0) {
    return cached.sort((a, b) => {
      const da = a.created_at || a.timestamp || 0;
      const db = b.created_at || b.timestamp || 0;
      return new Date(db) - new Date(da);
    });
  }
  // Bootstrap: seed sounds
  const now = new Date();
  const seed = [
    { id:'snd_seed_1', title:'盐池声景 · 冬日火烈鸟', habitat:'盐湖核心区', created_at: new Date(now - 1000*60*60*20).toISOString(), duration:'2:17' },
    { id:'snd_seed_2', title:'中条山清晨鸟鸣', habitat:'中条山麓', created_at: new Date(now - 1000*60*60*30).toISOString(), duration:'3:42' },
    { id:'snd_seed_3', title:'芦苇荡风声', habitat:'芦苇湿地', created_at: new Date(now - 1000*60*60*50).toISOString(), duration:'1:58' },
  ];
  for (const s of seed) { await put('sounds', s).catch(() => {}); }
  return seed;
}

/* ════════════════════════════════════════════════════════════════════
   用户档案 API
   ════════════════════════════════════════════════════════════════════ */

async function getProfile() {
  const user = await ensureAuth();
  if (!user) {
    // Pure offline fallback
    return getByKey('profile', 'user').then(p => p || {
      key: 'user', nickname: '盐湖探索者', avatar: '🧑‍🌾',
      xp: 0, level: 1, badges: [], task_completed: 0, citation_count: 0
    });
  }

  const sb = getSupabase();
  if (sb && navigator.onLine) {
    try {
      const { data } = await sb.from('profiles').select('*').eq('device_id', user.id).single();
      if (data) {
        put('profile', { key: 'user', ...data }).catch(() => {});
        return { key: 'user', ...data };
      }
    } catch (e) { console.warn('Failed to fetch profile:', e.message); }
  }

  return getByKey('profile', 'user').then(p => p || {
    key: 'user', nickname: '盐湖探索者', avatar: '🧑‍🌾',
    xp: 0, level: 1, badges: [], task_completed: 0, citation_count: 0
  });
}

async function updateProfile(upd) {
  const user = await ensureAuth();
  if (!user) return put('profile', { key: 'user', ...upd });

  const sb = getSupabase();
  if (sb && navigator.onLine) {
    try {
      const { error } = await sb.from('profiles').upsert({ device_id: user.id, ...upd });
      if (!error) { put('profile', { key: 'user', ...upd }).catch(() => {}); return; }
      throw error;
    } catch (e) { console.warn('Profile update failed, queuing:', e.message); }
  }

  await put('profile', { key: 'user', ...upd });
  if (typeof enqueueSync !== 'undefined') {
    enqueueSync('profile', 'update', { device_id: user.id, ...upd }).catch(() => {});
  }
}

/* ════════════════════════════════════════════════════════════════════
   图片上传到 Supabase Storage
   ════════════════════════════════════════════════════════════════════ */

/**
 * 上传 Base64/Blob 图片到 Supabase Storage
 * @param {string} base64Data - data:image/jpeg;base64,...
 * @param {string} fileName - 如 'obs_1712345678_abc.jpg'
 * @returns {Promise<string|null>} 公开访问 URL
 */
async function uploadPhoto(base64Data, fileName) {
  const sb = getSupabase();
  if (!sb) return null;

  // Convert base64 to blob
  const res = await fetch(base64Data);
  const blob = await res.blob();

  const filePath = `observations/${fileName}`;
  const { error } = await sb.storage.from('observation-photos').upload(filePath, blob, {
    contentType: 'image/jpeg',
    upsert: true
  });

  if (error) {
    console.error('Photo upload failed:', error.message);
    return null;
  }

  const { data: urlData } = sb.storage.from('observation-photos').getPublicUrl(filePath);
  return urlData.publicUrl;
}

/**
 * 上传音频到 Supabase Storage
 */
async function uploadAudio(blob, fileName) {
  const sb = getSupabase();
  if (!sb) return null;

  const filePath = `recordings/${fileName}`;
  const { error } = await sb.storage.from('sound-recordings').upload(filePath, blob, {
    contentType: 'audio/webm',
    upsert: true
  });

  if (error) {
    console.error('Audio upload failed:', error.message);
    return null;
  }

  const { data: urlData } = sb.storage.from('sound-recordings').getPublicUrl(filePath);
  return urlData.publicUrl;
}

/* ════════════════════════════════════════════════════════════════════
   导出 & 报告
   ════════════════════════════════════════════════════════════════════ */

async function exportObservationsCSV() {
  const obs = await getObservations();
  const header = '时间,物种,生境,类型,经度,纬度,备注';
  const rows = obs.map(o => {
    const t = o.created_at ? new Date(o.created_at).toLocaleString('zh-CN') : '';
    return `${t},${o.species_name || o.species || ''},${o.habitat || ''},${o.bio_type || o.type || ''},${o.lng || ''},${o.lat || ''},${o.note || ''}`;
  });
  return [header, ...rows].join('\n');
}

async function generateReport() {
  const [obs, p] = await Promise.all([getObservations(), getProfile()]);
  const yourObs = obs.filter(o => o.device_id === _currentUser?.id);
  return {
    nickname: p.nickname,
    totalObs: yourObs.length,
    speciesCount: [...new Set(yourObs.map(o => o.species_id || o.species).filter(Boolean))].length,
    habitats: [...new Set(yourObs.map(o => o.habitat).filter(Boolean))],
    firstObs: yourObs.length ? new Date(yourObs[yourObs.length - 1].created_at || yourObs[yourObs.length - 1].timestamp).toLocaleDateString('zh-CN') : '—',
    lastObs: yourObs.length ? new Date(yourObs[0].created_at || yourObs[0].timestamp).toLocaleDateString('zh-CN') : '—',
    citations: p.citation_count || 0,
    generatedAt: new Date().toLocaleDateString('zh-CN'),
  };
}

async function getCurrentPosition() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

function getWeatherEmoji() {
  const h = new Date().getHours();
  if (h < 6) return '🌙 凌晨';
  if (h < 9) return '🌅 清晨';
  if (h < 12) return '☀️ 上午';
  if (h < 14) return '🌞 正午';
  if (h < 17) return '⛅ 下午';
  if (h < 19) return '🌆 黄昏';
  return '🌙 夜晚';
}

function getCurrentUserId() {
  return _currentUser?.id || null;
}
