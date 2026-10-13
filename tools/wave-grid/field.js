/*
 * 辉光点阵 · 纯数值光带场（imageLAB 自有代码）
 *
 * 说明：本模块只做数值计算，不依赖 DOM / Canvas / three，便于在 Node 里用同一份公式
 * 直接测量覆盖率与字形分布。噪声值由调用方传入（main.js 用 three 自带的
 * `examples/jsm/math/SimplexNoise.js` 在每次布局时按格预计算），因此本文件不含任何
 * 逐帧噪声调用，也不在渲染循环里分配对象。
 *
 * 形态参考：basementstudio/shader-lab（Apache-2.0，pin 6f39a889db74978d93d882643e3cd2073b3666d6）
 * 的 particle-grid-pass（按格采样源图 + 阈值字形）与 directional-blur-pass（有限方向取样）
 * 思路；本文件是独立的数值实现，未复制其 TSL/WGSL 代码。详见 THIRD_PARTY.md。
 */

/** 四条色带的主色（蓝青 / 品红 / 红 / 绿青）。 */
export const BAND_COLORS = ["#31a6ff", "#ed58ff", "#ff4a59", "#48f4c7"];

/** 亮核与白色亮簇使用的浅色核心。 */
export const CORE_COLOR = "#eef8ff";

/** 色带在竖幅中的斜向程度（单位 ny / nx）：蓝色从左上约 y=0.10 平缓斜向右下。 */
export const BAND_SLOPE = 0.33;

/** 四条色带沿斜轴的初始中心：蓝上、品红中上、红中下、绿最下（右端自然裁切）。 */
export const BAND_CENTERS = [0.10, 0.34, 0.58, 0.82];

/** 单条色带的基准半宽（斜轴单位，1.0 约等于整幅高度）；略收窄以保持 40–55% 亮格。 */
export const HALF_WIDTH = 0.105;

export function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** 字形档位：0 空白、1 ×、2 □、3 ■；迟滞阈值（上/下）分档。 */
export const GLYPH_RISE = [0.07, 0.3, 0.66];
export const GLYPH_FALL = [0.035, 0.18, 0.5];

/**
 * 光带场：按格坐标 (nx, ny ∈ 0..1) 与三条预计算噪声（约 -1..1）求值。
 * `out.value` ∈ 0..1，`out.band` 为最强色带下标（-1 表示无）。
 * 复用同一个 `out` 对象，渲染循环里零分配。
 */
export function sampleGlow(nx, ny, n1, n2, n3, t, opts, out) {
  const amp = opts.amp;
  const bandScale = opts.bandWidth;
  const d = ny - BAND_SLOPE * nx + 0.06 * n1;
  let best = 0;
  let bestBand = -1;

  for (let band = 0; band < BAND_CENTERS.length; band += 1) {
    const center = BAND_CENTERS[band] + 0.085 * n1 + 0.02 * Math.sin(band * 2.7);
    const width = HALF_WIDTH * bandScale * (0.72 + 0.62 * (0.5 + 0.5 * Math.sin(n1 * 4.9 + band * 3.3)));
    let v = 1 - Math.abs(d - center) / width;
    if (v <= 0) continue;
    v = v * v * (3 - 2 * v);

    // 分段：沿色带方向用中频噪声断开，形成不规则、分段连接的大色块。
    const seg = smoothstep(-0.85, 0.25, n2 + 0.35 * Math.sin(n1 * 2.4 + band * 2.1));
    if (seg <= 0) continue;

    const flicker = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * (0.7 + 0.09 * band) + band * 2.3 + n1 * 4.2));
    const energy = 0.72 + 0.28 * (0.3 + 0.7 * amp) * flicker;
    v *= seg * energy;
    if (v > best) {
      best = v;
      bestBand = band;
    }
  }

  // 错落的小白色亮簇：高频噪声在已有亮区上叠加稀疏亮点。
  if (bestBand >= 0 && best > 0.34) {
    const cluster = (n3 - 0.68) / 0.32;
    if (cluster > 0) best = Math.max(best, 0.5 + 0.5 * clamp01(cluster));
  }

  out.value = clamp01(best);
  out.band = bestBand;
  return out;
}

/**
 * 迟滞字形：`prior` 为上一帧档位，避免边界抖动导致字形闪烁。
 * 返回 0..3。
 */
export function nextGlyph(prior, value) {
  // 每个档位用自己的「上升阈值」判定升级，却用更低一档的「下降阈值」判定降级，
  // 于是在阈值附近来回时不会 0/1/2/3 反复跳变（迟滞）。
  if (prior === 3) {
    if (value >= GLYPH_FALL[2]) return 3;
    if (value >= GLYPH_FALL[1]) return 2;
    return value >= GLYPH_FALL[0] ? 1 : 0;
  }
  if (prior === 2) {
    if (value >= GLYPH_RISE[2]) return 3;
    if (value >= GLYPH_FALL[1]) return 2;
    return value >= GLYPH_FALL[0] ? 1 : 0;
  }
  if (prior === 1) {
    if (value >= GLYPH_RISE[2]) return 3;
    if (value >= GLYPH_RISE[1]) return 2;
    return value >= GLYPH_FALL[0] ? 1 : 0;
  }
  if (value >= GLYPH_RISE[2]) return 3;
  if (value >= GLYPH_RISE[1]) return 2;
  return value >= GLYPH_RISE[0] ? 1 : 0;
}
