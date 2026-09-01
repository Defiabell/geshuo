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
