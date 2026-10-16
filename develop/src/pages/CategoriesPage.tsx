import { useState } from "react";
import { useApp } from "../state/AppContext";
import { api, type Category } from "../lib/api";
import { TabBar, type TabKey } from "../components/TabBar";
import { Button, IconButton } from "../components/Button";
import { useToast } from "../components/Toast";
import { ChevronLeft, Edit, Plus, Trash } from "../components/icons";
import { useI18n } from "../i18n";

/** 源力色板，供快速选择分类颜色 */
const PRESET_COLORS = ["#1664FF", "#2A814B", "#BD7E00", "#D7312A", "#6E4C9F", "#24758E"];

export function CategoriesPage() {
  const { navigate, goBack, categories, refreshCategories, refreshAccounts } = useApp();
  const toast = useToast();
  const { t } = useI18n();

  // 编辑/新建表单状态：editingId 为空表示新建
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [busy, setBusy] = useState(false);
  // 待删除分类
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setColor(PRESET_COLORS[0]);
  };

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setName(cat.name);
    setColor(cat.color);
  };

  const submit = async () => {
    if (!name.trim()) {
      toast.error(t("请输入分类名称"));
      return;
    }
    setBusy(true);
    try {
      if (editingId) {
        await api.updateCategory(editingId, name.trim(), color);
        toast.success(t("分类已更新"));
      } else {
        await api.addCategory(name.trim(), color);
        toast.success(t("分类已创建"));
      }
      await refreshCategories();
      await refreshAccounts();
      resetForm();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 删除分类：deleteAccounts 决定其中账户一并删除还是移到未分类 */
  const confirmDelete = async (deleteAccounts: boolean) => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      const affected = await api.deleteCategory(pendingDelete.id, deleteAccounts);
      toast.success(
        deleteAccounts
          ? t("已删除分类及其 {n} 个账户", { n: affected })
          : t("已删除分类，{n} 个账户已移到未分类", { n: affected }),
      );
      await refreshCategories();
      await refreshAccounts();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  };

  const move = async (index: number, delta: number) => {
    const next = [...categories];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await api.reorderCategories(next.map((c) => c.id));
      await refreshCategories();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const onTabSelect = (key: TabKey) => {
    if (key === "codes") navigate({ name: "codes" });
    if (key === "settings") navigate({ name: "settings" });
  };

  return (
    <>
      <header className="app-bar">
        <IconButton label={t("返回")} onClick={() => goBack()}>
          <ChevronLeft />
        </IconButton>
        <span style={{ fontSize: "var(--font-size-h4)", fontWeight: 500 }}>{t("分类管理")}</span>
      </header>

      <section className="app-body">
        {/* 新建 / 编辑表单 */}
        <div className="panel" style={{ padding: 14 }}>
          <div style={{ fontSize: "var(--font-size-h4)", fontWeight: 500, marginBottom: 12 }}>
            {editingId ? t("编辑分类") : t("新建分类")}
          </div>
          <div className="field">
            <label className="field-label">{t("分类名称")}</label>
            <input
              className="ui-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("例如 工作、个人")}
              maxLength={20}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <label className="field-label">{t("标识色")}</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={t("选择颜色 {color}", { color: c })}
                  onClick={() => setColor(c)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    border: "none",
                    background: c,
                    cursor: "pointer",
                    boxShadow:
                      color === c
                        ? "0 0 0 2px var(--color-bg-1), 0 0 0 4px " + c
                        : "inset 0 0 0 1px rgba(0,0,0,0.08)",
                  }}
                />
              ))}
              <label
                title={t("自定义颜色")}
                style={{
                  position: "relative",
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  overflow: "hidden",
                  cursor: "pointer",
                  boxShadow: "inset 0 0 0 1px var(--color-border-3)",
                  background:
                    "conic-gradient(#f65159,#f5b433,#1ebf6f,#1664ff,#6e4c9f,#f65159)",
                }}
              >
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value.toUpperCase())}
                  style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
                />
              </label>
            </div>
          </div>
          <div className="btn-row" style={{ marginTop: 16 }}>
            {editingId ? (
              <Button block onClick={resetForm} disabled={busy}>
                {t("取消")}
              </Button>
            ) : null}
            <Button variant="primary" block onClick={submit} disabled={busy}>
              {editingId ? t("保存修改") : t("创建分类")}
            </Button>
          </div>
        </div>

        {/* 分类列表 */}
        <div className="s-group-title" style={{ marginTop: 16 }}>
          {t("已有分类（{n}）", { n: categories.length })}
        </div>
        {categories.length === 0 ? (
          <div className="empty-state">
            <span className="empty-desc">{t("还没有分类，创建一个来整理你的账户吧")}</span>
          </div>
        ) : (
          <div className="panel" style={{ overflow: "hidden" }}>
            {categories.map((cat, idx) => (
              <div
                className="s-row"
                key={cat.id}
                style={{ borderBottom: idx === categories.length - 1 ? "none" : undefined }}
              >
                <div className="s-main" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: cat.color,
                      flexShrink: 0,
                    }}
                  />
                  <span className="s-title">{cat.name}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                  <IconButton
                    label={t("上移")}
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                  >
                    <ChevronLeft style={{ transform: "rotate(90deg)" }} />
                  </IconButton>
                  <IconButton
                    label={t("下移")}
                    onClick={() => move(idx, 1)}
                    disabled={idx === categories.length - 1}
                  >
                    <ChevronLeft style={{ transform: "rotate(-90deg)" }} />
                  </IconButton>
                  <IconButton label={t("编辑")} onClick={() => startEdit(cat)}>
                    <Edit />
                  </IconButton>
                  <IconButton
                    label={t("删除")}
                    onClick={() => setPendingDelete(cat)}
                    style={{ color: "var(--color-danger)" }}
                  >
                    <Trash />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        )}

        <div
          className="notice"
          style={{ marginTop: 12, background: "var(--color-bg-4)", color: "var(--color-text-2)" }}
        >
          <Plus style={{ color: "var(--color-text-3)" }} />
          {t("分类可随时重命名、改色、调整顺序；删除时可选择保留账户。")}
        </div>
      </section>

      {/* 删除确认：两种策略 */}
      {pendingDelete ? (
        <div className="modal-overlay" onClick={() => setPendingDelete(null)} role="presentation">
          <div
            className="modal-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label={t("删除分类")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-body">
              <span className="modal-icon">
                <Trash style={{ width: 18, height: 18 }} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="modal-title">{t("删除分类「{name}」", { name: pendingDelete.name })}</div>
                <div className="modal-desc">
                  {t("该分类下的账户将如何处理？此操作不可撤销。")}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18 }}>
              <Button variant="danger" block disabled={busy} onClick={() => confirmDelete(true)}>
                {t("删除分类及其中账户")}
              </Button>
              <Button block disabled={busy} onClick={() => confirmDelete(false)}>
                {t("仅删除分类，账户移到「未分类」")}
              </Button>
              <Button variant="text" block disabled={busy} onClick={() => setPendingDelete(null)}>
                {t("取消")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <TabBar active="settings" onSelect={onTabSelect} />
    </>
  );
}
