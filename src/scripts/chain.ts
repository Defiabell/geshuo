import { setPlayIcon } from './play-icon';

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

  const clear = () => {
    cols.forEach((c) => c.classList.remove('on'));
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
    audio = new Audio(col.dataset.audio!);
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
