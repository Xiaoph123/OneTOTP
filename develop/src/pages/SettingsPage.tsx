import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext";
import { TabBar, type TabKey } from "../components/TabBar";
import { Switch } from "../components/Controls";
import { Select } from "../components/Select";
import { ShortcutRecorder } from "../components/ShortcutRecorder";
import { useToast } from "../components/Toast";
import { Button } from "../components/Button";
import { getAutostart, setAutostart } from "../lib/autostart";
import { applyToggleShortcut } from "../lib/shortcut";
import { ChevronRight } from "../components/icons";

const MAX_BACKUP_KEEP = 10;
/** 设置项右侧控件的统一宽度，保证各行对齐 */
const CONTROL_WIDTH = 124;

export function SettingsPage() {
  const { settings, saveSettings, navigate } = useApp();
  const toast = useToast();
  const [draft, setDraft] = useState(settings);
  // 备份数量的输入框文本，独立于 draft，便于输入过程与失焦校正
  const [keepInput, setKeepInput] = useState(settings ? String(settings.backupKeep) : "");
  // 开机自启状态（由系统注册表/服务决定，非应用配置）
  const [autostart, setAutostartState] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);

  useEffect(() => {
    getAutostart().then(setAutostartState);
  }, []);

  if (!draft) {
    return (
      <>
        <section className="app-body">
          <div className="empty-state">
            <span className="empty-desc">正在加载设置…</span>
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
      toast.success(actual ? "已开启开机自动启动" : "已关闭开机自动启动");
    } catch (e) {
      toast.error(`设置失败：${String(e)}`);
    } finally {
      setAutostartBusy(false);
    }
  };

  /** 快捷键：录制后立即注册并保存 */
  const changeShortcut = async (shortcut: string) => {
    const applied = await applyToggleShortcut(shortcut);
    if (shortcut && !applied) {
      toast.error("快捷键注册失败，可能已被其他程序占用");
      return;
    }
    const next = { ...draft, shortcutToggle: applied };
    setDraft(next);
    await saveSettings(next);
    toast.success(applied ? `快捷键已设为 ${applied}` : "已清除快捷键");
  };

  /** 主题切换需立即生效并保存 */
  const changeTheme = async (theme: typeof draft.theme) => {
    const next = { ...draft, theme };
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
      toast.success("设置已保存");
    } catch (e) {
      toast.error(`保存失败：${String(e)}`);
    }
  };

  const onTabSelect = (key: TabKey) => {
    if (key === "codes") navigate({ name: "codes" });
  };

  return (
    <>
      <section className="app-body">
        <div className="s-group-title">通用</div>
        <div className="panel">
          <Row title="开机自动启动" desc="登录系统后自动打开 OneTotp">
            <Switch
              checked={autostart}
              disabled={autostartBusy}
              onChange={toggleAutostart}
              label="开机自动启动"
            />
          </Row>
          <Row title="复制后自动隐藏窗口" desc="复制验证码后自动收起窗口">
            <Switch checked={draft.autoHideAfterCopy} onChange={(v) => update("autoHideAfterCopy", v)} label="复制后自动隐藏" />
          </Row>
          <Row title="验证码显示分组" desc="将 6 位验证码拆分为 3+3">
            <Switch checked={draft.codeGrouping} onChange={(v) => update("codeGrouping", v)} label="验证码显示分组" />
          </Row>
          <Row title="剩余时间不足时高亮" desc="倒计时少于 5 秒时标红">
            <Switch checked={draft.expiryHighlight} onChange={(v) => update("expiryHighlight", v)} label="剩余时间高亮" />
          </Row>
          <Row title="点击即复制" desc="点击验证码卡片直接复制">
            <Switch checked={draft.clickToCopy} onChange={(v) => update("clickToCopy", v)} label="点击即复制" />
          </Row>
          <Row title="全局快捷键" desc="按下组合键快速唤起或隐藏窗口">
            <ShortcutRecorder value={draft.shortcutToggle} onChange={changeShortcut} width={CONTROL_WIDTH} />
          </Row>
          <Row title="关闭按钮行为" desc="点击标题栏关闭按钮时的处理方式">
            <Select
              width={CONTROL_WIDTH}
              value={draft.closeBehavior}
              onChange={(v) => update("closeBehavior", v)}
              options={[
                { value: "quit" as const, label: "直接退出" },
                { value: "tray" as const, label: "最小化到托盘" },
              ]}
            />
          </Row>
        </div>

        <div className="s-group-title" style={{ marginTop: 12 }}>
          外观
        </div>
        <div className="panel">
          <Row title="主题外观" desc="切换亮色 / 暗色，或跟随系统">
            <Select
              value={draft.theme}
              width={CONTROL_WIDTH}
              onChange={(v) => changeTheme(v)}
              options={[
                { value: "light" as const, label: "亮色" },
                { value: "dark" as const, label: "暗色" },
                { value: "system" as const, label: "跟随系统" },
              ]}
            />
          </Row>
          <Row title="验证码可见性" desc="控制验证码在卡片上的显示方式">
            <Select
              width={CONTROL_WIDTH}
              value={draft.codeVisibility}
              onChange={(v) => update("codeVisibility", v)}
              options={[
                { value: "never" as const, label: "不隐藏" },
                { value: "always" as const, label: "隐藏" },
                { value: "hover" as const, label: "悬停显示" },
              ]}
            />
          </Row>
          <Row title="截图时隐藏" desc="截屏或录屏时以黑屏呈现，防止验证码泄露">
            <Switch
              checked={draft.hideOnScreenshot}
              onChange={(v) => update("hideOnScreenshot", v)}
              label="截图时隐藏"
            />
          </Row>
          <Row title="卡片密度" desc="控制卡片的疏密程度">
            <Select
              width={CONTROL_WIDTH}
              value={draft.cardDensity}
              onChange={(v) => update("cardDensity", v)}
              options={[
                { value: "compact" as const, label: "紧凑" },
                { value: "standard" as const, label: "标准" },
              ]}
            />
          </Row>
          <Row title="卡片细节" desc="控制卡片展示的信息量">
            <Select
              width={CONTROL_WIDTH}
              value={draft.cardDetail}
              onChange={(v) => update("cardDetail", v)}
              options={[
                { value: "minimal" as const, label: "精简" },
                { value: "standard" as const, label: "标准" },
                { value: "detailed" as const, label: "复杂" },
              ]}
            />
          </Row>
        </div>

        <div className="s-group-title" style={{ marginTop: 12 }}>
          数据与存储
        </div>
        <div className="panel" style={{ overflow: "hidden" }}>
          <button className="action-row" onClick={() => navigate({ name: "importExport" })}>
            <span>
              <span className="s-title">导入 / 导出配置</span>
              <span className="s-desc" style={{ display: "block" }}>
                通过加密文件在多台设备间迁移
              </span>
            </span>
            <ChevronRight style={{ width: 14, height: 14, color: "var(--color-text-3)" }} />
          </button>
          <button className="action-row" onClick={() => navigate({ name: "security" })}>
            <span>
              <span className="s-title">安全与锁定</span>
              <span className="s-desc" style={{ display: "block" }}>
                锁定密码与自动锁定策略
              </span>
            </span>
            <ChevronRight style={{ width: 14, height: 14, color: "var(--color-text-3)" }} />
          </button>
          <Row title="自动备份" desc="修改账户后保留加密快照">
            <Switch checked={draft.autoBackup} onChange={(v) => update("autoBackup", v)} label="自动备份" />
          </Row>
          <Row title="备份保留数量" desc={`保留最近的本机快照，最多 ${MAX_BACKUP_KEEP} 个`}>
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
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <Button variant="primary" block onClick={persist}>
            保存设置
          </Button>
        </div>
      </section>

      <TabBar active="settings" onSelect={onTabSelect} />
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
