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
  halftoneCmykFragmentShader,
  halftoneDotsFragmentShader,
  imageDitheringFragmentShader,
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

export const SHADER_ORDER = ["halftone-cmyk","halftone-dots","image-dithering"];

export const SHADERS = {
  "halftone-cmyk": {
    key: "halftone-cmyk",
    label: "CMYK 半调",
    note: "按 CMYK 四色分色出网点，可单独调每块印版的铺底与增益。",
    fragment: halftoneCmykFragmentShader,
    mipmaps: [],
    image: {"process":null,"flag":null},
    animated: false,
    defaults: {"fit":"cover","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0,"frame":0,"colorBack":"#fbfaf5","colorC":"#00b4ff","colorM":"#fc519f","colorY":"#ffd800","colorK":"#231f20","size":0.2,"contrast":1,"softness":1,"grainSize":0.5,"grainMixer":0,"grainOverlay":0,"gridNoise":0.2,"floodC":0.15,"floodM":0,"floodY":0,"floodK":0,"gainC":0.3,"gainM":0,"gainY":0.2,"gainK":0,"type":"ink"},
    params: [{"key":"noiseTexture","label":"噪声贴图","kind":"texture","u":"u_noiseTexture","group":"hidden"},{"key":"colorBack","label":"背景色","kind":"color","u":"u_colorBack","group":"main"},{"key":"colorC","label":"青版 C","kind":"color","u":"u_colorC","group":"main"},{"key":"colorM","label":"品红版 M","kind":"color","u":"u_colorM","group":"main"},{"key":"colorY","label":"黄版 Y","kind":"color","u":"u_colorY","group":"main"},{"key":"colorK","label":"黑版 K","kind":"color","u":"u_colorK","group":"main"},{"key":"size","label":"尺寸","kind":"range","u":"u_size","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"gridNoise","label":"网格噪点","kind":"range","u":"u_gridNoise","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"type","label":"类型","kind":"select","u":"u_type","table":"HalftoneCmykTypes","options":[["dots","圆点",0],["ink","油墨",1],["sharp","锐利",2]],"group":"main"},{"key":"softness","label":"柔和度","kind":"range","u":"u_softness","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"contrast","label":"对比度","kind":"range","u":"u_contrast","min":0,"max":2,"step":0.01,"int":false,"group":"main"},{"key":"floodC","label":"青版铺底","kind":"range","u":"u_floodC","min":0,"max":1,"step":0.01,"int":false,"group":"advanced"},{"key":"floodM","label":"品红版铺底","kind":"range","u":"u_floodM","min":0,"max":1,"step":0.01,"int":false,"group":"advanced"},{"key":"floodY","label":"黄版铺底","kind":"range","u":"u_floodY","min":0,"max":1,"step":0.01,"int":false,"group":"advanced"},{"key":"floodK","label":"黑版铺底","kind":"range","u":"u_floodK","min":0,"max":1,"step":0.01,"int":false,"group":"advanced"},{"key":"gainC","label":"青版增益","kind":"range","u":"u_gainC","min":-1,"max":1,"step":0.01,"int":false,"group":"advanced"},{"key":"gainM","label":"品红版增益","kind":"range","u":"u_gainM","min":-1,"max":1,"step":0.01,"int":false,"group":"advanced"},{"key":"gainY","label":"黄版增益","kind":"range","u":"u_gainY","min":-1,"max":1,"step":0.01,"int":false,"group":"advanced"},{"key":"gainK","label":"黑版增益","kind":"range","u":"u_gainK","min":-1,"max":1,"step":0.01,"int":false,"group":"advanced"},{"key":"grainSize","label":"颗粒大小","kind":"range","u":"u_grainSize","min":0,"max":1,"step":0.01,"int":false,"group":"advanced"},{"key":"grainMixer","label":"颗粒混合","kind":"range","u":"u_grainMixer","min":0,"max":1,"step":0.01,"int":false,"group":"advanced"},{"key":"grainOverlay","label":"颗粒叠加","kind":"range","u":"u_grainOverlay","min":0,"max":1,"step":0.01,"int":false,"group":"advanced"}],
    presets: [{"name":"默认","params":{"fit":"cover","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0,"frame":0,"colorBack":"#fbfaf5","colorC":"#00b4ff","colorM":"#fc519f","colorY":"#ffd800","colorK":"#231f20","size":0.2,"contrast":1,"softness":1,"grainSize":0.5,"grainMixer":0,"grainOverlay":0,"gridNoise":0.2,"floodC":0.15,"floodM":0,"floodY":0,"floodK":0,"gainC":0.3,"gainM":0,"gainY":0.2,"gainK":0,"type":"ink"}},{"name":"墨滴","params":{"fit":"cover","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0,"frame":0,"colorBack":"#eeefd7","colorC":"#00b2ff","colorM":"#fc4f4f","colorY":"#ffd900","colorK":"#231f20","size":0.88,"contrast":1.15,"softness":0,"grainSize":0.01,"grainMixer":0.05,"grainOverlay":0.25,"gridNoise":0.5,"floodC":0.15,"floodM":0,"floodY":0,"floodK":0,"gainC":1,"gainM":0.44,"gainY":-1,"gainK":0,"type":"ink"}},{"name":"报纸","params":{"fit":"cover","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0,"frame":0,"colorBack":"#f2f1e8","colorC":"#7a7a75","colorM":"#7a7a75","colorY":"#7a7a75","colorK":"#231f20","size":0.01,"contrast":2,"softness":0.2,"grainSize":0,"grainMixer":0,"grainOverlay":0.2,"gridNoise":0.6,"floodC":0,"floodM":0,"floodY":0,"floodK":0.1,"gainC":-0.17,"gainM":-0.45,"gainY":-0.45,"gainK":0,"type":"dots"}},{"name":"复古","params":{"fit":"cover","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0,"frame":0,"colorBack":"#fffaf0","colorC":"#59afc5","colorM":"#d8697c","colorY":"#fad85c","colorK":"#2d2824","size":0.2,"contrast":1.25,"softness":0.4,"grainSize":0.5,"grainMixer":0.15,"grainOverlay":0.1,"gridNoise":0.45,"floodC":0.15,"floodM":0,"floodY":0,"floodK":0,"gainC":0.3,"gainM":0,"gainY":0.2,"gainK":0,"type":"sharp"}}],
  },
  "halftone-dots": {
    key: "halftone-dots",
    label: "网点半调",
    note: "单色/原色网点半调。",
    fragment: halftoneDotsFragmentShader,
    mipmaps: [],
    image: {"process":null,"flag":null},
    animated: false,
    defaults: {"fit":"cover","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0,"frame":0,"colorBack":"#f2f1e8","colorFront":"#2b2b2b","size":0.5,"radius":1.25,"contrast":0.4,"originalColors":false,"inverted":false,"grainMixer":0.2,"grainOverlay":0.2,"grainSize":0.5,"grid":"hex","type":"gooey"},
    params: [{"key":"colorBack","label":"背景色","kind":"color","u":"u_colorBack","group":"main"},{"key":"colorFront","label":"前景色","kind":"color","u":"u_colorFront","group":"main"},{"key":"originalColors","label":"保留原色","kind":"bool","u":"u_originalColors","group":"main"},{"key":"type","label":"类型","kind":"select","u":"u_type","table":"HalftoneDotsTypes","options":[["classic","经典",0],["gooey","粘连",1],["holes","孔洞",2],["soft","柔和",3]],"group":"main"},{"key":"inverted","label":"反相","kind":"bool","u":"u_inverted","group":"main"},{"key":"grid","label":"网点网格","kind":"select","u":"u_grid","table":"HalftoneDotsGrids","options":[["square","方形",0],["hex","六边形",1]],"group":"main"},{"key":"size","label":"尺寸","kind":"range","u":"u_size","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"radius","label":"半径","kind":"range","u":"u_radius","min":0,"max":2,"step":0.01,"int":false,"group":"main"},{"key":"contrast","label":"对比度","kind":"range","u":"u_contrast","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"grainMixer","label":"颗粒混合","kind":"range","u":"u_grainMixer","min":0,"max":1,"step":0.01,"int":false,"group":"advanced"},{"key":"grainOverlay","label":"颗粒叠加","kind":"range","u":"u_grainOverlay","min":0,"max":1,"step":0.01,"int":false,"group":"advanced"},{"key":"grainSize","label":"颗粒大小","kind":"range","u":"u_grainSize","min":0,"max":1,"step":0.01,"int":false,"group":"advanced"}],
    presets: [{"name":"默认","params":{"fit":"cover","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0,"frame":0,"colorBack":"#f2f1e8","colorFront":"#2b2b2b","size":0.5,"radius":1.25,"contrast":0.4,"originalColors":false,"inverted":false,"grainMixer":0.2,"grainOverlay":0.2,"grainSize":0.5,"grid":"hex","type":"gooey"}},{"name":"LED 屏","params":{"fit":"cover","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0,"frame":0,"colorBack":"#000000","colorFront":"#29ff7b","size":0.5,"radius":1.5,"contrast":0.3,"originalColors":false,"inverted":false,"grainMixer":0,"grainOverlay":0,"grainSize":0.5,"grid":"square","type":"soft"}},{"name":"马赛克","params":{"fit":"cover","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0,"frame":0,"colorBack":"#000000","colorFront":"#b2aeae","size":0.6,"radius":2,"contrast":0.01,"originalColors":true,"inverted":false,"grainMixer":0,"grainOverlay":0,"grainSize":0.5,"grid":"hex","type":"classic"}},{"name":"方圆","params":{"fit":"cover","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0,"frame":0,"colorBack":"#141414","colorFront":"#ff8000","size":0.8,"radius":1,"contrast":1,"originalColors":false,"inverted":true,"grainMixer":0.05,"grainOverlay":0.3,"grainSize":0.5,"grid":"square","type":"holes"}}],
  },
  "image-dithering": {
    key: "image-dithering",
    label: "图片抖动",
    note: "有序抖动，把图片压到有限色阶。",
    fragment: imageDitheringFragmentShader,
    mipmaps: [],
    image: {"process":null,"flag":null},
    animated: false,
    defaults: {"fit":"cover","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0,"frame":0,"colorFront":"#94ffaf","colorBack":"#000c38","colorHighlight":"#eaff94","type":"8x8","size":2,"colorSteps":2,"originalColors":false,"inverted":false},
    params: [{"key":"colorBack","label":"背景色","kind":"color","u":"u_colorBack","group":"main"},{"key":"colorFront","label":"前景色","kind":"color","u":"u_colorFront","group":"main"},{"key":"colorHighlight","label":"高光色","kind":"color","u":"u_colorHighlight","group":"main"},{"key":"originalColors","label":"保留原色","kind":"bool","u":"u_originalColors","group":"main"},{"key":"inverted","label":"反相","kind":"bool","u":"u_inverted","group":"main"},{"key":"type","label":"类型","kind":"select","u":"u_type","table":"DitheringTypes","options":[["random","随机",1],["2x2","2×2",2],["4x4","4×4",3],["8x8","8×8",4]],"group":"main"},{"key":"size","label":"尺寸","kind":"range","u":"u_pxSize","min":0.5,"max":20,"step":0.05,"int":false,"group":"main"},{"key":"colorSteps","label":"色阶数","kind":"range","u":"u_colorSteps","min":1,"max":7,"step":1,"int":true,"group":"main"}],
    presets: [{"name":"默认","params":{"fit":"cover","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0,"frame":0,"colorFront":"#94ffaf","colorBack":"#000c38","colorHighlight":"#eaff94","type":"8x8","size":2,"colorSteps":2,"originalColors":false,"inverted":false}},{"name":"噪点","params":{"fit":"cover","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0,"frame":0,"colorFront":"#a2997c","colorBack":"#000000","colorHighlight":"#ededed","type":"random","size":1,"colorSteps":1,"originalColors":false,"inverted":false}},{"name":"复古","params":{"fit":"cover","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0,"frame":0,"colorFront":"#eeeeee","colorBack":"#5452ff","colorHighlight":"#eeeeee","type":"2x2","size":3,"colorSteps":1,"originalColors":true,"inverted":false}},{"name":"自然","params":{"fit":"cover","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0,"frame":0,"colorFront":"#ffffff","colorBack":"#000000","colorHighlight":"#ffffff","type":"8x8","size":2,"colorSteps":5,"originalColors":true,"inverted":false}}],
  },
};
