import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { api, type AccountView } from "../lib/api";
import { decodeQrFromImage, detectNativeQr, isNativeQrSupported } from "../lib/qr";
import { Button, IconButton } from "../components/Button";
import { Select } from "../components/Select";
import { useToast } from "../components/Toast";
import { AlertTriangle, Camera, ChevronLeft, Check, Copy, Info, Upload } from "../components/icons";
import { copyText, parseDuplicateError } from "../lib/utils";
import { isMobile } from "../lib/platform";
import { useI18n } from "../i18n";

type Mode = "scan" | "manual" | "file";

const OTP_TYPES = [
  { value: "totp", label: "TOTP（基于时间）" },
  { value: "hotp", label: "HOTP（基于计数器）" },
];
const ALGORITHMS = ["SHA1", "SHA256", "SHA512"];
const DIGITS = [6, 7, 8];
const PERIODS = [30, 60];

/** 由账户信息重建 otpauth 链接 */
function buildOtpauth(a: {
  issuer: string;
  account: string;
  secret: string;
  otpType: string;
  algorithm: string;
  digits: number;
  period: number;
  counter: number;
}): string {
  const type = a.otpType === "hotp" ? "hotp" : "totp";
  const label = a.account ? `${a.issuer}:${a.account}` : a.issuer;
  const params = new URLSearchParams({
    secret: a.secret,
    issuer: a.issuer,
    algorithm: a.algorithm,
    digits: String(a.digits),
  });
  if (type === "hotp") {
    params.set("counter", String(a.counter));
  } else {
    params.set("period", String(a.period));
  }
  return `otpauth://${type}/${encodeURIComponent(label)}?${params.toString()}`;
}

interface Props {
  /** 编辑模式下传入待编辑账户 */
  editing?: AccountView;
}

/**
 * 把插件/系统抛出的各类错误转成可读文案。
 * 原生插件常抛出对象或 "cancelled" 字符串，直接 String() 会得到 [object Object]。
 */
function describeError(t: (k: string, p?: Record<string, string>) => string, e: unknown): string {
  const raw =
    typeof e === "string"
      ? e
      : e && typeof e === "object" && "message" in e
        ? String((e as { message: unknown }).message)
        : String(e);
  const lower = raw.toLowerCase();
  if (lower.includes("cancel")) return t("已取消扫码");
  if (lower.includes("permission")) return t("未授予相机权限，请在系统设置中开启后重试");
  if (lower.includes("no camera")) return t("未检测到可用的摄像头");
  return t("扫码失败：{msg}", { msg: raw });
}

