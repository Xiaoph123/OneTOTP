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

/** 存储解锁口令所用的命名空间与键名 */
const DATA_DOMAIN = "com.wanghao.onetotp";
const DATA_NAME = "unlock-password";

export interface BiometricResult {
  ok: boolean;
  /** 失败原因码（用于 UI 区分「用户取消」等场景） */
  reason: string | null;
  /** 认证成功后返回的解锁口令 */
  password: string | null;
}

const FAIL_UNSUPPORTED: BiometricResult = { ok: false, reason: "unsupported", password: null };

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

/** 设备是否具备可用的生物识别能力（含是否已录入指纹/面容） */
export async function isBiometricSupported(): Promise<boolean> {
  if (!hasBiometricBridge()) return false;
  try {
    const status = await checkStatus();
    return status.isAvailable === true;
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

/** 把错误映射为稳定原因码，便于 UI 判断（如用户取消不提示错误） */
function toReason(e: unknown): string {
  const msg = String(e ?? "").toLowerCase();
  if (msg.includes("cancel")) return "cancelled";
  if (msg.includes("notenrolled") || msg.includes("not enrolled")) return "not_enrolled";
  if (msg.includes("notavailable")) return "unsupported";
  if (msg.includes("lockout")) return "lockout";
  if (msg.includes("notsupported")) return "unsupported";
  return "failed";
}

/**
 * 启用生物识别：把解锁口令交由系统密钥库加密保存。
 * 存储过程本身会触发一次系统认证，用户需确认授权。
 */
export async function enrollBiometric(password: string): Promise<BiometricResult> {
  if (!password) return { ok: false, reason: "empty_password", password: null };
  if (!hasBiometricBridge()) return FAIL_UNSUPPORTED;
  try {
    await setData({ domain: DATA_DOMAIN, name: DATA_NAME, data: password });
    return { ok: true, reason: null, password: null };
  } catch (e) {
    return { ok: false, reason: toReason(e), password: null };
  }
}

/**
 * 生物识别解锁：系统先弹认证，通过后返回解密出的口令。
 * 调用方拿到口令后走正常解锁流程。
 */
export async function authenticateBiometric(): Promise<BiometricResult> {
  if (!hasBiometricBridge()) return FAIL_UNSUPPORTED;
  try {
    const res = await getData({
      domain: DATA_DOMAIN,
      name: DATA_NAME,
      reason: "验证身份以解锁 OneTotp",
    });
    return { ok: true, reason: null, password: res.data };
  } catch (e) {
    return { ok: false, reason: toReason(e), password: null };
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
