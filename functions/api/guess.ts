/**
 * 盲听猜方言的记分与统计。
 *
 * 这个接口的真正价值不是排行榜，是**众包质检**。站上所有 AI 语音都标着
 * 「未经母语者校对」，因为没人验证过那口音像不像。而如果一千个人盲听，
 * 冀鲁官话那条有 70% 被猜成东北话——那就是硬证据，说明那条不对。
 * 不需要专家、不需要问卷，游戏玩下来数据就有了。
 *
 * POST /api/guess  { clip, guessed } → 记一次，返回这条的正确率
 * GET  /api/guess  → 最容易被认错的几条（就是最该被真人录音替换的几条）
 */

interface Env {
  DB: D1Database;
  GUESS_SALT?: string;
}

/**
 * 已知方言 id。服务端**不信客户端报的 actual**——真实答案从 clip id 解析
 * （clip 形如 `late-night.jilu/b1`，演绎 id 是 `{场景}.{方言}`），否则任何人
 * 都能往统计里灌垃圾，而这份统计正是要拿来判断音准的。
 *
 * 这份清单必须和 src/data/dialects.yaml 里有演绎的方言保持一致，
 * tests/guess-allowlist.test.ts 会在构建期盯着它别漂移。
 */
const KNOWN = ['jilu', 'jiaoliao', 'chengyu', 'dongbei', 'yue'] as const;

const MAX_PER_IP_PER_DAY = 500;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

async function ipHash(request: Request, env: Env): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const data = new TextEncoder().encode(`${env.GUESS_SALT ?? 'geshuo-guess'}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** 从 `late-night.jilu/b1` 解析出 `jilu`。解析不出或不在清单里就返回 null */
function dialectOf(clip: string): string | null {
  const perfId = clip.split('/')[0] ?? '';
  const dialect = perfId.split('.').pop() ?? '';
  return (KNOWN as readonly string[]).includes(dialect) ? dialect : null;
}

async function clipStats(env: Env, clip: string) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS total, SUM(correct) AS hit FROM guesses WHERE clip = ?1',
  )
    .bind(clip)
    .first<{ total: number; hit: number | null }>();
  const total = row?.total ?? 0;
  const hit = row?.hit ?? 0;
  return { total, hit, rate: total > 0 ? Math.round((hit / total) * 100) : null };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { clip?: unknown; guessed?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }
  const clip = typeof body.clip === 'string' ? body.clip.slice(0, 120) : '';
  const guessed = typeof body.guessed === 'string' ? body.guessed : '';

  const actual = dialectOf(clip);
  if (!actual) return json({ error: 'clip 不合法' }, 400);
  if (!(KNOWN as readonly string[]).includes(guessed)) return json({ error: 'guessed 不合法' }, 400);

  const hash = await ipHash(request, env);
  const today = new Date().toISOString().slice(0, 10);
  const used = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM guesses WHERE ip_hash = ?1 AND date(created_at) = ?2",
  )
    .bind(hash, today)
    .first<{ n: number }>();
  if ((used?.n ?? 0) >= MAX_PER_IP_PER_DAY) {
    return json({ error: '今天玩得有点多，明天再来' }, 429);
  }

  await env.DB.prepare(
    'INSERT INTO guesses (clip, actual, guessed, correct, ip_hash) VALUES (?1, ?2, ?3, ?4, ?5)',
  )
    .bind(clip, actual, guessed, guessed === actual ? 1 : 0, hash)
    .run();

  return json({ ok: true, actual, correct: guessed === actual, stats: await clipStats(env, clip) });
};

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  // 最容易被认错的几条 —— 也就是最该优先被真人录音替换掉的几条。
  // 样本少于 5 次的不算，两三个人猜错说明不了什么。
  const { results } = await env.DB.prepare(
    `SELECT clip, actual, COUNT(*) AS total, SUM(correct) AS hit
     FROM guesses GROUP BY clip HAVING total >= 5
     ORDER BY (CAST(SUM(correct) AS REAL) / COUNT(*)) ASC LIMIT 6`,
  ).all<{ clip: string; actual: string; total: number; hit: number }>();

  const worst = (results ?? []).map((r) => ({
    clip: r.clip,
    actual: r.actual,
    total: r.total,
    rate: Math.round((r.hit / r.total) * 100),
  }));
  const all = await env.DB.prepare('SELECT COUNT(*) AS n FROM guesses').first<{ n: number }>();
  return json({ worst, total: all?.n ?? 0 });
};

export const onRequest: PagesFunction = async ({ request }) =>
  new Response(JSON.stringify({ error: `${request.method} 不支持` }), {
    status: 405,
    headers: { 'content-type': 'application/json; charset=utf-8', allow: 'GET, POST' },
  });
