import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { readFileSync } from "node:fs";
const host = process.env.TAURI_DEV_HOST;

/**
 * 构建标识：`版本 · 本地构建时间`。
 *
 * 目的：多个 beta 包并存时，仅凭界面无法判断用户实际运行的是哪一个，
 * 排查只能靠猜。把它显示在「关于」弹窗里，一张截图就能定位构建。
 */
function buildStamp(): string {
  let version = "0.0.0";
  try {
    const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as {
      version?: string;
    };
    if (pkg.version) version = pkg.version;
  } catch {
    // 读取失败时退化为占位版本号
  }
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `v${version} · ${stamp}`;
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  // 注入构建标识（见 buildStamp 注释）
  define: {
    __BUILD_STAMP__: JSON.stringify(buildStamp()),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
