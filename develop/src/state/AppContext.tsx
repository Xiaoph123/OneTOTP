import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, type AccountView, type AppSettings, type Category, type CodeResult } from "../lib/api";
import { applyTheme } from "../lib/theme";
import { applyWindowSize } from "../lib/windowSize";
import { applyCachedWindowSize } from "../lib/windowSize";
import { applyCachedFontScale } from "../lib/fontScale";
import { initToggleShortcut } from "../lib/shortcut";
import { isMobile } from "../lib/platform";
import { isLockSuppressed, markUnlocked } from "../lib/lockGuard";
import { isDragLocked } from "../lib/dragLock";

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

/** 验证码列表的筛选维度（移动端为底部导航的前三项） */
export type CodesFilter = "all" | "favorite" | "recent";

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
  /** 验证码列表筛选维度：移动端底部导航（验证码/收藏/最近）共用此状态，
   *  放在全局是为了切换页面后返回时仍保持上次选择。 */
  codesFilter: CodesFilter;
  setCodesFilter: (filter: CodesFilter) => void;
  refreshAccounts: () => Promise<void>;
  refreshCategories: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  /** 重新读取锁定状态（hasLock / 密码提示）。
   *  运行时开启或关闭「应用锁定」后必须调用：hasLock 是自动锁定的总闸门，
   *  若不刷新，本次会话内新开启的锁定不会生效、已关闭的锁定仍会触发锁定。 */
  refreshLockState: () => Promise<void>;
  /**
   * 与后端锁定状态对齐。
   * 某些锁定发生在原生侧（例如「关闭到托盘」时窗口被 Rust 隐藏，前端收不到
   * 失焦事件），此时前端仍停留在 ready 态，必须主动查询后端来纠正。
   */
  syncLockedState: () => Promise<void>;
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
  const [codesFilter, setCodesFilter] = useState<CodesFilter>("all");
  // 导航历史栈：记录来路，供返回键 / 返回按钮回退
  const historyRef = useRef<Route[]>([]);
  // phase 的实时镜像：供 lockApp 判断是否真的需要锁定，避免闭包读到旧值
  const phaseRef = useRef<LoadPhase>("booting");
  // 锁定进行中标志：保证 lockApp 幂等，避免同一事件被并发处理两次
  const lockingRef = useRef(false);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

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

  /**
   * 与后端锁定状态对齐：若后端已被锁定（原生侧的「关闭到托盘」会直接锁定），
   * 立刻把界面切回锁定页，避免重新显示窗口时还停留在明文验证码界面。
   */
  const syncLockedState = useCallback(async () => {
    if (phaseRef.current !== "ready") return;
    try {
      const status = await api.getStatus();
      if (!status.locked) return;
      // 未设置锁定密码时后端仍可能被锁定（「关闭到托盘」会直接清空内存密钥）。
      // 这种情况没有密码可输，切到锁定页只会得到一片空白，
      // 直接用机器密钥重新解锁即可。
      if (!status.hasLock) {
        await api.initializeVault();
        const s = await api.getSettings();
        setSettings(s);
        await refreshAccounts();
        await refreshCategories();
        markUnlocked();
        return;
      }
      setAccounts([]);
      setCategories([]);
      setCodes({});
      historyRef.current = [];
      setPhase("locked");
      setRoute({ name: "lock" });
    } catch {
      // 查询失败：下次获得焦点或取码失败时再校正
    }
  }, [refreshAccounts, refreshCategories]);

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
        markUnlocked();
        setPhase("ready");
        setRoute({ name: "codes" });
        return;
      }

      if (status.hasLock && status.locked) {
        // 锁定态读不到保险库里的设置（解密需要口令），用本机缓存还原
        // 窗口尺寸与字号，否则锁屏页会一直显示为默认尺寸，
        // 与「窗口尺寸」设置不符。
        applyCachedFontScale();
        void applyCachedWindowSize();
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
      markUnlocked();
      setPhase("ready");
      setRoute({ name: "codes" });
    } catch (e) {
      setError(String(e));
      // 出错时同样按缓存还原外观，避免锁屏页尺寸/字号跳变
      applyCachedFontScale();
      void applyCachedWindowSize();
      setPhase("locked");
    }
  }, [refreshAccounts, refreshCategories]);

  // 解锁完成的时间戳在 lib/lockGuard.ts 中统一记录（唯一状态源），
  // 这里不再各存一份，避免多处时间窗不一致导致漏判。

  const unlockWithPassword = useCallback(
    async (password: string) => {
      try {
        setError(null);
        await api.unlock(password);
        const s = await api.getSettings();
        setSettings(s);
        await refreshAccounts();
        await refreshCategories();
        markUnlocked();
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
    // 幂等：已在锁定流程中 / 已锁定 / 处于「不该锁定」的窗口内，均直接返回。
    // 这三道判断必须集中在一处：任何一处漏判都会造成「解锁即重锁」的死循环。
    if (lockingRef.current) return;
    if (phaseRef.current !== "ready") return;
    if (isLockSuppressed()) return;
    lockingRef.current = true;
    try {
      await api.lock();
      setAccounts([]);
      setCategories([]);
      setCodes({});
      // 清空导航历史：解锁后应回到首页，而不是沿用锁定前的深层页面
      historyRef.current = [];
      setPhase("locked");
      setRoute({ name: "lock" });
    } catch (e) {
      // 后端锁定失败（如 IPC 异常）时保持可用状态，但要让用户看到错误，
      // 不能静默失败后继续显示明文验证码。
      setError(String(e));
    } finally {
      lockingRef.current = false;
    }
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
      // 拖动排序期间跳过取码：每秒一次的重渲染会让拖动明显卡顿，
      // 且 React 更新 className 会覆盖 JS 动态加的拖动状态类。
      // 拖动只持续一两秒，验证码数字短暂不刷新无感知。
      if (isDragLocked()) return;
      try {
        const results = await api.getCodes();
        if (!alive) return;
        const map: Record<string, CodeResult> = {};
        for (const r of results) map[r.id] = r;
        setCodes(map);
      } catch (e) {
        // 取码失败：若原因是「应用未解锁」，说明后端已被原生侧锁定
        // （如「关闭到托盘」），立刻同步界面，别让旧验证码继续挂在屏幕上。
        if (String(e).includes("未解锁")) {
          void syncLockedState();
        }
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

    // 只有移动端才按「页面不可见」暂停轮询（省电）。
    //
    // 桌面端必须始终轮询：窗口被原生侧隐藏（关闭到托盘）再显示时，
    // WebView 的 visibility 未必变化、也不会产生焦点事件，若轮询因此停住，
    // 界面就永远发现不了「后端已经锁定」，表现为「从托盘打开直接进程序」。
    // 而这条轮询正是锁定状态最可靠的兜底：取码返回「应用未解锁」即同步界面。
    const pauseWhenHidden = isMobile();
    const onVisibilitySafe = () => {
      if (!pauseWhenHidden) return;
      onVisibility();
    };

    if (!pauseWhenHidden || document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilitySafe);

    return () => {
      alive = false;
      stop();
      document.removeEventListener("visibilitychange", onVisibilitySafe);
    };
  }, [phase]);

  // 启动引导
  useEffect(() => {
    boot();
  }, [boot]);

  // 原生侧通知「已锁定」（例如「关闭到托盘」时后端直接锁定）。
  // 窗口隐藏期间该事件会排队，恢复显示时送达；收到即切到锁定页，
  // 不依赖失焦事件或取码失败的推断。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("onetotp://locked", () => {
          // 复用同步逻辑：它会先确认后端确实已锁定，再切换界面
          void syncLockedState();
        }),
      )
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [syncLockedState]);

  // 托盘菜单「设置」：原生侧先显示窗口，再发此事件要求前端跳到设置页。
  // 若当前处于锁定态则忽略——锁定页没有设置入口，解锁后用户可自行进入。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>("onetotp://navigate", (event) => {
          if (phaseRef.current !== "ready") return;
          if (event.payload === "settings") setRoute({ name: "settings" });
        }),
      )
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // 应用已保存的全局快捷键（仅首次设置加载后注册一次）
  const shortcutApplied = useRef(false);
  useEffect(() => {
    if (!settings || shortcutApplied.current) return;
    shortcutApplied.current = true;
    initToggleShortcut(settings.shortcutToggle).catch(() => {});
  }, [settings]);

  // 主题应用：设置变化时切换，system 模式跟随系统
  useEffect(() => {
    const mode = settings?.theme ?? "system";
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
      codesFilter,
      setCodesFilter,
      refreshAccounts,
      refreshCategories,
      refreshSettings,
      refreshLockState,
      syncLockedState,
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
      codesFilter,
      setCodesFilter,
      refreshAccounts,
      refreshCategories,
      refreshSettings,
      refreshLockState,
      syncLockedState,
      boot,
      unlockWithPassword,
      lockApp,
      saveSettings,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
