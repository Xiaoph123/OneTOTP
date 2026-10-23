import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { api } from "../lib/api";
import { TabBar } from "../components/TabBar";
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
import { NEVER_SENTINEL, resolveIdlePolicy } from "../lib/lockDecision";
import { useI18n } from "../i18n";

/** 各平台生物识别的展示名（Linux 等不支持平台回退为通用文案） */
function biometricLabel(t: (k: string) => string): string {
  if (typeof navigator === "undefined") return t("指纹 / 人脸解锁");
  const ua = navigator.userAgent;
  if (isDesktop() && /Windows/i.test(ua)) return t("Windows Hello 解锁");
  if (isDesktop() && /Macintosh|Mac OS X/i.test(ua)) return t("Touch ID 解锁");
  return t("指纹 / 人脸解锁");
}

export function SecurityPage() {
  const { t } = useI18n();
  const { settings, saveSettings, goBack, refreshLockState } = useApp();
  const toast = useToast();
  const [draft, setDraft] = useState(settings);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [hint, setHint] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // 保险库是否仍使用较弱的旧 KDF 参数（提示用户点「重新加密保险库」升级）
  const [kdfLegacy, setKdfLegacy] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .getStatus()
      .then((s) => {
        if (alive) setKdfLegacy(s.kdfLegacy);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [biometric, setBiometric] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  // 生物识别能力：支持平台 + 是否已录入指纹/面容
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnrolled, setBioEnrolled] = useState(false);
  const pwdPanelRef = useRef<HTMLDivElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  // 启用/关闭锁定的弹窗（点开关直接弹窗，符合常规交互预期）
  const [pwdDialog, setPwdDialog] = useState<null | "enable" | "disable" | "rotate">(null);
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
  /** 移除本机保存的生物识别凭据（不影响锁定密码） */
const handleRemoveBiometric = async () => {
  if (bioBusy) return;
  setBioBusy(true);
  try {
    await clearBiometric();
    setBiometric(false);
    setBioEnrolled(false);
    toast.success(t("已移除本机保存的生物识别凭据"));
  } catch (e) {
    toast.error(t("移除失败：{msg}", { msg: String(e) }));
  } finally {
    setBioBusy(false);
  }
};

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
          <span className="app-bar-title">{t("安全与锁定")}</span>
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
      // 关键：同步 hasLock。hasLock 是自动锁定的总闸门（见 useAutoLock），
      // 运行时新开启的锁定若不刷新，本次会话内不会触发自动/失焦锁定。
      await refreshLockState();
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
      // 同步 hasLock：关闭锁定后必须刷新，否则自动锁定仍会按旧的 hasLock=true
      // 触发 lockApp，而此时后端锁记录已删除，会导致「要求输密码却无法解锁」的死路。
      await refreshLockState();
      setPwdDialog(null);
      setMessage({ type: "ok", text: t("已关闭应用锁定") });
      toast.success(t("已关闭应用锁定"));
    } catch (e) {
      setDlgError(String(e));
    } finally {
      setDlgBusy(false);
    }
  };

  /** 弹窗确认：重新加密保险库（同一口令 + 全新 salt，旧密钥立即作废） */
  const confirmRotate = async () => {
    setDlgError(null);
    if (!dlgPwd) {
      setDlgError(t("请输入当前密码"));
      return;
    }
    setDlgBusy(true);
    try {
      const rotated = await api.rotateVaultKey(dlgPwd);
      // 口令未变，生物识别里保存的口令仍然有效，无需重新登记
      setPwdDialog(null);
      setDlgPwd("");
      setMessage({ type: "ok", text: t("保险库已用新密钥重新加密") });
      toast.success(t("保险库已用新密钥重新加密"));
      // 换过密钥后，旧快照已无法解密（既解不开也无法清理其中的账户）
      if (rotated.staleBackups > 0) {
        toast.warning(
          t("{n} 份旧加密快照已失效（使用旧密钥），建议在设置中清理", {
            n: rotated.staleBackups,
          }),
        );
      }
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

  const strength = passwordStrength(next);
  const pwdHints = passwordHints(next);

  /**
   * 「自动锁定时长」当前**实际**会怎么锁。
   *
   * 之前这里是一句静态说明（「无操作超过该时长后锁定」），选「立即」时
   * 实际不做空闲计时，与文案不符，用户会判定为「设置不生效」。
   * 现在把生效策略直接算出来展示，所见即所得。
   */
  const idlePolicy = resolveIdlePolicy(draft.autoLockSeconds, lockEnabled);
  const idlePolicyDesc = !lockEnabled
    ? t("启用应用锁定后生效")
    : idlePolicy.kind === "idle"
      ? t("空闲 {n} 秒后自动锁定", { n: idlePolicy.seconds })
      : draft.autoLockSeconds >= NEVER_SENTINEL
        ? t("不会因空闲自动锁定")
        : t("仅在离开应用时锁定（不做空闲计时）");

  // 生物识别状态提示文案
  const bioHint = !bioAvailable
    ? t("当前平台不支持生物识别解锁")
    : bioEnrolled
      ? t("调用系统指纹或面容快速解锁（便捷优先，不额外增加抗本机攻击能力）")
      : !lockEnabled
        ? t("请先启用应用锁定")
        : t("点击开启后可绑定本机指纹或面容");

  return (
    <>
      <header className="app-bar">
        <IconButton label={t("返回")} onClick={() => goBack()}>
          <ChevronLeft />
        </IconButton>
        <span className="app-bar-title">{t("安全与锁定")}</span>
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
              <div className="s-desc">{idlePolicyDesc}</div>
            </div>
            <Select
              variant="ghost"
              value={draft.autoLockSeconds}
              disabled={!lockEnabled}
              onChange={async (v) => {
                const nextDraft = { ...draft, autoLockSeconds: v };
                setDraft(nextDraft);
                await saveSettings(nextDraft);
              }}
              options={[
                // 0 = 不做空闲计时，只靠「失焦 / 切到后台」锁定。
                // 文案必须直白：叫「立即」会被理解成「马上锁 / 每秒锁」，
                // 而真正的每秒锁定是死循环（见 lib/lockDecision.ts 注释）。
                { value: 0, label: t("离开时锁定") },
                { value: 30, label: t("30 秒") },
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
          {bioEnrolled ? (
            <div className="s-row">
              <div className="s-main">
                <div className="s-title">{t("移除已保存的生物识别凭据")}</div>
                <div className="s-desc">
                  {t("删除本机保存的解锁凭据；下次使用需重新输入密码登记")}
                </div>
              </div>
              <Button variant="text" disabled={bioBusy} onClick={handleRemoveBiometric}>
                {t("移除")}
              </Button>
            </div>
          ) : null}
        </div>

        {/* 密码管理面板：仅在已启用锁定时显示（用于修改密码）。
            启用锁定本身通过上方开关的弹窗完成，避免两处入口重复。 */}
        {lockEnabled ? (
        <div className="panel panel-pad mt-12" ref={pwdPanelRef}>
          <div className="block-title">
            {t("锁定密码")}
          </div>
          <div className="block-desc pwd-panel-desc">
            {t("密码经加盐哈希（Argon2id）存储在本地，不会上传或同步")}
          </div>
          <div className="col-gap-14">
            <div className="field">
              <label className="field-label">{t("当前密码")}</label>
              <div className="lock-input-wrap">
                <input
                  className="ui-input pwd-input"
                  type={showPwd ? "text" : "password"}
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  placeholder={t("输入当前锁定密码")}
                  autoComplete="current-password"
                />
                <IconButton
                  label={showPwd ? t("隐藏密码") : t("显示密码")}
                  className="pwd-eye"
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
              <div className="pwd-strength">
                {[1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className={`pwd-strength-bar${i <= strength ? " is-on" : ""}`}
                  />
                ))}
              </div>
              {/* 即时建议：只提示「能改进什么」，不阻断提交。
                  是否可用由后端权威校验决定（含弱口令黑名单）。 */}
              {pwdHints.length > 0 ? (
                <div className="pwd-hints">
                  {pwdHints.map((h) => (
                    <span key={h} className="pwd-hint">
                      · {t(h)}
                    </span>
                  ))}
                </div>
              ) : null}
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
            <div className={`notice mt-12 ${message.type === "ok" ? "notice-ok" : "notice-err"}`}>
              {message.text}
            </div>
          ) : null}

          <div className="btn-row mt-14">
            <Button variant="primary" block disabled={busy} onClick={handleChangePassword}>
              {t("修改密码")}
            </Button>
          </div>
          <div className="btn-row mt-12">
            <Button
              block
              disabled={busy}
              onClick={() => {
                setDlgPwd("");
                setDlgError(null);
                setPwdDialog("rotate");
              }}
            >
              {t("重新加密保险库")}
            </Button>
          </div>
          <div className="block-desc pwd-panel-desc">
            {t("用同一密码、全新的密钥重新加密本地数据。旧版本的锁定凭证文件曾以明文保存密钥，若该文件被复制或备份过，请执行一次本操作。")}
          </div>
          {kdfLegacy ? (
            <div className="notice notice-warn mt-12">
              {t("当前保险库仍在使用旧版密钥派生参数（强度较低）。点上方「重新加密保险库」即可升级到更强的参数，密码无需更改。")}
            </div>
          ) : null}
        </div>
        ) : null}

        <div className="panel mt-12">
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
          {/* 复制后自动清除：验证码留在剪贴板里，任何后续程序都可能读到 */}
          <div className="s-row">
            <div className="s-main">
              <div className="s-title">{t("复制后自动清除剪贴板")}</div>
              <div className="s-desc">{t("验证码留在剪贴板里可能被其他程序读到")}</div>
            </div>
            <Select
              variant="ghost"
              value={draft.clipboardClearSeconds}
              onChange={async (v) => {
                const nextDraft = { ...draft, clipboardClearSeconds: v };
                setDraft(nextDraft);
                await saveSettings(nextDraft);
              }}
              options={[
                { value: 15, label: t("15 秒") },
                { value: 30, label: t("30 秒") },
                { value: 60, label: t("1 分钟") },
                { value: 0, label: t("不自动清除") },
              ]}
            />
          </div>
        </div>

        <div className="notice notice-warn mt-12">
          <AlertTriangle />
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
              {pwdDialog === "enable"
                ? t("启用应用锁定")
                : pwdDialog === "disable"
                  ? t("关闭应用锁定")
                  : t("重新加密保险库")}
            </div>
            <div className="modal-desc mt-6">
              {pwdDialog === "enable"
                ? t("设置一个锁定密码，打开应用时需输入才能查看验证码")
                : pwdDialog === "disable"
                  ? t("请输入当前密码以确认关闭锁定")
                  : t("请输入当前密码。将通过全新随机盐重新派生密钥并重写本地保险库，旧密钥随即失效。")}
            </div>
            <div className="col-gap-12 mt-16">
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
              <div className="notice notice-err mt-12">
                {dlgError}
              </div>
            ) : null}
            {dlgBusy ? (
              <div className="notice notice-busy mt-12">
                <Spinner className="ui-spinner" />
                {t("处理中，请稍候…")}
              </div>
            ) : null}
            <div className="modal-actions modal-actions-tight">
              <Button block onClick={() => setPwdDialog(null)} disabled={dlgBusy}>
                {t("取消")}
              </Button>
              <Button
                variant={pwdDialog === "disable" ? "danger" : "primary"}
                block
                disabled={dlgBusy}
                onClick={
                  pwdDialog === "enable"
                    ? confirmEnable
                    : pwdDialog === "disable"
                      ? confirmDisable
                      : confirmRotate
                }
              >
                {pwdDialog === "enable"
                  ? t("启用")
                  : pwdDialog === "disable"
                    ? t("关闭锁定")
                    : t("重新加密")}
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
            <div className="modal-desc mt-6">
              {t("输入当前锁定密码，验证通过后将绑定本机指纹或面容用于快速解锁")}
            </div>
            <div className="mt-16">
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
              <div className="notice notice-err mt-12">
                {bioError}
              </div>
            ) : null}
            {bioBusy ? (
              <div className="notice notice-busy mt-12">
                <Spinner className="ui-spinner" />
                {t("正在绑定生物识别凭据，请稍候…")}
              </div>
            ) : null}
            <div className="modal-actions modal-actions-tight">
              <Button block onClick={() => setBioDialog(false)} disabled={bioBusy}>
                {t("取消")}
              </Button>
              <Button variant="primary" block disabled={bioBusy} onClick={confirmEnableBiometric}>
                {t("启用")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <TabBar active="settings" />
    </>
  );
}

