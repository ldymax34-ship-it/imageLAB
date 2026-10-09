/*
 * imageLAB · Paper Shaders 预览引擎
 *
 * 三个着色器工具（shaders-logo / shaders-bg / shaders-halftone）共用这一份实现。
 * 本文件只做两件事：把参数接到包导出的 uniform 上，以及管好 ShaderMount 生命周期。
 * 着色器本身一律直接复用 @paper-design/shaders 导出的 fragment shader 常量，未做改动。
 *
 * 关键约束（踩过的坑，勿改）：
 * 1. ShaderMount 默认不带 preserveDrawingBuffer，导出 PNG 会得到空白图，
 *    因此构造时必须显式传 webGlContextAttributes。
 * 2. ShaderMount 的纹理 uniform 只认「已加载完成的 HTMLImageElement」。
 *    传字符串（blob:/data: URL）会走到 "Unsupported uniform type" 分支而不上传纹理，
 *    所以 toProcessed* 产出的 pngBlob 必须先变成 <img> 并等 onload。
 * 3. 噪声贴图是包内嵌的 data URI，data URI 的 <img> 在 Chrome 里同步 complete；
 *    这里仍然 await 一次，避免其它浏览器上 complete=false 时抛错。
 */
import {
  ShaderMount,
  ShaderFitOptions,
  getShaderColorFromString,
  getShaderNoiseTexture,
  toProcessedLiquidMetal,
  toProcessedGemSmoke,
} from "@paper-design/shaders";

/** 图片 uniform 的占位贴图：1×1 全透明，避免采样到未初始化的纹理 */
const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

/** 导出 PNG 的前提；premultipliedAlpha/alpha 决定透明区域能否正确落盘 */
const GL_ATTRIBUTES = {
  alpha: true,
  antialias: true,
  premultipliedAlpha: true,
  preserveDrawingBuffer: true,
};

const SIZING_KEYS = [
  "fit",
  "scale",
  "rotation",
  "offsetX",
  "offsetY",
  "originX",
  "originY",
  "worldWidth",
  "worldHeight",
];

/** 加载一张图片，resolve 时保证 complete 且尺寸有效 */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败：" + String(src).slice(0, 64)));
    img.src = src;
  });
}

/** 确保一个已存在的 <img> 加载完成（data URI 通常已经 complete） */
function ready(img) {
  if (img && img.complete && img.naturalWidth > 0) return Promise.resolve(img);
  return new Promise((resolve, reject) => {
    if (!img) return reject(new Error("纹理缺失"));
    img.addEventListener("load", () => resolve(img), { once: true });
    img.addEventListener("error", () => reject(new Error("纹理加载失败")), { once: true });
  });
}

let placeholderPromise = null;
function transparentImage() {
  if (!placeholderPromise) placeholderPromise = loadImage(TRANSPARENT_PIXEL);
  return placeholderPromise;
}

/* ------------------------------------------------------------------ 颜色 */

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const byte = (v) => Math.round(clamp01(v) * 255);

/** "#rrggbb[aa]" → { hex: "#rrggbb", alpha: 0..1 } */
export function splitColor(value) {
  const [r, g, b, a] = getShaderColorFromString(value);
  const hex =
    "#" +
    [r, g, b]
      .map((v) => byte(v).toString(16).padStart(2, "0"))
      .join("");
  return { hex, alpha: Number.isFinite(a) ? a : 1 };
}

/** { hex, alpha } → "#rrggbb" 或 "#rrggbbaa" */
export function joinColor(hex, alpha) {
  if (alpha >= 1) return hex;
  return hex + byte(alpha).toString(16).padStart(2, "0");
}

/* -------------------------------------------------------------- 预览控制器 */

export class ShaderPreview {
  /**
   * @param {HTMLElement} stage 预览容器（ShaderMount 会把 canvas 前置进去）
   * @param {object} def 来自 catalog.js 的效果定义
   */
  constructor(stage, def) {
    this.stage = stage;
    this.def = def;
    this.state = { ...def.defaults };
    this.mount = null;
    this.imageEl = null;
    this.imageUrl = null;
    this.noise = null;
    this.imageToken = 0;
    /** @type {null | (() => void)} */
    this.onImageState = null;
  }

  /** 创建 ShaderMount（异步：等贴图就绪） */
  async init() {
    if (this.def.params.some((p) => p.kind === "texture")) {
      this.noise = await ready(getShaderNoiseTexture());
    }
    if (this.def.image) {
      this.placeholder = await transparentImage();
    }
    const uniforms = this.buildUniforms();
    this.mount = new ShaderMount(
      this.stage,
      this.def.fragment,
      uniforms,
      GL_ATTRIBUTES,
      Number(this.state.speed) || 0,
      Number(this.state.frame) || 0,
      2,
      undefined,
      this.def.mipmaps || []
    );
    return this;
  }

