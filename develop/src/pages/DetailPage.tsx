import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import { api, type AccountView } from "../lib/api";
import { TabBar, type TabKey } from "../components/TabBar";
import { CountdownRing } from "../components/Controls";
import { Button, IconButton } from "../components/Button";
import { ConfirmDialog } from "../components/Dialog";
import { AlertTriangle, ChevronLeft, Copy, Edit, Heart } from "../components/icons";
import { copyText, formatDateTime, formatCode, relativeTime } from "../lib/utils";
import { hideWindow } from "../state/useAutoLock";

export function DetailPage({ accountId }: { accountId: string }) {
  const { navigate, codes, settings, refreshAccounts } = useApp();
  const [account, setAccount] = useState<AccountView | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    api.getAccountDetail(accountId).then(setAccount).catch(() => {});
  }, [accountId]);

  const code = codes[accountId];

  const onTabSelect = (key: TabKey) => {
    if (key === "settings") navigate({ name: "settings" });
    else navigate({ name: "codes" });
  };

  const handleCopy = async () => {
    if (!code) return;
    await copyText(code.code);
    await api.markUsed(accountId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
    if (settings?.autoHideAfterCopy) hideWindow();
  };

  const handleToggleFavorite = async () => {
    await api.toggleFavorite(accountId);
    await refreshAccounts();
    setAccount((prev) => (prev ? { ...prev, favorite: !prev.favorite } : prev));
  };

  const handleDelete = async () => {
    await api.deleteAccount(accountId);
    await refreshAccounts();
    navigate({ name: "codes" });
  };

  return (
    <>
      <header className="app-bar">
        <IconButton label="返回" onClick={() => navigate({ name: "codes" })}>
          <ChevronLeft />
        </IconButton>
        <span style={{ fontSize: "var(--font-size-h4)", fontWeight: 500 }}>账户详情</span>
      </header>

      <section className="app-body">
        {account ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <span
                className="avatar-sq"
                style={{
                  width: 40,
                  height: 40,
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
                    已连接
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
                  {account.account || "未设置账户标识"}
                </div>
              </div>
              <IconButton label="编辑" onClick={() => navigate({ name: "edit", accountId })}>
                <Edit />
              </IconButton>
            </div>

            <div className="panel" style={{ padding: 16 }}>
              <div className="flex-row-between">
                <div style={{ minWidth: 0 }}>
                  <div className="otp-codelabel">{copied ? "已复制到剪贴板" : "当前验证码"}</div>
                  <div className="otp-code" style={{ fontSize: 40 }}>
                    {code ? formatCode(code.code, settings?.codeGrouping ?? true) : "— — —"}
                  </div>
                </div>
                {account.otpType === "hotp" ? (
                  <span className="tag-soft" style={{ fontFamily: "var(--font-mono)", alignSelf: "center" }}>
                    计数器 #{account.counter}
                  </span>
                ) : (
                  <CountdownRing
                    remaining={code?.remaining ?? account.period}
                    period={account.period}
                    danger={(settings?.expiryHighlight ?? true) && (code?.remaining ?? 99) <= 5}
                  />
                )}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <Button variant="primary" block icon={<Copy style={{ width: 14, height: 14 }} />} onClick={handleCopy}>
                  复制验证码
                </Button>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                {account.otpType === "hotp" ? <span className="tag-soft">HOTP</span> : null}
                <span className="tag-soft">{account.algorithm}</span>
                <span className="tag-soft">{account.digits} 位</span>
                {account.otpType === "hotp" ? null : (
                  <span className="tag-soft">{account.period} 秒</span>
                )}
              </div>
            </div>

            <div className="panel" style={{ marginTop: 12, padding: "12px 16px" }}>
              <div style={{ fontSize: "var(--font-size-h4)", fontWeight: 500, marginBottom: 4 }}>
                账户信息
              </div>
              <InfoRow label="服务名称" value={account.issuer} />
              <InfoRow label="账户标识" value={account.account || "—"} />
              <InfoRow
                label="类型"
                value={account.otpType === "hotp" ? `HOTP（计数器 ${account.counter}）` : "TOTP（基于时间）"}
              />
              <InfoRow label="分类" value={account.category || "未分类"} />
              <InfoRow label="创建时间" value={formatDateTime(account.createdAt)} />
              <InfoRow label="最近使用" value={relativeTime(account.lastUsedAt)} last />
            </div>

            <div className="panel" style={{ marginTop: 12, overflow: "hidden" }}>
              <button className="action-row" onClick={handleToggleFavorite}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Heart style={{ width: 16, height: 16 }} />
                  {account.favorite ? "取消收藏" : "加入收藏"}
                </span>
              </button>
              <button
                className="action-row"
                style={{ color: "var(--color-danger)", borderBottom: "none" }}
                onClick={() => setConfirmDelete(true)}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertTriangle style={{ width: 16, height: 16 }} />
                  删除账户
                </span>
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <span className="empty-desc">正在加载账户信息…</span>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmDelete}
        danger
        title="删除账户"
        description="删除后该账户的验证码将立即失效且无法恢复，请确认已在服务端保留其他登录方式。"
        confirmText="确认删除"
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
