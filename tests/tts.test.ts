import { describe, it, expect } from 'vitest';
import { voiceFor, instructionFor, countBilledChars, INSTRUCT_MODEL } from '../scripts/gen/src/tts';

describe('voiceFor：方言 × 声色', () => {
  it('同一个方言的两个声色档位必须是不同音色——否则妈妈和孩子共用一副嗓子', () => {
    for (const dialect of ['jilu', 'chengyu', 'yue', 'dongbei']) {
      const f = voiceFor(dialect, 'adult_female');
      const m = voiceFor(dialect, 'adult_male');
      expect(f.voice, `${dialect} 的男女声撞车了`).not.toBe(m.voice);
    }
  });

  it('每个方言的每个档位都真的在说那个方言，没有普通话混进来', () => {
    const expected: Record<string, string> = {
      jilu: '山东话',
      chengyu: '四川话',
      yue: '粤语',
      dongbei: '东北话',
    };
    for (const [dialect, name] of Object.entries(expected)) {
      for (const profile of ['adult_female', 'adult_male'] as const) {
        expect(voiceFor(dialect, profile).dialect).toBe(name);
      }
    }
  });

  it('没有对应音色的方言要抛错而不是悄悄退回普通话', () => {
    expect(() => voiceFor('nonexistent', 'adult_female')).toThrow(/没有可用音色/);
  });

  it('有这个方言但没有这个声色档位，也要抛错而不是拿别的档位顶替', () => {
    expect(() => voiceFor('jilu', 'young_female')).toThrow(/没有 young_female 档/);
  });

  it('胶辽官话（青岛话）刻意没有音色——没有胶辽专属音色，「山东话」指令能否覆盖胶东口音必须真人听测', () => {
    expect(() => voiceFor('jiaoliao', 'adult_female')).toThrow(/没有可用音色/);
  });

  // 回归测试：这一条钉住的是花过钱的教训。cosyvoice-v3-flash 实测完全无视
  // instruct 字段（五种指令输出 md5 相同），所以任何**依赖方言指令**的音色
  // 都不能落在这个模型上——否则出来的是普通话，而页面上标着方言。
  it('凡是靠 dialectInstruction 出方言的音色，必须落在支持 instruction 的模型上', () => {
    for (const dialect of ['jilu', 'chengyu', 'yue', 'dongbei']) {
      for (const profile of ['adult_female', 'adult_male'] as const) {
        const spec = voiceFor(dialect, profile);
        if (spec.dialectInstruction) {
          expect(spec.model, `${dialect}/${profile} 靠指令出方言，却落在无视指令的 ${spec.model} 上`)
            .toBe(INSTRUCT_MODEL);
        }
      }
    }
  });

  it('山东话没有专属音色，男女两档都必须走 instruction 路径并带上方言指令', () => {
    for (const profile of ['adult_female', 'adult_male'] as const) {
      const spec = voiceFor('jilu', profile);
      expect(spec.model).toBe(INSTRUCT_MODEL);
      expect(spec.dialectInstruction).toMatch(/山东话/);
    }
  });

  it('有方言专属音色的（四川/粤语）不带方言指令——方言是音色自带的', () => {
    for (const dialect of ['chengyu', 'yue']) {
      for (const profile of ['adult_female', 'adult_male'] as const) {
        expect(voiceFor(dialect, profile).dialectInstruction).toBeUndefined();
      }
    }
  });
});

describe('instructionFor', () => {
  it('方言指令在前、情绪在后拼成一句', () => {
    const spec = voiceFor('jilu', 'adult_female');
    const s = instructionFor('用非常生气的口气说。', spec);
    expect(s.indexOf('山东话')).toBeLessThan(s.indexOf('生气'));
  });

  it('没有方言指令时只剩情绪', () => {
    const spec = voiceFor('chengyu', 'adult_female');
    expect(instructionFor('用生气的口气说。', spec)).toBe('用生气的口气说。');
  });

  it('两者都没有时返回空串，调用方据此不发这个字段', () => {
    expect(instructionFor(undefined, voiceFor('chengyu', 'adult_male'))).toBe('');
  });
});

describe('countBilledChars', () => {
  it('中文按两字符计，其余按一字符', () => {
    expect(countBilledChars('你好')).toBe(4);
    expect(countBilledChars('ab')).toBe(2);
    expect(countBilledChars('你好ab')).toBe(6);
  });

  // 回归测试：阿里云计费规则原文是「1个汉字算2个有效字符，英文字母、
  // 全半角标点符号均算1个有效字符」——标点（包括中文全角标点）不翻倍。
  it('中文标点算一个字符，不跟着汉字翻倍', () => {
    expect(countBilledChars('你好？')).toBe(5);
    expect(countBilledChars('，')).toBe(1);
  });
});
