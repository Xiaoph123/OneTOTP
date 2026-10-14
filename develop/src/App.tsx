import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { AppProvider, useApp } from "./state/AppContext";
import { useAutoLock } from "./state/useAutoLock";
import { useScreenshotProtection } from "./state/useScreenshotProtection";
import { applyFontScale } from "./lib/fontScale";
import { I18nProvider, useI18n } from "./i18n";
import { ToastProvider, useToast } from "./components/Toast";
import { TitleBar } from "./components/TitleBar";
import { OneTotpMarkLoading } from "./components/icons";
import { CodesPage } from "./pages/CodesPage";
import { DetailPage } from "./pages/DetailPage";
import { AddAccountPage } from "./pages/AddAccountPage";
import { EditAccountPage } from "./pages/EditAccountPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SecurityPage } from "./pages/SecurityPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { ImportExportPage } from "./pages/ImportExportPage";
import { LockPage } from "./pages/LockPage";

function Router() {
  const { phase, route, error, setError, settings, goBack } = useApp();
  const { t, setPref } = useI18n();
  const toast = useToast();
  useAutoLock();
  useScreenshotProtection(settings?.hideOnScreenshot ?? false);

  // 设置加载后同步语言偏好（auto 时由 Provider 跟随系统语言）
  useEffect(() => {
    if (settings?.language) setPref(settings.language);
  }, [settings?.language, setPref]);

  // 设置加载后同步字体大小
  useEffect(() => {
    const size = settings?.fontScale ?? "standard";
    applyFontScale(size);
  }, [settings?.fontScale]);

  // 移动端系统返回键桥接：Android 原生侧调用，返回 true 表示已处理（返回上一级）
  useEffect(() => {
    (window as unknown as { __handleAndroidBack?: () => boolean }).__handleAndroidBack = () => {
      // 有内层路由可返回时返回上一级
      return goBack();
    };
    return () => {
      delete (window as unknown as { __handleAndroidBack?: () => boolean }).__handleAndroidBack;
    };
  }, [goBack]);

  // 单实例：重复启动被拦截时提示「应用已在运行」
  useEffect(() => {
    const unlisten = listen("single-instance", () => {
      toast.warning(t("应用已在运行，请勿重复打开"));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [toast, t]);

  if (phase === "booting") {
    return (
      <div className="app-window">
        <TitleBar />
        <div className="boot-screen">
          <OneTotpMarkLoading className="boot-logo" />
          <span style={{ fontSize: "var(--font-size-lead)" }}>{t("正在启动 OneTotp…")}</span>
        </div>
      </div>
    );
  }

  if (phase === "locked") {
    return (
      <div className="app-window">
        <TitleBar />
        <LockPage />
      </div>
    );
  }

  return (
    <div className="app-window">
      <TitleBar />
      {error ? (
        <div
          className="notice"
          style={{
            margin: "10px 14px 0",
            background: "var(--status-yuanliDanger-2)",
            color: "var(--status-yuanliDanger-6)",
            cursor: "pointer",
          }}
          onClick={() => setError(null)}
        >
          {error}
        </div>
      ) : null}
      {route.name === "codes" ? <CodesPage /> : null}
      {route.name === "detail" ? <DetailPage accountId={route.accountId} /> : null}
      {route.name === "add" ? <AddAccountPage /> : null}
      {route.name === "edit" ? <EditAccountPage accountId={route.accountId} /> : null}
      {route.name === "settings" ? <SettingsPage /> : null}
      {route.name === "security" ? <SecurityPage /> : null}
      {route.name === "categories" ? <CategoriesPage /> : null}
      {route.name === "importExport" ? <ImportExportPage /> : null}
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AppProvider>
        <ToastProvider>
          <Router />
        </ToastProvider>
      </AppProvider>
    </I18nProvider>
  );
}
