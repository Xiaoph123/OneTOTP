/**
 * 首屏主题与平台标记预置。
 *
 * 独立成文件而非 index.html 内联 <script>：收紧 CSP 到 script-src 'self' 后，
 * 内联脚本会被拦截（不依赖运行时是否注入 nonce 更稳妥）。
 * 必须在 React bundle 之前同步执行，避免首帧主题跳变。
 */
(function () {
  try {
    var mode = null;
    try {
      mode = localStorage.getItem("onetotp.theme");
    } catch (e) {}
    if (mode !== "light" && mode !== "dark" && mode !== "system") mode = "light";
    var dark =
      mode === "dark" ||
      (mode === "system" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    var ua = navigator.userAgent.toLowerCase();
    var mobile =
      /android|iphone|ipad|ipod/.test(ua) ||
      (/macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    document.documentElement.setAttribute("data-platform", mobile ? "mobile" : "desktop");
  } catch (e) {}
})();
