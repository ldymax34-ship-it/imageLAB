/**
 * 用户 SVG 模型色散光束的运行时常量。
 *
 * 原始来源：vercel-labs/vgpu，commit
 * `81c4a27e548c4b4e1fd445bca6b65004a6e6fdf5`（MIT），原始文件
 * `apps/docs/app/[lang]/(home)/components/prism-background/types.ts`。
 * 这里只保留官网确定性光束（光谱采样、有限宽度切片、光衰减、bloom、Cauchy 色散）真正用到的
 * 默认值；官网写死的三角棱镜几何、相机、玻璃材质、环境贴图与主题控件已随固定场景一并删除。
 */

/** 光谱范围与采样密度，与官网一致（400–700 nm、128 个波长顶点、24 条光束切片）。 */
export const PRISM_WAVELENGTHS = { min: 400, max: 700 };
export const PRISM_SPECTRAL_SAMPLES = 64 * 2;
export const PRISM_BEAM_SLICES = 24;
/** 光源本身是 HDR 发光体，不做普通白色绘制。 */
export const PRISM_LIGHT_EXPOSURE = 88;
/** 解析求解器放弃前的内部反射次数。 */
export const PRISM_MAX_INTERNAL_BOUNCES = 3;
/** 官网默认光衰减（固定 reveal=1）。 */
export const PRISM_LIGHT_FADE = {
  beamOpacity: 1,
  edgeFalloff: 16,
  rainbowFalloffRate: 3.8,
  rainbowFalloffPower: 3.7,
};
export const DEFAULT_LIGHT_FADE_CONTROLS = PRISM_LIGHT_FADE;
/** 官网默认 post-process；光束 HDR 亮度需要 bloom 才读得成"光"。 */
export const PRISM_POSTPROCESS = {
  bloomStrength: 0.7,
  bloomThreshold: 0.1,
  bloomRadius: 0.25,
};

/**
 * Cauchy 色散 `n(l) = base + strength / l²`（l 单位 µm）。
 *
 * 上游 `PRISM_DISPERSION_PRESETS.stylized` 的官方默认值；本项目把 `strength` 接给界面的
 * 「色散范围」滑杆（100% = 该默认值，200% = 0.12，仍在上游 `PRISM_SPECTRAL_DISPERSION_RANGES`
 * 的 [0, 0.2] 之内）。
 */
export const PRISM_DISPERSION = { base: 1.245, strength: 0.06 };

/**
 * 光束所在的世界深度。
 *
 * 上游把棱镜挤出到墙外再取其中间深度；本项目的光束作用在建模页签交接的**当前 SVG 挤出模型**
 * 上，模型恒定居中于原点（`merged.translate(-center)`），所以挤出体的中间深度就是 z = 0。
 */
export const LIGHT_PLANE_Z = 0;
/**
 * 光束带被裁剪到的世界矩形半径。
 *
 * 上游按固定相机把墙算到刚好覆盖视口；本工具的用户可以自由环绕 / 缩放（相机距离 2.5–32），
 * 因此给一个足以覆盖常见构图的固定范围，出射扇形靠光衰减自然淡出，不出现硬边。
 */
export const LIGHT_WALL_HALF_EXTENT = [8, 8];
/** 光束半宽相对模型外接圆半径的比例（0.05 ≈ 模型宽度的 7%，比官网棱镜略粗以免过细）。 */
export const BEAM_HALF_WIDTH_RATIO = 0.05;
