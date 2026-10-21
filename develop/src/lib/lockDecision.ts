/**
 * 自动锁定的**判定内核**（纯函数，无 React / 无 Tauri 依赖）。
 *
 * 为什么单独抽出来：这段逻辑历史上一再出问题——「立即」被实现成每秒锁一次、
 * 失焦回放被当成用户离开、系统认证框引起的失焦误判……每一次都是因为判定
 * 和副作用（定时器、事件监听）缠在一起，只能靠人肉点界面验证。
 * 现在判定收敛成 3 个纯函数，行为由 tests/lockDecision.test.ts 自动覆盖。
 */

/** 「从不」的哨兵值（与设置页下拉框一致） */
export const NEVER_SENTINEL = 999999;

/** 空闲锁定策略 */
export type IdlePolicy =
  /** 不做空闲计时：只靠失焦 / 切到后台锁定 */
  | { kind: "none" }
  /** 空闲达到 seconds 秒后锁定 */
  | { kind: "idle"; seconds: number };

/**
 * 由设置值解析空闲策略。
 *
 * - `<= 0`     → `none`：**绝不能**退化成「每秒锁一次」。这正是锁屏反复触发的根因：
 *                 旧实现把 0 当成 1000ms 定时器，且抑制期内自我重排，永远停不下来。
 * - `>= 999999`→ `none`：「从不」
 * - 其他正数    → `idle`
 */
export function resolveIdlePolicy(
  autoLockSeconds: number,
  lockEnabled: boolean,
): IdlePolicy {
  if (!lockEnabled) return { kind: "none" };
  if (!Number.isFinite(autoLockSeconds)) return { kind: "none" };
  if (autoLockSeconds <= 0) return { kind: "none" };
  if (autoLockSeconds >= NEVER_SENTINEL) return { kind: "none" };
  return { kind: "idle", seconds: autoLockSeconds };
}

/** 空闲计时器每次采样后的动作 */
export type IdleTickAction =
  /** 该锁定 */
  | "lock"
  /** 视为一次活动（把空闲时钟归零），不锁 */
  | "reset"
  /** 什么也不做，空闲时钟继续累积 */
  | "wait";

/**
 * 空闲采样判定。
 *
 * `suppressed` 覆盖「系统认证框正前台」「刚解锁」「认证刚结束」三种情况。
 * 关键细节：抑制期内必须返回 `reset` 而不是 `wait`——否则用户解锁后什么都没做，
 * 抑制期一结束就已经「空闲超过阈值」而立刻被锁，体验上就是「一解锁就锁」。
 */
export function onIdleTick(input: {
  policy: IdlePolicy;
  idleMs: number;
  suppressed: boolean;
}): IdleTickAction {
  const { policy, idleMs, suppressed } = input;
  if (policy.kind === "none") return "wait";
  if (suppressed) return "reset";
  if (idleMs >= policy.seconds * 1000) return "lock";
  return "wait";
}

/** 焦点变化事件的处理方式 */
export type FocusChangeAction =
  /** 忽略：初始回放、连续失焦、未启用锁定、或处于抑制期 */
  | "ignore"
  /** 视为活动：重获焦点、重排空闲计时 */
  | "activity"
  /** 疑似离开：延迟确认后再决定是否锁定 */
  | "confirm";

/**
 * 焦点变化判定。
 *
 * `wasFocused === null` 表示还没确定初始焦点（isFocused() 尚未返回）。
 * 只有「确认此前处于聚焦态」才可能是用户离开：
 * Tauri 注册 onFocusChanged 时会回放一次当前状态，且解锁后窗口往往尚未
 * 重新获得焦点（系统认证框刚关闭），把这次回放当成失焦会导致每次解锁都
 * 立刻再锁一次。
 */
export function onFocusChange(input: {
  wasFocused: boolean | null;
  nowFocused: boolean;
  lockEnabled: boolean;
  lockOnBlur: boolean;
  suppressed: boolean;
}): FocusChangeAction {
  const { wasFocused, nowFocused, lockEnabled, lockOnBlur, suppressed } = input;
  if (nowFocused) return "activity";
  if (wasFocused !== true) return "ignore";
  if (!lockEnabled || !lockOnBlur) return "ignore";
  if (suppressed) return "ignore";
  return "confirm";
}

/**
 * 失焦确认（延迟一段时间后复查）是否应真正锁定。
 *
 * - `nowFocused`：复查时窗口是否已重新获得焦点（系统弹窗关闭后会回来）
 * - `hiddenByApp`：窗口是否是被**本应用自己**隐藏的（`hideWindow()`，
 *   即「复制后自动隐藏」）。这种隐藏是用户复制验证码后的正常流程，
 *   不该顺带锁定；而用户主动最小化 / 关闭到托盘导致的不可见**应当**锁定，
 *   设置页的说明写的就是「失去焦点或最小化后自动锁定」。
 * - `stillBlurred`：这段时间内是否又收到过焦点事件（lastFocused 仍为 false）
 */
export function onBlurConfirmed(input: {
  nowFocused: boolean;
  hiddenByApp: boolean;
  stillBlurred: boolean;
  suppressed: boolean;
}): boolean {
  const { nowFocused, hiddenByApp, stillBlurred, suppressed } = input;
  if (nowFocused) return false;
  if (hiddenByApp) return false;
  if (!stillBlurred) return false;
  if (suppressed) return false;
  return true;
}
