import type { TakeLine } from './types';

/** 连听时两条之间的留白，跟 src/scripts/chain.ts 的 GAP_MS 保持一致 */
const GAP_MS = 320;

/**
 * 连听总时长（秒，取整）。**只要有一条缺时长就返回 null**，让界面干脆
 * 不显示秒数——显示一个部分猜出来的数字比不显示更糟：按钮上写「约 16 秒」
 * 结果放了 34 秒，人会觉得这站在骗他。
 */
export function chainSeconds(lines: TakeLine[]): number | null {
  const playable = lines.filter((l) => l.audio);
  if (playable.length === 0) return null;
  if (playable.some((l) => l.durationMs === undefined)) return null;
  const ms =
    playable.reduce((sum, l) => sum + (l.durationMs ?? 0), 0) + GAP_MS * (playable.length - 1);
  return Math.round(ms / 1000);
}
