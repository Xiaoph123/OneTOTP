import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { api } from "../lib/api";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconButton } from "../components/Button";
import { Eye, EyeOff, Fingerprint, Lock, OneTotpMark } from "../components/icons";
import { authenticateBiometric, clearBiometric, isBiometricEnrolled } from "../lib/biometric";
import { isBiometricBusy, tryClaimAutoPrompt } from "../lib/lockGuard";
import { clearClipboard, readClearClipboardOnFail } from "../lib/utils";
import { isDesktop, isMobile, isTauri } from "../lib/platform";
import { useI18n } from "../i18n";

/** 连续失败达到该次数时清空剪贴板 */
const CLEAR_ON_FAIL_THRESHOLD = 5;

/** 各平台生物识别的展示名（与「安全与锁定」页保持同一套文案） */
function biometricLabel(t: (k: string) => string): string {
  if (typeof navigator === "undefined") return t("指纹 / 人脸解锁");
  const ua = navigator.userAgent;
  if (isDesktop() && /Windows/i.test(ua)) return t("Windows Hello 解锁");
  if (isDesktop() && /Macintosh|Mac OS X/i.test(ua)) return t("Touch ID 解锁");
  return t("指纹 / 人脸解锁");
}

export function LockPage() {
  const { unlockWithPassword, passwordHint, hasLock, boot, error: bootError } = useApp();
  const { t } = useI18n();
  const desktop = isDesktop();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 生物识别可用性：支持平台（Windows/macOS/Android/iOS）且已保存凭据时提供入口
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  // bioBusy 的实时镜像：供事件监听回调读取最新值，避免闭包读到旧值
  const bioBusyRef = useRef(false);
  // 本次锁定是否已通过生物识别解锁成功：成功后禁止任何自动唤起
  const bioDoneRef = useRef(false);
  // 本次进入锁定页是否已自动唤起过一次：防止弹窗引起的可见性变化触发循环重弹
  const autoTriedRef = useRef(false);
  // 连续解锁失败次数：达阈值后清空剪贴板，成功解锁时归零
  const failCount = useRef(0);
  // 统一展示的错误：本页交互错误优先，其次为 boot / 后端错误
  const shownError = error ?? bootError;

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
        t("验证身份以解锁 OneTOTP"),
        t("取消"),
      );
      void api.traceEvent(
        `biometric result ok=${result.ok} reason=${result.reason ?? "-"}` +
          (result.detail ? ` detail=${result.detail.slice(0, 120)}` : ""),
      );
      if (result.ok && result.password) {
        const ok = await unlockWithPassword(result.password);
        if (ok) {
          // 解锁成功后本页随即卸载；置位防止卸载前的可见性事件再触发一次认证
          bioDoneRef.current = true;
        } else {
          setError(t("密码错误，请重试"));
        }
      } else if (result.reason === "cancelled") {
        // 用户主动取消（点了系统弹窗的取消/关闭）：静默处理。
        // 关键：不能清除凭据、不能禁用入口——用户随时可再点一次，
        // 凭据在用户主动关闭开关前始终有效。
      } else if (result.reason === "lockout") {
        setError(t("生物识别尝试过多，请稍后再试"));
      } else if (result.reason === "credential_missing") {
        // 本机 Hello 凭据已失效（重设 PIN / 换机 / 被系统清理），但加密数据
        // 条目可能仍在——`hasData` 仍返回 true，于是入口看似可用却永远弹不出
        // 认证框。这里清掉失效条目并关掉入口，提示用户重新启用，
        // 避免「点了按钮毫无反应」的黑洞。
        await clearBiometric();
        setBioAvailable(false);
        setError(
          t("本机生物识别凭据已失效，请在「安全与锁定」中关闭后重新开启该功能"),
        );
      } else {
        // 认证未能完成（系统暂时不可用、锁屏等系统弹窗被遮挡等）。
        // 注意：此处不清除凭据或禁用入口——这类多为瞬时状态，下次可重试。
        setError(
          result.detail
            ? t("生物识别不可用（{detail}），请使用密码解锁", { detail: result.detail })
            : t("生物识别不可用，请使用密码解锁"),
        );
      }
    } finally {
      bioBusyRef.current = false;
      setBioBusy(false);
    }
  };

  // 自动唤起生物识别：只在**窗口真正在前台**时弹一次。
  //
  // 两个要点：
  // 1) 不能一挂载就弹。锁屏页的挂载时机往往是「最小化 / 关闭到托盘」的瞬间，
  //    此时窗口在后台，弹认证框等于「在后台要求验证」；更糟的是用户在后台
  //    通过验证后解锁，等他回到窗口时已经是解锁态——「打开时才验证」的预期落空。
  // 2) 不能只等事件。窗口被 hide()/show() 时 WebView 未必送来 visibilitychange，
  //    焦点事件也可能不触发。故用**主动查询** isFocused()/isVisible() 轮询，
  //    窗口一到前台就弹。
  //
  // 限次：每次进入锁定页只自动弹一次（autoTriedRef + 全局限频），
  // 用户取消后不再反复骚扰，可随时手动点按钮重试。
  useEffect(() => {
    if (!hasLock || !bioAvailable) return;
    if (autoTriedRef.current) return;

    let disposed = false;

    // 探测「现在是否适合弹框」，并把各项取值一并返回，便于 trace 定位
    const probe = async (): Promise<{ ok: boolean; why: string }> => {
      if (isMobile()) {
        const ok = document.visibilityState === "visible";
        return { ok, why: `mobile visibility=${document.visibilityState}` };
      }
      if (!isTauri()) return { ok: true, why: "not-tauri" };
      const win = getCurrentWindow();
      const safe = async (fn: () => Promise<boolean>): Promise<boolean | null> => {
        try {
          return await fn();
        } catch {
          return null; // 查询失败
        }
      };
      const focused = await safe(() => win.isFocused());
      const visible = await safe(() => win.isVisible());
      let minimized: boolean | null = null;
      try {
        minimized = await win.isMinimized();
      } catch {
        minimized = null;
      }
      // 「用户是不是正看着这个窗口」以 WebView 自身的焦点为准。
      // 实测 Tauri 的 `Window::isFocused()` 在本应用窗口上恒为 false
      // （Windows 已把窗口判为前台，tao 的焦点标志却仍是 false），
      // 用它当门槛会导致自动弹框永远不触发。`document.hasFocus()` 直接反映
      // WebView 的键盘焦点，纯前端、无权限依赖，语义也更贴近需求。
      const hasFocus = typeof document.hasFocus === "function" ? document.hasFocus() : true;
      // minimized / visible 为「明确为坏值」时才拦截，查询失败不拦。
      const ok =
        (hasFocus || focused === true) && visible !== false && minimized !== true;
      return {
        ok,
        why: `hasFocus=${hasFocus} focused=${focused} visible=${visible} minimized=${minimized}`,
      };
    };

    const maybeAutoTrigger = async () => {
      if (disposed || autoTriedRef.current || bioDoneRef.current) return;
      if (bioBusyRef.current || isBiometricBusy()) return;
      const gate = await probe();
      if (!gate.ok) {
        void api.traceEvent(`auto-prompt skipped: ${gate.why}`);
        return; // 不在前台：交给轮询继续等
      }
      if (disposed || autoTriedRef.current) return;
      if (!tryClaimAutoPrompt()) {
        void api.traceEvent("auto-prompt skipped: rate limited");
        return;
      }
      void api.traceEvent("auto-prompt start");
      autoTriedRef.current = true;
      await unlockByBiometric();
    };

    // 稍等一拍再尝试：锁定往往发生在「点最小化/关闭」的瞬间，
    // 此刻窗口的焦点状态尚未尘埃落定，立即判定可能在后台弹出认证框。
    const firstTimer = window.setTimeout(() => {
      void maybeAutoTrigger();
    }, 400);

    // 轮询等待窗口回到前台：不依赖任何事件，最小化/托盘恢复都能覆盖
    const poll = window.setInterval(() => {
      void maybeAutoTrigger();
    }, 700);

    // 移动端补充事件驱动（页面可见性变化）
    const onVisibility = () => {
      void maybeAutoTrigger();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      window.clearTimeout(firstTimer);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLock, bioAvailable]);

  // 未设置锁定密码却进入了锁定态（典型场景：关闭到托盘时后端直接锁定内存密钥，
  // 或启动时 boot 尚未完成）。此时没有密码可输，必须自动重新解锁，
  // 否则页面会一直空白。boot 失败会写入 error，由下方错误卡片兜底。
  const autoBootRef = useRef(false);
  useEffect(() => {
    if (hasLock || shownError || autoBootRef.current) return;
    autoBootRef.current = true;
    void boot();
  }, [hasLock, shownError, boot]);

  if (!hasLock) {
    // 未设置锁定密码：boot 会自动完成初始化，不需要用户看到任何中间页。
    // 这里直接渲染空内容，由启动画面 / 主界面衔接；
    // 仅当 boot 失败（典型场景：保险库用口令加密，但 onetotp.lock.json 丢失，
    // 此时 hasLock=false 但机器密钥解不开）才展示原因与重试入口。
    if (!shownError) return null;
    return (
      <div className="lock-page">
        <div className="lock-card">
          <OneTotpMark className="lock-boot-logo" />
          <div className="lock-boot-title">{t("无法打开保险库")}</div>
          <div className="notice notice-err notice-center mb-12 lock-error">
            {shownError}
          </div>
          <div className="lock-note">
            <span className="lock-note-text">
              {t("保险库已加密，但本机缺少匹配的解锁凭证或机器密钥。请检查应用数据目录下的 onetotp.lock.json 是否被删除；数据可用加密备份在其他设备恢复。")}
            </span>
          </div>
          <button className="btn-primary-inline lock-enter-btn" onClick={boot}>
            {t("重试")}
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

  return (
    <div className="lock-page">
      <div className="lock-inner">
        <OneTotpMark className="lock-logo" />
        <div className="lock-title">{t("应用已锁定")}</div>
        <div className="lock-subtitle">{t("请输入密码以解锁 OneTOTP")}</div>

        <form
          className="lock-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="lock-input-wrap">
            <input
              ref={inputRef}
              className="ui-input lock-input"
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("输入锁定密码")}
              // 移动端不自动聚焦：避免一进锁屏页就弹出软键盘遮住界面，
              // 用户点输入框时再唤起，观感更从容。
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

          {shownError ? (
            <div className="notice notice-err notice-center lock-error">{shownError}</div>
          ) : null}

          <button type="submit" disabled={busy} className="lock-submit">
            <Lock className="icon-16" />
            {t("解锁")}
          </button>

          {/* 生物识别：桌面端为 Windows Hello / Touch ID，移动端为指纹 / 人脸。
              两端都作为次级操作放在主按钮下方，视觉权重低于密码解锁。 */}
          <button
            type="button"
            disabled={!bioAvailable || bioBusy}
            onClick={unlockByBiometric}
            title={bioAvailable ? biometricLabel(t) : t("需先在设置中启用")}
            className="lock-bio-btn"
          >
            <Fingerprint className="icon-18" />
            {bioBusy ? t("正在验证…") : biometricLabel(t)}
          </button>
        </form>

        {passwordHint ? (
          <div className="lock-hint">{t("密码提示：{hint}", { hint: passwordHint })}</div>
        ) : null}

        <div className="lock-note">
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="var(--color-text-3)"
            strokeWidth={1.5}
            className="lock-note-icon"
          >
            <circle cx="8" cy="8" r="6" />
            <path d="M8 7.4v3.4M8 5.3v.1" strokeLinecap="round" />
          </svg>
          <span className="lock-note-text">
            {t("密码仅用于本机解锁，忘记后无法找回，只能通过加密备份在新设备恢复。")}
          </span>
        </div>
      </div>
    </div>
  );
}
