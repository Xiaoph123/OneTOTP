import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import { api, type AccountView } from "../lib/api";
import { TabBar, type TabKey } from "../components/TabBar";
import { Button, IconButton } from "../components/Button";
import { Select } from "../components/Select";
import { ConfirmDialog } from "../components/Dialog";
import { AlertTriangle, ChevronLeft, Edit, Heart } from "../components/icons";
import { formatDateTime, relativeTime } from "../lib/utils";
import { useI18n } from "../i18n";

export function DetailPage({ accountId }: { accountId: string }) {
  const { navigate, goBack, categories, refreshAccounts } = useApp();
  const { t } = useI18n();
  const [account, setAccount] = useState<AccountView | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    api.getAccountDetail(accountId).then(setAccount).catch(() => {});
  }, [accountId]);

  const onTabSelect = (key: TabKey) => {
    if (key === "settings") navigate({ name: "settings" });
    else navigate({ name: "codes" });
  };

  const handleToggleFavorite = async () => {
    await api.toggleFavorite(accountId);
    await refreshAccounts();
    setAccount((prev) => (prev ? { ...prev, favorite: !prev.favorite } : prev));
  };

  /** 在详情页直接切换分类归属 */
  const handleChangeCategory = async (categoryId: string) => {
    const updated = await api.setAccountCategory(accountId, categoryId);
    setAccount(updated);
    await refreshAccounts();
  };

  const handleDelete = async () => {
    await api.deleteAccount(accountId);
    await refreshAccounts();
    navigate({ name: "codes" });
  };

  return (
    <>
      <header className="app-bar">
        <IconButton label={t("返回")} onClick={() => goBack()}>
          <ChevronLeft />
        </IconButton>
        <span style={{ fontSize: "var(--font-size-h4)", fontWeight: 500 }}>{t("账户详情")}</span>
      </header>

      <section className="app-body">
        {account ? (
          <>
            <div className="account-hero">
              <span
                className="avatar-sq"
                style={{
                  width: 44,
                  height: 44,
                  background: "var(--color-text-1)",
                  color: "var(--color-bg-1)",
                  fontSize: "var(--font-size-h4)",
                }}
              >
                {account.issuer.slice(0, 2).toUpperCase()}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: "var(--font-size-h3)", fontWeight: 500 }}>
                    {account.issuer}
                  </span>
                  <span
                    className="tag-soft"
                    style={{
                      background: "var(--status-yuanliSuccess-2)",
                      color: "var(--status-yuanliSuccess-7)",
                    }}
                  >
                    {t("已连接")}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "var(--font-size-body)",
                    color: "var(--color-text-3)",
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {account.account || t("未设置账户标识")}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={<Edit style={{ width: 13, height: 13 }} />}
                onClick={() => navigate({ name: "edit", accountId })}
              >
                {t("编辑")}
              </Button>
            </div>

            <div className="panel account-info-panel">
              <div style={{ fontSize: "var(--font-size-h4)", fontWeight: 500, marginBottom: 4 }}>
                {t("账户信息")}
              </div>
              <InfoRow label={t("服务名称")} value={account.issuer} />
              <InfoRow label={t("账户标识")} value={account.account || "—"} />
              <InfoRow
                label={t("类型")}
                value={account.otpType === "hotp" ? t("HOTP（计数器 {n}）", { n: account.counter }) : t("TOTP（基于时间）")}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "8px 0",
                  borderBottom: "1px solid var(--color-border-light)",
                  fontSize: "var(--font-size-lead)",
                }}
              >
                <span style={{ color: "var(--color-text-3)", flexShrink: 0 }}>{t("分类")}</span>
                <Select
                  width={140}
                  size="small"
                  value={account.categoryId}
                  onChange={handleChangeCategory}
                  options={[
                    { value: "", label: t("未分类") },
                    ...categories.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </div>
              <InfoRow label={t("创建时间")} value={formatDateTime(account.createdAt)} />
              <InfoRow label={t("最近使用")} value={relativeTime(account.lastUsedAt, t)} last />
            </div>

            <div className="panel" style={{ marginTop: 12, overflow: "hidden" }}>
              <button className="action-row" onClick={handleToggleFavorite}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Heart style={{ width: 16, height: 16 }} />
                  {account.favorite ? t("取消收藏") : t("加入收藏")}
                </span>
              </button>
              <button
                className="action-row"
                style={{ color: "var(--color-danger)", borderBottom: "none" }}
                onClick={() => setConfirmDelete(true)}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertTriangle style={{ width: 16, height: 16 }} />
                  {t("删除账户")}
                </span>
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <span className="empty-desc">{t("正在加载账户信息…")}</span>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmDelete}
        danger
        title={t("删除账户")}
        description={t("删除后该账户的验证码将立即失效且无法恢复，请确认已在服务端保留其他登录方式。")}
        confirmText={t("确认删除")}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />

      <TabBar active="codes" onSelect={onTabSelect} />
    </>
  );
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "11px 0",
        borderBottom: last ? "none" : "1px solid var(--color-border-light)",
        fontSize: "var(--font-size-lead)",
      }}
    >
      <span style={{ color: "var(--color-text-3)", flexShrink: 0 }}>{label}</span>
      <span style={{ color: "var(--color-text-1)", textAlign: "right", overflowWrap: "anywhere" }}>
        {value}
      </span>
    </div>
  );
}
