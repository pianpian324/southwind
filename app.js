/**
 * 盐湖记 · 应用主逻辑
 * 管理视图渲染、用户交互、数据流
 */

/* ════════════════════════════════════════════════════════════════
   初始化
   ════════════════════════════════════════════════════════════════ */

let _profile = null;
let _observations = [];
let _allSpecies = [];
let _tasks = [];
let _sounds = [];

function init() {
  return Promise.all([
    initSpecies(),
    initTasks(),
    getProfile(),
  ]).then(async ([spInit, tkInit, prof]) => {
    _profile = prof;
    _allSpecies = await getSpecies();
    _tasks = await getTasks();
    _observations = await getObservations();
    _sounds = await getSounds();
    renderAll();
    bindGlobalEvents();
  });
}

function renderAll() {
  renderHeroStats();
  renderRecentObservations();
  renderMap();
  renderTasks();
  renderSpeciesBrowser();
  renderSoundMap();
  renderDataWall();
  renderPersonalCenter();
}

/* ════════════════════════════════════════════════════════════════
   底部导航 & 页面切换
   ════════════════════════════════════════════════════════════════ */

function navigateTo(sectionId) {
  // Update bottom nav
  document.querySelectorAll('.bottomnav-item:not(.record-btn)').forEach(el => el.classList.remove('active'));
  const navMap = { hero:'首页', map:'地图', tasks:'社区', personal:'我的' };
  const targetLabel = navMap[sectionId] || '首页';
  document.querySelectorAll('.bottomnav-item:not(.record-btn)').forEach(el => {
    if (el.textContent.trim() === targetLabel) el.classList.add('active');
  });
  // Scroll to section
  const target = document.querySelector(`[data-od-id="${sectionId}"]`);
  if (target) target.scrollIntoView({ behavior:'smooth' });
}

function bindGlobalEvents() {
  // Record buttons
  document.getElementById('recordBtn')?.addEventListener('click', showRecordSheet);
  document.getElementById('bottomRecordBtn')?.addEventListener('click', showRecordSheet);
  // Quick search
  document.getElementById('speciesSearch')?.addEventListener('input', e => {
    renderSpeciesCards(e.target.value);
  });
  // Timeline slider
  const slider = document.getElementById('timelineSlider');
  const label = document.getElementById('timelineLabel');
  if (slider) {
    const seasons = [
      { label:'🌸 春分' }, { label:'☀ 夏至' }, { label:'🍁 秋分' },
      { label:'🍂 霜降', emoji:'🦩' }, { label:'❄ 冬至' }
    ];
    slider.addEventListener('input', () => {
      const idx = parseInt(slider.value)-1;
      label.textContent = seasons[idx].label;
      document.querySelectorAll('.map-hotspot').forEach(h => { h.style.opacity = 0.3+(idx+1)*0.14; });
    });
  }
  // Sound play button
  const playBtn = document.getElementById('playBtn');
  const waveform = document.getElementById('waveform');
  if (playBtn && waveform) {
    let playing = false;
    playBtn.addEventListener('click', () => {
      playing = !playing;
      playBtn.textContent = playing ? '⏸' : '▶';
      waveform.classList.toggle('playing', playing);
    });
  }
  // Bottom nav
  document.querySelectorAll('.bottomnav-item:not(.record-btn)').forEach(btn => {
    btn.addEventListener('click', function() {
      const label = this.textContent.trim();
      const map = { '首页':'hero', '地图':'map', '社区':'datawall', '我的':'personal' };
      navigateTo(map[label]||'hero');
    });
  });
  // Record sound
  document.getElementById('recordSoundBtn')?.addEventListener('click', startVoiceRecording);
}

/* ════════════════════════════════════════════════════════════════
   1. 首页 — 仪表盘 + 最近观测
   ════════════════════════════════════════════════════════════════ */

function renderHeroStats() {
  const speciesSet = new Set(_observations.map(o=>o.species).filter(Boolean));
  const thisMonth = _observations.filter(o => {
    const d = new Date(o.timestamp);
    const now = new Date();
    return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
  });
  const el = document.getElementById('heroStats');
  if (!el) return;
  el.innerHTML = `
    <div class="dash-card"><div class="dash-num num">${thisMonth.length}</div><div class="dash-label">本月观测</div><div class="dash-sub">累计 ${_observations.length} 条</div></div>
    <div class="dash-card"><div class="dash-num num">${speciesSet.size}</div><div class="dash-label">已记录物种</div><div class="dash-sub">${_allSpecies.length} 种盐湖物种库</div></div>
    <div class="dash-card"><div class="dash-num num" style="font-size:28px;">Lv.${_profile.level}</div><div class="dash-label">生态行者等级</div><div class="dash-sub">${_profile.xp} XP</div></div>
  `;
}

