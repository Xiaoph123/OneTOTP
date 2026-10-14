import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "text" | "danger";
type Size = "lg" | "md" | "sm";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  block?: boolean;
}

const heights: Record<Size, number> = { lg: 36, md: 32, sm: 28 };
const fontSizes: Record<Size, string> = {
  lg: "var(--font-size-h4)",
  md: "var(--font-size-lead)",
  sm: "var(--font-size-lead)",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  block,
  children,
  style,
  disabled,
  ...rest
}: Props) {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: heights[size],
    padding: size === "sm" ? "0 12px" : "0 16px",
    borderRadius: "var(--radius-sm)",
    border: "none",
    fontSize: fontSizes[size],
    fontWeight: variant === "primary" ? "var(--font-weight-medium)" : "var(--font-weight-regular)",
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    width: block ? "100%" : undefined,
    transition: "background 150ms ease, box-shadow 150ms ease, opacity 150ms ease",
  };

  const variants: Record<Variant, React.CSSProperties> = {
    primary: {
      background: "var(--color-primary)",
      color: "var(--color-white)",
      boxShadow: "var(--shadow-blue)",
      opacity: disabled ? 0.6 : 1,
    },
    secondary: {
      background: "var(--color-bg-4)",
      color: "var(--color-text-2)",
      boxShadow: "inset 0 0 0 1px var(--color-border-3)",
      opacity: disabled ? 0.6 : 1,
    },
    text: {
      background: "transparent",
      color: "var(--color-primary)",
      padding: "0 8px",
    },
    danger: {
      background: "var(--color-danger)",
      color: "var(--color-white)",
      opacity: disabled ? 0.6 : 1,
    },
  };

  return (
    <button
      {...rest}
      disabled={disabled}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (variant === "primary") e.currentTarget.style.background = "var(--color-primary-hover)";
        else if (variant === "secondary") e.currentTarget.style.background = "var(--color-bg-5)";
        else if (variant === "text") e.currentTarget.style.background = "rgba(22,100,255,0.06)";
        else if (variant === "danger") e.currentTarget.style.opacity = "0.9";
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = variants[variant].background as string;
        e.currentTarget.style.opacity = (variants[variant].opacity as number)?.toString() ?? "1";
      }}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  children,
  label,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className="icon-btn" aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}
