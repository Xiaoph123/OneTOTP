/**
 * 生物识别解锁（跨平台统一抽象层）。
 *
 * 底层使用 `tauri-plugin-biometry`，覆盖：
 *   - Windows：Windows Hello（指纹 / 人脸 / PIN），凭据基于 WebAuthn PRF 派生 AES-256-GCM 密钥
 *   - macOS：Touch ID（需 App 代码签名才能使用 Keychain 存储）
 *   - Android / iOS：系统指纹 / 面容
 *   - Linux：无统一生物识别接口（仅 fprintd，需用户自行安装并录入），不支持
 *
 * 安全模型：不自行保存解锁口令的明文或密文，而是把口令交给插件的
 * `setData`，由系统密钥库（macOS/iOS Keychain、Android Keystore、
 * Windows Hello 凭据）绑定生物认证加密存储；`getData` 时系统会先弹
 * 认证，认证通过才返回口令，再由前端走正常解锁流程。
 */

import {
  checkStatus,
  getData,
  hasData,
  removeData,
  setData,
} from "@choochmeque/tauri-plugin-biometry-api";
import { isDesktop } from "./platform";
import { isLockSuppressed, markBiometricEnd, markBiometricStart } from "./lockGuard";

/** 存储解锁口令所用的命名空间与键名 */
const DATA_DOMAIN = "com.wanghao.onetotp";
const DATA_NAME = "unlock-password";

export interface BiometricResult {
  ok: boolean;
  /** 失败原因码（用于 UI 区分「用户取消」等场景） */
  reason: string | null;
  /** 认证成功后返回的解锁口令 */
  password: string | null;
  /** 原始错误文本，供界面提示与问题排查使用 */
  detail?: string;
}

const FAIL_UNSUPPORTED: BiometricResult = {
  ok: false,
  reason: "unsupported",
  password: null,
};

/**
 * 是否应把当前的前台/可见性变化视为「系统认证弹窗引起」而忽略。
 *
 * 实现已上移到 `lib/lockGuard.ts`（唯一状态源）：本模块只负责在认证前后
 * 打点，判定逻辑与自动锁定共用一份，避免两处各存一套时间窗而漏判。
 */
export function isBiometricOverlayActive(): boolean {
  return isLockSuppressed();
}


/**
 * 当前平台是否可能支持生物识别。
 * Linux 桌面端直接判否，避免调用不存在的插件命令。
 */
export function hasBiometricBridge(): boolean {
  if (typeof navigator === "undefined") return false;
  if (isDesktop()) {
    const ua = navigator.userAgent;
    // 仅 Windows / macOS 桌面端支持；Linux 无统一接口
    return /Windows/i.test(ua) || /Macintosh|Mac OS X/i.test(ua);
  }
  return true; // 移动端（Android / iOS）均支持
}

/**
 * 设备能力探测结果缓存。
 * `checkStatus()` 在 Windows 上是 WinRT 冷启动调用（数百毫秒），
 * 而设备能力在应用生命周期内几乎不变，故缓存结果避免重复等待。
 * 仅缓存「支持」结论——不支持可能是临时状态（如系统暂时禁用），下次仍需重查。
 */
let supportedCache: boolean | null = null;

/** 设备是否具备可用的生物识别能力（含是否已录入指纹/面容） */
export async function isBiometricSupported(): Promise<boolean> {
  if (!hasBiometricBridge()) return false;
  if (supportedCache === true) return true;
  try {
    const status = await checkStatus();
    const ok = status.isAvailable === true;
    if (ok) supportedCache = true;
    return ok;
  } catch {
    return false;
  }
}

/** 是否已用生物识别保存过解锁凭据 */
export async function isBiometricEnrolled(): Promise<boolean> {
  if (!hasBiometricBridge()) return false;
  try {
    return await hasData({ domain: DATA_DOMAIN, name: DATA_NAME });
  } catch {
    return false;
  }
}

