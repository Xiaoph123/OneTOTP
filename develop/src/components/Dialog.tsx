import type { ReactNode } from "react";
import { AlertTriangle } from "./icons";
import { Button } from "./Button";
import { useI18n } from "../i18n";

interface Props {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 居中弹窗，用于破坏性操作的二次确认 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmText,
  cancelText,
  danger,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onCancel} role="presentation">
      <div
        className="modal-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-body">
          {danger ? (
            <span className="modal-icon is-danger">
              <AlertTriangle className="icon-18" />
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="modal-title">{title}</div>
            {description ? <div className="modal-desc">{description}</div> : null}
          </div>
        </div>
        <div className="modal-actions">
          <Button block onClick={onCancel}>
            {cancelText ?? t("取消")}
          </Button>
          <Button variant={danger ? "danger" : "primary"} block onClick={onConfirm}>
            {confirmText ?? t("确认")}
          </Button>
        </div>
      </div>
    </div>
  );
}
