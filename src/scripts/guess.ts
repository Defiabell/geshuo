/**
 * 盲听猜方言。
 *
 * 规则很简单：放一段，不给标签，猜是哪儿的。猜完揭晓，并告诉你别人猜得怎么样。
 *
 * 设计上有一条不能让步：**先听，后看**。选项在音频开始播之后才可点，
 * 否则人会先扫一眼四个选项再听，那就不是盲听了，收上来的数据也失去意义。
 */

export interface Clip {
  clip: string;
  audio: string;
  dialectId: string;
  dialectName: string;
  sceneTitle: string;
  text: string;
}

interface Option {
  id: string;
  name: string;
}

const STORE = 'geshuo:guess-score';

function readScore(): { n: number; hit: number } {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return JSON.parse(raw) as { n: number; hit: number };
  } catch {
    /* 隐私模式下 localStorage 会抛，成绩丢了不影响玩 */
  }
  return { n: 0, hit: 0 };
}
function writeScore(s: { n: number; hit: number }): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* 同上 */
  }
}

export function initGuess(root: HTMLElement, clips: Clip[], options: Option[]): void {
  const audioEl = root.querySelector<HTMLAudioElement>('#clip')!;
  const playBtn = root.querySelector<HTMLButtonElement>('#play')!;
  const optsEl = root.querySelector<HTMLElement>('#opts')!;
  const revealEl = root.querySelector<HTMLElement>('#reveal')!;
  const nextBtn = root.querySelector<HTMLButtonElement>('#next')!;
  const scoreEl = root.querySelector<HTMLElement>('#score')!;

  let current: Clip | null = null;
  let answered = false;
  let recent: string[] = [];
  let score = readScore();

  const showScore = () => {
    scoreEl.textContent = score.n === 0 ? '' : `${score.n} 题猜对 ${score.hit} 题`;
  };

  const pick = (): Clip => {
    // 不连着出同一条——最近 6 条内的先排除，实在没得挑就放宽
    const pool = clips.filter((c) => !recent.includes(c.clip));
    const from = pool.length > 0 ? pool : clips;
    const c = from[Math.floor(Math.random() * from.length)];
    recent = [c.clip, ...recent].slice(0, 6);
    return c;
  };

  const renderOptions = () => {
    optsEl.innerHTML = '';
    for (const o of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt';
      b.dataset.id = o.id;
      b.textContent = o.name;
      b.disabled = true; // 先听后看：音频开播前不给点
      b.addEventListener('click', () => answer(o.id));
      optsEl.append(b);
    }
  };

  const enableOptions = () => {
    optsEl.querySelectorAll('button').forEach((b) => { b.disabled = answered; });
  };

  const nextQuestion = () => {
    answered = false;
    current = pick();
    revealEl.hidden = true;
    revealEl.className = 'reveal';
    nextBtn.hidden = true;
    renderOptions();
    audioEl.src = current.audio;
    playBtn.textContent = '▶ 放一遍';
    // 自动播一次；被浏览器拦了就等用户点，选项在任一情况下都会放开
    void audioEl.play().then(enableOptions).catch(enableOptions);
  };

  const answer = async (guessed: string) => {
    if (answered || !current) return;
    answered = true;
    optsEl.querySelectorAll('button').forEach((b) => { b.disabled = true; });

    const right = guessed === current.dialectId;
    score = { n: score.n + 1, hit: score.hit + (right ? 1 : 0) };
    writeScore(score);
    showScore();

    optsEl.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      if (b.dataset.id === current!.dialectId) b.classList.add('right');
      else if (b.dataset.id === guessed) b.classList.add('wrong');
    });

    revealEl.className = `reveal ${right ? 'ok' : 'no'}`;
    revealEl.innerHTML = '';
    const h = document.createElement('p');
    h.className = 'verdict';
    h.textContent = right ? '猜对了' : `不对，是${current.dialectName}`;
    const said = document.createElement('p');
    said.className = 'said';
    said.textContent = current.text;
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `${current.sceneTitle} · ${current.dialectName}`;
    const others = document.createElement('p');
    others.className = 'others';
    others.textContent = '正在看别人猜得怎么样…';
    revealEl.append(h, said, meta, others);
    revealEl.hidden = false;
    nextBtn.hidden = false;
    nextBtn.focus();

    try {
      const res = await fetch('/api/guess', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clip: current.clip, guessed }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as { stats: { total: number; rate: number | null } };
      others.textContent =
        d.stats.total <= 1
          ? '你是第一个猜这条的。'
          : `这一条 ${d.stats.total} 个人猜过，${d.stats.rate}% 猜对。`;
    } catch {
      // 记不上不影响玩下去，但要说出来——默默吞掉会让人以为数据都在
      others.textContent = '这一次没记上（网络问题），不影响你继续玩。';
    }
  };

  playBtn.addEventListener('click', () => {
    audioEl.currentTime = 0;
    void audioEl.play().then(enableOptions).catch(enableOptions);
  });
  nextBtn.addEventListener('click', nextQuestion);

  showScore();
  nextQuestion();
}