/**
 * 把插件抛出的错误还原成可判断的文本。
 *
 * 关键：插件走 Tauri 的 `InvokeRejected`，错误到达 JS 时往往是
 * **对象**（`{ code, message, data }`）而不是字符串。旧实现直接 `String(e)`，
 * 结果恒为 "[object Object]"，所有失败都被归为 `failed`，
 * 既分不清「用户取消 / 凭据失效 / 解密失败」，也让界面只能给一句泛泛提示。
 */
function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const obj = e as { code?: unknown; message?: unknown };
    const parts = [obj.code, obj.message].filter((v) => typeof v === "string" && v);
    if (parts.length > 0) return parts.join(" ");
    try {
      return JSON.stringify(e);
    } catch {
      return "";
    }
  }
  return String(e ?? "");
}

/** 把错误映射为稳定原因码，便于 UI 判断（如用户取消不提示错误） */
function toReason(e: unknown): string {
  const msg = errorText(e).toLowerCase();
  // 顺序要紧：userCancel 里含 cancel，必须优先判为「取消」
  if (msg.includes("cancel")) return "cancelled";
  if (msg.includes("lockout")) return "lockout";
  // 凭据/数据不存在：说明本机 Hello 凭据已失效（重设 PIN、换机、被系统清理等），
  // 但加密数据条目可能仍在——这正是「开关看着是开的，却弹不出认证框」的成因。
  if (
    msg.includes("credentialnotfound") ||
    msg.includes("credential not found") ||
    msg.includes("credential not available") ||
    msg.includes("datanotfound") ||
    msg.includes("failed to retrieve data")
  ) {
    return "credential_missing";
  }
  if (msg.includes("decryptionfailed")) return "decryption_failed";
  if (msg.includes("notenrolled") || msg.includes("not enrolled")) return "not_enrolled";
  if (msg.includes("notavailable") || msg.includes("notsupported")) return "unsupported";
  return "failed";
}

/**
 * 启用生物识别：把解锁口令交由系统密钥库加密保存。
 * 存储过程本身会触发一次系统认证，用户需确认授权。
 */
export async function enrollBiometric(password: string): Promise<BiometricResult> {
  if (!password) return { ok: false, reason: "empty_password", password: null };
  if (!hasBiometricBridge()) return FAIL_UNSUPPORTED;
  markBiometricStart();
  try {
    await setData({ domain: DATA_DOMAIN, name: DATA_NAME, data: password });
    return { ok: true, reason: null, password: null };
  } catch (e) {
    return { ok: false, reason: toReason(e), password: null, detail: errorText(e) };
  } finally {
    markBiometricEnd();
  }
}

/**
 * 生物识别解锁：系统先弹认证，通过后返回解密出的口令。
 * 调用方拿到口令后走正常解锁流程。
 *
 * @param reason    系统弹窗中显示的验证原因文案
 * @param cancelTitle 系统弹窗「取消」按钮文案（缺省时由原生侧回退为「取消」）
 */
export async function authenticateBiometric(reason?: string, cancelTitle?: string): Promise<BiometricResult> {
  if (!hasBiometricBridge()) return FAIL_UNSUPPORTED;
  markBiometricStart();
  try {
    const res = await getData({
      domain: DATA_DOMAIN,
      name: DATA_NAME,
      reason: reason || "验证身份以解锁 OneTOTP",
      cancelTitle,
    });
    return { ok: true, reason: null, password: res.data };
  } catch (e) {
    return { ok: false, reason: toReason(e), password: null, detail: errorText(e) };
  } finally {
    markBiometricEnd();
  }
}

/** 清除生物识别凭据（关闭开关或凭据失效时调用） */
export async function clearBiometric(): Promise<void> {
  if (!hasBiometricBridge()) return;
  try {
    await removeData({ domain: DATA_DOMAIN, name: DATA_NAME });
  } catch {
    // 忽略：清理失败不影响主流程
  }
}
