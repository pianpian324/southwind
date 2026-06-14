-- ════════════════════════════════════════════════════════════════════
-- 盐湖记 · 社区版数据库迁移
-- 在 Supabase SQL Editor 中执行本脚本
-- ════════════════════════════════════════════════════════════════════

-- ── 1. 物种库 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS species (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,          -- 鸟类 / 维管束植物 / 浮游动物 / 浮游植物 / 昆虫 / 鱼类 / 底栖动物 / 微生物
  habitat     TEXT[] NOT NULL DEFAULT '{}',
  description TEXT NOT NULL DEFAULT '',
  season      TEXT NOT NULL DEFAULT '', -- 全年 / 春夏 / 夏秋 / 秋冬 / 春秋 / 冬季
  rarity      TEXT NOT NULL DEFAULT 'common',  -- common / uncommon / rare
  emoji       TEXT NOT NULL DEFAULT '🌿',
  similar     TEXT[] NOT NULL DEFAULT '{}',     -- 相似物种名称列表
  tags        TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. 观测记录 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS observations (
  id           TEXT PRIMARY KEY,
  device_id    UUID NOT NULL DEFAULT auth.uid(),
  species_id   TEXT REFERENCES species(id),
  species_name TEXT NOT NULL DEFAULT '',
  habitat      TEXT NOT NULL DEFAULT '',
  bio_type     TEXT NOT NULL DEFAULT '',        -- 鸟类/维管束植物/昆虫/鱼类/浮游植物/浮游动物/底栖动物/微生物/其他
  note         TEXT NOT NULL DEFAULT '',
  bio_event    TEXT,                            -- 首次开花/候鸟抵达/卤虫爆发/火烈鸟现身/盐湖变红/其他
  photo_url    TEXT,                            -- Supabase Storage 公开 URL
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  method       TEXT NOT NULL DEFAULT 'text',    -- photo / text
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_obs_device    ON observations (device_id);
CREATE INDEX idx_obs_created   ON observations (created_at DESC);
CREATE INDEX idx_obs_habitat   ON observations (habitat);
CREATE INDEX idx_obs_species   ON observations (species_id);

-- ── 3. 声音记录 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sounds (
  id          TEXT PRIMARY KEY,
  device_id   UUID NOT NULL DEFAULT auth.uid(),
  title       TEXT NOT NULL DEFAULT '未命名录音',
  habitat     TEXT NOT NULL DEFAULT '',
  audio_url   TEXT,
  duration    TEXT NOT NULL DEFAULT '',          -- 如 "~10秒"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sounds_device  ON sounds (device_id);
CREATE INDEX idx_sounds_created ON sounds (created_at DESC);

-- ── 4. 用户档案 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  device_id      UUID PRIMARY KEY DEFAULT auth.uid(),
  nickname       TEXT NOT NULL DEFAULT '盐湖探索者',
  avatar         TEXT NOT NULL DEFAULT '🧑‍🌾',
  xp             INT NOT NULL DEFAULT 0,
  level          INT NOT NULL DEFAULT 1,
  badges         TEXT[] NOT NULL DEFAULT '{}',
  habitats       JSONB NOT NULL DEFAULT '{}',    -- { "盐湖核心区": 12, "中条山麓": 5, ... }
  citation_count INT NOT NULL DEFAULT 0,
  task_completed INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 5. 任务定义 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id        TEXT PRIMARY KEY,
  title     TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  habitat   TEXT NOT NULL DEFAULT '',
  icon      TEXT NOT NULL DEFAULT '🌿',
  xp        INT NOT NULL DEFAULT 0,
  category  TEXT NOT NULL DEFAULT '节气',        -- 节气 / 区域
  goal      INT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0
);

-- ── 6. 任务进度（每设备独立追踪） ──────────────────────────────────
CREATE TABLE IF NOT EXISTS task_progress (
  id         TEXT PRIMARY KEY,                   -- {device_id}_{task_id}
  device_id  UUID NOT NULL DEFAULT auth.uid(),
  task_id    TEXT NOT NULL REFERENCES tasks(id),
  progress   INT NOT NULL DEFAULT 0,
  completed  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, task_id)
);

CREATE INDEX idx_tp_device ON task_progress (device_id);

-- ── 7. 社区投票（物种辨识互助） ────────────────────────────────────
CREATE TABLE IF NOT EXISTS community_votes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  device_id   UUID NOT NULL DEFAULT auth.uid(),
  vote_option TEXT NOT NULL,                     -- e.g. "是盐藻" / "是卤虫" / "其他原因"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (observation_id, device_id)             -- 每人每条只能投一次
);

