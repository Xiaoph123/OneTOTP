import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { api, type BackupView } from "../lib/api";
import { TabBar } from "../components/TabBar";
import { Button, IconButton } from "../components/Button";
import { Switch } from "../components/Controls";
import { useToast } from "../components/Toast";
import { AlertTriangle, ChevronLeft, Download, Info, Spinner, Upload } from "../components/icons";
import { formatBytes } from "../lib/utils";
import { isDesktop } from "../lib/platform";
import {
  checkDroppedFile,
  dragHasFiles,
  dragRejectReason,
  firstDroppedBackupFile,
  isBackupLike,
  rejectReasonText,
  rejectReasonTitle,
  type BackupRejectReason,
} from "../lib/backupImport";
import { useI18n } from "../i18n";

type Mode = "export" | "import";

/** 生成带时间戳的默认文件名 */
function defaultFileName(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `onetotp-backup-${stamp}.json`;
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
  // 拖拽区高亮：文件拖到本区域上方时置为 true
  const [dragActive, setDragActive] = useState(false);
  // 拖拽阶段的拒绝原因；null 表示可接受。用于把拖拽区切成「拒绝态」
  const [dragReject, setDragReject] = useState<BackupRejectReason | null>(null);
  // 拒绝原因的 ref 镜像：drop 时 state 可能尚未刷新，读 ref 更可靠
  const dragRejectRef = useRef<BackupRejectReason | null>(null);
  // 拖拽区内的 dragenter/dragleave 计数，避免子元素间移动时闪烁
  const dragDepth = useRef(0);

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
   *
   * 桌面端与移动端共用本函数：移动端没有拖拽，这是唯一的导入入口，
   * 因此校验与提示必须同样明确——不能因为「用户是主动选的」就放宽。
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
      // 体积校验：后端已限制 10MB，这里再判一次是为了给出与拖拽一致的文案
      if (text.length > 10 * 1024 * 1024) {
        setMessage({ type: "err", text: t(rejectReasonText("size")) });
        return;
      }
      if (!isBackupLike(text)) {
        // 内容不像备份：可能是别家的 JSON、被改坏的文件、或根本不是备份。
        // 用与拖拽完全相同的文案，避免同一错误在不同入口说法不一。
        setMessage({ type: "err", text: t(rejectReasonText("not-backup")) });
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

  /**
   * 拖拽区放下文件：读取内容后弹出密码框。
   *
   * 与「选择文件」走同一条后续流程（setImportContent + 开弹窗），
   * 只是文件来源不同：一个来自系统文件管理器，一个来自拖拽。
   */
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    // 先记下拖拽过程中的判定结果，reset 后 state 会被清掉
    const dragReason = dragRejectRef.current;
    dragDepth.current = 0;
    dragRejectRef.current = null;
    setDragActive(false);
    setDragReject(null);
    setMessage(null);

    // 拖拽阶段已判定不可接受：给出明确提示，不再读文件内容
    if (dragReason) {
      setMessage({ type: "err", text: t(rejectReasonText(dragReason)) });
      return;
    }

    const file = firstDroppedBackupFile(e.nativeEvent);
    if (!file) return;

    setBusy(true);
    try {
      // 与全局拖拽共用同一套校验：文件名 -> 体积 -> 内容结构
      const result = await checkDroppedFile(file);
      if (!result.ok) {
        setMessage({ type: "err", text: t(rejectReasonText(result.reason ?? "not-backup")) });
        return;
      }
      setImportContent(result.text ?? "");
      setImpPwd("");
      setImpError(null);
      setImpOpen(true);
    } catch (err) {
      setMessage({ type: "err", text: String(err) });
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
              {isDesktop()
                ? t("把备份文件拖到下方区域，或点击按钮选择文件")
                : t("点击下方按钮选择 OneTOTP 导出的备份文件")}
            </div>
            {/* 拖拽区在上、按钮在下：拖拽是更快的路径，放在视觉首位；
                点击选择作为兜底，用「或」分隔明确两者是并列关系。
                移动端没有拖拽概念，整块不渲染。 */}
            {isDesktop() ? (
              <div
                className={`dropzone${dragActive ? " is-active" : ""}${dragReject ? " is-reject" : ""}`}
                onDragEnter={(e) => {
                  if (!dragHasFiles(e.nativeEvent)) return;
                  // 任何文件都拦默认行为，否则 WebView 会打开该文件
                  e.preventDefault();
                  // 无论可接受与否都高亮：拖错文件时必须给出明确反馈
                  const reason = dragRejectReason(e.nativeEvent);
                  dragDepth.current += 1;
                  dragRejectRef.current = reason;
                  setDragReject(reason);
                  setDragActive(true);
                }}
                onDragOver={(e) => {
                  if (!dragHasFiles(e.nativeEvent)) return;
                  e.preventDefault();
                  const reason = dragRejectReason(e.nativeEvent);
                  // 光标形态与拖拽区状态保持一致
                  if (e.dataTransfer) e.dataTransfer.dropEffect = reason === null ? "copy" : "none";
                  if (reason !== dragRejectRef.current) {
                    dragRejectRef.current = reason;
                    setDragReject(reason);
                  }
                }}
                onDragLeave={(e) => {
                  if (!dragHasFiles(e.nativeEvent)) {
                    dragDepth.current = 0;
                    dragRejectRef.current = null;
                    setDragActive(false);
                    setDragReject(null);
                    return;
                  }
                  dragDepth.current = Math.max(0, dragDepth.current - 1);
                  if (dragDepth.current === 0) {
                    dragRejectRef.current = null;
                    setDragActive(false);
                    setDragReject(null);
                  }
                }}
                onDrop={handleDrop}
              >
                <span className="dropzone-icon">
                  {dragReject ? <AlertTriangle className="icon-22" /> : <Upload className="icon-22" />}
                </span>
                <span className="dropzone-title">
                  {dragReject ? t(rejectReasonTitle(dragReject)) : t("拖拽备份文件到此处")}
                </span>
                <span className="dropzone-desc">
                  {dragReject
                    ? t(rejectReasonText(dragReject))
                    : t("仅支持 OneTOTP 导出的备份文件，重复账户自动跳过")}
                </span>
              </div>
            ) : null}
            {isDesktop() ? <div className="dropzone-or">{t("或")}</div> : null}
            <div className="btn-row mt-14">
              <Button
                variant="primary"
                block
                disabled={busy}
                icon={<Upload className="icon-14" />}
                onClick={pickAndReadBackup}
              >
                {t("选择文件导入")}
              </Button>
            </div>
            {/* 移动端没有拖拽区，格式说明只能放在按钮下方。
                桌面端已由拖拽区的 desc 承担，这里不重复。 */}
            {!isDesktop() ? (
              <div className="import-format-hint">
                <Info className="icon-14" />
                {t("仅支持 OneTOTP 导出的备份文件（onetotp-backup-*.json）")}
              </div>
            ) : null}
          </div>
        )}

        {message ? (
          <div
            className={`notice mt-12 ${message.type === "ok" ? "notice-ok" : "notice-err"}`}
            role={message.type === "err" ? "alert" : "status"}
          >
            {message.type === "err" ? <AlertTriangle /> : <Info />}
            <span className="notice-text">{message.text}</span>
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
