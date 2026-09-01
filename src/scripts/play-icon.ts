/**
 * 播放键的图标切换。
 *
 * 三处播放键（台词卡的圆钮、对比页和一句话页的小三角）共用这一个函数——
 * 各写各的必然有一处忘了改回 ▶，那个按钮就会一直卡在暂停态，看着像坏了。
 *
 * 台词卡的按钮里是 <svg><path>，对比页的是纯文字 ▶，所以两种都认：
 * 有 path 就换 d，没有就换 textContent。
 */

const PLAY_D = 'M2 1l9 5-9 5z';
const PAUSE_D = 'M2.5 1h3v10h-3zM6.5 1h3v10h-3z';

export type PlayState = 'play' | 'pause';

export function setPlayIcon(btn: Element | null | undefined, state: PlayState): void {
  if (!btn) return;
  const path = btn.querySelector('svg path');
  if (path) {
    path.setAttribute('d', state === 'play' ? PLAY_D : PAUSE_D);
  } else {
    btn.textContent = state === 'play' ? '▶' : '⏸';
  }

  // 无障碍：屏幕阅读器读到的必须跟图标一致。首次调用时把原始 label 记下来，
  // 之后在「播放 X」和「暂停 X」之间切——直接覆盖会把 X 是什么弄丢。
  const el = btn as HTMLElement;
  if (el.dataset.baseLabel === undefined) {
    el.dataset.baseLabel = (btn.getAttribute('aria-label') ?? '').replace(/^(播放|暂停)/, '').trim();
  }
  const base = el.dataset.baseLabel;
  if (base) btn.setAttribute('aria-label', `${state === 'play' ? '播放' : '暂停'}${base}`);
}
