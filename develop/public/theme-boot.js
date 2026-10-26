/**
 * 首屏主题与平台标记预置。
 *
 * 独立成文件而非 index.html 内联 <script>：收紧 CSP 到 script-src 'self' 后，
 * 内联脚本会被拦截（不依赖运行时是否注入 nonce 更稳妥）。
 * 必须在 React bundle 之前同步执行，避免首帧主题跳变。
 *
 * 注意：**首屏背景色不依赖本脚本**。在触屏设备上 splash.css 已把 html / body /
 * 启动画面背景设为透明，透出的是原生窗口底色（由主题资源按系统明暗给出），
 * 因此即便本脚本判定失误或执行失败，也不可能出现与系统相反的底色。
 * 本脚本负责的是 data-theme（驱动应用内 CSS 变量）与系统栏配色。
 */
(function () {
  try {
    var mode = null;
    try {
      mode = localStorage.getItem("onetotp.theme");
    } catch (e) {}
    // 默认「跟随系统」：与后端 AppSettings::default() 的 theme 保持一致，
    // 否则首次安装时首帧会先按亮色渲染，等设置解密完再跳成暗色。
    if (mode !== "light" && mode !== "dark" && mode !== "system") mode = "system";

    /**
     * 解析「跟随系统」时的真实明暗。
     *
     * 优先问原生（Android 桥）：WebView 在首帧那一刻常常还没完成深色模式
     * 初始化，`matchMedia("(prefers-color-scheme: dark)")` 会返回 false，
     * 于是启动画面被画成整屏白色，几十毫秒后才纠正为暗色。
     * 原生直接读 Activity 的 uiMode，第一帧即准确。
     */
    function systemIsDark() {
      try {
        var bridge = window.OneTotpNative;
        if (bridge && typeof bridge.systemIsDark === "function") {
          return !!bridge.systemIsDark();
        }
      } catch (e) {}
      try {
        return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
      } catch (e) {
        return false;
      }
    }

    /** 按当前设置重新写 data-theme 与系统栏配色 */
    function apply() {
      var dark = mode === "dark" || (mode === "system" && systemIsDark());
      document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", dark ? "#0A0B0D" : "#FCFDFE");
    }

    apply();

    /**
     * 开屏动画样式：draw | pop | ring | dots | none。
     *
     * 与主题一样从 localStorage 读取——设置项存在加密保险库里，
     * 启动阶段解不开，必须靠本机缓存才能在首帧就选对动画。
     * 属性缺失时 splash.css 会回退到 dots，不会出现空白。
     *
     * `none` 表示用户关闭了开屏动画：此时给 <html> 打上 data-splash="none"，
     * splash.css 会把整个启动画面隐藏，main.tsx 也会跳过最短展示时长，
     * 直接进入界面。
     */
    try {
      var anim = localStorage.getItem("onetotp.splashAnimation");
      if (
        anim !== "draw" &&
        anim !== "pop" &&
        anim !== "ring" &&
        anim !== "dots" &&
        anim !== "none"
      ) {
        anim = "dots";
      }
      document.documentElement.setAttribute("data-splash", anim);
    } catch (e) {
      document.documentElement.setAttribute("data-splash", "dots");
    }

    // 首帧那一刻 WebView 可能还没就绪（matchMedia 会短暂报亮色）。
    // 启动画面显示期间（React 挂载前）再纠正几次，成本极低。
    // 背景已由原生底色兜住，这里只是让主题标记尽早收敛，避免应用内首帧跳色。
    setTimeout(apply, 0);
    setTimeout(apply, 50);
    setTimeout(apply, 150);

    // 系统明暗切换时同步（应用运行期间由 React 处理，这里只兜住启动阶段）
    try {
      var mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
      if (mq && mq.addEventListener) mq.addEventListener("change", apply);
    } catch (e) {}

    var ua = navigator.userAgent.toLowerCase();
    var mobile =
      /android|iphone|ipad|ipod/.test(ua) ||
      (/macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    document.documentElement.setAttribute("data-platform", mobile ? "mobile" : "desktop");
  } catch (e) {}
})();
