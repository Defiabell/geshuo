/**
 * 脏话方言存废投票的前端。
 *
 * 两条原则：
 * 1. **先读票再让投**。读票失败就把整块降级成一句说明，而不是留三个点了没反应
 *    的按钮——按钮长得能点却什么都不发生，比直说"投票暂时用不了"更糟。
 * 2. **本地记住投过什么**，回访能看到自己选的那项打勾。服务端按 IP 去重是权威，
 *    localStorage 只是显示用；两者不一致时以服务端返回的计票为准。
 */

const KEY = 'geshuo:vote';

interface Tally {
  counts: Record<string, number>;
  total: number;
}

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    // 隐私模式 / 禁用站点数据时 localStorage 本身会抛异常，不能让它带崩整页
    return null;
  }
}

function store(choice: string): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* 存不上不影响投票本身 */
  }
}

export function initPoll(root: HTMLElement): void {
  const opts = Array.from(root.querySelectorAll<HTMLButtonElement>('.opt'));
  const tallyEl = root.querySelector<HTMLElement>('#tally');
  let mine = readStored();

  const render = (t: Tally) => {
    for (const btn of opts) {
      const c = btn.dataset.choice!;
      const n = t.counts[c] ?? 0;
      const pct = t.total > 0 ? Math.round((n / t.total) * 100) : 0;
      btn.querySelector<HTMLElement>('.bar i')!.style.width = `${pct}%`;
      btn.querySelector<HTMLElement>('.pct')!.textContent = t.total > 0 ? `${pct}%` : '—';
      btn.setAttribute('aria-pressed', String(c === mine));
    }
    if (tallyEl) {
      tallyEl.textContent =
        t.total === 0 ? '还没有人投票——你可以是第一个。' : `共 ${t.total} 票`;
    }
    root.dataset.state = 'ready';
  };

  const degrade = (msg: string) => {
    root.dataset.state = 'error';
    for (const btn of opts) btn.disabled = true;
    if (tallyEl) tallyEl.textContent = msg;
  };

  const send = async (choice: string) => {
    for (const btn of opts) btn.disabled = true;
    try {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ choice }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as Tally;
      mine = choice;
      store(choice);
      render(data);
    } catch {
      if (tallyEl) tallyEl.textContent = '这一票没送出去，过会儿再试试。';
    } finally {
      for (const btn of opts) btn.disabled = false;
    }
  };

  for (const btn of opts) {
    btn.addEventListener('click', () => send(btn.dataset.choice!));
  }

  void (async () => {
    try {
      const res = await fetch('/api/vote');
      if (!res.ok) throw new Error(String(res.status));
      render((await res.json()) as Tally);
    } catch {
      degrade('投票暂时读不出来，稍后再看。');
    }
  })();
}
