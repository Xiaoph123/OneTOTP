import { Clock, Grid, Heart, Settings } from "./icons";
import { useI18n } from "../i18n";
import { isDesktop } from "../lib/platform";
import { useApp } from "../state/AppContext";

/** 移动端底部导航项：验证码（全部）/ 收藏 / 最近 / 设置 */
export type TabKey = "codes" | "favorite" | "recent" | "settings";

const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "codes", label: "验证码", icon: <Grid /> },
  { key: "favorite", label: "收藏", icon: <Heart /> },
  { key: "recent", label: "最近", icon: <Clock /> },
  { key: "settings", label: "设置", icon: <Settings /> },
];

/**
 * 底部标签导航（仅移动端）。
 *
 * 四项与验证码列表的筛选维度一一对应：验证码=全部、收藏、最近，最后一项进入设置。
 * 导航行为由组件自身统一处理，各页面只负责传入当前高亮的项，
 * 避免每个页面重复实现一套分支逻辑。
 *
 * 桌面端不渲染：窗口标题栏右上角已提供设置 / 返回入口，
 * 底部再挂一条导航条既占空间又显得多余。
 */
export function TabBar({ active }: { active: TabKey }) {
  const { t } = useI18n();
  const { navigate, route, setCodesFilter } = useApp();
  if (isDesktop()) return null;

  const select = (key: TabKey) => {
    if (key === "settings") {
      navigate({ name: "settings" });
      return;
    }
    setCodesFilter(key === "codes" ? "all" : key);
    // 已在验证码列表时只切换筛选，避免多余的入栈导致返回键要按两次
    if (route.name !== "codes") navigate({ name: "codes" });
  };

  return (
    <nav className="tab-bar" aria-label={t("主导航")}>
      {tabs.map((tb) => (
        <button
          key={tb.key}
          className={`tab-item${active === tb.key ? " active" : ""}`}
          onClick={() => select(tb.key)}
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
