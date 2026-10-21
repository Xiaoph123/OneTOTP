import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { TabBar } from "../components/TabBar";
import { Switch } from "../components/Controls";
import { Select } from "../components/Select";
import { ShortcutRecorder } from "../components/ShortcutRecorder";
import { useToast } from "../components/Toast";
import { IconButton } from "../components/Button";
import { api, type AppSettings, type DataDirInfo, type StorageUsage } from "../lib/api";
import { getAutostart, setAutostart } from "../lib/autostart";
import { applyToggleShortcut } from "../lib/shortcut";
import { ChevronRight, FolderOpen } from "../components/icons";
import { ConfirmDialog } from "../components/Dialog";
import { AboutDialog } from "../components/AboutDialog";
import { formatBytes } from "../lib/utils";
import { isDesktop } from "../lib/platform";
import { useI18n } from "../i18n";

const MAX_BACKUP_KEEP = 10;

export function SettingsPage() {
  const { settings, saveSettings, navigate, accounts } = useApp();
  const toast = useToast();
  const { t } = useI18n();
  const desktop = isDesktop();
  const [draft, setDraft] = useState(settings);
  // 即时保存的防抖定时器：连续快速切换时合并为一次落盘。
  // 声明靠前是因为下面的 settings 同步 effect 也要读 pendingSettings。
  const saveTimer = useRef<number | null>(null);
  const pendingSettings = useRef<AppSettings | null>(null);
  // 备份数量的输入框文本，独立于 draft，便于输入过程与失焦校正
  const [keepInput, setKeepInput] = useState(settings ? String(settings.backupKeep) : "");
  // settings 外部变化（如导入备份）时同步输入框，避免显示旧值
  useEffect(() => {
    if (settings) setKeepInput(String(settings.backupKeep));
  }, [settings?.backupKeep]);
  // 外部改动 settings（标题栏切换主题、导入备份）时同步 draft，
  // 否则本页各下拉框会一直显示打开页面时的旧值。
  // 若存在尚未落盘的本地改动（防抖窗口内），则以用户刚操作的值为准，
  // 不能在这时用旧 settings 覆盖掉用户刚才的改动。
  useEffect(() => {
    if (!settings) return;
    if (pendingSettings.current !== null) return;
    setDraft(settings);
  }, [settings]);
  // 开机自启状态（由系统注册表/服务决定，非应用配置）
  const [autostart, setAutostartState] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  // 本地数据占用
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  // 数据存储目录（由后端决定，非应用配置项）
  const [dataDir, setDataDir] = useState<DataDirInfo | null>(null);
  // 切换目录的二次确认：迁移会覆盖目标目录中的同名文件，必须让用户明确同意
  const [dirConfirm, setDirConfirm] = useState<{ mode: "change" | "reset"; dir: string } | null>(null);
  const [dirBusy, setDirBusy] = useState(false);
  // 开启「允许空密码备份」的二次确认
  const [emptyPwdConfirm, setEmptyPwdConfirm] = useState(false);

  const loadUsage = () => {
    api.getStorageUsage().then(setUsage).catch(() => {});
  };

  useEffect(() => {
    getAutostart().then(setAutostartState);
  }, []);

  useEffect(loadUsage, []);

  useEffect(() => {
    api.getDataDir().then(setDataDir).catch(() => {});
  }, []);

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

  // 离开页面时若有未落盘的改动，立即补写，避免丢失
  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const pending = pendingSettings.current;
      pendingSettings.current = null;
      if (pending) saveSettings(pending).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!draft) {
    return (
      <>
        <section className="app-body">
          <div className="empty-state">
            <span className="empty-desc">{t("正在加载设置…")}</span>
          </div>
        </section>
        <TabBar active="settings" />
      </>
    );
  }

  /**
   * 更新设置项并立即保存。
   * 原先仅改本地 draft、需点底部「保存」才落盘，但主题/语言等却是即时保存——
   * 行为不一致，用户容易误以为开关已生效，离开页面还会静默丢失改动。
   */
  const update = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    pendingSettings.current = next;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    // 120ms 防抖：既保证「立即生效」的体感，又避免连点造成多次写盘
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      const pending = pendingSettings.current;
      pendingSettings.current = null;
      if (pending) {
        saveSettings(pending).catch((e) => {
          toast.error(t("保存失败：{msg}", { msg: String(e) }));
        });
      }
    }, 120);
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

  /** 选择新的数据存储目录：迁移现有数据后应用自动重启 */
  const chooseDataDir = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        directory: true,
        multiple: false,
        title: t("选择数据存储目录"),
        defaultPath: dataDir?.current || undefined,
      });
      if (typeof picked !== "string") return;
      if (picked === dataDir?.current) return;
      setDirConfirm({ mode: "change", dir: picked });
    } catch (e) {
      toast.error(t("选择目录失败：{msg}", { msg: String(e) }));
    }
  };

  /** 确认切换目录：调用后端迁移并重启 */
  const applyDataDir = async () => {
    const pending = dirConfirm;
    setDirConfirm(null);
    if (!pending) return;
    setDirBusy(true);
    try {
      if (pending.mode === "reset") {
        await api.resetDataDir();
      } else {
        await api.setDataDir(pending.dir);
      }
      // 后端会重启应用，正常情况下不会执行到这里
    } catch (e) {
      toast.error(t("切换数据目录失败：{msg}", { msg: String(e) }));
      setDirBusy(false);
    }
  };

  /** 恢复默认数据目录 */
  const resetDataDir = () => {
    setDirConfirm({ mode: "reset", dir: dataDir?.defaultDir ?? "" });
  };

  return (
    <>
      <section className="app-body settings-page">
        <div className="s-group-title">{t("通用")}</div>
        <div className="panel">
          {desktop ? (
            <Row title={t("开机自动启动")} desc={t("登录系统后自动打开 OneTOTP")}>
              <Switch
                checked={autostart}
                disabled={autostartBusy}
                onChange={toggleAutostart}
                label={t("开机自动启动")}
              />
            </Row>
          ) : null}
          {desktop ? (
            <Row title={t("关闭按钮行为")} desc={t("点击标题栏关闭按钮时的处理方式")}>
              <Select
                variant="ghost"
                value={draft.closeBehavior}
                onChange={(v) => update("closeBehavior", v)}
                options={[
                  { value: "quit" as const, label: t("直接退出") },
                  { value: "tray" as const, label: t("最小化到托盘") },
                ]}
              />
            </Row>
          ) : null}
          {desktop ? (
            <Row title={t("全局快捷键")} desc={t("按下组合键快速唤起或隐藏窗口")}>
              <ShortcutRecorder value={draft.shortcutToggle} onChange={changeShortcut} className="control-w" />
            </Row>
          ) : null}
          {desktop ? (
            <Row title={t("复制后自动隐藏窗口")} desc={t("复制验证码后自动收起窗口")}>
              <Switch checked={draft.autoHideAfterCopy} onChange={(v) => update("autoHideAfterCopy", v)} label={t("复制后自动隐藏窗口")} />
            </Row>
          ) : null}
        </div>

        {/* 验证码显示：与卡片展示/复制相关的行为统一归到此处 */}
        <div className="s-group-title mt-12">{t("验证码显示")}</div>
        <div className="panel panel-clip">
          <Row title={t("验证码显示分组")} desc={t("将 6 位验证码拆分为 3+3，8 位拆分为 4+4")}>
            <Switch checked={draft.codeGrouping} onChange={(v) => update("codeGrouping", v)} label={t("验证码显示分组")} />
          </Row>
          <Row title={t("验证码可见性")} desc={t("控制验证码在卡片上的显示方式")}>
            <Select
              variant="ghost"
              value={draft.codeVisibility}
              onChange={(v) => update("codeVisibility", v)}
              options={[
                { value: "never" as const, label: t("不隐藏") },
                { value: "always" as const, label: t("隐藏") },
                { value: "hover" as const, label: t("悬停显示") },
              ]}
            />
          </Row>
          <Row title={t("剩余时间不足时高亮")} desc={t("倒计时少于 5 秒时标红")}>
            <Switch checked={draft.expiryHighlight} onChange={(v) => update("expiryHighlight", v)} label={t("剩余时间不足时高亮")} />
          </Row>
          <Row title={t("点击即复制")} desc={t("点击验证码卡片直接复制")}>
            <Switch checked={draft.clickToCopy} onChange={(v) => update("clickToCopy", v)} label={t("点击即复制")} />
          </Row>
          <button className="action-row" onClick={() => navigate({ name: "categories" })}>
            <span>
              <span className="s-title">{t("验证码分类")}</span>
              <span className="s-desc s-desc-block">
                {t("创建分类、设置颜色与排序")}
              </span>
            </span>
            <ChevronRight className="chevron-muted" />
          </button>
        </div>

        <div className="s-group-title mt-12">
          {t("外观")}
        </div>
        <div className="panel">
          <Row title={t("语言")} desc={t("界面显示语言，自动将跟随系统语言环境")}>
            <Select
              variant="ghost"
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
              variant="ghost"
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
                variant="ghost"
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
              variant="ghost"
              value={draft.theme}
              onChange={(v) => changeTheme(v)}
              options={[
                { value: "light" as const, label: t("亮色") },
                { value: "dark" as const, label: t("暗色") },
                { value: "system" as const, label: t("跟随系统") },
              ]}
            />
          </Row>
          <Row title={t("卡片密度")} desc={t("控制卡片的疏密程度")}>
            <Select
              variant="ghost"
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
              variant="ghost"
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

        {/* 隐私保护：独立小分类。
            直接平铺三个开关，之前用多选下拉，长文案被裁切、状态还要展开才能看到；
            平铺后每一项是否开启一眼可见，也不会有「看起来没生效」的错觉。 */}
        <div className="s-group-title mt-12">{t("隐私保护")}</div>
        <div className="panel panel-clip">
          <Row
            title={t("截屏 / 录屏时隐藏内容")}
            desc={
              desktop
                ? t("把窗口从系统截屏与录屏的捕获中剔除，画面呈黑屏")
                : t("截屏会失败，录屏、投屏与多任务预览均呈黑屏")
            }
          >
            <Switch
              checked={draft.hideOnScreenshot}
              onChange={(v) => update("hideOnScreenshot", v)}
              label={t("截屏 / 录屏时隐藏内容")}
            />
          </Row>
          {/* 远程会话是桌面端概念（Windows 远程桌面 / 远程协助）。
              移动端没有对应状态，投屏场景已由上面的 FLAG_SECURE 覆盖，
              因此这一行在移动端不渲染，避免出现「开关存在但永远无效」。 */}
          {desktop ? (
            <Row
              title={t("远程会话时隐藏窗口")}
              desc={t("检测到远程桌面 / 远程协助时自动隐藏窗口")}
            >
              <Switch
                checked={draft.hideOnRemote}
                onChange={(v) => update("hideOnRemote", v)}
                label={t("远程会话时隐藏窗口")}
              />
            </Row>
          ) : null}
          <Row
            title={t("窗口失焦时遮挡验证码")}
            desc={t("离开窗口时模糊验证码数字，不锁定也不清空")}
          >
            <Switch
              checked={draft.hideOnUnfocused}
              onChange={(v) => update("hideOnUnfocused", v)}
              label={t("窗口失焦时遮挡验证码")}
            />
          </Row>
          <button className="action-row" onClick={() => navigate({ name: "security" })}>
            <span>
              <span className="s-title">{t("安全与锁定")}</span>
              <span className="s-desc s-desc-block">
                {t("锁定密码与自动锁定策略")}
              </span>
            </span>
            <ChevronRight className="chevron-muted" />
          </button>
        </div>

        <div className="s-group-title mt-12">
          {t("数据与存储")}
        </div>
        <div className="panel panel-clip">
          <button className="action-row" onClick={() => navigate({ name: "importExport" })}>
            <span>
              <span className="s-title">{t("导入 / 导出配置")}</span>
              <span className="s-desc s-desc-block">
                {t("通过加密文件在多台设备间迁移")}
              </span>
            </span>
            <ChevronRight className="chevron-muted" />
          </button>
          {/* 数据存储目录：整行独立布局，路径用只读输入框 + 内嵌图标按钮 */}
          {desktop ? (
            <div className="s-row s-row-block">
              <div className="s-main">
                <div className="s-title">{t("数据存储目录")}</div>
                <div className="s-desc">
                  {t("账户、备份与密钥全部保存在此目录，更改后应用会自动重启")}
                </div>
              </div>
              <div className="dir-setting">
                <div className="input-with-action">
                  <input
                    className="ui-input has-action dir-input"
                    value={dataDir?.current ?? ""}
                    readOnly
                    title={dataDir?.current ?? ""}
                    placeholder={t("正在读取…")}
                  />
                  <IconButton
                    label={t("选择目录")}
                    className="input-action"
                    onClick={chooseDataDir}
                  >
                    <FolderOpen className="icon-16" />
                  </IconButton>
                </div>
                {dataDir?.custom ? (
                  <button className="link-btn" onClick={resetDataDir}>
                    {t("恢复默认目录")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <Row
            title={t("允许空密码备份")}
            desc={t("开启后导出 / 导入备份可跳过密码；文件仅用公开口令加密，拿到文件即可解密")}
          >
            <Switch
              checked={draft.allowEmptyBackupPassword}
              onChange={(v) => {
                // 开启属于降低安全等级的操作，先二次确认；关闭无需确认
                if (v) setEmptyPwdConfirm(true);
                else update("allowEmptyBackupPassword", false);
              }}
              label={t("允许空密码备份")}
            />
          </Row>
          <Row title={t("自动备份")} desc={t("修改账户后保留加密快照")}>
            <Switch checked={draft.autoBackup} onChange={(v) => update("autoBackup", v)} label={t("自动备份")} />
          </Row>
          <Row title={t("备份保留数量")} desc={t("保留最近的本机快照，最多 {n} 个", { n: MAX_BACKUP_KEEP })}>
            <input
              className="ui-input control-input"
              type="number"
              min={1}
              max={MAX_BACKUP_KEEP}
              step={1}
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

        <div className="s-group-title mt-12">
          {t("关于")}
        </div>
        <div className="panel panel-clip">
          <button className="action-row" onClick={() => setAboutOpen(true)}>
            <span>
              <span className="s-title">{t("关于 OneTOTP")}</span>
              <span className="s-desc s-desc-block">
                {t("查看版本、运行平台与加密信息")}
              </span>
            </span>
            <ChevronRight className="chevron-muted" />
          </button>
        </div>
      </section>

      <TabBar active="settings" />

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

      <ConfirmDialog
        open={emptyPwdConfirm}
        title={t("允许空密码备份")}
        description={t("开启后导出的备份文件仅用公开口令加密，任何拿到文件的人都能解密，不含真正的机密保护。请仅在可信设备之间使用。")}
        confirmText={t("仍然开启")}
        danger
        onConfirm={() => {
          setEmptyPwdConfirm(false);
          update("allowEmptyBackupPassword", true);
        }}
        onCancel={() => setEmptyPwdConfirm(false)}
      />

      <ConfirmDialog
        open={dirConfirm !== null}
        title={dirConfirm?.mode === "reset" ? t("恢复默认数据目录") : t("更改数据存储目录")}
        description={
          dirConfirm?.mode === "reset"
            ? t("将把账户、备份与密钥迁回默认目录 {dir}，完成后应用会自动重启。", {
                dir: dirConfirm?.dir ?? "",
              })
            : t("将把账户、备份与密钥迁移到 {dir}，完成后应用会自动重启。目标目录中的同名文件会被覆盖。", {
                dir: dirConfirm?.dir ?? "",
              })
        }
        confirmText={dirBusy ? t("正在迁移…") : t("迁移并重启")}
        onConfirm={applyDataDir}
        onCancel={() => !dirBusy && setDirConfirm(null)}
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
