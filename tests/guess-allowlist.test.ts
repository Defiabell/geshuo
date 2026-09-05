import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadTakes } from '../src/lib/content';

const DATA_DIR = new URL('../src/data/', import.meta.url).pathname;

/**
 * functions/api/guess.ts 里的 KNOWN 清单是服务端判定「真实方言」的唯一依据
 * ——服务端不信客户端报的答案，只从 clip id 解析。这份清单一旦落后于
 * dialects.yaml，新方言的每一次猜测都会被判成 400，而前端只会显示「记不上」，
 * 没人会想到是这里漂了。
 */
describe('猜方言接口的方言清单', () => {
  it('必须覆盖题库里所有方言，否则新方言的猜测会被静默拒掉', () => {
    const src = readFileSync(new URL('../functions/api/guess.ts', import.meta.url), 'utf8');
    const m = src.match(/const KNOWN = \[([^\]]+)\]/);
    expect(m, 'guess.ts 里找不到 KNOWN 清单').not.toBeNull();
    const known = new Set([...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]));

    // 题库只收 AI 合成的（src/pages/guess.astro 里 filter source === 'tts'）：
    // 真人录音是答案本身，拿来考人没意义，而且这个游戏的产出正是用来判断
    // AI 音准的。所以真人录音专属的方言点（比如某个县）不需要进 KNOWN。
    const inPool = new Set(
      loadTakes(DATA_DIR)
        .filter((p) => p.source === 'tts')
        .map((p) => p.dialectId)
        .filter((d): d is string => d !== undefined),
    );
    expect(inPool.size, '题库是空的，这条测试等于没验').toBeGreaterThan(0);
    for (const d of inPool) {
      expect(known.has(d), `方言 ${d} 在猜方言题库里却不在 guess.ts 的 KNOWN 清单里`).toBe(true);
    }
  });

  it('题库里确实不含真人录音——那是答案，不是考题', () => {
    const human = loadTakes(DATA_DIR).filter((p) => p.source === 'human');
    const guessPage = readFileSync(new URL('../src/pages/guess.astro', import.meta.url), 'utf8');
    expect(guessPage).toContain("p.source === 'tts'");
    // 有真人录音时这条才真的在验东西
    if (human.length > 0) expect(human.every((p) => p.source !== 'tts')).toBe(true);
  });
});
