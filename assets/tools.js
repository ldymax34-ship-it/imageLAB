/* ImageLAB 首页数据源：登记已经实现完成、可独立打开的入口。
 * 封面一律是**仓库本地**图片（放在 public/assets/covers/<id>.png），运行时不会请求任何第三方图片：
 *   - 12 个内置工具的封面来自工具真实导出结果；
 *   - 4 个外部网站入口的封面是验收方从公开官网当前页面截取后、保存进本仓库的页面缩略图，
 *     只作导航预览；外部网站内容不由本项目提供，卡片仍明确标「外部网站」并显示主机名。
 * 文件缺失时首页显示中性占位（不会破图，也不会伪造效果图）。
 * 各入口的浏览器验收状态见 README.md 的工具清单表。
 *
 * 字段说明：首页卡片只渲染 name / cat / href / cover（外部入口额外渲染「外部网站」标识与 href 主机名），
 * 不渲染任何说明文字；keywords 只服务搜索，en 只服务来源记录。
 * coverQuery 只用于效果改版后强制换新首页封面缓存（同一批次统一使用一个新值）。
 * 因此这里不再登记 desc / note / span —— 工具一览是统一的一行 4 个，
 * 卡片宽度由 CSS 网格决定，页面上没有 desc / note 的位置，留着只会变成「废话」。 */