-- ════════════════════════════════════════════════════════════════════
-- RLS 策略
-- ════════════════════════════════════════════════════════════════════

-- 启用所有表的 RLS
ALTER TABLE species          ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sounds           ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_progress    ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_votes  ENABLE ROW LEVEL SECURITY;

-- ── species: 所有人可读 ────────────────────────────────────────────
DROP POLICY IF EXISTS species_read ON species;
CREATE POLICY species_read ON species
  FOR SELECT USING (true);

-- ── observations: 所有人可读，本人可写 ─────────────────────────────
DROP POLICY IF EXISTS obs_read ON observations;
CREATE POLICY obs_read ON observations
  FOR SELECT USING (true);

DROP POLICY IF EXISTS obs_insert ON observations;
CREATE POLICY obs_insert ON observations
  FOR INSERT WITH CHECK (device_id = auth.uid());

DROP POLICY IF EXISTS obs_update ON observations;
CREATE POLICY obs_update ON observations
  FOR UPDATE USING (device_id = auth.uid());

DROP POLICY IF EXISTS obs_delete ON observations;
CREATE POLICY obs_delete ON observations
  FOR DELETE USING (device_id = auth.uid());

-- ── sounds: 所有人可读，本人可写 ───────────────────────────────────
DROP POLICY IF EXISTS sounds_read ON sounds;
CREATE POLICY sounds_read ON sounds
  FOR SELECT USING (true);

DROP POLICY IF EXISTS sounds_insert ON sounds;
CREATE POLICY sounds_insert ON sounds
  FOR INSERT WITH CHECK (device_id = auth.uid());

DROP POLICY IF EXISTS sounds_update ON sounds;
CREATE POLICY sounds_update ON sounds
  FOR UPDATE USING (device_id = auth.uid());

-- ── profiles: 所有人可读（社区达人榜），本人可写 ──────────────────
DROP POLICY IF EXISTS profiles_read ON profiles;
CREATE POLICY profiles_read ON profiles
  FOR SELECT USING (true);

DROP POLICY IF EXISTS profiles_insert ON profiles;
CREATE POLICY profiles_insert ON profiles
  FOR INSERT WITH CHECK (device_id = auth.uid());

DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles
  FOR UPDATE USING (device_id = auth.uid());

-- ── tasks: 所有人可读 ──────────────────────────────────────────────
DROP POLICY IF EXISTS tasks_read ON tasks;
CREATE POLICY tasks_read ON tasks
  FOR SELECT USING (true);

-- ── task_progress: 本人可读写 ──────────────────────────────────────
DROP POLICY IF EXISTS tp_read ON task_progress;
CREATE POLICY tp_read ON task_progress
  FOR SELECT USING (device_id = auth.uid());

DROP POLICY IF EXISTS tp_insert ON task_progress;
CREATE POLICY tp_insert ON task_progress
  FOR INSERT WITH CHECK (device_id = auth.uid());

DROP POLICY IF EXISTS tp_update ON task_progress;
CREATE POLICY tp_update ON task_progress
  FOR UPDATE USING (device_id = auth.uid());

-- ── community_votes: 所有人可读，本人可写 ──────────────────────────
DROP POLICY IF EXISTS votes_read ON community_votes;
CREATE POLICY votes_read ON community_votes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS votes_insert ON community_votes;
CREATE POLICY votes_insert ON community_votes
  FOR INSERT WITH CHECK (device_id = auth.uid());

