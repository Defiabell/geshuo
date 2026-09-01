/**
 * 脏话方言存废投票。
 *
 * 这不是选举，是态度调查——所以没有账号体系，一人一票靠 IP 哈希去重，
 * 只为了防止误点重复计数，不假装能防刷。IP 不落库，只存 sha256 摘要。
 *
 * GET  /api/vote  → 各选项计票
 * POST /api/vote  → { choice } 记一票（同一 IP 再投会改票，不会累加）
 */

interface Env {
  DB: D1Database;
  /** 可选：给 IP 哈希加盐。没配就用下面的默认值——摘要只为不落明文 IP，不是密码 */
  VOTE_SALT?: string;
}

const CHOICES = ['keep_raw', 'keep_marked', 'drop'] as const;
type Choice = (typeof CHOICES)[number];

async function ipHash(request: Request, env: Env): Promise<string> {
  // CF-Connecting-IP 由 Cloudflare 边缘写入，客户端伪造不了
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const data = new TextEncoder().encode(`${env.VOTE_SALT ?? 'geshuo-vote'}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function tally(env: Env) {
  const { results } = await env.DB.prepare(
    'SELECT choice, COUNT(*) AS n FROM votes GROUP BY choice',
  ).all<{ choice: string; n: number }>();
  const counts: Record<string, number> = { keep_raw: 0, keep_marked: 0, drop: 0 };
  for (const r of results ?? []) {
    if (r.choice in counts) counts[r.choice] = r.n;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, total };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export const onRequestGet: PagesFunction<Env> = async ({ env }) => json(await tally(env));

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let choice: unknown;
  try {
    ({ choice } = (await request.json()) as { choice?: unknown });
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400);
  }
  if (typeof choice !== 'string' || !CHOICES.includes(choice as Choice)) {
    return json({ error: `choice 必须是 ${CHOICES.join(' / ')} 之一` }, 400);
  }

  const hash = await ipHash(request, env);
  // 同一 IP 再投视为改票——ON CONFLICT 更新而不是插入第二行，
  // 否则改主意的人会被计两票，而这正是这种小样本调查最容易被质疑的地方。
  await env.DB.prepare(
    `INSERT INTO votes (choice, ip_hash) VALUES (?1, ?2)
     ON CONFLICT(ip_hash) DO UPDATE SET choice = ?1, created_at = datetime('now')`,
  )
    .bind(choice, hash)
    .run();

  return json({ ok: true, ...(await tally(env)) });
};

/**
 * 兜底：不匹配的方法要明确回 405。不写这个的话 Pages 会把请求落到静态资源上，
 * GET /api/upload 会返回首页的 HTML 并带 200——不泄露数据，但会让调用方以为
 * 接口存在且成功了，排查起来很费时间。
 */
export const onRequest: PagesFunction = async ({ request }) =>
  new Response(JSON.stringify({ error: `${request.method} 不支持` }), {
    status: 405,
    headers: { 'content-type': 'application/json; charset=utf-8', allow: 'GET, POST' },
  });
