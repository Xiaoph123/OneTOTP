import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, type AccountView, type AppSettings, type Category, type CodeResult } from "../lib/api";
import { applyTheme } from "../lib/theme";
import { applyWindowSize } from "../lib/windowSize";
import { initToggleShortcut } from "../lib/shortcut";

export type Route =
  | { name: "codes" }
  | { name: "detail"; accountId: string }
  | { name: "add" }
  | { name: "edit"; accountId: string }
  | { name: "settings" }
  | { name: "security" }
  | { name: "categories" }
  | { name: "importExport" }
  | { name: "lock" };

type LoadPhase = "booting" | "locked" | "ready";

interface AppContextValue {
  phase: LoadPhase;
  route: Route;
  navigate: (route: Route) => void;
  /** 返回上一级（移动端返回键 / 页面返回按钮使用）；返回 false 表示已在根页面 */
  goBack: () => boolean;
  accounts: AccountView[];
  categories: Category[];
  codes: Record<string, CodeResult>;
  settings: AppSettings | null;
  passwordHint: string;
  hasLock: boolean;
  error: string | null;
  setError: (msg: string | null) => void;
  refreshAccounts: () => Promise<void>;
  refreshCategories: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  /** 重新读取锁定状态（hasLock / 密码提示）。
   *  运行时开启或关闭「应用锁定」后必须调用：hasLock 是自动锁定的总闸门，
   *  若不刷新，本次会话内新开启的锁定不会生效、已关闭的锁定仍会触发锁定。 */
  refreshLockState: () => Promise<void>;
  boot: () => Promise<void>;
  unlockWithPassword: (password: string) => Promise<boolean>;
  lockApp: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp 必须在 AppProvider 内使用");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<LoadPhase>("booting");
  const [route, setRoute] = useState<Route>({ name: "codes" });
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [codes, setCodes] = useState<Record<string, CodeResult>>({});
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [passwordHint, setPasswordHint] = useState("");
  const [hasLock, setHasLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 导航历史栈：记录来路，供返回键 / 返回按钮回退
  const historyRef = useRef<Route[]>([]);

  const refreshAccounts = useCallback(async () => {
    const list = await api.listAccounts();
    setAccounts(list);
  }, []);

  const refreshCategories = useCallback(async () => {
    const list = await api.listCategories();
    setCategories(list);
  }, []);

  const refreshSettings = useCallback(async () => {
    const s = await api.getSettings();
    setSettings(s);
  }, []);

  /** 重新读取锁定状态：hasLock 与密码提示（供运行时开关锁定后同步） */
  const refreshLockState = useCallback(async () => {
    const status = await api.getStatus();
    setHasLock(status.hasLock);
    setPasswordHint(status.passwordHint);
  }, []);

  const boot = useCallback(async () => {
    try {
      setError(null);
      const status = await api.getStatus();
      setHasLock(status.hasLock);
      setPasswordHint(status.passwordHint);

      if (!status.hasVault) {
        // 首次启动：建立本地保险库并直接进入
        await api.initializeVault();
        const s = await api.getSettings();
        setSettings(s);
        await refreshAccounts();
        await refreshCategories();
        setPhase("ready");
        setRoute({ name: "codes" });
        return;
      }

      if (status.hasLock && status.locked) {
        setPhase("locked");
        setRoute({ name: "lock" });
        return;
      }

      // 无锁定密码：使用机器密钥自动解锁
      if (!status.hasLock) {
        await api.initializeVault();
      }
      const s = await api.getSettings();
      setSettings(s);
      await refreshAccounts();
      await refreshCategories();
      setPhase("ready");
      setRoute({ name: "codes" });
    } catch (e) {
      setError(String(e));
      setPhase("locked");
    }
  }, [refreshAccounts, refreshCategories]);

  const unlockWithPassword = useCallback(
    async (password: string) => {
      try {
        setError(null);
        await api.unlock(password);
        const s = await api.getSettings();
        setSettings(s);
        await refreshAccounts();
        await refreshCategories();
        setPhase("ready");
        setRoute({ name: "codes" });
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      }
    },
    [refreshAccounts, refreshCategories],
  );

  const lockApp = useCallback(async () => {
    await api.lock();
    setAccounts([]);
    setCategories([]);
    setCodes({});
    // 清空导航历史：解锁后应回到首页，而不是沿用锁定前的深层页面
    historyRef.current = [];
    setPhase("locked");
    setRoute({ name: "lock" });
  }, []);

  const saveSettings = useCallback(async (next: AppSettings) => {
    await api.updateSettings(next);
    setSettings(next);
  }, []);

  const navigate = useCallback((next: Route) => {
    setRoute((prev) => {
      // 同路由不重复入栈
      if (prev.name === next.name && (prev as any).accountId === (next as any).accountId) {
        return next;
      }
      // 记录来路，供返回使用；限制栈深避免无限增长
      historyRef.current.push(prev);
      if (historyRef.current.length > 50) historyRef.current.shift();
      return next;
    });
  }, []);

  /** 返回上一级；根页面（无需返回）时返回 false，交由系统处理（移动端退出应用） */
  const goBack = useCallback(() => {
    const prev = historyRef.current.pop();
    if (prev && prev.name !== "lock") {
      setRoute(prev);
      return true;
    }
    return false;
  }, []);

  // 解锁后轮询验证码。
  // 页面不可见（切后台 / 手机锁屏 / 窗口最小化）时暂停跨进程轮询，降低耗电；
  // 回到前台立即刷新一次，保证显示不过期。
  useEffect(() => {
    if (phase !== "ready") return;
    let alive = true;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const results = await api.getCodes();
        if (!alive) return;
        const map: Record<string, CodeResult> = {};
        for (const r of results) map[r.id] = r;
        setCodes(map);
      } catch {
        // 忽略轮询错误
      }
    };

    const start = () => {
      if (timer !== undefined) return;
      tick();
      timer = window.setInterval(tick, 1000);
    };
    const stop = () => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [phase]);

  // 启动引导
  useEffect(() => {
    boot();
  }, [boot]);

  // 应用已保存的全局快捷键（仅首次设置加载后注册一次）
  const shortcutApplied = useRef(false);
  useEffect(() => {
    if (!settings || shortcutApplied.current) return;
    shortcutApplied.current = true;
    initToggleShortcut(settings.shortcutToggle).catch(() => {});
  }, [settings]);

  // 主题应用：设置变化时切换，system 模式跟随系统
  useEffect(() => {
    const mode = settings?.theme ?? "light";
    applyTheme(mode);
    if (mode !== "system") return;
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mql) return;
    const onChange = () => applyTheme("system");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [settings?.theme]);

  // 窗口尺寸：设置变化时应用对应宽度
  useEffect(() => {
    if (!settings?.windowSize) return;
    applyWindowSize(settings.windowSize).catch(() => {});
  }, [settings?.windowSize]);

  const value = useMemo<AppContextValue>(
    () => ({
      phase,
      route,
      navigate,
      goBack,
      accounts,
      categories,
      codes,
      settings,
      passwordHint,
      hasLock,
      error,
      setError,
      refreshAccounts,
      refreshCategories,
      refreshSettings,
      refreshLockState,
      boot,
      unlockWithPassword,
      lockApp,
      saveSettings,
    }),
    [
      phase,
      route,
      navigate,
      goBack,
      accounts,
      categories,
      codes,
      settings,
      passwordHint,
      hasLock,
      error,
      refreshAccounts,
      refreshCategories,
      refreshSettings,
      refreshLockState,
      boot,
      unlockWithPassword,
      lockApp,
      saveSettings,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
