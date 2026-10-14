import { Grid, Settings } from "./icons";
import { useI18n } from "../i18n";

export type TabKey = "codes" | "settings";

const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "codes", label: "验证码", icon: <Grid /> },
  { key: "settings", label: "设置", icon: <Settings /> },
];

export function TabBar({ active, onSelect }: { active: TabKey; onSelect: (key: TabKey) => void }) {
  const { t } = useI18n();
  return (
    <nav className="tab-bar" aria-label={t("主导航")}>
      {tabs.map((tb) => (
        <button
          key={tb.key}
          className={`tab-item${active === tb.key ? " active" : ""}`}
          onClick={() => onSelect(tb.key)}
          aria-label={t(tb.label)}
          aria-current={active === tb.key ? "page" : undefined}
        >
          {tb.icon}
          <span>{t(tb.label)}</span>
        </button>
      ))}
    </nav>
  );
}
