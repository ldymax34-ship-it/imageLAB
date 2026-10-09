/*
 * imageLAB · Paper Shaders 效果目录（本文件由上游数据生成，勿手改）
 *
 * 来源：@paper-design/shaders 0.0.81
 *   https://github.com/paper-design/shaders
 *   commit 43cd68db79fa0b1759f72ffc941b3238e2a3954c
 * 许可：Apache-2.0（NOTICE: "Paper Shaders / Copyright 2026 Paper /
 *   Powered by Paper Shaders: https://shaders.paper.design"）
 *
 * defaults / presets 抄自上游 packages/shaders-react 的 preset 定义，
 * 参数范围与枚举来自上游 docs/src/shader-defs。
 * 着色器一律直接复用包导出的 fragment shader 常量，未做任何改动。
 */
import {
  liquidMetalFragmentShader,
  gemSmokeFragmentShader,
} from "@paper-design/shaders";

export const SIZING_LABELS = {
  "fit": "适配方式",
  "scale": "缩放",
  "rotation": "旋转",
  "offsetX": "水平偏移",
  "offsetY": "垂直偏移",
  "originX": "原点 X",
  "originY": "原点 Y",
  "worldWidth": "虚拟宽度",
  "worldHeight": "虚拟高度"
};

export const SHADER_ORDER = ["liquid-metal","gem-smoke"];

