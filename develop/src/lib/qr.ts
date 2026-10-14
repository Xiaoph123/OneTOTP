import jsQR from "jsqr";

/** 自适应二值化（积分图局部均值），显著提升低对比/照片二维码的识别率 */
function binarize(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  blockSize = 16,
  c = 8,
): Uint8ClampedArray {
  const gray = new Float64Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    gray[i] = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];
  }
  const iw = w + 1;
  const integral = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < w; x += 1) {
      rowSum += gray[y * w + x];
      integral[(y + 1) * iw + (x + 1)] = integral[y * iw + (x + 1)] + rowSum;
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
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
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法创建画布上下文");
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  return { data: img.data, width: w, height: h };
}

/**
 * 稳健解码：对多个缩放尺度、原图/二值化、正/反色逐一尝试，
 * 直到解出结果为止，尽量降低"识别到错误内容"的概率。
 *
 * @param fast 实时摄像头逐帧调用时可传 true，只做单尺度 + 原图/二值化，
 *             降低单帧开销，避免卡顿。
 */
export function decodeQrFromImage(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  fast = false,
): string | null {
  const maxEdgeCandidates = fast ? [640] : [Math.max(sw, sh), 800, 600, 400];
  const seen = new Set<number>();

  for (const maxEdge of maxEdgeCandidates) {
    if (seen.has(maxEdge)) continue;
    seen.add(maxEdge);
    let raster: { data: Uint8ClampedArray; width: number; height: number };
    try {
      raster = rasterize(source, sw, sh, maxEdge);
    } catch {
      continue;
    }
    const variants: { data: Uint8ClampedArray; label: string }[] = [
      { data: raster.data, label: "raw" },
      { data: binarize(raster.data, raster.width, raster.height), label: "binary" },
    ];
    for (const variant of variants) {
      const result = jsQR(variant.data, raster.width, raster.height, {
        inversionAttempts: "attemptBoth",
      });
      if (result?.data) return result.data;
    }
  }
  return null;
}