  /** 把 camelCase 参数状态翻译成 ShaderMount 认识的 u_* uniform 表 */
  buildUniforms() {
    const u = {};
    for (const p of this.def.params) {
      if (p.group === "hidden" || p.kind === "texture") {
        if (p.kind === "texture") u[p.u] = this.noise;
        continue;
      }
      const value = this.state[p.key];
      switch (p.kind) {
        case "color":
          u[p.u] = getShaderColorFromString(value);
          break;
        case "colors": {
          const list = Array.isArray(value) ? value : [];
          u[p.u] = list.map(getShaderColorFromString);
          u[p.countU] = list.length;
          break;
        }
        case "select": {
          const hit = p.options.find((o) => o[0] === value) || p.options[0];
          u[p.u] = hit[2];
          break;
        }
        case "bool":
          u[p.u] = Boolean(value);
          break;
        default:
          u[p.u] = Number(value);
      }
    }

    if (this.def.image) {
      const uniform = this.def.image.uniform || "u_image";
      u[uniform] = this.imageEl || this.placeholder;
      if (this.def.image.flag) u[this.def.image.flag] = Boolean(this.imageEl);
    }

    u.u_fit = ShaderFitOptions[this.state.fit] ?? 0;
    u.u_scale = Number(this.state.scale);
    u.u_rotation = Number(this.state.rotation);
    u.u_offsetX = Number(this.state.offsetX);
    u.u_offsetY = Number(this.state.offsetY);
    u.u_originX = Number(this.state.originX);
    u.u_originY = Number(this.state.originY);
    u.u_worldWidth = Number(this.state.worldWidth);
    u.u_worldHeight = Number(this.state.worldHeight);
    return u;
  }

  /** 回灌全量 uniform（ShaderMount 内部会做 diff，只上传真正变化的） */
  push() {
    if (!this.mount) return;
    this.mount.setUniforms(this.buildUniforms());
  }

  setParam(key, value) {
    this.state[key] = value;
    this.push();
  }

  /** 应用一组参数（预设）；speed / frame 走它们各自的方法 */
  applyParams(params) {
    for (const [key, value] of Object.entries(params)) {
      if (key === "speed" || key === "frame") continue;
      this.state[key] = Array.isArray(value) ? [...value] : value;
    }
    this.push();
    if (typeof params.speed === "number") this.setSpeed(params.speed);
    if (typeof params.frame === "number") this.setFrame(params.frame);
  }

  setSpeed(speed) {
    this.state.speed = speed;
    this.mount?.setSpeed(speed);
  }

  setFrame(frame) {
    this.state.frame = frame;
    this.mount?.setFrame(frame);
  }

  getFrame() {
    return this.mount ? this.mount.getCurrentFrame() : 0;
  }

  /**
   * 设置（或清除）u_image。
   * @param {File|Blob|string|null} source 本地 File/Blob，或 blob:/data: URL
   */
  async setImage(source) {
    const token = ++this.imageToken;

    if (!source) {
      this.imageEl = null;
      this.push();
      this.onImageState?.();
      return;
    }

    const src = typeof source === "string" ? source : URL.createObjectURL(source);
    const revoke = typeof source === "string" ? null : src;

    try {
      const processed = await this.process(src);
      if (token !== this.imageToken) {
        if (revoke) URL.revokeObjectURL(revoke);
        return;
      }
      const el = await loadImage(processed);
      if (token !== this.imageToken) {
        if (typeof processed === "string" && processed.startsWith("blob:")) {
          URL.revokeObjectURL(processed);
        }
        if (revoke) URL.revokeObjectURL(revoke);
        return;
      }
      this.imageEl = el;
      this.push();
      this.onImageState?.();
    } finally {
      if (revoke) URL.revokeObjectURL(revoke);
    }
  }

  /** 走官方预处理（把图片变成 R=边缘梯度 / G=不透明度的遮罩），或原样返回 */
  async process(src) {
    const mode = this.def.image?.process;
    if (mode === "liquid-metal") {
      const { pngBlob } = await toProcessedLiquidMetal(src);
      return URL.createObjectURL(pngBlob);
    }
    if (mode === "gem-smoke") {
      const { pngBlob } = await toProcessedGemSmoke(src);
      return URL.createObjectURL(pngBlob);
    }
    return src;
  }

  /** 定格当前帧并导出 PNG（Blob） */
  async toPngBlob() {
    const canvas = this.mount.canvasElement;
    // 显式重绘一次，确保 preserveDrawingBuffer 里就是「此刻这一帧」
    this.mount.setFrame(this.mount.getCurrentFrame());
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob && blob.size > 0) resolve(blob);
        else reject(new Error("导出 PNG 失败：canvas 为空"));
      }, "image/png");
    });
  }

  dispose() {
    this.imageToken++;
    this.mount?.dispose();
    this.mount = null;
  }
}

/** 触发一次浏览器下载 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export { SIZING_KEYS };
