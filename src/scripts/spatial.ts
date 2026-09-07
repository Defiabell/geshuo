/**
 * 把一个 <audio> 接到立体声声像上。北在左、南在右——见 src/lib/geo.ts 的 panFor。
 *
 * 三条防线，因为**声音坏掉比不空间化严重得多**：
 * 1. AudioContext 只在第一次用户手势之后建（浏览器会拦更早的）；
 * 2. 任何一步抛错就原样返回，元素照常自己播；
 * 3. 一个元素只能 createMediaElementSource 一次——这里每次都是新建的 Audio，
 *    所以不会撞；但仍然记一个 WeakSet 兜底，撞了就放弃空间化而不是抛错。
 *
 * 注意：一旦元素被接进 Web Audio 图，它就不再直接输出到扬声器了。所以
 * ctx.resume() 失败必须回退到「不接图」，否则会得到一段静音——那是最糟的
 * 失败方式，因为页面上一切正常，只是没有声音。
 */

let ctx: AudioContext | null = null;
let broken = false;
const wired = new WeakSet<HTMLAudioElement>();

function audioCtx(): AudioContext | null {
  if (broken) return null;
  if (ctx) return ctx;
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) { broken = true; return null; }
    ctx = new C();
    return ctx;
  } catch {
    broken = true;
    return null;
  }
}

/**
 * 接上声像。返回 true 表示接上了；false 表示没接上，元素照常自己播。
 * `pan` 为 0 时直接不接——没有方位就不必进音频图，少一层出错的机会。
 */
export function pan(audio: HTMLAudioElement, value: number): boolean {
  if (!value || wired.has(audio)) return false;
  const c = audioCtx();
  if (!c || typeof c.createStereoPanner !== 'function') return false;
  try {
    const src = c.createMediaElementSource(audio);
    const panner = c.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, value));
    src.connect(panner).connect(c.destination);
    wired.add(audio);
    if (c.state === 'suspended') void c.resume();
    return true;
  } catch {
    // 接不上就算了。绝不能因为空间化失败而让这段音频变哑。
    return false;
  }
}
