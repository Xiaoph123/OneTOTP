import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface Props<T extends string | number> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  /** 额外类名，用于指定宽度（如快捷键录制框对齐用的 control-w），默认撑满父容器 */
  className?: string;
  size?: "large" | "default" | "small" | "mini";
  /**
   * 外观变体：
   * - `default`：带边框的输入框样式，用于表单字段
   * - `ghost`：无边框，仅显示当前值 + 箭头，点击弹出浮层菜单。
   *   用于设置行右侧，避免固定宽度浪费横向空间。
   */
  variant?: "default" | "ghost";
}

/** 源力设计系统 Select 选择器（单选） */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  className,
  size = "default",
  variant = "default",
}: Props<T>) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);
  const isPlaceholder = current === undefined;
  const sizeClass = size === "default" ? "" : ` select-${size}`;
  const variantClass = variant === "ghost" ? " select-ghost" : "";

  return (
    <div
      ref={ref}
      className={`select${sizeClass}${variantClass}${open ? " focus" : ""}${disabled ? " disabled" : ""}${className ? ` ${className}` : ""}`}
    >
      <div
        className="select-trigger"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        title={isPlaceholder ? placeholder ?? t("请选择") : current!.label}
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <span className={`select-value${isPlaceholder ? " select-placeholder" : ""}`}>
          {isPlaceholder ? placeholder ?? t("请选择") : current!.label}
        </span>
        <span className="select-suffix">
          <svg
            className={`select-arrow${open ? " rotated" : ""}`}
            viewBox="0 0 16 16"
            fill="none"
          >
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>

      <div className="select-dropdown" role="listbox">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <div
              key={String(o.value)}
              role="option"
              aria-selected={selected}
              className={`select-option${selected ? " selected" : ""}${o.disabled ? " disabled" : ""}`}
              onClick={() => {
                if (o.disabled) return;
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
              {selected ? (
                <svg className="select-option-check" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M3 8l4 4 6-8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
