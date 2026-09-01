/**
 * 网页录音投稿：把真人录的方言直接传上来，不用走 GitHub。
 *
 * 录音落到 R2（geshuo-recordings），带上投稿人填的方言点和备注。这里**只
 * 收不发**——没有任何读取接口，传上来的东西不会被公开访问到，要经人听过、
 * 确认是本人本地口音，才会被放进 public/audio/ 并把那份演绎标成 human_recorded。
 *
 * 防滥用只做了三件成本最低、覆盖最实在的事：
 *   1. 体积上限 5MB、单次一个文件（一拍就几秒，5MB 绰绰有余）；
 *   2. 只收 audio/*；
 *   3. 同一 IP 每天最多 30 条——靠 R2 前缀列举实现，不额外引服务。
 * 这挡不住有心人，但挡得住脚本乱撞和手滑连点，对这个体量够了。
 */

interface Env {
  RECORDINGS: R2Bucket;
  UPLOAD_SALT?: string;
}

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PER_IP_PER_DAY = 30;
/** 投稿人填的自由文本字段的长度上限——防止有人把整本书塞进 metadata */
const MAX_TEXT = 200;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

async function ipHash(request: Request, env: Env): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const data = new TextEncoder().encode(`${env.UPLOAD_SALT ?? 'geshuo-upload'}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** 从 MIME 推扩展名。认不出来就存成 .bin——宁可文件名难看，也不要瞎猜一个错的容器格式 */
function extFor(type: string): string {
  if (type.includes('webm')) return 'webm';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'm4a';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  if (type.includes('wav')) return 'wav';
  return 'bin';
}

const clean = (v: FormDataEntryValue | null): string =>
  typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: '请求不是合法的 multipart/form-data' }, 400);
  }

  const audio = form.get('audio');
  if (!(audio instanceof File)) return json({ error: '缺少录音文件' }, 400);
  if (audio.size === 0) return json({ error: '录音是空的' }, 400);
  if (audio.size > MAX_BYTES) {
    return json({ error: `录音超过 ${MAX_BYTES / 1024 / 1024}MB，一拍不该这么长` }, 413);
  }
  if (!audio.type.startsWith('audio/')) {
    return json({ error: '只收音频文件' }, 415);
  }

  const place = clean(form.get('place'));
  if (!place) return json({ error: '得写清楚你是哪儿人——这份录音会挂到那个地方' }, 400);

  const day = new Date().toISOString().slice(0, 10);
  const hash = await ipHash(request, env);
  const prefix = `uploads/${day}/${hash}-`;

  const existing = await env.RECORDINGS.list({ prefix, limit: MAX_PER_IP_PER_DAY });
  if ((existing.objects?.length ?? 0) >= MAX_PER_IP_PER_DAY) {
    return json({ error: '今天传得有点多，明天再来吧' }, 429);
  }

  const id = crypto.randomUUID();
  const key = `${prefix}${id}.${extFor(audio.type)}`;

  await env.RECORDINGS.put(key, audio.stream(), {
    httpMetadata: { contentType: audio.type },
    customMetadata: {
      place,
      sceneId: clean(form.get('sceneId')),
      beatId: clean(form.get('beatId')),
      dialectId: clean(form.get('dialectId')),
      text: clean(form.get('text')),
      contact: clean(form.get('contact')),
      note: clean(form.get('note')),
      bytes: String(audio.size),
      uploadedAt: new Date().toISOString(),
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
