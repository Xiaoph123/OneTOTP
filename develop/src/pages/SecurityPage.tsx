import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { api } from "../lib/api";
import { TabBar, type TabKey } from "../components/TabBar";
import { Switch } from "../components/Controls";
import { Select } from "../components/Select";
import { useToast } from "../components/Toast";
import { Button, IconButton } from "../components/Button";
import { AlertTriangle, ChevronLeft, Eye, EyeOff } from "../components/icons";
import {
  clearBiometric,
  enrollBiometric,
  hasBiometricBridge,
  isBiometricEnrolled,
  isBiometricSupported,
} from "../lib/biometric";
import { isDesktop } from "../lib/platform";
import { useI18n } from "../i18n";

/** 各平台生物识别的展示名（Linux 等不支持平台回退为通用文案） */
function biometricLabel(t: (k: string) => string): string {
  if (typeof navigator === "undefined") return t("指纹 / 面容解锁");
  const ua = navigator.userAgent;
  if (isDesktop() && /Windows/i.test(ua)) return t("Windows Hello 解锁");
  if (isDesktop() && /Macintosh|Mac OS X/i.test(ua)) return t("Touch ID 解锁");
  return t("指纹 / 面容解锁");
}

export function SecurityPage() {
  const { t } = useI18n();
  const { settings, saveSettings, navigate, goBack } = useApp();
  const toast = useToast();
  const [draft, setDraft] = useState(settings);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [hint, setHint] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [biometric, setBiometric] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  // 生物识别能力：支持平台 + 是否已录入指纹/面容
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnrolled, setBioEnrolled] = useState(false);
  const pwdPanelRef = useRef<HTMLDivElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (settings) setHint(settings.passwordHint || "");
  }, [settings]);

  // 探测生物识别能力与已保存凭据（异步，依赖系统接口）
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!hasBiometricBridge()) {
        if (alive) setBioAvailable(false);
        return;
      }
      const supported = await isBiometricSupported();
      const enrolled = supported ? await isBiometricEnrolled() : false;
      if (!alive) return;
      setBioAvailable(supported);
      setBioEnrolled(enrolled);
      setBiometric(enrolled);
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** 切换生物识别：开启时需先认证并加密保存当前口令；关闭时清除凭据 */
  const handleBiometricChange = async (enabled: boolean) => {
    if (bioBusy) return;
    if (!enabled) {
      await clearBiometric();
      setBiometric(false);
      setBioEnrolled(false);
      toast.info(t("已关闭生物识别解锁"));
      return;
    }
    // 开启：必须已有解锁口令（用于加密保存），未设置则引导去设置
    if (!lockEnabled || !current) {
      toast.warning(t("请先输入当前密码以启用生物识别"));
      pwdPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => passwordInputRef.current?.focus(), 300);
      return;
    }
    setBioBusy(true);
    try {
      // 先验证当前密码是否正确，避免保存错误口令
      await api.unlock(current);
      const result = await enrollBiometric(current);
      if (result.ok) {
        setBiometric(true);
        setBioEnrolled(true);
        toast.success(t("已启用生物识别解锁"));
      } else if (result.reason === "cancelled") {
        // 用户在系统弹窗中取消，不提示为失败
      } else {
        toast.error(t("生物识别启用失败，请重试"));
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBioBusy(false);
    }
  };

  if (!draft) {
    return (
      <>
        <header className="app-bar">
          <IconButton label={t("返回")} onClick={() => goBack()}>
            <ChevronLeft />
          </IconButton>
          <span style={{ fontSize: "var(--font-size-h4)", fontWeight: 500 }}>{t("安全与锁定")}</span>
        </header>
        <section className="app-body">
          <div className="empty-state">
            <span className="empty-desc">{t("正在加载…")}</span>
          </div>
        </section>
      </>
    );
  }

  const lockEnabled = draft.lockEnabled;

  const handleEnableChange = async (enabled: boolean) => {
    setMessage(null);
    if (!enabled) {
      // 关闭锁定：需要确认当前密码
      if (!current) {
        setMessage({ type: "err", text: t("请输入当前密码以关闭锁定") });
        toast.error(t("请输入当前密码以关闭锁定"));
        return;
      }
      setBusy(true);
      try {
        await api.unlock(current);
        await api.setLockPassword("", "", false);
        // 关闭锁定后，生物识别凭据已无意义，一并清除避免残留
        await clearBiometric();
        setBiometric(false);
        setBioEnrolled(false);
        const s = await api.getSettings();
        await saveSettings(s);
        setDraft(s);
        setCurrent("");
        setMessage({ type: "ok", text: t("已关闭应用锁定") });
        toast.success(t("已关闭应用锁定"));
      } catch (e) {
        setMessage({ type: "err", text: String(e) });
        toast.error(String(e));
      } finally {
        setBusy(false);
      }
      return;
    }

    // 开启锁定必须设置密码：引导用户到密码设置区
    toast.info(t("请先在下方设置锁定密码"));
    pwdPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => passwordInputRef.current?.focus(), 300);
  };

  const handleChangePassword = async () => {
    setMessage(null);
    if (next !== confirm) {
      setMessage({ type: "err", text: t("两次输入的新密码不一致") });
      toast.error(t("两次输入的新密码不一致"));
      return;
    }
    if (next.length < 8) {
      setMessage({ type: "err", text: t("新密码长度至少 8 位") });
      toast.error(t("新密码长度至少 8 位"));
      return;
    }
    setBusy(true);
    try {
      if (lockEnabled) {
        // 校验当前密码
        await api.unlock(current);
      }
      await api.setLockPassword(next, hint, true);
      // 密码变更后，生物识别中保存的旧口令会失效，需用新口令重新登记
      if (bioEnrolled) {
        const re = await enrollBiometric(next);
        if (!re.ok) {
          // 重新登记失败（多为用户取消）：清除失效凭据，避免下次解锁必然失败
          await clearBiometric();
          setBiometric(false);
          setBioEnrolled(false);
        }
      }
      const s = await api.getSettings();
      await saveSettings(s);
      setDraft(s);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage({ type: "ok", text: t("密码已更新") });
      toast.success(lockEnabled ? t("锁定密码已更新") : t("已启用应用锁定"));
    } catch (e) {
      setMessage({ type: "err", text: String(e) });
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onTabSelect = (key: TabKey) => {
    if (key === "codes") navigate({ name: "codes" });
  };

  const strength = passwordStrength(next);

  // 生物识别状态提示文案
  const bioHint = !bioAvailable
    ? t("当前平台不支持生物识别解锁")
    : bioEnrolled
      ? t("调用系统指纹或面容快速解锁")
      : t("当前设备未录入指纹或面容");

  return (
    <>
      <header className="app-bar">
        <IconButton label={t("返回")} onClick={() => goBack()}>
          <ChevronLeft />
        </IconButton>
        <span style={{ fontSize: "var(--font-size-h4)", fontWeight: 500 }}>{t("安全与锁定")}</span>
      </header>

      <section className="app-body">
        <div className="panel">
          <div className="s-row">
            <div className="s-main">
              <div className="s-title">{t("启用应用锁定")}</div>
              <div className="s-desc">{t("打开应用时需输入密码才能查看验证码")}</div>
            </div>
            <Switch checked={lockEnabled} onChange={handleEnableChange} label={t("启用应用锁定")} disabled={busy} />
          </div>
          <div className="s-row">
            <div className="s-main">
              <div className="s-title">{t("离开后台时自动锁定")}</div>
              <div className="s-desc">{t("失去焦点或最小化后自动锁定")}</div>
            </div>
            <Switch
              checked={draft.lockOnBlur}
              disabled={!lockEnabled}
              onChange={async (v) => {
                const nextDraft = { ...draft, lockOnBlur: v };
                setDraft(nextDraft);
                await saveSettings(nextDraft);
              }}
              label={t("离开后台自动锁定")}
            />
          </div>
          <div className="s-row">
            <div className="s-main">
              <div className="s-title">{t("自动锁定时长")}</div>
              <div className="s-desc">{t("无操作超过该时长后锁定")}</div>
            </div>
            <Select
              width={124}
              value={draft.autoLockSeconds}
              disabled={!lockEnabled}
              onChange={async (v) => {
                const nextDraft = { ...draft, autoLockSeconds: v };
                setDraft(nextDraft);
                await saveSettings(nextDraft);
              }}
              options={[
                { value: 0, label: t("立即") },
                { value: 60, label: t("1 分钟") },
                { value: 300, label: t("5 分钟") },
                { value: 900, label: t("15 分钟") },
                { value: 999999, label: t("从不") },
              ]}
            />
          </div>
        </div>

        <div className="panel" ref={pwdPanelRef} style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: "var(--font-size-h4)", fontWeight: 500 }}>
            {lockEnabled ? t("锁定密码") : t("设置锁定密码")}
          </div>
          <div style={{ fontSize: "var(--font-size-body)", color: "var(--color-text-3)", margin: "4px 0 12px" }}>
            {lockEnabled
              ? t("密码经加盐哈希（Argon2id）存储在本地，不会上传或同步")
              : t("开启应用锁定后，需设置密码才能进入；密码加盐哈希存储在本地")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {lockEnabled ? (
              <div className="field">
                <label className="field-label">{t("当前密码")}</label>
                <div style={{ position: "relative" }}>
                  <input
                    className="ui-input"
                    type={showPwd ? "text" : "password"}
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    placeholder={t("输入当前锁定密码")}
                    style={{ paddingRight: 40 }}
                    autoComplete="current-password"
                  />
                  <IconButton
                    label={showPwd ? t("隐藏密码") : t("显示密码")}
                    style={{ position: "absolute", right: 4, top: 0 }}
                    onClick={() => setShowPwd((s) => !s)}
                  >
                    {showPwd ? <EyeOff /> : <Eye />}
                  </IconButton>
                </div>
              </div>
            ) : null}
            <div className="field">
              <label className="field-label">{lockEnabled ? t("新密码") : t("设置密码")}</label>
              <input
                ref={passwordInputRef}
                className="ui-input"
                type={showPwd ? "text" : "password"}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder={t("至少 8 位")}
                autoComplete="new-password"
              />
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                {[1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    style={{
                      flex: 1,
                      height: 4,
                      borderRadius: 2,
                      background: i <= strength ? "var(--color-success)" : "var(--color-bg-5)",
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="field">
              <label className="field-label">{t("确认新密码")}</label>
              <input
                className="ui-input"
                type={showPwd ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t("再次输入新密码")}
                autoComplete="new-password"
              />
            </div>
            <div className="field">
              <label className="field-label">{t("密码提示（可选）")}</label>
              <input
                className="ui-input"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder={t("例如：常用的一串数字")}
              />
            </div>
          </div>

          {message ? (
            <div
              className="notice"
              style={{
                marginTop: 12,
                background:
                  message.type === "ok" ? "var(--status-yuanliSuccess-2)" : "var(--status-yuanliDanger-2)",
                color:
                  message.type === "ok"
                    ? "var(--status-yuanliSuccess-7)"
                    : "var(--status-yuanliDanger-6)",
              }}
            >
              {message.text}
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <Button variant="primary" block disabled={busy} onClick={handleChangePassword}>
              {lockEnabled ? t("修改密码") : t("启用锁定")}
            </Button>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 12 }}>
          <div className="s-row">
            <div className="s-main">
              <div className="s-title">{biometricLabel(t)}</div>
              <div className="s-desc">{bioHint}</div>
            </div>
            <Switch
              checked={biometric}
              disabled={!lockEnabled || !bioAvailable || bioBusy}
              onChange={handleBiometricChange}
              label={biometricLabel(t)}
            />
          </div>
          <div className="s-row">
            <div className="s-main">
              <div className="s-title">{t("失败 5 次后清除剪贴板")}</div>
              <div className="s-desc">{t("防止暴力尝试，自动清空最近复制内容")}</div>
            </div>
            <Switch
              checked={draft.clearClipboardOnFail}
              disabled={!lockEnabled}
              onChange={async (v) => {
                const nextDraft = { ...draft, clearClipboardOnFail: v };
                setDraft(nextDraft);
                await saveSettings(nextDraft);
              }}
              label={t("失败清除剪贴板")}
            />
          </div>
        </div>

        <div
          className="notice"
          style={{ marginTop: 12, background: "var(--status-yuanliWarning-2)", color: "var(--status-yuanliWarning-6)" }}
        >
          <AlertTriangle style={{ color: "var(--status-yuanliWarning-6)" }} />
          {t("忘记密码将无法恢复，只能通过事先导出的加密备份在新设备恢复账户。")}
        </div>
      </section>

      <TabBar active="settings" onSelect={onTabSelect} />
    </>
  );
}

function passwordStrength(pwd: string): number {
  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score += 1;
  if (/\d/.test(pwd)) score += 1;
  if (/[^A-Za-z0-9]/.test(pwd)) score += 1;
  return score;
}
