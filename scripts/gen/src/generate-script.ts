import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stringify } from 'yaml';
import { loadScenes } from '../../../src/lib/content';
import { loadLexicon, buildPrompt, auditDraft } from './lexicon';
import type { Take, TakeLine, Scene } from '../../../src/lib/types';

// fileURLToPath() 而不是 new URL(...).pathname——.pathname 不做百分号解码，
// 路径里带空格或中文（这台机器的用户目录路径就可能含中文）会直接变成
// ENOENT，而这个 ROOT 是读场景数据、写生成结果 YAML 的锚点。
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DATA_DIR = join(ROOT, 'src/data/');
const LEX_DIR = join(ROOT, 'scripts/gen/lexicons/');

/**
 * 写盘前的结构校验：lines 的 beatId 集合必须等于 scene.beats 的 id 集合，
 * 且条数相符。不通过就抛错、不写文件——避免坏数据先落盘成一个「看起来生成
 * 好了」的文件，等下一步跑 vitest/build 才暴露。
 */
export function assertLinesMatchBeats(scene: Scene, lines: TakeLine[]): void {
  const beatIds = new Set(scene.beats.map((b) => b.id));
  const lineIds = new Set(lines.map((l) => l.beatId));

  const missing = [...beatIds].filter((id) => !lineIds.has(id));
  const extra = [...lineIds].filter((id) => !beatIds.has(id));

  if (missing.length > 0) {
    throw new Error(`生成结果缺少 beat：${missing.join('、')}`);
  }
  if (extra.length > 0) {
    throw new Error(`生成结果包含未知 beat：${extra.join('、')}`);
  }
  if (lines.length !== scene.beats.length) {
    throw new Error(
      `生成结果台词条数（${lines.length}）与场景拍数（${scene.beats.length}）不符`,
    );
  }
}

async function main() {
  const [sceneId, dialectId] = process.argv.slice(2);
  if (!sceneId || !dialectId) {
    console.error('用法: pnpm run gen:script -- <sceneId> <dialectId>');
    process.exit(1);
  }

  const scene = loadScenes(DATA_DIR).get(sceneId);
  if (!scene) throw new Error(`场景不存在：${sceneId}`);
  const lex = loadLexicon(LEX_DIR, dialectId);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: buildPrompt(scene, lex) }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);

  const body = (await res.json()) as { content: Array<{ text: string }> };
  const text = body.content.map((c) => c.text).join('');
  const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  const lines = JSON.parse(json) as TakeLine[];

  // 结构校验先行：beatId 对不齐就直接抛错，不写文件、不做词表审计。
  assertLinesMatchBeats(scene, lines);

  // 空拍（speakerRole === 'none'，如「沉默，门关上」）没有台词内容可言，
  // auditDraft 不了解 beat 语义，过滤责任在调用方这里。
  const speakerRoleByBeatId = new Map(scene.beats.map((b) => [b.id, b.speakerRole]));
  const substantiveTexts = lines
    .filter((l) => speakerRoleByBeatId.get(l.beatId) !== 'none')
    .map((l) => l.textDialect);

  const issues = auditDraft(substantiveTexts, lex);
  if (issues.length > 0) {
    console.warn('⚠ 词表审计有问题，请人工过一遍：');
    issues.forEach((i) => console.warn('  - ' + i));
  }

  const take: Take = {
    id: `${sceneId}.${dialectId}`,
    sceneId,
    dialectId,
    source: 'tts',
    verification: 'unverified',
    lines,
  };

  const out = join(DATA_DIR, 'takes', `${sceneId}.${dialectId}.yaml`);
  writeFileSync(out, stringify(take), 'utf8');
  console.log(`✓ 写入 ${out}`);
  console.log('  记住：这是未校对稿，上线前请母语者过目。');
}

// 仅在直接作为入口脚本运行时才执行 main()——被测试文件 import 时不能
// 触发网络请求 / process.exit。用 pathToFileURL() 而不是手工拼
// `file://${process.argv[1]}`：手工拼接不做 URL 编码，argv[1] 里的空格
// （或 Windows 盘符）会让这个比较永远为假，main() 就再也不会被触发。
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
