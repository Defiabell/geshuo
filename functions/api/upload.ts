/**
 * 网页录音投稿：把真人录的方言直接传上来，不用走 GitHub。
 *
 * 录音落到 R2（geshuo-recordings）。这里**只收不发**——没有任何读取接口，
 * 传上来的东西不会被公开访问到；审核在维护者本地做（pnpm recordings:pull）。
 *
 * ## 防滥用是分层的，任何一层都不指望单独扛住
 *
 * 1. **Turnstile**（最外层，也是最有效的一层）。没有有效且未用过的令牌一律
 *    拒绝。脚本批量刷的成本从"一个 for 循环"变成"要过人机验证"，这一层挡掉
 *    的量级远超其余所有层加起来。
 * 2. **运行时开关**（settings.uploads_enabled）。真被刷起来时，改一行 D1 就
 *    立刻关停，不用等一次部署——被刷的时候等构建是最难受的。
 * 3. **全站每日总量上限**。这一条是兜底：就算攻击者换一万个 IP 过了人机验证，
 *    今天也只能写进去这么多。**没有全局闸，按 IP 限流等于没限**。
 * 4. **单 IP 每日上限 + 最小间隔**。挡住手滑连点和单机脚本。
 * 5. **内容校验**：体积、声明的 MIME、**以及文件头魔数**——只信 content-type
 *    等于让人拿这个接口当免费网盘，塞什么都行。
 * 6. **元数据长度与格式**：sceneId/beatId 只收白名单字符，自由文本截断，
 *    避免有人往 R2 的 customMetadata 里灌垃圾。
 *
 * 计数从 R2 前缀列举换成了 D1：list 每次都要花一个操作，并发时还会超发。
 */

import { BEAT, SLUG, extFor, ipBucket, looksLikeAudio } from './_validate';

interface Env {
  RECORDINGS: R2Bucket;
  DB: D1Database;
  /** Turnstile 密钥。没配就拒收——宁可收不到投稿，也不要开着一个无保护的写接口 */
  TURNSTILE_SECRET?: string;
  UPLOAD_SALT?: string;
}

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_TEXT = 200;
/** 过了人机验证的，每 IP 每天可以传这么多 */
const IP_PER_DAY = 30;
/**
 * 没过人机验证的，每 IP 每天只给这么多。
 *
 * 为什么不是直接拒绝：这个站的投稿人主要在国内，而 challenges.cloudflare.com
 * 未必稳定可达。硬性要求人机验证，挡掉的恰恰是最该来投稿的老乡。
 * 所以降级放行——门开着，但开得小。数字定成 8 是有依据的：一出戏是 5 个说话拍，
 * 低于这个数的话，一个正常人连一场都录不完就被挡住了，那不叫限流叫拒收。
 */
const IP_PER_DAY_UNVERIFIED = 8;
const GLOBAL_PER_DAY = 500;
/** 两次上传之间的最小间隔（毫秒）。一拍几秒钟，正常人不会比这更快 */
const MIN_GAP_MS = 2000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

