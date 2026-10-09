/**
 * 最小导出适配：只新增「把上游已经画好的 ASCII 画布落盘为 PNG」这一步。
 *
 * 上游 index.js 已经把字符画（同样的字符网格、8px monospace 字号）画在
 * <canvas id="ascii-canvas"> 上，但只提供截图。这里不重写、也不重新实现上游的
 * 转换算法（亮度表 brightnessChars / grayScale / drawText 全部留在 index.js），
 * 仅仅复用那张画布调用 canvas.toBlob() 导出 PNG。
 *
 * 页面以普通脚本引入：<script defer src="export-png.js"></script>
 */
(function () {
  "use strict";

  function downloadBlob(blob, filename) {
    var href = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // 给下载留出时间后再释放，避免个别浏览器取消下载
    setTimeout(function () {
      URL.revokeObjectURL(href);
    }, 10000);
  }

  function exportPng() {
    var ascii = document.getElementById("ascii-canvas");
    if (!ascii || !ascii.width || !ascii.height) return;
    if (typeof ascii.toBlob !== "function") return;
    ascii.toBlob(function (blob) {
      if (!blob) return;
      downloadBlob(blob, "ascii-art.png");
    }, "image/png");
  }

  function setup() {
    var button = document.getElementById("export-png");
    if (!button) return;
    button.addEventListener("click", exportPng);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    setup();
  }
})();
