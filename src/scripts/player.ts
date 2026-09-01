import { setPlayIcon } from './play-icon';

const FALLBACK_MS = 2600;

export function initPlayer(root: HTMLElement): void {
  const lines = Array.from(root.querySelectorAll<HTMLElement>('.line'));
  const playAll = root.querySelector<HTMLButtonElement>('#playAll');
  let audio: HTMLAudioElement | null = null;
  let timer: number | null = null;
  let idx = -1;
  /** 当前正在响（或被暂停）的那一行，用来判断再点一次是暂停还是换一条 */
  let currentLine: HTMLElement | null = null;
  let paused = false;
  // 每次 focus() / stopAudio() 递增。任何在这之后才 resolve 的 play() 拒绝
  // 或 'ended' 回调都属于上一轮，必须忽略——手动点击触发的 pause() 会让
  // play() 几秒后才以 AbortError 拒绝，不作废就会劫持后一次播放。
  //
  // 注意：**暂停不递增**。暂停后那个 audio 还要继续用，它的 'ended' 还得
  // 能把「从头演一遍」推到下一条；递增会把这条链掐断。
  let generation = 0;

  const btnOf = (line: HTMLElement) => line.querySelector<HTMLButtonElement>('.play');

  const resetIcons = () => lines.forEach((l) => setPlayIcon(btnOf(l), 'play'));

  const clear = () => {
    lines.forEach((l) => l.classList.remove('active'));
    resetIcons();
  };

  const stopAudio = () => {
    generation += 1;
    if (audio) { audio.pause(); audio = null; }
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (currentLine) setPlayIcon(btnOf(currentLine), 'play');
    currentLine = null;
    paused = false;
  };

  const stop = () => {
    stopAudio(); idx = -1; clear();
    if (playAll) playAll.textContent = '▶ 从头演一遍';
  };

  const focus = (line: HTMLElement, onEnd?: () => void) => {
    lines.forEach((l) => l.classList.remove('active'));
    resetIcons();
    line.classList.add('active');
    currentLine = line;
    paused = false;
    const myGen = ++generation;
    const src = line.dataset.audio;
    if (src) {
      audio = new Audio(src);
      audio.addEventListener('ended', () => {
        if (myGen !== generation) return;
        setPlayIcon(btnOf(line), 'play');
        currentLine = null;
        onEnd?.();
      });
      setPlayIcon(btnOf(line), 'pause');
      void audio.play().catch(() => {
        if (myGen !== generation) return;
        // 播不了（自动播放被拦、音频坏了）——图标要退回 ▶，
        // 否则按钮卡在暂停态，看着像正在放其实没声音
        setPlayIcon(btnOf(line), 'play');
        timer = window.setTimeout(() => {
          if (myGen !== generation) return;
          currentLine = null;
          onEnd?.();
        }, FALLBACK_MS);
      });
    } else {
      timer = window.setTimeout(() => {
        if (myGen !== generation) return;
        currentLine = null;
        onEnd?.();
      }, FALLBACK_MS);
    }
  };

  const step = () => {
    stopAudio();
    idx += 1;
    if (idx >= lines.length) { stop(); return; }
    const line = lines[idx];
    line.scrollIntoView({ block: 'center', behavior: 'smooth' });
    focus(line, step);
  };

  playAll?.addEventListener('click', () => {
    if (idx !== -1) { stop(); return; }
    clear();
    playAll.textContent = '■ 停';
    idx = -1;
    step();
  });

  lines.forEach((line) => {
    btnOf(line)?.addEventListener('click', () => {
      // 点的就是正在响的这条 → 暂停 / 继续，而不是从头再读一遍。
      // 「从头演一遍」跑到一半时暂停，再点继续会接着往下走——因为
      // 暂停没有作废 generation，那个 audio 的 'ended' 仍然连着 step()。
      if (currentLine === line && audio) {
        if (paused) {
          paused = false;
          setPlayIcon(btnOf(line), 'pause');
          void audio.play().catch(() => setPlayIcon(btnOf(line), 'play'));
        } else {
          paused = true;
          audio.pause();
          setPlayIcon(btnOf(line), 'play');
        }
        return;
      }
      // 换一条：中断「从头演一遍」，只放这一条
      stopAudio(); idx = -1;
      if (playAll) playAll.textContent = '▶ 从头演一遍';
      focus(line);
    });
  });
}