async function ipHash(request: Request, env: Env): Promise<string> {
  // 按桶而不是按完整地址：IPv6 下同一个人换个地址就是一个新配额，等于没限。
  const ip = ipBucket(request.headers.get('CF-Connecting-IP') ?? '');
  const data = new TextEncoder().encode(`${env.UPLOAD_SALT ?? 'geshuo-upload'}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

const clean = (v: FormDataEntryValue | null): string =>
  typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '';

async function verifyTurnstile(token: string, ip: string, secret: string): Promise<boolean> {
  const body = new FormData();
  body.set('secret', secret);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    if (!res.ok) return false;
    return ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    // 验证服务打不通时**拒绝**而不是放行——fail open 的闸门等于没有闸门
    return false;
  }
}

/**
 * 加一次并返回「加完之后的计数」和「**上一次**的时间」。一条语句搞定，
 * 避免读-改-写的竞态。
 *
 * prev_at 是一个专门的列，在 UPSERT 里由旧的 last_at 搬过来——
 * 踩过的坑：原来用 `RETURNING n, (SELECT last_at FROM ...)` 取上次时间，
 * 但那个子查询在更新**之后**才求值，取到的是刚写进去的 now()，于是间隔恒为 0，
 * 连第一次上传都会被"慢一点"拦掉。SQLite 的 RETURNING 看不到更新前的值。
 */
async function bump(env: Env, scope: string, day: string) {
  return env.DB.prepare(
    `INSERT INTO upload_quota (scope, day, n, last_at, prev_at)
     VALUES (?1, ?2, 1, datetime('now'), NULL)
     ON CONFLICT(scope, day) DO UPDATE SET
       n = n + 1,
       prev_at = last_at,
       last_at = datetime('now')
     RETURNING n, prev_at`,
  )
    .bind(scope, day)
    .first<{ n: number; prev_at: string | null }>();
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const enabled = await env.DB.prepare("SELECT value FROM settings WHERE key = 'uploads_enabled'")
    .first<{ value: string }>();
  if (enabled && enabled.value !== '1') {
    return json({ error: '投稿暂时关闭了，过阵子再来' }, 503);
  }

  // Content-Length 先挡一道：不合格的请求不该被读进内存
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES + 64 * 1024) {
    return json({ error: `录音超过 ${MAX_BYTES / 1024 / 1024}MB，一拍不该这么长` }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: '请求不是合法的 multipart/form-data' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  const token = clean(form.get('turnstile'));
  // 分级：过了验证的按正常额度，没过的按极小额度放行。
  // 令牌**存在但无效**（伪造、过期、重放）一律拒绝——那是明确的恶意信号，
  // 跟"根本拿不到令牌"（网络不通）是两回事，不能混为一谈。
  let verified = false;
  if (token && env.TURNSTILE_SECRET) {
    verified = await verifyTurnstile(token, ip, env.TURNSTILE_SECRET);
    // 令牌**存在但无效**（伪造、过期、重放）一律拒绝——那是明确的恶意信号。
    // 「根本没带令牌」是另一回事（网络不通），走下面的小额度放行。
    if (!verified) return json({ error: '人机验证没通过，刷新页面再试一次' }, 403);
  }

  const audio = form.get('audio');
  if (!(audio instanceof File)) return json({ error: '缺少录音文件' }, 400);
  if (audio.size === 0) return json({ error: '录音是空的' }, 400);
  if (audio.size > MAX_BYTES) {
    return json({ error: `录音超过 ${MAX_BYTES / 1024 / 1024}MB，一拍不该这么长` }, 413);
  }
  if (!audio.type.startsWith('audio/')) return json({ error: '只收音频文件' }, 415);

  const head = new Uint8Array(await audio.slice(0, 16).arrayBuffer());
  if (!looksLikeAudio(head)) {
    return json({ error: '这个文件看着不是音频' }, 415);
  }

  const place = clean(form.get('place'));
  if (!place) return json({ error: '得写清楚你是哪儿人——这份录音会挂到那个地方' }, 400);

  const sceneId = clean(form.get('sceneId'));
  const beatId = clean(form.get('beatId'));
  if (sceneId && !SLUG.test(sceneId)) return json({ error: 'sceneId 不合法' }, 400);
  if (beatId && !BEAT.test(beatId)) return json({ error: 'beatId 不合法' }, 400);

  const day = new Date().toISOString().slice(0, 10);
  const hash = await ipHash(request, env);

  const g = await bump(env, 'global', day);
  if ((g?.n ?? 0) > GLOBAL_PER_DAY) {
    return json({ error: '今天的投稿量已经到上限了，明天再来' }, 429);
  }

  const cap = verified ? IP_PER_DAY : IP_PER_DAY_UNVERIFIED;
  const mine = await bump(env, `ip:${hash}`, day);
  if ((mine?.n ?? 0) > cap) {
    return json(
      {
        error: verified
          ? '今天传得有点多，明天再来吧'
          : '今天的额度用完了。页面上的人机验证没加载出来时额度会很小——换个网络或刷新页面再试，能多传一些。',
      },
      429,
    );
  }
  if (mine?.prev_at) {
    const gap = Date.now() - Date.parse(`${mine.prev_at.replace(' ', 'T')}Z`);
    if (Number.isFinite(gap) && gap >= 0 && gap < MIN_GAP_MS) {
      return json({ error: '慢一点，喘口气再传' }, 429);
    }
  }

  const id = crypto.randomUUID();
  const key = `uploads/${day}/${hash}-${id}.${extFor(audio.type)}`;

  await env.RECORDINGS.put(key, audio.stream(), {
    httpMetadata: { contentType: audio.type },
    customMetadata: {
      place,
      sceneId,
      beatId,
      dialectId: clean(form.get('dialectId')),
      text: clean(form.get('text')),
      contact: clean(form.get('contact')),
      note: clean(form.get('note')),
      bytes: String(audio.size),
      uploadedAt: new Date().toISOString(),
      // 审听时能看出这条是不是过了人机验证——没过的要多留个心眼
      verified: verified ? 'yes' : 'no',
    },
  });

  return json({ ok: true, id });
};

/**
 * 兜底：不匹配的方法要明确回 405。不写这个的话 Pages 会把请求落到静态资源上，
 * GET /api/upload 会返回首页的 HTML 并带 200——不泄露数据，但会让调用方以为
 * 接口存在且成功了，排查起来很费时间。
 */
export const onRequest: PagesFunction = async ({ request }) =>
  new Response(JSON.stringify({ error: `${request.method} 不支持` }), {
    status: 405,
    headers: { 'content-type': 'application/json; charset=utf-8', allow: 'POST' },
  });
