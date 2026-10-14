import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, type AccountView, type AppSettings, type CodeResult } from "../lib/api";
import { applyTheme } from "../lib/theme";

export type Route =
  | { name: "codes" }
  | { name: "detail"; accountId: string }
  | { name: "add" }
  | { name: "edit"; accountId: string }
  | { name: "settings" }
  | { name: "security" }
  | { name: "importExport" }
  | { name: "lock" };

type LoadPhase = "booting" | "locked" | "ready";

interface AppContextValue {
  phase: LoadPhase;
  route: Route;
  navigate: (route: Route) => void;
  accounts: AccountView[];
  codes: Record<string, CodeResult>;
  settings: AppSettings | null;
  passwordHint: string;
  hasLock: boolean;
  error: string | null;
  setError: (msg: string | null) => void;
  refreshAccounts: () => Promise<void>;
  refreshSettings: () => Promise<void>;
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
  const [codes, setCodes] = useState<Record<string, CodeResult>>({});
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [passwordHint, setPasswordHint] = useState("");
  const [hasLock, setHasLock] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshAccounts = useCallback(async () => {
    const list = await api.listAccounts();
    setAccounts(list);
  }, []);

  const refreshSettings = useCallback(async () => {
    const s = await api.getSettings();
    setSettings(s);
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
      setPhase("ready");
      setRoute({ name: "codes" });
    } catch (e) {
      setError(String(e));
      setPhase("locked");
    }
  }, [refreshAccounts]);

  const unlockWithPassword = useCallback(
    async (password: string) => {
      try {
        setError(null);
        await api.unlock(password);
        const s = await api.getSettings();
        setSettings(s);
        await refreshAccounts();
        setPhase("ready");
        setRoute({ name: "codes" });
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      }
    },
    [refreshAccounts],
  );

  const lockApp = useCallback(async () => {
    await api.lock();
    setAccounts([]);
    setCodes({});
    setPhase("locked");
    setRoute({ name: "lock" });
  }, []);

  const saveSettings = useCallback(async (next: AppSettings) => {
    await api.updateSettings(next);
    setSettings(next);
  }, []);

  const navigate = useCallback((next: Route) => setRoute(next), []);

  // 解锁后轮询验证码
  useEffect(() => {
    if (phase !== "ready") return;
    let alive = true;
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
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [phase]);

  // 启动引导
  useEffect(() => {
    boot();
  }, [boot]);

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

  const value = useMemo<AppContextValue>(
    () => ({
      phase,
      route,
      navigate,
      accounts,
      codes,
      settings,
      passwordHint,
      hasLock,
      error,
      setError,
      refreshAccounts,
      refreshSettings,
      boot,
      unlockWithPassword,
      lockApp,
      saveSettings,
    }),
    [
      phase,
      route,
      navigate,
      accounts,
      codes,
      settings,
      passwordHint,
      hasLock,
      error,
      refreshAccounts,
      refreshSettings,
      boot,
      unlockWithPassword,
      lockApp,
      saveSettings,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
