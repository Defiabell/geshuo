import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Dialect, DialectLevel } from './types';

const LEVEL_LABELS: Record<DialectLevel, string> = {
  supergroup: '大区',
  group: '区',
  cluster: '片',
  subcluster: '小片',
  point: '点',
};

const VALID_LEVELS = Object.keys(LEVEL_LABELS) as DialectLevel[];

export function levelLabel(level: DialectLevel): string {
  return LEVEL_LABELS[level];
}

export function loadDialects(dir: string): Map<string, Dialect> {
  const raw = readFileSync(join(dir, 'dialects.yaml'), 'utf8');
  const list = parse(raw) as Dialect[];
  const map = new Map<string, Dialect>();

  for (const d of list) {
    if (!VALID_LEVELS.includes(d.level)) {
      throw new Error(`方言 ${d.id} 的 level 非法：${d.level}`);
    }
    if (map.has(d.id)) {
      throw new Error(`方言 id 重复：${d.id}`);
    }
    map.set(d.id, d);
  }

  for (const d of map.values()) {
    if (d.parentId !== null && !map.has(d.parentId)) {
      throw new Error(`方言 ${d.id} 的 parentId 指向不存在的节点：${d.parentId}`);
    }
  }

  return map;
}

export function ancestorsOf(map: Map<string, Dialect>, id: string): Dialect[] {
  const chain: Dialect[] = [];
  const seen = new Set<string>([id]);
  let cur = map.get(id)?.parentId ?? null;

  while (cur !== null) {
    if (seen.has(cur)) throw new Error(`方言树出现环：${cur}`);
    seen.add(cur);
    const node = map.get(cur);
    if (!node) throw new Error(`方言树断链：${cur}`);
    chain.push(node);
    cur = node.parentId;
  }

  return chain;
}
