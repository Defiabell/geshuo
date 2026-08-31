import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDialects, ancestorsOf, levelLabel } from '../src/lib/dialect-tree';

const DATA_DIR = new URL('../src/data/', import.meta.url).pathname;

describe('loadDialects', () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it('把 yaml 读成以 id 为键的 Map', () => {
    const map = loadDialects(DATA_DIR);
    expect(map.get('jilu')?.name).toBe('冀鲁官话');
    expect(map.get('jilu')?.level).toBe('group');
  });

  it('德州与青岛分属不同官话区', () => {
    const map = loadDialects(DATA_DIR);
    expect(map.get('dezhou')?.parentId).toBe('jilu');
    expect(map.get('qingdao')?.parentId).toBe('jiaoliao');
  });

  it('不存在「山东话」这样的合并节点', () => {
    const map = loadDialects(DATA_DIR);
    for (const d of map.values()) {
      expect(d.name).not.toBe('山东话');
    }
  });

  it('数据文件不存在时抛错', () => {
    expect(() => loadDialects('/nonexistent-dir-for-test')).toThrow();
  });

  it('parentId 指向不存在的节点时抛错', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'geshuo-dialect-tree-'));
    writeFileSync(
      join(tmpDir, 'dialects.yaml'),
      `- id: orphan\n  name: 孤儿方言\n  level: point\n  parentId: ghost\n`,
      'utf8',
    );

    expect(() => loadDialects(tmpDir as string)).toThrow(/parentId 指向不存在的节点/);
  });
});

describe('ancestorsOf', () => {
  it('返回从直接父级到根的链', () => {
    const map = loadDialects(DATA_DIR);
    const chain = ancestorsOf(map, 'dezhou').map((d) => d.id);
    expect(chain).toEqual(['jilu', 'guanhua']);
  });

  it('根节点没有祖先', () => {
    const map = loadDialects(DATA_DIR);
    expect(ancestorsOf(map, 'guanhua')).toEqual([]);
  });
});

describe('levelLabel', () => {
  it('给出中文层级名', () => {
    expect(levelLabel('group')).toBe('区');
    expect(levelLabel('point')).toBe('点');
    expect(levelLabel('supergroup')).toBe('大区');
  });
});
