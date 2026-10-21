import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import { api, type BackupView } from "../lib/api";
import { TabBar } from "../components/TabBar";
import { Button, IconButton } from "../components/Button";
import { Switch } from "../components/Controls";
import { useToast } from "../components/Toast";
import { AlertTriangle, ChevronLeft, Download, Info, Spinner, Upload } from "../components/icons";
import { formatBytes } from "../lib/utils";
import { useI18n } from "../i18n";

type Mode = "export" | "import";

/** 生成带时间戳的默认文件名 */
function defaultFileName(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `onetotp-backup-${stamp}.json`;
}

/**
 * 粗校验：内容是否像 OneTOTP 备份文件。
 * 备份是 `VaultFile` 的 JSON，必然含 ciphertext / salt / nonce 三个字段；
 * 只做结构判断，真正的解密与校验仍在后端完成。
 */
function isBackupLike(text: string): boolean {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    return (
      !!obj &&
      typeof obj === "object" &&
      typeof obj.ciphertext === "string" &&
      typeof obj.salt === "string" &&
      typeof obj.nonce === "string"
    );
  } catch {
    return false;
  }
}

export function ImportExportPage() {
  const { goBack, refreshAccounts, refreshCategories, refreshSettings, refreshLockState, settings } = useApp();
  const toast = useToast();
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("export");
  const [importContent, setImportContent] = useState("");
  const [exportAccounts, setExportAccounts] = useState(true);
  const [exportSettings, setExportSettings] = useState(true);
  const [backups, setBackups] = useState<BackupView[]>([]);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // 导出密码弹窗：点「导出配置」时先收集密码，确认后才调起文件管理器选位置
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdInput, setPwdInput] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [pwdError, setPwdError] = useState<string | null>(null);
  // 导入密码弹窗：选完文件并读取成功后，再收集备份密码
  const [impOpen, setImpOpen] = useState(false);
  const [impPwd, setImpPwd] = useState("");
  const [impError, setImpError] = useState<string | null>(null);
  // 允许空密码（设置项）：开启后导出/导入弹窗可跳过密码
  const allowEmptyPwd = settings?.allowEmptyBackupPassword ?? false;

  const loadBackups = () => {
    api.listBackups().then(setBackups).catch(() => {});
  };

  useEffect(loadBackups, []);

  /** 打开密码弹窗前先做内容校验，避免用户输完密码才发现没勾选内容 */
  const openPasswordDialog = () => {
    setMessage(null);
    if (!exportAccounts && !exportSettings) {
      setMessage({ type: "err", text: t("请至少勾选一项要导出的内容") });
      return;
    }
    setPwdInput("");
    setPwdConfirm("");
    setPwdError(null);
    setPwdOpen(true);
  };

  /**
   * 调起系统文件管理器选择导出位置。
   * 桌面端返回绝对路径，Android 返回 `content://` URI，两者都由后端统一写入。
   * 返回 null 表示用户取消。
   */
  const pickExportPath = async (): Promise<string | null> => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      title: t("保存加密备份"),
      defaultPath: defaultFileName(),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    return path || null;
  };

  /**
   * 弹窗确认后的完整导出流程：
   * 1) 校验密码 → 2) 调起文件管理器选位置 → 3) 生成并写入
   */
  const confirmExport = async () => {
    setPwdError(null);
    // 允许空密码时跳过密码校验（设置项已在后端再次把关）
    if (!allowEmptyPwd) {
      if (pwdInput.length < 8) {
        setPwdError(t("导出密码长度至少 8 位"));
        return;
      }
      if (pwdInput !== pwdConfirm) {
        setPwdError(t("两次输入的密码不一致"));
        return;
      }
    }

    setBusy(true);
    try {
      // 关键顺序：密码确认后才选路径；用户取消则不生成任何内容
      const path = await pickExportPath();
      if (!path) {
        setPwdOpen(false);
        setMessage({ type: "err", text: t("已取消保存") });
        return;
      }
      const content = await api.exportVault(pwdInput, exportAccounts, exportSettings);
      await api.writeBackupFile(path, content);
      setMessage({ type: "ok", text: t("加密备份已保存为文件，请妥善保管") });
      toast.success(t("备份文件已生成"));
      loadBackups();
      setPwdOpen(false);
      setPwdInput("");
      setPwdConfirm("");
    } catch (e) {
      setPwdError(String(e));
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 调起系统文件管理器选择备份文件，读取成功后弹出密码框。
   *
   * 顺序刻意是「先选文件、后输密码」：用户先确认要导入哪个文件，
   * 再输入该文件的密码，避免先输密码却选错文件的返工。
   */
  const pickAndReadBackup = async () => {
    setMessage(null);
    let path: string | null = null;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        title: t("选择备份文件"),
        multiple: false,
        directory: false,
        filters: [{ name: "JSON", extensions: ["json", "txt"] }],
      });
      if (typeof picked !== "string") return;
      path = picked;
    } catch (e) {
      setMessage({ type: "err", text: t("选择文件失败：{msg}", { msg: String(e) }) });
      return;
    }

    setBusy(true);
    try {
      const text = await api.readBackupFile(path);
      if (!isBackupLike(text)) {
        setMessage({ type: "err", text: t("所选文件不是有效的 OneTOTP 备份文件") });
        return;
      }
      setImportContent(text);
      setImpPwd("");
      setImpError(null);
      setImpOpen(true);
    } catch (e) {
      setMessage({ type: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    setImpError(null);
    if (!allowEmptyPwd && !impPwd) {
      setImpError(t("请输入备份密码"));
      return;
    }
    setMessage(null);
    setBusy(true);
    try {
      const result = await api.importVault(importContent, impPwd);
      await refreshAccounts();
      // 备份可能包含应用配置：必须同步到内存与 UI，
      // 否则主题 / 语言 / 字体 / 锁定状态要等重启才生效。
      if (result.appliedSettings) {
        await refreshSettings();
        await refreshLockState();
        await refreshCategories().catch(() => {});
      }
      setImportContent("");
      setImpPwd("");
      setImpOpen(false);
      const parts: string[] = [];
      if (result.appliedSettings) parts.push(t("已覆盖应用配置"));
      parts.push(t("新增 {n} 个账户（备份共含 {total} 个）", { n: result.addedAccounts, total: result.totalAccountsInBackup }));
      if (result.skippedInvalid > 0) {
        parts.push(t("{n} 个账户数据异常已跳过", { n: result.skippedInvalid }));
      }
      if (result.skippedDuplicate > 0) {
        parts.push(t("{n} 个账户与现有账户重复已跳过", { n: result.skippedDuplicate }));
      }
      setMessage({ type: "ok", text: t("导入完成：{detail}", { detail: parts.join("，") }) });
      toast.success(t("导入完成：{detail}", { detail: parts.join("，") }));
      loadBackups();
    } catch (e) {
      // 密码错误等失败原因留在弹窗内，便于用户直接重试
      setImpError(String(e));
    } finally {
      setBusy(false);
    }
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
            <div className="field mt-14">
              <label className="field-label">{t("导出内容")}</label>
              {/* 不再套一层带边框的面板：与上方标题同属一个卡片，避免重复描边 */}
              <div className="export-content">
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
                onClick={openPasswordDialog}
              >
                {t("导出配置")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="panel panel-pad">
            <div className="block-title mb-4">
              {t("导入备份")}
            </div>
            <div className="block-desc form-intro">
              {t("选择备份文件后输入该文件的密码，账户与配置将合并到本机")}
            </div>
            <div className="btn-row mt-14">
              <Button
                variant="primary"
                block
                disabled={busy}
                icon={<Upload className="icon-14" />}
                onClick={pickAndReadBackup}
              >
                {t("导入配置")}
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
          {t("备份文件已加密，但仍可被密码解开；请仅在可信设备间迁移，并妥善保管文件与密码。")}
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

      <TabBar active="settings" />

      {/* 导出密码弹窗：先输入并确认密码，确认后才进入选路径 → 生成 → 写盘 */}
      {pwdOpen ? (
        <div
          className="modal-overlay"
          onClick={() => !busy && setPwdOpen(false)}
          role="presentation"
        >
          <div
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-title">{t("设置导出密码")}</div>
            <div className="modal-desc mt-6">
              {allowEmptyPwd
                ? t("可留空直接导出（不推荐），或设置密码保护该备份文件。")
                : t("该密码用于加密备份文件，导入时必须输入同一密码，请务必记住。")}
            </div>
            <div className="col-gap-12 mt-16">
              <input
                className="ui-input"
                type="password"
                autoFocus
                value={pwdInput}
                onChange={(e) => setPwdInput(e.target.value)}
                placeholder={allowEmptyPwd ? t("可留空") : t("至少 8 位")}
                autoComplete="new-password"
              />
              <input
                className="ui-input"
                type="password"
                value={pwdConfirm}
                onChange={(e) => setPwdConfirm(e.target.value)}
                placeholder={t("再次输入密码")}
                autoComplete="new-password"
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmExport();
                }}
              />
            </div>
            {allowEmptyPwd && !pwdInput ? (
              <div className="s-hint-warn mt-12">
                <AlertTriangle className="icon-14" />
                {t("空密码备份仅用公开口令加密，任何人拿到文件都可解密。")}
              </div>
            ) : null}
            {pwdError ? (
              <div className="notice notice-err mt-12">{pwdError}</div>
            ) : null}
            {busy ? (
              <div className="notice notice-busy mt-12">
                <Spinner className="ui-spinner" />
                {t("正在生成备份…")}
              </div>
            ) : null}
            <div className="modal-actions modal-actions-tight">
              <Button block onClick={() => setPwdOpen(false)} disabled={busy}>
                {t("取消")}
              </Button>
              <Button variant="primary" block disabled={busy} onClick={confirmExport}>
                {t("导出配置")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 导入密码弹窗：输密码 → 解密导入；失败原因留在弹窗内便于重试 */}
      {impOpen ? (
        <div
          className="modal-overlay"
          onClick={() => !busy && setImpOpen(false)}
          role="presentation"
        >
          <div
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-title">{t("输入备份密码")}</div>
            <div className="modal-desc mt-6">
              {allowEmptyPwd
                ? t("输入该备份导出时设置的密码；若导出时未设密码，可直接留空。")
                : t("请输入该备份导出时设置的密码，用于解密备份内容。")}
            </div>
            <div className="col-gap-12 mt-16">
              <input
                className="ui-input"
                type="password"
                autoFocus
                value={impPwd}
                onChange={(e) => setImpPwd(e.target.value)}
                placeholder={allowEmptyPwd ? t("可留空") : t("导出时设置的密码")}
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleImport();
                }}
              />
            </div>
            {impError ? (
              <div className="notice notice-err mt-12">{impError}</div>
            ) : null}
            {busy ? (
              <div className="notice notice-busy mt-12">
                <Spinner className="ui-spinner" />
                {t("正在导入…")}
              </div>
            ) : null}
            <div className="modal-actions modal-actions-tight">
              <Button block onClick={() => setImpOpen(false)} disabled={busy}>
                {t("取消")}
              </Button>
              <Button variant="primary" block disabled={busy} onClick={handleImport}>
                {t("导入配置")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
