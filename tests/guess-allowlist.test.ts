import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadPerformances } from '../src/lib/content';

const DATA_DIR = new URL('../src/data/', import.meta.url).pathname;

/**
 * functions/api/guess.ts 里的 KNOWN 清单是服务端判定「真实方言」的唯一依据
 * ——服务端不信客户端报的答案，只从 clip id 解析。这份清单一旦落后于
 * dialects.yaml，新方言的每一次猜测都会被判成 400，而前端只会显示「记不上」，
 * 没人会想到是这里漂了。
 */
describe('猜方言接口的方言清单', () => {
  it('必须覆盖所有已有演绎的方言，否则新方言的猜测会被静默拒掉', () => {
    const src = readFileSync(new URL('../functions/api/guess.ts', import.meta.url), 'utf8');
    const m = src.match(/const KNOWN = \[([^\]]+)\]/);
    expect(m, 'guess.ts 里找不到 KNOWN 清单').not.toBeNull();
    const known = new Set([...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]));

    const used = new Set(loadPerformances(DATA_DIR).map((p) => p.dialectId));
    for (const d of used) {
      expect(known.has(d), `方言 ${d} 有演绎却不在 guess.ts 的 KNOWN 清单里`).toBe(true);
    }
  });
});
