import jsQR from "jsqr";

/**
 * 解码用的临时缓冲。逐帧扫码时尺寸通常固定不变，
 * 复用它们可避免每帧重新分配数 MB 内存（移动端 GC 抖动的来源之一）。
 */
let scratchGray: Float64Array | null = null;
let scratchIntegral: Float64Array | null = null;
let scratchOut: Uint8ClampedArray | null = null;
let scratchW = 0;
let scratchH = 0;

function ensureScratch(w: number, h: number): void {
  if (scratchW === w && scratchH === h && scratchGray && scratchIntegral && scratchOut) return;
  scratchW = w;
  scratchH = h;
  scratchGray = new Float64Array(w * h);
  scratchIntegral = new Float64Array((w + 1) * (h + 1));
  scratchOut = new Uint8ClampedArray(w * h * 4);
}

/** 自适应二值化（积分图局部均值），显著提升低对比/照片二维码的识别率 */
function binarize(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  blockSize = 16,
  c = 8,
): Uint8ClampedArray {
  ensureScratch(w, h);
  const gray = scratchGray as Float64Array;
  const integral = scratchIntegral as Float64Array;
  const out = scratchOut as Uint8ClampedArray;

  for (let i = 0; i < w * h; i += 1) {
    gray[i] = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];
  }
  const iw = w + 1;
  for (let y = 0; y < h; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < w; x += 1) {
      rowSum += gray[y * w + x];
      integral[(y + 1) * iw + (x + 1)] = integral[y * iw + (x + 1)] + rowSum;
    }
  }
  const half = blockSize >> 1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const x1 = Math.max(0, x - half);
      const y1 = Math.max(0, y - half);
      const x2 = Math.min(w - 1, x + half);
      const y2 = Math.min(h - 1, y + half);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum =
        integral[(y2 + 1) * iw + (x2 + 1)] -
        integral[y1 * iw + (x2 + 1)] -
        integral[(y2 + 1) * iw + x1] +
        integral[y1 * iw + x1];
      const mean = sum / count;
      const v = gray[y * w + x] < mean - c ? 0 : 255;
      const di = (y * w + x) * 4;
      out[di] = v;
      out[di + 1] = v;
      out[di + 2] = v;
      out[di + 3] = 255;
    }
  }
  return out;
}

/**
 * 复用同一块画布做光栅化。
 * 逐帧创建 canvas 会带来明显的分配与 GC 压力，移动端尤其突出。
 */
let sharedCanvas: HTMLCanvasElement | null = null;
let sharedCtx: CanvasRenderingContext2D | null = null;

/** 把图像绘制到指定最长边的画布并取像素 */
function rasterize(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  maxEdge: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  if (!sharedCanvas) {
    sharedCanvas = document.createElement("canvas");
    // willReadFrequently：声明会频繁 getImageData，让浏览器走更适合回读的后端
    sharedCtx = sharedCanvas.getContext("2d", { willReadFrequently: true, alpha: false });
  }
  if (!sharedCanvas || !sharedCtx) throw new Error("无法创建画布上下文");

  if (sharedCanvas.width !== w || sharedCanvas.height !== h) {
    sharedCanvas.width = w;
    sharedCanvas.height = h;
  }
  sharedCtx.drawImage(source, 0, 0, w, h);
  const img = sharedCtx.getImageData(0, 0, w, h);
  return { data: img.data, width: w, height: h };
}

/**
 * 原生条码检测（BarcodeDetector）能力探测结果缓存。
 * Android WebView 83+ / Chrome Android 原生支持，检测在浏览器原生侧完成，
 * 不占用 JS 主线程，也无需逐帧把画面从 GPU 回读到 CPU。
 */
let nativeSupported: boolean | null = null;
let nativeDetector: { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } | null = null;

/**
 * 是否可用原生二维码检测。
 * 三重保险：构造函数存在 → getSupportedFormats 含 qr_code → 全程 try/catch。
 * 无 GMS 的 Android 设备即使 WebView 版本够也可能抛异常，必须捕获后降级。
 */
export async function isNativeQrSupported(): Promise<boolean> {
  if (nativeSupported !== null) return nativeSupported;
  try {
    const BD = (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    if (typeof BD !== "function") {
      nativeSupported = false;
      return false;
    }
    const ctor = BD as unknown as {
      getSupportedFormats: () => Promise<string[]>;
      new (opts: { formats: string[] }): { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> };
    };
    const formats = await ctor.getSupportedFormats();
    nativeSupported = Array.isArray(formats) && formats.includes("qr_code");
  } catch {
    nativeSupported = false;
  }
  return nativeSupported;
}

/**
 * 用原生能力检测一帧二维码。
 * 直接把 <video> 交给检测器读取当前帧，避免 drawImage + getImageData 的 GPU 回读。
 * 单帧异常按「本帧未识别」处理，不影响后续帧。
 */
export async function detectNativeQr(video: HTMLVideoElement): Promise<string | null> {
  try {
    const ctor = (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector as unknown as {
      new (opts: { formats: string[] }): { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> };
    };
    if (typeof ctor !== "function") return null;
    if (!nativeDetector) nativeDetector = new ctor({ formats: ["qr_code"] });
    const results = await nativeDetector.detect(video);
    if (results && results.length > 0 && results[0].rawValue) return results[0].rawValue;
  } catch {
    // 忽略本帧异常
  }
  return null;
}

/**
 * 稳健解码（jsQR 降级路径）：对多个缩放尺度、原图/二值化逐一尝试，
 * 直到解出结果为止，尽量降低"识别到错误内容"的概率。
 *
 * @param fast 实时摄像头逐帧调用时可传 true，只做单尺度 + 原图/二值化，
 *             降低单帧开销，避免卡顿。
 * @param maxEdge fast 模式下的最长边上限；默认 640，移动端可传更小值进一步降载。
 */
export function decodeQrFromImage(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  fast = false,
  maxEdge?: number,
): string | null {
  const maxEdgeCandidates = fast ? [maxEdge ?? 640] : [Math.max(sw, sh), 800, 600, 400];
  const seen = new Set<number>();

  for (const edge of maxEdgeCandidates) {
    if (seen.has(edge)) continue;
    seen.add(edge);
    let raster: { data: Uint8ClampedArray; width: number; height: number };
    try {
      raster = rasterize(source, sw, sh, edge);
    } catch {
      continue;
    }

    // 先试原图：多数场景一帧就能解出，可省掉整趟二值化的开销
    // （二值化会遍历全部像素，是逐帧扫码里最贵的一步）
    const raw = jsQR(raster.data, raster.width, raster.height, {
      inversionAttempts: "attemptBoth",
    });
    if (raw?.data) return raw.data;

    // 原图未解出再做自适应二值化，应对低对比 / 屏幕翻拍等场景
    const bin = binarize(raster.data, raster.width, raster.height);
    const binary = jsQR(bin, raster.width, raster.height, {
      inversionAttempts: "attemptBoth",
    });
    if (binary?.data) return binary.data;
  }
  return null;
}
