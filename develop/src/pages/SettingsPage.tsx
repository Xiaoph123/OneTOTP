import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import { TabBar, type TabKey } from "../components/TabBar";
import { Switch } from "../components/Controls";
import { Select } from "../components/Select";
import { ShortcutRecorder } from "../components/ShortcutRecorder";
import { useToast } from "../components/Toast";
import { Button } from "../components/Button";
import { api, type StorageUsage } from "../lib/api";
import { getAutostart, setAutostart } from "../lib/autostart";
import { applyToggleShortcut } from "../lib/shortcut";
import { ChevronRight } from "../components/icons";
import { ConfirmDialog } from "../components/Dialog";
import { AboutDialog } from "../components/AboutDialog";
import { formatBytes } from "../lib/utils";
import { isDesktop } from "../lib/platform";
import { useI18n } from "../i18n";

const MAX_BACKUP_KEEP = 10;
/** 设置项右侧控件的统一宽度，保证各行对齐 */
const CONTROL_WIDTH = 124;

export function SettingsPage() {
  const { settings, saveSettings, navigate, accounts } = useApp();
  const toast = useToast();
  const { t } = useI18n();
  const desktop = isDesktop();
  const [draft, setDraft] = useState(settings);
  // 备份数量的输入框文本，独立于 draft，便于输入过程与失焦校正
  const [keepInput, setKeepInput] = useState(settings ? String(settings.backupKeep) : "");
  // 开机自启状态（由系统注册表/服务决定，非应用配置）
  const [autostart, setAutostartState] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  // 本地数据占用
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const loadUsage = () => {
    api.getStorageUsage().then(setUsage).catch(() => {});
  };

  useEffect(() => {
    getAutostart().then(setAutostartState);
  }, []);

  useEffect(loadUsage, []);

  const handleClearBackups = async () => {
    setClearOpen(false);
    const freed = usage?.backupBytes ?? 0;
    try {
      const removed = await api.clearBackups();
      if (removed === 0) {
        toast.info(t("没有可清理的备份快照"));
      } else {
        toast.success(t("已清理 {n} 份快照，释放 {size}", { n: removed, size: formatBytes(freed) }));
      }
      loadUsage();
    } catch (e) {
      toast.error(t("清理失败：{msg}", { msg: String(e) }));
    }
  };

  if (!draft) {
    return (
      <>
        <section className="app-body">
          <div className="empty-state">
            <span className="empty-desc">{t("正在加载设置…")}</span>
          </div>
        </section>
        <TabBar active="settings" onSelect={(k) => k === "codes" && navigate({ name: "codes" })} />
      </>
    );
  }

  const update = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => {
    setDraft({ ...draft, [key]: value });
  };

  /** 切换开机自启：直接调用系统接口并回读真实状态 */
  const toggleAutostart = async (next: boolean) => {
    setAutostartBusy(true);
    try {
      await setAutostart(next);
      const actual = await getAutostart();
      setAutostartState(actual);
      toast.success(actual ? t("已开启开机自动启动") : t("已关闭开机自动启动"));
    } catch (e) {
      toast.error(t("设置失败：{msg}", { msg: String(e) }));
    } finally {
      setAutostartBusy(false);
    }
  };

  /** 快捷键：录制后立即注册并保存 */
  const changeShortcut = async (shortcut: string) => {
    const applied = await applyToggleShortcut(shortcut);
    if (shortcut && !applied) {
      toast.error(t("快捷键注册失败，可能已被其他程序占用"));
      return;
    }
    const next = { ...draft, shortcutToggle: applied };
    setDraft(next);
    await saveSettings(next);
    toast.success(applied ? t("快捷键已设为 {key}", { key: applied }) : t("已清除快捷键"));
  };

  /** 主题切换需立即生效并保存 */
  const changeTheme = async (theme: typeof draft.theme) => {
    const next = { ...draft, theme };
    setDraft(next);
    await saveSettings(next);
  };

  /** 语言切换需立即生效并保存（App 层监听 settings.language 同步 setLang） */
  const changeLanguage = async (language: typeof draft.language) => {
    const next = { ...draft, language };
    setDraft(next);
    await saveSettings(next);
  };

  /** 窗口尺寸切换需立即生效并保存 */
  const changeWindowSize = async (windowSize: typeof draft.windowSize) => {
    const next = { ...draft, windowSize };
    setDraft(next);
    await saveSettings(next);
  };

  /** 字体大小切换需立即生效并保存（App 层监听 settings.fontScale 同步 applyFontScale） */
  const changeFontScale = async (fontScale: typeof draft.fontScale) => {
    const next = { ...draft, fontScale };
    setDraft(next);
    await saveSettings(next);
  };

  /** 提交备份保留数量：限制 1~10 的整数 */
  const commitBackupKeep = () => {
    const parsed = Math.floor(Number(keepInput));
    const clamped = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_BACKUP_KEEP) : draft.backupKeep;
    setKeepInput(String(clamped));
    if (clamped !== draft.backupKeep) update("backupKeep", clamped);
  };

  const persist = async () => {
    try {
      await saveSettings(draft);
      toast.success(t("设置已保存"));
    } catch (e) {
      toast.error(t("保存失败：{msg}", { msg: String(e) }));
    }
  };

  const onTabSelect = (key: TabKey) => {
    if (key === "codes") navigate({ name: "codes" });
  };

  return (
    <>
      <section className="app-body">
        <div className="s-group-title">{t("通用")}</div>
        <div className="panel">
          {desktop ? (
            <Row title={t("开机自动启动")} desc={t("登录系统后自动打开 OneTotp")}>
              <Switch
                checked={autostart}
                disabled={autostartBusy}
                onChange={toggleAutostart}
                label={t("开机自动启动")}
              />
            </Row>
          ) : null}
          {desktop ? (
            <Row title={t("复制后自动隐藏窗口")} desc={t("复制验证码后自动收起窗口")}>
              <Switch checked={draft.autoHideAfterCopy} onChange={(v) => update("autoHideAfterCopy", v)} label={t("复制后自动隐藏窗口")} />
            </Row>
          ) : null}
          <Row title={t("验证码显示分组")} desc={t("将 6 位验证码拆分为 3+3，8 位拆分为 4+4")}>
            <Switch checked={draft.codeGrouping} onChange={(v) => update("codeGrouping", v)} label={t("验证码显示分组")} />
          </Row>
          <Row title={t("剩余时间不足时高亮")} desc={t("倒计时少于 5 秒时标红")}>
            <Switch checked={draft.expiryHighlight} onChange={(v) => update("expiryHighlight", v)} label={t("剩余时间不足时高亮")} />
          </Row>
          <Row title={t("点击即复制")} desc={t("点击验证码卡片直接复制")}>
            <Switch checked={draft.clickToCopy} onChange={(v) => update("clickToCopy", v)} label={t("点击即复制")} />
          </Row>
          {desktop ? (
            <Row title={t("全局快捷键")} desc={t("按下组合键快速唤起或隐藏窗口")}>
              <ShortcutRecorder value={draft.shortcutToggle} onChange={changeShortcut} width={CONTROL_WIDTH} />
            </Row>
          ) : null}
          {desktop ? (
            <Row title={t("关闭按钮行为")} desc={t("点击标题栏关闭按钮时的处理方式")}>
              <Select
                width={CONTROL_WIDTH}
                value={draft.closeBehavior}
                onChange={(v) => update("closeBehavior", v)}
                options={[
                  { value: "quit" as const, label: t("直接退出") },
                  { value: "tray" as const, label: t("最小化到托盘") },
                ]}
              />
            </Row>
          ) : null}
        </div>

        <div className="s-group-title" style={{ marginTop: 12 }}>
          {t("外观")}
        </div>
        <div className="panel">
          <Row title={t("语言")} desc={t("界面显示语言，自动将跟随系统语言环境")}>
            <Select
              width={CONTROL_WIDTH}
              value={draft.language}
              onChange={(v) => changeLanguage(v)}
              options={[
                { value: "auto" as const, label: t("自动") },
                { value: "zh" as const, label: "简体中文" },
                { value: "en" as const, label: "English" },
              ]}
            />
          </Row>
          <Row title={t("字体大小")} desc={t("调整应用内文字的整体大小")}>
            <Select
              width={CONTROL_WIDTH}
              value={draft.fontScale}
              onChange={(v) => changeFontScale(v)}
              options={[
                { value: "small" as const, label: t("小") },
                { value: "standard" as const, label: t("标准") },
                { value: "large" as const, label: t("大") },
                { value: "xlarge" as const, label: t("特大") },
              ]}
            />
          </Row>
          {desktop ? (
            <Row title={t("窗口尺寸")} desc={t("调整窗口宽度，紧凑 / 标准 / 宽松")}>
              <Select
                width={CONTROL_WIDTH}
                value={draft.windowSize}
                onChange={(v) => changeWindowSize(v)}
                options={[
                  { value: "compact" as const, label: t("紧凑") },
                  { value: "standard" as const, label: t("标准") },
                  { value: "expanded" as const, label: t("宽松") },
                ]}
              />
            </Row>
          ) : null}
          <Row title={t("主题外观")} desc={t("切换亮色 / 暗色，或跟随系统")}>
            <Select
              value={draft.theme}
              width={CONTROL_WIDTH}
              onChange={(v) => changeTheme(v)}
              options={[
                { value: "light" as const, label: t("亮色") },
                { value: "dark" as const, label: t("暗色") },
                { value: "system" as const, label: t("跟随系统") },
              ]}
            />
          </Row>
          <Row title={t("验证码可见性")} desc={t("控制验证码在卡片上的显示方式")}>
            <Select
              width={CONTROL_WIDTH}
              value={draft.codeVisibility}
              onChange={(v) => update("codeVisibility", v)}
              options={[
                { value: "never" as const, label: t("不隐藏") },
                { value: "always" as const, label: t("隐藏") },
                { value: "hover" as const, label: t("悬停显示") },
              ]}
            />
          </Row>
          {desktop ? (
            <Row title={t("截图时隐藏")} desc={t("截屏或录屏时以黑屏呈现，防止验证码泄露")}>
              <Switch
                checked={draft.hideOnScreenshot}
                onChange={(v) => update("hideOnScreenshot", v)}
                label={t("截图时隐藏")}
              />
            </Row>
          ) : null}
          <Row title={t("卡片密度")} desc={t("控制卡片的疏密程度")}>
            <Select
              width={CONTROL_WIDTH}
              value={draft.cardDensity}
              onChange={(v) => update("cardDensity", v)}
              options={[
                { value: "compact" as const, label: t("紧凑") },
                { value: "standard" as const, label: t("标准") },
              ]}
            />
          </Row>
          <Row title={t("卡片细节")} desc={t("控制卡片展示的信息量")}>
            <Select
              width={CONTROL_WIDTH}
              value={draft.cardDetail}
              onChange={(v) => update("cardDetail", v)}
              options={[
                { value: "minimal" as const, label: t("精简") },
                { value: "standard" as const, label: t("标准") },
                { value: "detailed" as const, label: t("复杂") },
              ]}
            />
          </Row>
        </div>

        <div className="s-group-title" style={{ marginTop: 12 }}>
          {t("数据与存储")}
        </div>
        <div className="panel" style={{ overflow: "hidden" }}>
          <button className="action-row" onClick={() => navigate({ name: "importExport" })}>
            <span>
              <span className="s-title">{t("导入 / 导出配置")}</span>
              <span className="s-desc" style={{ display: "block" }}>
                {t("通过加密文件在多台设备间迁移")}
              </span>
            </span>
            <ChevronRight style={{ width: 14, height: 14, color: "var(--color-text-3)" }} />
          </button>
          <button className="action-row" onClick={() => navigate({ name: "security" })}>
            <span>
              <span className="s-title">{t("安全与锁定")}</span>
              <span className="s-desc" style={{ display: "block" }}>
                {t("锁定密码与自动锁定策略")}
              </span>
            </span>
            <ChevronRight style={{ width: 14, height: 14, color: "var(--color-text-3)" }} />
          </button>
          <button className="action-row" onClick={() => navigate({ name: "categories" })}>
            <span>
              <span className="s-title">{t("分类管理")}</span>
              <span className="s-desc" style={{ display: "block" }}>
                {t("创建分类、设置颜色与排序")}
              </span>
            </span>
            <ChevronRight style={{ width: 14, height: 14, color: "var(--color-text-3)" }} />
          </button>
          <Row title={t("自动备份")} desc={t("修改账户后保留加密快照")}>
            <Switch checked={draft.autoBackup} onChange={(v) => update("autoBackup", v)} label={t("自动备份")} />
          </Row>
          <Row title={t("备份保留数量")} desc={t("保留最近的本机快照，最多 {n} 个", { n: MAX_BACKUP_KEEP })}>
            <input
              className="ui-input"
              type="number"
              min={1}
              max={MAX_BACKUP_KEEP}
              step={1}
              style={{ width: CONTROL_WIDTH, textAlign: "center" }}
              value={keepInput}
              onChange={(e) => setKeepInput(e.target.value)}
              onBlur={commitBackupKeep}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </Row>
          <Row
            title={t("本地数据占用")}
            desc={t("账户 {n} 个 · 快照 {m} 份", {
              n: accounts.length,
              m: usage?.backupCount ?? 0,
            })}
          >
            <button
              className="usage-pill"
              onClick={() => setClearOpen(true)}
              title={t("清理备份快照")}
            >
              <span className="usage-size">{usage ? formatBytes(usage.totalBytes) : "—"}</span>
            </button>
          </Row>
        </div>

        <div className="s-group-title" style={{ marginTop: 12 }}>
          {t("关于")}
        </div>
        <div className="panel" style={{ overflow: "hidden" }}>
          <button className="action-row" onClick={() => setAboutOpen(true)}>
            <span>
              <span className="s-title">{t("关于 OneTotp")}</span>
              <span className="s-desc" style={{ display: "block" }}>
                {t("查看版本、运行平台与加密信息")}
              </span>
            </span>
            <ChevronRight style={{ width: 14, height: 14, color: "var(--color-text-3)" }} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <Button variant="primary" block onClick={persist}>
            {t("保存设置")}
          </Button>
        </div>
      </section>

      <TabBar active="settings" onSelect={onTabSelect} />

      <ConfirmDialog
        open={clearOpen}
        title={t("清理备份快照")}
        description={t("将删除全部 {n} 份本地加密快照，不影响账户与设置。此操作不可撤销。", {
          n: usage?.backupCount ?? 0,
        })}
        confirmText={t("清理备份快照")}
        danger
        onConfirm={handleClearBackups}
        onCancel={() => setClearOpen(false)}
      />

      <AboutDialog
        open={aboutOpen}
        accountCount={accounts.length}
        onClose={() => setAboutOpen(false)}
      />
    </>
  );
}

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="s-row">
      <div className="s-main">
        <div className="s-title">{title}</div>
        {desc ? <div className="s-desc">{desc}</div> : null}
      </div>
      {children}
    </div>
  );
}
