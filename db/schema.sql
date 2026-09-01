-- 脏话方言存废投票。一人一票靠 IP 哈希去重（不是强防刷，只是防误点重复计数）——
-- 这是个态度调查，不是选举，没必要为它上账号体系。
CREATE TABLE IF NOT EXISTS votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  choice     TEXT NOT NULL,          -- keep_raw / keep_marked / drop
  ip_hash    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS votes_one_per_ip ON votes(ip_hash);

-- 盲听猜方言。这张表的真正用途不是排行榜，是**众包质检**：
-- 如果冀鲁官话那条有 70% 的人猜成东北话，那就是硬证据，说明那条 AI 口音不对。
-- 不需要专家、不需要问卷，游戏玩下来数据就有了。
CREATE TABLE IF NOT EXISTS guesses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  clip       TEXT NOT NULL,          -- 形如 late-night.jilu/b1
  actual     TEXT NOT NULL,          -- 真实方言 id，服务端从 clip 解析，不信客户端
  guessed    TEXT NOT NULL,
  correct    INTEGER NOT NULL,
  ip_hash    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS guesses_clip ON guesses(clip);

-- 上传防滥用。R2 前缀列举那套计数被换掉了：它每次上传要花一个 list 操作、
-- 并发时会超发，而且只能按 IP 挡——换个网络就绕过去了。
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- 运行时开关：被刷的时候不用重新部署就能关掉上传
INSERT OR IGNORE INTO settings (key, value) VALUES ('uploads_enabled', '1');

CREATE TABLE IF NOT EXISTS upload_quota (
  scope   TEXT NOT NULL,   -- 'global' 或 'ip:<hash>'
  day     TEXT NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  last_at TEXT,
  -- 上一次的时间。必须是独立的列：SQLite 的 RETURNING 看不到更新前的值，
  -- 用子查询取会取到刚写进去的 now()，导致最小间隔判断恒为 0
  prev_at TEXT,
  PRIMARY KEY (scope, day)
);
