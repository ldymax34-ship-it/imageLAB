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
  meshGradientFragmentShader,
  grainGradientFragmentShader,
  smokeRingFragmentShader,
  warpFragmentShader,
  dotGridFragmentShader,
  godRaysFragmentShader,
  metaballsFragmentShader,
  neuroNoiseFragmentShader,
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

export const SHADER_ORDER = ["mesh-gradient","grain-gradient","smoke-ring","warp","dot-grid","god-rays","metaballs","neuro-noise"];

export const SHADERS = {
  "mesh-gradient": {
    key: "mesh-gradient",
    label: "网格渐变",
    note: "多色网格渐变流动。",
    fragment: meshGradientFragmentShader,
    mipmaps: [],
    image: null,
    animated: true,
    defaults: {"fit":"contain","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colors":["#e0eaff","#241d9a","#f75092","#9f50d3"],"distortion":0.8,"swirl":0.1,"grainMixer":0,"grainOverlay":0},
    params: [{"key":"colors","label":"配色","kind":"colors","u":"u_colors","countU":"u_colorsCount","max":6,"group":"main"},{"key":"distortion","label":"扭曲","kind":"range","u":"u_distortion","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"swirl","label":"涡旋","kind":"range","u":"u_swirl","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"grainMixer","label":"颗粒混合","kind":"range","u":"u_grainMixer","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"grainOverlay","label":"颗粒叠加","kind":"range","u":"u_grainOverlay","min":0,"max":1,"step":0.01,"int":false,"group":"main"}],
    presets: [{"name":"默认","params":{"fit":"contain","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colors":["#e0eaff","#241d9a","#f75092","#9f50d3"],"distortion":0.8,"swirl":0.1,"grainMixer":0,"grainOverlay":0}},{"name":"水墨","params":{"fit":"contain","scale":1,"rotation":90,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colors":["#ffffff","#000000"],"distortion":1,"swirl":0.2,"grainMixer":0,"grainOverlay":0}},{"name":"紫","params":{"fit":"contain","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0.6,"frame":0,"colors":["#aaa7d7","#3c2b8e"],"distortion":1,"swirl":1,"grainMixer":0,"grainOverlay":0}},{"name":"海滩","params":{"fit":"contain","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0.1,"frame":0,"colors":["#bcecf6","#00aaff","#00f7ff","#ffd447"],"distortion":0.8,"swirl":0.35,"grainMixer":0,"grainOverlay":0}}],
  },
  "grain-gradient": {
    key: "grain-gradient",
    label: "颗粒渐变",
    note: "带颗粒的形状渐变。",
    fragment: grainGradientFragmentShader,
    mipmaps: [],
    image: null,
    animated: false,
    defaults: {"fit":"contain","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#000000","colors":["#7300ff","#eba8ff","#00bfff","#2a00ff"],"softness":0.5,"intensity":0.5,"noise":0.25,"shape":"corners"},
    params: [{"key":"noiseTexture","label":"噪声贴图","kind":"texture","u":"u_noiseTexture","group":"hidden"},{"key":"colors","label":"配色","kind":"colors","u":"u_colors","countU":"u_colorsCount","max":6,"group":"main"},{"key":"colorBack","label":"背景色","kind":"color","u":"u_colorBack","group":"main"},{"key":"softness","label":"柔和度","kind":"range","u":"u_softness","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"intensity","label":"强度","kind":"range","u":"u_intensity","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"noise","label":"噪点","kind":"range","u":"u_noise","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"shape","label":"形状","kind":"select","u":"u_shape","table":"GrainGradientShapes","options":[["wave","波纹",1],["dots","圆点",2],["truchet","特鲁谢",3],["corners","角落",4],["ripple","涟漪",5],["blob","团块",6],["sphere","球体",7]],"group":"main"}],
    presets: [{"name":"默认","params":{"fit":"contain","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#000000","colors":["#7300ff","#eba8ff","#00bfff","#2a00ff"],"softness":0.5,"intensity":0.5,"noise":0.25,"shape":"corners"}},{"name":"波纹","params":{"fit":"none","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#000a0f","colors":["#c4730b","#bdad5f","#d8ccc7"],"softness":0.7,"intensity":0.15,"noise":0.5,"shape":"wave"}},{"name":"圆点","params":{"fit":"none","scale":0.6,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#0a0000","colors":["#6f0000","#0080ff","#f2ebc9","#33cc33"],"softness":1,"intensity":1,"noise":0.7,"shape":"dots"}},{"name":"特鲁谢","params":{"fit":"none","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#0a0000","colors":["#6f2200","#eabb7c","#39b523"],"softness":0,"intensity":0.2,"noise":1,"shape":"truchet"}},{"name":"涟漪","params":{"fit":"contain","scale":0.5,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#140a00","colors":["#6f2d00","#88ddae","#2c0b1d"],"softness":0.5,"intensity":0.5,"noise":0.5,"shape":"ripple"}},{"name":"团块","params":{"fit":"contain","scale":1.3,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#0f0e18","colors":["#3e6172","#a49b74","#568c50"],"softness":0,"intensity":0.15,"noise":0.5,"shape":"blob"}}],
  },
  "smoke-ring": {
    key: "smoke-ring",
    label: "烟环",
    note: "噪声驱动的烟环 / 云团。",
    fragment: smokeRingFragmentShader,
    mipmaps: [],
    image: null,
    animated: true,
    defaults: {"fit":"contain","scale":0.8,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0.5,"frame":0,"colorBack":"#000000","colors":["#ffffff"],"noiseScale":3,"noiseIterations":8,"radius":0.25,"thickness":0.65,"innerShape":0.7},
    params: [{"key":"noiseTexture","label":"噪声贴图","kind":"texture","u":"u_noiseTexture","group":"hidden"},{"key":"colors","label":"配色","kind":"colors","u":"u_colors","countU":"u_colorsCount","max":6,"group":"main"},{"key":"colorBack","label":"背景色","kind":"color","u":"u_colorBack","group":"main"},{"key":"thickness","label":"厚度","kind":"range","u":"u_thickness","min":0.01,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"radius","label":"半径","kind":"range","u":"u_radius","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"innerShape","label":"内部形状","kind":"range","u":"u_innerShape","min":0,"max":4,"step":0.05,"int":false,"group":"main"},{"key":"noiseIterations","label":"噪声迭代","kind":"range","u":"u_noiseIterations","min":1,"max":8,"step":1,"int":true,"group":"main"},{"key":"noiseScale","label":"噪声尺度","kind":"range","u":"u_noiseScale","min":0.01,"max":5,"step":0.05,"int":false,"group":"main"}],
    presets: [{"name":"默认","params":{"fit":"contain","scale":0.8,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0.5,"frame":0,"colorBack":"#000000","colors":["#ffffff"],"noiseScale":3,"noiseIterations":8,"radius":0.25,"thickness":0.65,"innerShape":0.7}},{"name":"线条","params":{"fit":"contain","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"frame":0,"colorBack":"#000000","colors":["#4540a4","#1fe8ff"],"noiseScale":1.1,"noiseIterations":2,"radius":0.38,"thickness":0.01,"innerShape":0.88,"speed":4}},{"name":"日冕","params":{"fit":"contain","scale":2,"rotation":0,"offsetX":0,"offsetY":1,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#000000","colors":["#ffffff","#ffca0a","#fc6203","#fc620366"],"noiseScale":2,"noiseIterations":3,"radius":0.4,"thickness":0.8,"innerShape":4}},{"name":"云","params":{"fit":"contain","scale":2.5,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"frame":0,"colorBack":"#81ADEC","colors":["#ffffff"],"noiseScale":3,"noiseIterations":10,"radius":0.5,"thickness":0.65,"innerShape":0.85,"speed":0.5}}],
  },
  "warp": {
    key: "warp",
    label: "扭曲织纹",
    note: "条纹与棋盘在噪声场里被扭曲。",
    fragment: warpFragmentShader,
    mipmaps: [],
    image: null,
    animated: true,
    defaults: {"fit":"none","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colors":["#121212","#9470ff","#121212","#8838ff"],"proportion":0.45,"softness":1,"distortion":0.25,"swirl":0.8,"swirlIterations":10,"shapeScale":0.1,"shape":"checks"},
    params: [{"key":"noiseTexture","label":"噪声贴图","kind":"texture","u":"u_noiseTexture","group":"hidden"},{"key":"colors","label":"配色","kind":"colors","u":"u_colors","countU":"u_colorsCount","max":6,"group":"main"},{"key":"proportion","label":"图案占比","kind":"range","u":"u_proportion","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"softness","label":"柔和度","kind":"range","u":"u_softness","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"distortion","label":"扭曲","kind":"range","u":"u_distortion","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"swirl","label":"涡旋","kind":"range","u":"u_swirl","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"swirlIterations","label":"涡旋迭代","kind":"range","u":"u_swirlIterations","min":2,"max":20,"step":1,"int":true,"group":"main"},{"key":"shape","label":"形状","kind":"select","u":"u_shape","table":"WarpPatterns","options":[["checks","棋盘",0],["stripes","条纹",1],["edge","边缘",2]],"group":"main"},{"key":"shapeScale","label":"图案缩放","kind":"range","u":"u_shapeScale","min":0,"max":1,"step":0.01,"int":false,"group":"main"}],
    presets: [{"name":"默认","params":{"fit":"none","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colors":["#121212","#9470ff","#121212","#8838ff"],"proportion":0.45,"softness":1,"distortion":0.25,"swirl":0.8,"swirlIterations":10,"shapeScale":0.1,"shape":"checks"}},{"name":"坩埚","params":{"fit":"none","scale":0.9,"rotation":160,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":10,"frame":0,"colors":["#a7e58b","#324472","#0a180d"],"proportion":0.64,"softness":1.5,"distortion":0.2,"swirl":0.86,"swirlIterations":7,"shapeScale":0.6,"shape":"edge"}},{"name":"流动墨","params":{"fit":"none","scale":1.2,"rotation":44,"offsetX":0,"offsetY":-0.3,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":2.5,"frame":0,"colors":["#111314","#9faeab","#f3fee7","#f3fee7"],"proportion":0.05,"softness":0,"distortion":0.25,"swirl":0.8,"swirlIterations":10,"shapeScale":0.28,"shape":"checks"}},{"name":"海带","params":{"fit":"none","scale":0.8,"rotation":50,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":20,"frame":0,"colors":["#dbff8f","#404f3e","#091316"],"proportion":0.67,"softness":0,"distortion":0,"swirl":0.2,"swirlIterations":3,"shapeScale":1,"shape":"stripes"}},{"name":"花蜜","params":{"fit":"none","scale":2,"rotation":0,"offsetX":0,"offsetY":0.6,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":4.2,"frame":0,"colors":["#151310","#d3a86b","#f0edea"],"proportion":0.24,"softness":1,"distortion":0.21,"swirl":0.57,"swirlIterations":10,"shapeScale":0.75,"shape":"edge"}},{"name":"热情","params":{"fit":"none","scale":2.5,"rotation":1.35,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":3,"frame":0,"colors":["#3b1515","#954751","#ffc085"],"proportion":0.5,"softness":1,"distortion":0.09,"swirl":0.9,"swirlIterations":6,"shapeScale":0.25,"shape":"checks"}}],
  },
  "dot-grid": {
    key: "dot-grid",
    label: "点阵网格",
    note: "可调间距与描边的点阵图案。",
    fragment: dotGridFragmentShader,
    mipmaps: [],
    image: null,
    animated: false,
    defaults: {"fit":"none","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"colorBack":"#000000","colorFill":"#ffffff","colorStroke":"#ffaa00","size":2,"gapX":32,"gapY":32,"strokeWidth":0,"sizeRange":0,"opacityRange":0,"shape":"circle"},
    params: [{"key":"colorBack","label":"背景色","kind":"color","u":"u_colorBack","group":"main"},{"key":"colorFill","label":"填充色","kind":"color","u":"u_colorFill","group":"main"},{"key":"colorStroke","label":"描边色","kind":"color","u":"u_colorStroke","group":"main"},{"key":"shape","label":"形状","kind":"select","u":"u_shape","table":"DotGridShapes","options":[["circle","圆形",0],["diamond","菱形",1],["square","方形",2],["triangle","三角",3]],"group":"main"},{"key":"size","label":"尺寸","kind":"range","u":"u_dotSize","min":1,"max":100,"step":1,"int":true,"group":"main"},{"key":"gapX","label":"横向间距","kind":"range","u":"u_gapX","min":2,"max":500,"step":1,"int":true,"group":"main"},{"key":"gapY","label":"纵向间距","kind":"range","u":"u_gapY","min":2,"max":500,"step":1,"int":true,"group":"main"},{"key":"strokeWidth","label":"描边宽度","kind":"range","u":"u_strokeWidth","min":0,"max":50,"step":1,"int":true,"group":"main"},{"key":"sizeRange","label":"尺寸变化","kind":"range","u":"u_sizeRange","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"opacityRange","label":"透明度范围","kind":"range","u":"u_opacityRange","min":0,"max":1,"step":0.01,"int":false,"group":"main"}],
    presets: [{"name":"默认","params":{"fit":"none","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"colorBack":"#000000","colorFill":"#ffffff","colorStroke":"#ffaa00","size":2,"gapX":32,"gapY":32,"strokeWidth":0,"sizeRange":0,"opacityRange":0,"shape":"circle"}},{"name":"三角","params":{"fit":"none","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"colorBack":"#ffffff","colorFill":"#ffffff","colorStroke":"#808080","size":5,"gapX":32,"gapY":32,"strokeWidth":1,"sizeRange":0,"opacityRange":0,"shape":"triangle"}},{"name":"林线","params":{"fit":"none","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"colorBack":"#f4fce7","colorFill":"#052e19","colorStroke":"#000000","size":8,"gapX":20,"gapY":90,"strokeWidth":0,"sizeRange":1,"opacityRange":0.6,"shape":"circle"}},{"name":"壁纸","params":{"fit":"none","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"colorBack":"#204030","colorFill":"#000000","colorStroke":"#bd955b","size":9,"gapX":32,"gapY":32,"strokeWidth":1,"sizeRange":0,"opacityRange":0,"shape":"diamond"}}],
  },
  "god-rays": {
    key: "god-rays",
    label: "神光",
    note: "从底部散开的光束。",
    fragment: godRaysFragmentShader,
    mipmaps: [],
    image: null,
    animated: true,
    defaults: {"fit":"contain","scale":1,"rotation":0,"offsetX":0,"offsetY":-0.55,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"colorBack":"#000000","colorBloom":"#0000ff","colors":["#a600ff6e","#6200fff0","#ffffff","#33fff5"],"density":0.3,"spotty":0.3,"midIntensity":0.4,"midSize":0.2,"intensity":0.8,"bloom":0.4,"speed":0.75,"frame":0},
    params: [{"key":"noiseTexture","label":"噪声贴图","kind":"texture","u":"u_noiseTexture","group":"hidden"},{"key":"colors","label":"配色","kind":"colors","u":"u_colors","countU":"u_colorsCount","max":6,"group":"main"},{"key":"colorBack","label":"背景色","kind":"color","u":"u_colorBack","group":"main"},{"key":"colorBloom","label":"辉光色","kind":"color","u":"u_colorBloom","group":"main"},{"key":"bloom","label":"辉光","kind":"range","u":"u_bloom","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"intensity","label":"强度","kind":"range","u":"u_intensity","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"density","label":"密度","kind":"range","u":"u_density","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"spotty","label":"斑点","kind":"range","u":"u_spotty","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"midSize","label":"中层尺寸","kind":"range","u":"u_midSize","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"midIntensity","label":"中层强度","kind":"range","u":"u_midIntensity","min":0,"max":1,"step":0.01,"int":false,"group":"main"}],
    presets: [{"name":"默认","params":{"fit":"contain","scale":1,"rotation":0,"offsetX":0,"offsetY":-0.55,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"colorBack":"#000000","colorBloom":"#0000ff","colors":["#a600ff6e","#6200fff0","#ffffff","#33fff5"],"density":0.3,"spotty":0.3,"midIntensity":0.4,"midSize":0.2,"intensity":0.8,"bloom":0.4,"speed":0.75,"frame":0}},{"name":"扭曲","params":{"fit":"contain","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"colorBack":"#000000","colorBloom":"#222288","colors":["#ff47d4","#ff8c00","#ffffff"],"density":0.45,"spotty":0.15,"midIntensity":0.4,"midSize":0.33,"intensity":0.79,"bloom":0.4,"speed":2,"frame":0}},{"name":"线性","params":{"fit":"contain","scale":1,"rotation":0,"offsetX":0.2,"offsetY":-0.8,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"colorBack":"#000000","colorBloom":"#eeeeee","colors":["#ffffff1f","#ffffff3d","#ffffff29"],"density":0.41,"spotty":0.25,"midSize":0.1,"midIntensity":0.75,"intensity":0.79,"bloom":1,"speed":0.5,"frame":0}},{"name":"以太","params":{"fit":"contain","scale":1,"rotation":0,"offsetX":-0.6,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"colorBack":"#090f1d","colorBloom":"#ffffff","colors":["#148effa6","#c4dffebe","#232a47"],"density":0.03,"spotty":0.77,"midSize":0.1,"midIntensity":0.6,"intensity":0.6,"bloom":0.6,"speed":1,"frame":0}}],
  },
  "metaballs": {
    key: "metaballs",
    label: "融球",
    note: "多个融合的球体。",
    fragment: metaballsFragmentShader,
    mipmaps: [],
    image: null,
    animated: true,
    defaults: {"fit":"contain","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#000000","colors":["#6e33cc","#ff5500","#ffc105","#ffc800","#f585ff"],"count":10,"size":0.83},
    params: [{"key":"noiseTexture","label":"噪声贴图","kind":"texture","u":"u_noiseTexture","group":"hidden"},{"key":"colors","label":"配色","kind":"colors","u":"u_colors","countU":"u_colorsCount","max":6,"group":"main"},{"key":"colorBack","label":"背景色","kind":"color","u":"u_colorBack","group":"main"},{"key":"count","label":"数量","kind":"range","u":"u_count","min":1,"max":20,"step":1,"int":true,"group":"main"},{"key":"size","label":"尺寸","kind":"range","u":"u_size","min":0,"max":1,"step":0.01,"int":false,"group":"main"}],
    presets: [{"name":"默认","params":{"fit":"contain","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorBack":"#000000","colors":["#6e33cc","#ff5500","#ffc105","#ffc800","#f585ff"],"count":10,"size":0.83}},{"name":"墨滴","params":{"fit":"contain","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":2,"frame":0,"colorBack":"#ffffff00","colors":["#000000"],"count":18,"size":0.1}},{"name":"日冕","params":{"fit":"contain","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colors":["#ffc800","#ff5500","#ffc105"],"colorBack":"#102f84","count":7,"size":0.75}},{"name":"背景","params":{"fit":"contain","scale":4,"rotation":0,"offsetX":-0.3,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":0.5,"frame":0,"colors":["#ae00ff","#00ff95","#ffc105"],"colorBack":"#2a273f","count":13,"size":0.81}}],
  },
  "neuro-noise": {
    key: "neuro-noise",
    label: "神经噪声",
    note: "高对比的神经纤维状噪声。",
    fragment: neuroNoiseFragmentShader,
    mipmaps: [],
    image: null,
    animated: true,
    defaults: {"fit":"none","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorFront":"#ffffff","colorMid":"#47a6ff","colorBack":"#000000","brightness":0.05,"contrast":0.3},
    params: [{"key":"colorFront","label":"前景色","kind":"color","u":"u_colorFront","group":"main"},{"key":"colorMid","label":"中间色","kind":"color","u":"u_colorMid","group":"main"},{"key":"colorBack","label":"背景色","kind":"color","u":"u_colorBack","group":"main"},{"key":"brightness","label":"亮度","kind":"range","u":"u_brightness","min":0,"max":1,"step":0.01,"int":false,"group":"main"},{"key":"contrast","label":"对比度","kind":"range","u":"u_contrast","min":0,"max":1,"step":0.01,"int":false,"group":"main"}],
    presets: [{"name":"默认","params":{"fit":"none","scale":1,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorFront":"#ffffff","colorMid":"#47a6ff","colorBack":"#000000","brightness":0.05,"contrast":0.3}},{"name":"感知","params":{"fit":"none","scale":3,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorFront":"#00c8ff","colorMid":"#fbff00","colorBack":"#8b42ff","brightness":0.19,"contrast":0.12}},{"name":"血流","params":{"fit":"none","scale":0.7,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorFront":"#ff0000","colorMid":"#ff0000","colorBack":"#ffffff","brightness":0.24,"contrast":0.17}},{"name":"幽灵","params":{"fit":"none","scale":0.55,"rotation":0,"offsetX":0,"offsetY":0,"originX":0.5,"originY":0.5,"worldWidth":0,"worldHeight":0,"speed":1,"frame":0,"colorFront":"#ffffff","colorMid":"#000000","colorBack":"#ffffff","brightness":0,"contrast":1}}],
  },
};
