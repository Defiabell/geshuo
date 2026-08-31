-- 脏话方言存废投票。一人一票靠 IP 哈希去重（不是强防刷，只是防误点重复计数）——
-- 这是个态度调查，不是选举，没必要为它上账号体系。
CREATE TABLE IF NOT EXISTS votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  choice     TEXT NOT NULL,          -- keep_raw / keep_marked / drop
  ip_hash    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS votes_one_per_ip ON votes(ip_hash);
