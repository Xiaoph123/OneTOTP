import { useId, type SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps) => ({
  viewBox: "0 0 18 18",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
});

export const ShieldCheck = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" {...p}>
    <path
      d="M12 2.5 4 6v6c0 4.6 3.4 8.1 8 9.5 4.6-1.4 8-4.9 8-9.5V6l-8-3.5z"
      fill="currentColor"
      opacity=".16"
    />
    <path
      d="M12 2.5 4 6v6c0 4.6 3.4 8.1 8 9.5 4.6-1.4 8-4.9 8-9.5V6l-8-3.5z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M8.7 12.1l2.3 2.3 4.3-4.6"
      stroke="currentColor"
      strokeWidth="1.8"
    />
  </svg>
);

export const Plus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 3.5v11M3.5 9h11" />
  </svg>
);

/** 加载转圈：底环 + 一段高亮弧，配合 .ui-spinner 旋转 */
export const Spinner = (p: IconProps) => (
  <svg viewBox="0 0 18 18" fill="none" {...p}>
    <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.8" opacity="0.2" />
    <path
      d="M16 9a7 7 0 0 0-7-7"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

/** 盾牌轮廓路径，供品牌图标与启动扫光复用 */
const SHIELD_PATH =
  "M12 2.2 3.8 5.9v6.2c0 4.9 3.5 8.6 8.2 10 4.7-1.4 8.2-5.1 8.2-10V5.9L12 2.2z";

/**
 * 品牌图标：渐变色盾牌 + 反白衬线「1」，与 OneTotp 名称呼应。
 * 渐变 id 用 useId 生成，避免多实例/多页面下的 SVG id 冲突。
 */
export const OneTotpMark = (p: IconProps) => {
  const id = useId();
  const grad = `onetotp-grad-${id}`;
  return (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34D399" />
          <stop offset="0.45" stopColor="#22D3EE" />
          <stop offset="1" stopColor="#6366F1" />
        </linearGradient>
      </defs>
      <path d={SHIELD_PATH} fill={`url(#${grad})`} />
      <path
        d={SHIELD_PATH}
        stroke={`url(#${grad})`}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M10.1 9.3 12.4 7.6V15.6"
        stroke="#FFFFFF"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10.3 15.6h4" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
      <path d="M10.1 9.3h1.3" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
};

/**
 * 启动加载图标：品牌盾牌 + 斜向扫光循环划过，替代传统转圈。
 * 扫光被裁切在盾牌轮廓内，仅掠过盾牌本体。
 */
export const OneTotpMarkLoading = (p: IconProps) => {
  const id = useId();
  const grad = `onetotp-grad-${id}`;
  const clip = `onetotp-clip-${id}`;
  const shine = `onetotp-shine-${id}`;
  return (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34D399" />
          <stop offset="0.45" stopColor="#22D3EE" />
          <stop offset="1" stopColor="#6366F1" />
        </linearGradient>
        <linearGradient id={shine} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.75" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <clipPath id={clip}>
          <path d={SHIELD_PATH} />
        </clipPath>
      </defs>

      {/* 盾牌底色 + 反白 1 */}
      <path d={SHIELD_PATH} fill={`url(#${grad})`} />
      <path
        d="M10.1 9.3 12.4 7.6V15.6"
        stroke="#FFFFFF"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10.3 15.6h4" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
      <path d="M10.1 9.3h1.3" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />

      {/* 扫光：被裁切在盾牌内，斜向掠过 */}
      <g clipPath={`url(#${clip})`}>
        <g transform="skewX(-20)">
          <rect className="onetotp-shine" x="0" y="-2" width="6" height="28" fill={`url(#${shine})`} />
        </g>
      </g>

      {/* 轮廓描边压在扫光之上，保证边缘清晰 */}
      <path
        d={SHIELD_PATH}
        stroke={`url(#${grad})`}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export const Lock = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="8" width="10" height="7" rx="1.6" />
    <path d="M6.2 8V6a2.8 2.8 0 0 1 5.6 0v2" />
  </svg>
);

export const Unlock = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="8" width="10" height="7" rx="1.6" />
    <path d="M6.2 8V6a2.8 2.8 0 0 1 5.6 0" />
  </svg>
);

export const MoreHorizontal = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.8}>
    <circle cx="4" cy="9" r="1.1" />
    <circle cx="9" cy="9" r="1.1" />
    <circle cx="14" cy="9" r="1.1" />
  </svg>
);

