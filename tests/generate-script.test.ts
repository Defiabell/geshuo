import { describe, it, expect } from 'vitest';
import { assertLinesMatchBeats } from '../scripts/gen/src/generate-script';
import { loadScenes } from '../src/lib/content';
import type { TakeLine } from '../src/lib/types';

const DATA_DIR = new URL('../src/data/', import.meta.url).pathname;

function makeLine(beatId: string): TakeLine {
  return { beatId, textDialect: '随便写一句', textMandarin: '随便写一句' };
}

describe('assertLinesMatchBeats', () => {
  const scene = loadScenes(DATA_DIR).get('late-night')!;

  it('beatId 与条数都对得上时不抛错', () => {
    const lines = scene.beats.map((b) => makeLine(b.id));
    expect(() => assertLinesMatchBeats(scene, lines)).not.toThrow();
  });

  it('少一个 beat 时抛错并点名缺的是哪个', () => {
    const lines = scene.beats.slice(0, -1).map((b) => makeLine(b.id));
    expect(() => assertLinesMatchBeats(scene, lines)).toThrow(/缺少 beat：b6/);
  });

  it('多出一个未知 beat 时抛错并点名', () => {
    const lines = [...scene.beats.map((b) => makeLine(b.id)), makeLine('bx')];
    expect(() => assertLinesMatchBeats(scene, lines)).toThrow(/未知 beat：bx/);
  });

  it('beatId 集合对得上但条数不符（重复）时也要抛错', () => {
    const lines = [...scene.beats.map((b) => makeLine(b.id)), makeLine(scene.beats[0].id)];
    expect(() => assertLinesMatchBeats(scene, lines)).toThrow(/条数.*不符/);
  });
});