/**
 * 口令强度评分（0~4）：以**长度**为主，字符种类只作为次要加分。
 *
 * 不采用「必须含大写+数字+符号」的组合评分：那会暗示用户
 * `Password1!` 就很安全。真正决定性的是长度与可预测性
 * （黑名单/常见词由后端权威判定，这里只做即时提示）。
 */
function passwordStrength(pwd: string): number {
  if (!pwd) return 0;
  const len = pwd.length;
  let score = 0;
  if (len >= 8) score += 1;
  if (len >= 12) score += 1;
  if (len >= 16) score += 1;
  // 字符种类只作轻微加成（≥3 类才加），且不用于「必须满足」的校验
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pwd)).length;
  if (classes >= 3 && len >= 10) score += 1;
  return Math.min(score, 4);
}

/**
 * 口令改进提示（即时、非阻断）。
 * 只给出可执行的建议，不重复后端的黑名单判定——那由后端权威校验并在提交时报错。
 */
function passwordHints(pwd: string): string[] {
  if (!pwd) return [];
  const hints: string[] = [];
  if (pwd.length < 8) hints.push("至少 8 位");
  else if (pwd.length < 12) hints.push("再长一点更安全（12 位以上）");
  if (/^\d+$/.test(pwd)) hints.push("纯数字容易被猜中，建议加入字母");
  if (/^(.)\1+$/.test(pwd)) hints.push("不要用重复的同一个字符");
  if (/^(\d)\1*$/.test(pwd) || /^(0123456789|1234567890)/.test(pwd)) {
    hints.push("避免连续数字");
  }
  return hints;
}
