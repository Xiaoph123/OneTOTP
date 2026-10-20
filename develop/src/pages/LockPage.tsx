import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { IconButton } from "../components/Button";
import { Backspace, Eye, EyeOff, Fingerprint, Lock, OneTotpMark } from "../components/icons";
import { authenticateBiometric, isBiometricEnrolled } from "../lib/biometric";
import { clearClipboard, readClearClipboardOnFail } from "../lib/utils";
import { isDesktop } from "../lib/platform";
import { useI18n } from "../i18n";

/** 连续失败达到该次数时清空剪贴板 */
const CLEAR_ON_FAIL_THRESHOLD = 5;

export function LockPage() {
  const { unlockWithPassword, passwordHint, hasLock, boot } = useApp();
  const { t } = useI18n();
  const desktop = isDesktop();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 生物识别可用性：支持平台（Windows/macOS/Android/iOS）且已保存凭据时提供入口
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  // bioBusy 的实时镜像：供事件监听回调读取最新值，避免闭包读到旧值
  const bioBusyRef = useRef(false);
  // 连续解锁失败次数：达阈值后清空剪贴板，成功解锁时归零
  const failCount = useRef(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      // 只查「是否已保存凭据」即可判定是否提供生物识别入口：
      // 有数据即代表该平台支持且已绑定，无需再单独调一次 checkStatus
      // （那是 winrt 冷启动较慢的调用，会明显拖慢锁定页的自动唤起）。
      const enrolled = await isBiometricEnrolled();
      if (alive) setBioAvailable(enrolled);
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** 走生物识别：认证通过后拿到口令，复用正常解锁流程 */
  const unlockByBiometric = async () => {
    if (bioBusyRef.current) return;
    bioBusyRef.current = true;
    setBioBusy(true);
    setError(null);
    try {
      const result = await authenticateBiometric(
        t("验证身份以解锁 OneTotp"),
        t("取消"),
      );
      if (result.ok && result.password) {
        const ok = await unlockWithPassword(result.password);
        if (!ok) setError(t("密码错误，请重试"));
      } else if (result.reason === "cancelled") {
        // 用户主动取消（点了系统弹窗的取消/关闭）：静默处理。
        // 关键：不能清除凭据、不能禁用入口——用户随时可再点一次，
        // 凭据在用户主动关闭开关前始终有效。
      } else if (result.reason === "lockout") {
        setError(t("生物识别尝试过多，请稍后再试"));
      } else {
        // 认证未能完成（系统暂时不可用、锁屏等系统弹窗被遮挡等）。
        // 注意：此处不能清除凭据或禁用入口——这类多为瞬时状态，
        // 下次进入或点按钮应能重试。仅在真正「凭据已不存在」时才降级。
        setError(t("生物识别不可用，请使用密码解锁"));
      }
    } finally {
      bioBusyRef.current = false;
      setBioBusy(false);
    }
  };

  // 自动唤起生物识别。触发时机：
  //  1) 锁定页挂载且页面可见时（首次进入 / 应用被系统锁定后回到前台）
  //  2) 页面从后台切回前台时（用户取消后回桌面、再回应用）
  // 关键：系统弹窗（含锁屏）无法在页面不可见时显示，故必须等可见再唤起；
  // 且每次回到前台都重新尝试，避免「取消一次后就不再自动弹」的问题。
  // 说明：刻意不监听 window 的 focus——桌面端系统认证框关闭会使窗口重新
  // 获得焦点，若据此触发会形成「取消后立刻又弹」的循环。
  useEffect(() => {
    if (!hasLock || !bioAvailable) return;

    const maybeAutoTrigger = () => {
      if (document.visibilityState !== "visible") return;
      if (bioBusyRef.current) return;
      unlockByBiometric();
    };

    // 挂载即尝试一次（冷启动进入锁定页）
    maybeAutoTrigger();

    const onVisibility = () => {
      if (document.visibilityState === "visible") maybeAutoTrigger();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLock, bioAvailable]);

  if (!hasLock) {
    // 无锁定密码时的兜底：直接尝试进入
    return (
      <div className="lock-page">
        <div className="lock-card">
          <OneTotpMark className="lock-boot-logo" />
          <div className="lock-boot-title">
            {t("正在打开 OneTotp")}
          </div>
          <button className="btn-primary-inline lock-enter-btn" onClick={boot}>
            {t("进入应用")}
          </button>
        </div>
      </div>
    );
  }

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    const ok = await unlockWithPassword(password);
    if (!ok) {
      setPassword("");
      failCount.current += 1;
      setError(t("密码错误，请重试"));
      // 连续失败达阈值且开启保护时清空剪贴板，避免暴力尝试期间取走已复制的验证码
      if (failCount.current >= CLEAR_ON_FAIL_THRESHOLD && readClearClipboardOnFail()) {
        failCount.current = 0;
        await clearClipboard();
        setError(t("已连续失败 {n} 次，剪贴板已清空", { n: CLEAR_ON_FAIL_THRESHOLD }));
      }
    } else {
      failCount.current = 0;
    }
    setBusy(false);
  };

  const press = (digit: string) => {
    if (password.length >= 32) return;
    setPassword((p) => p + digit);
  };

  const dots = Math.min(Math.max(password.length, 6), 12);

  return (
    <div className="lock-page">
      <div className="lock-card">
        <div className="lock-avatar"><OneTotpMark /></div>
        <div className="lock-title">{t("应用已锁定")}</div>
        <div className="lock-subtitle">
          {t("请输入密码以解锁 OneTotp")}
        </div>

        <form
          className="mt-16"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="lock-input-wrap">
            <input
              className={`ui-input lock-input${desktop ? " is-desktop" : ""}`}
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("输入锁定密码")}
              // 移动端不自动聚焦：否则软键盘会立即弹出并遮住数字键盘区，
              // 与移动端「用下方数字键盘输入」的交互冲突。
              autoFocus={desktop}
              autoComplete="current-password"
            />
            <IconButton
              label={show ? t("隐藏密码") : t("显示密码")}
              className="lock-eye"
              onClick={() => setShow((s) => !s)}
            >
              {show ? <EyeOff /> : <Eye />}
            </IconButton>
          </div>

          {/* 圆点指示器仅在移动端显示：桌面端用常规密码框，不需要 */}
          {!desktop ? (
            <div className="lock-dots">
              {Array.from({ length: dots }).map((_, i) => (
                <span key={i} className={`lock-dot${i < password.length ? " is-filled" : ""}`} />
              ))}
            </div>
          ) : null}

          {error ? (
            <div className={`notice notice-err notice-center${desktop ? " mt-12" : ""} mb-12`}>
              {error}
            </div>
          ) : null}

          <button type="submit" disabled={busy} className="lock-submit">
            <Lock className="icon-16" />
            {t("解锁")}
          </button>

          {/* 桌面端：Windows Hello 等生物识别作为独立的次级操作按钮 */}
          {desktop ? (
            <button
              type="button"
              disabled={!bioAvailable || bioBusy}
              onClick={unlockByBiometric}
              title={bioAvailable ? t("Windows Hello 解锁") : t("需先在设置中启用")}
              className="lock-bio-btn"
            >
              <Fingerprint className="icon-18" />
              {bioBusy ? t("正在验证…") : t("Windows Hello 解锁")}
            </button>
          ) : null}
        </form>

        {/* 数字键盘仅在移动端显示：桌面端为物理键盘输入 */}
        {!desktop ? (
          <div className="keypad mt-18">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button key={d} className="key-btn" type="button" onClick={() => press(d)}>
                {d}
              </button>
            ))}
            <button
              className="key-btn ghost"
              type="button"
              aria-label={t("生物识别")}
              disabled={!bioAvailable || bioBusy}
              title={bioAvailable ? t("指纹 / 面容解锁") : t("需先在设置中启用")}
              onClick={unlockByBiometric}
            >
              <Fingerprint className="icon-22" />
            </button>
            <button className="key-btn" type="button" onClick={() => press("0")}>
              0
            </button>
            <button
              className="key-btn ghost"
              type="button"
              aria-label={t("删除")}
              onClick={() => setPassword((p) => p.slice(0, -1))}
            >
              <Backspace className="icon-22" />
            </button>
          </div>
        ) : null}

        {passwordHint ? (
          <div className="lock-hint">
            {t("密码提示：{hint}", { hint: passwordHint })}
          </div>
        ) : null}

        {!desktop ? (
          <div className="lock-note">
            <svg viewBox="0 0 16 16" fill="none" stroke="var(--color-text-3)" strokeWidth={1.5} className="lock-note-icon">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 7.4v3.4M8 5.3v.1" strokeLinecap="round" />
            </svg>
            <span className="lock-note-text">
              {t("密码仅用于本机解锁，忘记后无法找回，只能通过加密备份在新设备恢复。")}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