function renderRecentObservations() {
  const container = document.getElementById('obsScroll');
  if (!container) return;
  if (_observations.length===0) {
    container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--muted);font-size:14px;">还没有观测记录<br>点击下方「记录」按钮开始你的第一笔记录吧 🌿</div>`;
    return;
  }
  container.innerHTML = _observations.slice(0, 8).map(o => {
    const sp = _allSpecies.find(s => s.id===o.species);
    const emoji = o.emoji || sp?.emoji || '🌿';
    const name = o.speciesName || sp?.name || o.species || '未知物种';
    const time = new Date(o.timestamp).toLocaleString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    const habitat = o.habitat || '';
    return `<div class="obs-card"><div class="obs-img" style="background:linear-gradient(135deg,var(--tint-amber),var(--tint-amber-deep));font-size:32px;display:grid;place-items:center;">${emoji}</div><div class="obs-body"><div class="obs-species">${name}</div><div class="obs-meta"><span>📍 ${habitat}</span><span>🕐 ${time}</span></div></div></div>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════════
   2. 探索地图
   ════════════════════════════════════════════════════════════════ */

const HABITAT_MAP = [
  { id:'h1', name:'盐湖核心区', x:'48%', y:'55%', color:'var(--accent-red)', species:0 },
  { id:'h2', name:'盐生草甸', x:'35%', y:'45%', color:'var(--accent-gold)', species:0 },
  { id:'h3', name:'芦苇湿地', x:'58%', y:'40%', color:'var(--accent-green)', species:0 },
  { id:'h4', name:'街道绿化带', x:'62%', y:'30%', color:'var(--accent-blue)', species:0 },
  { id:'h5', name:'中条山麓', x:'72%', y:'18%', color:'var(--tint-lavender-deep)', species:0 },
  { id:'h6', name:'人工水域', x:'42%', y:'62%', color:'var(--tint-blue-gray)', species:0 },
  { id:'h7', name:'农田边缘', x:'52%', y:'35%', color:'var(--tint-taupe-deep)', species:0 },
];

function renderMap() {
  // Count species per habitat
  const counts = {};
  _observations.forEach(o => {
    if (o.habitat) counts[o.habitat] = (counts[o.habitat]||0)+1;
  });
  // Count unique species per habitat
  const speciesInHabitat = {};
  _observations.forEach(o => {
    if (o.habitat && o.species) {
      if (!speciesInHabitat[o.habitat]) speciesInHabitat[o.habitat] = new Set();
      speciesInHabitat[o.habitat].add(o.species);
    }
  });

  const container = document.getElementById('mapHotspots');
  if (!container) return;
  container.innerHTML = HABITAT_MAP.map(h => {
    const obsCount = counts[h.name]||0;
    const spCount = speciesInHabitat[h.name]?.size||0;
    const size = Math.max(20, Math.min(48, 20+obsCount*3));
    const opacity = obsCount > 0 ? 0.85 : 0.3;
    return `<div class="map-hotspot" style="left:${h.x};top:${h.y};width:${size}px;height:${size}px;background:${h.color};opacity:${opacity};" title="${h.name}: ${spCount}种, ${obsCount}次观测"><span style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:${size>30?'12px':'9px'};color:#fff;font-weight:600;text-shadow:0 1px 2px rgba(0,0,0,0.3);">${spCount}</span></div>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════════
   3. 任务与挑战
   ════════════════════════════════════════════════════════════════ */

function renderTasks() {
  const container = document.getElementById('taskList');
  if (!container) return;
  if (_tasks.length===0) {
    container.innerHTML = '<p style="color:var(--muted);text-align:center;">暂无任务</p>';
    return;
  }
  container.innerHTML = _tasks.map(t => {
    const pct = t.goal>0 ? Math.round((t.progress/t.goal)*100) : 0;
    const done = t.progress>=t.goal;
    return `<div class="task-card" style="${done?'opacity:0.6;':''}">
      <div class="task-icon">${t.icon}</div>
      <div class="task-body">
        <div class="task-title" style="font-weight:600;">${t.title}</div>
        <div class="task-desc" style="font-size:13px;color:var(--muted);margin:2px 0;">${t.desc}</div>
        <div class="task-meta" style="font-size:12px;color:var(--muted);display:flex;gap:12px;">
          <span>📍 ${t.habitat}</span>
          <span>✨ +${t.xp} XP</span>
        </div>
        <div style="margin-top:8px;">
          <div style="height:6px;background:var(--border);border-radius:99px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${done?'var(--success)':'var(--accent)'};border-radius:99px;transition:width 0.3s;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-top:2px;">
            <span>${t.progress}/${t.goal}</span>
            <span>${pct}%</span>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ════════════════════════════════════════════════════════════════
   4. 物种浏览与对比
   ════════════════════════════════════════════════════════════════ */

function renderSpeciesBrowser() {
  renderSpeciesCards();
  renderSpeciesCategories();
}

function renderSpeciesCategories() {
  const cats = [...new Set(_allSpecies.map(s=>s.category))];
  const container = document.getElementById('speciesCats');
  if (!container) return;
  container.innerHTML = cats.map(c => `<span class="tag category-tag" data-cat="${c}" onclick="filterSpecies('${c}')" style="cursor:pointer;padding:5px 12px;border-radius:99px;border:1px solid var(--border);font-size:13px;">${c}</span>`).join('');
}

function filterSpecies(category) {
  const input = document.getElementById('speciesSearch');
  if (input) input.value = '';
  renderSpeciesCards('', category);
}

function renderSpeciesCards(query='', category=null) {
  const container = document.getElementById('speciesList');
  if (!container) return;
  let list = _allSpecies;
  if (query) {
    const q = query.toLowerCase();
    list = list.filter(s => s.name.includes(q) || s.desc.includes(q) || s.tags.some(t=>t.includes(q)));
  }
  if (category) list = list.filter(s => s.category===category);
  if (list.length===0) {
    container.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;">未找到匹配的物种</p>';
    return;
  }
  container.innerHTML = list.map(s => {
    const rarityLabel = { common:'常见', uncommon:'少见', rare:'珍稀' }[s.rarity]||'';
    const rarityColor = { common:'var(--accent-green)', uncommon:'var(--accent-gold)', rare:'var(--accent-red)' }[s.rarity]||'var(--muted)';
    return `<div class="species-card" onclick="showSpeciesDetail('${s.id}')" style="cursor:pointer;">
      <div class="species-emoji" style="font-size:40px;text-align:center;padding:12px 0;">${s.emoji}</div>
      <div class="species-name" style="font-weight:600;text-align:center;">${s.name}</div>
      <div class="species-cat" style="text-align:center;font-size:12px;color:var(--muted);">${s.category}</div>
      <div style="text-align:center;margin-top:6px;"><span class="tag" style="font-size:11px;padding:2px 8px;border-radius:99px;background:${rarityColor}22;color:${rarityColor};border:1px solid ${rarityColor}44;">${rarityLabel}</span></div>
      <div class="species-desc" style="font-size:13px;color:var(--muted);padding:8px;line-height:1.5;">${s.desc}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;padding:4px 8px 8px;">
        ${s.similar.map(sim => `<span class="tag" style="font-size:10px;padding:2px 6px;border-radius:99px;background:var(--blue-soft);cursor:pointer;" onclick="event.stopPropagation();compareSpecies('${s.name}','${sim}')">🔍 对比 ${sim}</span>`).join('')}
        ${s.tags.map(t => `<span class="tag" style="font-size:10px;padding:2px 6px;border-radius:99px;background:var(--accent-soft);">${t}</span>`).join('')}
      </div>
    </div>`;
  }).join('');
}

/* ─── 物种详情对话框 ───────────────────────────────────────── */

let currentCompareSpecies = null;

window.showSpeciesDetail = function(id) {
  const s = _allSpecies.find(x=>x.id===id);
  if (!s) return;
  const obsList = _observations.filter(o => o.species===id);
  const html = `
    <div style="position:fixed;inset:0;z-index:300;background:rgba(0,0,0,0.4);display:grid;place-items:center;padding:20px;" onclick="if(event.target===this)closeModal()">
      <div style="background:var(--surface);border-radius:16px;max-width:420px;width:100%;padding:24px;max-height:80vh;overflow-y:auto;animation:slideUp 0.25s var(--ease);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="font-family:var(--font-display);">${s.emoji} ${s.name}</h3>
          <button style="width:32px;height:32px;border-radius:50%;background:var(--fg-soft);display:grid;place-items:center;font-size:18px;color:var(--muted);border:none;cursor:pointer;" onclick="closeModal()">✕</button>
        </div>
        <p><strong>分类</strong> ${s.category}</p>
        <p><strong>生境</strong> ${s.habitat.join(' · ')}</p>
        <p><strong>活跃季</strong> ${s.season}</p>
        <p style="margin-top:8px;line-height:1.6;">${s.desc}</p>
        ${s.similar.length > 0 ? `<div style="margin-top:12px;"><strong>相似物种</strong><div style="display:flex;gap:8px;margin-top:4px;">${s.similar.map(sim => `<button class="btn btn-secondary" style="font-size:12px;padding:4px 12px;" onclick="compareSpecies('${s.name}','${sim}')">🔍 对比 ${sim}</button>`).join('')}</div></div>` : ''}
        <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:4px;">${s.tags.map(t=>`<span class="tag" style="font-size:11px;padding:3px 8px;border-radius:99px;background:var(--accent-soft);">${t}</span>`).join('')}</div>
        ${obsList.length>0 ? `<div style="margin-top:16px;"><strong>社区观测记录 (${obsList.length})</strong><div style="max-height:160px;overflow-y:auto;margin-top:8px;">${obsList.slice(0,10).map(o => `<div style="font-size:13px;padding:4px 0;border-bottom:1px solid var(--border);">📍 ${o.habitat||'未知'} · ${new Date(o.timestamp).toLocaleDateString('zh-CN')}${o.note?': '+o.note:''}</div>`).join('')}</div></div>` : ''}
      </div>
    </div>`;
  const m = document.createElement('div');
  m.id = 'detailModal';
  m.innerHTML = html;
  document.body.appendChild(m);
};

window.closeModal = function() {
  document.getElementById('detailModal')?.remove();
  document.getElementById('compareModal')?.remove();
};

window.compareSpecies = function(name1, name2) {
  const s1 = _allSpecies.find(s => s.name===name1);
  const s2 = _allSpecies.find(s => s.name===name2);
  if (!s1||!s2) return;
  const html = `
    <div style="position:fixed;inset:0;z-index:310;background:rgba(0,0,0,0.4);display:grid;place-items:center;padding:20px;" onclick="if(event.target===this)closeModal()">
      <div style="background:var(--surface);border-radius:16px;max-width:520px;width:100%;padding:24px;max-height:85vh;overflow-y:auto;animation:slideUp 0.25s var(--ease);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="font-family:var(--font-display);">🔍 物种对比</h3>
          <button style="width:32px;height:32px;border-radius:50%;background:var(--fg-soft);display:grid;place-items:center;font-size:18px;color:var(--muted);border:none;cursor:pointer;" onclick="closeModal()">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div style="padding:16px;background:var(--accent-soft);border-radius:12px;text-align:center;">
            <div style="font-size:48px;">${s1.emoji}</div>
            <h4>${s1.name}</h4>
            <p style="font-size:13px;color:var(--muted);margin-top:8px;">${s1.desc}</p>
            <p style="font-size:12px;color:var(--muted);margin-top:4px;">生境: ${s1.habitat.join('、')}</p>
          </div>
          <div style="padding:16px;background:var(--blue-soft);border-radius:12px;text-align:center;">
            <div style="font-size:48px;">${s2.emoji}</div>
            <h4>${s2.name}</h4>
            <p style="font-size:13px;color:var(--muted);margin-top:8px;">${s2.desc}</p>
            <p style="font-size:12px;color:var(--muted);margin-top:4px;">生境: ${s2.habitat.join('、')}</p>
          </div>
        </div>
      </div>
    </div>`;
  const m = document.createElement('div');
  m.id = 'compareModal';
  m.innerHTML = html;
  document.body.appendChild(m);
};

/* ════════════════════════════════════════════════════════════════
   5. 声音地图
   ════════════════════════════════════════════════════════════════ */

function renderSoundMap() {
  const list = document.getElementById('soundList');
  if (!list) return;
  if (_sounds.length===0) {
    list.innerHTML = '<p style="color:var(--muted);font-size:13px;text-align:center;">还没有声音记录<br>点击麦克风按钮录制盐池的声音</p>';
    return;
  }
  list.innerHTML = _sounds.slice(0,6).map(s => `
    <div class="sound-entry" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);">
      <div style="font-size:24px;">🔊</div>
      <div style="flex:1;">
        <div style="font-weight:500;">${s.title||'未命名录音'}</div>
        <div style="font-size:12px;color:var(--muted);">📍 ${s.habitat||'未知'} · ${new Date(s.timestamp).toLocaleDateString('zh-CN')}</div>
      </div>
      <button class="btn btn-secondary" style="font-size:12px;padding:4px 12px;" onclick="playSound('${s.id}')">▶ 播放</button>
    </div>
  `).join('');
}

window.playSound = function(id) {
  const s = _sounds.find(x => x.id===id);
  if (!s) return;
  // Simulate playback — in real app would use Audio API
  const playBtn = document.getElementById('playBtn');
  const waveform = document.getElementById('waveform');
  if (playBtn) { playBtn.textContent = '⏸'; }
  if (waveform) { waveform.classList.add('playing'); }
  setTimeout(() => {
    if (playBtn) playBtn.textContent = '▶';
    if (waveform) waveform.classList.remove('playing');
  }, 3000);
};

/* ─── 录音功能 ─────────────────────────────────────────────── */

let _mediaRecorder = null;
let _audioChunks = [];

window.startVoiceRecording = function() {
  if (_mediaRecorder && _mediaRecorder.state==='recording') {
    _mediaRecorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('您的设备不支持录音功能');
    return;
  }
  navigator.mediaDevices.getUserMedia({ audio:true }).then(stream => {
    _audioChunks = [];
    _mediaRecorder = new MediaRecorder(stream);
    _mediaRecorder.ondataavailable = e => { if (e.data.size>0) _audioChunks.push(e.data); };
    _mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t=>t.stop());
      const blob = new Blob(_audioChunks, { type:'audio/webm' });
      // Show save dialog
      showSaveSoundDialog(blob);
    };
    _mediaRecorder.start();
    showToast('🎙️ 录音中... 点击麦克风停止');
    const btn = document.getElementById('recordSoundBtn');
    if (btn) btn.style.background = 'var(--danger)';
  }).catch(() => showToast('需要麦克风权限才能录音'));
};

function showSaveSoundDialog(blob) {
  const html = `
    <div style="position:fixed;inset:0;z-index:300;background:rgba(0,0,0,0.4);display:grid;place-items:center;padding:20px;" onclick="if(event.target===this)closeModal()">
      <div style="background:var(--surface);border-radius:16px;max-width:380px;width:100%;padding:24px;animation:slideUp 0.25s var(--ease);">
        <h3 style="font-family:var(--font-display);margin-bottom:16px;">保存录音</h3>
        <label style="font-size:13px;color:var(--muted);">名称</label>
        <input id="soundTitle" class="field-input" placeholder="示例：盐池北岸的鸟鸣" value="录音_${new Date().toLocaleDateString('zh-CN')}" style="display:block;width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;margin:4px 0 12px;font-size:14px;">
        <label style="font-size:13px;color:var(--muted);">生境</label>
        <select id="soundHabitat" class="field-input" style="display:block;width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;margin:4px 0 16px;font-size:14px;background:var(--surface);">
          <option>盐湖核心区</option><option>盐生草甸</option><option>芦苇湿地</option><option>街道绿化带</option><option>中条山麓</option><option>人工水域</option><option>农田边缘</option>
        </select>
        <div style="display:flex;gap:12px;justify-content:flex-end;">
          <button class="btn btn-secondary" onclick="closeModal()">取消</button>
          <button class="btn btn-primary" onclick="confirmSaveSound()">保存</button>
        </div>
      </div>
    </div>`;
  const m = document.createElement('div');
  m.id = 'saveSoundModal';
  m.innerHTML = html;
  document.body.appendChild(m);
  const btn = document.getElementById('recordSoundBtn');
  if (btn) btn.style.background = '';
}

window.confirmSaveSound = async function() {
  const title = document.getElementById('soundTitle')?.value||'未命名录音';
  const habitat = document.getElementById('soundHabitat')?.value||'未知';
  await saveSound({ title, habitat, duration:_audioChunks.length>0 ? '~10秒' : '未知' });
  _sounds = await getSounds();
  renderSoundMap();
  closeModal();
  showToast('✅ 声音记录已保存');
};

/* ════════════════════════════════════════════════════════════════
   6. 社区数据墙
   ════════════════════════════════════════════════════════════════ */

function renderDataWall() {
  renderLeaderboard();
  renderBlankZones();
}

function renderLeaderboard() {
  const el = document.getElementById('leaderboard');
  if (!el) return;
  el.innerHTML = `
    <div class="leader-item"><span class="leader-rank" style="color:var(--accent-gold);">🥇</span><span class="leader-name">观鸟达人 老王</span><span class="leader-count">47 条记录</span></div>
    <div class="leader-item"><span class="leader-rank" style="color:#a0a0a0;">🥈</span><span class="leader-name">盐湖小卫士 小林</span><span class="leader-count">38 条记录</span></div>
    <div class="leader-item"><span class="leader-rank" style="color:#c8a076;">🥉</span><span class="leader-name">中条山客 张老师</span><span class="leader-count">29 条记录</span></div>
    <div class="leader-item"><span class="leader-rank">4</span><span class="leader-name">生态观察员 小刘</span><span class="leader-count">21 条记录</span></div>
    <div class="leader-item"><span class="leader-rank">5</span><span class="leader-name">湿地守护者 李姐</span><span class="leader-count">16 条记录</span></div>
  `;
}

function renderBlankZones() {
  const el = document.getElementById('blankZones');
  if (!el) return;
  // Calculate which habitats have no observations
  const observedHabitats = new Set(_observations.map(o=>o.habitat).filter(Boolean));
  const allHabitats = ['盐湖核心区','盐生草甸','芦苇湿地','街道绿化带','中条山麓','人工水域','农田边缘','盐湖东南角','盐化工厂旧址','硝池滩','鸭子池'];
  const blankZones = allHabitats.filter(h => !observedHabitats.has(h));
  if (blankZones.length===0) {
    el.innerHTML = '<p style="color:var(--muted);font-size:13px;">🎉 太棒了！每个生境都有观测记录</p>';
    return;
  }
  el.innerHTML = blankZones.slice(0,5).map(h => `<span class="tag" style="font-size:11px;padding:4px 10px;border:1px solid var(--danger);border-radius:999px;color:var(--danger);">⬜ ${h} — 暂无记录</span>`).join('');
}

/* ════════════════════════════════════════════════════════════════
   7. 个人中心
   ════════════════════════════════════════════════════════════════ */

function renderPersonalCenter() {
  const el = document.getElementById('personalCenter');
  if (!el) return;
  const speciesSet = new Set(_observations.map(o=>o.species).filter(Boolean));
  const habitatsList = [...new Set(_observations.map(o=>o.habitat).filter(Boolean))];
  const mostCommonHabitat = habitatsList.sort((a,b) =>
    _observations.filter(o=>o.habitat===b).length - _observations.filter(o=>o.habitat===a).length
  )[0]||'尚未记录';

  const levelNames = ['初来乍到','生态行者','自然守护者','盐湖专家','生态大师'];
  const levelIdx = Math.min(_profile.level-1, levelNames.length-1);

  el.innerHTML = `
    <div class="personal-preview">
      <div class="personal-stat">
        <div class="ps-num num">${speciesSet.size}</div>
        <div class="ps-label">已记录物种数</div>
      </div>
      <div class="personal-stat">
        <div class="ps-num" style="font-size:16px;">${mostCommonHabitat}</div>
        <div class="ps-label">最常去生境</div>
        <div class="ps-sub">${_observations.filter(o=>o.habitat===mostCommonHabitat).length} 次观测</div>
      </div>
      <div class="personal-stat">
        <div class="ps-num num">${_profile.citationCount||0}</div>
        <div class="ps-label">记录被引用</div>
        <div class="ps-sub">${(_profile.citationCount||0)>0?'🔥 你的记录已被社区引用':'开始记录，贡献科学数据'}</div>
      </div>
      <div class="personal-stat">
        <div class="ps-num" style="font-size:24px;">${_profile.avatar} ${levelNames[levelIdx]}</div>
        <div class="ps-label">Lv.${_profile.level} · ${_profile.xp} XP</div>
        <div class="ps-sub">${_profile.taskCompleted||0} 个任务完成</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;justify-content:center;">
      <button class="btn btn-secondary" style="font-size:13px;" onclick="showAchievements()">🏅 徽章墙</button>
      <button class="btn btn-secondary" style="font-size:13px;" onclick="exportData()">📥 导出数据</button>
      <button class="btn btn-secondary" style="font-size:13px;" onclick="generatePDFReport()">📄 生成报告</button>
      <button class="btn btn-secondary" style="font-size:13px;" onclick="showEditProfile()">✏️ 编辑档案</button>
    </div>
  `;
}

window.showEditProfile = function() {
  const html = `
    <div style="position:fixed;inset:0;z-index:300;background:rgba(0,0,0,0.4);display:grid;place-items:center;padding:20px;" onclick="if(event.target===this)closeModal()">
      <div style="background:var(--surface);border-radius:16px;max-width:380px;width:100%;padding:24px;animation:slideUp 0.25s var(--ease);">
        <h3 style="font-family:var(--font-display);margin-bottom:16px;">编辑档案</h3>
        <label style="font-size:13px;color:var(--muted);">昵称</label>
        <input id="editNickname" class="field-input" value="${_profile.nickname}" style="display:block;width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;margin:4px 0 16px;font-size:14px;">
        <label style="font-size:13px;color:var(--muted);">头像</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 16px;" id="avatarPicker">
          ${['🧑‍🌾','🌿','🦩','🌊','⛰️','🌻','🦉','🔬'].map(a => `<span class="avatar-option" data-avatar="${a}" style="font-size:28px;cursor:pointer;padding:4px;border-radius:8px;${_profile.avatar===a?'border:2px solid var(--accent);':''}">${a}</span>`).join('')}
        </div>
        <div style="display:flex;gap:12px;justify-content:flex-end;">
          <button class="btn btn-secondary" onclick="closeModal()">取消</button>
          <button class="btn btn-primary" onclick="confirmEditProfile()">保存</button>
        </div>
      </div>
    </div>`;
  const m = document.createElement('div');
  m.id = 'editProfileModal';
  m.innerHTML = html;
  document.body.appendChild(m);
  // Avatar picker
  document.querySelectorAll('.avatar-option').forEach(el => {
    el.addEventListener('click', function() {
      document.querySelectorAll('.avatar-option').forEach(x => x.style.border='none');
      this.style.border = '2px solid var(--accent)';
    });
  });
};

window.confirmEditProfile = async function() {
  const nickname = document.getElementById('editNickname')?.value||'盐湖探索者';
  const selected = document.querySelector('.avatar-option[style*="var(--accent)"]');
  const avatar = selected?.dataset?.avatar||_profile.avatar;
  await updateProfile({ nickname, avatar });
  _profile = await getProfile();
  renderPersonalCenter();
  closeModal();
  showToast('✅ 档案已更新');
};

window.showAchievements = function() {
  const badges = _profile.badges?.length > 0 ? _profile.badges : ['初识盐湖'];
  const html = `
    <div style="position:fixed;inset:0;z-index:300;background:rgba(0,0,0,0.4);display:grid;place-items:center;padding:20px;" onclick="if(event.target===this)closeModal()">
      <div style="background:var(--surface);border-radius:16px;max-width:380px;width:100%;padding:24px;animation:slideUp 0.25s var(--ease);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="font-family:var(--font-display);">🏅 徽章墙</h3>
          <button style="width:32px;height:32px;border-radius:50%;background:var(--fg-soft);display:grid;place-items:center;font-size:18px;color:var(--muted);border:none;cursor:pointer;" onclick="closeModal()">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
          <div style="text-align:center;padding:12px;background:var(--accent-soft);border-radius:12px;opacity:${badges.includes('初识盐湖')?'1':'0.3'};"><div style="font-size:32px;">🌱</div><div style="font-size:12px;margin-top:4px;">初识盐湖</div></div>
          <div style="text-align:center;padding:12px;background:var(--green-soft);border-radius:12px;opacity:${badges.includes('生态行者')?'1':'0.3'};"><div style="font-size:32px;">🚶</div><div style="font-size:12px;margin-top:4px;">生态行者</div></div>
          <div style="text-align:center;padding:12px;background:var(--blue-soft);border-radius:12px;opacity:${badges.includes('观鸟达人')?'1':'0.3'};"><div style="font-size:32px;">🦅</div><div style="font-size:12px;margin-top:4px;">观鸟达人</div></div>
          <div style="text-align:center;padding:12px;background:var(--accent-soft);border-radius:12px;opacity:${badges.includes('湿地卫士')?'1':'0.3'};"><div style="font-size:32px;">🌾</div><div style="font-size:12px;margin-top:4px;">湿地卫士</div></div>
          <div style="text-align:center;padding:12px;background:var(--green-soft);border-radius:12px;opacity:${badges.includes('全境探索')?'1':'0.3'};"><div style="font-size:32px;">🗺</div><div style="font-size:12px;margin-top:4px;">全境探索</div></div>
          <div style="text-align:center;padding:12px;background:var(--accent-soft);border-radius:12px;opacity:0.3;"><div style="font-size:32px;">🏆</div><div style="font-size:12px;margin-top:4px;">生态大师</div></div>
        </div>
      </div>
    </div>`;
  const m = document.createElement('div');
  m.id = 'achievementModal';
  m.innerHTML = html;
  document.body.appendChild(m);
};

/* ════════════════════════════════════════════════════════════════
   观测记录流程
   ════════════════════════════════════════════════════════════════ */

function showRecordSheet() {
  const existing = document.getElementById('recordOptions');
  if (existing) { existing.remove(); document.getElementById('recordBackdrop')?.remove(); return; }
  const opts = document.createElement('div');
  opts.id = 'recordOptions';
  opts.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:200;background:var(--surface);border-radius:20px 20px 0 0;padding:24px 20px calc(24px+env(safe-area-inset-bottom));box-shadow:0 -4px 24px rgba(0,0,0,0.12);animation:slideUp 0.25s var(--ease);max-height:70vh;overflow-y:auto;';
  opts.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h3 style="font-family:var(--font-display);">选择记录方式</h3>
      <button id="closeRecord" style="width:32px;height:32px;border-radius:50%;background:var(--fg-soft);display:grid;place-items:center;font-size:18px;color:var(--muted);border:none;cursor:pointer;">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px;">
      <button class="btn btn-primary" style="justify-content:center;width:100%;" onclick="showCameraRecord()">📷 拍照记录</button>
      <button class="btn btn-secondary" style="justify-content:center;width:100%;" onclick="showTextRecord()">✏️ 文字记录</button>
      <p class="meta" style="text-align:center;margin-top:6px;">GPS · 时间自动抓取</p>
    </div>
  `;
  document.body.appendChild(opts);
  const backdrop = document.createElement('div');
  backdrop.id = 'recordBackdrop';
  backdrop.style.cssText = 'position:fixed;inset:0;z-index:199;background:rgba(0,0,0,0.3);animation:fadeIn 0.2s var(--ease);';
  backdrop.addEventListener('click', () => { opts.remove(); backdrop.remove(); });
  document.body.appendChild(backdrop);
  document.getElementById('closeRecord')?.addEventListener('click', () => { opts.remove(); backdrop.remove(); });
}

/* ─── 拍照记录 ─────────────────────────────────────────────── */

window.showCameraRecord = function() {
  closeRecordSheet();
  const html = `
    <div style="position:fixed;inset:0;z-index:300;background:rgba(0,0,0,0.4);display:grid;place-items:center;padding:20px;" onclick="if(event.target===this)closeModal()">
      <div style="background:var(--surface);border-radius:16px;max-width:420px;width:100%;padding:24px;max-height:85vh;overflow-y:auto;animation:slideUp 0.25s var(--ease);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="font-family:var(--font-display);">📷 拍照记录</h3>
          <button style="width:32px;height:32px;border-radius:50%;background:var(--fg-soft);display:grid;place-items:center;font-size:18px;color:var(--muted);border:none;cursor:pointer;" onclick="closeModal()">✕</button>
        </div>
        <div id="cameraPreview" style="width:100%;height:200px;background:var(--border);border-radius:12px;display:grid;place-items:center;color:var(--muted);overflow:hidden;">
          <p>📸 点击拍照</p>
        </div>
        <div style="display:flex;gap:8px;margin:12px 0;">
          <button class="btn btn-primary" style="flex:1;" onclick="takePhoto()">📸 拍照</button>
        </div>
        <div id="cameraForm" style="display:none;">
          <label style="font-size:13px;color:var(--muted);margin-top:8px;display:block;">物种名称</label>
          <input id="photoSpecies" class="field-input" list="speciesList" placeholder="选择或输入物种名" style="display:block;width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;margin:4px 0;font-size:14px;">
          <datalist id="speciesList">${_allSpecies.map(s=>`<option value="${s.name}">`).join('')}</datalist>
          <label style="font-size:13px;color:var(--muted);margin-top:8px;display:block;">生境类型</label>
          <select id="photoHabitat" style="display:block;width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;margin:4px 0;font-size:14px;background:var(--surface);">
            <option>盐湖核心区</option><option>盐生草甸</option><option>芦苇湿地</option><option>街道绿化带</option><option>中条山麓</option><option>人工水域</option><option>农田边缘</option>
          </select>
          <label style="font-size:13px;color:var(--muted);margin-top:8px;display:block;">生物类型</label>
          <select id="photoType" style="display:block;width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;margin:4px 0;font-size:14px;background:var(--surface);">
            <option>鸟类</option><option>维管束植物</option><option>昆虫</option><option>鱼类</option><option>浮游植物</option><option>浮游动物</option><option>底栖动物</option><option>微生物</option><option>其他</option>
          </select>
          <label style="font-size:13px;color:var(--muted);margin-top:8px;display:block;">备注</label>
          <textarea id="photoNote" rows="2" placeholder="数量、行为、特征等" style="display:block;width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;margin:4px 0;font-size:14px;resize:none;"></textarea>
          <div style="font-size:12px;color:var(--muted);margin:8px 0;">📍 GPS自动获取 · ${getWeatherEmoji()} · 🕐 ${new Date().toLocaleString('zh-CN')}</div>
          <button class="btn btn-primary" style="width:100%;" onclick="savePhotoRecord()">保存记录</button>
        </div>
      </div>
    </div>`;
  const m = document.createElement('div');
  m.id = 'cameraModal';
  m.innerHTML = html;
  document.body.appendChild(m);
};

window.takePhoto = function() {
  const preview = document.getElementById('cameraPreview');
  if (!preview) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    // Fallback: simulate camera
    preview.innerHTML = '<div style="font-size:64px;">🦩</div><p style="color:var(--muted);font-size:12px;">模拟拍照成功（实际需摄像头权限）</p>';
    document.getElementById('cameraForm').style.display = 'block';
    return;
  }
  // Real camera stream
  const video = document.createElement('video');
  video.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:12px;';
  video.autoplay = true;
  preview.innerHTML = '';
  preview.appendChild(video);
  // Start camera
  navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' }, audio:false }).then(stream => {
    video.srcObject = stream;
    // Add capture button
    const captureBtn = document.createElement('button');
    captureBtn.className = 'btn btn-primary';
    captureBtn.textContent = '📸 拍照';
    captureBtn.style.cssText = 'position:absolute;bottom:8px;left:50%;transform:translateX(-50%);z-index:10;';
    preview.style.position = 'relative';
    preview.appendChild(captureBtn);
    captureBtn.onclick = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video,0,0);
      stream.getTracks().forEach(t=>t.stop());
      preview.innerHTML = `<img src="${canvas.toDataURL('image/jpeg')}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">`;
      document.getElementById('cameraForm').style.display = 'block';
    };
  }).catch(() => {
    preview.innerHTML = '<div style="font-size:64px;">🦩</div><p style="color:var(--muted);font-size:12px;">无法访问摄像头，使用模拟拍照</p>';
    document.getElementById('cameraForm').style.display = 'block';
  });
};

