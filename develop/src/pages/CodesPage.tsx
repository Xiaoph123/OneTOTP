import { useMemo, useState, type CSSProperties } from "react";
import { useApp } from "../state/AppContext";
import { CodeCard } from "../components/CodeCard";
import { TabBar, type TabKey } from "../components/TabBar";
import { Button } from "../components/Button";
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
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (a) => a.issuer.toLowerCase().includes(q) || a.account.toLowerCase().includes(q),
      );
    }
    return list;
  }, [accounts, filter, query]);

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
      }
    }
    const uncategorized = byCat.get("");
    if (uncategorized && uncategorized.length > 0) {
      result.push({ id: "", name: t("未分类"), color: "", accounts: uncategorized });
    }
    return result;
  }, [visible, categories, t]);

  const onTabSelect = (key: TabKey) => {
    if (key === "settings") navigate({ name: "settings" });
  };

  const isEmpty = visible.length === 0;
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
            <Search style={{ width: 14, height: 14, color: "var(--color-text-3)", flexShrink: 0 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("搜索账户或服务")}
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                width: "100%",
                fontSize: "var(--font-size-lead)",
                color: "var(--color-text-1)",
              }}
            />
          </div>
          <Button
            variant="primary"
            size="lg"
            className="search-add-btn"
            style={{ height: "var(--search-add-h)", borderRadius: "var(--radius-md)", boxShadow: "none" }}
            icon={<Plus style={{ width: 16, height: 16 }} />}
            onClick={() => navigate({ name: "add" })}
          >
            {t("添加")}
          </Button>
        </div>

        <div className="segmented" style={{ marginBottom: 12 }} role="tablist">
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
              {query ? t("没有匹配的账户") : t("还没有添加任何账户")}
            </span>
            <span className="empty-desc">
              {query ? t("换个关键词试试") : t("扫描二维码或手动输入密钥即可开始")}
            </span>
            {!query ? (
              <button
                className="btn-primary-inline"
                onClick={() => navigate({ name: "add" })}
                style={{
                  marginTop: 6,
                  height: 32,
                  padding: "0 16px",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  background: "var(--color-primary)",
                  color: "var(--color-white)",
                  fontSize: "var(--font-size-lead)",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
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
                    style={
                      isCollapsed
                        ? ({ "--cat-rgb": catRgb ?? "241, 243, 245" } as CSSProperties)
                        : undefined
                    }
                  >
                    <span
                      className="otp-group-dot"
                      style={{ background: g.color || "var(--color-text-4)" }}
                    />
                    <span className="otp-group-name">{g.name}</span>
                    <span className="otp-group-count">{g.accounts.length}</span>
                    <ChevronDown
                      className={`otp-group-chevron${isCollapsed ? " is-collapsed" : ""}`}
                      style={{ width: 14, height: 14 }}
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
        <div
          className="notice"
          style={{ marginTop: 14, marginBottom: -6, background: "var(--color-bg-4)", color: "var(--color-text-2)" }}
        >
          <Info style={{ color: "var(--color-text-3)" }} />
          {t("验证码在本地离线生成，不会上传到任何服务器。")}
        </div>
      </section>

      <TabBar active="codes" onSelect={onTabSelect} />
    </>
  );
}
