import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/AppContext";
import { CodeCard } from "../components/CodeCard";
import { TabBar, type TabKey } from "../components/TabBar";
import { Button } from "../components/Button";
import { ColorDot } from "../components/ColorDot";
import { ChevronDown, Grid, Info, Plus, Search } from "../components/icons";
import { useI18n } from "../i18n";
import { hexToRgbTriplet } from "../lib/utils";
import type { AccountView } from "../lib/api";

type Filter2 = "all" | "favorite" | "recent";

interface Group {
  /** 分类 id，空字符串代表「未分类」 */
  id: string;
  name: string;
  color: string;
  accounts: AccountView[];
}

export function CodesPage() {
  const { accounts, categories, codes, settings, navigate } = useApp();
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter2>("all");
  const [query, setQuery] = useState("");
  // 防抖后的查询词：输入框即时回显，过滤计算延迟 200ms，避免每次按键全量过滤
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  // 折叠状态：记录被收起的分类 id
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

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

  const onTabSelect = (key: TabKey) => {
    if (key === "settings") navigate({ name: "settings" });
  };

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
                    onClick={() =>
                      setCollapsed((prev) => ({ ...prev, [g.id]: !isCollapsed }))
                    }
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

      <TabBar active="codes" onSelect={onTabSelect} />
    </>
  );
}
