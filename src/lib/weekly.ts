import type { Scene } from './types';

/**
 * 一句话挑战的排期。
 *
 * `weekly` 字段是**排期**，不是标签：写好下一期之后，它不该立刻顶掉这一期。
 *
 * 2026-09-07 的教训是两条，第二条更疼：
 * 1. 首页原来只按日期倒序取第一条，从没问过「到日子了吗」，于是 09-07 那天
 *    首屏放的是排在 09-08 的下一期。
 * 2. 修完第一条之后，**首页和 /weekly/ 各写了一遍这个判断**，一个带日期闸
 *    一个不带——首页放着上一期，CTA 点进去却是下一期，两个页面当场对不上。
 *    所以这件事必须只有一处实现，而不是"两处都记得改"。
 *
 * 判断发生在构建期（静态站没有运行时时钟）。语义因此是：**写下一期不会立刻
 * 上线，下一次构建（在排期日之后）才会换上去**。
 */

/** 本地日历日 YYYY-MM-DD。用本地时区，跟写 yaml 的人心里那个日子对齐，不用 UTC */
export function todayLocal(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export interface WeeklySchedule {
  /** 当期。没有任何一句话挑战时才是 undefined */
  current?: Scene;
  /** 往期，新的在前。**不含还没到日子的** */
  past: Scene[];
}

export function weeklySchedule(scenes: Iterable<Scene>, today = todayLocal()): WeeklySchedule {
  const sorted = [...scenes]
    .filter((s) => s.weekly)
    .sort((a, b) => (a.weekly! < b.weekly! ? 1 : -1));
  const due = sorted.filter((s) => s.weekly! <= today);
  // 一条都没到日子（只可能发生在全部排在未来时）就退回最新一条：
  // 首页哑掉比早放一期严重得多——首屏出声是那一块存在的全部理由。
  const live = due.length > 0 ? due : sorted.slice(0, 1);
  return { current: live[0], past: live.slice(1) };
}
