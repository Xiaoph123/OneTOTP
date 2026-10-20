import { useEffect, useRef } from "react";

/**
 * 动态颜色圆点。
 *
 * 分类颜色等来自用户数据，无法预定义为固定 CSS 类；而收紧 CSP 后
 * （style-src 不含 'unsafe-inline'）行内 style 属性会被拦截。
 * CSSOM 操作不受 CSP 限制，故在挂载/变更后通过 ref 设置背景色。
 */
export function ColorDot({
  color,
  className,
  fallback = "var(--color-text-4)",
}: {
  color: string;
  className?: string;
  fallback?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.backgroundColor = color || fallback;
  }, [color, fallback]);

  return <span ref={ref} className={className} aria-hidden />;
}
