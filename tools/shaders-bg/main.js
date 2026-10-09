/*
 * tools/shaders-bg · 入口
 *
 * 效果：mesh-gradient / grain-gradient / smoke-ring / warp / dot-grid /
 *       god-rays / metaballs / neuro-noise（都直接用包导出的 fragment shader）
 * 没有图片输入：这些效果都是程序化生成的动态背景。
 */
import { mountTool } from "./ui.js";

mountTool({ toolId: "shaders-bg" }).catch((err) => {
  const status = document.getElementById("status");
  if (status) status.textContent = `初始化失败：${err && err.message ? err.message : err}`;
});
