import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import { measureDurationMs } from './duration';
import type { Take } from '../../../src/lib/types';

/**
 * 给已经生成过、但还没记录时长的音频补上 durationMs。
 * 一次性回填工具——新生成的音频由 generate-audio.ts 自己量。
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PERF_DIR = join(ROOT, 'src/data/takes');

function main() {
  let filled = 0;
  let missing = 0;
  for (const f of readdirSync(PERF_DIR).filter((x) => x.endsWith('.yaml'))) {
    const path = join(PERF_DIR, f);
    const perf = parse(readFileSync(path, 'utf8')) as Take;
    let touched = false;
    for (const line of perf.lines) {
      if (!line.audio) continue;
      const ms = measureDurationMs(join(ROOT, 'public', line.audio));
      if (ms === undefined) { missing += 1; continue; }
      if (line.durationMs !== ms) { line.durationMs = ms; touched = true; filled += 1; }
    }
    if (touched) writeFileSync(path, stringify(perf), 'utf8');
  }
  console.log(`✓ 写入 ${filled} 条时长${missing ? `，${missing} 条量不到（没装 ffprobe？）` : ''}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
