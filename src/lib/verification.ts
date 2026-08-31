import type { Verification } from './types';

/**
 * 三态可信度的标签文字与样式类名——唯一真源。LineCard.astro（场景页）与
 * compare/[beat].astro（横向对比页）都必须从这里取值，不许各自维护一份。
 *
 * 分叉的历史教训：对比页曾经抄了一份旧的两态判断
 * （`verification === 'human_recorded' ? '真人录音' : 'AI · 未校对'`），
 * 把 native_verified（已经母语者校对）也误标成了「未校对」——三档可信度
 * 必须在页面上直接可见，不许塌成两档，尤其是对比页这种可以被直接分享、
 * 直接落地的 URL。
 */
export const VERIFICATION_LABELS: Record<Verification, string> = {
  unverified: 'AI 生成 · 未经母语者校对',
  native_verified: 'AI 生成 · 已经母语者校对',
  human_recorded: '真人录音',
};

// 三态在视觉上必须三档可分——native_verified 不能和 unverified 共用同一个红色警示样式，
// 否则「已校对」与「未校对」在页面上扫一眼看不出区别，等于隐藏了这个区分。
export const VERIFICATION_TAG_CLASS: Record<Verification, string> = {
  unverified: 'unver',
  native_verified: 'verified',
  human_recorded: 'human',
};
