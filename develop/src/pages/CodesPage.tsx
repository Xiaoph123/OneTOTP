import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, type CodesFilter } from "../state/AppContext";
import { CodeCard } from "../components/CodeCard";
import { TabBar } from "../components/TabBar";
import { Button } from "../components/Button";
import { ColorDot } from "../components/ColorDot";
import { ChevronDown, Grid, Info, Plus, Search } from "../components/icons";
import { useI18n } from "../i18n";
import { hexToRgbTriplet } from "../lib/utils";
import { isDesktop } from "../lib/platform";
import type { AccountView } from "../lib/api";

interface Group {
  /** 分类 id，空字符串代表「未分类」 */
  id: string;
  name: string;
  color: string;
  accounts: AccountView[];
}

/** 分类折叠状态的本机缓存键（remember 模式使用） */
const COLLAPSED_CACHE_KEY = "onetotp.collapsedCategories";

/**
 * 读取上次的分类折叠状态。
 *
 * 为什么放 localStorage 而不是设置项：折叠状态是高频变化的临时视图状态，
 * 每次点击都写保险库会带来不必要的磁盘写入与加密开销；
 * 且它不含敏感信息，本机缓存即可。
 */
function readCollapsedState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === true) out[k] = true;
    }
    return out;
  } catch {
    return {};
  }
}

/** 写入分类折叠状态（只记录被收起的分类，展开的不占空间） */
function writeCollapsedState(state: Record<string, boolean>): void {
  try {
    const onlyCollapsed: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(state)) {
      if (v) onlyCollapsed[k] = true;
    }
    localStorage.setItem(COLLAPSED_CACHE_KEY, JSON.stringify(onlyCollapsed));
  } catch {
    // localStorage 不可用（隐私模式等）时忽略，仅失去记忆能力
  }
}

