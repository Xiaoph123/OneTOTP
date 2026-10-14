import { useState } from "react";
import { useApp } from "../state/AppContext";
import { IconButton } from "../components/Button";
import { Backspace, Eye, EyeOff, Fingerprint, Lock, OneTotpMark } from "../components/icons";
import { useI18n } from "../i18n";

export function LockPage() {
  const { unlockWithPassword, passwordHint, hasLock, boot } = useApp();
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!hasLock) {
    // 无锁定密码时的兜底：直接尝试进入
    return (
      <div className="lock-page">
        <div className="lock-card" style={{ textAlign: "center" }}>
          <OneTotpMark style={{ width: 56, height: 56 }} />
          <div style={{ fontSize: "var(--font-size-h3)", fontWeight: 500, marginTop: 12 }}>
            {t("正在打开 OneTotp")}
          </div>
          <button
            onClick={boot}
            style={{
              marginTop: 16,
              height: 36,
              padding: "0 20px",
              border: "none",
              borderRadius: "var(--radius-md)",
              background: "var(--color-primary)",
              color: "var(--color-white)",
              cursor: "pointer",
            }}
          >
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
      setError(t("密码错误，请重试"));
      setPassword("");
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
        <div className="lock-avatar">王</div>
        <div style={{ fontSize: "var(--font-size-h3)", fontWeight: 500 }}>{t("应用已锁定")}</div>
        <div style={{ fontSize: "var(--font-size-lead)", color: "var(--color-text-3)", marginTop: 4 }}>
          {t("请输入密码以解锁 OneTotp")}
        </div>

        <form
          style={{ marginTop: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div style={{ position: "relative" }}>
            <input
              className="ui-input"
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("输入锁定密码")}
              autoFocus
              autoComplete="current-password"
              style={{
                height: 44,
                fontSize: "var(--font-size-h3)",
                textAlign: "center",
                paddingRight: 44,
              }}
            />
            <IconButton
              label={show ? t("隐藏密码") : t("显示密码")}
              style={{ position: "absolute", right: 6, top: 6 }}
              onClick={() => setShow((s) => !s)}
            >
              {show ? <EyeOff /> : <Eye />}
            </IconButton>
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: 10, margin: "16px 0" }}>
            {Array.from({ length: dots }).map((_, i) => (
              <span
                key={i}
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: "50%",
                  border: "1.5px solid var(--color-border-4)",
                  background: i < password.length ? "var(--color-primary)" : "transparent",
                  borderColor: i < password.length ? "var(--color-primary)" : "var(--color-border-4)",
                }}
              />
            ))}
          </div>

          {error ? (
            <div
              className="notice"
              style={{
                marginBottom: 12,
                background: "var(--status-yuanliDanger-2)",
                color: "var(--status-yuanliDanger-6)",
                justifyContent: "center",
              }}
            >
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            style={{
              width: "100%",
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              border: "none",
              borderRadius: "var(--radius-md)",
              background: "var(--color-primary)",
              color: "var(--color-white)",
              fontSize: "var(--font-size-h4)",
              fontWeight: 500,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            <Lock style={{ width: 16, height: 16 }} />
            {t("解锁")}
          </button>
        </form>

        <div className="keypad" style={{ marginTop: 18 }}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} className="key-btn" type="button" onClick={() => press(d)}>
              {d}
            </button>
          ))}
          <button className="key-btn ghost" type="button" aria-label={t("生物识别")} disabled title={t("需系统支持")}>
            <Fingerprint style={{ width: 22, height: 22 }} />
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
            <Backspace style={{ width: 22, height: 22 }} />
          </button>
        </div>

        {passwordHint ? (
          <div style={{ marginTop: 16, fontSize: "var(--font-size-body)", color: "var(--color-text-3)" }}>
            {t("密码提示：{hint}", { hint: passwordHint })}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 16,
            padding: "10px 12px",
            borderRadius: "var(--radius-md)",
            background: "var(--color-bg-4)",
            display: "flex",
            gap: 8,
            textAlign: "left",
          }}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="var(--color-text-3)" strokeWidth={1.5} style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2 }}>
            <circle cx="8" cy="8" r="6" />
            <path d="M8 7.4v3.4M8 5.3v.1" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: "var(--font-size-body)", color: "var(--color-text-3)", lineHeight: "18px" }}>
            {t("密码仅用于本机解锁，忘记后无法找回，只能通过加密备份在新设备恢复。")}
          </span>
        </div>
      </div>
    </div>
  );
}
