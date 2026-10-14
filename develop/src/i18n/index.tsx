import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { en } from "./en";
import { zh } from "./zh";

/** 实际生效的语言 */
export type Language = "zh" | "en";
/** 语言偏好：auto 表示跟随系统语言环境 */
export type LangPref = "auto" | Language;

type Params = Record<string, string | number>;

interface I18nContextValue {
  /** 实际生效的语言 */
  lang: Language;
  /** 用户选择的语言偏好（含 auto） */
  pref: LangPref;
  /** 翻译：以中文原文为 key，英文缺失时回退中文 */
  t: (key: string, params?: Params) => string;
  setPref: (pref: LangPref) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n 必须在 I18nProvider 内使用");
  return ctx;
}

const STORAGE_KEY = "onetotp.lang";

/** 读取系统语言环境：中文返回 zh，其余一律返回 en */
function detectSystemLang(): Language {
  if (typeof navigator === "undefined") return "en";
  const candidates = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const item of candidates) {
    const tag = (item || "").toLowerCase();
    if (tag.startsWith("zh")) return "zh";
    if (tag.startsWith("en")) return "en";
  }
  // 既非中文也非英文：默认英文
  return "en";
}

/** 依据偏好解析出实际语言 */
function resolveLang(pref: LangPref, systemLang: Language): Language {
  return pref === "auto" ? systemLang : pref;
}

function detectInitialPref(): LangPref {
  const saved = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  if (saved === "zh" || saved === "en" || saved === "auto") return saved;
  return "auto";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPrefState] = useState<LangPref>(detectInitialPref);
  const [systemLang, setSystemLang] = useState<Language>(detectSystemLang);

  const lang = resolveLang(pref, systemLang);

  const setPref = useCallback((next: LangPref) => {
    setPrefState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 忽略存储失败
    }
  }, []);

  // auto 模式下跟随系统语言变化
  useEffect(() => {
    if (pref !== "auto" || typeof window === "undefined") return;
    const onLangChange = () => setSystemLang(detectSystemLang());
    window.addEventListener("languagechange", onLangChange);
    return () => window.removeEventListener("languagechange", onLangChange);
  }, [pref]);

  useEffect(() => {
    document.documentElement.setAttribute("lang", lang === "zh" ? "zh-CN" : "en");
  }, [lang]);

  const t = useCallback(
    (key: string, params?: Params) => {
      const dict = lang === "en" ? en : zh;
      let text = dict[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return text;
    },
    [lang],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ lang, pref, t, setPref }),
    [lang, pref, t, setPref],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
