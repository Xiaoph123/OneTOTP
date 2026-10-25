import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../state/AppContext";
import { useToast } from "./Toast";
import { Button, IconButton } from "./Button";
import { Eye, EyeOff, FileText, Info, Spinner } from "./icons";
import { isDesktop } from "../lib/platform";
import {
  checkDroppedFile,
  dragHasBackupFile,
  dragHasFiles,
  firstDroppedBackupFile,
  type BackupRejectReason,
} from "../lib/backupImport";
import { formatBytes } from "../lib/utils";
import { useI18n } from "../i18n";

/** 待导入文件的信息（用于密码弹窗展示） */
interface PendingFile {
  name: string;
  size: number;
  content: string;
}

/**
 * 全局拖拽导入（仅桌面端）。
 *
 * 在任意页面把 OneTOTP 导出的加密备份拖进窗口，即可触发导入。
 * 导入语义是「新增」：按密钥去重，重复账户跳过，不覆盖现有数据。
 *
 * 为什么挂在 App 根部而不是各页面：
 * 拖拽是窗口级行为，用户不会先切到「导入导出」页再拖文件。
 * 挂在根部只需一套事件监听，所有页面自动生效。
 */
export function DropImportOverlay() {
  const { refreshAccounts, refreshCategories, refreshSettings, refreshLockState, phase, route } = useApp();
  const toast = useToast();
  const { t } = useI18n();

  // 遮罩可见性：拖入**备份文件**时显示
  const [dragging, setDragging] = useState(false);
  // 待导入文件与密码弹窗
  const [pending, setPending] = useState<PendingFile | null>(null);
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * dragenter / dragleave 的计数。
   *
   * 为什么需要计数：鼠标从窗口边缘移入子元素时，浏览器会先触发
   * 子元素的 dragleave 再触发父元素的 dragenter。若只用布尔值，
   * 遮罩会在移动过程中反复闪烁。计数归零才真正隐藏。
   */
  const depth = useRef(0);
  /** 是否已有待导入文件（弹窗打开中）：拖拽事件里读不到最新的 state，用 ref 镜像 */
  const pendingRef = useRef(false);
  /** 遮罩是否已经显示过：drop 时 reset() 会先清掉 state，需要 ref 记住「用户看到过提示」 */
  const shownRef = useRef(false);

  const reset = useCallback(() => {
    depth.current = 0;
    shownRef.current = false;
    setDragging(false);
  }, []);

  /** 把拒绝原因翻译成可读提示 */
  const rejectText = useCallback(
    (reason: BackupRejectReason) => {
      switch (reason) {
        case "name":
          return t("仅支持 OneTOTP 导出的备份文件（onetotp-backup-*.json）");
        case "size":
          return t("备份文件超过 10MB，无法导入");
        case "not-json":
          return t("文件内容无法读取，可能已损坏");
        case "not-backup":
          return t("该文件不是有效的 OneTOTP 备份");
      }
    },
    [t],
  );

  useEffect(() => {
    // 移动端没有拖拽概念，不注册监听
    if (!isDesktop()) return;
    // 未解锁时保险库未解密，导入必然失败，直接不响应
    if (phase !== "ready") return;
    // 「导入导出」页自带拖拽区：全局遮罩在这里让出控制权，
    // 否则同一次 drop 会被页面与全局各处理一遍，弹出两个密码框。
    if (route.name === "importExport") return;

    const onDragEnter = (e: DragEvent) => {
      // 非文件拖拽（选中文字、页内元素）交给浏览器默认处理
      if (!dragHasFiles(e)) return;
      // 任何文件都要拦下默认行为：WebView 会把拖入的文件当导航目标，
      // 不拦的话松手后整个页面会被那个文件替换掉。
      e.preventDefault();
      // 但只有「文件名像备份」的才弹遮罩——拖图片、压缩包时不提示，
      // 避免先给用户「可以放」的错觉，松手后再报错。
      if (!dragHasBackupFile(e)) return;
      depth.current += 1;
      shownRef.current = true;
      setDragging(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      if (!dragHasBackupFile(e)) {
        // 明确告诉系统「这里不接受」：光标显示禁止符号，
        // 比什么都不做更清楚，也避免用户误以为松手会导入。
        if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
        return;
      }
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };

    const onDragLeave = (e: DragEvent) => {
      // 拖出窗口时部分环境已拿不到文件信息，此时直接归零，
      // 避免计数卡住导致遮罩一直显示。
      if (!dragHasBackupFile(e)) {
        reset();
        return;
      }
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };

    const onDrop = async (e: DragEvent) => {
      // 与遮罩判定保持一致：取「像备份」的那个文件，而不是 files[0]
      const file = firstDroppedBackupFile(e);
      // 无论是否合法都要 preventDefault，否则浏览器会尝试打开该文件
      e.preventDefault();
      // reset() 会清空 shownRef，先记下「用户是否看到过可放提示」
      const shown = shownRef.current;
      reset();
      if (!file) return;
      // 已在密码弹窗里时，忽略重复拖入，避免覆盖已读入的内容
      if (pendingRef.current) return;

      const result = await checkDroppedFile(file);
      if (!result.ok) {
        // 拖动阶段没弹遮罩（图片、压缩包等非备份文件）→ 松手时静默忽略，
        // 不能先让用户以为「能放」，松手后再甩一句报错。
        if (!shown) return;
        toast.error(rejectText(result.reason ?? "not-backup"));
        return;
      }
      pendingRef.current = true;
      setPending({ name: file.name, size: file.size, content: result.text ?? "" });
      setPassword("");
      setShowPwd(false);
      setError(null);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [phase, reset, rejectText, t, toast, route.name]);

  const closeModal = () => {
    if (busy) return;
    pendingRef.current = false;
    setPending(null);
    setPassword("");
    setShowPwd(false);
    setError(null);
  };

  const doImport = async () => {
    if (!pending) return;
    setError(null);
    setBusy(true);
    try {
      const result = await api.importVault(pending.content, password);
      await refreshAccounts();
      if (result.appliedSettings) {
        await refreshSettings();
        await refreshLockState();
        await refreshCategories().catch(() => {});
      }
      const parts: string[] = [];
      if (result.appliedSettings) parts.push(t("已覆盖应用配置"));
      parts.push(
        t("新增 {n} 个账户（备份共含 {total} 个）", {
          n: result.addedAccounts,
          total: result.totalAccountsInBackup,
        }),
      );
      if (result.skippedDuplicate > 0) {
        parts.push(t("{n} 个账户与现有账户重复已跳过", { n: result.skippedDuplicate }));
      }
      if (result.skippedInvalid > 0) {
        parts.push(t("{n} 个账户数据异常已跳过", { n: result.skippedInvalid }));
      }
      toast.success(t("导入完成：{detail}", { detail: parts.join("，") }));
      pendingRef.current = false;
      setPending(null);
      setPassword("");
      setShowPwd(false);
    } catch (e) {
      // 密码错误等失败原因留在弹窗内，便于直接重试
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!isDesktop()) return null;

  return (
    <>
      {dragging ? (
        <div className="drop-overlay" aria-hidden>
          <div className="drop-card">
            <div className="drop-stack">
              <span className="drop-ghost" />
              <span className="drop-ghost" />
              <span className="drop-main">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path d="M14 3v5h5" />
                </svg>
              </span>
            </div>
            <div className="drop-title">{t("松开以导入配置")}</div>
            <div className="drop-desc">{t("支持 OneTOTP 加密备份文件")}</div>
            <div className="drop-wait">
              <i />
            </div>
          </div>
        </div>
      ) : null}

      {pending ? (
        <div className="modal-overlay" onClick={closeModal} role="presentation">
          <div
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-title">{t("输入备份密码")}</div>
            <div className="modal-desc mt-6">
              {t("该备份已加密，请输入导出时设置的密码。")}
            </div>

            {/* 文件信息卡：拖拽场景下用户往往是从文件夹里随手拖的，
                显示文件名与大小能确认拖的是哪个备份，避免搞混。 */}
            <div className="import-file-card">
              <span className="import-file-icon">
                <FileText className="icon-16" />
              </span>
              <div className="import-file-main">
                <div className="import-file-name" title={pending.name}>
                  {pending.name}
                </div>
                <div className="import-file-meta">
                  {formatBytes(pending.size)} · {t("加密备份")}
                </div>
              </div>
            </div>

            <div className="mt-12 input-with-action">
              <input
                className="ui-input has-action"
                type={showPwd ? "text" : "password"}
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("导出时设置的密码")}
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === "Enter") doImport();
                }}
              />
              <IconButton
                label={showPwd ? t("隐藏密码") : t("显示密码")}
                className="input-action"
                onClick={() => setShowPwd((s) => !s)}
              >
                {showPwd ? <EyeOff className="icon-16" /> : <Eye className="icon-16" />}
              </IconButton>
            </div>

            {/* 空密码备份提示：导出时若开了「允许空密码」，这里可以留空。
                不主动告诉用户的话，他们会以为必须填点什么。 */}
            <div className="import-pwd-hint">
              <Info className="icon-14" />
              {t("若导出时未设置密码，可直接留空后点击导入。")}
            </div>

            {error ? <div className="notice notice-err mt-12">{error}</div> : null}
            {busy ? (
              <div className="notice notice-busy mt-12">
                <Spinner className="ui-spinner" />
                {t("正在导入…")}
              </div>
            ) : null}
            <div className="modal-actions modal-actions-tight">
              <Button block onClick={closeModal} disabled={busy}>
                {t("取消")}
              </Button>
              <Button variant="primary" block disabled={busy} onClick={doImport}>
                {t("导入配置")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
