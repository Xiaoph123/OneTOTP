/// <reference types="vite/client" />

/**
 * 构建标识，由 vite.config.ts 在打包时注入（格式：`v0.2.0 · 2026-10-21 09:00`）。
 * 显示在「关于」弹窗，用于区分多个 beta 包。
 */
declare const __BUILD_STAMP__: string;