-- ════════════════════════════════════════════════════════════════════
-- 种子数据
-- ════════════════════════════════════════════════════════════════════

-- ── 11 种盐湖特色物种 ──────────────────────────────────────────────
INSERT INTO species (id, name, category, habitat, description, season, rarity, emoji, similar, tags)
VALUES
  ('sp_1', '大红鹳（火烈鸟）', '鸟类',
   '{"盐湖核心区","人工水域"}',
   '每年10月下旬抵达运城盐湖，停留至次年4月。以卤虫为食，体羽呈朱红色。',
   '秋冬', 'common', '🦩', '{"白琵鹭"}', '{"候鸟","旗舰种"}'),

  ('sp_2', '盐地碱蓬', '维管束植物',
   '{"盐生草甸","盐湖核心区"}',
   '一年生草本，耐盐碱。秋季叶片变红，形成"红海滩"景观。是盐湖生态指示物种。',
   '夏秋', 'common', '🌿', '{"盐角草"}', '{"指示物种","耐盐"}'),

  ('sp_3', '卤虫（丰年虾）', '浮游动物',
   '{"盐湖核心区"}',
   '盐湖关键物种，高盐度水体中大量繁殖。是火烈鸟的主要食物来源。',
   '春夏', 'common', '🦐', '{}', '{"关键种","饵料生物"}'),

  ('sp_4', '黑鹳', '鸟类',
   '{"中条山麓","人工水域"}',
   '国家一级保护动物，体长约1米。在运城盐湖周边有稳定越冬种群。',
   '秋冬', 'rare', '🦅', '{"白鹳"}', '{"保护动物","候鸟"}'),

  ('sp_5', '盐角草', '维管束植物',
   '{"盐生草甸","盐湖核心区"}',
   '肉质茎叶，高度耐盐。与盐地碱蓬相似但茎节明显，秋季变红较晚。',
   '夏秋', 'common', '🌱', '{"盐地碱蓬"}', '{"耐盐","肉质植物"}'),

  ('sp_6', '白琵鹭', '鸟类',
   '{"芦苇湿地","人工水域"}',
   '大型涉禽，嘴长而扁平呈匙状。在运城盐湖湿地常见，以小鱼虾为食。',
   '春秋', 'uncommon', '🕊', '{"大红鹳（火烈鸟）"}', '{"涉禽","候鸟"}'),

  ('sp_7', '短耳鸮', '鸟类',
   '{"盐生草甸","街道绿化带"}',
   '中型猫头鹰，白天活动。在盐湖周边草甸和农田边缘常见。',
   '全年', 'uncommon', '🦉', '{"长耳鸮"}', '{"猛禽"}'),

  ('sp_8', '芦苇', '维管束植物',
   '{"芦苇湿地","人工水域"}',
   '多年生禾草，是盐湖湿地的主要建群种。为多种鸟类提供栖息和筑巢场所。',
   '全年', 'common', '🎋', '{}', '{"建群种","湿地植物"}'),

  ('sp_9', '白尾海雕', '鸟类',
   '{"盐湖核心区","中条山麓"}',
   '国家一级保护动物，大型猛禽。冬季在盐湖上空盘旋，捕食水鸟。',
   '冬季', 'rare', '🦅', '{"金雕"}', '{"保护动物","猛禽"}'),

  ('sp_10', '小球藻', '浮游植物',
   '{"盐湖核心区","人工水域"}',
   '单细胞绿藻，在高盐度水体中大量繁殖，使水体呈绿色。盐湖初级生产者。',
   '春夏', 'common', '🟢', '{"螺旋藻"}', '{"初级生产者","藻类"}'),

  ('sp_11', '盐藻（杜氏藻）', '浮游植物',
   '{"盐湖核心区"}',
   '耐高盐的绿色微藻，在特定条件下积累β-胡萝卜素使水体变红。"盐湖变红"主因。',
   '夏秋', 'common', '🔴', '{"小球藻"}', '{"指示物种","藻类"}')