export const ChevronLeft = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.7}>
    <path d="M11 4 6 9l5 5" />
  </svg>
);

export const ChevronRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 4l4 4-4 4" />
  </svg>
);

export const ChevronDown = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 6.5l5 5 5-5" />
  </svg>
);

export const FolderPlus = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.5}>
    <path d="M2.5 5.2A1.2 1.2 0 0 1 3.7 4h3l1.3 1.6h6.3a1.2 1.2 0 0 1 1.2 1.2v6.4a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2V5.2z" />
    <path d="M9 8.4v3.2M7.4 10h3.2" />
  </svg>
);

export const Search = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.5}>
    <circle cx="7.5" cy="7.5" r="4.5" />
    <path d="M11 11l3.5 3.5" />
  </svg>
);

export const Filter = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 5h12M5.5 9h7M7.5 13h3" />
  </svg>
);

export const Grid = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.5}>
    <rect x="2.5" y="2.5" width="5" height="5" rx="1" />
    <rect x="10.5" y="2.5" width="5" height="5" rx="1" />
    <rect x="2.5" y="10.5" width="5" height="5" rx="1" />
    <rect x="10.5" y="10.5" width="5" height="5" rx="1" />
  </svg>
);

export const Heart = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.5}>
    <path d="M9 15S3 11.6 3 7.4A2.9 2.9 0 0 1 9 5.6a2.9 2.9 0 0 1 6 1.8C15 11.6 9 15 9 15z" />
  </svg>
);

export const Clock = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.5}>
    <circle cx="9" cy="9" r="6.5" />
    <path d="M9 5.2V9l2.6 1.6" />
  </svg>
);

export const Settings = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const Copy = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.6}>
    <rect x="6" y="6" width="9" height="9" rx="1.6" />
    <path d="M12 6V4a1.6 1.6 0 0 0-1.6-1.6H4A1.6 1.6 0 0 0 2.4 4v6.4A1.6 1.6 0 0 0 4 12h2" />
  </svg>
);

export const Refresh = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.6}>
    <path d="M14.5 9a5.5 5.5 0 1 1-1.6-3.9M14.5 2.6V6h-3.4" />
  </svg>
);

export const Edit = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13 3.2l1.8 1.8M4.5 13.5l7.9-7.9-1.8-1.8-7.9 7.9-.6 2.9 2.9-.6z" />
  </svg>
);

export const Trash = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.5}>
    <path d="M3.5 4.5h9M6 4.5V3.2A.7.7 0 0 1 6.7 2.5h2.6a.7.7 0 0 1 .7.7v1.3M5 4.5l.5 8a1 1 0 0 0 1 .9h3a1 1 0 0 0 1-.9l.5-8" />
  </svg>
);

export const Download = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.6}>
    <path d="M9 2.5v8.5M6 8l3 3 3-3M3.5 14.5h11" />
  </svg>
);

export const Upload = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.6}>
    <path d="M9 11.5V3M6 6l3-3 3 3M3.5 14.5h11" />
  </svg>
);

/** 打开的文件夹：用于「选择导出位置」 */
export const FolderOpen = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.6}>
    <path d="M2.5 13.5V4.5a1 1 0 0 1 1-1h3l1.5 2h4.5a1 1 0 0 1 1 1v1.5" />
    <path d="M2.5 13.5l1.8-5.2a1 1 0 0 1 .95-.7h10.1a1 1 0 0 1 .95 1.3l-1.6 4.6a1 1 0 0 1-.95.7H3.5a1 1 0 0 1-1-1z" />
  </svg>
);

