import { describe, it, expect } from 'vitest';
import { BEAT, SLUG, extFor, ipBucket, looksLikeAudio , cleanText } from '../functions/api/_validate';

/** 造一段以给定字节开头、后面补零到足够长的数据 */
const head = (...v: number[]) => new Uint8Array([...v, ...new Array(16).fill(0)]);
const fromAscii = (s: string) =>
  new Uint8Array([...s].map((c) => c.charCodeAt(0)).concat(new Array(16).fill(0)));
const at = (offset: number, s: string) => {
  const b = new Uint8Array(20);
  [...s].forEach((c, i) => { b[offset + i] = c.charCodeAt(0); });
  return b;
};

/**
 * 这几条守的是「别人拿这个公开写接口当网盘」。它们坐在人机验证后面，用 curl
 * 从外面打不到（请求先被 Turnstile 挡掉），所以只能在这里验——没验证过的
 * 防线，和没有防线，在事故复盘时是同一回事。
 */
describe('文件头魔数', () => {
  it('认得出常见的音频容器', () => {
    expect(looksLikeAudio(head(0x1a, 0x45, 0xdf, 0xa3)), 'webm/EBML').toBe(true);
    expect(looksLikeAudio(fromAscii('OggS')), 'ogg').toBe(true);
    expect(looksLikeAudio(fromAscii('ID3')), 'mp3 带标签').toBe(true);
    expect(looksLikeAudio(head(0xff, 0xfb)), 'mp3 裸帧').toBe(true);
    expect(looksLikeAudio(at(4, 'ftyp')), 'mp4/m4a').toBe(true);
    const wav = at(0, 'RIFF');
    [...'WAVE'].forEach((c, i) => { wav[8 + i] = c.charCodeAt(0); });
    expect(looksLikeAudio(wav), 'wav').toBe(true);
  });

  it('挡得住「声明成音频、其实是别的东西」', () => {
    expect(looksLikeAudio(fromAscii('this is plain text, not audio')), '纯文本').toBe(false);
    expect(looksLikeAudio(fromAscii('PK zip zip zip')), 'zip').toBe(false);
    expect(looksLikeAudio(fromAscii('%PDF-1.7 blah')), 'pdf').toBe(false);
    expect(looksLikeAudio(head(0x89, 0x50, 0x4e, 0x47)), 'png').toBe(false);
  });

  it('太短的内容一律不认——不足以判断就不能放行', () => {
    expect(looksLikeAudio(new Uint8Array([0x1a, 0x45]))).toBe(false);
    expect(looksLikeAudio(new Uint8Array([]))).toBe(false);
  });
});

describe('元数据格式', () => {
  it('场景 id 只收小写字母数字连字符', () => {
    expect(SLUG.test('late-night')).toBe(true);
    expect(SLUG.test('w-shoushenme')).toBe(true);
    expect(SLUG.test('../../etc/passwd')).toBe(false);
    expect(SLUG.test('Late-Night')).toBe(false);
    expect(SLUG.test('a'.repeat(40))).toBe(false);
    expect(SLUG.test('-leading')).toBe(false);
  });

  it('拍号只收 b 加数字', () => {
    expect(BEAT.test('b1')).toBe(true);
    expect(BEAT.test('b12')).toBe(true);
    expect(BEAT.test('b')).toBe(false);
    expect(BEAT.test('../b1')).toBe(false);
    expect(BEAT.test('b9999')).toBe(false);
  });
});

describe('扩展名', () => {
  it('认不出的类型落到 .bin，不瞎猜一个容器格式', () => {
    expect(extFor('audio/webm;codecs=opus')).toBe('webm');
    expect(extFor('audio/mpeg')).toBe('mp3');
    expect(extFor('audio/mp4')).toBe('m4a');
    expect(extFor('audio/x-weird')).toBe('bin');
  });
});

describe('限流用的 IP 归一化', () => {
  it('IPv4 原样保留', () => {
    expect(ipBucket('203.0.113.7')).toBe('203.0.113.7');
  });

  // 这几条守的是「换个 IPv6 地址就绕过限流」。运营商随手一个 /64 里有
  // 一万八千万亿个地址，按完整地址限流等于没限。
  it('同一个 /64 里的不同地址必须落到同一个桶', () => {
    const a = ipBucket('2001:db8:1234:5678:aaaa:bbbb:cccc:dddd');
    const b = ipBucket('2001:db8:1234:5678:1111:2222:3333:4444');
    expect(a).toBe(b);
  });

  it('不同 /64 是不同的桶', () => {
    expect(ipBucket('2001:db8:1234:5678::1')).not.toBe(ipBucket('2001:db8:1234:9999::1'));
  });

  it('压缩写法要先展开，否则会被截错', () => {
    // fe80::1 展开是 fe80:0:0:0:0:0:0:1，前四组是 fe80:0:0:0
    expect(ipBucket('fe80::1')).toBe('fe80:0:0:0::/64');
    expect(ipBucket('fe80:0:0:0:0:0:0:1')).toBe('fe80:0:0:0::/64');
    expect(ipBucket('fe80::1')).toBe(ipBucket('fe80::abcd'));
  });

  it('空地址不会崩', () => {
    expect(ipBucket('')).toBe('unknown');
  });
});

describe('cleanText：投稿文字的清洗', () => {
  // 文字比录音危险：录音要有人听过才知道内容，文字是直接渲染到审核台
  // （将来还会渲染到站上）的，灌广告、夹链接、藏字符的成本低一个数量级。
  it('去掉控制字符，不让它们进审核台', () => {
    expect(cleanText('你瞅\u0000啥\u001b[31m', 100)).toBe('你瞅 啥 [31m');
  });

  it('去掉零宽字符——一段广告能整个藏在看着正常的句子里', () => {
    expect(cleanText('你\u200b瞅\u200c啥\ufeff', 100)).toBe('你瞅啥');
  });

  it('换行压平：一拍就是一句话，不需要排版', () => {
    expect(cleanText('你瞅啥\n\n你瞅啥', 100)).toBe('你瞅啥 你瞅啥');
  });

  it('按长度截断', () => {
    expect(cleanText('啊'.repeat(500), 300)).toHaveLength(300);
  });

  it('非字符串一律得到空串，不抛错——表单里缺字段是常态', () => {
    expect(cleanText(null, 100)).toBe('');
    expect(cleanText(undefined, 100)).toBe('');
    expect(cleanText(42, 100)).toBe('');
  });

  // 转义**不在这里做**：转义是输出侧的事（审核台用 esc()）。在入口转义会把
  // & 这类字符永久写坏，还会给人一种「已经安全了」的错觉。
  it('不做 HTML 转义——那是输出侧的责任，在入口做会写坏原文', () => {
    expect(cleanText('张三 & 李四', 100)).toBe('张三 & 李四');
  });
});
