/*
 * tools/shaders-halftone · 入口
 *
 * 效果：halftone-cmyk / halftone-dots / image-dithering（都直接用包导出的 fragment shader）
 * 三个都要一张图片当输入：u_image 直接吃本地图片，不做 logo 那套边缘梯度预处理。
 */
import { mountTool } from "./ui.js";

mountTool({
  toolId: "shaders-halftone",
  imageLabel: "图片",
  imageHint: "上传本地 PNG / JPG / WebP。图片只在浏览器里解码，不会上传到任何地方。",
  accept: "image/png,image/jpeg,image/webp,image/gif",
  empty: document.getElementById("empty")
}).catch((err) => {
  const status = document.getElementById("status");
  if (status) status.textContent = `初始化失败：${err && err.message ? err.message : err}`;
});
