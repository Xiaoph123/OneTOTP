export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch${checked ? " on" : ""}`}
      onClick={() => !disabled && onChange(!checked)}
    >
      <i />
    </button>
  );
}

/** 环形倒计时进度，颜色随剩余时间变化 */
export function CountdownRing({
  remaining,
  period,
  danger,
}: {
  remaining: number;
  period: number;
  danger?: boolean;
}) {
  const pct = Math.max(0, Math.min(1, remaining / period));
  const radius = 27;
  const circumference = 2 * Math.PI * radius; // ≈169.6
  const offset = circumference * (1 - pct);
  // 颜色走类名而非内联样式；SVG 的 stroke / dashoffset 为属性，不受 CSP 限制
  const stroke = danger ? "var(--color-danger)" : "var(--color-primary)";

  return (
    <div className="otp-ring" aria-hidden>
      <svg viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="var(--color-bg-5)" strokeWidth="5" />
        <circle
          className="otp-ring-progress"
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className={`otp-ring-num${danger ? " is-danger" : ""}`}>{remaining}</div>
    </div>
  );
}
