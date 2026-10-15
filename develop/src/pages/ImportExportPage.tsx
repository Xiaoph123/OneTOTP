import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import { api, type BackupView } from "../lib/api";
import { TabBar, type TabKey } from "../components/TabBar";
import { Button, IconButton } from "../components/Button";
import { Switch } from "../components/Controls";
import { useToast } from "../components/Toast";
import { AlertTriangle, ChevronLeft, Download, Info, Upload } from "../components/icons";
import { copyText, formatBytes } from "../lib/utils";
import { useI18n } from "../i18n";

type Mode = "export" | "import";

export function ImportExportPage() {
  const { navigate, goBack, refreshAccounts, settings } = useApp();
  const toast = useToast();
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("export");
  const [exportPassword, setExportPassword] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [importContent, setImportContent] = useState("");
  const [exportAccounts, setExportAccounts] = useState(true);
  const [exportSettings, setExportSettings] = useState(true);
  const [backups, setBackups] = useState<BackupView[]>([]);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadBackups = () => {
    api.listBackups().then(setBackups).catch(() => {});
  };

  useEffect(loadBackups, []);

  const handleExport = async () => {
    setMessage(null);
    setBusy(true);
    try {
      if (!exportAccounts && !exportSettings) throw new Error(t("请至少勾选一项要导出的内容"));
      if (exportPassword.length < 8) throw new Error(t("导出密码长度至少 8 位"));
      const content = await api.exportVault(exportPassword, exportAccounts, exportSettings);
      await copyText(content);
      setExportPassword("");
      setMessage({ type: "ok", text: t("加密备份已复制到剪贴板，请妥善保存") });
      toast.success(t("备份已生成并复制到剪贴板"));
      loadBackups();
    } catch (e) {
      setMessage({ type: "err", text: String(e) });
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 从本地 JSON 文件读取备份内容 */
  const handlePickBackupFile = () => {
    setMessage(null);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json,.txt";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        setImportContent(String(reader.result ?? ""));
        setMessage({ type: "ok", text: t("已读取文件：{name}", { name: file.name }) });
      };
      reader.onerror = () => setMessage({ type: "err", text: t("读取文件失败") });
      reader.readAsText(file);
    };
    input.click();
  };

  const handleImport = async () => {
    setMessage(null);
    setBusy(true);
    try {
      if (!importContent.trim()) throw new Error(t("请先选择文件或粘贴备份内容"));
      const result = await api.importVault(importContent, importPassword);
      await refreshAccounts();
      setImportContent("");
      setImportPassword("");
      const parts: string[] = [];
      if (result.appliedSettings) parts.push(t("已覆盖应用配置"));
      parts.push(t("新增 {n} 个账户（备份共含 {total} 个）", { n: result.addedAccounts, total: result.totalAccountsInBackup }));
      setMessage({ type: "ok", text: t("导入完成：{detail}", { detail: parts.join("，") }) });
      toast.success(t("导入完成：{detail}", { detail: parts.join("，") }));
      loadBackups();
    } catch (e) {
      setMessage({ type: "err", text: String(e) });
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onTabSelect = (key: TabKey) => {
    if (key === "codes") navigate({ name: "codes" });
  };

  return (
    <>
      <header className="app-bar">
        <IconButton label={t("返回")} onClick={() => goBack()}>
          <ChevronLeft />
        </IconButton>
        <span style={{ fontSize: "var(--font-size-h4)", fontWeight: 500 }}>{t("导入导出")}</span>
      </header>

      <section className="app-body">
        <div className="segmented segmented-fill" style={{ width: "100%", marginBottom: 12 }} role="tablist">
          <button className={mode === "export" ? "active" : ""} style={{ flex: 1 }} onClick={() => setMode("export")}>
            {t("导出")}
          </button>
          <button className={mode === "import" ? "active" : ""} style={{ flex: 1 }} onClick={() => setMode("import")}>
            {t("导入")}
          </button>
        </div>

        {mode === "export" ? (
          <div className="panel" style={{ padding: 14 }}>
            <div style={{ fontSize: "var(--font-size-h4)", fontWeight: 500, marginBottom: 4 }}>
              {t("导出加密备份")}
            </div>
            <div style={{ fontSize: "var(--font-size-body)", color: "var(--color-text-3)", marginBottom: 12 }}>
              {t("使用 AES-256 加密全部账户，导入时需要输入同一密码")}
            </div>
            <div className="field">
              <label className="field-label">
                {t("设置导出密码")} <span className="req">*</span>
              </label>
              <input
                className="ui-input"
                type="password"
                value={exportPassword}
                onChange={(e) => setExportPassword(e.target.value)}
                placeholder={t("至少 8 位")}
                autoComplete="new-password"
              />
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label className="field-label">{t("导出内容")}</label>
              <div className="panel" style={{ padding: "2px 14px" }}>
                <div className="action-row" style={{ borderBottom: "1px solid var(--color-border-light)" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
                    <span style={{ fontSize: "var(--font-size-lead)" }}>{t("验证码账户")}</span>
                    <span style={{ fontSize: "var(--font-size-body)", color: "var(--color-text-3)" }}>
                      {t("全部账户及其密钥")}
                    </span>
                  </span>
                  <Switch checked={exportAccounts} onChange={setExportAccounts} label={t("导出验证码账户")} />
                </div>
                <div className="action-row" style={{ borderBottom: "none" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
                    <span style={{ fontSize: "var(--font-size-lead)" }}>{t("应用配置")}</span>
                    <span style={{ fontSize: "var(--font-size-body)", color: "var(--color-text-3)" }}>
                      {t("锁定、显示、备份等设置项")}
                    </span>
                  </span>
                  <Switch checked={exportSettings} onChange={setExportSettings} label={t("导出应用配置")} />
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <Button
                variant="primary"
                block
                disabled={busy}
                icon={<Download style={{ width: 14, height: 14 }} />}
                onClick={handleExport}
              >
                {t("生成并复制备份")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="panel" style={{ padding: 14 }}>
            <div style={{ fontSize: "var(--font-size-h4)", fontWeight: 500, marginBottom: 12 }}>
              {t("导入备份")}
            </div>
            <div className="field">
              <label className="field-label">{t("备份内容")}</label>
              <textarea
                className="ui-textarea"
                rows={5}
                value={importContent}
                onChange={(e) => setImportContent(e.target.value)}
                placeholder={t("选择 JSON 文件，或直接粘贴由 OneTotp 导出的加密备份 JSON")}
              />
            </div>
            <Button
              variant="secondary"
              block
              disabled={busy}
              style={{ marginTop: 10 }}
              icon={<Upload style={{ width: 14, height: 14 }} />}
              onClick={handlePickBackupFile}
            >
              {t("选择 JSON 文件")}
            </Button>
            <div className="field" style={{ marginTop: 14 }}>
              <label className="field-label">{t("备份密码")}</label>
              <input
                className="ui-input"
                type="password"
                value={importPassword}
                onChange={(e) => setImportPassword(e.target.value)}
                placeholder={t("导出时设置的密码")}
                autoComplete="off"
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <Button
                variant="primary"
                block
                disabled={busy}
                icon={<Upload style={{ width: 14, height: 14 }} />}
                onClick={handleImport}
              >
                {t("导入")}
              </Button>
            </div>
          </div>
        )}

        {message ? (
          <div
            className="notice"
            style={{
              marginTop: 12,
              background:
                message.type === "ok" ? "var(--status-yuanliSuccess-2)" : "var(--status-yuanliDanger-2)",
              color:
                message.type === "ok" ? "var(--status-yuanliSuccess-7)" : "var(--status-yuanliDanger-6)",
            }}
          >
            {message.text}
          </div>
        ) : null}

        <div
          className="notice"
          style={{ marginTop: 12, background: "var(--status-yuanliWarning-2)", color: "var(--status-yuanliWarning-6)" }}
        >
          <AlertTriangle style={{ color: "var(--status-yuanliWarning-6)" }} />
          {t("备份包含全部密钥，请仅在可信设备间迁移，导出后及时删除明文副本。")}
        </div>

        <div className="panel" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px" }}>
            <span style={{ fontSize: "var(--font-size-h4)", fontWeight: 500 }}>{t("本地备份记录")}</span>
            {settings ? (
              <span className="tag-soft">{t("保留 {n} 份", { n: settings.backupKeep })}</span>
            ) : null}
          </div>
          {backups.length === 0 ? (
            <div style={{ padding: "0 14px 14px", fontSize: "var(--font-size-body)", color: "var(--color-text-3)" }}>
              {t("暂无备份快照")}
            </div>
          ) : (
            backups.map((b) => (
              <div
                key={b.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "11px 14px",
                  borderTop: "1px solid var(--color-border-light)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "var(--font-size-lead)", overflowWrap: "anywhere" }}>{b.name}</div>
                  <div style={{ fontSize: "var(--font-size-body)", color: "var(--color-text-3)" }}>
                    {formatBytes(b.size)}
                  </div>
                </div>
                <span className="tag-soft" style={{ background: "var(--status-yuanliSuccess-2)", color: "var(--status-yuanliSuccess-7)" }}>
                  {t("已加密")}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="notice" style={{ marginTop: 12, background: "var(--color-bg-4)", color: "var(--color-text-2)" }}>
          <Info style={{ color: "var(--color-text-3)" }} />
          {t("所有数据仅保存在本机应用数据目录，导出不会经过任何服务器。")}
        </div>
      </section>

      <TabBar active="settings" onSelect={onTabSelect} />
    </>
  );
}