export const SHADERS = {
  "liquid-metal": {
    key: "liquid-metal",
    label: "液态金属",
    note: "上传 Logo（透明底 PNG/SVG）作遮罩，或在不上传时使用内置形状。",
    fragment: liquidMetalFragmentShader,
    mipmaps: ["u_image"],
    image: {"process":"liquid-metal","flag":"u_isImage"},
    animated: true,
    defaults: {"fit":"contain","scale":0.6,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#AAAAAC","colorTint":"#ffffff","distortion":0.07,"repetition":2,"shiftRed":0.3,"shiftBlue":0.3,"contour":0.4,"softness":0.1,"angle":70,"shape":"diamond"},
    params: [{"key":"colorBack","label":"背景色","kind":"color","u":"u_colorBack","group":"main"},{"key":"colorTint","label":"色调叠加","kind":"color","u":"u_colorTint","group":"main"},{"key":"shape","label":"形状","kind":"select","u":"u_shape","table":"LiquidMetalShapes","options":[["none","满画布",0],["circle","圆形",1],["daisy","雏菊",2],["diamond","菱形",3],["metaballs","融球",4]],"group":"main"},{"key":"repetition","label":"条纹密度","kind":"range","u":"u_repetition","min":1,"max":10,"step":0.05,"int":false,"group":"main"},{"key":"softness","label":"柔和度","kind":"range","u":"u_softness","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"shiftRed","label":"红通道偏移","kind":"range","u":"u_shiftRed","min":-1,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"shiftBlue","label":"蓝通道偏移","kind":"range","u":"u_shiftBlue","min":-1,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"distortion","label":"扭曲","kind":"range","u":"u_distortion","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"contour","label":"轮廓扭曲","kind":"range","u":"u_contour","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"angle","label":"图案角度","kind":"range","u":"u_angle","min":0,"max":360,"step":1,"int":false,"group":"main"}],
    presets: [{"name":"默认","params":{"fit":"contain","scale":0.6,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#AAAAAC","colorTint":"#ffffff","distortion":0.07,"repetition":2,"shiftRed":0.3,"shiftBlue":0.3,"contour":0.4,"softness":0.1,"angle":70,"shape":"diamond"}},{"name":"黑白","params":{"fit":"contain","scale":0.6,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#000000","colorTint":"#606060","softness":0.45,"repetition":1.5,"shiftRed":0,"shiftBlue":0,"distortion":0,"contour":0,"angle":90,"shape":"diamond"}},{"name":"全屏底纹","params":{"fit":"contain","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#AAAAAC","colorTint":"#ffffff","softness":0.05,"repetition":1.5,"shiftRed":0.3,"shiftBlue":0.3,"distortion":0.1,"contour":0.4,"shape":"none","angle":90}},{"name":"条纹","params":{"fit":"contain","scale":0.6,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#000000","colorTint":"#2c5d72","softness":0.8,"repetition":6,"shiftRed":1,"shiftBlue":-1,"distortion":0.4,"contour":0.4,"shape":"circle","angle":0}}],
  },
  "gem-smoke": {
    key: "gem-smoke",
    label: "宝石烟雾",
    note: "上传 Logo（透明底 PNG/SVG）作遮罩，或在不上传时使用内置形状。",
    fragment: gemSmokeFragmentShader,
    mipmaps: ["u_image"],
    image: {"process":"gem-smoke","flag":"u_isImage"},
    animated: true,
    defaults: {"fit":"contain","scale":0.6,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#f0efea","colorInner":"#fafaf5","colors":["#333333","#e7e6df"],"outerGlow":0.55,"innerGlow":1,"innerDistortion":0.8,"outerDistortion":0.6,"offset":0,"angle":0,"size":0.8,"shape":"diamond"},
    params: [{"key":"shape","label":"形状","kind":"select","u":"u_shape","table":"GemSmokeShapes","options":[["none","满画布",0],["circle","圆形",1],["daisy","雏菊",2],["diamond","菱形",3],["metaballs","融球",4]],"group":"main"},{"key":"colors","label":"配色","kind":"colors","u":"u_colors","countU":"u_colorsCount","max":6,"group":"main"},{"key":"colorBack","label":"背景色","kind":"color","u":"u_colorBack","group":"main"},{"key":"innerDistortion","label":"内部扭曲","kind":"range","u":"u_innerDistortion","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"outerDistortion","label":"外部扭曲","kind":"range","u":"u_outerDistortion","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"outerGlow","label":"外部辉光","kind":"range","u":"u_outerGlow","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"innerGlow","label":"内部辉光","kind":"range","u":"u_innerGlow","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"colorInner","label":"内部色","kind":"color","u":"u_colorInner","group":"main"},{"key":"offset","label":"内部偏移","kind":"range","u":"u_offset","min":-1,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"angle","label":"图案角度","kind":"range","u":"u_angle","min":0,"max":360,"step":1,"int":false,"group":"main"},{"key":"size","label":"尺寸","kind":"range","u":"u_size","min":0,"max":1,"step":0.01,"int":false,"group":"main"}],
    presets: [{"name":"默认","params":{"fit":"contain","scale":0.6,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#f0efea","colorInner":"#fafaf5","colors":["#333333","#e7e6df"],"outerGlow":0.55,"innerGlow":1,"innerDistortion":0.8,"outerDistortion":0.6,"offset":0,"angle":0,"size":0.8,"shape":"diamond"}},{"name":"火焰","params":{"fit":"contain","scale":0.6,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#000000","colorInner":"#000000","colors":["#fe5b16","#f7ff61","#ffffff"],"outerGlow":1,"innerGlow":0.65,"innerDistortion":0.6,"outerDistortion":0.8,"offset":0,"angle":0,"size":0.8,"shape":"diamond"}},{"name":"荧光","params":{"fit":"contain","scale":0.6,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#000000","colorInner":"#000000","colors":["#2fb64c","#cdff61","#ffffff"],"outerGlow":0,"innerGlow":1,"innerDistortion":1,"outerDistortion":0.8,"offset":0,"angle":0,"size":0.8,"shape":"diamond"}},{"name":"红外","params":{"fit":"contain","scale":0.6,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0.5,"frame":0,"colorBack":"#cd28dc","colorInner":"#00000000","colors":["#ff9900","#fff67a","#dcff52","#00ffbb","#0077ff"],"outerGlow":1,"innerGlow":1,"innerDistortion":1,"outerDistortion":1,"offset":0.2,"angle":0,"size":1,"shape":"diamond"}}],
  },
};
