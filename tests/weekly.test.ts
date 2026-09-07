import { describe, it, expect } from 'vitest';
import { todayLocal, weeklySchedule } from '../src/lib/weekly';
import type { Scene } from '../src/lib/types';

const scene = (id: string, weekly?: string): Scene =>
  ({ id, title: id, situation: '', beats: [], roles: {}, weekly }) as unknown as Scene;

/**
 * 排期只有一处实现，因为它曾经有两处：首页带日期闸、/weekly/ 不带，
 * 结果首页放上一期、CTA 点进去是下一期。这组测试钉住那个行为。
 */
describe('一句话挑战排期', () => {
  const all = [scene('a', '2026-08-25'), scene('b', '2026-09-01'), scene('c', '2026-09-08')];

  it('还没到日子的不上线', () => {
    const { current, past } = weeklySchedule(all, '2026-09-07');
    expect(current!.id).toBe('b');
    expect(past.map((s) => s.id)).toEqual(['a']);
  });

  it('到了日子就换上去', () => {
    expect(weeklySchedule(all, '2026-09-08').current!.id).toBe('c');
  });

  it('排期当天算已到——写 09-08 就是 09-08 上线', () => {
    expect(weeklySchedule([scene('x', '2026-09-08')], '2026-09-08').current!.id).toBe('x');
  });

  it('一条都没到日子时退回最新一条：首页不能哑掉', () => {
    const { current, past } = weeklySchedule(all, '2026-01-01');
    expect(current!.id).toBe('c');
    expect(past).toEqual([]);
  });

  it('没有一句话挑战时 current 为空，不抛错', () => {
    expect(weeklySchedule([scene('n')], '2026-09-07').current).toBeUndefined();
  });
});

describe('本地日历日', () => {
  it('用本地时区，不是 UTC', () => {
    // 2026-09-07 23:30 本地时间：UTC 已经是 8 号，本地还是 7 号
    expect(todayLocal(new Date(2026, 8, 7, 23, 30))).toBe('2026-09-07');
  });

  it('月份日期补零', () => {
    expect(todayLocal(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