ON CONFLICT (id) DO NOTHING;

-- ── 6 个节气/区域任务 ─────────────────────────────────────────────
INSERT INTO tasks (id, title, description, habitat, icon, xp, category, goal, sort_order)
VALUES
  ('task_1', '冬至候鸟普查', '记录3种以上候鸟', '盐湖核心区', '🦆', 50, '节气', 3, 1),
  ('task_2', '惊蛰昆虫苏醒', '找到5种昆虫', '街道绿化带', '🐛', 40, '节气', 5, 2),
  ('task_3', '芒种盐藻观察', '记录盐藻爆发迹象', '盐湖核心区', '🔬', 60, '节气', 1, 3),
  ('task_4', '湿地寻踪', '在芦苇湿地记录5种生物', '芦苇湿地', '🌾', 45, '区域', 5, 4),
  ('task_5', '山麓探秘', '在中条山麓记录3种鸟类', '中条山麓', '⛰', 55, '区域', 3, 5),
  ('task_6', '全梯度观测', '完成全部7个生境类型记录', '全部', '🏆', 100, '区域', 7, 6)
ON CONFLICT (id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- Storage Buckets（需要在 Supabase 控制台手动创建，或使用 API）
-- ════════════════════════════════════════════════════════════════════

-- 注意：Storage bucket 和其 RLS 策略无法在 SQL Editor 中创建。
-- 请在 Supabase Dashboard → Storage 中手动创建以下 buckets：
--
--   1. observation-photos  (Public bucket: 所有人可读)
--   2. sound-recordings    (Public bucket: 所有人可读)
--
-- 并为每个 bucket 添加 RLS 策略：
--   - SELECT: true（所有人可读）
--   - INSERT: auth.uid() = (storage.foldername(name))[1]::uuid（本人可上传）
--
-- 或者在后端使用 Supabase Management API / CLI 创建。

-- ════════════════════════════════════════════════════════════════════
-- 辅助函数 & 触发器
-- ════════════════════════════════════════════════════════════════════

-- ── 自动更新 profiles.updated_at ───────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profiles_updated ON profiles;
CREATE TRIGGER trg_profiles_updated
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 观测记录后自动更新用户档案统计 ─────────────────────────────────
CREATE OR REPLACE FUNCTION on_observation_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- 更新 profiles 中的 habitats JSON 计数
  UPDATE profiles
  SET
    habitats = jsonb_set(
      COALESCE(habitats, '{}'::jsonb),
      ARRAY[NEW.habitat],
      to_jsonb(COALESCE((habitats->>NEW.habitat)::int, 0) + 1)
    ),
    updated_at = now()
  WHERE device_id = NEW.device_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_obs_insert ON observations;
CREATE TRIGGER trg_obs_insert
  AFTER INSERT ON observations
  FOR EACH ROW EXECUTE FUNCTION on_observation_insert();

-- ════════════════════════════════════════════════════════════════════
-- 匿名用户自动创建 profile 触发器
-- 当用户首次通过 signInAnonymously() 创建 auth.users 记录时，
-- 自动为其创建一条 profiles 记录
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION handle_new_anon_user()
RETURNS TRIGGER AS $$
DECLARE
  rand_emoji TEXT;
BEGIN
  rand_emoji := (ARRAY['🌿','🌸','🍃','🌾','🦋','🐝','🦗','🕊','🌺','🍀'])[floor(random()*10)+1];
  INSERT INTO profiles (device_id, nickname, avatar, xp, level, badges, habitats, citation_count, task_completed)
  VALUES (
    NEW.id,
    '盐湖探索者_' || substr(NEW.id::text, 1, 6),
    rand_emoji,
    0, 1, '{}', '{}', 0, 0
  )
  ON CONFLICT (device_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_anon_user();
