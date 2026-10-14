import { useMemo, useState } from "react";
import { useApp } from "../state/AppContext";
import { CodeCard } from "../components/CodeCard";
import { TabBar, type TabKey } from "../components/TabBar";
import { IconButton } from "../components/Button";
import { Grid, Info, Plus, Search } from "../components/icons";

type Filter2 = "all" | "favorite" | "recent";

export function CodesPage() {
  const { accounts, codes, settings, navigate } = useApp();
  const [filter, setFilter] = useState<Filter2>("all");
  const [query, setQuery] = useState("");

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
        (a) =>
          a.issuer.toLowerCase().includes(q) || a.account.toLowerCase().includes(q),
      );
    }
    return list;
  }, [accounts, filter, query]);

  const onTabSelect = (key: TabKey) => {
    if (key === "settings") navigate({ name: "settings" });
  };

  const isEmpty = visible.length === 0;

  return (
    <>
      <section className="app-body">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flex: 1,
              height: 32,
              padding: "0 12px",
              background: "var(--color-bg-4)",
              borderRadius: "var(--radius-sm)",
              boxShadow: "inset 0 0 0 1px var(--color-border-light)",
            }}
          >
            <Search style={{ width: 14, height: 14, color: "var(--color-text-3)", flexShrink: 0 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索账户或服务"
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
          <IconButton
            label="添加账户"
            className="icon-btn-solid"
            onClick={() => navigate({ name: "add" })}
          >
            <Plus />
          </IconButton>
        </div>

        <div className="segmented" style={{ marginBottom: 12 }} role="tablist">
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
            全部
          </button>
          <button
            className={filter === "favorite" ? "active" : ""}
            onClick={() => setFilter("favorite")}
          >
            收藏
          </button>
          <button
            className={filter === "recent" ? "active" : ""}
            onClick={() => setFilter("recent")}
          >
            最近
          </button>
        </div>

        {isEmpty ? (
          <div className="empty-state">
            <span className="empty-icon">
              <Grid />
            </span>
            <span className="empty-title">
              {query ? "没有匹配的账户" : "还没有添加任何账户"}
            </span>
            <span className="empty-desc">
              {query ? "换个关键词试试" : "扫描二维码或手动输入密钥即可开始"}
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
                  borderRadius: "var(--radius-sm)",
                  background: "var(--color-primary)",
                  color: "var(--color-white)",
                  fontSize: "var(--font-size-lead)",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                添加账户
              </button>
            ) : null}
          </div>
        ) : (
          <div className="otp-list">
            {visible.map((account) => (
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
            ))}
          </div>
        )}

        <div className="notice" style={{ marginTop: 14, background: "var(--color-bg-4)", color: "var(--color-text-2)" }}>
          <Info style={{ color: "var(--color-text-3)" }} />
          验证码在本地离线生成，不会上传到任何服务器。
        </div>
      </section>

      <TabBar active="codes" onSelect={onTabSelect} />
    </>
  );
}
