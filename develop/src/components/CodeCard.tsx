import { useState } from "react";
import {
  api,
  type AccountView,
  type CardDensity,
  type CardDetail,
  type CodeResult,
  type CodeVisibility,
} from "../lib/api";
import { CountdownRing } from "./Controls";
import { MoreHorizontal } from "./icons";
import { copyText, formatCode } from "../lib/utils";
import { hideWindow } from "../state/useAutoLock";

/** 由服务名生成稳定的头像色与首字母 */
function avatarOf(issuer: string): { text: string; bg: string; fg: string } {
  const text = issuer.slice(0, 2).toUpperCase() || "OT";
  const palette = [
    { bg: "var(--color-text-1)", fg: "var(--color-bg-1)" },
    { bg: "var(--primary-1)", fg: "var(--primary-6)" },
    { bg: "var(--warning-1)", fg: "var(--warning-6)" },
    { bg: "var(--success-1)", fg: "var(--success-6)" },
    { bg: "var(--danger-2)", fg: "var(--danger-6)" },
    { bg: "var(--color-bg-5)", fg: "var(--color-text-2)" },
  ];
  let hash = 0;
  for (let i = 0; i < issuer.length; i += 1) hash = (hash * 31 + issuer.charCodeAt(i)) >>> 0;
  const pick = palette[hash % palette.length];
  return { text, bg: pick.bg, fg: pick.fg };
}

interface Props {
  account: AccountView;
  code?: CodeResult;
  grouping: boolean;
  expiryHighlight: boolean;
  clickToCopy: boolean;
  codeVisibility: CodeVisibility;
  density: CardDensity;
  detail: CardDetail;
  autoHideAfterCopy: boolean;
  onOpen: () => void;
}

export function CodeCard({
  account,
  code,
  grouping,
  expiryHighlight,
  clickToCopy,
  codeVisibility,
  density,
  detail,
  autoHideAfterCopy,
  onOpen,
}: Props) {
  // hover 模式下由悬停控制显示；always 始终遮挡；never 始终可见
  const [hovering, setHovering] = useState(false);
  const [copied, setCopied] = useState(false);
  const av = avatarOf(account.issuer);

  const visible = codeVisibility === "never" || (codeVisibility === "hover" && hovering);

  // HOTP 无时间维度，不显示倒计时，也不需要临期高亮
  const isHotp = (code?.otpType ?? account.otpType) === "hotp";
  const remaining = isHotp ? 0 : code?.remaining ?? account.period;
  const danger = !isHotp && expiryHighlight && remaining <= 5;
  const display = code ? formatCode(code.code, grouping) : "— — —";
  const masked = display.replace(/\d/g, "•");

  // 细节程度：精简仅显示验证码；标准显示头部信息；复杂额外显示算法/位数/分类标签
  const showHead = detail !== "minimal";
  const showTags = detail === "detailed";
  const showLabel = detail !== "minimal";

  const handleCopy = async () => {
    if (!code) return;
    await copyText(code.code);
    // HOTP 复制即视为消费一次，计数器前进后才能生成下一个验证码
    if (isHotp) {
      try {
        await api.markUsed(account.id);
      } catch {
        // 忽略计数失败，不影响复制
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
    if (autoHideAfterCopy) hideWindow();
  };

  const handleCardClick = () => {
    // always 模式不允许通过点击揭示验证码
    if (codeVisibility === "always") return;
    if (clickToCopy) handleCopy();
  };

  return (
    <article
      className={`otp-card is-${density}${danger ? " is-expiring" : ""}`}
      onClick={handleCardClick}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      title={clickToCopy && codeVisibility !== "always" ? "点击复制验证码" : undefined}
      role={clickToCopy && codeVisibility !== "always" ? "button" : undefined}
      tabIndex={clickToCopy && codeVisibility !== "always" ? 0 : undefined}
      onKeyDown={(e) => {
        if (clickToCopy && codeVisibility !== "always" && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          handleCardClick();
        }
      }}
    >
      {showHead ? (
        <>
          <div className="otp-head">
            <span className="avatar-sq" style={{ background: av.bg, color: av.fg }}>
              {av.text}
            </span>
            <div className="otp-head-main">
              <div className="otp-issuer">{account.issuer}</div>
              <div className="otp-account">{account.account || "未设置账户标识"}</div>
            </div>
            <button
              className="icon-btn"
              aria-label="账户详情"
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
            >
              <MoreHorizontal />
            </button>
          </div>

          <div className="otp-divider" />
        </>
      ) : null}

      <div className="flex-row-between">
        <div style={{ minWidth: 0 }}>
          {showLabel ? (
            <div className="otp-codelabel">{copied ? "已复制到剪贴板" : "当前验证码"}</div>
          ) : null}
          <div className="otp-code">{visible ? display : masked}</div>
        </div>
        {isHotp ? (
          <span className="tag-soft" style={{ fontFamily: "var(--font-mono)" }}>
            #{account.counter}
          </span>
        ) : (
          <CountdownRing remaining={remaining} period={account.period} danger={danger} />
        )}
      </div>

      {showTags ? (
        <div className="otp-foot-row">
          <div className="otp-tags">
            {isHotp ? <span className="tag-soft">HOTP</span> : null}
            <span className="tag-soft">{account.algorithm}</span>
            <span className="tag-soft">{account.digits} 位</span>
          </div>
          {account.category ? <span className="tag-soft">{account.category}</span> : null}
        </div>
      ) : null}
    </article>
  );
}
