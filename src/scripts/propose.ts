import { getToken, initTurnstile } from './turnstile';

const MAX_BEATS = 8;

/**
 * 自己出一场戏。
 *
 * 站上现有的戏都是我编的，未必是各地真会吵的架——owner 两次指出内容不自然，
 * 根子就在这儿。让本地人自己出题，才可能出现「我们那儿真会为这个吵」的场面。
 *
 * 收上来的东西**不自动上站**：跟录音走同一个审核队列。
 */
export function initPropose(root: ParentNode, sitekey?: string): void {
  const beatsEl = root.querySelector<HTMLElement>('#beats');
  const addBtn = root.querySelector<HTMLButtonElement>('#add');
  const sendBtn = root.querySelector<HTMLButtonElement>('#send');
  const status = root.querySelector<HTMLElement>('#status');
  if (!beatsEl || !addBtn || !sendBtn || !status) return;

  // 容器 id 刻意不叫 turnstile：带 id 的元素会被挂到 window 上，
  // 那会遮蔽真正的 window.turnstile API（见 turnstile.ts 的 apiOf 注释）
  const tsHost = root.querySelector<HTMLElement>('#ts-host');
  if (tsHost && sitekey) {
    void initTurnstile(tsHost, sitekey).catch((e) => {
      console.warn('[turnstile] 初始化失败，按小额度提交', e);
    });
  }

  const say = (msg: string, kind: '' | 'ok' | 'bad' = '') => {
    status.textContent = msg;
    status.className = `status ${kind}`.trim();
  };

  const renumber = () => {
    beatsEl.querySelectorAll<HTMLElement>('.row').forEach((r, i) => {
      const n = r.querySelector('.n');
      if (n) n.textContent = String(i + 1).padStart(2, '0');
    });
    addBtn.disabled = beatsEl.children.length >= MAX_BEATS;
    addBtn.textContent = addBtn.disabled ? `最多 ${MAX_BEATS} 拍` : '＋ 再加一拍';
  };

  const addRow = () => {
    if (beatsEl.children.length >= MAX_BEATS) return;
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <div class="rh"><span class="n"></span><button class="del" type="button" aria-label="删掉这一拍">×</button></div>
      <input class="who" type="text" maxlength="40" placeholder="谁说的（选填，比如「妈妈」「摊主」）" />
      <input class="intent" type="text" maxlength="100" placeholder="这一拍要表达什么意思" />
      <textarea class="said" rows="2" maxlength="300" placeholder="你们那儿怎么说（选填，写不出的字用同音字凑）"></textarea>`;
    row.querySelector('.del')?.addEventListener('click', () => {
      // 至少留一拍：删到零之后页面上没有任何可填的东西，人会以为坏了
      if (beatsEl.children.length <= 1) return;
      row.remove();
      renumber();
    });
    beatsEl.append(row);
    renumber();
  };

  addBtn.addEventListener('click', addRow);
  addRow();
  addRow();

  sendBtn.addEventListener('click', async () => {
    const val = (sel: string) => root.querySelector<HTMLInputElement>(sel)?.value.trim() ?? '';
    const place = val('#place');
    const title = val('#title');
    const situation = val('#situation');

    if (!place) { say('先写清楚你是哪儿人', 'bad'); return; }
    if (!title) { say('给这场戏起个名字', 'bad'); return; }
    if (!situation) { say('写一句处境——什么情况下会说这些话', 'bad'); return; }

    const beats = Array.from(beatsEl.querySelectorAll<HTMLElement>('.row'))
      .map((r) => ({
        who: r.querySelector<HTMLInputElement>('.who')?.value.trim() ?? '',
        intent: r.querySelector<HTMLInputElement>('.intent')?.value.trim() ?? '',
        said: r.querySelector<HTMLTextAreaElement>('.said')?.value.trim() ?? '',
      }))
      .filter((b) => b.intent || b.said);

    if (beats.length === 0) { say('至少写一拍', 'bad'); return; }

    sendBtn.disabled = true;
    say('提交中…');

    // 拿不到令牌照样提交。人机验证在这个站只用来加额度，从不拦人——
    // 详见 functions/api/upload.ts 里的说明。
    let token = '';
    try { token = await getToken(); } catch { /* 服务端会按小额度放行 */ }

    const fd = new FormData();
    if (token) fd.set('turnstile', token);
    fd.set('kind', 'scene');
    fd.set('place', place);
    fd.set('contact', val('#contact'));
    fd.set('age', root.querySelector<HTMLSelectElement>('#age')?.value ?? '');
    fd.set('title', title);
    fd.set('situation', situation);
    fd.set('beats', JSON.stringify(beats));

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `提交失败（${res.status}）`);
      say('收到了，谢谢 —— 会有人看过之后决定要不要上站', 'ok');
    } catch (e) {
      say((e as Error).message || '提交失败，过会儿再试', 'bad');
      sendBtn.disabled = false;
    }
  });
}