export function CodesPage() {
  const { accounts, categories, codes, settings, navigate, codesFilter, setCodesFilter } = useApp();
  const { t } = useI18n();
  // 桌面端：筛选由顶部「全部 / 收藏 / 最近」分段控件控制，默认全部。
  // 移动端：筛选由底部导航控制，与 TabBar 的四项一一对应。
  const desktop = isDesktop();
  const [desktopFilter, setDesktopFilter] = useState<CodesFilter>("all");
  const filter: CodesFilter = desktop ? desktopFilter : codesFilter;
  const setFilter = (next: CodesFilter) => {
    if (desktop) setDesktopFilter(next);
    else setCodesFilter(next);
  };
  const [query, setQuery] = useState("");
  // 防抖后的查询词：输入框即时回显，过滤计算延迟 200ms，避免每次按键全量过滤
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  // 折叠状态：记录被收起的分类 id。
  // 初始值由设置项 categoryExpandMode 决定（见下方 effect）：
  // - expand：全部展开
  // - collapse：全部收起
  // - remember：从 localStorage 还原上次状态
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const expandMode = settings?.categoryExpandMode ?? "expand";
  // 只在「分类集合首次就绪」时应用一次初始策略，
  // 之后用户的点击不应被设置项反复覆盖。
  const appliedModeRef = useRef<string | null>(null);
  useEffect(() => {
    if (categories.length === 0) return;
    if (appliedModeRef.current === expandMode) return;
    appliedModeRef.current = expandMode;
    if (expandMode === "expand") {
      setCollapsed({});
    } else if (expandMode === "collapse") {
      const next: Record<string, boolean> = {};
      for (const c of categories) next[c.id] = true;
      setCollapsed(next);
    } else {
      setCollapsed(readCollapsedState());
    }
  }, [expandMode, categories]);

  /** 切换某个分类的折叠状态；remember 模式下同步写入本机缓存 */
  const toggleCollapsed = (id: string, next: boolean) => {
    setCollapsed((prev) => {
      const merged = { ...prev, [id]: next };
      if (expandMode === "remember") writeCollapsedState(merged);
      return merged;
    });
  };

  const visible = useMemo(() => {
    let list = accounts;
    if (filter === "favorite") list = list.filter((a) => a.favorite);
    if (filter === "recent") {
      list = [...list]
        .filter((a) => a.lastUsedAt > 0)
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    }
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.trim().toLowerCase();
      list = list.filter(
        (a) => a.issuer.toLowerCase().includes(q) || a.account.toLowerCase().includes(q),
      );
    }
    return list;
  }, [accounts, filter, debouncedQuery]);

  /** 按分类分组：分类按 order 排列，未分类置底 */
  const groups = useMemo<Group[]>(() => {
    const byCat = new Map<string, AccountView[]>();
    for (const acc of visible) {
      const key = acc.categoryId || "";
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key)!.push(acc);
    }
    const result: Group[] = [];
    for (const cat of categories) {
      const items = byCat.get(cat.id);
      if (items && items.length > 0) {
        result.push({ id: cat.id, name: cat.name, color: cat.color, accounts: items });
        byCat.delete(cat.id);
      }
    }
    // 兜底：categoryId 指向不存在的分类（例如导入的备份不完整、
    // 或分类被外部修改）时，这些账户绝不能凭空消失，统一归入「未分类」。
    const leftover: AccountView[] = [];
    for (const items of byCat.values()) leftover.push(...items);
    if (leftover.length > 0) {
      result.push({ id: "", name: t("未分类"), color: "", accounts: leftover });
    }
    return result;
  }, [visible, categories, t]);

  const isEmpty = visible.length === 0;
  // 是否处于搜索状态：以「已生效的过滤条件」为准。
  // 若用输入框的实时 query 判断，防抖延迟的 200ms 内会出现
  // 「已输入关键词，却提示还没有添加任何账户」的错乱文案。
  const searching = debouncedQuery.trim().length > 0;
  // 有分类时才显示分组标题，否则保持原平铺观感
  const grouped = categories.length > 0;

  const renderCard = (account: AccountView) => (
    <CodeCard
      key={account.id}
      account={account}
      code={codes[account.id]}
      grouping={settings?.codeGrouping ?? true}
      expiryHighlight={settings?.expiryHighlight ?? true}
      clickToCopy={settings?.clickToCopy ?? true}
      codeVisibility={settings?.codeVisibility ?? "never"}
      density={settings?.cardDensity ?? "standard"}
      detail={settings?.cardDetail ?? "standard"}
      autoHideAfterCopy={settings?.autoHideAfterCopy ?? false}
      onOpen={() => navigate({ name: "detail", accountId: account.id })}
    />
  );

  return (
    <>
      <section className="app-body is-column">
        <div className="search-row">
          <div className="search-bar">
            <Search className="search-icon" />
            <input
              className="search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("搜索账户或服务")}
            />
          </div>
          <Button
            variant="primary"
            size="lg"
            className="search-add-btn"
            icon={<Plus className="icon-16" />}
            onClick={() => navigate({ name: "add" })}
          >
            {t("添加")}
          </Button>
        </div>

        {/* 桌面端保留顶部分段筛选；移动端改用底部导航，这里不再重复 */}
        {desktop ? (
          <div className="segmented mb-12" role="tablist">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
              {t("全部")}
            </button>
            <button
              className={filter === "favorite" ? "active" : ""}
              onClick={() => setFilter("favorite")}
            >
              {t("收藏")}
            </button>
            <button
              className={filter === "recent" ? "active" : ""}
              onClick={() => setFilter("recent")}
            >
              {t("最近")}
            </button>
          </div>
        ) : null}

        {isEmpty ? (
          <div className="empty-state">
            <span className="empty-icon">
              <Grid />
            </span>
            <span className="empty-title">
              {searching ? t("没有匹配的账户") : t("还没有添加任何账户")}
            </span>
            <span className="empty-desc">
              {searching ? t("换个关键词试试") : t("扫描二维码或手动输入密钥即可开始")}
            </span>
            {!searching ? (
              <button
                className="btn-primary-inline"
                onClick={() => navigate({ name: "add" })}
              >
                {t("添加账户")}
              </button>
            ) : null}
          </div>
        ) : grouped ? (
          <div className="otp-groups">
            {groups.map((g) => {
              const isCollapsed = collapsed[g.id] ?? false;
              // 折叠时用「分类色的淡色」高亮，一眼辨识所属分类
              const catRgb = g.color ? hexToRgbTriplet(g.color) : null;
              return (
                <div key={g.id || "__uncat__"} className="otp-group">
                  <button
                    className={`otp-group-head${isCollapsed ? " is-collapsed" : ""}`}
                    onClick={() => toggleCollapsed(g.id, !isCollapsed)}
                    aria-expanded={!isCollapsed}
                    ref={(el) => {
                      // 通过 CSSOM 写入分类色变量（CSP 收紧后不允许行内 style）
                      if (!el) return;
                      if (isCollapsed) {
                        el.style.setProperty("--cat-rgb", catRgb ?? "241, 243, 245");
                      } else {
                        el.style.removeProperty("--cat-rgb");
                      }
                    }}
                  >
                    <ColorDot color={g.color} className="otp-group-dot" fallback="var(--color-text-4)" />
                    <span className="otp-group-name">{g.name}</span>
                    <span className="otp-group-count">{g.accounts.length}</span>
                    <ChevronDown
                      className={`otp-group-chevron${isCollapsed ? " is-collapsed" : ""} icon-14`}
                    />
                  </button>
                  {!isCollapsed ? (
                    <div className="otp-list">{g.accounts.map(renderCard)}</div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="otp-list">{visible.map(renderCard)}</div>
        )}

        {/* 空状态自身撑满剩余空间并垂直居中，无需占位元素；非空时用占位把提示条顶到底部 */}
        {!isEmpty ? <div className="body-spacer" /> : null}
        <div className="notice notice-soft notice-bottom">
          <Info className="icon-muted" />
          {t("验证码在本地离线生成，不会上传到任何服务器。")}
        </div>
      </section>

      <TabBar active={filter === "all" ? "codes" : filter} />
    </>
  );
}
