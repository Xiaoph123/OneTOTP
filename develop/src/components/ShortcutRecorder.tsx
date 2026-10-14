import { useEffect, useRef, useState } from "react";

interface Props {
  /** 当前快捷键（空表示未设置） */
  value: string;
  /** 录制完成回调，参数为空字符串表示清除 */
  onChange: (shortcut: string) => void;
  /** 控件宽度，需与其他设置项保持一致 */
  width?: number | string;
}

/** 将键盘事件转为 Tauri 全局快捷键格式，例如 Control+Shift+A */
function toShortcut(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");

  const key = e.key;
  // 仅修饰键按下时不算完整快捷键
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) return null;

  let main = "";
  if (/^[a-zA-Z]$/.test(key)) main = key.toUpperCase();
  else if (/^[0-9]$/.test(key)) main = key;
  else if (key === " ") main = "Space";
  else if (key.startsWith("F") && /^F([1-9]|1[0-2])$/.test(key)) main = key;
  else if (key === "ArrowUp") main = "Up";
  else if (key === "ArrowDown") main = "Down";
  else if (key === "ArrowLeft") main = "Left";
  else if (key === "ArrowRight") main = "Right";
  else if (key.length === 1) main = key.toUpperCase();
  else return null;

  // 纯字母/数字裸键易与输入冲突，要求至少一个修饰键
  if (mods.length === 0) return null;
  return [...mods, main].join("+");
}

/**
 * 快捷键录制输入框：
 * - 点击后进入录制态，用户按下组合键即替换当前快捷键
 * - 录制态下按 Delete / Backspace 清除快捷键
 * - 按 Esc 取消录制
 */
export function ShortcutRecorder({ value, onChange, width = 124 }: Props) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecording(false);
        setHint(null);
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        onChange("");
        setRecording(false);
        setHint(null);
        return;
      }

      const shortcut = toShortcut(e);
      if (shortcut) {
        onChange(shortcut);
        setRecording(false);
        setHint(null);
      } else {
        // 提示需要至少一个修饰键
        setHint("需配合 Ctrl / Alt / Shift");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange]);

  // 点击外部结束录制
  useEffect(() => {
    if (!recording) return;
    const onDown = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setRecording(false);
        setHint(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [recording]);

  const label = recording ? (hint ?? "请按下组合键…") : value || "未设置";

  return (
    <button
      ref={btnRef}
      type="button"
      className="ui-input"
      style={{
        width,
        cursor: "pointer",
        textAlign: "center",
        fontFamily: "var(--font-mono)",
        color: recording ? "var(--color-primary)" : value ? "var(--color-text-1)" : "var(--color-text-3)",
        boxShadow: recording
          ? "0 0 0 1px var(--color-primary), 0 0 0 3px rgba(22,100,255,0.3)"
          : undefined,
      }}
      onClick={() => {
        setHint(null);
        setRecording((r) => !r);
      }}
      title="点击后按下组合键即可设置，Delete 清除"
    >
      {label}
    </button>
  );
}
