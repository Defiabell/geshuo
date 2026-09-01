/**
 * 网页录音投稿。
 *
 * 两条录入路径都给，因为只给一条会挡掉一批人：
 * - **现场录**：MediaRecorder。桌面 Chrome/Firefox 与新版 Safari 都有。
 * - **选文件**：`<input type="file" accept="audio/*">`。iOS 上直接调起「语音备忘录」
 *   已有的录音，也让人可以先在安静环境录好再传。老浏览器上这是唯一的路。
 *
 * 录音这件事上，权限被拒、设备没麦、浏览器不支持是常态而不是异常，所以每一处
 * 失败都必须落到那一拍自己的 status 上说人话——整页弹一个 alert 或者静默失败，
 * 都会让人以为是自己操作错了。
 */

import { getToken, initTurnstile } from './turnstile';

// 跟服务端 functions/api/upload.ts 的 MAX_BYTES 保持一致——
// 前端先挡一道只是为了给人即时反馈，真正的闸在服务端
const MAX_BYTES = 3 * 1024 * 1024;

/** MediaRecorder 各家支持的容器不同，挑第一个当前浏览器认的 */
function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

interface BeatState {
  blob: Blob | null;
  recorder: MediaRecorder | null;
  stream: MediaStream | null;
}

export function initRecorder(root: Document | HTMLElement, sitekey?: string): void {
  const placeEl = root.querySelector<HTMLInputElement>('#place');
  // 人机验证组件：页面上有位置就挂上去。没挂成也不拦着人录，
  // 只在上传那一刻才会因为拿不到令牌而失败并说明原因。
  // 容器 id 刻意不叫 turnstile：带 id 的元素会被挂到 window 上，
  // 那会遮蔽真正的 window.turnstile API（见 turnstile.ts 的 apiOf 注释）
  const tsHost = root.querySelector<HTMLElement>('#ts-host');
  if (tsHost && sitekey) {
    void initTurnstile(tsHost, sitekey).catch((e) => {
      // 之前这里是空 catch，结果上面那个遮蔽 bug 静默了很久才被发现。
      // 加载失败要留痕，否则只能看到"上传按钮点了没反应"。
      console.warn('[geshuo] 人机验证初始化失败：', e);
    });
  }
  const contactEl = root.querySelector<HTMLInputElement>('#contact');
  const beats = Array.from(root.querySelectorAll<HTMLElement>('.beat'));
  const mime = pickMime();

  for (const el of beats) {
    const recBtn = el.querySelector<HTMLButtonElement>('.rec')!;
    const fileInput = el.querySelector<HTMLInputElement>('.pick input')!;
    const preview = el.querySelector<HTMLAudioElement>('.prev')!;
    const sendBtn = el.querySelector<HTMLButtonElement>('.send')!;
    const status = el.querySelector<HTMLElement>('.status')!;
    const st: BeatState = { blob: null, recorder: null, stream: null };

    const say = (msg: string, kind: '' | 'ok' | 'bad' = '') => {
      status.textContent = msg;
      status.className = `status ${kind}`.trim();
    };

    const attach = (blob: Blob) => {
      if (blob.size > MAX_BYTES) {
        say('这段太大了（超过 5MB），录短一点或换个格式', 'bad');
        return;
      }
      st.blob = blob;
      preview.src = URL.createObjectURL(blob);
      preview.hidden = false;
      sendBtn.hidden = false;
      say(`${(blob.size / 1024).toFixed(0)} KB，听一下`);
    };

    if (!mime) {
      recBtn.disabled = true;
      recBtn.title = '这个浏览器不支持网页录音，用「选个文件」传一段已有的录音';
    }

    recBtn.addEventListener('click', async () => {
      // 正在录 → 停
      if (st.recorder && st.recorder.state === 'recording') {
        st.recorder.stop();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        st.stream = stream;
        const chunks: Blob[] = [];
        const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        st.recorder = rec;
        rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        rec.onstop = () => {
          // 录完立刻关掉麦克风轨道——不关的话浏览器标签上那个红点会一直亮着，
          // 让人以为站点在偷偷听
          stream.getTracks().forEach((t) => t.stop());
          st.stream = null;
          st.recorder = null;
          recBtn.textContent = '● 重录';
          recBtn.classList.remove('on');
          attach(new Blob(chunks, { type: mime ?? 'audio/webm' }));
        };
        rec.start();
        recBtn.textContent = '■ 停';
        recBtn.classList.add('on');
        say('录音中…');
      } catch (e) {
        const name = (e as DOMException)?.name;
        say(
          name === 'NotAllowedError'
            ? '浏览器没给麦克风权限——在地址栏左边把它打开，或者用「选个文件」'
            : name === 'NotFoundError'
              ? '没找到麦克风，用「选个文件」传一段吧'
              : '录不了，用「选个文件」传一段吧',
          'bad',
        );
      }
    });

    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      if (!f.type.startsWith('audio/')) { say('这不是音频文件', 'bad'); return; }
      attach(f);
    });

    sendBtn.addEventListener('click', async () => {
      const place = placeEl?.value.trim() ?? '';
      if (!place) {
        say('先在上面写清楚你是哪儿人', 'bad');
        placeEl?.focus();
        return;
      }
      if (!st.blob) return;

      sendBtn.disabled = true;

      // 拿不到令牌**不中止上传**。这个站的投稿人主要在国内，而
      // challenges.cloudflare.com 未必稳定可达——硬拦会挡掉最该来投稿的人。
      // 服务端对没带令牌的请求会按很小的额度放行，门开着但开得小。
      // 拿不到令牌照样传。人机验证在这个站只用来加额度，从不拦人——
      // 详见 functions/api/upload.ts 里的说明。
      let token = '';
      try {
        token = await getToken();
      } catch {
        /* 拿不到就算了，服务端会按小额度放行 */
      }

      say('上传中…');
      const fd = new FormData();
      if (token) fd.set('turnstile', token);
      fd.set('audio', st.blob, 'clip');
      fd.set('place', place);
      fd.set('contact', contactEl?.value.trim() ?? '');
      fd.set('sceneId', el.dataset.scene ?? '');
      fd.set('beatId', el.dataset.beat ?? '');
      fd.set('text', el.querySelector('.ref')?.textContent?.trim() ?? '');

      try {
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? `上传失败（${res.status}）`);
        say('收到了，谢谢 —— 会有人听过之后替换掉那条 AI 版', 'ok');
        sendBtn.hidden = true;
      } catch (e) {
        say((e as Error).message || '上传失败，过会儿再试', 'bad');
        sendBtn.disabled = false;
      }
    });
  }
}