export const Eye = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.5}>
    <path d="M1.7 9S4.6 4 9 4s7.3 5 7.3 5S13.4 14 9 14 1.7 9 1.7 9z" />
    <circle cx="9" cy="9" r="2.2" />
  </svg>
);

export const EyeOff = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.5}>
    <path d="M3 3l12 12M7.3 7.4A2.2 2.2 0 0 0 9 11.2M5.1 5.2C3 6.6 1.7 9 1.7 9S4.6 14 9 14c1.3 0 2.5-.4 3.5-1M14.9 11.1C15.9 9.9 16.3 9 16.3 9S13.4 4 9 4c-.4 0-.8 0-1.1.1" />
  </svg>
);

export const AlertTriangle = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.6}>
    <path d="M9 2.6l6.6 12H2.4l6.6-12z" />
    <path d="M9 7v3.3M9 12.9v.1" />
  </svg>
);

export const Info = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.5}>
    <circle cx="9" cy="9" r="6.5" />
    <path d="M9 8.2v3.6M9 5.6v.1" />
  </svg>
);

export const Check = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.8}>
    <path d="M3.8 9.3l3.2 3.2 7-7.4" />
  </svg>
);

export const Fingerprint = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} {...p}>
    <path d="M12 3.5c-2 0-3.8.9-5 2.3M18.6 6.7A7.4 7.4 0 0 1 19.5 11c0 1-.1 2-.3 2.9M5 9.5A7.5 7.5 0 0 0 4.5 11c0 3.3 1.5 6.2 3.8 8M12 7.5a3.5 3.5 0 0 1 3.5 3.5c0 2.5-.6 4.8-1.7 6.8M8.5 11A3.5 3.5 0 0 1 12 7.5M8.6 15.2c.4 1.9 1.1 3.5 2 4.9" strokeLinecap="round" />
  </svg>
);

export const Backspace = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...p}>
    <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9L3 12l6-7z" strokeLinejoin="round" />
    <path d="M12 9.5l5 5M17 9.5l-5 5" strokeLinecap="round" />
  </svg>
);

export const Key = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.5}>
    <circle cx="6.5" cy="11.5" r="3" />
    <path d="M8.6 9.4L14 4M12 6l1.6 1.6M14 4l1.5 1.5" />
  </svg>
);

export const Camera = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.6}>
    <path d="M2.5 6.5A1.5 1.5 0 0 1 4 5h1.6l.9-1.4a1 1 0 0 1 .9-.5h2.2a1 1 0 0 1 .9.5L11.4 5H14a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 14 14H4a1.5 1.5 0 0 1-1.5-1.5v-6z" />
    <circle cx="9" cy="9.5" r="2.6" />
  </svg>
);

export const QrCode = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.5}>
    <rect x="2.5" y="2.5" width="5" height="5" rx="1" />
    <rect x="10.5" y="2.5" width="5" height="5" rx="1" />
    <rect x="2.5" y="10.5" width="5" height="5" rx="1" />
    <path d="M11 11h2v2h-2zM14 14h1.5v1.5H14z" />
  </svg>
);

export const Sun = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.5}>
    <circle cx="9" cy="9" r="3.2" />
    <path d="M9 1.8v1.6M9 14.6v1.6M1.8 9h1.6M14.6 9h1.6M3.9 3.9l1.1 1.1M13 13l1.1 1.1M14.1 3.9L13 5M5 13l-1.1 1.1" />
  </svg>
);

export const Close = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.8}>
    <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
  </svg>
);

export const Moon = (p: IconProps) => (
  <svg {...base(p)} strokeWidth={1.5}>
    <path d="M14.5 10.6A6 6 0 0 1 7.4 3.5a6 6 0 1 0 7.1 7.1z" />
  </svg>
);

