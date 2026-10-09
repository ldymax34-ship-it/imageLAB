/* 纹理间 · CMF Pattern Studio — browser UI shell.
 *
 * Runs entirely in the browser: no network requests, no third-party runtime.
 *
 * Two tabs share one engine, one renderer and one export path:
 *   · 快速纹理 (quick) — the original built-in seam presets.
 *   · 曲线纹理 (curve) — a curve document whose hand-drawn paths are fitted
 *     by curve-fit.js into few straight/circular primitives, or imported from a
 *     local SVG without re-fitting. Both tabs feed the same PatternEngine, so
 *     preview, PNG and SVG always come from the same geometry.
 *
 * Per-tab parameters and per-tab image samples are kept independently. The
 * logical canvas (settings.width × settings.height) is the single coordinate
 * space for drawing, fitting, keep-out and export; preview resize never moves
 * document coordinates.
 */
(function () {
  "use strict";

  const PE = window.PatternEngine;
  const CE = window.CurveEngine;
  const SvgImport = window.SvgImport;
  if (!PE || !CE) return;

  const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
  const MAX_CONFIG_BYTES = 8 * 1024 * 1024;
  const MAX_SAMPLE_SIDE = 512;
  const MAX_DPR = 3;
  const UNDO_LIMIT = 60;
  const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

  const FIELD_LABELS = {
    radial: "径向渐消", linear: "线性渐消", wave: "波纹渐消",
    uniform: "均匀点阵", image: "图片映射"
  };
  const SEAM_LABELS = { none: "无绗缝", diamond: "交叉菱格", wave: "交织曲线" };

  const PRESETS = [
    { name: "交织渐消", sub: "WAVE QUILT",
      settings: { field: "uniform", seam: "wave", shape: "circle", spacing: 18, diameter: 9, spread: 85, angle: 0, contrast: 1.2, levels: 5, invert: false, seamScale: 360, keepout: 26, fade: 100 } },
    { name: "菱格绗缝", sub: "DIAMOND QUILT",
      settings: { field: "uniform", seam: "diamond", shape: "circle", spacing: 18, diameter: 10, spread: 95, angle: 0, contrast: 1, levels: 5, invert: false, seamScale: 380, keepout: 24, fade: 70 } },
    { name: "径向渐消", sub: "RADIAL FADE",
      settings: { field: "radial", seam: "none", shape: "circle", spacing: 18, diameter: 10, spread: 100, angle: 0, contrast: 1.1, levels: 5, invert: false, keepout: 0, fade: 0 } },
    { name: "线性渐消", sub: "LINEAR FADE",
      settings: { field: "linear", seam: "none", shape: "circle", spacing: 18, diameter: 10, spread: 110, angle: 0, contrast: 1, levels: 0, invert: false, keepout: 0, fade: 0 } }
  ];

  const $ = (id) => document.getElementById(id);

  const els = {
    width: $("width"), height: $("height"), grid: $("grid"),
    shapeOptions: $("shape-options"),
    spacing: $("spacing"), spacingOut: $("spacing-out"),
    diameter: $("diameter"), diameterOut: $("diameter-out"),
    field: $("field"),
    imageControls: $("image-controls"), imageInput: $("image-input"), imageName: $("image-name"),
    spread: $("spread"), spreadOut: $("spread-out"),
    angle: $("angle"), angleOut: $("angle-out"),
    contrast: $("contrast"), contrastOut: $("contrast-out"),
    levels: $("levels"), invert: $("invert"),
    seam: $("seam"), seamScale: $("seamScale"), seamScaleOut: $("seamScale-out"),
    keepout: $("keepout"), keepoutOut: $("keepout-out"),
    fade: $("fade"), fadeOut: $("fade-out"), guides: $("guides"),
    ink: $("ink"), paper: $("paper"), transparent: $("transparent"),
    exportGuides: $("exportGuides"), scale: $("scale"),
    exportSvg: $("export-svg"), exportPng: $("export-png"),
    saveConfig: $("save-config"), loadConfig: $("load-config"), exportTop: $("export-top"),
    reset: $("reset"), designTitle: $("design-title"),
    toggleGuides: $("toggle-guides"), center: $("center"),
    stage: $("stage"), wrap: $("canvas-wrap"), canvas: $("canvas"),
    centerMarker: $("center-marker"), canvasHint: $("canvas-hint"),
    renderTime: $("render-time"), canvasSize: $("canvas-size"),
    dotCount: $("dot-count"), coverage: $("coverage"),
    presets: $("presets"), presetsHeader: $("presets-header"),
    principleButton: $("principle-button"), principleDialog: $("principle-dialog"),
    closeDialog: $("close-dialog"),
    toast: $("toast"), configInput: $("config-input"),
    /* tabs */
    tabList: $("tab-list"), tabQuick: $("tab-quick"), tabCurve: $("tab-curve"),
    quickSeam: $("quick-seam"), curveControls: $("curve-controls"),
    seamSectionTitle: $("seam-section-title"), guidesLabel: $("guides-label"),
    exportGuidesLabel: $("export-guides-label"),
    /* curve document */
    simplicity: $("simplicity"), simplicityOut: $("simplicity-out"),
    modeOptions: $("mode-options"),
    pathList: $("path-list"), pathEmpty: $("path-empty"), pathCount: $("path-count"),
    curveUndo: $("curve-undo"), curveRedo: $("curve-redo"),
    curveDelete: $("curve-delete"), curveClear: $("curve-clear"),
    curveDemo: $("curve-demo"),
    svgImportBtn: $("svg-import-btn"), svgInput: $("svg-input"), svgName: $("svg-name"),
    onboarding: $("curve-onboarding")
  };
  els.shapeButtons = els.shapeOptions
    ? Array.prototype.slice.call(els.shapeOptions.querySelectorAll("button"))
    : [];
  els.modeButtons = els.modeOptions
    ? Array.prototype.slice.call(els.modeOptions.querySelectorAll("button"))
    : [];

  /* ---------------------------------------------------------------- state */

  function newBank(tab) {
    return tab === "curve"
      ? { tab: tab, settings: CE.normalizeCurveSettings({}), imageSource: null, imageSample: null, imageFileName: "", imageRequestId: 0 }
      : { tab: tab, settings: PE.normalize({}), imageSource: null, imageSample: null, imageFileName: "", imageRequestId: 0 };
  }

  const banks = { quick: newBank("quick"), curve: newBank("curve") };
  let activeTab = "quick";
  let state = banks.quick.settings;

  let model = null;
  let activePreset = 0;
  let renderQueued = false;
  let dragging = false;
  let exporting = false;
  let toastTimer = 0;
  let configRequestId = 0;
  let svgRequestId = 0;

  /* Curve document + editing history (shared engine geometry, per-tab UI). */
  let curveDoc = CE.emptyDoc();
  let curveMode = "draw";
  let selectedPathId = null;
  let strokePoints = null;
  let undoStack = [];
  let redoStack = [];
  let pendingUndo = null;
  let pathIdCounter = 0;

  /* ------------------------------------------------------------- helpers */

  function bank() { return banks[activeTab]; }
  function clamp01(value) { return value < 0 ? 0 : value > 1 ? 1 : value; }
  function setOutput(el, text) { if (el) el.textContent = text; }
  function setSvgStatus(text) {
    if (!els.svgName) return;
    els.svgName.textContent = text;
    els.svgName.setAttribute("title", text);
  }
  function errorText(err) { return err && err.message ? err.message : "未知错误"; }
  function readNumber(el, fallback) {
    if (!el) return fallback;
    const value = parseFloat(el.value);
    return Number.isFinite(value) ? value : fallback;
  }
  /* The engine caps the real unit size at spacing - 2 px, and for square cells
   * also at the hex row pitch. Mirror that cap so the slider, the output badge
   * and the rendered geometry always agree. */
  function effectiveDiameterCap(s) {
    const dy = s.spacing * (s.grid === "hex" ? Math.sqrt(3) / 2 : 1);
    return Math.max(1, Math.min(24, (s.shape === "square" ? Math.min(s.spacing, dy) : s.spacing) - 2));
  }
  function clampDiameter(s) {
    const cap = effectiveDiameterCap(s);
    if (s.diameter > cap) s.diameter = Math.max(1, Math.floor(cap * 2) / 2);
    return s;
  }
  function normalizeForTab(tab, raw) {
    const s = tab === "curve" ? CE.normalizeCurveSettings(raw) : PE.normalize(raw);
    return clampDiameter(s);
  }
  function syncRangeInputs() {
    ["spacing", "diameter", "spread", "angle", "contrast", "seamScale", "keepout", "fade"].forEach(function (key) {
      if (els[key]) els[key].value = String(state[key]);
    });
  }
  function nextPathId(prefix) {
    let id;
    do { pathIdCounter += 1; id = prefix + "-" + pathIdCounter; }
    while (curveDoc.paths.some(function (p) { return p.id === id; }));
    return id;
  }

  function canDragCenter() {
    if (activeTab === "curve") return curveMode === "move";
    return ["radial", "linear", "wave"].includes(state.field);
  }
  function fieldFades() { return ["radial", "linear", "wave"].includes(state.field); }

  /* --------------------------------------------------------- UI sync */

  /* Disabled sliders must not look interactive: mute the row, hide the number
   * behind a short reason, and expose the full reason on the label + control. */
  function setSliderEnabled(input, enabled, reason) {
    if (!input) return;
    input.disabled = !enabled;
    if (enabled) input.removeAttribute("title");
    else input.setAttribute("title", reason);
    const label = input.id
      ? document.querySelector('label.slider-label[for="' + input.id + '"]')
      : null;
    if (label) {
      label.classList.toggle("is-disabled", !enabled);
      if (enabled) label.removeAttribute("title");
      else label.setAttribute("title", reason);
    }
  }

  function syncOutputs() {
    const fading = fieldFades();
    const uniform = state.field === "uniform";
    const quickNoSeam = activeTab === "quick" && state.seam === "none";
    setOutput(els.spacingOut, state.spacing + " px");
    setOutput(els.diameterOut, state.diameter + " px");
    setOutput(els.spreadOut, fading ? Math.round(state.spread) + "%" : "仅渐变");
    setOutput(els.angleOut, state.field === "linear" ? Math.round(state.angle) + "°" : "仅线性");
    setOutput(els.contrastOut, uniform ? "均匀恒定" : state.contrast.toFixed(1));
    setOutput(els.seamScaleOut, quickNoSeam ? "未使用" : state.seamScale + " px");
    setOutput(els.keepoutOut, quickNoSeam ? "无路径" : state.keepout > 0 ? state.keepout + " px" : "关闭");
    setOutput(els.fadeOut, quickNoSeam ? "无渐消" : state.fade > 0 ? state.fade + " px" : "关闭");
    setOutput(els.simplicityOut, Math.round((banks.curve.settings.simplicity || 0) * 100) + "%");
    els.toggleGuides.classList.toggle("active", state.guides);
    els.toggleGuides.setAttribute("aria-pressed", String(state.guides));
    const canDrag = canDragCenter();
    els.centerMarker.hidden = !canDrag;
    els.center.disabled = !canDrag;
    els.canvas.style.cursor = activeTab === "curve"
      ? (curveMode === "draw" ? "crosshair" : "move")
      : (canDrag ? "crosshair" : "default");
    els.canvasHint.textContent = activeTab === "curve"
      ? (curveMode === "draw"
        ? "按住拖动，画一条粗略笔画；松手后自动拟合成直线 / 圆弧"
        : "拖动移动渐变中心 · 需要画路径时切回「绘制路径」")
      : state.field === "image"
        ? (banks[activeTab].imageSample ? "图片暗部 → 大单元 · 亮部 → 小单元" : "选择一张本地图片，开始明暗映射")
        : state.seam === "none" ? "均匀点阵 · 调整间距与尺寸探索效果" : "沿绗缝自动避让 · 调整渐消距离探索效果";
    setSliderEnabled(els.spread, fading, "渐变范围仅用于径向、线性、波纹渐消；均匀点阵与图片映射不使用。");
    setSliderEnabled(els.angle, state.field === "linear", "渐变角度仅用于线性渐消。");
    setSliderEnabled(els.contrast, !uniform, "均匀点阵的单元尺寸恒定，渐变曲线不改变结果。");
    setSliderEnabled(els.seamScale, !quickNoSeam, "未使用绗缝时不生成绗缝路径，疏密参数不生效。");
    setSliderEnabled(els.keepout, !quickNoSeam, "未使用绗缝时没有可避让的路径。");
    setSliderEnabled(els.fade, !quickNoSeam, "未使用绗缝时没有线外渐消。");
  }

  function applyShapeUI() {
    els.shapeButtons.forEach(function (button) {
      const on = button.getAttribute("data-shape") === state.shape;
      button.classList.toggle("active", on);
      button.setAttribute("aria-pressed", String(on));
    });
  }

  function updatePresetSelection() {
    PRESETS.forEach(function (preset, index) {
      if (!preset.button) return;
      const active = index === activePreset;
      preset.button.classList.toggle("active", active);
      preset.button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function updateTitle() {
    if (activeTab === "curve") {
      const stats = CE.docStats(curveDoc);
      els.designTitle.textContent = "曲线纹理 · " + stats.paths + " 条路径";
    } else if (activePreset >= 0 && PRESETS[activePreset]) {
      els.designTitle.textContent = PRESETS[activePreset].name;
    } else {
      els.designTitle.textContent = SEAM_LABELS[state.seam] + " · " + FIELD_LABELS[state.field];
    }
  }

  function markEdited() {
    if (activeTab !== "quick") return;
    if (activePreset !== -1) { activePreset = -1; updatePresetSelection(); }
    updateTitle();
  }

  function updateModeUI() {
    els.modeButtons.forEach(function (button) {
      const on = button.getAttribute("data-mode") === curveMode;
      button.classList.toggle("active", on);
      button.setAttribute("aria-pressed", String(on));
    });
  }

  function updateImageLabel() {
    if (!els.imageName) return;
    const b = bank();
    if (b.imageSample) {
      els.imageName.textContent = "已载入：" + b.imageFileName +
        "（采样 " + b.imageSample.width + "×" + b.imageSample.height + "，居中裁切铺满画布）。参数文件不包含图片。";
    } else if (b.imageSource) {
      els.imageName.textContent = "图片已就绪，正在生成采样…";
    } else {
      els.imageName.textContent = "尚未选择图片。图片模式只做本地读取（PNG / JPEG / WebP，≤20 MB）；" +
        "参数 JSON 不包含图片，载入配置后需要重新选择。";
    }
  }

  function syncImageVisibility() {
    if (els.imageControls) els.imageControls.hidden = state.field !== "image";
    updateImageLabel();
  }

  function updateCurveButtons() {
    const has = CE.docHasGeometry(curveDoc);
    const sel = !!(selectedPathId && curveDoc.paths.some(function (p) { return p.id === selectedPathId; }));
    if (els.curveUndo) els.curveUndo.disabled = undoStack.length === 0;
    if (els.curveRedo) els.curveRedo.disabled = redoStack.length === 0;
    if (els.curveDelete) els.curveDelete.disabled = !sel;
    if (els.curveClear) els.curveClear.disabled = !curveDoc.paths.length;
    const blocked = activeTab === "curve" && !has;
    if (els.exportPng) els.exportPng.disabled = exporting || blocked;
    if (els.exportTop) els.exportTop.disabled = exporting || blocked;
    if (els.exportSvg) els.exportSvg.disabled = blocked;
    if (els.pathCount) els.pathCount.textContent = String(curveDoc.paths.length);
  }

  function renderPathList() {
    if (!els.pathList) return;
    els.pathList.textContent = "";
    const paths = curveDoc.paths;
    if (els.pathEmpty) els.pathEmpty.hidden = paths.length > 0;
    paths.forEach(function (p, index) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "path-item" + (p.id === selectedPathId ? " active" : "");
      button.setAttribute("aria-pressed", String(p.id === selectedPathId));
      button.setAttribute("title", (index + 1) + ". " + (p.label || "路径"));
      const main = document.createElement("span");
      main.className = "path-item-main";
      const name = document.createElement("strong");
      name.textContent = (index + 1) + ". " + (p.label || "路径");
      name.setAttribute("title", (index + 1) + ". " + (p.label || "路径"));
      const meta = document.createElement("span");
      meta.className = "path-item-meta";
      const segs = p.subpaths.reduce(function (acc, sp) { return acc + sp.segments.length; }, 0);
      meta.textContent = (p.source === "import" ? "SVG 导入" : "手绘") + " · " + segs + " 段 · " + p.subpaths.length + " 子路径";
      main.appendChild(name);
      main.appendChild(meta);
      button.appendChild(main);
      button.addEventListener("click", function () {
        selectedPathId = p.id;
        renderPathList();
        scheduleRender();
      });
      els.pathList.appendChild(button);
    });
    updateCurveButtons();
  }

  function syncCurveUI() {
    const isCurve = activeTab === "curve";
    document.querySelector("main").classList.toggle("curve-layout", isCurve);
    if (els.quickSeam) els.quickSeam.hidden = isCurve;
    if (els.curveControls) els.curveControls.hidden = !isCurve;
    if (els.seamSectionTitle) els.seamSectionTitle.textContent = isCurve ? "曲线避让" : "绗缝避让";
    if (els.guidesLabel) els.guidesLabel.textContent = isCurve ? "显示路径辅助线" : "显示绗缝辅助线";
    if (els.exportGuidesLabel) els.exportGuidesLabel.textContent = isCurve ? "导出时包含路径辅助线" : "导出时包含绗缝辅助线";
    if (els.presetsHeader) els.presetsHeader.hidden = isCurve;
    if (els.presets) els.presets.hidden = isCurve;
    if (els.onboarding) els.onboarding.hidden = !isCurve || CE.docHasGeometry(curveDoc);
    updateModeUI();
    renderPathList();
    updateTitle();
  }

  /* Push the whole active state into the form. */
  function applyStateToUI() {
    els.width.value = String(state.width);
    els.height.value = String(state.height);
    els.grid.value = state.grid;
    els.spacing.value = String(state.spacing);
    els.diameter.value = String(state.diameter);
    els.field.value = state.field;
    els.spread.value = String(state.spread);
    els.angle.value = String(state.angle);
    els.contrast.value = String(state.contrast);
    els.levels.value = String(state.levels);
    els.invert.checked = state.invert;
    els.seam.value = state.seam === "custom" ? "none" : state.seam;
    els.seamScale.value = String(state.seamScale);
    els.keepout.value = String(state.keepout);
    els.fade.value = String(state.fade);
    els.guides.checked = state.guides;
    els.ink.value = state.ink;
    els.paper.value = state.paper;
    els.transparent.checked = state.transparent;
    els.exportGuides.checked = state.exportGuides;
    els.scale.value = String(state.scale);
    if (els.simplicity) els.simplicity.value = String(banks.curve.settings.simplicity);
    applyShapeUI();
    syncOutputs();
    syncImageVisibility();
    updatePresetSelection();
    updateTitle();
  }

  function readControls() {
    const previousWidth = state.width;
    const previousHeight = state.height;
    const raw = Object.assign({}, state, {
      width: readNumber(els.width, state.width),
      height: readNumber(els.height, state.height),
      grid: els.grid.value,
      spacing: readNumber(els.spacing, state.spacing),
      diameter: readNumber(els.diameter, state.diameter),
      field: els.field.value,
      spread: readNumber(els.spread, state.spread),
      angle: readNumber(els.angle, state.angle),
      contrast: readNumber(els.contrast, state.contrast),
      levels: Number(els.levels.value),
      invert: els.invert.checked,
      seam: els.seam.value,
      seamScale: readNumber(els.seamScale, state.seamScale),
      keepout: readNumber(els.keepout, state.keepout),
      fade: readNumber(els.fade, state.fade),
      guides: els.guides.checked,
      ink: els.ink.value,
      paper: els.paper.value,
      transparent: els.transparent.checked,
      exportGuides: els.exportGuides.checked,
      scale: Number(els.scale.value)
    });
    if (activeTab === "curve" && els.simplicity) raw.simplicity = readNumber(els.simplicity, banks.curve.settings.simplicity);
    state = normalizeForTab(activeTab, raw);
    banks[activeTab].settings = state;
    els.width.value = String(state.width);
    els.height.value = String(state.height);
    syncRangeInputs();
    syncOutputs();
    markEdited();
    finalizeStateChange(previousWidth, previousHeight);
  }

  function finalizeStateChange(previousWidth, previousHeight) {
    const b = bank();
    if (b.imageSource && (state.width !== previousWidth || state.height !== previousHeight)) {
      try { rebuildSampleFor(b); }
      catch (err) { b.imageSample = null; toast("图片采样失败：" + errorText(err)); }
    }
    syncImageVisibility();
    resizeCanvas();
    scheduleRender();
  }

  /* ---------------------------------------------------------- rendering */

  function stageBox() {
    const style = getComputedStyle(els.stage);
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const width = els.stage.clientWidth || 720;
    const height = els.stage.clientHeight || 420;
    return { w: Math.max(80, width - padX), h: Math.max(80, height - padY) };
  }

  function resizeCanvas() {
    const box = stageBox();
    const aspect = state.width / state.height;
    let width = box.w;
    let height = width / aspect;
    if (height > box.h) { height = box.h; width = height * aspect; }
    width = Math.max(40, Math.round(width));
    height = Math.max(40, Math.round(height));
    els.wrap.style.width = width + "px";
    els.wrap.style.height = height + "px";
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const backingWidth = Math.max(1, Math.round(width * dpr));
    const backingHeight = Math.max(1, Math.round(height * dpr));
    if (els.canvas.width !== backingWidth || els.canvas.height !== backingHeight) {
      els.canvas.width = backingWidth;
      els.canvas.height = backingHeight;
    }
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    const run = function () { renderQueued = false; render(); };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function customGeometry() {
    if (activeTab !== "curve") return null;
    return { polylines: CE.docPolylines(curveDoc), segments: CE.docSegments(curveDoc) };
  }

  function render() {
    resizeCanvas();
    const started = (window.performance && performance.now) ? performance.now() : Date.now();
    syncOutputs();
    model = PE.generate(state, state.field === "image" ? bank().imageSample : null, customGeometry());
    if (state.field === "image" && !bank().imageSample) { model.dots = []; model.coverage = 0; }
    if (activeTab === "curve" && !CE.docHasGeometry(curveDoc)) { model.dots = []; model.coverage = 0; }
    const ctx = els.canvas.getContext("2d");
    if (ctx) {
      drawScene(ctx, model, {
        pixelWidth: els.canvas.width,
        pixelHeight: els.canvas.height,
        background: !state.transparent,
        includeGuides: state.guides
      });
      drawStrokePreview(ctx);
      drawSelectedPath(ctx);
    }
    const finished = (window.performance && performance.now) ? performance.now() : Date.now();
    updateStatus(finished - started);
    updateCenterMarker();
  }

  /* Cheap repaint used while a stroke is being drawn: reuses the last model and
   * only overlays the rough gesture, so no expensive re-generation per move. */
  function redrawWithPreview() {
    if (!model) return;
    const ctx = els.canvas.getContext("2d");
    if (!ctx) return;
    drawScene(ctx, model, {
      pixelWidth: els.canvas.width,
      pixelHeight: els.canvas.height,
      background: !state.transparent,
      includeGuides: state.guides
    });
    drawStrokePreview(ctx);
    drawSelectedPath(ctx);
  }

  function canvasScale() {
    return { x: els.canvas.width / state.width, y: els.canvas.height / state.height };
  }

  function drawStrokePreview(ctx) {
    if (!strokePoints || strokePoints.length < 2) return;
    const s = canvasScale();
    ctx.setTransform(s.x, 0, 0, s.y, 0, 0);
    ctx.beginPath();
    strokePoints.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "#23644f";
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawSelectedPath(ctx) {
    if (activeTab !== "curve" || !selectedPathId || !state.guides) return;
    const path = curveDoc.paths.find(function (p) { return p.id === selectedPathId; });
    if (!path) return;
    const s = canvasScale();
    ctx.setTransform(s.x, 0, 0, s.y, 0, 0);
    ctx.setLineDash([]);
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = "#1d7a5c";
    path.subpaths.forEach(function (sp) {
      ctx.beginPath();
      sp.polyline.forEach(function (pt, i) { if (i) ctx.lineTo(pt[0], pt[1]); else ctx.moveTo(pt[0], pt[1]); });
      ctx.stroke();
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function updateStatus(ms) {
    setOutput(els.renderTime, Math.max(0, Math.round(ms)) + " ms");
    setOutput(els.canvasSize, state.width + " × " + state.height + " px");
    setOutput(els.dotCount, model ? String(model.dots.length) : "0");
    setOutput(els.coverage, model ? (model.coverage * 100).toFixed(2) + "%" : "—");
  }

  function updateCenterMarker() {
    if (!els.centerMarker) return;
    els.centerMarker.style.left = (state.cx * 100) + "%";
    els.centerMarker.style.top = (state.cy * 100) + "%";
  }

  function drawScene(ctx, scene, options) {
    const settings = scene.settings;
    const scaleX = options.pixelWidth / settings.width;
    const scaleY = options.pixelHeight / settings.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, options.pixelWidth, options.pixelHeight);
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    if (options.background) {
      ctx.fillStyle = settings.paper;
      ctx.fillRect(0, 0, settings.width, settings.height);
    }
    drawDots(ctx, scene);
    if (options.includeGuides && scene.paths.length) drawGuides(ctx, scene);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawDots(ctx, scene) {
    const settings = scene.settings;
    ctx.fillStyle = settings.ink;
    if (settings.shape === "square") {
      scene.dots.forEach(function (dot) { ctx.fillRect(dot.x - dot.r, dot.y - dot.r, 2 * dot.r, 2 * dot.r); });
      return;
    }
    ctx.beginPath();
    scene.dots.forEach(function (dot) {
      if (settings.shape === "circle") {
        ctx.moveTo(dot.x + dot.r, dot.y);
        ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
      } else if (settings.shape === "ellipse") {
        ctx.moveTo(dot.x + dot.r, dot.y);
        ctx.ellipse(dot.x, dot.y, dot.r, dot.r * 0.46, 0, 0, Math.PI * 2);
      } else {
        ctx.moveTo(dot.x, dot.y - dot.r);
        ctx.lineTo(dot.x + dot.r, dot.y);
        ctx.lineTo(dot.x, dot.y + dot.r);
        ctx.lineTo(dot.x - dot.r, dot.y);
        ctx.closePath();
      }
    });
    ctx.fill();
  }

  function drawGuides(ctx, scene) {
    const settings = scene.settings;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, settings.width, settings.height);
    ctx.clip();
    ctx.lineJoin = "miter";
    ctx.lineCap = "butt";
    scene.paths.forEach(function (path) {
      ctx.beginPath();
      path.forEach(function (point, index) {
        if (index) ctx.lineTo(point[0], point[1]);
        else ctx.moveTo(point[0], point[1]);
      });
      if (settings.keepout > 0) {
        ctx.setLineDash([]);
        ctx.lineWidth = settings.keepout;
        ctx.strokeStyle = "rgba(218, 128, 117, 0.14)";
        ctx.stroke();
      }
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = "#da8075";
      ctx.stroke();
    });
    ctx.restore();
  }

  /* ------------------------------------------------------ curve document */

  function snapshotDoc() { return JSON.stringify(CE.serializeDoc(curveDoc)); }

  function pushUndo() {
    undoStack.push(snapshotDoc());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }

  function restoreDoc(text) { curveDoc = CE.normalizeDoc(JSON.parse(text)); }

  function ensureSelection() {
    if (selectedPathId && !curveDoc.paths.some(function (p) { return p.id === selectedPathId; })) selectedPathId = null;
  }

  function commitCurve(mutator, options) {
    const useUndo = !options || options.undo !== false;
    try {
      const candidate = CE.cloneDoc(curveDoc);
      mutator(candidate);
      const validated = CE.normalizeDoc(CE.serializeDoc(candidate));
      if (useUndo) pushUndo();
      curveDoc = validated;
    } catch (err) {
      toast("曲线更新失败：" + errorText(err));
      syncCurveUI();
      scheduleRender();
      return false;
    }
    ensureSelection();
    syncCurveUI();
    scheduleRender();
    return true;
  }

  function undoCurve() {
    if (!undoStack.length) return;
    redoStack.push(snapshotDoc());
    restoreDoc(undoStack.pop());
    ensureSelection();
    syncCurveUI();
    scheduleRender();
  }

  function redoCurve() {
    if (!redoStack.length) return;
    undoStack.push(snapshotDoc());
    restoreDoc(redoStack.pop());
    ensureSelection();
    syncCurveUI();
    scheduleRender();
  }

  function capturePendingUndo() { if (pendingUndo === null) pendingUndo = snapshotDoc(); }
  function commitPendingUndo() {
    if (pendingUndo === null) return;
    if (pendingUndo !== snapshotDoc()) {
      undoStack.push(pendingUndo);
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      redoStack.length = 0;
    }
    pendingUndo = null;
  }

  function refitHandPaths() {
    if (!CE.refitHandPaths(curveDoc, banks.curve.settings.simplicity)) return;
    try { curveDoc = CE.normalizeDoc(CE.serializeDoc(curveDoc)); }
    catch (err) { toast("重新拟合失败：" + errorText(err)); return; }
    syncCurveUI();
    scheduleRender();
  }

  function addHandPath(points) {
    let path;
    try {
      path = CE.makeHandPath(points, banks.curve.settings.simplicity, nextPathId("hand"),
        "笔画 " + (CE.docStats(curveDoc).hand + 1));
    } catch (err) { toast("无法拟合笔画：" + errorText(err)); return; }
    selectedPathId = path.id;
    commitCurve(function (doc) { doc.paths.push(path); });
  }

  function deleteSelectedPath() {
    if (!selectedPathId) { toast("请先在路径列表中选择一条路径。"); return; }
    const id = selectedPathId;
    selectedPathId = null;
    commitCurve(function (doc) { doc.paths = doc.paths.filter(function (p) { return p.id !== id; }); });
  }

  function clearCurvePaths() {
    if (!curveDoc.paths.length) return;
    selectedPathId = null;
    commitCurve(function (doc) { doc.paths = []; });
  }

  function loadDemo() {
    let demo;
    try {
      demo = CE.demoDoc({ x: 0, y: 0, width: state.width, height: state.height }, banks.curve.settings.simplicity);
    } catch (err) { toast("示例加载失败：" + errorText(err)); return; }
    if (!demo.paths.length) { toast("示例笔画不可用。"); return; }
    const committed = commitCurve(function (doc) {
      demo.paths.forEach(function (p) { p.id = nextPathId("demo"); doc.paths.push(p); });
    });
    if (!committed) return;
    selectedPathId = curveDoc.paths[curveDoc.paths.length - 1].id;
    syncCurveUI();
    scheduleRender();
    toast("已载入 " + demo.paths.length + " 条示例曲线。");
  }

  /* ------------------------------------------------------------ pointer */

  function pointerCenter(event) {
    const rect = els.wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { cx: clamp01((event.clientX - rect.left) / rect.width), cy: clamp01((event.clientY - rect.top) / rect.height) };
  }

  function pointerLogical(event) {
    const rect = els.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp01((event.clientX - rect.left) / rect.width) * state.width,
      y: clamp01((event.clientY - rect.top) / rect.height) * state.height
    };
  }

  function startDrag(event) {
    if (!canDragCenter()) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const point = pointerCenter(event);
    if (!point) return;
    dragging = true;
    els.wrap.classList.add("dragging");
    if (els.canvas.setPointerCapture) { try { els.canvas.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ } }
    state.cx = point.cx;
    state.cy = point.cy;
    markEdited();
    updateCenterMarker();
    scheduleRender();
    event.preventDefault();
  }

  function moveDrag(event) {
    if (!dragging) return;
    const point = pointerCenter(event);
    if (!point) return;
    state.cx = point.cx;
    state.cy = point.cy;
    updateCenterMarker();
    scheduleRender();
    event.preventDefault();
  }

  function endDrag(event) {
    if (!dragging) return;
    dragging = false;
    els.wrap.classList.remove("dragging");
    if (event && event.pointerId !== undefined && els.canvas.releasePointerCapture) {
      try { els.canvas.releasePointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    }
  }

  function startStroke(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const pt = pointerLogical(event);
    if (!pt) return;
    strokePoints = [[pt.x, pt.y]];
    els.wrap.classList.add("drawing");
    if (els.canvas.setPointerCapture) { try { els.canvas.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ } }
    redrawWithPreview();
    event.preventDefault();
  }

  function moveStroke(event) {
    if (!strokePoints) return;
    const pt = pointerLogical(event);
    if (!pt) return;
    const last = strokePoints[strokePoints.length - 1];
    if (Math.hypot(pt.x - last[0], pt.y - last[1]) < 1.5) return;
    if (strokePoints.length >= CE.LIMITS.MAX_SOURCE_POINTS_PER_PATH) return;
    strokePoints.push([pt.x, pt.y]);
    redrawWithPreview();
    event.preventDefault();
  }

  function endStroke(event) {
    const pts = strokePoints;
    strokePoints = null;
    els.wrap.classList.remove("drawing");
    if (event && event.pointerId !== undefined && els.canvas.releasePointerCapture) {
      try { els.canvas.releasePointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    }
    if (pts && pts.length >= 2) addHandPath(pts);
    scheduleRender();
  }

  function onPointerDown(event) {
    if (activeTab === "curve" && curveMode === "draw") startStroke(event);
    else startDrag(event);
  }
  function onPointerMove(event) {
    if (strokePoints) moveStroke(event);
    else moveDrag(event);
  }
  function onPointerUp(event) {
    if (strokePoints) endStroke(event);
    else endDrag(event);
  }

  /* ------------------------------------------------------------ presets */

  function buildPresets() {
    if (!els.presets) return;
    els.presets.textContent = "";
    PRESETS.forEach(function (preset, index) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "preset";
      button.setAttribute("aria-pressed", "false");
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      canvas.setAttribute("aria-hidden", "true");
      const meta = document.createElement("div");
      meta.className = "preset-meta";
      const name = document.createElement("strong");
      name.textContent = preset.name;
      const sub = document.createElement("span");
      sub.textContent = preset.sub;
      meta.appendChild(name);
      meta.appendChild(sub);
      button.appendChild(canvas);
      button.appendChild(meta);
      button.addEventListener("click", function () { applyPreset(index); });
      preset.button = button;
      preset.canvas = canvas;
      els.presets.appendChild(button);
      drawPresetThumb(preset);
    });
  }

  function drawPresetThumb(preset) {
    const settings = PE.normalize(Object.assign({}, PE.defaults, banks.quick.settings, preset.settings, {
      width: PE.defaults.width, height: PE.defaults.height, scale: 1, transparent: false,
      exportGuides: false, guides: false, cx: 0.5, cy: 0.5
    }));
    const thumbModel = PE.generate(settings, null);
    const ctx = preset.canvas.getContext("2d");
    if (ctx) drawScene(ctx, thumbModel, { pixelWidth: 320, pixelHeight: 180, background: true, includeGuides: false });
  }

  /* --------------------------------------------------------- local image */

  function isAllowedImage(file) {
    if (file.type) return ALLOWED_IMAGE_TYPES.indexOf(file.type) !== -1;
    return /\.(png|jpe?g|webp)$/i.test(file.name || "");
  }

  function decodeImage(file) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(file).catch(function () { return decodeViaElement(file); });
    }
    return decodeViaElement(file);
  }

  function decodeViaElement(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = function () { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = function () { URL.revokeObjectURL(url); reject(new Error("无法解码该图片")); };
      image.src = url;
    });
  }

  function closeSource(source) {
    if (source && typeof source.close === "function") {
      try { source.close(); } catch (err) { /* ignore */ }
    }
  }

  function handleImageFile(file) {
    if (!file) return;
    const target = bank();
    const requestId = ++target.imageRequestId;
    if (!isAllowedImage(file)) { toast("仅支持 PNG / JPEG / WebP 图片。"); return; }
    if (file.size > MAX_IMAGE_BYTES) { toast("图片超过 20 MB 上限，请压缩后再试。"); return; }
    els.imageName.textContent = "正在解析图片…";
    decodeImage(file).then(function (source) {
      if (requestId !== target.imageRequestId) { closeSource(source); return; }
      adoptImageSource(target, source, file.name);
      toast("已载入图片：" + file.name);
    }).catch(function (err) {
      if (requestId !== target.imageRequestId) return;
      toast("图片读取失败：" + errorText(err));
      syncImageVisibility();
    });
  }

  function adoptImageSource(target, source, name) {
    closeSource(target.imageSource);
    target.imageSource = source;
    target.imageFileName = name;
    try { rebuildSampleFor(target); }
    catch (err) { target.imageSample = null; toast("图片采样失败：" + errorText(err)); }
    if (activeTab === target.tab) { syncImageVisibility(); scheduleRender(); }
  }

  function rebuildSampleFor(target) {
    if (!target.imageSource) { target.imageSample = null; return; }
    target.imageSample = sampleImage(target.imageSource, target.settings.width, target.settings.height);
  }

  function sampleImage(source, patternWidth, patternHeight) {
    const sourceWidth = source.width || source.naturalWidth || 0;
    const sourceHeight = source.height || source.naturalHeight || 0;
    if (!sourceWidth || !sourceHeight) throw new Error("图片尺寸无效");

    const aspect = patternWidth / patternHeight;
    let outWidth, outHeight;
    if (patternWidth >= patternHeight) {
      outWidth = MAX_SAMPLE_SIDE;
      outHeight = Math.max(1, Math.round(MAX_SAMPLE_SIDE / aspect));
    } else {
      outHeight = MAX_SAMPLE_SIDE;
      outWidth = Math.max(1, Math.round(MAX_SAMPLE_SIDE * aspect));
    }

    const canvas = document.createElement("canvas");
    canvas.width = outWidth;
    canvas.height = outHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("无法创建采样画布");

    const sourceAspect = sourceWidth / sourceHeight;
    let sx = 0, sy = 0, cropWidth = sourceWidth, cropHeight = sourceHeight;
    if (sourceAspect > aspect) { cropWidth = sourceHeight * aspect; sx = (sourceWidth - cropWidth) / 2; }
    else { cropHeight = sourceWidth / aspect; sy = (sourceHeight - cropHeight) / 2; }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outWidth, outHeight);
    ctx.drawImage(source, sx, sy, cropWidth, cropHeight, 0, 0, outWidth, outHeight);

    const pixels = ctx.getImageData(0, 0, outWidth, outHeight).data;
    const data = new Float32Array(outWidth * outHeight);
    for (let i = 0, p = 0; i < data.length; i++, p += 4) {
      const luminance = (0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2]) / 255;
      let darkness = 1 - luminance;
      if (darkness < 0) darkness = 0; else if (darkness > 1) darkness = 1;
      data[i] = darkness;
    }
    return { width: outWidth, height: outHeight, data: data };
  }

  /* ------------------------------------------------------------- SVG */

  function handleSvgFile(file) {
    if (!file) return;
    const requestId = ++svgRequestId;
    const importWidth = banks.curve.settings.width, importHeight = banks.curve.settings.height;
    if (!SvgImport) { toast("SVG 导入模块未加载。"); return; }
    if (file.size > SvgImport.MAX_SVG_BYTES) {
      toast("SVG 超过 " + Math.round(SvgImport.MAX_SVG_BYTES / 1024) + " KB 上限。");
      return;
    }
    setSvgStatus("正在安全解析 " + file.name + "…");
    file.text().then(function (text) {
      let result;
      if (requestId !== svgRequestId) return null;
      try { result = SvgImport.parseSvgText(text, { width: importWidth, height: importHeight }); }
      catch (err) { toast("SVG 导入失败：" + errorText(err)); return null; }
      return result;
    }).then(function (result) {
      if (requestId !== svgRequestId) return;
      if (!result) { setSvgStatus("未导入 SVG。"); return; }
      if (!result.paths.length) { toast("SVG 中没有可导入的几何图形。"); setSvgStatus("未导入 SVG。"); return; }
      const committed = commitCurve(function (doc) {
        result.paths.forEach(function (p) { p.id = nextPathId("svg"); doc.paths.push(p); });
      });
      if (!committed) return;
      selectedPathId = curveDoc.paths[curveDoc.paths.length - 1].id;
      syncCurveUI();
      scheduleRender();
      const warn = result.warnings.length ? "（" + result.warnings.slice(0, 2).join("；") + "）" : "";
      setSvgStatus("已导入 " + result.paths.length + " 条几何路径" + warn);
      toast("已导入 " + result.paths.length + " 条几何路径，未重新拟合。" + warn);
    }).catch(function (err) {
      toast("SVG 导入失败：" + errorText(err));
      setSvgStatus("未导入 SVG。");
    }).then(function () { if (els.svgInput) els.svgInput.value = ""; });
  }

  /* ------------------------------------------------------------- export */

  function exportReady() {
    if (activeTab === "curve" && !CE.docHasGeometry(curveDoc)) {
      toast("曲线纹理需要至少一条路径，才能导出。");
      return false;
    }
    if (state.field === "image" && !bank().imageSample) {
      toast("图片模式需要先载入本地图片，才能导出。");
      return false;
    }
    return true;
  }

  function buildExportModel() {
    return PE.generate(state, state.field === "image" ? bank().imageSample : null, customGeometry());
  }

  function createSurface(width, height) {
    if (typeof OffscreenCanvas !== "undefined") {
      try { return new OffscreenCanvas(width, height); } catch (err) { /* fall back */ }
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function surfaceToBlob(surface, type) {
    if (typeof surface.convertToBlob === "function") return surface.convertToBlob({ type: type });
    return new Promise(function (resolve, reject) {
      surface.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error("浏览器未能生成图片数据")); }, type);
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function exportPNG() {
    if (exporting || !exportReady()) return;
    const exportWidth = state.width, exportHeight = state.height, scale = state.scale;
    const outWidth = Math.max(1, Math.round(state.width * scale));
    const outHeight = Math.max(1, Math.round(state.height * scale));
    let surface;
    try {
      surface = createSurface(outWidth, outHeight);
      const ctx = surface.getContext("2d");
      if (!ctx) throw new Error("无法创建导出画布");
      drawScene(ctx, buildExportModel(), {
        pixelWidth: outWidth, pixelHeight: outHeight,
        background: !state.transparent, includeGuides: state.exportGuides
      });
    } catch (err) { toast("PNG 导出失败：" + errorText(err)); return; }
    exporting = true;
    els.exportPng.disabled = els.exportTop.disabled = true;
    surfaceToBlob(surface, "image/png").then(function (blob) {
      downloadBlob(blob, "pattern-" + exportWidth + "x" + exportHeight + "@" + scale + "x.png");
      toast("PNG 已导出（" + outWidth + "×" + outHeight + "）。");
    }).catch(function (err) {
      toast("PNG 导出失败：" + errorText(err));
    }).finally(function () {
      exporting = false;
      updateCurveButtons();
    });
  }

  function exportSVG() {
    if (!exportReady()) return;
    try {
      const svg = PE.toSVG(buildExportModel(), { guides: state.exportGuides });
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      downloadBlob(blob, "pattern-" + state.width + "x" + state.height + ".svg");
      toast("SVG 已导出。");
    } catch (err) { toast("SVG 导出失败：" + errorText(err)); }
  }

  /* ------------------------------------------------------- versioned JSON */

  function saveConfig() {
    const payload = {
      app: CE.CONFIG_APP,
      version: CE.CONFIG_VERSION,
      savedAt: new Date().toISOString(),
      activeTab: activeTab,
      quick: { settings: Object.assign({}, banks.quick.settings) },
      curve: {
        settings: Object.assign({}, banks.curve.settings),
        mode: curveMode,
        doc: CE.serializeDoc(curveDoc)
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    downloadBlob(blob, "pattern-config-v" + CE.CONFIG_VERSION + ".json");
    toast("参数与曲线已保存（不含图片）。");
  }

  function handleConfigFile(file) {
    if (!file) return;
    const requestId = ++configRequestId;
    if (file.size > MAX_CONFIG_BYTES) {
      toast("参数文件超过 " + Math.round(MAX_CONFIG_BYTES / 1024 / 1024) + " MB 上限。");
      els.configInput.value = "";
      return;
    }
    file.text().then(function (text) {
      let raw;
      try { raw = JSON.parse(text); }
      catch (err) { throw new Error("JSON 解析失败，文件可能已损坏。"); }
      return CE.normalizeConfig(raw);
    }).then(function (config) {
      if (requestId !== configRequestId) return;
      svgRequestId++;
      banks.quick.settings = clampDiameter(config.quick.settings);
      banks.curve.settings = clampDiameter(config.curve.settings);
      curveMode = config.curve.mode;
      curveDoc = config.curve.doc;
      activeTab = config.activeTab;
      state = banks[activeTab].settings;
      selectedPathId = curveDoc.paths.length ? curveDoc.paths[curveDoc.paths.length - 1].id : null;
      undoStack = []; redoStack = []; pendingUndo = null;
      [banks.quick, banks.curve].forEach(function (b) {
        if (b.imageSource) { try { rebuildSampleFor(b); } catch (err) { b.imageSample = null; } }
      });
      applyStateToUI();
      updateTabUI();
      syncCurveUI();
      finalizeStateChange(state.width, state.height);
      toast(config.version === 1 ? "已按 v1 参数载入到「快速纹理」。" : "参数与曲线已载入。");
    }).catch(function (err) {
      if (requestId !== configRequestId) return;
      toast("载入失败：" + errorText(err));
    }).then(function () { els.configInput.value = ""; });
  }

  /* -------------------------------------------------------------- toast */

  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove("visible"); }, 2800);
  }

  /* --------------------------------------------------------------- tabs */

  function updateTabUI() {
    const tabs = [[els.tabQuick, "quick"], [els.tabCurve, "curve"]];
    tabs.forEach(function (pair) {
      const el = pair[0];
      if (!el) return;
      const on = activeTab === pair[1];
      el.classList.toggle("active", on);
      el.setAttribute("aria-selected", String(on));
      el.tabIndex = on ? 0 : -1;
    });
  }

  function setActiveTab(tab) {
    if (tab !== "quick" && tab !== "curve") return;
    if (tab === activeTab) return;
    commitPendingUndo();
    if (strokePoints) { strokePoints = null; els.wrap.classList.remove("drawing"); }
    dragging = false;
    els.wrap.classList.remove("dragging");
    activeTab = tab;
    state = banks[activeTab].settings;
    updateTabUI();
    applyStateToUI();
    syncCurveUI();
    resizeCanvas();
    scheduleRender();
  }

  function onTabKeydown(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const order = ["quick", "curve"];
    let index = order.indexOf(activeTab);
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = order.length - 1;
    else index = (index + (event.key === "ArrowRight" ? 1 : -1) + order.length) % order.length;
    setActiveTab(order[index]);
    const target = order[index] === "quick" ? els.tabQuick : els.tabCurve;
    if (target) target.focus();
  }

  /* -------------------------------------------------------------- reset */

  function resetAll() {
    const previousWidth = state.width, previousHeight = state.height;
    activePreset = -1;
    state = normalizeForTab(activeTab, {});
    banks[activeTab].settings = state;
    if (activeTab === "curve") { curveMode = "draw"; }
    applyStateToUI();
    syncCurveUI();
    finalizeStateChange(previousWidth, previousHeight);
    toast(activeTab === "curve" ? "曲线参数已恢复默认（路径保留）。" : "已恢复默认参数。");
  }

  function centerReset() {
    state.cx = 0.5;
    state.cy = 0.5;
    markEdited();
    updateCenterMarker();
    scheduleRender();
  }

  function applyPreset(index) {
    if (activeTab !== "quick") return;
    const preset = PRESETS[index];
    if (!preset) return;
    const previousWidth = state.width, previousHeight = state.height;
    banks.quick.settings = normalizeForTab("quick", Object.assign({}, state, preset.settings, { cx: .5, cy: .5 }));
    state = banks.quick.settings;
    activePreset = index;
    applyStateToUI();
    finalizeStateChange(previousWidth, previousHeight);
  }

  /* ------------------------------------------------------------- binding */

  function bind() {
    const bindings = [
      [els.width, "change"], [els.height, "change"], [els.grid, "change"],
      [els.spacing, "input"], [els.diameter, "input"], [els.field, "change"],
      [els.spread, "input"], [els.angle, "input"], [els.contrast, "input"],
      [els.levels, "change"], [els.invert, "change"], [els.seam, "change"],
      [els.seamScale, "input"], [els.keepout, "input"], [els.fade, "input"],
      [els.guides, "change"], [els.ink, "input"], [els.paper, "input"],
      [els.transparent, "change"], [els.exportGuides, "change"], [els.scale, "change"]
    ];
    bindings.forEach(function (pair) { if (pair[0]) pair[0].addEventListener(pair[1], readControls); });

    els.shapeButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        state.shape = button.getAttribute("data-shape");
        clampDiameter(state);
        syncRangeInputs();
        applyShapeUI();
        markEdited();
        syncOutputs();
        scheduleRender();
      });
    });

    if (els.simplicity) {
      els.simplicity.addEventListener("input", function () {
        const value = parseFloat(els.simplicity.value);
        banks.curve.settings.simplicity = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : CE.DEFAULT_SIMPLICITY;
        setOutput(els.simplicityOut, Math.round(banks.curve.settings.simplicity * 100) + "%");
        if (activeTab !== "curve") return;
        capturePendingUndo();
        refitHandPaths();
      });
      els.simplicity.addEventListener("change", function () {
        if (activeTab !== "curve") { pendingUndo = null; return; }
        refitHandPaths();
        commitPendingUndo();
      });
    }

    els.modeButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        const mode = button.getAttribute("data-mode");
        curveMode = mode === "move" ? "move" : "draw";
        if (strokePoints) { strokePoints = null; els.wrap.classList.remove("drawing"); }
        dragging = false;
        updateModeUI();
        syncOutputs();
        scheduleRender();
      });
    });

    if (els.imageInput) {
      els.imageInput.addEventListener("change", function () {
        const file = els.imageInput.files && els.imageInput.files[0];
        els.imageInput.value = "";
        handleImageFile(file);
      });
    }

    if (els.svgImportBtn) els.svgImportBtn.addEventListener("click", function () { if (els.svgInput) els.svgInput.click(); });
    if (els.svgInput) {
      els.svgInput.addEventListener("change", function () {
        const file = els.svgInput.files && els.svgInput.files[0];
        handleSvgFile(file);
      });
    }

    if (els.curveUndo) els.curveUndo.addEventListener("click", undoCurve);
    if (els.curveRedo) els.curveRedo.addEventListener("click", redoCurve);
    if (els.curveDelete) els.curveDelete.addEventListener("click", deleteSelectedPath);
    if (els.curveClear) els.curveClear.addEventListener("click", clearCurvePaths);
    if (els.curveDemo) els.curveDemo.addEventListener("click", loadDemo);

    if (els.tabList) els.tabList.addEventListener("keydown", onTabKeydown);
    if (els.tabQuick) els.tabQuick.addEventListener("click", function () { setActiveTab("quick"); });
    if (els.tabCurve) els.tabCurve.addEventListener("click", function () { setActiveTab("curve"); });

    if (els.saveConfig) els.saveConfig.addEventListener("click", saveConfig);
    if (els.loadConfig) els.loadConfig.addEventListener("click", function () { els.configInput.click(); });
    if (els.configInput) {
      els.configInput.addEventListener("change", function () {
        const file = els.configInput.files && els.configInput.files[0];
        handleConfigFile(file);
      });
    }

    if (els.exportPng) els.exportPng.addEventListener("click", exportPNG);
    if (els.exportTop) els.exportTop.addEventListener("click", exportPNG);
    if (els.exportSvg) els.exportSvg.addEventListener("click", exportSVG);

    if (els.reset) els.reset.addEventListener("click", resetAll);
    if (els.center) els.center.addEventListener("click", centerReset);

    if (els.toggleGuides) {
      els.toggleGuides.addEventListener("click", function () {
        state.guides = !state.guides;
        els.guides.checked = state.guides;
        markEdited();
        scheduleRender();
      });
    }

    if (els.principleButton && els.principleDialog) {
      els.principleButton.addEventListener("click", function () {
        if (typeof els.principleDialog.showModal === "function") els.principleDialog.showModal();
        else els.principleDialog.setAttribute("open", "");
      });
    }
    if (els.closeDialog && els.principleDialog) {
      els.closeDialog.addEventListener("click", function () { els.principleDialog.close(); });
      els.principleDialog.addEventListener("click", function (event) {
        if (event.target === els.principleDialog) els.principleDialog.close();
      });
    }

    els.canvas.addEventListener("pointerdown", onPointerDown);
    els.canvas.addEventListener("pointermove", onPointerMove);
    els.canvas.addEventListener("pointerup", onPointerUp);
    els.canvas.addEventListener("pointercancel", onPointerUp);
    els.canvas.addEventListener("lostpointercapture", onPointerUp);
  }

  function setupResizeObserver() {
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(function () { resizeCanvas(); render(); });
      observer.observe(els.stage);
    }
    window.addEventListener("resize", function () { resizeCanvas(); scheduleRender(); });
  }

  /* --------------------------------------------------------------- init */

  function init() {
    state = banks.quick.settings;
    buildPresets();
    applyStateToUI();
    bind();
    setupResizeObserver();
    updateTabUI();
    syncCurveUI();
    /* The status is clamped to three lines for layout safety, so mirror the
     * default safety copy into title; the full text stays in the DOM too. */
    if (els.svgName && !els.svgName.getAttribute("title")) els.svgName.setAttribute("title", els.svgName.textContent);
    resizeCanvas();
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
