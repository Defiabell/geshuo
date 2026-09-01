/**
 * 「四地连听」——把同一拍的各方言音频连着放完。
 *
 * 这是这个站的核心承诺：同一句话，四种腔调连着砸过来。在此之前对比页
 * 一个播放按钮都没有，用户得回场景页一条一条点，那个「哇」的瞬间从来
 * 没发生过。
 *
 * 播放期间当前列高亮。任何一次新的播放（连听或单列）都会作废上一轮的
 * 回调——沿用 player.ts 的 generation 令牌做法：pause() 触发的 AbortError
 * 可能几秒后才 resolve，不作废就会劫持后一次播放。
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

  const clear = () => cols.forEach((c) => c.classList.remove('on'));

  const stop = () => {
    generation += 1;
    if (audio) { audio.pause(); audio = null; }
    if (timer !== null) { clearTimeout(timer); timer = null; }
    chaining = false;
    clear();
    if (chainBtn) chainBtn.textContent = chainBtn.dataset.idle!;
  };

  /** 放一列。onEnd 只在这一轮仍然有效时触发 */
  const playCol = (col: HTMLElement, onEnd?: () => void) => {
    clear();
    col.classList.add('on');
    const my = ++generation;
    const src = col.dataset.audio!;
    audio = new Audio(src);
    audio.addEventListener('ended', () => { if (my === generation) onEnd?.(); });
    void audio.play().catch(() => {
      // 自动播放被拦或音频坏掉时不能卡死整条链——给个兜底时长继续往下走
      if (my !== generation) return;
      timer = window.setTimeout(() => { if (my === generation) onEnd?.(); }, 1800);
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
    col.querySelector('.one')?.addEventListener('click', () => {
      // 连听途中点单列 = 跳出连听只听这一条，不是从这条继续往下连
      stop();
      playCol(col);
    });
  }
}
