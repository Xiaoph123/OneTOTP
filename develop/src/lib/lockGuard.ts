/**
 * 自动锁定的**唯一状态源**。
 *
 * 背景：此前「不锁定」的判定分散在四个互不知情的地方（biometric.ts 的
 * inFlight/迟滞、useAutoLock 的本地 unlockedAt、AppContext 的
 * UNLOCK_LOCK_GUARD_MS、LockPage 的 autoTriedRef），任何一条路径没被覆盖
 * 就会误锁；而误锁 → 锁屏页重新挂载 → 自动唤起认证 → 再次误锁，形成死循环。
 * 现在所有「当前不该锁定」的信息只在本模块记录，其余模块只查询，不再各存一份。
 */

/** 解锁成功后的抑制窗口：覆盖系统认证框关闭、焦点回迁、可见性抖动的迟到投递 */
const POST_UNLOCK_MS = 1500;

/** 生物识别结束后的抑制窗口：覆盖弹窗关闭后延迟送达的失焦/可见性事件 */
const POST_BIOMETRIC_MS = 1500;

/** 自动唤起认证的最小间隔：防止锁屏页被反复重挂载时连续弹框 */
const AUTO_PROMPT_MIN_INTERVAL_MS = 3000;

let unlockedAt = 0;
let biometricBusy = false;
let biometricEndedAt = 0;
let lastAutoPromptAt = 0;
let hiddenByAppAt = 0;

/**
 * 应用自己隐藏窗口的判定窗口。
 * 「复制后自动隐藏」会立刻关掉窗口：这种隐藏是正常流程，不该顺带锁定。
 * 5 秒足够覆盖「隐藏 → 失焦事件 → 600ms 确认」这条链路。
 */
const HIDDEN_BY_APP_MS = 5000;

/** 标记「窗口是本应用自己隐藏的」（复制后自动隐藏） */
export function markHiddenByApp(): void {
  hiddenByAppAt = Date.now();
}

/** 窗口是否刚被本应用自己隐藏 */
export function wasHiddenByApp(): boolean {
  return hiddenByAppAt !== 0 && Date.now() - hiddenByAppAt < HIDDEN_BY_APP_MS;
}

/** 清除「本应用隐藏」标记：窗口重新获得焦点后，这次隐藏的上下文已结束 */
export function clearHiddenByApp(): void {
  hiddenByAppAt = 0;
}

/** 标记一次成功解锁（进入 ready 态） */
export function markUnlocked(): void {
  unlockedAt = Date.now();
}

/** 标记生物识别认证开始 */
export function markBiometricStart(): void {
  biometricBusy = true;
}

/** 标记生物识别认证结束（无论成功、取消还是失败） */
export function markBiometricEnd(): void {
  biometricBusy = false;
  biometricEndedAt = Date.now();
}

/** 认证进行中 */
export function isBiometricBusy(): boolean {
  return biometricBusy;
}

/**
 * 当前是否应抑制自动锁定。
 *
 * 三种情况视为「用户并没有主动离开」：
 *  - 系统认证框正在前台（biometricBusy）
 *  - 刚解锁（POST_UNLOCK_MS 内）
 *  - 认证刚结束（POST_BIOMETRIC_MS 内）
 */
export function isLockSuppressed(): boolean {
  const now = Date.now();
  if (biometricBusy) return true;
  if (unlockedAt !== 0 && now - unlockedAt < POST_UNLOCK_MS) return true;
  if (biometricEndedAt !== 0 && now - biometricEndedAt < POST_BIOMETRIC_MS) return true;
  return false;
}

/**
 * 是否允许本次自动唤起生物识别。
 * 锁定页可能因「锁定 → 解锁 → 再锁定」被反复挂载，若每次挂载都自动弹框，
 * 用户会感到「无限制地被要求验证」。故全局限制自动唤起频率。
 */
export function tryClaimAutoPrompt(): boolean {
  const now = Date.now();
  if (now - lastAutoPromptAt < AUTO_PROMPT_MIN_INTERVAL_MS) return false;
  lastAutoPromptAt = now;
  return true;
}
