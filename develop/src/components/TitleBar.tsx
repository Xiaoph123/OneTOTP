import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../state/AppContext";
import { Grid, Moon, OneTotpMark, Settings, Sun } from "./icons";
import { resolveTheme } from "../lib/theme";
import { isDesktop } from "../lib/platform";
import { useI18n } from "../i18n";

/** 自绘窗口标题栏（关闭原生装饰后使用）。移动端无窗口装饰概念，不渲染。 */
export function TitleBar() {
  const win = getCurrentWindow();
  const { settings, saveSettings, phase, route, navigate } = useApp();
  const { t } = useI18n();

  if (!isDesktop()) return null;

  const minimize = () => {
    win.minimize().catch(() => {});
  };
  const close = () => {
    win.close().catch(() => {});
  };

  // 桌面端没有底部标签栏：导航入口收敛到标题栏。
  // 设置相关页面显示「验证码」入口，其余页面显示「设置」入口。
  // 除未解锁状态外**始终**显示该入口：此前详情/添加等子页面会隐藏它，
  // 导致标题栏按钮数量随页面变化、位置左右跳动，全局观感不一致。
  const SETTINGS_ROUTES = ["settings", "security", "categories", "importExport"];
  const inSettings = SETTINGS_ROUTES.includes(route.name);
  // 启动中 / 锁屏时保险库未解密，进入设置页也无法读写，故不提供入口
  const showNav = phase === "ready";
  const navToSettings = () => {
    if (phase === "ready") navigate({ name: "settings" });
  };
  const navToCodes = () => {
    if (phase === "ready") navigate({ name: "codes" });
  };
  // 点击左上角品牌区（Logo + 文字）回到验证码首页
  const goHome = () => {
    if (phase !== "ready") return;
    if (route.name !== "codes") navToCodes();
  };

  // 明暗模式快捷切换：在亮色与暗色之间切换（system 模式下手动点击则切到反色）
  const mode = settings?.theme ?? "system";
  const isDark = resolveTheme(mode) === "dark";
  // 锁定状态下保险库未解密，写入设置会失败（后端返回「应用未解锁」）。
  // 此时隐藏主题按钮，避免点击后弹出无法理解的错误。
  const canToggleTheme = Boolean(settings) && phase === "ready";
  const toggleTheme = async () => {
    if (!settings || phase !== "ready") return;
    try {
      await saveSettings({ ...settings, theme: isDark ? "light" : "dark" });
    } catch {
      // 写入失败（如恰好被锁定）时静默忽略，不打扰用户
    }
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      {/* 品牌区同时是「回到首页」入口：点击 Logo 或文字都返回验证码列表 */}
      <button
        className={`titlebar-brand titlebar-home${route.name === "codes" ? " is-current" : ""}`}
        onClick={goHome}
        aria-label={t("返回验证码")}
        title={t("返回验证码")}
        disabled={phase !== "ready"}
      >
        <OneTotpMark className="titlebar-logo" />
        <span className="titlebar-title">OneTOTP</span>
      </button>
      <div className="titlebar-actions">
        {canToggleTheme ? (
          <button
            className="titlebar-btn is-action"
            aria-label={isDark ? t("切换到亮色模式") : t("切换到暗色模式")}
            title={isDark ? t("切换到亮色模式") : t("切换到暗色模式")}
            onClick={toggleTheme}
          >
            {isDark ? <Sun /> : <Moon />}
          </button>
        ) : null}
        {showNav ? (
          <button
            className="titlebar-btn is-action"
            aria-label={inSettings ? t("返回验证码") : t("设置")}
            title={inSettings ? t("返回验证码") : t("设置")}
            onClick={inSettings ? navToCodes : navToSettings}
          >
            {inSettings ? <Grid /> : <Settings />}
          </button>
        ) : null}
        <button className="titlebar-btn" aria-label={t("最小化")} title={t("最小化")} onClick={minimize}>
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.4}>
            <path d="M2.5 6h7" strokeLinecap="round" />
          </svg>
        </button>
        <button className="titlebar-btn is-close" aria-label={t("关闭")} title={t("关闭")} onClick={close}>
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.4}>
            <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
