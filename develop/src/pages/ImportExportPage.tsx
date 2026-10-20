import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import { api, type BackupView } from "../lib/api";
import { TabBar, type TabKey } from "../components/TabBar";
import { Button, IconButton } from "../components/Button";
import { Switch } from "../components/Controls";
import { useToast } from "../components/Toast";
import { AlertTriangle, ChevronLeft, Download, Info, Upload } from "../components/icons";
import { copyText, formatBytes } from "../lib/utils";
import { isDesktop } from "../lib/platform";
import { useI18n } from "../i18n";

type Mode = "export" | "import";

export function ImportExportPage() {
  const { navigate, goBack, refreshAccounts, refreshCategories, refreshSettings, refreshLockState, settings } = useApp();
  const toast = useToast();
  const { t } = useI18n();
  const desktop = isDesktop();
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

  /** 桌面端：把备份内容保存为本地文件（移动端不支持，回退复制） */
  const saveBackupFile = (content: string) => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `onetotp-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 延迟释放，确保下载已开始
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleExport = async () => {
    setMessage(null);
    setBusy(true);
    try {
      if (!exportAccounts && !exportSettings) throw new Error(t("请至少勾选一项要导出的内容"));
      if (exportPassword.length < 8) throw new Error(t("导出密码长度至少 8 位"));
      const content = await api.exportVault(exportPassword, exportAccounts, exportSettings);
      setExportPassword("");
      if (desktop) {
        // 桌面端：优先保存为文件，便于长期归档（剪贴板易被覆盖）
        saveBackupFile(content);
        setMessage({ type: "ok", text: t("加密备份已保存为文件，请妥善保管") });
        toast.success(t("备份文件已生成"));
      } else {
        await copyText(content);
        setMessage({ type: "ok", text: t("加密备份已复制到剪贴板，请妥善保存") });
        toast.success(t("备份已生成并复制到剪贴板"));
      }
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
      // 限制备份文件大小：超大内容会占用大量内存并使界面卡顿
      const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
      if (file.size > MAX_BACKUP_BYTES) {
        setMessage({ type: "err", text: t("备份文件过大（超过 10MB），请确认文件是否正确") });
        return;
      }
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
      // 备份可能包含应用配置：必须同步到内存与 UI，
      // 否则主题 / 语言 / 字体 / 锁定状态要等重启才生效。
      if (result.appliedSettings) {
        await refreshSettings();
        await refreshLockState();
        await refreshCategories().catch(() => {});
      }
      setImportContent("");
      setImportPassword("");
      const parts: string[] = [];
      if (result.appliedSettings) parts.push(t("已覆盖应用配置"));
      parts.push(t("新增 {n} 个账户（备份共含 {total} 个）", { n: result.addedAccounts, total: result.totalAccountsInBackup }));
      if (result.skippedInvalid > 0) {
        parts.push(t("{n} 个账户数据异常已跳过", { n: result.skippedInvalid }));
      }
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
        <span className="app-bar-title">{t("导入导出")}</span>
      </header>

      <section className="app-body">
        <div className="segmented segmented-fill segmented-full mb-12" role="tablist">
          <button className={mode === "export" ? "active" : ""} onClick={() => setMode("export")}>
            {t("导出")}
          </button>
          <button className={mode === "import" ? "active" : ""} onClick={() => setMode("import")}>
            {t("导入")}
          </button>
        </div>

        {mode === "export" ? (
          <div className="panel panel-pad">
            <div className="block-title mb-4">
              {t("导出加密备份")}
            </div>
            <div className="block-desc form-intro">
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
            <div className="field mt-14">
              <label className="field-label">{t("导出内容")}</label>
              <div className="panel panel-tight">
                <div className="action-row action-row-divided">
                  <span className="col gap-2 text-left">
                    <span className="fs-lead">{t("验证码账户")}</span>
                    <span className="fs-body text-3">
                      {t("全部账户及其密钥")}
                    </span>
                  </span>
                  <Switch checked={exportAccounts} onChange={setExportAccounts} label={t("导出验证码账户")} />
                </div>
                <div className="action-row action-row-last">
                  <span className="col gap-2 text-left">
                    <span className="fs-lead">{t("应用配置")}</span>
                    <span className="fs-body text-3">
                      {t("锁定、显示、备份等设置项")}
                    </span>
                  </span>
                  <Switch checked={exportSettings} onChange={setExportSettings} label={t("导出应用配置")} />
                </div>
              </div>
            </div>
            <div className="btn-row mt-14">
              <Button
                variant="primary"
                block
                disabled={busy}
                icon={<Download className="icon-14" />}
                onClick={handleExport}
              >
                {desktop ? t("生成并保存备份") : t("生成并复制备份")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="panel panel-pad">
            <div className="block-title mb-12">
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
              className="mt-10"
              disabled={busy}
              icon={<Upload className="icon-14" />}
              onClick={handlePickBackupFile}
            >
              {t("选择 JSON 文件")}
            </Button>
            <div className="field mt-14">
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
            <div className="btn-row mt-14">
              <Button
                variant="primary"
                block
                disabled={busy}
                icon={<Upload className="icon-14" />}
                onClick={handleImport}
              >
                {t("导入")}
              </Button>
            </div>
          </div>
        )}

        {message ? (
          <div className={`notice mt-12 ${message.type === "ok" ? "notice-ok" : "notice-err"}`}>
            {message.text}
          </div>
        ) : null}

        <div className="notice notice-warn mt-12">
          <AlertTriangle />
          {t("备份包含全部密钥，请仅在可信设备间迁移，导出后及时删除明文副本。")}
        </div>

        <div className="panel mt-12">
          <div className="backup-head">
            <span className="block-title">{t("本地备份记录")}</span>
            {settings ? (
              <span className="tag-soft">{t("保留 {n} 份", { n: settings.backupKeep })}</span>
            ) : null}
          </div>
          {backups.length === 0 ? (
            <div className="backup-empty">
              {t("暂无备份快照")}
            </div>
          ) : (
            backups.map((b) => (
              <div className="backup-item" key={b.name}>
                <div className="min-w-0">
                  <div className="backup-name">{b.name}</div>
                  <div className="backup-size">
                    {formatBytes(b.size)}
                  </div>
                </div>
                <span className="tag-soft tag-ok">
                  {t("已加密")}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="notice notice-soft mt-12">
          <Info className="icon-muted" />
          {t("所有数据仅保存在本机应用数据目录，导出不会经过任何服务器。")}
        </div>
      </section>

      <TabBar active="settings" onSelect={onTabSelect} />
    </>
  );
}
