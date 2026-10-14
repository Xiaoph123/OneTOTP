import { Grid, Settings } from "./icons";

export type TabKey = "codes" | "settings";

const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "codes", label: "验证码", icon: <Grid /> },
  { key: "settings", label: "设置", icon: <Settings /> },
];

export function TabBar({ active, onSelect }: { active: TabKey; onSelect: (key: TabKey) => void }) {
  return (
    <nav className="tab-bar" aria-label="主导航">
      {tabs.map((t) => (
        <button
          key={t.key}
          className={`tab-item${active === t.key ? " active" : ""}`}
          onClick={() => onSelect(t.key)}
          aria-label={t.label}
          aria-current={active === t.key ? "page" : undefined}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
