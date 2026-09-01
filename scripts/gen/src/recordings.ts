import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { loadScenes } from '../../../src/lib/content';
import type { Performance } from '../../../src/lib/types';

/**
 * 投稿录音的取回与试听。
 *
 * 上传接口只收不发（没有任何读取路由），所以录音**只能从这里取**——这是
 * 刻意的：投稿人录的是自己的声音，不该挂在公网上任人下载。审核在本地做。
 *
 *   pnpm recordings:pull        取回全部 + 生成本地审听台 .inbox/index.html
 *   pnpm recordings:rm <前缀>    从 R2 删掉一条（垃圾投稿）
 *
 * .inbox/ 已 gitignore：里面是别人的声音和联系方式，绝不能进仓库。
 */

const ACCOUNT = 'c9486e31336f16e6de4c5bf063b94628';
const BUCKET = 'geshuo-recordings';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const INBOX = join(ROOT, '.inbox');
const DATA_DIR = join(ROOT, 'src/data/');

interface R2Object {
  key: string;
  size: number;
  last_modified: string;
  http_metadata?: { contentType?: string };
  custom_metadata?: Record<string, string>;
}

function token(): string {
  const t = process.env.CLOUDFLARE_API_TOKEN;
  if (!t) {
    throw new Error(
      '缺 CLOUDFLARE_API_TOKEN——先 `set -a; . ../../envs/cloudflare.env; set +a` 再跑',
    );
  }
  return t;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token()}`, ...(init.headers ?? {}) },
  });
  return res;
}

async function listAll(): Promise<R2Object[]> {
  const out: R2Object[] = [];
  let cursor = '';
  // 分页取完——只取第一页的话，投稿一多就会悄悄漏掉后面的
  for (;;) {
    const qs = new URLSearchParams({ per_page: '1000', ...(cursor ? { cursor } : {}) });
    const res = await api(`/r2/buckets/${BUCKET}/objects?${qs}`);
    if (!res.ok) throw new Error(`列举失败 ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as {
      result: R2Object[];
      result_info?: { cursor?: string };
    };
    out.push(...(body.result ?? []));
    cursor = body.result_info?.cursor ?? '';
    if (!cursor) break;
  }
  return out.sort((a, b) => (a.last_modified < b.last_modified ? 1 : -1));
}

/** 从 key 里取一个短 id 给人念：uploads/日期/iphash-uuid.ext → uuid 前 8 位 */
function shortId(key: string): string {
  const file = key.split('/').pop() ?? key;
  const uuid = file.split('-').slice(1).join('-').replace(/\.[^.]+$/, '');
  return uuid.slice(0, 8);
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** 站上同一拍各方言的 AI 版本，拿来跟真人录音对照着听 */
function aiVersionsFor(sceneId: string, beatId: string) {
  const dir = join(DATA_DIR, 'performances');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => parse(readFileSync(join(dir, f), 'utf8')) as Performance)
    .filter((p) => p.sceneId === sceneId && p.source === 'tts')
    .map((p) => ({ id: p.id, dialectId: p.dialectId, audio: p.lines.find((l) => l.beatId === beatId)?.audio }))
    .filter((x): x is { id: string; dialectId: string; audio: string } => Boolean(x.audio));
}

