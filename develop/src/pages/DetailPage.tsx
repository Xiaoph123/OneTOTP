import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import { api, type AccountView } from "../lib/api";
import { TabBar } from "../components/TabBar";
import { useToast } from "../components/Toast";
import { Button, IconButton } from "../components/Button";
import { Select } from "../components/Select";
import { ConfirmDialog } from "../components/Dialog";
import { AlertTriangle, ChevronLeft, Edit, Heart } from "../components/icons";
import { formatDateTime, relativeTime, avatarOf } from "../lib/utils";
import { useI18n } from "../i18n";

export function DetailPage({ accountId }: { accountId: string }) {
  const { navigate, goBack, categories, refreshAccounts } = useApp();
  const { t } = useI18n();
  const toast = useToast();  const [account, setAccount] = useState<AccountView | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 是否同时清除历史快照中的该账户（默认开启：删除就该是删除）
  const [purgeBackups, setPurgeBackups] = useState(true);
  const avatar = avatarOf(account?.issuer ?? "");

  useEffect(() => {
    api.getAccountDetail(accountId).then(setAccount).catch(() => {});
  }, [accountId]);

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
    const result = await api.deleteAccount(accountId, purgeBackups);
    await refreshAccounts();
    // 如实回报快照清理结果：无法清理的快照多为旧密钥加密，需要用户手动清理
    if (result.staleBackups > 0) {
      toast.warning(
        t("已删除账户，但有 {n} 份旧快照无法清理（由旧密钥加密），建议在设置中清理全部快照", {
          n: result.staleBackups,
        }),
      );
    } else if (result.purgedBackups > 0) {
      toast.success(t("已删除账户，并从 {n} 份历史快照中清除了它的密钥", { n: result.purgedBackups }));
    }
    navigate({ name: "codes" });
  };

  return (
    <>
      <header className="app-bar">
        <IconButton label={t("返回")} onClick={() => goBack()}>
          <ChevronLeft />
        </IconButton>
        <span className="app-bar-title">{t("账户详情")}</span>
      </header>

      <section className="app-body">
        {account ? (
          <>
            <div className="account-hero">
              <span className={`avatar-sq avatar-lg avatar-tone-${avatar.tone}`}>
                {avatar.text}
              </span>
              <div className="min-w-0 flex-1">
                <div className="row gap-8">
                  <span className="hero-title">
                    {account.issuer}
                  </span>
                  <span className="tag-soft tag-ok">
                    {t("已连接")}
                  </span>
                </div>
                <div className="hero-account">
                  {account.account || t("未设置账户标识")}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={<Edit className="icon-13" />}
                onClick={() => navigate({ name: "edit", accountId })}
              >
                {t("编辑")}
              </Button>
            </div>

            <div className="panel account-info-panel">
              <div className="block-title mb-4">
                {t("账户信息")}
              </div>
              <InfoRow label={t("服务名称")} value={account.issuer} />
              <InfoRow label={t("账户标识")} value={account.account || "—"} />
              <InfoRow
                label={t("类型")}
                value={account.otpType === "hotp" ? t("HOTP（计数器 {n}）", { n: account.counter }) : t("TOTP（基于时间）")}
              />
              <div className="info-row info-row-select">
                <span className="info-row-label">{t("分类")}</span>
                <Select
                  variant="ghost"
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

            <div className="panel panel-clip mt-12">
              <button className="action-row" onClick={handleToggleFavorite}>
                <span className="row gap-8">
                  <Heart className="icon-16" />
                  {account.favorite ? t("取消收藏") : t("加入收藏")}
                </span>
              </button>
              <button
                className="action-row action-row-danger"
                onClick={() => setConfirmDelete(true)}
              >
                <span className="row gap-8">
                  <AlertTriangle className="icon-16" />
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
        description={
          <>
            <div>{t("删除后该账户的验证码将立即失效且无法恢复，请确认已在服务端保留其他登录方式。")}</div>
            {/* 快照与主库共用同一把密钥：不清理的话，删掉的账户仍能从历史快照里解出 */}
            <label className="modal-check">
              <input
                type="checkbox"
                checked={purgeBackups}
                onChange={(e) => setPurgeBackups(e.target.checked)}
              />
              <span>{t("同时从历史快照中清除该账户（推荐）")}</span>
            </label>
            <div className="modal-desc-sub">
              {t("关闭此项后，该账户的密钥可能仍保留在本机历史快照中。")}
            </div>
          </>
        }
        confirmText={t("确认删除")}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />

      <TabBar active="codes" />
    </>
  );
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`info-row${last ? " is-last" : ""}`}>
      <span className="info-row-label">{label}</span>
      <span className="info-row-value">{value}</span>
    </div>
  );
}
