/**
 * 备份文件识别与读取（拖拽导入共用）。
 *
 * 为什么单独成文件：全局拖拽遮罩与「导入导出」页的拖拽区都要做同一件事
 * ——判断拖进来的文件是不是 OneTOTP 备份。两处各写一份容易走偏，
 * 校验口径必须完全一致。
 */

/** 备份文件体积上限，与后端 `read_backup_file` 保持一致 */
const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

/**
 * OneTOTP 备份的文件名特征。
 *
 * 应用产生两种备份：
 *   - 手动导出：`onetotp-backup-2026-10-24-12-00-00.json`
 *   - 自动快照：`vault-backup-1792812703673.json`
 * 两者都含 `backup`，且都以 `.json` / `.txt` 结尾。
 *
 * 注意：文件名只是**前置过滤**，用于在拖入瞬间就给出明确提示
 * （比如拖了一张图片，不必等读完 10MB 才报错）。真正的合法性
 * 判断在 [checkBackupText] 里按内容结构做，两者都需要满足。
 */
const BACKUP_NAME_RE = /(onetotp|vault)[-_]?backup.*\.(json|txt)$/i;

/** 校验失败原因码，供 UI 决定提示文案 */
export type BackupRejectReason =
  | "name"
  | "size"
  | "not-json"
  | "not-backup";

export interface BackupCheckResult {
  ok: boolean;
  reason?: BackupRejectReason;
  /** 通过校验时的文件内容 */
  text?: string;
}

/**
 * 拒绝原因 → 提示文案（中文原文，调用方用 `t()` 翻译）。
 *
 * 为什么集中在这里：全局拖拽、导入页拖拽区、选择文件、移动端选择文件
 * 四条路径都会拒绝文件，文案必须完全一致。分散在各处极易出现
 * 「同一个错误在不同入口说法不同」的割裂感。
 */
export function rejectReasonText(reason: BackupRejectReason): string {
  switch (reason) {
    case "name":
      return "仅支持 OneTOTP 导出的备份文件（onetotp-backup-*.json）";
    case "size":
      return "备份文件超过 10MB，无法导入";
    case "not-json":
      return "文件内容无法读取，可能已损坏";
    case "not-backup":
      return "该文件不是有效的 OneTOTP 备份";
  }
}

/**
 * 拒绝原因 → 简短标题（用于拖拽遮罩的拒绝态）。
 *
 * 与 [rejectReasonText] 的分工：遮罩空间有限，标题要短；
 * toast / 提示条空间充裕，用完整说明。
 */
export function rejectReasonTitle(reason: BackupRejectReason): string {
  switch (reason) {
    case "name":
      return "不支持该文件";
    case "size":
      return "文件过大";
    case "not-json":
      return "文件无法读取";
    case "not-backup":
      return "不是有效备份";
  }
}

/**
 * 粗校验：内容是否像 OneTOTP 备份文件。
 *
 * 备份是 `VaultFile` 的 JSON，必然含 version / ciphertext / salt / nonce
 * 四个字段，且 version 是数字。四个条件同时满足才算通过——
 * 只判 ciphertext 太松，任何带该键名的 JSON 都能混进来。
 *
 * 真正的解密与校验仍在后端完成，这里只负责「一眼假」的过滤。
 */
export function isBackupLike(text: string): boolean {
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
    return (
      typeof obj.version === "number" &&
      typeof obj.ciphertext === "string" &&
      obj.ciphertext.length > 0 &&
      typeof obj.salt === "string" &&
      typeof obj.nonce === "string"
    );
  } catch {
    return false;
  }
}

/** 文件名是否像 OneTOTP 备份 */
export function isBackupName(name: string): boolean {
  return BACKUP_NAME_RE.test(name);
}

/**
 * 完整的拖入文件校验：文件名 → 体积 → 内容结构。
 *
 * 顺序刻意从便宜到昂贵：文件名是字符串匹配，体积是元数据读取，
 * 内容解析最贵。拖入一张 50MB 的视频时，前两步就能拒绝，
 * 不必把它整个读进内存。
 */
export async function checkDroppedFile(file: File): Promise<BackupCheckResult> {
  if (!isBackupName(file.name)) {
    return { ok: false, reason: "name" };
  }
  if (file.size > MAX_BACKUP_BYTES) {
    return { ok: false, reason: "size" };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, reason: "not-json" };
  }
  if (!isBackupLike(text)) {
    return { ok: false, reason: "not-backup" };
  }
  return { ok: true, text };
}

/**
 * 从拖拽事件里取出第一个**文件名像备份**的文件。
 *
 * 必须按名字筛选而不是直接取第一个：用户框选多个文件一起拖时，
 * files[0] 可能是张图片。既然遮罩按 `.some(isBackupName)` 判断过，
 * 松手后就该取同一个「像备份」的文件，否则会出现「提示可以放，
 * 松手却什么都不发生」的错位。
 */
export function firstDroppedBackupFile(e: DragEvent): File | null {
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return null;
  return Array.from(files).find((f) => isBackupName(f.name)) ?? null;
}

/**
 * 拖拽事件里是否有文件（不区分类型）。
 *
 * 用途是「兜底拦截」：即使文件不被支持，也要在 dragover / drop 里
 * preventDefault，否则 WebView 会把它当成导航目标，直接打开该文件。
 */
export function dragHasFiles(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes("Files");
}

/**
 * 拖拽阶段（不读内容）能判定的拒绝原因；可接受时返回 null。
 *
 * 只允许 OneTOTP 自己的备份：文件名必须匹配 [isBackupName]。
 * 拖一张图片、一个压缩包、别家的 `backup.json` 时返回 `name`，
 * 由调用方显示「不支持该文件」而不是笼统的「出错了」。
 *
 * 只看文件名不看内容：dragover 阶段不允许读文件内容（浏览器限制），
 * 只能在 drop 之后再按内容做二次校验。因此这里只可能返回
 * `name` / `size` 两种原因，内容层面的 `not-backup` 必须等 drop 之后。
 *
 * 多选场景：只要**任意一个**文件像备份就放行——用户框选一堆文件时
 * 不该因为夹了张图片就整体拒绝，drop 时取那个像备份的即可。
 *
 * 兼容性处理：Chromium 在 dragenter / dragover 阶段会填充
 * `dataTransfer.files`（名字可读、内容不可读），但部分环境下
 * 该列表为空。此时用 `dataTransfer.items` 的 MIME 做兜底——
 * 备份是 JSON，拖入时 MIME 为 application/json。
 * 两者都拿不到时保守返回 `name`（拒绝），避免误放行。
 */
export function dragRejectReason(e: DragEvent): BackupRejectReason | null {
  const dt = e.dataTransfer;
  if (!dt) return "name";

  const files = dt.files;
  if (files && files.length > 0) {
    const list = Array.from(files);
    const backup = list.find((f) => isBackupName(f.name));
    if (!backup) return "name";
    if (backup.size > MAX_BACKUP_BYTES) return "size";
    return null;
  }

  // 兜底：拖拽阶段读不到文件名时，按 MIME 判断
  const items = dt.items;
  if (!items || items.length === 0) return "name";
  const looksLikeJson = Array.from(items).some((it) => {
    if (it.kind !== "file") return false;
    const mime = (it.type || "").toLowerCase();
    return mime === "application/json" || mime === "text/plain";
  });
  return looksLikeJson ? null : "name";
}
