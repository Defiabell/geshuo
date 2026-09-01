/**
 * 上传口的内容校验。**下划线开头的文件 Pages 不会当成路由**，所以它只是个
 * 普通模块，可以被 upload.ts 和单元测试同时引用。
 *
 * 抽出来的理由很实在：这些校验坐在人机验证后面，从外面用 curl 打不到——
 * 请求会先被 Turnstile 挡掉。不抽出来就没法验证它们真的管用，而"没验证过的
 * 防线"和"没有防线"在事故复盘时是同一回事。
 */

/**
 * 文件头魔数校验。只信 content-type 等于让人拿这个接口当免费网盘：
 * 声明成 audio/webm，实际塞一个压缩包或者别人的隐私文件，我们照收不误。
 */
export function looksLikeAudio(b: Uint8Array): boolean {
  const ascii = (i: number, s: string) =>
    s.split('').every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b.length < 12) return false;
  // EBML（webm / mkv）
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return true;
  if (ascii(0, 'OggS')) return true;
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return true;
  if (ascii(4, 'ftyp')) return true;
  if (ascii(0, 'ID3')) return true;
  // mp3 裸帧同步字
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return true;
  return false;
}

/** 场景 id：只收小写字母数字连字符。它会进 R2 的 customMetadata 和审听台的文件名逻辑 */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** 拍号：b 加最多三位数字 */
export const BEAT = /^b[0-9]{1,3}$/;

/** 认扩展名靠 MIME（认「是不是音频」靠上面的魔数，两者分工不同） */
export function extFor(type: string): string {
  if (type.includes('webm')) return 'webm';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'm4a';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  if (type.includes('wav')) return 'wav';
  return 'bin';
}

/**
 * 把来访地址归一化成限流用的「桶」。
 *
 * 直接拿完整地址当键，在 IPv6 下等于没有限流：运营商随手给一个 /64，里面有
 * 一万八千万亿个地址，换一个就是一个新桶。所以 IPv6 按 /64 前缀归并
 * （同一个家庭宽带/同一台机器的所有地址会落到同一个桶），IPv4 保持原样。
 *
 * 这不是万无一失（换基站、换代理仍然是新桶），但它把「随手绕过」的成本
 * 从零提到了真的要换网络。
 */
export function ipBucket(ip: string): string {
  if (!ip) return 'unknown';
  if (!ip.includes(':')) return ip; // IPv4
  // IPv6：取前 4 组（/64）。先把 :: 展开，否则 fe80::1 会被截成 fe80
  const parts = ip.split('%')[0].split('::');
  let groups: string[];
  if (parts.length === 2) {
    const head = parts[0] ? parts[0].split(':') : [];
    const tail = parts[1] ? parts[1].split(':') : [];
    const fill = new Array(Math.max(0, 8 - head.length - tail.length)).fill('0');
    groups = [...head, ...fill, ...tail];
  } else {
    groups = ip.split(':');
  }
  return groups.slice(0, 4).map((g) => (g || '0').toLowerCase()).join(':') + '::/64';
}
