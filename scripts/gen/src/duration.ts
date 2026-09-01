import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * 用 ffprobe 量音频时长（毫秒）。量不到就返回 undefined——**绝不估算**。
 *
 * 这个数字唯一的用途是在连听按钮上告诉人「点下去要花多久」。按字数估算
 * 会离谱：「你瞅啥？」2.8 秒，一句邻里对骂 6.6 秒，差三倍。宁可不显示秒数，
 * 也不显示一个编出来的。没装 ffmpeg 的贡献者不受影响，只是少一行提示。
 */
export function measureDurationMs(filePath: string): number | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    const sec = Number.parseFloat(out);
    return Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : undefined;
  } catch {
    // ffprobe 没装、或这个文件 ffprobe 读不懂——都当作「量不到」
    return undefined;
  }
}
