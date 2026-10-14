import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export type ToastType = "success" | "warning" | "error" | "info" | "loading";

interface ToastItem {
  id: number;
  type: ToastType;
  content: string;
  closable: boolean;
}

interface ToastContextValue {
  show: (type: ToastType, content: string, options?: { closable?: boolean; duration?: number }) => number;
  success: (content: string, duration?: number) => number;
  error: (content: string, duration?: number) => number;
  warning: (content: string, duration?: number) => number;
  info: (content: string, duration?: number) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast 必须在 ToastProvider 内使用");
  return ctx;
}

/** 源力设计系统 Message 图标（原样取自 component-message.html） */
const ICONS: Record<ToastType, string> = {
  success:
    "M10 1a9 9 0 1 1 0 18A9 9 0 0 1 10 1zm3.7 5.3a.75.75 0 0 0-1.06 0L9 9.94 7.36 8.3a.75.75 0 1 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.06 0l4.1-4.1a.75.75 0 0 0 0-1.06z",
  warning:
    "M10 1a9 9 0 1 1 0 18A9 9 0 0 1 10 1zm0 4.5a.75.75 0 0 0-.75.75v4a.75.75 0 0 0 1.5 0v-4A.75.75 0 0 0 10 5.5zM10 14a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  error:
    "M10 1a9 9 0 1 1 0 18A9 9 0 0 1 10 1zm2.83 5.17a.75.75 0 0 0-1.06 0L10 7.94 8.23 6.17a.75.75 0 1 0-1.06 1.06L8.94 9l-1.77 1.77a.75.75 0 1 0 1.06 1.06L10 10.06l1.77 1.77a.75.75 0 1 0 1.06-1.06L11.06 9l1.77-1.77a.75.75 0 0 0 0-1.06z",
  info:
    "M10 1a9 9 0 1 1 0 18A9 9 0 0 1 10 1zM10 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-.75 4a.75.75 0 0 0 0 1.5h.01v2.75a.75.75 0 0 0 1.5 0V10.75a.75.75 0 0 0-.75-.75h-.76z",
  loading:
    "M10 1.5L10.7 4.75 10 7 9.3 4.75ZM10 18.5L9.3 15.25 10 13 10.7 15.25ZM18.5 10L15.25 10.7 13 10 15.25 9.3ZM1.5 10L4.75 9.3 7 10 4.75 10.7ZM13.89 6.11L13.18 6.82 11.77 8.23 12.48 7.52ZM13.89 13.89L12.48 13.18 11.77 11.77 13.18 12.48ZM6.11 13.89L6.82 12.48 8.23 11.77 7.52 13.18ZM6.11 6.11L7.52 6.82 8.23 8.23 6.82 7.52Z",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback<ToastContextValue["show"]>(
    (type, content, options) => {
      const closable = options?.closable ?? true;
      const duration = options?.duration ?? (type === "loading" ? 0 : 2200);
      seq.current += 1;
      const id = seq.current;
      setItems((prev) => [...prev, { id, type, content, closable }]);
      if (duration > 0) {
        const timer = window.setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (content, duration) => show("success", content, { duration }),
      error: (content, duration) => show("error", content, { duration }),
      warning: (content, duration) => show("warning", content, { duration }),
      info: (content, duration) => show("info", content, { duration }),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="message-container" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`message message-${t.type}`} data-component="message" data-type={t.type}>
            <svg className="message-icon" viewBox="0 0 20 20">
              <path d={ICONS[t.type]} />
            </svg>
            <span className="message-content">{t.content}</span>
            {t.closable ? (
              <button className="message-close" aria-label="关闭" onClick={() => dismiss(t.id)}>
                <svg viewBox="0 0 16 16">
                  <path d="M8 6.94L11.47 3.47a.75.75 0 1 1 1.06 1.06L9.06 8l3.47 3.47a.75.75 0 1 1-1.06 1.06L8 9.06l-3.47 3.47a.75.75 0 0 1-1.06-1.06L6.94 8 3.47 4.53a.75.75 0 0 1 1.06-1.06L8 6.94z" />
                </svg>
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
