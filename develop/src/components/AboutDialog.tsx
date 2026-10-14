import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Button } from "./Button";
import { OneTotpMark } from "./icons";
import { isMobile } from "../lib/platform";
import { useI18n } from "../i18n";

interface Props {
  open: boolean;
  accountCount: number;
  version?: string;
  onClose: () => void;
}

/** 运行平台展示名，用于「关于」弹窗 */
function platformName(): string {
  if (typeof navigator === "undefined") return "—";
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPod/i.test(ua)) return "iOS";
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "iPadOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "—";
}

export function AboutDialog({ open, accountCount, version, onClose }: Props) {
  const { t } = useI18n();
  // 版本号：优先使用外部传入，否则回退 Tauri getVersion()
  const [appVersion, setAppVersion] = useState(version ?? "");

  useEffect(() => {
    if (version) {
      setAppVersion(version);
      return;
    }
    getVersion().then(setAppVersion).catch(() => setAppVersion(""));
  }, [version]);

  if (!open) return null;

  const rows: { label: string; value: string }[] = [
    { label: t("版本"), value: appVersion ? `v${appVersion}` : "—" },
    { label: t("运行平台"), value: `${platformName()} · ${isMobile() ? t("移动端") : t("桌面端")}` },
    { label: t("账户数量"), value: t("{n} 个", { n: accountCount }) },
    { label: t("加密方式"), value: "AES-256-GCM" },
    { label: t("密钥派生"), value: "Argon2id" },
    { label: t("算法标准"), value: "RFC 6238 / RFC 4226" },
  ];

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal-dialog about-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("关于 OneTotp")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="about-hero">
          <span className="about-logo">
            <OneTotpMark style={{ width: 34, height: 34 }} />
          </span>
          <div className="about-name">OneTotp</div>
          <div className="about-ver">{appVersion ? `v${appVersion}` : ""}</div>
          <div className="about-tagline">{t("离线双因素验证器")}</div>
        </div>

        <div className="about-rows">
          {rows.map((r) => (
            <div className="about-row" key={r.label}>
              <span className="about-row-label">{r.label}</span>
              <span className="about-row-value">{r.value}</span>
            </div>
          ))}
        </div>

        <div className="about-note">
          {t("验证码在本地离线生成，账号与密钥均加密存储在本机，不会上传到任何服务器。")}
        </div>

        <Button variant="primary" block onClick={onClose}>
          {t("知道了")}
        </Button>
      </div>
    </div>
  );
}