export function AddAccountPage({ editing }: Props) {
  const { navigate, goBack, refreshAccounts, categories } = useApp();
  const toast = useToast();
  const { t } = useI18n();
  const isEdit = Boolean(editing);

  const [mode, setMode] = useState<Mode>(isEdit ? "manual" : "scan");
  // 显示名称（卡片标题）
  const [displayName, setDisplayName] = useState(editing?.issuer ?? "");
  // 账号（账户标识）
  const [account, setAccount] = useState(editing?.account ?? "");
  const [secret, setSecret] = useState(editing?.secret ?? "");
  const [token, setToken] = useState(
    editing
      ? buildOtpauth({
          issuer: editing.issuer,
          account: editing.account,
          secret: editing.secret,
          otpType: editing.otpType,
          algorithm: editing.algorithm,
          digits: editing.digits,
          period: editing.period,
          counter: editing.counter,
        })
      : "",
  );
  const [otpType, setOtpType] = useState(editing?.otpType ?? "totp");
  const [algorithm, setAlgorithm] = useState(editing?.algorithm ?? "SHA1");
  const [digits, setDigits] = useState(editing?.digits ?? 6);
  const [period, setPeriod] = useState(editing?.period ?? 30);
  const [counter, setCounter] = useState(editing?.counter ?? 0);
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? "");
  const [uriText, setUriText] = useState("");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [tokenNotice, setTokenNotice] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // 本次扫码是否走原生 BarcodeDetector 路径
  const nativeRef = useRef(false);

  /** 将解析出的账户信息填入表单 */
  const applyParsed = useCallback(
    (parsed: {
      issuer: string;
      account: string;
      secret: string;
      otpType: string;
      algorithm: string;
      digits: number;
      period: number;
      counter: number;
    }) => {
      setDisplayName(parsed.issuer);
      setAccount(parsed.account);
      setSecret(parsed.secret);
      setOtpType(parsed.otpType === "hotp" ? "hotp" : "totp");
      setAlgorithm(parsed.algorithm);
      setDigits(parsed.digits);
      setPeriod(parsed.period);
      setCounter(parsed.counter);
    },
    [],
  );

  const handleDecoded = useCallback(
    async (text: string) => {
      stopCamera();
      setScanNotice(t("已识别二维码，正在添加…"));
      try {
        const parsed = await api.parseOtpauth(text);
        await api.addAccount({
          issuer: parsed.issuer || parsed.account || t("未命名账户"),
          account: parsed.account,
          secret: parsed.secret,
          otpType: parsed.otpType,
          algorithm: parsed.algorithm,
          digits: parsed.digits,
          period: parsed.period,
          counter: parsed.counter,
          categoryId: "",
        });
        await refreshAccounts();
        toast.success(t("已扫码添加账户"));
        navigate({ name: "codes" });
      } catch (e) {
        // 重复账户：明确提示已存在，并给出可读文案
        const dup = parseDuplicateError(e);
        if (dup) {
          const label = dup.account ? `${dup.issuer}（${dup.account}）` : dup.issuer;
          const msg = t("该验证码已添加过：{name}，不能重复添加", { name: label });
          setScanNotice(msg);
          toast.warning(msg);
          return;
        }
        setScanNotice(t("未能识别二维码内容：{msg}", { msg: String(e) }));
        toast.error(t("二维码识别失败"));
      }
    },
    // 依赖里必须包含 t：否则切换语言后仍用首次渲染时的旧翻译
    [refreshAccounts, navigate, toast, t],
  );

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // 先断开 video 与流的绑定再停轨道：部分 WebView 版本下仅 stop track
    // 不会释放底层视频解码资源，反复开关会叠加占用。
    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
      } catch {
        // 忽略
      }
      video.srcObject = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  // <video> 挂载后再把摄像头流附加上去并启动解码循环。
  // 必须放在 effect 里：startCamera 中 setScanning(true) 之后 DOM 尚未更新，
  // 此时 videoRef.current 仍为 null，直接赋值会拿不到元素，表现为「开启摄像头后黑屏」。
  useEffect(() => {
    if (!scanning) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    const played = video.play();
    if (played && typeof played.catch === "function") played.catch(() => {});

    let stopped = false;

    // 两条解码路径：
    //  1) 原生 BarcodeDetector：detect(video) 在原生侧完成，不做 GPU→CPU 回读。
    //  2) jsQR 降级：drawImage + getImageData 回读，移动端按固定帧率节流。
    const startLoop = () => {
      const mobile = isMobile();
      const decodeMaxEdge = mobile ? 480 : 640;
      // 移动端统一 5fps（每 200ms 解码一次），桌面逐帧
      const intervalMs = mobile ? 200 : 0;

      const decodeOnce = async (): Promise<boolean> => {
        const v = videoRef.current;
        if (!v || v.readyState !== v.HAVE_ENOUGH_DATA) return false;
        if (nativeRef.current) {
          const text = await detectNativeQr(v);
          if (text) {
            handleDecoded(text);
            return true;
          }
          return false;
        }
        const text = decodeQrFromImage(v, v.videoWidth, v.videoHeight, true, decodeMaxEdge);
        if (text) {
          handleDecoded(text);
          return true;
        }
        return false;
      };

      // 节流循环：每轮解码完成后再排下一轮（而非固定帧率堆叠），
      // 避免解码慢于帧率时任务越积越多。
      const loop = () => {
        if (stopped) return;
        decodeOnce().then((done) => {
          if (stopped || done) return;
          if (intervalMs > 0) {
            timerRef.current = window.setTimeout(loop, intervalMs);
          } else {
            rafRef.current = requestAnimationFrame(loop);
          }
        });
      };
      if (intervalMs > 0) {
        timerRef.current = window.setTimeout(loop, intervalMs);
      } else {
        rafRef.current = requestAnimationFrame(loop);
      }
    };

    // 先探测原生能力，再决定走哪条路径
    isNativeQrSupported().then((native) => {
      if (stopped) return;
      nativeRef.current = native;
      startLoop();
    });

    return () => {
      stopped = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // 停止相机轨道，避免重复进入扫码页时残留占用
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [scanning, handleDecoded]);

  /** 解析「令牌」输入框中的 otpauth 链接并回填 */
  const handleParseToken = async () => {
    setTokenNotice(null);
    if (!token.trim()) {
      setTokenNotice(t("请粘贴 otpauth 链接"));
      return;
    }
    try {
      const parsed = await api.parseOtpauth(token.trim());
      applyParsed(parsed);
      setTokenNotice(t("已从令牌解析账户信息"));
    } catch (e) {
      setTokenNotice(t("令牌解析失败：{msg}", { msg: String(e) }));
    }
  };

  /** 从图片文件解码二维码（完全离线） */
  const handlePickImage = () => {
    setScanNotice(null);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      // 限制图片大小：超大图解码后占用内存极高，可能卡死 WebView
      const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
      if (file.size > MAX_IMAGE_BYTES) {
        setScanNotice(t("图片过大（超过 10MB），请选择较小的图片"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const text = decodeQrFromImage(img, img.naturalWidth, img.naturalHeight);
          if (text) {
            handleDecoded(text);
          } else {
            setScanNotice(t("未在图片中识别到二维码，请尝试更清晰、完整包含二维码的图片"));
          }
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  /**
   * 发起扫码。
   * 移动端（Android / iOS）走原生相机插件：WebView 的 getUserMedia 视频管线
   * 在部分 Android 设备上出帧帧率极低（实测约 1~2fps），预览严重卡顿不可用，
   * 原生相机完全绕开该管线。桌面端仍用 WebView 摄像头 + jsQR。
   */
  const startCamera = async () => {
    setScanNotice(null);

    if (isMobile()) {
      setScanning(true);
      let cancelScan: (() => Promise<void>) | null = null;
      try {
        const { scan, cancel, Format, requestPermissions, checkPermissions } = await import(
          "@tauri-apps/plugin-barcode-scanner"
        );
        // 插件不会自动申请相机权限，必须先显式请求，否则 scan 会直接抛异常
        let state = await checkPermissions();
        if (state !== "granted") {
          state = await requestPermissions();
        }
        if (state !== "granted") {
          setScanNotice(t("未授予相机权限，请在系统设置中开启后重试"));
          return;
        }
        // 原生相机是全屏覆盖层，会盖住应用 UI（没有可见的返回按钮）。
        // 注册取消钩子，让系统返回键能关闭扫描页而不是退出应用。
        cancelScan = async () => {
          try {
            await cancel();
          } catch {
            // 忽略：扫描可能已结束
          }
        };
        (window as unknown as { __cancelActiveScan?: () => Promise<void> }).__cancelActiveScan =
          cancelScan;

        // windowed=false：原生相机全屏覆盖（windowed=true 是让 WebView 透明、
        // 相机置于其后，会被本页背景遮住，不适合当前全屏扫码体验）
        const result = await scan({ windowed: false, formats: [Format.QRCode] });
        const text = result?.content;
        if (text) {
          await handleDecoded(text);
        }
      } catch (e) {
        // 用户取消或权限被拒：给出可读提示
        setScanNotice(describeError(t, e));
      } finally {
        delete (window as unknown as { __cancelActiveScan?: () => Promise<void> })
          .__cancelActiveScan;
        setScanning(false);
      }
      return;
    }

    try {
      // 采集分辨率压到 640x480：相机启动初期给的是低分辨率预览帧，
      // 约 2 秒对焦稳定后会切到请求的高分辨率，每帧数据量骤增、
      // 合成与缩放开销翻倍——这正是「2 秒后开始卡」的诱因。
      // 扫码只需 640 级别即可识别，用 ideal 让浏览器在不支持时回退。
      // frameRate 显式要求 30fps：低光照下相机为提升曝光会自动降帧，
      // 这里给出期望值，尽量让相机维持较高帧率。
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, min: 15 },
        },
        audio: false,
      });
      streamRef.current = stream;
      // 仅置位状态，实际的流绑定与逐帧解码在 scanning 的 effect 中完成
      setScanning(true);
    } catch {
      setScanning(false);
      setScanNotice(t("无法访问摄像头，请改用「从图片选择」方式。"));
    }
  };

  const handleSave = async () => {
    setLocalError(null);
    setSaving(true);
    try {
      if (!displayName.trim()) throw new Error(t("请填写显示名称"));
      if (!secret.trim()) throw new Error(t("请填写密钥"));
      const payload = {
        issuer: displayName.trim(),
        account: account.trim(),
        secret,
        otpType,
        algorithm,
        digits,
        period,
        counter,
        categoryId,
      };
      if (isEdit && editing) {
        await api.updateAccount(editing.id, payload);
        toast.success(t("账户已更新"));
      } else {
        await api.addAccount(payload);
        toast.success(t("账户已添加"));
      }
      await refreshAccounts();
      navigate({ name: "codes" });
    } catch (e) {
      // 重复账户：后端返回 duplicate:{issuer}|{account}，给出明确提示
      const dup = parseDuplicateError(e);
      if (dup) {
        const label = dup.account ? `${dup.issuer}（${dup.account}）` : dup.issuer;
        const msg =
          isEdit && editing
            ? t("该验证码已存在于「{name}」，不能重复", { name: label })
            : t("该验证码已添加过：{name}，不能重复添加", { name: label });
        setLocalError(msg);
        toast.warning(msg);
        return;
      }
      const msg = String(e);
      setLocalError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleImportFile = async () => {
    setLocalError(null);
    try {
      if (!uriText.trim()) throw new Error(t("请粘贴 otpauth 链接"));
      const { added, skipped } = await api.importOtpauthText(uriText);
      await refreshAccounts();
      if (added === 0 && skipped > 0) {
        // 全部重复：明确告知，不跳转
        const msg = t("这 {n} 个账户都已存在，未新增任何账户", { n: skipped });
        setLocalError(msg);
        toast.warning(msg);
        return;
      }
      if (skipped > 0) {
        toast.success(t("已导入 {added} 个账户，跳过 {skipped} 个重复项", { added, skipped }));
      } else {
        toast.success(t("已导入 {n} 个账户", { n: added }));
      }
      navigate({ name: "codes" });
    } catch (e) {
      const msg = String(e);
      setLocalError(msg);
      toast.error(msg);
    }
  };

  return (
    <>
      <header className="app-bar">
        <IconButton label={t("返回")} onClick={() => goBack()}>
          <ChevronLeft />
        </IconButton>
        <span className="app-bar-title">
          {isEdit ? t("编辑账户") : t("添加账户")}
        </span>
      </header>

      <section className="app-body">
        {!isEdit ? (
          <div className="segmented segmented-fill segmented-full mb-12" role="tablist">
            {(
              [
                ["scan", t("扫码")],
                ["manual", t("手动")],
                ["file", t("文件")],
              ] as [Mode, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                className={mode === key ? "active" : ""}
                onClick={() => {
                  setMode(key);
                  if (key !== "scan") stopCamera();
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {mode === "scan" && !isEdit ? (
          <div className="panel panel-pad">
            <div className="scan-box">
              {/* 移动端走原生相机（全屏原生取景），此处只显示图标占位 */}
              {scanning && !isMobile() ? (
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="scan-video"
                />
              ) : (
                <div className="qr-placeholder" aria-label={t("扫码区域")}>
                  <svg viewBox="0 0 64 64" width="120" height="120" aria-hidden>
                    <rect x="2" y="2" width="60" height="60" rx="8" fill="var(--color-bg-5)" />
                    <path d="M18 18h12v12H18zM34 18h12v12H34zM18 34h12v12H18z" fill="var(--color-border-4)" />
                    <path d="M34 34h4v4h-4zM42 34h4v4h-4zM34 42h4v4h-4zM42 42h4v4h-4z" fill="var(--color-primary)" />
                  </svg>
                </div>
              )}
              <div className="scan-caption">
                <div className="scan-caption-title">
                  {scanning ? t("正在识别二维码…") : t("扫描二维码添加账户")}
                </div>
                <div className="scan-caption-desc">
                  {t("支持摄像头实时扫码，或从本地图片识别（完全离线）")}
                </div>
              </div>
              <div className="scan-actions">
                {/* 移动端原生扫描期间由系统取景页自行管理，不显示停止按钮 */}
                {scanning && !isMobile() ? (
                  <Button variant="secondary" block onClick={stopCamera}>
                    {t("停止扫描")}
                  </Button>
                ) : scanning ? null : (
                  <Button
                    variant="primary"
                    block
                    icon={<Camera className="icon-16" />}
                    onClick={startCamera}
                  >
                    {t("开启摄像头")}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  block
                  icon={<Upload className="icon-16" />}
                  onClick={handlePickImage}
                >
                  {t("从图片选择")}
                </Button>
              </div>
            </div>
            {scanNotice ? (
              <div className="notice notice-info mt-12">
                <Info className="icon-primary" />
                {scanNotice}
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === "manual" || isEdit ? (
          <div className="panel panel-pad">
            <div className="block-title mb-4">
              {isEdit ? t("编辑账户信息") : t("手动添加到身份验证器")}
            </div>
            <div className="block-desc form-intro">
              {t("填写显示名称与密钥，或直接粘贴令牌自动解析")}
            </div>

            <div className="col-gap-14">
              {/* 显示名称 */}
              <div className="field">
                <label className="field-label">
                  {t("显示名称")} <span className="req">*</span>
                </label>
                <div className="input-with-action">
                  <input
                    className="ui-input has-action"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t("例如 GitHub、公司 VPN")}
                  />
                  <IconButton
                    label={t("复制显示名称")}
                    className="input-action"
                    onClick={() => displayName && copyText(displayName)}
                  >
                    <Copy />
                  </IconButton>
                </div>
                <span className="field-help">{t("显示在验证码卡片上的名称。")}</span>
              </div>

              {/* 账号 */}
              <div className="field">
                <label className="field-label">{t("账号")}</label>
                <div className="input-with-action">
                  <input
                    className="ui-input has-action"
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    placeholder={t("例如 wanghao@example.com")}
                  />
                  <IconButton
                    label={t("复制账号")}
                    className="input-action"
                    onClick={() => account && copyText(account)}
                  >
                    <Copy />
                  </IconButton>
                </div>
                <span className="field-help">{t("用于区分同一服务下的多个账户。")}</span>
              </div>

              {/* 密钥 */}
              <div className="field">
                <label className="field-label">
                  {t("密钥")} <span className="req">*</span>
                </label>
                <div className="input-with-action">
                  <input
                    className="ui-input has-action font-mono"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={t("Base32 密钥，例如 JBSWY3DPEHPK3PXP")}
                  />
                  <IconButton
                    label={t("复制密钥")}
                    className="input-action"
                    onClick={() => secret && copyText(secret)}
                  >
                    <Copy />
                  </IconButton>
                </div>
                <span className="field-help">{t("密钥仅保存在本机，不会上传。")}</span>
              </div>

              {/* 令牌 */}
              <div className="field">
                <label className="field-label">{t("令牌")}</label>
                <div className="input-with-action">
                  <input
                    className="ui-input has-action font-mono token-input"
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value);
                      setTokenNotice(null);
                    }}
                    placeholder={t("粘贴 otpauth:// 链接可自动解析")}
                  />
                  <IconButton
                    label={t("复制令牌")}
                    className="input-action"
                    onClick={() => token && copyText(token)}
                  >
                    <Copy />
                  </IconButton>
                </div>
                {!isEdit ? (
                  <button
                    type="button"
                    onClick={handleParseToken}
                    className="link-btn"
                  >
                    {t("从令牌解析并回填")}
                  </button>
                ) : null}
              </div>

              {tokenNotice ? (
                <div className="notice notice-info">
                  <Info className="icon-primary" />
                  {tokenNotice}
                </div>
              ) : null}

              {/* 高级选项（始终展开） */}
              <div className="advanced-section">
                <div className="advanced-title">
                  {t("高级选项")}
                </div>
                <div className="advanced-grid">
                  <div className="field">
                    <label className="field-label">{t("类型")}</label>
                    <Select
                      value={otpType}
                      onChange={setOtpType}
                      options={OTP_TYPES.map((o) => ({ value: o.value, label: t(o.label) }))}
                    />
                  </div>
                  <div className="field">
                    <label className="field-label">{t("算法")}</label>
                    <Select
                      value={algorithm}
                      onChange={setAlgorithm}
                      options={ALGORITHMS.map((a) => ({ value: a, label: a }))}
                    />
                  </div>
                  <div className="field">
                    <label className="field-label">{t("位数")}</label>
                    <Select
                      value={digits}
                      onChange={setDigits}
                      options={DIGITS.map((d) => ({ value: d, label: t("{n} 位", { n: d }) }))}
                    />
                  </div>
                  {otpType === "hotp" ? (
                    <div className="field">
                      <label className="field-label">{t("计数器")}</label>
                      <input
                        className="ui-input"
                        type="number"
                        min={0}
                        value={counter}
                        onChange={(e) => setCounter(Number(e.target.value) || 0)}
                        placeholder="0"
                      />
                    </div>
                  ) : (
                    <div className="field">
                      <label className="field-label">{t("周期")}</label>
                      <Select
                        value={period}
                        onChange={setPeriod}
                        options={PERIODS.map((p) => ({ value: p, label: t("{n} 秒", { n: p }) }))}
                      />
                    </div>
                  )}
                  <div className="field">
                    <label className="field-label">{t("分类")}</label>
                    <Select
                      value={categoryId}
                      onChange={setCategoryId}
                      options={[
                        { value: "", label: t("未分类") },
                        ...categories.map((c) => ({ value: c.id, label: c.name })),
                      ]}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {mode === "file" && !isEdit ? (
          <div className="panel panel-pad">
            <div className="block-title mb-12">{t("从文本导入")}</div>
            <div className="field">
              <label className="field-label">{t("粘贴 otpauth 链接")}</label>
              <textarea
                className="ui-textarea"
                value={uriText}
                onChange={(e) => setUriText(e.target.value)}
                placeholder={t("每行一条，例如：\notpauth://totp/GitHub:wanghao@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub")}
                rows={6}
              />
              <span className="field-help">{t("支持一次导入多条，逐行解析 otpauth 链接。")}</span>
            </div>
            <Button
              variant="secondary"
              block
              className="mt-12"
              icon={<Upload className="icon-14" />}
              onClick={handleImportFile}
            >
              {t("解析并导入")}
            </Button>
          </div>
        ) : null}

        {localError ? (
          <div className="notice notice-err mt-12">
            <AlertTriangle />
            {localError}
          </div>
        ) : null}

        {!isEdit ? (
          <div className="notice notice-info mt-12">
            <Info className="icon-primary" />
            {t("请定期导出加密备份；同时在各服务保存好备用恢复码，避免设备丢失后无法登录。")}
          </div>
        ) : null}
      </section>

      {mode === "manual" || isEdit ? (
        <div className="sticky-actions">
          <Button onClick={() => navigate({ name: "codes" })}>{t("取消")}</Button>
          <Button
            variant="primary"
            block
            disabled={saving}
            icon={<Check className="icon-14" />}
            onClick={() => handleSave()}
          >
            {isEdit ? t("保存修改") : t("保存账户")}
          </Button>
        </div>
      ) : null}
    </>
  );
}
