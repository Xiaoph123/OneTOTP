import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { api } from "../lib/api";
import { TabBar, type TabKey } from "../components/TabBar";
import { Switch } from "../components/Controls";
import { Select } from "../components/Select";
import { useToast } from "../components/Toast";
import { Button, IconButton } from "../components/Button";
import { AlertTriangle, ChevronLeft, Eye, EyeOff, Spinner } from "../components/icons";
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

  // 启用/关闭锁定的弹窗（点开关直接弹窗，符合常规交互预期）
  const [pwdDialog, setPwdDialog] = useState<null | "enable" | "disable">(null);
  const [dlgPwd, setDlgPwd] = useState("");
  const [dlgConfirm, setDlgConfirm] = useState("");
  const [dlgHint, setDlgHint] = useState("");
  const [dlgError, setDlgError] = useState<string | null>(null);
  const [dlgBusy, setDlgBusy] = useState(false);

  // 启用生物识别的弹窗（点开关直接弹窗输入密码完成绑定）
  const [bioDialog, setBioDialog] = useState(false);
  const [bioPwd, setBioPwd] = useState("");
  const [bioError, setBioError] = useState<string | null>(null);

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

  /** 切换生物识别：关闭时直接清除；开启时弹窗收集密码后完成绑定 */
  const handleBiometricChange = async (enabled: boolean) => {
    if (bioBusy) return;
    if (!enabled) {
      await clearBiometric();
      setBiometric(false);
      setBioEnrolled(false);
      toast.info(t("已关闭生物识别解锁"));
      return;
    }
    // 开启：弹窗输入当前锁定密码（用于加密保存），一步到位
    setBioPwd("");
    // 生物识别凭据需绑定在锁定口令上，未启用锁定时先引导开启
    setBioError(lockEnabled ? null : t("请先启用应用锁定，再开启生物识别"));
    setBioDialog(true);
  };

  /** 弹窗确认：校验密码并登记生物识别凭据 */
  const confirmEnableBiometric = async () => {
    setBioError(null);
    if (!bioPwd) {
      setBioError(t("请输入当前密码"));
      return;
    }
    setBioBusy(true);
    try {
      // 先验证密码是否正确，避免把错误口令加密保存。
      // 注意：Android 端插件的 setData 是静默的（生成密钥 + 加密写入），
      // 不会弹系统认证框；只有后续 getData 解锁时才会弹。故此处需要
      // 明确的「正在处理」反馈，否则用户会以为卡死了。
      await api.unlock(bioPwd);
      const result = await enrollBiometric(bioPwd);
      if (result.ok) {
        setBiometric(true);
        setBioEnrolled(true);
        setBioDialog(false);
        setBioPwd("");
        toast.success(t("已启用生物识别解锁"));
      } else if (result.reason === "cancelled") {
        // 用户在系统弹窗中取消，不视为失败
      } else if (result.reason === "not_enrolled") {
        setBioError(t("当前设备未录入指纹或面容，请先在系统设置中录入"));
      } else {
        setBioError(t("生物识别启用失败，请重试"));
      }
    } catch (e) {
      // 密码错误等：在弹窗内提示
      setBioError(String(e));
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

  /** 点击「启用应用锁定」开关：直接弹出对应弹窗，由弹窗完成设置/校验 */
  const handleEnableChange = (enabled: boolean) => {
    setMessage(null);
    setDlgPwd("");
    setDlgConfirm("");
    setDlgHint(draft.passwordHint || "");
    setDlgError(null);
    setPwdDialog(enabled ? "enable" : "disable");
  };

  /** 弹窗确认：开启锁定（需设置新密码） */
  const confirmEnable = async () => {
    setDlgError(null);
    if (dlgPwd.length < 8) {
      setDlgError(t("新密码长度至少 8 位"));
      return;
    }
    if (dlgPwd !== dlgConfirm) {
      setDlgError(t("两次输入的新密码不一致"));
      return;
    }
    setDlgBusy(true);
    try {
      await api.setLockPassword(dlgPwd, dlgHint, true);
      const s = await api.getSettings();
      await saveSettings(s);
      setDraft(s);
      setHint(dlgHint);
      setPwdDialog(null);
      setMessage({ type: "ok", text: t("已启用应用锁定") });
      toast.success(t("已启用应用锁定"));
    } catch (e) {
      setDlgError(String(e));
    } finally {
      setDlgBusy(false);
    }
  };

  /** 弹窗确认：关闭锁定（需校验当前密码） */
  const confirmDisable = async () => {
    setDlgError(null);
    if (!dlgPwd) {
      setDlgError(t("请输入当前密码"));
      return;
    }
    setDlgBusy(true);
    try {
      await api.unlock(dlgPwd);
      await api.setLockPassword("", "", false);
      // 关闭锁定后，生物识别凭据已无意义，一并清除避免残留
      await clearBiometric();
      setBiometric(false);
      setBioEnrolled(false);
      const s = await api.getSettings();
      await saveSettings(s);
      setDraft(s);
      setCurrent("");
      setPwdDialog(null);
      setMessage({ type: "ok", text: t("已关闭应用锁定") });
      toast.success(t("已关闭应用锁定"));
    } catch (e) {
      setDlgError(String(e));
    } finally {
      setDlgBusy(false);
    }
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
      // 修改密码需校验当前密码
      await api.unlock(current);
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
      toast.success(t("锁定密码已更新"));
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
      : !lockEnabled
        ? t("请先启用应用锁定")
        : t("点击开启后可绑定本机指纹或面容");

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
          {/* 生物识别解锁：与「应用锁定」同属解锁方式，归入同一分组，
              便于用户在同一处理解并配置「如何解锁」 */}
          <div className="s-row">
            <div className="s-main">
              <div className="s-title">{biometricLabel(t)}</div>
              <div className="s-desc">{bioHint}</div>
            </div>
            <Switch
              checked={biometric}
              // 仅在平台不支持/设备无生物硬件或处理中时禁用；
              // 未启用应用锁定时仍可点击，点击后由弹窗内提示先开启锁定
              disabled={!bioAvailable || bioBusy}
              onChange={handleBiometricChange}
              label={biometricLabel(t)}
            />
          </div>
        </div>

        {/* 密码管理面板：仅在已启用锁定时显示（用于修改密码）。
            启用锁定本身通过上方开关的弹窗完成，避免两处入口重复。 */}
        {lockEnabled ? (
        <div className="panel" ref={pwdPanelRef} style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: "var(--font-size-h4)", fontWeight: 500 }}>
            {t("锁定密码")}
          </div>
          <div style={{ fontSize: "var(--font-size-body)", color: "var(--color-text-3)", margin: "4px 0 12px" }}>
            {t("密码经加盐哈希（Argon2id）存储在本地，不会上传或同步")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
            <div className="field">
              <label className="field-label">{t("新密码")}</label>
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
              {t("修改密码")}
            </Button>
          </div>
        </div>
        ) : null}

        <div className="panel" style={{ marginTop: 12 }}>
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

      {/* 应用锁定开关的弹窗：点开关即弹窗，符合常规交互预期 */}
      {pwdDialog ? (
        <div className="modal-overlay" onClick={() => setPwdDialog(null)} role="presentation">
          <div
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-title">
              {pwdDialog === "enable" ? t("启用应用锁定") : t("关闭应用锁定")}
            </div>
            <div className="modal-desc" style={{ marginTop: 6 }}>
              {pwdDialog === "enable"
                ? t("设置一个锁定密码，打开应用时需输入才能查看验证码")
                : t("请输入当前密码以确认关闭锁定")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
              <input
                className="ui-input"
                type="password"
                autoFocus
                value={dlgPwd}
                onChange={(e) => setDlgPwd(e.target.value)}
                placeholder={pwdDialog === "enable" ? t("设置密码（至少 8 位）") : t("输入当前锁定密码")}
                autoComplete={pwdDialog === "enable" ? "new-password" : "current-password"}
              />
              {pwdDialog === "enable" ? (
                <>
                  <input
                    className="ui-input"
                    type="password"
                    value={dlgConfirm}
                    onChange={(e) => setDlgConfirm(e.target.value)}
                    placeholder={t("再次输入新密码")}
                    autoComplete="new-password"
                  />
                  <input
                    className="ui-input"
                    value={dlgHint}
                    onChange={(e) => setDlgHint(e.target.value)}
                    placeholder={t("密码提示（可选）")}
                  />
                </>
              ) : null}
            </div>
            {dlgError ? (
              <div
                className="notice"
                style={{
                  marginTop: 12,
                  background: "var(--status-yuanliDanger-2)",
                  color: "var(--status-yuanliDanger-6)",
                }}
              >
                {dlgError}
              </div>
            ) : null}
            {dlgBusy ? (
              <div className="notice notice-busy" style={{ marginTop: 12 }}>
                <Spinner className="ui-spinner" />
                {t("处理中，请稍候…")}
              </div>
            ) : null}
            <div className="modal-actions" style={{ marginTop: 18 }}>
              <Button block onClick={() => setPwdDialog(null)} disabled={dlgBusy}>
                {t("取消")}
              </Button>
              <Button
                variant={pwdDialog === "enable" ? "primary" : "danger"}
                block
                disabled={dlgBusy}
                onClick={pwdDialog === "enable" ? confirmEnable : confirmDisable}
              >
                {dlgBusy ? <Spinner className="ui-spinner" /> : null}
                {dlgBusy ? t("处理中…") : pwdDialog === "enable" ? t("启用") : t("关闭锁定")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 生物识别绑定弹窗：点开关即弹窗输入密码，一步完成 */}
      {bioDialog ? (
        <div className="modal-overlay" onClick={() => !bioBusy && setBioDialog(false)} role="presentation">
          <div
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-title">{t("启用生物识别解锁")}</div>
            <div className="modal-desc" style={{ marginTop: 6 }}>
              {t("输入当前锁定密码，验证通过后将绑定本机指纹或面容用于快速解锁")}
            </div>
            <div style={{ marginTop: 16 }}>
              <input
                className="ui-input"
                type="password"
                autoFocus
                value={bioPwd}
                onChange={(e) => setBioPwd(e.target.value)}
                placeholder={t("输入当前锁定密码")}
                autoComplete="current-password"
              />
            </div>
            {bioError ? (
              <div
                className="notice"
                style={{
                  marginTop: 12,
                  background: "var(--status-yuanliDanger-2)",
                  color: "var(--status-yuanliDanger-6)",
                }}
              >
                {bioError}
              </div>
            ) : null}
            {bioBusy ? (
              <div className="notice notice-busy" style={{ marginTop: 12 }}>
                <Spinner className="ui-spinner" />
                {t("正在绑定生物识别凭据，请稍候…")}
              </div>
            ) : null}
            <div className="modal-actions" style={{ marginTop: 18 }}>
              <Button block onClick={() => setBioDialog(false)} disabled={bioBusy}>
                {t("取消")}
              </Button>
              <Button variant="primary" block disabled={bioBusy} onClick={confirmEnableBiometric}>
                {bioBusy ? <Spinner className="ui-spinner" /> : null}
                {bioBusy ? t("处理中…") : t("启用")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

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
