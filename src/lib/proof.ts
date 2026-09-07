import type { Identity } from './identity';
import { colorFor } from './palette';

/**
 * 套色样张（proof sheet）——这个站的视觉世界。
 *
 * 「各说各话」最准的一张图不是并排的四段文字，是**印刷厂里套不准的样张**：
 * 同一版内容印了好几遍，每遍一色油墨，永远差着一点没对上。这个比喻不是
 * 从设计手册里挑的，它就是这个项目本身——同一出戏，各地各印一遍，谁也
 * 对不齐谁。
 *
 * 于是全站的视觉元素都有了本职工作，而不是装饰：
 * - 每个地方是**一色油墨**（颜色来自纬度，见 palette.ts）；
 * - 时长条是**色条**（印刷样张边上那排色块），同时兼任播放进度；
 * - 一叠台词按经度缩进成**阶梯**（见 indentFor），一块文字就是一张地图。
 *
 * ## 试过但砍掉的：套印错位的报头
 *
 * 「各说各话」四个字印四遍、每遍一色油墨、按真实经纬度错开——这个想法在
 * 纸上很美，做出来是廉价的 3D 投影。试了三轮才认输，值得记下来为什么：
 *
 * **这个调色板做不了套色。** 套印之所以好看，靠的是 CMY 那种又浅又透、
 * 色相隔得很远的油墨——每色单独看是明确的颜色，只有交叠处才黑。而这个站
 * 的颜色是一条**南北冷暖渐变**，天生邻近、天生偏深。四层邻近深色叠在一起，
 * 交叠区糊成一团黑，彩边读起来只能是投影。
 *
 * 调过幅度（±10 → ±3.4）、把误差减均值居中、把明度从 34% 提到 56%——
 * 三样都对，但都在跟调色板拧着劲。而调色板是承重的（全站的地理编码都吃它，
 * 还有测试钉着），所以砍报头，不动调色板。
 *
 * 顶上那四个字最后走了另一条路：**一字一色，取色阶的四档**（见 palette.ts
 * 的 rampStops）。它不再假装是一次印刷事故，而直接就是这个站的图例——
 * 从北到南。分开的字不叠印，也就没有泥。
 */

/**
 * 缩进的经度区间。
 *
 * 取 100–126°E：汉语方言点几乎全挤在这一段里（成渝 104、粤 113、武城 116、
 * 东北 125）。用全国边界 73–135 会把所有点压到中间一小撮，阶梯就看不出
 * 方向了。纬度轴不在这个文件里——它在 geo.ts（声像）和 palette.ts（颜色）
 * 里。三条轴吃同一份坐标，但各自的取值范围写在各自负责的文件里。
 */
const LNG_WEST = 100;
const LNG_EAST = 126;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 经度 → 缩进（px）。西边的行靠左，东边的行靠右。
 *
 * 把经度轴映到 [0, max]，让一叠台词自己排成一段阶梯：从上往下是北到南，
 * 从左到右是西到东。**一块文字就是一张地图**——而且是能读出来的那种，
 * 这也是砍掉套印报头之后这个想法唯一还站得住的落点。
 *
 * 只能是单向的（0 起步，不以中点为 0）：负缩进会把字推到版心外面。
 * 没有经度就返回 0：不知道在哪儿的行不参与排布，老老实实靠左。
 */
export function indentFor(lng: number | undefined, max = 48): number {
  if (lng === undefined) return 0;
  return Math.round(clamp((lng - LNG_WEST) / (LNG_EAST - LNG_WEST), 0, 1) * max);
}

export interface Seg {
  key: string;
  name: string;
  color: string;
  ms: number;
  /** 秒，一位小数——色条上的标注 */
  label: string;
}

/**
 * 色条分段。**只有每一条都量到时长才返回分段**，缺一条就返回空数组。
 *
 * 理由同 audio.ts 的 chainSeconds：色条的宽度是在做断言（"粤语这句最短"），
 * 缺了时长就只能按字数估，而字数和时长能差三倍。宁可不画这条，
 * 也不画一条比例是编的。
 */
export function segments(
  rows: readonly { identity: Identity; audio?: string; durationMs?: number }[],
): Seg[] {
  const playable = rows.filter((r) => r.audio);
  if (playable.length < 2) return [];
  if (playable.some((r) => r.durationMs === undefined)) return [];
  return playable.map((r) => ({
    key: r.identity.id,
    name: r.identity.name,
    color: colorFor(r.identity, 0.52),
    ms: r.durationMs!,
    label: (r.durationMs! / 1000).toFixed(1),
  }));
}
