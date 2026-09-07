import { setPlayIcon } from './play-icon';
import { pan } from './spatial';

/**
 * 「N 地连听」——把同一拍的各方言音频连着放完。
 *
 * 这是这个站的核心承诺：同一句话，四种腔调连着砸过来。在此之前对比页
 * 一个播放按钮都没有，用户得回场景页一条一条点，那个「哇」的瞬间从来
 * 没发生过。
 *
 * 单列的小三角是**播放/暂停切换**，不是「再点一次从头读」——后者是很讨厌的
 * 交互：你只想停一下，它却把你听到一半的位置扔了。
 *
 * generation 令牌作废上一轮的回调（pause() 触发的 AbortError 可能几秒后才
 * resolve，不作废就会劫持后一次播放）；但**暂停不递增 generation**，因为
 * 暂停后那个 audio 还要接着用，它的 'ended' 还得把连听推到下一列。
 *
 * 每一列还带一个声像值（data-pan，北在左南在右，见 src/lib/geo.ts）。连听
 * 因此不再是四段音频首尾相接，而是一次从北到南的移动——声音从它那一列在
 * 屏幕上的位置传来。空间化失败一律静默降级成普通播放。
 *
 * ## 色条（.seg）
 *
 * 页面上那条按真实时长切分的彩色横条不是装饰，它是**这个播放器的进度条**
 * （见 src/lib/proof.ts）。一条东西同时干三件事：告诉你各地把同一句话说了
 * 多久、正在放哪一段、点哪儿能跳过去。
 *
 * 段与列靠 `data-seg` / `data-key` 配对，不靠 DOM 顺序——列里可能有没音频
 * 的（`data-audio=""`），色条里没有，按下标配对会整条错位。没有色条的页面
 * 这段代码全程是空操作。
 */

const GAP_MS = 320;

export function initChain(root: HTMLElement): void {
  const cols = Array.from(root.querySelectorAll<HTMLElement>('.col[data-audio]'));
  const playable = cols.filter((c) => (c.dataset.audio ?? '') !== '');
  const chainBtn = root.querySelector<HTMLButtonElement>('#chain');

  let audio: HTMLAudioElement | null = null;
  let timer: number | null = null;
  let generation = 0;
  let chaining = false;
  let currentCol: HTMLElement | null = null;
  let paused = false;

  const btnOf = (col: HTMLElement) => col.querySelector<HTMLButtonElement>('.one');
  const resetIcons = () => cols.forEach((c) => setPlayIcon(btnOf(c), 'play'));

  const segs = Array.from(root.querySelectorAll<HTMLElement>('.seg[data-seg]'));
  const segOf = (col: HTMLElement) =>
    segs.find((s) => s.dataset.seg === col.dataset.key && col.dataset.key !== undefined) ?? null;

  const clear = () => {
    cols.forEach((c) => c.classList.remove('on'));
    segs.forEach((s) => {
      s.classList.remove('on');
      s.style.setProperty('--p', '0');
    });
    resetIcons();
  };

  const stop = () => {
    generation += 1;
    if (audio) { audio.pause(); audio = null; }
    if (timer !== null) { clearTimeout(timer); timer = null; }
    chaining = false;
    currentCol = null;
    paused = false;
    clear();
    if (chainBtn) chainBtn.textContent = chainBtn.dataset.idle!;
  };

  /** 放一列。onEnd 只在这一轮仍然有效时触发 */
  const playCol = (col: HTMLElement, onEnd?: () => void) => {
    clear();
    col.classList.add('on');
    currentCol = col;
    paused = false;
    const my = ++generation;
    const seg = segOf(col);
    seg?.classList.add('on');
    audio = new Audio(col.dataset.audio!);
    pan(audio, Number(col.dataset.pan ?? 0));
    if (seg) {
      // timeupdate 大约每 250ms 一次，画一条进度足够，比 rAF 省得多。
      // 时长拿不到（metadata 还没到）时不画，也不编一个百分比。
      audio.addEventListener('timeupdate', () => {
        if (my !== generation || !audio) return;
        const d = audio.duration;
        if (!Number.isFinite(d) || d <= 0) return;
        seg.style.setProperty('--p', String(Math.min(100, (audio.currentTime / d) * 100)));
      });
    }
    audio.addEventListener('ended', () => {
      if (my !== generation) return;
      setPlayIcon(btnOf(col), 'play');
      currentCol = null;
      onEnd?.();
    });
    setPlayIcon(btnOf(col), 'pause');
    void audio.play().catch(() => {
      // 自动播放被拦或音频坏掉时不能卡死整条链，也不能让图标停在暂停态
      if (my !== generation) return;
      setPlayIcon(btnOf(col), 'play');
      timer = window.setTimeout(() => {
        if (my !== generation) return;
        currentCol = null;
        onEnd?.();
      }, 1800);
    });
  };

  const chain = (i: number) => {
    if (!chaining) return;
    if (i >= playable.length) { stop(); return; }
    playCol(playable[i], () => {
      if (!chaining) return;
      // 两列之间留一点空气，否则四句连成一坨，听不出「换了个地方」
      timer = window.setTimeout(() => chain(i + 1), GAP_MS);
    });
  };

  chainBtn?.addEventListener('click', () => {
    if (chaining) { stop(); return; }
    stop();
    chaining = true;
    chainBtn.textContent = '■ 停';
    chain(0);
  });

  // 点色条上的一段 = 点那一列的播放键。不复制播放逻辑，只转发。
  for (const col of cols) {
    segOf(col)?.addEventListener('click', () => btnOf(col)?.click());
  }

  for (const col of cols) {
    btnOf(col)?.addEventListener('click', () => {
      // 点的就是正在响的这列 → 暂停 / 继续。连听途中暂停，再点会接着
      // 往下连，因为暂停没作废 generation，'ended' 仍然连着 chain()。
      if (currentCol === col && audio) {
        if (paused) {
          paused = false;
          setPlayIcon(btnOf(col), 'pause');
          void audio.play().catch(() => setPlayIcon(btnOf(col), 'play'));
        } else {
          paused = true;
          audio.pause();
          setPlayIcon(btnOf(col), 'play');
        }
        return;
      }
      // 换一列：跳出连听，只听这一条
      stop();
      playCol(col);
    });
  }
}
