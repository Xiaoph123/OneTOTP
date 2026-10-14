import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import { api } from "../lib/api";
import { TabBar, type TabKey } from "../components/TabBar";
import { Switch } from "../components/Controls";
import { Select } from "../components/Select";
import { Button, IconButton } from "../components/Button";
import { AlertTriangle, ChevronLeft, Eye, EyeOff } from "../components/icons";

export function SecurityPage() {
  const { settings, saveSettings, navigate } = useApp();
  const [draft, setDraft] = useState(settings);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [hint, setHint] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) setHint(settings.passwordHint || "");
  }, [settings]);

  if (!draft) {
    return (
      <>
        <header className="app-bar">
          <IconButton label="返回" onClick={() => navigate({ name: "settings" })}>
            <ChevronLeft />
          </IconButton>
          <span style={{ fontSize: "var(--font-size-h4)", fontWeight: 500 }}>安全与锁定</span>
        </header>
        <section className="app-body">
          <div className="empty-state">
            <span className="empty-desc">正在加载…</span>
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
        setMessage({ type: "err", text: "请输入当前密码以关闭锁定" });
        return;
      }
      setBusy(true);
      try {
        await api.unlock(current);
        await api.setLockPassword("", "", false);
        const s = await api.getSettings();
        await saveSettings(s);
        setDraft(s);
        setCurrent("");
        setMessage({ type: "ok", text: "已关闭应用锁定" });
      } catch (e) {
        setMessage({ type: "err", text: String(e) });
      } finally {
        setBusy(false);
      }
      return;
    }
    setDraft({ ...draft, lockEnabled: true });
  };

  const handleChangePassword = async () => {
    setMessage(null);
    if (next !== confirm) {
      setMessage({ type: "err", text: "两次输入的新密码不一致" });
      return;
    }
    if (next.length < 8) {
      setMessage({ type: "err", text: "新密码长度至少 8 位" });
      return;
    }
    setBusy(true);
    try {
      if (lockEnabled) {
        // 校验当前密码
        await api.unlock(current);
      }
      await api.setLockPassword(next, hint, true);
      const s = await api.getSettings();
      await saveSettings(s);
      setDraft(s);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage({ type: "ok", text: "密码已更新" });
    } catch (e) {
      setMessage({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const onTabSelect = (key: TabKey) => {
    if (key === "codes") navigate({ name: "codes" });
  };

  const strength = passwordStrength(next);

  return (
    <>
      <header className="app-bar">
        <IconButton label="返回" onClick={() => navigate({ name: "settings" })}>
          <ChevronLeft />
        </IconButton>
        <span style={{ fontSize: "var(--font-size-h4)", fontWeight: 500 }}>安全与锁定</span>
      </header>

      <section className="app-body">
        <div className="panel">
          <div className="s-row">
            <div className="s-main">
              <div className="s-title">启用应用锁定</div>
              <div className="s-desc">打开应用时需输入密码才能查看验证码</div>
            </div>
            <Switch checked={lockEnabled} onChange={handleEnableChange} label="启用应用锁定" disabled={busy} />
          </div>
          <div className="s-row">
            <div className="s-main">
              <div className="s-title">离开后台时自动锁定</div>
              <div className="s-desc">失去焦点或最小化后自动锁定</div>
            </div>
            <Switch
              checked={draft.lockOnBlur}
              disabled={!lockEnabled}
              onChange={async (v) => {
                const nextDraft = { ...draft, lockOnBlur: v };
                setDraft(nextDraft);
                await saveSettings(nextDraft);
              }}
              label="离开后台自动锁定"
            />
          </div>
          <div className="s-row">
            <div className="s-main">
              <div className="s-title">自动锁定时长</div>
              <div className="s-desc">无操作超过该时长后锁定</div>
            </div>
            <Select
              width={110}
              value={draft.autoLockSeconds}
              disabled={!lockEnabled}
              onChange={async (v) => {
                const nextDraft = { ...draft, autoLockSeconds: v };
                setDraft(nextDraft);
                await saveSettings(nextDraft);
              }}
              options={[
                { value: 0, label: "立即" },
                { value: 60, label: "1 分钟" },
                { value: 300, label: "5 分钟" },
                { value: 900, label: "15 分钟" },
                { value: 999999, label: "从不" },
              ]}
            />
          </div>
        </div>

        <div className="panel" style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: "var(--font-size-h4)", fontWeight: 500 }}>锁定密码</div>
          <div style={{ fontSize: "var(--font-size-body)", color: "var(--color-text-3)", margin: "4px 0 12px" }}>
            密码经加盐哈希（Argon2id）存储在本地，不会上传或同步
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {lockEnabled ? (
              <div className="field">
                <label className="field-label">当前密码</label>
                <div style={{ position: "relative" }}>
                  <input
                    className="ui-input"
                    type={showPwd ? "text" : "password"}
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    placeholder="输入当前锁定密码"
                    style={{ paddingRight: 40 }}
                    autoComplete="current-password"
                  />
                  <IconButton
                    label={showPwd ? "隐藏密码" : "显示密码"}
                    style={{ position: "absolute", right: 4, top: 0 }}
                    onClick={() => setShowPwd((s) => !s)}
                  >
                    {showPwd ? <EyeOff /> : <Eye />}
                  </IconButton>
                </div>
              </div>
            ) : null}
            <div className="field">
              <label className="field-label">{lockEnabled ? "新密码" : "设置密码"}</label>
              <input
                className="ui-input"
                type={showPwd ? "text" : "password"}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder="至少 8 位"
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
              <label className="field-label">确认新密码</label>
              <input
                className="ui-input"
                type={showPwd ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="再次输入新密码"
                autoComplete="new-password"
              />
            </div>
            <div className="field">
              <label className="field-label">密码提示（可选）</label>
              <input
                className="ui-input"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="例如：常用的一串数字"
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
              {lockEnabled ? "修改密码" : "启用锁定"}
            </Button>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 12 }}>
          <div className="s-row">
            <div className="s-main">
              <div className="s-title">生物识别解锁</div>
              <div className="s-desc">使用系统指纹或面容快速解锁</div>
            </div>
            <Switch checked={false} onChange={() => {}} label="生物识别解锁" disabled />
          </div>
          <div className="s-row">
            <div className="s-main">
              <div className="s-title">失败 5 次后清除剪贴板</div>
              <div className="s-desc">防止暴力尝试，自动清空最近复制内容</div>
            </div>
            <Switch checked onChange={() => {}} label="失败清除剪贴板" />
          </div>
        </div>

        <div
          className="notice"
          style={{ marginTop: 12, background: "var(--status-yuanliWarning-2)", color: "var(--status-yuanliWarning-6)" }}
        >
          <AlertTriangle style={{ color: "var(--status-yuanliWarning-6)" }} />
          忘记密码将无法恢复，只能通过事先导出的加密备份在新设备恢复账户。
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
