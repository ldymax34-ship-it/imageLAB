/*
 * tools/shaders-logo · 入口
 *
 * 效果：液态金属 / 宝石烟雾（都直接用 @paper-design/shaders 导出的 fragment shader）。
 * 两个效果都需要先把图片解算成遮罩（边缘梯度 + 不透明度），这一步走官方的 toProcessed*。
 */
import { mountTool } from "./ui.js";

/* 内置示例 Logo（tests/fixtures/test-logo.svg 的副本）。
   页面默认用内置形状，不依赖它；这个按钮只是方便快速试一下图片遮罩链路。 */
const sampleLogo = new URL("./assets/sample-logo.svg", import.meta.url).href;

const sampleButton = document.getElementById("btn-sample-logo");
if (sampleButton) {
  sampleButton.addEventListener("click", () => {
    if (window.imagelab) window.imagelab.setImage(sampleLogo);
  });
}

mountTool({
  toolId: "shaders-logo",
  imageLabel: "Logo 图片",
  imageHint:
    "上传透明底 PNG / SVG。效果只认图片的透明区域和边缘：背景必须透明，" +
    "不透明的照片会得到「整块都是形状」的结果。不上传时用内置形状。",
  accept: "image/png,image/svg+xml,image/webp"
}).catch((err) => {
  const status = document.getElementById("status");
  if (status) status.textContent = `初始化失败：${err && err.message ? err.message : err}`;
});