async function pull() {
  mkdirSync(INBOX, { recursive: true });
  const objects = await listAll();
  if (objects.length === 0) {
    console.log('R2 里还没有投稿录音。');
    return;
  }

  const scenes = loadScenes(DATA_DIR);
  const rows: string[] = [];
  let downloaded = 0;

  for (const o of objects) {
    const id = shortId(o.key);
    const ext = o.key.split('.').pop() ?? 'bin';
    const local = `${id}.${ext}`;
    const dest = join(INBOX, local);

    if (!existsSync(dest)) {
      const res = await api(`/r2/buckets/${BUCKET}/objects/${encodeURIComponent(o.key)}`);
      if (!res.ok) { console.warn(`✗ ${id} 下载失败 ${res.status}`); continue; }
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      downloaded += 1;
    }

    const m = o.custom_metadata ?? {};
    const scene = m.sceneId ? scenes.get(m.sceneId) : undefined;
    const beat = scene?.beats.find((b) => b.id === m.beatId);
    const ai = m.sceneId && m.beatId ? aiVersionsFor(m.sceneId, m.beatId) : [];

    rows.push(`
<article class="rec" data-id="${esc(id)}" data-key="${esc(o.key)}">
  <header>
    <span class="id">${esc(id)}</span>
    <span class="place">${esc(m.place || '（没填地点）')}</span>
    <span class="when">${esc(o.last_modified.replace('T', ' ').slice(0, 16))}</span>
    <span class="size">${(o.size / 1024).toFixed(0)} KB</span>
  </header>
  <div class="where">${esc(scene?.title ?? (m.sceneId || '未知场景'))} · 第 ${beat?.order ?? '?'} 拍 ${beat ? `· ${esc(beat.intent)}` : ''}</div>
  ${m.text ? `<p class="said">该说的意思：${esc(m.text)}</p>` : ''}
  <div class="play">
    <b>真人</b><audio controls preload="none" src="${esc(local)}"></audio>
  </div>
  ${ai.length ? `<div class="ai"><b>对照 AI</b>${ai
    .map((a) => `<span class="one"><i>${esc(a.dialectId)}</i><audio controls preload="none" src="https://geshuo.pages.dev${esc(a.audio)}"></audio></span>`)
    .join('')}</div>` : ''}
  <div class="meta">
    ${m.contact ? `联系：${esc(m.contact)}　` : ''}${m.note ? `备注：${esc(m.note)}` : ''}
  </div>
  <div class="acts">
    <button class="keep" type="button">采用</button>
    <button class="drop" type="button">丢弃</button>
    <span class="mark"></span>
  </div>
</article>`);
  }

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>投稿审听台 · 各说各话</title><style>
body{margin:0;padding:28px 20px 80px;background:#F7EFDD;color:#2A1E14;font:15px/1.7 "Noto Serif SC","Songti SC",serif}
.wrap{max-width:900px;margin:0 auto}
h1{font-size:30px;color:#B7241F;margin:0 0 6px}
.sub{color:#9A8461;font-size:13.5px;margin:0 0 26px}
.rec{background:#FFFAF0;border:1px solid #E0CFA8;padding:16px 18px;margin-bottom:2px}
.rec.keep{border-color:#B7241F;border-left-width:3px}
.rec.drop{opacity:.42}
header{display:flex;gap:14px;align-items:baseline;flex-wrap:wrap;font-size:12.5px;color:#9A8461}
.id{font-family:ui-monospace,Menlo,monospace;color:#B7241F}
.place{font-size:15px;color:#2A1E14;font-weight:600}
.where{font-size:13px;color:#6B5540;margin:6px 0 4px}
.said{font-size:13.5px;color:#6B5540;margin:0 0 10px;border-left:2px solid #E0CFA8;padding-left:10px}
.play{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.play b{font-size:12px;color:#B7241F;min-width:2.6em}
.ai{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.ai b{font-size:12px;color:#9A8461;min-width:3.6em}
.ai .one{display:flex;align-items:center;gap:5px}
.ai i{font-style:normal;font-size:11px;color:#9A8461;font-family:ui-monospace,monospace}
audio{height:32px}
.ai audio{height:26px;width:190px}
.meta{font-size:12.5px;color:#9A8461;margin-bottom:8px}
.acts{display:flex;gap:8px;align-items:center}
button{font:inherit;font-size:13px;cursor:pointer;border:1px solid #B7241F;background:transparent;color:#B7241F;padding:6px 16px;border-radius:2px}
button:hover{background:#B7241F;color:#FFF6E8}
.mark{font-size:12px;color:#B7241F}
#out{margin-top:26px;background:#FFFAF0;border:1px solid #E0CFA8;padding:16px 18px}
#out h2{font-size:16px;color:#B7241F;margin:0 0 8px}
pre{white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#6B5540;margin:0}
</style></head><body><div class="wrap">
<h1>投稿审听台</h1>
<p class="sub">${objects.length} 条投稿 · 本地文件，不在公网上。听完标「采用 / 丢弃」，下面会给出要跑的命令。</p>
${rows.join('')}
<div id="out"><h2>你的决定</h2><pre id="cmd">还没标记。</pre></div>
</div><script>
const state={};
function render(){
  const keep=Object.entries(state).filter(([,v])=>v==='keep').map(([k])=>k);
  const drop=Object.entries(state).filter(([,v])=>v==='drop').map(([k])=>k);
  const lines=[];
  if(keep.length)lines.push('# 采用这几条（把它们接进站点，需要先定方言点归属）：\\n'+keep.join(' '));
  if(drop.length)lines.push('# 丢弃这几条（从 R2 删掉）：\\n'+drop.map(id=>'pnpm recordings:rm '+id).join('\\n'));
  document.getElementById('cmd').textContent=lines.join('\\n\\n')||'还没标记。';
}
document.querySelectorAll('.rec').forEach(el=>{
  const id=el.dataset.id;
  el.querySelector('.keep').addEventListener('click',()=>{state[id]='keep';el.className='rec keep';el.querySelector('.mark').textContent='已标：采用';render();});
  el.querySelector('.drop').addEventListener('click',()=>{state[id]='drop';el.className='rec drop';el.querySelector('.mark').textContent='已标：丢弃';render();});
});
</script></body></html>`;

  writeFileSync(join(INBOX, 'index.html'), html, 'utf8');
  writeFileSync(join(INBOX, 'manifest.json'), JSON.stringify(objects, null, 2), 'utf8');
  console.log(`✓ ${objects.length} 条投稿（新下载 ${downloaded} 条）`);
  console.log(`  审听台：open ${join(INBOX, 'index.html')}`);
}

async function remove(prefix: string) {
  const objects = await listAll();
  const hits = objects.filter((o) => shortId(o.key).startsWith(prefix) || o.key.includes(prefix));
  if (hits.length === 0) { console.error(`没找到匹配 ${prefix} 的录音`); process.exit(1); }
  if (hits.length > 1) {
    console.error(`${prefix} 匹配到 ${hits.length} 条，说得更具体一点：`);
    for (const h of hits) console.error(`  ${shortId(h.key)}  ${h.key}`);
    process.exit(1);
  }
  const res = await api(`/r2/buckets/${BUCKET}/objects/${encodeURIComponent(hits[0].key)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`删除失败 ${res.status}: ${await res.text()}`);
  console.log(`✓ 已从 R2 删除 ${shortId(hits[0].key)}`);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'pull' || cmd === undefined) return pull();
  if (cmd === 'rm') {
    if (!arg) { console.error('用法: pnpm recordings:rm <短 id>'); process.exit(1); }
    return remove(arg);
  }
  console.error(`未知命令 ${cmd}。可用：pull / rm`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
}
