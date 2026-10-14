import { useState } from "react";
import { useApp } from "../state/AppContext";
import { TabBar, type TabKey } from "../components/TabBar";
import { Switch } from "../components/Controls";
import { Select } from "../components/Select";
import { Button } from "../components/Button";
import { ChevronRight } from "../components/icons";

export function SettingsPage() {
  const { settings, saveSettings, navigate } = useApp();
  const [draft, setDraft] = useState(settings);

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

  /** 主题切换需立即生效并保存 */
  const changeTheme = async (theme: typeof draft.theme) => {
    const next = { ...draft, theme };
    setDraft(next);
    await saveSettings(next);
  };

  const persist = async () => {
    await saveSettings(draft);
  };

  const onTabSelect = (key: TabKey) => {
    if (key === "codes") navigate({ name: "codes" });
  };

  return (
    <>
      <section className="app-body">
        <div className="s-group-title">通用</div>
        <div className="panel">
          <Row title="启动时自动锁定" desc="打开应用时需要先输入密码解锁">
            <Switch checked={draft.lockEnabled} onChange={(v) => update("lockEnabled", v)} label="启动时自动锁定" />
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
        </div>

        <div className="s-group-title" style={{ marginTop: 12 }}>
          外观
        </div>
        <div className="panel">
          <Row title="主题外观" desc="切换亮色 / 暗色，或跟随系统">
            <Select
              value={draft.theme}
              width={116}
              onChange={(v) => changeTheme(v)}
              options={[
                { value: "light" as const, label: "亮色" },
                { value: "dark" as const, label: "暗色" },
                { value: "system" as const, label: "跟随系统" },
              ]}
            />
          </Row>
          <Row title="隐藏验证码直到悬停" desc="默认以圆点显示，悬停时展示数字">
            <Switch checked={draft.hideCodeUntilHover} onChange={(v) => update("hideCodeUntilHover", v)} label="隐藏验证码" />
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
          <Row title="备份保留数量" desc="保留最近的本机快照">
            <Select
              value={draft.backupKeep}
              width={110}
              onChange={(v) => update("backupKeep", v)}
              options={[5, 10, 20].map((n) => ({ value: n, label: `${n} 个` }))}
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