// 首页陈列顺序：成熟视觉工具优先，外部网站放在末尾。
window.IMAGELAB_TOOLS = [
  {
    id: "extrude3d",
    name: "SVG 转 3D",
    en: "Extrude 3D",
    cat: "三维与立体",
    href: "tools/extrude3d/index.html",
    cover: "assets/covers/extrude3d.png",
    // 本批统一刷新全部封面，强制换新 query 避免首页命中旧封面缓存；真实封面由验收方导出。
    coverQuery: "20261014-refresh1",
    keywords: "三维 立体 3d svg 挤出 倒角 材质 金属 玻璃 extrude",
  },
  {
    id: "shaders-logo",
    name: "标志材质",
    en: "Shader Logo",
    cat: "着色器效果",
    href: "tools/shaders-logo/index.html",
    cover: "assets/covers/shaders-logo.png",
    coverQuery: "20261014-refresh1",
    keywords: "logo 液态金属 宝石 遮罩 着色器 metal",
  },
  {
    id: "shaders-bg",
    name: "动态背景",
    en: "Backgrounds",
    cat: "着色器效果",
    href: "tools/shaders-bg/index.html",
    cover: "assets/covers/shaders-bg.png",
    coverQuery: "20261014-refresh1",
    keywords: "背景 渐变 噪声 网格 神光 融球 着色器 background gradient",
  },
  {
    id: "shaders-halftone",
    name: "半调网点",
    en: "Halftone",
    cat: "着色器效果",
    href: "tools/shaders-halftone/index.html",
    cover: "assets/covers/shaders-halftone.png",
    coverQuery: "20261014-refresh1",
    keywords: "半调 网点 cmyk 印刷 抖动 halftone dots",
  },
  {
    id: "psychos",
    name: "图片拼贴",
    en: "Generative Layout",
    cat: "版式与切片",
    href: "tools/psychos/index.html",
    cover: "assets/covers/psychos.png",
    coverQuery: "20261014-refresh1",
    keywords: "版式 拼贴 切片 shuffle slice 生成式 海报",
  },
  {
    id: "pixelit",
    name: "像素画",
    en: "Pixel It",
    cat: "像素与点阵",
    href: "tools/pixelit/index.html",
    cover: "assets/covers/pixelit.png",
    coverQuery: "20261014-refresh1",
    keywords: "像素 复古 8bit 点阵 调色板 pixel art",
  },
  {
    id: "image-to-pixel",
    name: "图片抖动",
    en: "Dither Studio",
    cat: "像素与点阵",
    href: "tools/image-to-pixel/index.html",
    cover: "assets/covers/image-to-pixel.png",
    coverQuery: "20261014-refresh1",
    keywords: "像素 抖动 dither 二值 调色板 复古 bayer atkinson",
  },
  {
    id: "image-to-ascii",
    name: "字符画",
    en: "Image to ASCII",
    cat: "字符与文字",
    href: "tools/image-to-ascii/index.html",
    cover: "assets/covers/image-to-ascii.png",
    coverQuery: "20261014-refresh1",
    keywords: "字符 ascii 文字 点阵 终端 text art",
  },
  {
    id: "texture",
    name: "纹理生成器",
    en: "Pattern Studio",
    cat: "纹理生成",
    href: "tools/texture/index.html",
    cover: "assets/covers/texture.png",
    coverQuery: "20261014-refresh1",
    keywords: "纹理 图案 无缝 点阵 曲线 pattern seamless",
  },
  {
    id: "mixed-type",
    name: "文字混排",
    en: "Mixed Type",
    cat: "字符与文字",
    href: "tools/mixed-type/index.html",
    cover: "assets/covers/mixed-type.png",
    coverQuery: "20261014-refresh1",
    keywords: "文字 混排 中英文 排版 字族 海报 描边 字体 typography poster",
  },
  {
    id: "wave-grid",
    name: "辉光点阵",
    en: "Glow Grid",
    cat: "像素与点阵",
    href: "tools/wave-grid/index.html",
    cover: "assets/covers/wave-grid.png",
    coverQuery: "20261014-refresh1",
    keywords: "点阵 发光 条带 字母 logo led 矩阵 动效 辉光 glow grid matrix 光丝 方向模糊",
  },
  {
    id: "ascii-motion",
    name: "动态字符画",
    en: "ASCII Motion",
    cat: "字符与文字",
    href: "tools/ascii-motion/index.html",
    cover: "assets/covers/ascii-motion.png",
    coverQuery: "20261014-refresh1",
    keywords: "字符画 ascii 动态 水母 圆环 隧道 波形 三维 动画 jellyfish",
  },
  {
    /* 外部网站入口：只做跳转，不本地部署、不复制源码 / 字体 / 素材、不 iframe、不引入运行时请求。
     * external:true 时首页渲染为带本地官网缩略图的入口（缩略图由验收方从公开官网当前页面截取，
     * 保存到 public/assets/covers/<id>.png），并保留「外部网站 · 跳转官网」标识与主机名；
     * 两处链接均 target=_blank rel=noopener noreferrer。 */
    id: "space-type-generator",
    name: "动态文字",
    en: "Space Type Generator",
    cat: "字符与文字",
    href: "https://spacetypegenerator.com/",
    external: true,
    cover: "assets/covers/space-type-generator.png",
    coverQuery: "20261014-refresh1",
    keywords: "动态文字 文字动画 排版 字体 kinetic typography space type generator spacetypegenerator"
  },
  {
    id: "shader-lab",
    name: "图片特效",
    en: "Shader Lab",
    cat: "着色器效果",
    href: "https://eng.basement.studio/tools/shader-lab",
    external: true,
    cover: "assets/covers/shader-lab.png",
    coverQuery: "20261014-refresh1",
    keywords: "着色器 shader 效果堆叠 组合 实时预览 basement studio shader lab"
  },
  {
    id: "tooooools",
    name: "图像网点",
    en: "Tooooools",
    cat: "像素与点阵",
    href: "https://www.tooooools.app/",
    external: true,
    cover: "assets/covers/tooooools.png",
    coverQuery: "20261014-refresh1",
    keywords: "网点 半调 点阵 图像 halftone dots tooooools"
  },
  {
    /* Brand Assets Generator（https://brand-generator.stoyanov.works/）：
     * 官网 HTML / 打包 bundle 没有 GitHub 或许可证链接，GitHub 公共搜索没有对应仓库，
     * 未找到公开源码或许可证原文 → 不能认定开源、不本地镜像源码 / 字体 / 素材，只登记为外链入口。
     * 封面是验收方从公开官网当前页面截取的本地缩略图，运行时首页只加载本仓库图片。 */
    id: "brand-assets-generator",
    name: "品牌素材生成",
    en: "Brand Assets Generator",
    cat: "版式与切片",
    href: "https://brand-generator.stoyanov.works/",
    external: true,
    cover: "assets/covers/brand-assets-generator.png",
    coverQuery: "20261014-refresh1",
    keywords: "品牌 素材 生成器 logo 版式 组合 assets brand generator stoyanov"
  }
];
