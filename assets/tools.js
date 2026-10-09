/* ImageLAB 首页数据源：登记已经实现完成、可独立打开的入口。
 * 封面一律来自工具真实导出结果，放在 public/assets/covers/<id>.png；
 * 文件缺失时首页显示中性占位（不会破图，也不会伪造效果图）。
 * 各入口的浏览器验收状态见 README.md 的工具清单表。 */
window.IMAGELAB_TOOLS = [
  {
    id: "texture",
    name: "纹理间",
    en: "Pattern Studio",
    cat: "纹理生成",
    desc: "点阵渐变与曲线纹理，参数化生成无缝图案，导出 PNG / SVG / 参数 JSON。",
    href: "tools/texture/index.html",
    cover: "assets/covers/texture.png",
    span: 8,
    keywords: "纹理 图案 无缝 点阵 曲线 pattern seamless",
    note: "本地处理 · 素材不上传"
  },
  {
    id: "pixelit",
    name: "像素画",
    en: "Pixel It",
    cat: "像素与点阵",
    desc: "把图片转成像素画：像素颗粒、调色板与灰度可调，导出 PNG。",
    href: "tools/pixelit/index.html",
    cover: "assets/covers/pixelit.png",
    span: 6,
    keywords: "像素 复古 8bit 点阵 调色板 pixel art",
    note: "本地处理 · 素材不上传"
  },
  {
    id: "image-to-pixel",
    name: "像素化与抖动",
    en: "Dither Studio",
    cat: "像素与点阵",
    desc: "把照片做成颗粒分明的像素画或抖动网点，颗粒大小、抖动方式与颜色可调，导出 PNG。",
    href: "tools/image-to-pixel/index.html",
    cover: "assets/covers/image-to-pixel.png",
    span: 6,
    keywords: "像素 抖动 dither 二值 调色板 复古 bayer atkinson",
    note: "本地处理 · 素材不上传"
  },
  {
    id: "image-to-ascii",
    name: "字符画",
    en: "Image to ASCII",
    cat: "字符与文字",
    desc: "把图片转换成字符画，保留原图明暗关系，导出 PNG。",
    href: "tools/image-to-ascii/index.html",
    cover: "assets/covers/image-to-ascii.png",
    span: 6,
    keywords: "字符 ascii 文字 点阵 终端 text art",
    note: "本地处理 · 素材不上传"
  },
  {
    id: "shaders-logo",
    name: "Logo 材质",
    en: "Shader Logo",
    cat: "着色器效果",
    desc: "上传透明底 Logo，套上液态金属或宝石烟雾材质；也可用内置形状直接调。",
    href: "tools/shaders-logo/index.html",
    cover: "assets/covers/shaders-logo.png",
    span: 4,
    keywords: "logo 液态金属 宝石 遮罩 着色器 metal",
    note: "实时渲染 · 可定格单帧导出 PNG"
  },
  {
    id: "shaders-bg",
    name: "动态背景",
    en: "Backgrounds",
    cat: "着色器效果",
    desc: "八个可动的背景效果，各带多组预设，可暂停或定格到某一帧再导出。",
    href: "tools/shaders-bg/index.html",
    cover: "assets/covers/shaders-bg.png",
    span: 4,
    keywords: "背景 渐变 噪声 网格 神光 融球 着色器 background gradient",
    note: "实时渲染 · 可定格单帧导出 PNG"
  },
  {
    id: "shaders-halftone",
    name: "半调与网点",
    en: "Halftone",
    cat: "着色器效果",
    desc: "CMYK 四色半调、单色网点、有限色阶抖动，上传本地图片即可开始。",
    href: "tools/shaders-halftone/index.html",
    cover: "assets/covers/shaders-halftone.png",
    span: 4,
    keywords: "半调 网点 cmyk 印刷 抖动 halftone dots",
    note: "本地处理 · 素材不上传"
  },
  {
    id: "extrude3d",
    name: "SVG 挤出三维",
    en: "Extrude 3D",
    cat: "三维与立体",
    desc: "把简单闭合的 SVG 挤出成立体：厚度、倒角、圆滑度与材质可调，导出透明背景 PNG。",
    href: "tools/extrude3d/index.html",
    cover: "assets/covers/extrude3d.png",
    span: 8,
    keywords: "三维 立体 3d svg 挤出 倒角 材质 金属 玻璃 extrude",
    note: "本地处理 · 素材不上传"
  },
  {
    id: "psychos",
    name: "节点式版式",
    en: "Generative Layout",
    cat: "版式与切片",
    desc: "节点式拼版：网格、切片、洗牌、放置，可导出 2048×2048 PNG。",
    href: "tools/psychos/index.html",
    cover: "assets/covers/psychos.png",
    span: 6,
    keywords: "版式 拼贴 切片 shuffle slice 生成式 海报",
    note: "需构建后访问 · 实时渲染"
  },
  {
    /* 外部网站入口：只做跳转，不本地部署、不复制源码、不下载封面、不 iframe、不引入运行时请求。
     * external:true 时首页渲染为纯文字入口（不伪造效果图），两处链接均 target=_blank rel=noopener noreferrer。 */
    id: "space-type-generator",
    name: "动态文字",
    en: "Space Type Generator",
    cat: "字符与文字",
    desc: "在线生成动态排版文字动画，点击跳转官网使用；外部网站内容由对方提供。",
    href: "https://spacetypegenerator.com/",
    span: 4,
    external: true,
    keywords: "动态文字 文字动画 排版 字体 kinetic typography space type generator spacetypegenerator"
  },
  {
    id: "shader-lab",
    name: "效果堆叠",
    en: "Shader Lab",
    cat: "着色器效果",
    desc: "在线堆叠组合着色器效果并实时预览，点击跳转官网使用；外部网站内容由对方提供。",
    href: "https://eng.basement.studio/tools/shader-lab",
    span: 4,
    external: true,
    keywords: "着色器 shader 效果堆叠 组合 实时预览 basement studio shader lab"
  },
  {
    id: "tooooools",
    name: "图像网点",
    en: "Tooooools",
    cat: "像素与点阵",
    desc: "在线把图片转成网点 / 半调等点阵效果，点击跳转官网使用；外部网站内容由对方提供。",
    href: "https://www.tooooools.app/",
    span: 4,
    external: true,
    keywords: "网点 半调 点阵 图像 halftone dots tooooools"
  }
];
