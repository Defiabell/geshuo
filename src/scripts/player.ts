import type { SpeakerRole } from '../lib/types';

const FALLBACK_MS = 2600;

export function initPlayer(root: HTMLElement): void {
  const lines = Array.from(root.querySelectorAll<HTMLElement>('.line'));
  const figures = Array.from(document.querySelectorAll<SVGGElement>('[data-fig]'));
  const playAll = root.querySelector<HTMLButtonElement>('#playAll');
  let audio: HTMLAudioElement | null = null;
  let timer: number | null = null;
  let idx = -1;
  // Bumped on every focus() and stopAudio() call. Any in-flight audio.play()
  // rejection or 'ended'/timeout callback that fires after the generation
  // has moved on belongs to a stale focus() call — it must be ignored,
  // otherwise a pause()-triggered AbortError from a manual click can resolve
  // several seconds later and hijack playback with the previous step().
  let generation = 0;

  const clear = () => {
    lines.forEach((l) => l.classList.remove('active'));
    figures.forEach((f) => f.classList.remove('dim', 'hot'));
  };

  // who 的取值来自 LineCard.astro 渲染的 data-who={beat.speakerRole}，
  // 类型跟 tts.ts 的 INSTRUCTS 映射表同源自 SpeakerRole（src/lib/types.ts）——
  // validateContent() 已在构建期保证这里不会收到未知角色，不需要再猜一个默认值。
  const light = (who: SpeakerRole) => {
    figures.forEach((f) => {
      const isSpeaker = f.dataset.fig === who;
      f.classList.toggle('hot', isSpeaker);
      f.classList.toggle('dim', who !== 'none' && !isSpeaker);
      if (who === 'none') f.classList.add('dim');
    });
  };

  const stopAudio = () => {
    generation += 1;
    if (audio) { audio.pause(); audio = null; }
    if (timer !== null) { clearTimeout(timer); timer = null; }
  };

  const stop = () => {
    stopAudio(); idx = -1; clear();
    if (playAll) playAll.textContent = '▶ 从头演一遍';
  };

  const focus = (line: HTMLElement, onEnd?: () => void) => {
    lines.forEach((l) => l.classList.remove('active'));
    line.classList.add('active');
    light((line.dataset.who as SpeakerRole | undefined) ?? 'none');
    const myGen = ++generation;
    const src = line.dataset.audio;
    if (src) {
      audio = new Audio(src);
      audio.addEventListener('ended', () => {
        if (myGen !== generation) return;
        onEnd?.();
      });
      void audio.play().catch(() => {
        if (myGen !== generation) return;
        timer = window.setTimeout(() => {
          if (myGen !== generation) return;
          onEnd?.();
        }, FALLBACK_MS);
      });
    } else {
      timer = window.setTimeout(() => {
        if (myGen !== generation) return;
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
    line.querySelector('.play')?.addEventListener('click', () => {
      stopAudio(); idx = -1;
      if (playAll) playAll.textContent = '▶ 从头演一遍';
      focus(line);
    });
  });
}
