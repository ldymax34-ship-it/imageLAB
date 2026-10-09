/*
 * imageLAB · 着色器工具界面层（三个工具共用这一份实现）
 *
 * 分工：
 *   index.html  固定外壳（效果按钮 / 图片 / 预设容器 / 速度 / 定格 / 导出）—— 静态存在，启动时接线一次；
 *   ui.js       按 catalog.js 的效果目录，把「每个效果的参数控件」填进 #param-main / #param-advanced / #param-sizing；
 *   catalog.js  效果、默认值、取值范围、枚举、预设（全部由上游数据生成）。
 *
 * 界面层不硬编码任何效果参数，也不自研任何渲染逻辑。
 */
import { SHADERS, SHADER_ORDER, SIZING_LABELS } from "./catalog.js";
import { ShaderPreview, splitColor, joinColor, downloadBlob } from "./kit.js";

/** 构图参数（三个工具、所有效果通用） */
const SIZING_CONTROLS = [
  { key: "fit", kind: "select", label: "适配方式", options: [["contain", "完整显示"], ["cover", "铺满"], ["none", "原始尺寸"]] },
  { key: "scale", kind: "range", min: 0.1, max: 4, step: 0.01 },
  { key: "rotation", kind: "range", min: 0, max: 360, step: 1 },
  { key: "offsetX", kind: "range", min: -1, max: 1, step: 0.01 },
  { key: "offsetY", kind: "range", min: -1, max: 1, step: 0.01 },
  { key: "originX", kind: "range", min: 0, max: 1, step: 0.01 },
  { key: "originY", kind: "range", min: 0, max: 1, step: 0.01 },
  { key: "worldWidth", kind: "range", min: 0, max: 2000, step: 1 },
  { key: "worldHeight", kind: "range", min: 0, max: 2000, step: 1 }
];

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "checked" || k === "disabled" || k === "hidden") node[k] = Boolean(v);
    else node.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
};

const decimals = (step) => (step >= 1 ? 0 : 2);
const show = (value, step) => Number(value).toFixed(decimals(step));

/**
 * 启动一个着色器工具。
 *
 * @param {object} cfg
 * @param {string} cfg.toolId       工具 id（导出文件名用）
 * @param {string} [cfg.imageLabel] 传了才启用上传区
 * @param {string} [cfg.imageHint]
 * @param {string} [cfg.accept]
 * @param {HTMLElement} [cfg.empty] 「还没有图片」空态遮罩
 */
