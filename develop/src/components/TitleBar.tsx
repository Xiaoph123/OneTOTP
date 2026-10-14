import { getCurrentWindow } from "@tauri-apps/api/window";
import { useApp } from "../state/AppContext";
import { Moon, Sun } from "./icons";
import { resolveTheme } from "../lib/theme";

/** 自绘窗口标题栏（关闭原生装饰后使用） */
export function TitleBar() {
  const win = getCurrentWindow();
  const { settings, saveSettings } = useApp();

  const minimize = () => {
    win.minimize().catch(() => {});
  };
  const close = () => {
    win.close().catch(() => {});
  };

  // 明暗模式快捷切换：在亮色与暗色之间切换（system 模式下手动点击则切到反色）
  const mode = settings?.theme ?? "light";
  const isDark = resolveTheme(mode) === "dark";
  const toggleTheme = async () => {
    if (!settings) return;
    await saveSettings({ ...settings, theme: isDark ? "light" : "dark" });
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      <span className="titlebar-title" data-tauri-drag-region>
        oneTotp
      </span>
      <div className="titlebar-actions">
        {settings ? (
          <button
            className="titlebar-btn"
            aria-label={isDark ? "切换到亮色模式" : "切换到暗色模式"}
            title={isDark ? "切换到亮色模式" : "切换到暗色模式"}
            onClick={toggleTheme}
          >
            {isDark ? <Sun /> : <Moon />}
          </button>
        ) : null}
        <button className="titlebar-btn" aria-label="最小化" title="最小化" onClick={minimize}>
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.4}>
            <path d="M2.5 6h7" strokeLinecap="round" />
          </svg>
        </button>
        <button className="titlebar-btn is-close" aria-label="关闭" title="关闭" onClick={close}>
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.4}>
            <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
