/**
 * vgpu 官方首页棱镜场景的运行时常量（精简移植）。
 *
 * 原始来源：vercel-labs/vgpu，commit
 * `81c4a27e548c4b4e1fd445bca6b65004a6e6fdf5`，MIT；原始文件
 * `apps/docs/app/[lang]/(home)/components/prism-background/types.ts`
 * 与 `scene/light-mesh.ts`。本副本只保留固定“官方棱镜场景”所需的默认值与几何；
 * 不包含官网的调试面板、性能采样、粒子、主题切换与控件系统。
 */

/** 侧长 / 锥角 / 深度 / 墙缝等固定几何，与官网首页一致。 */
export const PRISM_SIDE = 0.57;
export const PRISM_DEPTH = 0.3;
export const PRISM_WALL_GAP = 0.015;
export const PRISM_BACK_Z = PRISM_WALL_GAP;
export const PRISM_FRONT_Z = PRISM_WALL_GAP + PRISM_DEPTH;
export const PRISM_LIGHT_PLANE_Z = (PRISM_BACK_Z + PRISM_FRONT_Z) * 0.5;
export const PRISM_MAX_INTERNAL_BOUNCES = 3;
export const PRISM_WAVELENGTHS = { min: 400, max: 700 };
export const PRISM_SPECTRAL_SAMPLES = 64 * 2;
export const PRISM_BEAM_SLICES = 24;
export const PRISM_LIGHT_EXPOSURE = 88;
export const PRISM_LAMP_DISTANCE = 6.5;
export const PRISM_INCIDENCE_DEGREES = 60;
export const PRISM_DEFAULT_BEAM_WIDTH = 0.025;
export const CAMERA_FOV_DEGREES = 48;
export const CAMERA_DISTANCE = 1.25;
export const CAMERA_YAW_DEGREES = 0;
export const CAMERA_PITCH_DEGREES = 0;
export const CAMERA_ORBIT_DEGREES = 3.5;
/** 官网默认 dark 主题玻璃；固定场景不提供主题切换。 */
export const PRISM_GLASS = {
  environmentRotation: [0, 0, 0],
  ior: 1.645,
  absorption: [1, 1, 0.54],
  reflectionStrength: 2.14,
  environmentExposure: 2.3,
};
/** 官网默认 post-process；本场景不开放控件。 */
export const PRISM_POSTPROCESS = {
  bloomStrength: 0.7,
  bloomThreshold: 0.1,
  bloomRadius: 0.25,
};
/** 官网默认光衰减（固定 reveal=1）。 */
export const PRISM_LIGHT_FADE = {
  beamOpacity: 1,
  edgeFalloff: 16,
  rainbowFalloffRate: 3.8,
  rainbowFalloffPower: 3.7,
};
/** light-mesh 需要的上游默认名称（同一组固定值）。 */
export const DEFAULT_LIGHT_FADE_CONTROLS = PRISM_LIGHT_FADE;
/** 官网 stylized 色散（Cauchy base+strength）。 */
export const PRISM_DISPERSION = { base: 1.2, strength: 0.1 };

export function clampBeamWidth(width) {
  if (!Number.isFinite(width)) return PRISM_DEFAULT_BEAM_WIDTH;
  return Math.min(0.2, Math.max(0.01, width));
}

function rotate(point, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [point[0] * cosine - point[1] * sine, point[0] * sine + point[1] * cosine];
}

const radians = (degrees) => (degrees * Math.PI) / 180;

/** Equilateral prism, apex up, wound counter-clockwise; matches upstream. */
export const PRISM_TRIANGLE = (() => {
  const circumradius = PRISM_SIDE / Math.sqrt(3);
  const vertex = (degrees) => {
    const spun = rotate([circumradius, 0], radians(degrees));
    return [spun[0], spun[1]];
  };
  return { a: vertex(90), b: vertex(210), c: vertex(330) };
})();

export function prismEntryPoint(position) {
  const clamped = Math.min(1, Math.max(0, position));
  return [
    PRISM_TRIANGLE.a[0] + (PRISM_TRIANGLE.c[0] - PRISM_TRIANGLE.a[0]) * clamped,
    PRISM_TRIANGLE.a[1] + (PRISM_TRIANGLE.c[1] - PRISM_TRIANGLE.a[1]) * clamped,
  ];
}

/** A finite collimated beam emitted from one point and aimed at another. */
export function collimatedLightBetween(center, target, beamWidth = PRISM_DEFAULT_BEAM_WIDTH) {
  const offset = [target[0] - center[0], target[1] - center[1]];
  const distance = Math.hypot(offset[0], offset[1]);
  if (!Number.isFinite(distance) || distance <= 1e-8) {
    throw new Error("A collimated light needs distinct finite center and target points.");
  }
  return {
    center,
    direction: [offset[0] / distance, offset[1] / distance],
    beamHalfWidth: clampBeamWidth(beamWidth) * 0.5,
  };
}

/** The default lamp at the official 60-degree incidence angle. */
export function lampForIncidence(
  incidenceDegrees,
  beamWidth = PRISM_DEFAULT_BEAM_WIDTH,
  entryPosition = 0.5
) {
  const face = [
    PRISM_TRIANGLE.a[0] - PRISM_TRIANGLE.c[0],
    PRISM_TRIANGLE.a[1] - PRISM_TRIANGLE.c[1],
  ];
  const faceLength = Math.hypot(face[0], face[1]);
  const inward = [-face[1] / faceLength, face[0] / faceLength];
  const direction = rotate(inward, radians(-incidenceDegrees));
  const clampedBeamWidth = clampBeamWidth(beamWidth);
  const entryMargin = Math.min(
    0.45,
    clampedBeamWidth /
      (2 * faceLength * Math.max(0.05, Math.abs(Math.cos(radians(incidenceDegrees))))) +
      1e-4
  );
  const entryPoint = prismEntryPoint(
    Math.min(1 - entryMargin, Math.max(entryMargin, entryPosition))
  );
  return collimatedLightBetween(
    [
      entryPoint[0] - direction[0] * PRISM_LAMP_DISTANCE,
      entryPoint[1] - direction[1] * PRISM_LAMP_DISTANCE,
    ],
    entryPoint,
    clampedBeamWidth
  );
}
