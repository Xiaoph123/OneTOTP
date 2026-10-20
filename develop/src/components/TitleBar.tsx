import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../state/AppContext";
import { Moon, OneTotpMark, Sun } from "./icons";
import { resolveTheme } from "../lib/theme";
import { isDesktop } from "../lib/platform";
import { useI18n } from "../i18n";

/** 自绘窗口标题栏（关闭原生装饰后使用）。移动端无窗口装饰概念，不渲染。 */
export function TitleBar() {
  const win = getCurrentWindow();
  const { settings, saveSettings, phase } = useApp();
  const { t } = useI18n();

  if (!isDesktop()) return null;

  const minimize = () => {
    win.minimize().catch(() => {});
  };
  const close = () => {
    win.close().catch(() => {});
  };

  // 明暗模式快捷切换：在亮色与暗色之间切换（system 模式下手动点击则切到反色）
  const mode = settings?.theme ?? "light";
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
      <span className="titlebar-brand" data-tauri-drag-region>
        <OneTotpMark className="titlebar-logo" />
        <span className="titlebar-title" data-tauri-drag-region>
          OneTotp
        </span>
      </span>
      <div className="titlebar-actions">
        {canToggleTheme ? (
          <button
            className="titlebar-btn"
            aria-label={isDark ? t("切换到亮色模式") : t("切换到暗色模式")}
            title={isDark ? t("切换到亮色模式") : t("切换到暗色模式")}
            onClick={toggleTheme}
          >
            {isDark ? <Sun /> : <Moon />}
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