window.savePhotoRecord = async function() {
  const species = document.getElementById('photoSpecies')?.value||'';
  const habitat = document.getElementById('photoHabitat')?.value||'';
  const type = document.getElementById('photoType')?.value||'';
  const note = document.getElementById('photoNote')?.value||'';
  if (!species) { showToast('请输入物种名称'); return; }
  const sp = _allSpecies.find(s=>s.name===species);
  const pos = await getCurrentPosition();
  const obs = {
    species: sp?.id||species,
    speciesName: species,
    habitat, type, note,
    lat: pos?.lat, lng: pos?.lng,
    emoji: sp?.emoji||'🌿',
    method: 'photo'
  };
  await saveObservation(obs);
  _observations = await getObservations();
  closeModal();
  renderAll();
  showToast('✅ 观测记录已保存！');
};

/* ─── 文字记录 ─────────────────────────────────────────────── */

window.showTextRecord = function() {
  closeRecordSheet();
  const html = `
    <div style="position:fixed;inset:0;z-index:300;background:rgba(0,0,0,0.4);display:grid;place-items:center;padding:20px;" onclick="if(event.target===this)closeModal()">
      <div style="background:var(--surface);border-radius:16px;max-width:420px;width:100%;padding:24px;max-height:85vh;overflow-y:auto;animation:slideUp 0.25s var(--ease);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="font-family:var(--font-display);">✏️ 文字记录</h3>
          <button style="width:32px;height:32px;border-radius:50%;background:var(--fg-soft);display:grid;place-items:center;font-size:18px;color:var(--muted);border:none;cursor:pointer;" onclick="closeModal()">✕</button>
        </div>
        <label style="font-size:13px;color:var(--muted);">物种名称</label>
        <input id="textSpecies" class="field-input" list="speciesListText" placeholder="输入物种名" style="display:block;width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;margin:4px 0;font-size:14px;">
        <datalist id="speciesListText">${_allSpecies.map(s=>`<option value="${s.name}">`).join('')}</datalist>
        <label style="font-size:13px;color:var(--muted);margin-top:8px;display:block;">生境类型</label>
        <select id="textHabitat" style="display:block;width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;margin:4px 0;font-size:14px;background:var(--surface);">
          <option>盐湖核心区</option><option>盐生草甸</option><option>芦苇湿地</option><option>街道绿化带</option><option>中条山麓</option><option>人工水域</option><option>农田边缘</option>
        </select>
        <label style="font-size:13px;color:var(--muted);margin-top:8px;display:block;">生物类型</label>
        <select id="textType" style="display:block;width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;margin:4px 0;font-size:14px;background:var(--surface);">
          <option>鸟类</option><option>维管束植物</option><option>昆虫</option><option>鱼类</option><option>浮游植物</option><option>浮游动物</option><option>底栖动物</option><option>微生物</option><option>其他</option>
        </select>
        <label style="font-size:13px;color:var(--muted);margin-top:8px;display:block;">生物事件（可选）</label>
        <select id="textEvent" style="display:block;width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;margin:4px 0;font-size:14px;background:var(--surface);">
          <option value="">无特殊事件</option><option>首次开花</option><option>候鸟抵达</option><option>卤虫爆发</option><option>火烈鸟现身</option><option>盐湖变红</option><option>其他</option>
        </select>
        <label style="font-size:13px;color:var(--muted);margin-top:8px;display:block;">描述</label>
        <textarea id="textNote" rows="3" placeholder="数量、行为、特征等" style="display:block;width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;margin:4px 0;font-size:14px;resize:none;"></textarea>
        <div style="font-size:12px;color:var(--muted);margin:8px 0;">📍 GPS自动获取 · ${getWeatherEmoji()} · 🕐 ${new Date().toLocaleString('zh-CN')}</div>
        <button class="btn btn-primary" style="width:100%;" onclick="saveTextRecord()">保存记录</button>
      </div>
    </div>`;
  const m = document.createElement('div');
  m.id = 'textModal';
  m.innerHTML = html;
  document.body.appendChild(m);
};

