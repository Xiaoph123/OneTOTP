import { AppProvider, useApp } from "./state/AppContext";
import { useAutoLock } from "./state/useAutoLock";
import { TitleBar } from "./components/TitleBar";
import { CodesPage } from "./pages/CodesPage";
import { DetailPage } from "./pages/DetailPage";
import { AddAccountPage } from "./pages/AddAccountPage";
import { EditAccountPage } from "./pages/EditAccountPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SecurityPage } from "./pages/SecurityPage";
import { ImportExportPage } from "./pages/ImportExportPage";
import { LockPage } from "./pages/LockPage";

function Router() {
  const { phase, route, error, setError } = useApp();
  useAutoLock();

  if (phase === "booting") {
    return (
      <div className="app-window">
        <TitleBar />
        <div className="boot-screen">
          <div className="boot-spinner" />
          <span style={{ fontSize: "var(--font-size-lead)" }}>正在启动 oneTotp…</span>
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
      {route.name === "importExport" ? <ImportExportPage /> : null}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  );
}
