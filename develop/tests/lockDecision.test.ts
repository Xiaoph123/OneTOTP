/**
 * 自动锁定判定内核的自动化测试。
 *
 * 直接跑：npm test
 * （Node 24 原生支持 TypeScript 类型剥离，无需 tsc/vitest/ts-node）
 *
 * 覆盖的每一类都是历史上真实出过的问题，不是凑数的分支覆盖。
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  NEVER_SENTINEL,
  onBlurConfirmed,
  onFocusChange,
  onIdleTick,
  resolveIdlePolicy,
} from "../src/lib/lockDecision.ts";

describe("resolveIdlePolicy —— 「立即」绝不能退化成每秒锁定", () => {
  test("0 表示不做空闲计时（回归：曾被当成 1000ms 定时器，导致锁屏反复触发）", () => {
    assert.deepEqual(resolveIdlePolicy(0, true), { kind: "none" });
  });

  test("负数同样视为不做空闲计时", () => {
    assert.deepEqual(resolveIdlePolicy(-5, true), { kind: "none" });
  });

  test("999999 表示从不", () => {
    assert.deepEqual(resolveIdlePolicy(NEVER_SENTINEL, true), { kind: "none" });
    assert.deepEqual(resolveIdlePolicy(NEVER_SENTINEL + 1, true), { kind: "none" });
  });

  test("未启用锁定则一律不设空闲计时", () => {
    assert.deepEqual(resolveIdlePolicy(60, false), { kind: "none" });
  });

  test("正数正常生效", () => {
    assert.deepEqual(resolveIdlePolicy(60, true), { kind: "idle", seconds: 60 });
    assert.deepEqual(resolveIdlePolicy(30, true), { kind: "idle", seconds: 30 });
    assert.deepEqual(resolveIdlePolicy(1, true), { kind: "idle", seconds: 1 });
  });

  test("非法输入（NaN / Infinity）不会变成疯狂锁定", () => {
    assert.deepEqual(resolveIdlePolicy(Number.NaN, true), { kind: "none" });
    assert.deepEqual(resolveIdlePolicy(Number.POSITIVE_INFINITY, true), { kind: "none" });
  });
});

describe("onIdleTick —— 空闲采样", () => {
  const idle60 = { kind: "idle", seconds: 60 } as const;

  test("【关键回归】「立即」模式下连跑 10 分钟采样，一次都不许锁", () => {
    const policy = resolveIdlePolicy(0, true);
    // 模拟 500ms 采样、10 分钟、始终无输入、无抑制
    let idleMs = 0;
    for (let i = 0; i < 1200; i += 1) {
      idleMs += 500;
      const action = onIdleTick({ policy, idleMs, suppressed: false });
      assert.equal(action, "wait", `第 ${i} 次采样不应触发锁定/重置，否则就是死循环`);
    }
  });

  test("空闲未达阈值：继续等待", () => {
    assert.equal(onIdleTick({ policy: idle60, idleMs: 59_999, suppressed: false }), "wait");
  });

  test("空闲达到阈值：锁定", () => {
    assert.equal(onIdleTick({ policy: idle60, idleMs: 60_000, suppressed: false }), "lock");
    assert.equal(onIdleTick({ policy: idle60, idleMs: 90_000, suppressed: false }), "lock");
  });

  test("抑制期内不锁定，且要把空闲时钟归零（否则抑制一结束就立刻锁）", () => {
    assert.equal(onIdleTick({ policy: idle60, idleMs: 70_000, suppressed: true }), "reset");
  });

  test("有输入（idleMs 很小）时不锁", () => {
    assert.equal(onIdleTick({ policy: idle60, idleMs: 200, suppressed: false }), "wait");
  });

  test("「从不」模式永不锁定", () => {
    const policy = resolveIdlePolicy(NEVER_SENTINEL, true);
    assert.equal(onIdleTick({ policy, idleMs: 24 * 60 * 60 * 1000, suppressed: false }), "wait");
  });
});

describe("onFocusChange —— 焦点变化", () => {
  const base = { lockEnabled: true, lockOnBlur: true, suppressed: false };

  test("重获焦点 → 视为活动", () => {
    assert.equal(onFocusChange({ ...base, wasFocused: false, nowFocused: true }), "activity");
  });

  test("【关键回归】初始回放（wasFocused=null）不算失焦", () => {
    assert.equal(onFocusChange({ ...base, wasFocused: null, nowFocused: false }), "ignore");
  });

  test("连续失焦不重复处理", () => {
    assert.equal(onFocusChange({ ...base, wasFocused: false, nowFocused: false }), "ignore");
  });

  test("确认的失焦 → 进入延迟确认", () => {
    assert.equal(onFocusChange({ ...base, wasFocused: true, nowFocused: false }), "confirm");
  });

  test("未开启失焦锁定则不处理", () => {
    assert.equal(
      onFocusChange({ ...base, lockOnBlur: false, wasFocused: true, nowFocused: false }),
      "ignore",
    );
  });

  test("未启用锁定则不处理", () => {
    assert.equal(
      onFocusChange({ ...base, lockEnabled: false, wasFocused: true, nowFocused: false }),
      "ignore",
    );
  });

  test("认证弹窗引起的失焦被抑制", () => {
    assert.equal(
      onFocusChange({ ...base, suppressed: true, wasFocused: true, nowFocused: false }),
      "ignore",
    );
  });
});

describe("onBlurConfirmed —— 失焦延迟确认", () => {
  const ok = { nowFocused: false, hiddenByApp: false, stillBlurred: true, suppressed: false };

  test("确认失焦 → 锁定", () => {
    assert.equal(onBlurConfirmed(ok), true);
  });

  test("期间重获焦点 → 不锁（系统弹窗关闭后焦点会回来）", () => {
    assert.equal(onBlurConfirmed({ ...ok, nowFocused: true }), false);
  });

  test("本应用自己隐藏（复制后自动隐藏）→ 不锁", () => {
    assert.equal(onBlurConfirmed({ ...ok, hiddenByApp: true }), false);
  });

  test("【关键修复】用户最小化 / 关闭到托盘 → 仍要锁定", () => {
    // 设置页文案就是「失去焦点或最小化后自动锁定」。
    // 旧实现用 isVisible() 判断，最小化时 isVisible()=false 会把锁定跳过，
    // 表现就是「离开后台时自动锁定不生效」。
    assert.equal(onBlurConfirmed({ ...ok, hiddenByApp: false }), true);
  });

  test("期间又收到过焦点事件 → 不锁", () => {
    assert.equal(onBlurConfirmed({ ...ok, stillBlurred: false }), false);
  });

  test("抑制期内 → 不锁", () => {
    assert.equal(onBlurConfirmed({ ...ok, suppressed: true }), false);
  });
});

describe("端到端行为模拟 —— 「立即（离开时锁定）」下的完整时序", () => {
  /** 用纯函数模拟一次完整的「解锁 → 离开 → 回来」过程 */
  test("解锁后立刻失焦（认证框关闭的迟到事件）不会造成锁定循环", () => {
    const policy = resolveIdlePolicy(0, true);
    const suppressed = true; // 刚解锁，处于抑制窗口
    // 失焦事件在抑制期内到达
    const action = onFocusChange({
      wasFocused: true,
      nowFocused: false,
      lockEnabled: true,
      lockOnBlur: true,
      suppressed,
    });
    assert.equal(action, "ignore", "抑制期内的失焦必须被丢弃");
    // 抑制期结束后的空闲采样也不会锁（「离开时锁定」不做空闲计时）
    assert.equal(onIdleTick({ policy, idleMs: 5000, suppressed: false }), "wait");
  });

  test("用户真的切走：失焦 → 600ms 仍在后台 → 锁定，只锁一次", () => {
    const first = onFocusChange({
      wasFocused: true,
      nowFocused: false,
      lockEnabled: true,
      lockOnBlur: true,
      suppressed: false,
    });
    assert.equal(first, "confirm");
    assert.equal(
      onBlurConfirmed({
        nowFocused: false,
        hiddenByApp: false,
        stillBlurred: true,
        suppressed: false,
      }),
      true,
    );
    // 锁定后窗口仍是失焦态，若再来一次失焦事件（lastFocused=false）应被忽略
    assert.equal(
      onFocusChange({
        wasFocused: false,
        nowFocused: false,
        lockEnabled: true,
        lockOnBlur: true,
        suppressed: false,
      }),
      "ignore",
    );
  });
});
