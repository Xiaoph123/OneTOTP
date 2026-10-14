import { useEffect, useState } from "react";
import { api, type AccountView } from "../lib/api";
import { AddAccountPage } from "./AddAccountPage";

/** 编辑账户：加载账户后复用添加页的表单（编辑模式） */
export function EditAccountPage({ accountId }: { accountId: string }) {
  const [account, setAccount] = useState<AccountView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .getAccountDetail(accountId)
      .then(setAccount)
      .catch(() => setFailed(true));
  }, [accountId]);

  if (failed) {
    return (
      <>
        <header className="app-bar">
          <span style={{ fontSize: "var(--font-size-h4)", fontWeight: 500 }}>编辑账户</span>
        </header>
        <section className="app-body">
          <div className="empty-state">
            <span className="empty-desc">账户不存在或已被删除</span>
          </div>
        </section>
      </>
    );
  }

  if (!account) {
    return (
      <>
        <header className="app-bar">
          <span style={{ fontSize: "var(--font-size-h4)", fontWeight: 500 }}>编辑账户</span>
        </header>
        <section className="app-body">
          <div className="empty-state">
            <span className="empty-desc">正在加载账户信息…</span>
          </div>
        </section>
      </>
    );
  }

  return <AddAccountPage editing={account} />;
}
