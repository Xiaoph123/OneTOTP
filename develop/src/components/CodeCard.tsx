import { useEffect, useState } from "react";
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
import { useToast } from "./Toast";
import { avatarOf, copyTextAutoClear, formatCode } from "../lib/utils";
import { hideWindow } from "../state/useAutoLock";
import { useApp } from "../state/AppContext";
import { isMobile } from "../lib/platform";
import { useI18n } from "../i18n";

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
  const { t } = useI18n();
  const toast = useToast();
  const { refreshAccounts, settings } = useApp();
  const mobile = isMobile();
  // 桌面 hover 模式下由悬停控制显示；移动端无 hover，改为点击揭示
  const [hovering, setHovering] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const av = avatarOf(account.issuer);

  const visible =
    codeVisibility === "never" || (codeVisibility === "hover" && (mobile ? revealed : hovering));

  // 移动端切换「不隐藏/隐藏/悬停」时应复位揭示状态
  useEffect(() => {
    setRevealed(false);
  }, [codeVisibility]);

  // HOTP 无时间维度，不显示倒计时，也不需要临期高亮
  const isHotp = (code?.otpType ?? account.otpType) === "hotp";
  const remaining = isHotp ? 0 : code?.remaining ?? account.period;
  const danger = !isHotp && expiryHighlight && remaining <= 5;
  const display = code ? formatCode(code.code, grouping) : "— — —";
  const masked = display.replace(/\d/g, "•");
  // 下一个验证码：与当前一致做分组展示，仅 TOTP 有值
  const nextDisplay = code?.nextCode ? formatCode(code.nextCode, grouping) : "";

  // 细节程度：精简仅显示验证码；标准显示头部信息；复杂额外显示算法/位数/分类标签与下一个验证码
  const showHead = detail !== "minimal";
  const showTags = detail === "detailed";

  const handleCopy = async () => {
    if (!code) return;
    try {
      // 复制后按设置自动清除剪贴板（默认 30 秒，0 表示不自动清除）
      await copyTextAutoClear(code.code, settings?.clipboardClearSeconds ?? 30);
    } catch {
      // 写入剪贴板失败时不能再提示成功，否则用户会误以为已复制
      toast.error(t("复制失败，请重试"));
      return;
    }
    // 记录使用时间：TOTP 用于「最近」筛选与详情页的最近使用时间；
    // HOTP 额外由后端把计数器前进一位（否则会一直生成同一个验证码）。
    try {
      await api.markUsed(account.id);
    } catch {
      // 忽略记录失败，不影响复制
    }
    // 同步内存中的 lastUsedAt，否则「最近」筛选要等下次启动才反映本次使用
    refreshAccounts().catch(() => {});
    toast.success(t("已复制到剪贴板"));
    if (autoHideAfterCopy) hideWindow();
  };

  const handleCardClick = () => {
    // always 模式不允许通过点击揭示验证码
    if (codeVisibility === "always") return;
    // 移动端悬停模式：首次点击揭示，揭示后再点击才复制
    if (mobile && codeVisibility === "hover" && !revealed) {
      setRevealed(true);
      return;
    }
    if (clickToCopy) handleCopy();
  };

  return (
    <article
      className={`otp-card is-${density}${danger ? " is-expiring" : ""}`}
      onClick={handleCardClick}
      onMouseEnter={() => !mobile && setHovering(true)}
      onMouseLeave={() => !mobile && setHovering(false)}
      title={clickToCopy && codeVisibility !== "always" ? t("点击复制验证码") : undefined}
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
            <span className={`avatar-sq avatar-tone-${av.tone}`}>
              {av.text}
            </span>
            <div className="otp-head-main">
              <div className="otp-issuer">{account.issuer}</div>
              <div className="otp-account">{account.account || t("未设置账户标识")}</div>
            </div>
            <button
              className="icon-btn"
              aria-label={t("账户详情")}
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
        <div className="otp-code">{visible ? display : masked}</div>
        {isHotp ? (
          <span className="tag-soft font-mono">
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
            <span className="tag-soft">{t("{n} 位", { n: account.digits })}</span>
          </div>
          {/* 复杂模式：右侧展示下一个验证码（替代原分类标签） */}
          {!isHotp && nextDisplay ? (
            <span className="otp-next">
              <span className="otp-next-label">{t("下一个")}</span>
              <span className="otp-next-code">{nextDisplay}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
