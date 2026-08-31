import { describe, it, expect } from 'vitest';
import { voiceFor, instructFor, countBilledChars } from '../scripts/gen/src/tts';

describe('voiceFor', () => {
  it('冀鲁官话映射到山东话音色', () => {
    expect(voiceFor('jilu').dialect).toBe('山东话');
  });

  it('粤语用支持粤语的模型', () => {
    expect(voiceFor('yue').dialect).toBe('粤语');
  });

  it('没有对应音色的方言要抛错而不是悄悄退回普通话', () => {
    expect(() => voiceFor('nonexistent')).toThrow(/没有可用音色/);
  });

  // 以下几条是核实阿里云百炼官方文档后补的回归测试——
  // 见 scripts/gen/src/tts.ts 顶部注释里引用的文档出处。

  it('成渝片（四川话）有云端方言音色，用 qwen3-tts-flash', () => {
    const v = voiceFor('chengyu');
    expect(v.dialect).toBe('四川话');
    expect(v.model).toBe('qwen3-tts-flash');
  });

  it('冀鲁官话（山东话）用 CosyVoice 云端的 longanhuan_v3 + 方言 instruct，不必再退回本地', () => {
    // 第一轮曾判定云端没有山东话音色，标成本地——那是漏查了阿里云百炼自己
    // 也托管 CosyVoice v3 作为云端模型这件事。CosyVoice 音色列表核实过
    // longanhuan_v3 支持的方言清单里明确包含"山东话"。
    const v = voiceFor('jilu');
    expect(v.model).toBe('cosyvoice-v3-flash');
    expect(v.voice).toBe('longanhuan_v3');
    expect(v.dialectInstruction).toMatch(/山东话/);
  });

  it('东北官话用 CosyVoice 的东北话专属音色 longlaotie_v3，不需要额外 instruct', () => {
    const v = voiceFor('dongbei');
    expect(v.model).toBe('cosyvoice-v3-flash');
    expect(v.voice).toBe('longlaotie_v3');
    expect(v.dialect).toBe('东北话');
  });

  it('胶辽官话（青岛话）没有专属云端音色，继续走本地——"山东话"这个 instruct 大类是否准确覆盖胶辽口音，必须真人听测，不能由代码替用户假设', () => {
    expect(voiceFor('jiaoliao').model).toBe('cosyvoice3-local');
  });
});

describe('instructFor', () => {
  it('妈妈这一方带怒气', () => {
    expect(instructFor('mom')).toMatch(/生气|愤怒/);
  });

  it('空拍不给指令', () => {
    expect(instructFor('none')).toBe('');
  });

  it('未知 speakerRole 抛错而不是悄悄退回空指令', () => {
    // instructFor 的类型签名收窄成了 SpeakerRole，但运行时的值实际来自
    // YAML `as Scene` 断言，类型保证不是运行时保证——用 as 强转模拟一个
    // 拼错的角色，验证这里不会静默退回 ''（那会让 generate-audio.ts
    // 悄悄换成不带情绪的模型）。
    expect(() => instructFor('dad' as Parameters<typeof instructFor>[0])).toThrow(/未知的 speakerRole/);
  });
});

describe('countBilledChars', () => {
  it('中文按两字符计，其余按一字符', () => {
    expect(countBilledChars('你好')).toBe(4);
    expect(countBilledChars('ab')).toBe(2);
    expect(countBilledChars('你好ab')).toBe(6);
  });

  // 回归测试：核实阿里云计费规则原文是「1个汉字算2个有效字符，英文字母、
  // 全半角标点符号均算1个有效字符」——标点（包括中文全角标点）不翻倍。
  it('中文标点算一个字符，不跟着汉字翻倍', () => {
    expect(countBilledChars('你好？')).toBe(5);
    expect(countBilledChars('，')).toBe(1);
  });
});
