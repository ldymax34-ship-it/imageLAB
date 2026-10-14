/**
 * SVG 转 3D · 入口（双页签编排）
 *
 * 建模页签（Three.js）负责几何，渲染页签（vgpu / WebGPU）负责材质与出图；
 * 两者共用同一份 in-memory 网格：建模页签每次几何变更都会把 position / normal / uv / index
 * 交给渲染页签，页签切换不丢 SVG 与几何参数。
 */

import { createModelingTab } from "./modeling.js";
import { createRenderTab } from "./render-vgpu.js";
import { mountCategoryTabs } from "../../assets/workspace.js";

const $ = (id) => document.getElementById(id);

const els = {
  tabModel: $("tab-model"),
  tabRender: $("tab-render"),
  panelModel: $("panel-model"),
  panelRender: $("panel-render"),
  stageModel: $("stage-model"),
  stageRender: $("stage-render")
};

const modelingEls = {
  sample: $("sample"),
  file: $("svg-file"),
  name: $("svg-name"),
  depth: $("depth"),
  depthOut: $("depth-out"),
  bevelEnabled: $("bevel-enabled"),
  bevelThickness: $("bevel-thickness"),
  bevelThicknessOut: $("bevel-thickness-out"),
  bevelSize: $("bevel-size"),
  bevelSizeOut: $("bevel-size-out"),
  smoothness: $("smoothness"),
  smoothnessOut: $("smoothness-out"),
  resetView: $("model-reset-view"),
  view: $("model-view"),
  canvas: $("model-canvas"),
  error: $("model-error"),
  status: $("model-status"),
  stats: $("model-stats")
};

const renderEls = {
  material: $("render-material"),
  color: $("render-color"),
  roughness: $("render-roughness"),
  roughnessOut: $("render-roughness-out"),
  metallic: $("render-metallic"),
  metallicOut: $("render-metallic-out"),
  ior: $("render-ior"),
  iorOut: $("render-ior-out"),
  optical: $("render-optical"),
  opticalOut: $("render-optical-out"),
  dispersion: $("render-dispersion"),
  dispersionOut: $("render-dispersion-out"),
  glassNote: $("render-glass-note"),
  lightIntensity: $("render-light-intensity"),
  lightIntensityOut: $("render-light-intensity-out"),
  lightAngle: $("render-light-angle"),
  lightAngleOut: $("render-light-angle-out"),
  envIntensity: $("render-env-intensity"),
  envIntensityOut: $("render-env-intensity-out"),
  exposure: $("render-exposure"),
  exposureOut: $("render-exposure-out"),
  bg: $("render-bg"),
  bgBlack: $("render-bg-black"),
  bgWhite: $("render-bg-white"),
  bgMode: $("render-bg-mode"),
  bgFile: $("render-bg-file"),
  bgName: $("render-bg-name"),
  bgRemove: $("render-bg-remove"),
  bgZoom: $("render-bg-zoom"),
  bgZoomOut: $("render-bg-zoom-out"),
  bgPanX: $("render-bg-pan-x"),
  bgPanXOut: $("render-bg-pan-x-out"),
  bgPanY: $("render-bg-pan-y"),
  bgPanYOut: $("render-bg-pan-y-out"),
  bgPanReset: $("render-bg-pan-reset"),
  bgPanNote: $("render-bg-pan-note"),
  transparent: $("render-transparent"),
  resetView: $("render-reset-view"),
  exportScale: $("render-export-scale"),
  exportPng: $("render-export-png"),
  hint: $("render-hint"),
  canvas: $("render-canvas"),
  status: $("render-status"),
  stats: $("render-stats")
};

function setModelError(reason) {
  if (!modelingEls.error) return;
  if (reason) {
    modelingEls.error.hidden = false;
    modelingEls.error.innerHTML = "";
    const title = document.createElement("b");
    title.textContent = "导入被拒绝";
    modelingEls.error.appendChild(title);
    modelingEls.error.appendChild(document.createTextNode(reason));
  } else {
    modelingEls.error.hidden = true;
  }
}

function setModelStatus(text) {
  if (modelingEls.status) modelingEls.status.textContent = text;
}

function setRenderStatus(text) {
  if (renderEls.status) renderEls.status.textContent = text;
}

const render = createRenderTab({
  canvas: renderEls.canvas,
  els: renderEls,
  onStatus: setRenderStatus
});

const modeling = createModelingTab({
  els: modelingEls,
  onMesh: (snapshot) => render.setMesh(snapshot),
  onStatus: setModelStatus,
  onError: setModelError
});

let currentTab = "model";

function switchTab(name) {
  const next = name === "render" ? "render" : "model";
  currentTab = next;
  const showRender = next === "render";
  if (els.tabModel) els.tabModel.setAttribute("aria-selected", String(!showRender));
  if (els.tabRender) els.tabRender.setAttribute("aria-selected", String(showRender));
  if (els.panelModel) els.panelModel.hidden = showRender;
  if (els.panelRender) els.panelRender.hidden = !showRender;
  if (els.stageModel) els.stageModel.hidden = showRender;
  if (els.stageRender) els.stageRender.hidden = !showRender;
  if (showRender) {
    // 建模页签每次几何变更都已通过 onMesh 交接；这里只负责激活并确保 GPU 就绪。
    render.activate();
  } else {
    render.deactivate();
    modeling.notifyVisible();
  }
}

if (els.tabModel) els.tabModel.addEventListener("click", () => switchTab("model"));
if (els.tabRender) els.tabRender.addEventListener("click", () => switchTab("render"));

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentTab === "model") modeling.notifyVisible();
});

// 建模 / 渲染两个主页签各自再分类；分类只切换显示，不重置 SVG、几何参数或相机状态。
mountCategoryTabs();

window.__extrude3d = {
  getState: () => ({ ...modeling.getState(), tab: currentTab }),
  getInfo: () => ({ tab: currentTab, modeling: modeling.getInfo(), render: render.getInfo() }),
  getMesh: () => modeling.getMeshSummary(),
  getMeshSnapshot: () => (modeling.getMeshSnapshot ? modeling.getMeshSnapshot() : null),
  setTab: (name) => switchTab(name),
  switchTab,
  modeling,
  render,
  scene: modeling.scene,
  camera: modeling.camera,
  renderer: modeling.renderer,
  mesh: modeling.mesh
};