window.saveTextRecord = async function() {
  const species = document.getElementById('textSpecies')?.value||'';
  const habitat = document.getElementById('textHabitat')?.value||'';
  const type = document.getElementById('textType')?.value||'';
  const event = document.getElementById('textEvent')?.value||'';
  const note = document.getElementById('textNote')?.value||'';
  if (!species) { showToast('请输入物种名称'); return; }
  const sp = _allSpecies.find(s=>s.name===species);
  const pos = await getCurrentPosition();
  const obs = {
    species: sp?.id||species,
    speciesName: species,
    habitat, type, note,
    event: event||undefined,
    lat: pos?.lat, lng: pos?.lng,
    emoji: sp?.emoji||'🌿',
    method: 'text'
  };
  await saveObservation(obs);
  _observations = await getObservations();
  closeModal();
  renderAll();
  showToast('✅ 观测记录已保存！');
};

function closeRecordSheet() {
  document.getElementById('recordOptions')?.remove();
  document.getElementById('recordBackdrop')?.remove();
}

/* ════════════════════════════════════════════════════════════════
   导出与报告功能
   ════════════════════════════════════════════════════════════════ */

window.exportData = async function() {
  try {
    const csv = await exportObservationsCSV();
    const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `盐湖观测记录_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('✅ 数据已导出为CSV');
  } catch(e) {
    showToast('导出失败: '+e.message);
  }
};

window.generatePDFReport = async function() {
  const report = await generateReport();
  const html = `
    <div style="position:fixed;inset:0;z-index:300;background:rgba(0,0,0,0.4);display:grid;place-items:center;padding:20px;" onclick="if(event.target===this)closeModal()">
      <div style="background:var(--surface);border-radius:16px;max-width:420px;width:100%;padding:24px;max-height:80vh;overflow-y:auto;animation:slideUp 0.25s var(--ease);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="font-family:var(--font-display);">📄 我的盐池自然报告</h3>
          <button style="width:32px;height:32px;border-radius:50%;background:var(--fg-soft);display:grid;place-items:center;font-size:18px;color:var(--muted);border:none;cursor:pointer;" onclick="closeModal()">✕</button>
        </div>
        <div style="padding:16px;background:linear-gradient(135deg,var(--accent-soft),var(--green-soft));border-radius:12px;text-align:center;margin-bottom:12px;">
          <div style="font-size:48px;">🌿</div>
          <h4 style="margin:8px 0;">${report.nickname} 的自然档案</h4>
          <p style="font-size:12px;color:var(--muted);">生成于 ${report.generatedAt}</p>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div style="padding:12px;background:var(--accent-soft);border-radius:8px;text-align:center;"><div style="font-size:24px;font-weight:600;">${report.totalObs}</div><div style="font-size:12px;color:var(--muted);">观测总记录</div></div>
          <div style="padding:12px;background:var(--green-soft);border-radius:8px;text-align:center;"><div style="font-size:24px;font-weight:600;">${report.speciesCount}</div><div style="font-size:12px;color:var(--muted);">物种数</div></div>
          <div style="padding:12px;background:var(--blue-soft);border-radius:8px;text-align:center;"><div style="font-size:24px;font-weight:600;">${report.habitats.length}</div><div style="font-size:12px;color:var(--muted);">访问生境</div></div>
          <div style="padding:12px;background:var(--accent-soft);border-radius:8px;text-align:center;"><div style="font-size:24px;font-weight:600;">${report.citations}</div><div style="font-size:12px;color:var(--muted);">被引用次数</div></div>
        </div>
        <p style="font-size:12px;color:var(--muted);margin-top:12px;">首条记录: ${report.firstObs} · 最近: ${report.lastObs}</p>
        <button class="btn btn-primary" style="width:100%;margin-top:16px;" onclick="closeModal();exportData();showToast('📄 下载CSV数据供打印报告')">📥 下载数据</button>
      </div>
    </div>`;
  const m = document.createElement('div');
  m.id = 'reportModal';
  m.innerHTML = html;
  document.body.appendChild(m);
};

/* ════════════════════════════════════════════════════════════════
   Toast 通知
   ════════════════════════════════════════════════════════════════ */

function showToast(msg) {
  const existing = document.getElementById('toastMsg');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'toastMsg';
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);z-index:999;background:rgba(42,35,29,0.9);color:#fff;padding:10px 24px;border-radius:99px;font-size:14px;animation:fadeIn 0.2s var(--ease);white-space:nowrap;max-width:90vw;overflow:hidden;text-overflow:ellipsis;';
  document.body.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity 0.3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
}

/* ════════════════════════════════════════════════════════════════
   启动
   ════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  init().catch(e => console.error('Init error:', e));
});