export function mountTool(cfg) {
  const $ = (id) => document.getElementById(id);

  const stage = $("stage");
  const status = $("status");

  /* 固定外壳的元素：三个页面都提供同一套 id */
  const ui = {};
  for (const id of [
    "effect-note", "effect-chips", "group-image", "image-title", "image-hint", "image-file",
    "image-slot", "image-thumb", "image-clear", "group-presets", "presets-title", "preset-chips",
    "group-main", "param-main", "group-advanced", "advanced-title", "param-advanced",
    "group-sizing", "param-sizing", "p-speed", "n-speed", "btn-pause", "btn-play",
    "p-frame", "n-frame", "btn-freeze", "anim-note", "btn-export", "export-info"
  ]) {
    ui[id] = $(id);
    if (!ui[id]) throw new Error(`页面缺少必需的元素 #${id}`);
  }
  const empty = cfg.empty || null;

  const order = SHADER_ORDER.filter((k) => SHADERS[k]);
  let key = order[0];
  /** @type {ShaderPreview|null} */
  let preview = null;
  let imageSource = null;
  let hasImage = false;
  let busy = false;
  let thumbURL = null;

  const def = () => SHADERS[key];
  const setStatus = (text) => {
    status.textContent = text;
  };

  /* ------------------------------------------------------- 效果按钮（静态） */

  function syncEffectChips() {
    for (const button of ui["effect-chips"].querySelectorAll("button[data-effect]")) {
      button.setAttribute("aria-pressed", String(button.dataset.effect === key));
    }
  }

  async function selectShader(next) {
    if (busy || !SHADERS[next] || next === key) return;
    busy = true;
    setStatus("正在切换效果…");
    try {
      key = next;
      preview?.dispose();
      preview = null;
      await build();
      if (imageSource) await applyImage(imageSource);
    } finally {
      busy = false;
      syncStatus();
      publish();
    }
  }

  ui["effect-chips"].addEventListener("click", (event) => {
    const button = event.target.closest("button[data-effect]");
    if (button) selectShader(button.dataset.effect);
  });

  /* ------------------------------------------------------------------ 图片 */

  async function applyImage(source) {
    if (!preview) return;
    imageSource = source;
    if (!source) {
      hasImage = false;
      await preview.setImage(null);
    } else {
      const needsSolve = Boolean(def().image && def().image.process);
      setStatus(needsSolve ? "正在解算遮罩（边缘梯度）…" : "正在载入图片…");
      await preview.setImage(source);
      hasImage = true;
    }

    if (thumbURL) {
      URL.revokeObjectURL(thumbURL);
      thumbURL = null;
    }
    if (source) {
      thumbURL = typeof source === "string" ? null : URL.createObjectURL(source);
      ui["image-thumb"].src = typeof source === "string" ? source : thumbURL;
      ui["image-thumb"].hidden = false;
      ui["image-clear"].hidden = false;
    } else {
      ui["image-thumb"].removeAttribute("src");
      ui["image-thumb"].hidden = true;
      ui["image-clear"].hidden = true;
    }

    if (empty) empty.hidden = hasImage;
    syncStatus();
    publish();
  }

  ui["image-file"].addEventListener("change", async () => {
    const file = ui["image-file"].files && ui["image-file"].files[0];
    if (file) await applyImage(file);
  });

  ui["image-clear"].addEventListener("click", async () => {
    ui["image-file"].value = "";
    await applyImage(null);
  });

  /* -------------------------------------------------------------- 参数控件 */

  /** 单个参数的控件 */
  function control(p) {
    const id = `p-${p.key}`;
    const commit = (value) => {
      preview?.setParam(p.key, value);
      publish();
    };

    if (p.kind === "range") {
      const num = el("input", {
        type: "number",
        id: `n-${p.key}`,
        min: p.min,
        max: p.max,
        step: p.step,
        value: show(preview.state[p.key], p.step)
      });
      const range = el("input", {
        type: "range",
        id,
        name: p.key,
        min: p.min,
        max: p.max,
        step: p.step,
        value: preview.state[p.key]
      });
      range.addEventListener("input", () => {
        const v = Number(range.value);
        num.value = show(v, p.step);
        commit(v);
      });
      num.addEventListener("input", () => {
        const raw = Number(num.value);
        if (!Number.isFinite(raw)) return;
        const v = p.int ? Math.round(raw) : raw;
        range.value = String(v);
        commit(v);
      });
      return el("div", { class: "il-range" }, [el("label", { for: id, text: p.label }), range, num]);
    }

    if (p.kind === "select") {
      const select = el(
        "select",
        { id, name: p.key },
        p.options.map((o) => el("option", { value: o[0], text: o[1] }))
      );
      select.value = preview.state[p.key];
      const onPick = () => commit(select.value);
      select.addEventListener("input", onPick);
      select.addEventListener("change", onPick);
      return el("div", { class: "il-row" }, [el("label", { for: id, text: p.label }), select]);
    }

    if (p.kind === "bool") {
      const box = el("input", { type: "checkbox", id, name: p.key });
      box.checked = Boolean(preview.state[p.key]);
      box.addEventListener("change", () => commit(box.checked));
      return el("div", { class: "il-toggle" }, [box, el("label", { for: id, text: p.label })]);
    }

    if (p.kind === "color") {
      const initial = splitColor(preview.state[p.key]);
      const swatch = el("input", { type: "color", id, name: p.key, value: initial.hex });
      const alpha = el("input", { type: "range", id: `a-${p.key}`, min: 0, max: 1, step: 0.01, value: initial.alpha, title: "不透明度" });
      const push = () => commit(joinColor(swatch.value, Number(alpha.value)));
      swatch.addEventListener("input", push);
      alpha.addEventListener("input", push);
      return el("div", { class: "il-color" }, [el("label", { for: id, text: p.label }), swatch, alpha]);
    }

    if (p.kind === "colors") {
      const host = el("div", { class: "il-colors", id: `colors-${p.key}` });
      const rebuild = () => {
        const list = preview.state[p.key];
        host.replaceChildren(
          ...list.map((color, i) => {
            const parts = splitColor(color);
            const swatch = el("input", { type: "color", id: `p-${p.key}-${i}`, value: parts.hex });
            const alpha = el("input", { type: "range", min: 0, max: 1, step: 0.01, value: parts.alpha, title: "不透明度" });
            const write = () => {
              const next = [...preview.state[p.key]];
              next[i] = joinColor(swatch.value, Number(alpha.value));
              preview.state[p.key] = next;
              preview.push();
              publish();
            };
            swatch.addEventListener("input", write);
            alpha.addEventListener("input", write);
            const del = el("button", {
              type: "button",
              text: "×",
              title: "删除该颜色",
              disabled: list.length <= 1,
              onclick: () => {
                preview.state[p.key] = preview.state[p.key].filter((_, j) => j !== i);
                preview.push();
                rebuild();
                publish();
              }
            });
            return el("div", { class: "il-color-item" }, [swatch, alpha, del]);
          })
        );
        if (preview.state[p.key].length < p.max) {
          host.append(
            el("button", {
              type: "button",
              id: `colors-add-${p.key}`,
              text: `+ 添加颜色（上限 ${p.max}）`,
              onclick: () => {
                const list = preview.state[p.key];
                preview.state[p.key] = [...list, list[list.length - 1] || "#ffffff"];
                preview.push();
                rebuild();
                publish();
              }
            })
          );
        }
      };
      rebuild();
      return el("div", {}, [el("label", { text: `${p.label}（最多 ${p.max} 个）` }), host]);
    }

    return null;
  }

  function renderPresets() {
    const presets = def().presets || [];
    ui["group-presets"].hidden = presets.length === 0;
    ui["presets-title"].textContent = `预设 · ${presets.length} 组`;
    ui["preset-chips"].replaceChildren(
      ...presets.map((preset, i) =>
        el("button", {
          type: "button",
          id: `preset-${i}`,
          text: preset.name,
          onclick: () => {
            preview.applyParams(preset.params);
            rebuildParams();
            syncStatus();
            publish();
          }
        })
      )
    );
  }

  /** 只重建「随效果变化」的部分；固定外壳与折叠状态都保留 */
  function rebuildParams() {
    const d = def();
    ui["effect-note"].textContent = d.note || "";

    const main = d.params.filter((p) => p.group === "main");
    const advanced = d.params.filter((p) => p.group === "advanced");
    ui["param-main"].replaceChildren(...main.map(control).filter(Boolean));
    ui["group-advanced"].hidden = advanced.length === 0;
    ui["advanced-title"].textContent = `进阶参数 · ${advanced.length} 项`;
    ui["param-advanced"].replaceChildren(...advanced.map(control).filter(Boolean));
    ui["param-sizing"].replaceChildren(
      ...SIZING_CONTROLS.map((s) => control({ ...s, label: s.label || SIZING_LABELS[s.key] || s.key })).filter(Boolean)
    );

    renderPresets();
    ui["anim-note"].textContent = d.animated
      ? "先「暂停」，再调参或拖动时间点，就能得到确定的单帧画面。"
      : "这个效果本身就是一张静态画面（没有时间轴），导出的就是当前这一帧。";

    syncSpeedSurface();
    syncEffectChips();
  }

  /* ---------------------------------------------------------- 速度 / 单帧 */

  function syncSpeedSurface() {
    const speed = Number(preview?.state.speed ?? 0);
    ui["p-speed"].value = String(speed);
    ui["n-speed"].value = show(speed, 0.05);
    const frame = Number(preview?.state.frame) || 0;
    ui["p-frame"].value = String(Math.min(frame, 20000));
    ui["n-frame"].value = String(frame);
  }

  function setSpeed(value) {
    const n = Math.max(0, Number(value) || 0);
    preview.setSpeed(n);
    syncSpeedSurface();
    syncStatus();
    publish();
  }

  function setFrame(ms) {
    preview.setFrame(ms);
    syncStatus();
    publish();
  }

  ui["p-speed"].addEventListener("input", () => setSpeed(ui["p-speed"].value));
  ui["n-speed"].addEventListener("input", () => setSpeed(ui["n-speed"].value));
  ui["btn-pause"].addEventListener("click", () => {
    preview.setSpeed(0);
    syncSpeedSurface();
    syncStatus();
    publish();
  });
  ui["btn-play"].addEventListener("click", () => setSpeed(1));
  ui["p-frame"].addEventListener("input", () => {
    preview.setSpeed(0);
    ui["n-frame"].value = ui["p-frame"].value;
    setFrame(Number(ui["p-frame"].value));
  });
  ui["n-frame"].addEventListener("input", () => {
    const ms = Math.max(0, Number(ui["n-frame"].value) || 0);
    preview.setSpeed(0);
    ui["p-frame"].value = String(Math.min(ms, 20000));
    setFrame(ms);
  });
  ui["btn-freeze"].addEventListener("click", () => {
    preview.setSpeed(0);
    syncSpeedSurface();
    setFrame(Number(ui["n-frame"].value) || 0);
  });

  /* ------------------------------------------------------------------ 状态 */

  function syncStatus() {
    const paused = Number(preview?.state.speed ?? 0) === 0;
    const frame = Math.round(preview?.getFrame() ?? 0);
    setStatus(`${def().label} · ${paused ? "已暂停" : "播放中"} · 当前帧 ${frame}ms`);
    ui["btn-pause"].setAttribute("aria-pressed", String(paused));
    ui["btn-play"].setAttribute("aria-pressed", String(!paused));
  }

  /* ------------------------------------------------------------------ 导出 */

  ui["btn-export"].addEventListener("click", async () => {
    if (!preview) return;
    ui["btn-export"].disabled = true;
    try {
      const frame = Math.round(preview.getFrame());
      const blob = await preview.toPngBlob();
      const name = `imagelab-${cfg.toolId}-${key}-frame${frame}ms.png`;
      downloadBlob(blob, name);
      const canvas = preview.mount.canvasElement;
      ui["export-info"].textContent = `已导出 ${name}（${Math.round(blob.size / 1024)} KB，画面 ${canvas.width}×${canvas.height}）`;
    } catch (err) {
      ui["export-info"].textContent = `导出失败：${err && err.message ? err.message : err}`;
    } finally {
      ui["btn-export"].disabled = false;
    }
  });

  /* ---------------------------------------------------------------- 初始化 */

  function applyToolConfig() {
    const enabled = Boolean(cfg.imageLabel);
    ui["group-image"].hidden = !enabled;
    if (enabled) {
      ui["image-title"].textContent = cfg.imageLabel;
      ui["image-hint"].textContent = cfg.imageHint || "";
      ui["image-file"].setAttribute("accept", cfg.accept || "image/*");
    }
    // 空态遮罩跟着「当前有没有图片」走，启动时还没有图片
    if (empty) empty.hidden = hasImage;
  }

  async function build() {
    preview = new ShaderPreview(stage, def());
    await preview.init();
    // 上游的 fragment shader 里不含 u_time 的效果没有时间轴，
    // 即使目录里的 speed 不是 0 也没有东西会变，这里直接停下来，不空转重绘。
    if (!def().animated) preview.setSpeed(0);
    rebuildParams();
  }

  /* 供自动化验收与页面自身读取/驱动的最小公开接口 */
  function publish() {
    if (!preview) return;
    window.imagelab = {
      toolId: cfg.toolId,
      shader: key,
      shaders: [...order],
      params: () => ({ ...preview.state }),
      param: (k) => preview.state[k],
      setParam: (k, v) => {
        preview.setParam(k, v);
        rebuildParams();
      },
      preset: (i) => {
        const preset = def().presets[i];
        if (!preset) return;
        preview.applyParams(preset.params);
        rebuildParams();
      },
      selectShader: (k) => selectShader(k),
      setImage: (src) => applyImage(src),
      setSpeed: (v) => {
        preview.setSpeed(v);
        syncSpeedSurface();
        syncStatus();
      },
      setFrame: (ms) => setFrame(ms),
      frame: () => preview.getFrame(),
      hasImage: () => hasImage,
      mount: () => preview.mount,
      defaults: () => ({ ...def().defaults })
    };
  }

  applyToolConfig();

  return (async () => {
    await build();
    publish();
  })();
}
