import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import { api, type AccountView } from "../lib/api";
import { decodeQrFromImage } from "../lib/qr";
import { Button, IconButton } from "../components/Button";
import { Select } from "../components/Select";
import { useToast } from "../components/Toast";
import { AlertTriangle, Camera, ChevronLeft, Check, Copy, Info, Upload } from "../components/icons";
import { copyText } from "../lib/utils";
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
  const streamRef = useRef<MediaStream | null>(null);

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
        setScanNotice(t("未能识别二维码内容：{msg}", { msg: String(e) }));
        toast.error(t("二维码识别失败"));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshAccounts, navigate, toast],
  );

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

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

  /** 使用摄像头实时扫码（完全离线） */
  const startCamera = async () => {
    setScanNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setScanning(true);
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      const tick = () => {
        const v = videoRef.current;
        if (v && v.readyState === v.HAVE_ENOUGH_DATA) {
          const text = decodeQrFromImage(v, v.videoWidth, v.videoHeight, true);
          if (text) {
            handleDecoded(text);
            return;
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setScanning(false);
      setScanNotice(t("无法访问摄像头，请改用「从图片选择」方式。"));
    }
  };

  const handleSave = async (keepGoing: boolean) => {
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
      if (keepGoing && !isEdit) {
        setDisplayName("");
        setAccount("");
        setSecret("");
        setToken("");
        setOtpType("totp");
        setAlgorithm("SHA1");
        setDigits(6);
        setPeriod(30);
        setCounter(0);
        setCategoryId("");
      } else {
        navigate({ name: "codes" });
      }
    } catch (e) {
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
      const count = await api.importOtpauthText(uriText);
      await refreshAccounts();
      toast.success(t("已导入 {n} 个账户", { n: count }));
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
        <span style={{ fontSize: "var(--font-size-h4)", fontWeight: 500 }}>
          {isEdit ? t("编辑账户") : t("添加账户")}
        </span>
      </header>

      <section className="app-body">
        {!isEdit ? (
          <div className="segmented" style={{ width: "100%", marginBottom: 12 }} role="tablist">
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
                style={{ flex: 1 }}
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
          <div className="panel" style={{ padding: 14 }}>
            <div className="scan-box">
              {scanning ? (
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  style={{
                    width: 200,
                    height: 200,
                    borderRadius: "var(--radius-md)",
                    objectFit: "cover",
                    background: "#000",
                  }}
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
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "var(--font-size-lead)", fontWeight: 500 }}>
                  {scanning ? t("正在识别二维码…") : t("扫描二维码添加账户")}
                </div>
                <div style={{ fontSize: "var(--font-size-body)", color: "var(--color-text-3)", marginTop: 3 }}>
                  {t("支持摄像头实时扫码，或从本地图片识别（完全离线）")}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {scanning ? (
                  <Button variant="secondary" onClick={stopCamera}>
                    {t("停止扫描")}
                  </Button>
                ) : (
                  <Button variant="primary" icon={<Camera style={{ width: 14, height: 14 }} />} onClick={startCamera}>
                    {t("开启摄像头")}
                  </Button>
                )}
                <Button variant="secondary" icon={<Upload style={{ width: 14, height: 14 }} />} onClick={handlePickImage}>
                  {t("从图片选择")}
                </Button>
              </div>
            </div>
            {scanNotice ? (
              <div
                className="notice"
                style={{
                  marginTop: 12,
                  background: "var(--color-primary-container)",
                  color: "var(--color-on-primary-container)",
                }}
              >
                <Info style={{ color: "var(--color-primary)" }} />
                {scanNotice}
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === "manual" || isEdit ? (
          <div className="panel" style={{ padding: 14 }}>
            <div style={{ fontSize: "var(--font-size-h4)", fontWeight: 500, marginBottom: 4 }}>
              {isEdit ? t("编辑账户信息") : t("手动添加到身份验证器")}
            </div>
            <div style={{ fontSize: "var(--font-size-body)", color: "var(--color-text-3)", marginBottom: 14 }}>
              {t("填写显示名称与密钥，或直接粘贴令牌自动解析")}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* 显示名称 */}
              <div className="field">
                <label className="field-label">
                  {t("显示名称")} <span className="req">*</span>
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    className="ui-input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t("例如 GitHub、公司 VPN")}
                    style={{ paddingRight: 40 }}
                  />
                  <IconButton
                    label={t("复制显示名称")}
                    style={{ position: "absolute", right: 4, top: 0 }}
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
                <div style={{ position: "relative" }}>
                  <input
                    className="ui-input"
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    placeholder={t("例如 wanghao@example.com")}
                    style={{ paddingRight: 40 }}
                  />
                  <IconButton
                    label={t("复制账号")}
                    style={{ position: "absolute", right: 4, top: 0 }}
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
                <div style={{ position: "relative" }}>
                  <input
                    className="ui-input"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder={t("Base32 密钥，例如 JBSWY3DPEHPK3PXP")}
                    style={{ paddingRight: 40, fontFamily: "var(--font-mono)" }}
                  />
                  <IconButton
                    label={t("复制密钥")}
                    style={{ position: "absolute", right: 4, top: 0 }}
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
                <div style={{ position: "relative" }}>
                  <input
                    className="ui-input"
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value);
                      setTokenNotice(null);
                    }}
                    placeholder={t("粘贴 otpauth:// 链接可自动解析")}
                    style={{ paddingRight: 40, fontFamily: "var(--font-mono)", fontSize: "var(--font-size-body)" }}
                  />
                  <IconButton
                    label={t("复制令牌")}
                    style={{ position: "absolute", right: 4, top: 0 }}
                    onClick={() => token && copyText(token)}
                  >
                    <Copy />
                  </IconButton>
                </div>
                {!isEdit ? (
                  <button
                    type="button"
                    onClick={handleParseToken}
                    style={{
                      alignSelf: "flex-start",
                      marginTop: 2,
                      padding: 0,
                      border: "none",
                      background: "transparent",
                      color: "var(--color-primary)",
                      fontSize: "var(--font-size-body)",
                      cursor: "pointer",
                    }}
                  >
                    {t("从令牌解析并回填")}
                  </button>
                ) : null}
              </div>

              {tokenNotice ? (
                <div
                  className="notice"
                  style={{
                    background: "var(--color-primary-container)",
                    color: "var(--color-on-primary-container)",
                  }}
                >
                  <Info style={{ color: "var(--color-primary)" }} />
                  {tokenNotice}
                </div>
              ) : null}

              {/* 高级选项（始终展开） */}
              <div
                style={{
                  borderTop: "1px solid var(--color-border-light)",
                  paddingTop: 14,
                }}
              >
                <div style={{ fontSize: "var(--font-size-lead)", fontWeight: 500, marginBottom: 12 }}>
                  {t("高级选项")}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
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
          <div className="panel" style={{ padding: 14 }}>
            <div style={{ fontSize: "var(--font-size-h4)", fontWeight: 500, marginBottom: 12 }}>{t("从文本导入")}</div>
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
              style={{ marginTop: 12 }}
              icon={<Upload style={{ width: 14, height: 14 }} />}
              onClick={handleImportFile}
            >
              {t("解析并导入")}
            </Button>
          </div>
        ) : null}

        {localError ? (
          <div
            className="notice"
            style={{ marginTop: 12, background: "var(--status-yuanliDanger-2)", color: "var(--status-yuanliDanger-6)" }}
          >
            <AlertTriangle style={{ color: "var(--status-yuanliDanger-6)" }} />
            {localError}
          </div>
        ) : null}

        {!isEdit ? (
          <div
            className="notice"
            style={{ marginTop: 12, background: "var(--color-primary-container)", color: "var(--color-on-primary-container)" }}
          >
            <Info style={{ color: "var(--color-primary)" }} />
            {t("请同时保存好恢复码，避免设备丢失后无法登录。")}
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
            icon={<Check style={{ width: 14, height: 14 }} />}
            onClick={() => handleSave(false)}
          >
            {isEdit ? t("保存修改") : t("保存账户")}
          </Button>
          {!isEdit ? (
            <Button disabled={saving} onClick={() => handleSave(true)}>
              {t("保存并继续")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
