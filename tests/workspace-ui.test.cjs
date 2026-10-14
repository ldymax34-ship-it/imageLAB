/**
 * 工作台 UI 静态自检（纯 Node，不启动浏览器）
 *
 * 本轮 UI 改版的边界是「只重排已有控制能力」：分类检查器只切换显示、播放控件只保留一份
 * 且移到画布下方播放条、extrude3d 重置视图移到画布工具栏并复用原 id。
 * 这些都属于纯静态结构，用最小 HTML 解析器在这里逐条断言，浏览器观感由 Codex 独立验收。
 *
 * 运行：node --test tests/workspace-ui.test.cjs
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const { resolve, join } = require("node:path");

const ROOT = resolve(__dirname, "..");
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");

/* ------------------------------------------------------------------ 最小 HTML 解析 */

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"
]);

function parseHtml(source) {
  const html = source.replace(/<!--[\s\S]*?-->/g, "").replace(/<!doctype[^>]*>/gi, "");
  const root = { tag: "#root", attrs: {}, children: [], parent: null };
  const stack = [root];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)(\/?)>/g;
  let match;
  while ((match = tagRe.exec(html))) {
    const [, closing, rawName, attrsRaw, selfClose] = match;
    const tag = rawName.toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs = {};
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let attr;
    while ((attr = attrRe.exec(attrsRaw))) {
      attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? "";
    }
    const node = { tag, attrs, children: [], parent: stack[stack.length - 1] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose && !VOID.has(tag)) stack.push(node);
  }
  return root;
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function findById(root, id) {
  let hit = null;
  walk(root, (node) => {
    if (!hit && node.attrs.id === id) hit = node;
  });
  return hit;
}

function countId(root, id) {
  let count = 0;
  walk(root, (node) => {
    if (node.attrs.id === id) count += 1;
  });
  return count;
}

function findByAttr(root, key, value) {
  const hits = [];
  walk(root, (node) => {
    if (node.attrs[key] === value) hits.push(node);
  });
  return hits;
}

function hasAncestor(node, predicate) {
  for (let cur = node; cur; cur = cur.parent) if (predicate(cur)) return true;
  return false;
}

function closest(node, predicate) {
  for (let cur = node; cur; cur = cur.parent) if (predicate(cur)) return cur;
  return null;
}

/* ------------------------------------------------------------------ 基线控件 id（改版前必须全部保留） */

const PROTECTED_IDS = {
  "shaders-logo": [
    "advanced-title", "anim-note", "btn-export", "btn-freeze", "btn-pause", "btn-play", "btn-sample-logo",
    "effect-chips", "effect-gem-smoke", "effect-liquid-metal", "effect-note", "export-info",
    "group-advanced", "group-image", "group-main", "group-presets", "group-sizing",
    "image-clear", "image-file", "image-hint", "image-slot", "image-thumb", "image-title",
    "n-frame", "n-speed", "p-frame", "p-speed", "panel", "param-advanced", "param-main", "param-sizing",
    "preset-chips", "presets-title", "stage", "status"
  ],
  "shaders-bg": [
    "advanced-title", "anim-note", "btn-export", "btn-freeze", "btn-pause", "btn-play",
    "effect-chips", "effect-dot-grid", "effect-god-rays", "effect-grain-gradient", "effect-mesh-gradient",
    "effect-metaballs", "effect-neuro-noise", "effect-note", "effect-smoke-ring", "effect-warp", "export-info",
    "group-advanced", "group-image", "group-main", "group-presets", "group-sizing",
    "image-clear", "image-file", "image-hint", "image-slot", "image-thumb", "image-title",
    "n-frame", "n-speed", "p-frame", "p-speed", "panel", "param-advanced", "param-main", "param-sizing",
    "preset-chips", "presets-title", "stage", "status"
  ],
  "shaders-halftone": [
    "advanced-title", "anim-note", "btn-export", "btn-freeze", "btn-pause", "btn-play",
    "effect-chips", "effect-halftone-cmyk", "effect-halftone-dots", "effect-image-dithering", "effect-note",
    "empty", "export-info", "group-advanced", "group-image", "group-main", "group-presets", "group-sizing",
    "image-clear", "image-file", "image-hint", "image-slot", "image-thumb", "image-title",
    "n-frame", "n-speed", "p-frame", "p-speed", "panel", "param-advanced", "param-main", "param-sizing",
    "preset-chips", "presets-title", "stage", "status"
  ],
  "wave-grid": [
    "btn-export", "btn-pause", "btn-play", "btn-reroll", "density-chips", "export-info", "grid-info",
    "image-clear", "image-file", "image-name", "image-sampling", "mask-text",
    "n-amp", "n-bandWidth", "n-density", "n-glow", "n-glowAngle", "n-glowLength", "n-speed",
    "p-amp", "p-bandWidth", "p-density", "p-glow", "p-glowAngle", "p-glowLength", "p-speed",
    "preset-coarse", "preset-fine", "preset-letters", "preset-medium", "preset-ribbons",
    "shape-chips", "stage", "status", "wave-canvas"
  ],
  "ascii-motion": [
    "ascii-holder", "btn-export", "btn-pause", "btn-play", "char-pattern", "charset-input",
    "color-blue", "color-chips", "color-cyan", "color-lilac", "color-white",
    "custom-image-file", "custom-image-label", "custom-image-name", "custom-mode-chips", "custom-text",
    "export-info", "frame-info", "image-sampling", "motion-chips", "n-density", "n-glow", "n-speed",
    "p-density", "p-glow", "p-speed", "preset-chips", "preset-jellyfish", "preset-note",
    "preset-ring", "preset-tunnel", "preset-wave", "stage", "status"
  ],
  "extrude3d": [
    "bevel-enabled", "bevel-size", "bevel-size-out", "bevel-thickness", "bevel-thickness-out",
    "depth", "depth-out", "model-canvas", "model-error", "model-reset-view", "model-stats", "model-status",
    "model-view", "panel-model", "panel-render", "render-bg", "render-bg-black", "render-bg-file",
    "render-bg-mode", "render-bg-name", "render-bg-pan-note", "render-bg-pan-reset", "render-bg-pan-x",
    "render-bg-pan-x-out", "render-bg-pan-y", "render-bg-pan-y-out", "render-bg-remove", "render-bg-white",
    "render-bg-zoom", "render-bg-zoom-out", "render-canvas", "render-color", "render-dispersion",
    "render-dispersion-out", "render-env-intensity", "render-env-intensity-out", "render-export-png",
    "render-export-scale", "render-exposure", "render-exposure-out", "render-glass-note", "render-hint",
    "render-ior", "render-ior-out", "render-light-angle", "render-light-angle-out", "render-light-intensity",
    "render-light-intensity-out", "render-material", "render-metallic", "render-metallic-out",
    "render-optical", "render-optical-out", "render-reset-view", "render-roughness", "render-roughness-out",
    "render-stats", "render-status", "render-transparent", "render-view", "sample", "smoothness",
    "smoothness-out", "stage-model", "stage-render", "svg-file", "svg-name", "tab-model", "tab-render"
  ]
};

/* ------------------------------------------------------------------ 分类结构 */

const FIVE_ANIMATED = {
  "shaders-logo": { cats: ["media", "effect", "compose", "output"], playbar: ["btn-pause", "btn-play", "p-speed", "n-speed", "p-frame", "n-frame", "btn-freeze", "anim-note"] },
  "shaders-bg": { cats: ["media", "effect", "compose", "output"], playbar: ["btn-pause", "btn-play", "p-speed", "n-speed", "p-frame", "n-frame", "btn-freeze", "anim-note"] },
  "shaders-halftone": { cats: ["media", "effect", "compose", "output"], playbar: ["btn-pause", "btn-play", "p-speed", "n-speed", "p-frame", "n-frame", "btn-freeze", "anim-note"] },
  "wave-grid": { cats: ["shape", "look", "motion", "output"], playbar: ["btn-pause", "btn-play", "p-speed", "n-speed", "status"] },
  "ascii-motion": { cats: ["shape", "look", "motion", "output"], playbar: ["btn-pause", "btn-play", "p-speed", "n-speed", "frame-info"] }
};

const CATEGORY_CONTENT = {
  "shaders-logo": { media: ["group-image"], effect: ["effect-chips", "group-presets", "group-main"], compose: ["group-advanced", "group-sizing"], output: ["btn-export", "export-info"] },
  "shaders-bg": { media: ["group-image"], effect: ["effect-chips", "group-presets", "group-main"], compose: ["group-advanced", "group-sizing"], output: ["btn-export", "export-info"] },
  "shaders-halftone": { media: ["group-image"], effect: ["effect-chips", "group-presets", "group-main"], compose: ["group-advanced", "group-sizing"], output: ["btn-export", "export-info"] },
  "wave-grid": { shape: ["density-chips", "shape-chips", "mask-text", "image-file"], look: ["p-glow"], motion: ["p-amp"], output: ["btn-export", "export-info"] },
  "ascii-motion": { shape: ["preset-chips", "char-pattern", "custom-mode-chips"], look: ["p-glow", "color-chips"], motion: ["motion-chips"], output: ["btn-export", "export-info"] }
};

/* ------------------------------------------------------------------ 断言 */

const parsed = new Map();
const htmlOf = (tool) => {
  if (!parsed.has(tool)) parsed.set(tool, parseHtml(read(join("tools", tool, "index.html"))));
  return parsed.get(tool);
};

test("6 个目标工具的改版后 HTML 都保留全部原有控件 id（各一份）", () => {
  for (const [tool, ids] of Object.entries(PROTECTED_IDS)) {
    const root = htmlOf(tool);
    const missing = ids.filter((id) => countId(root, id) === 0);
    const duplicated = ids.filter((id) => countId(root, id) > 1);
    assert.deepEqual(missing, [], `${tool} 缺少控件 id: ${missing.join(", ")}`);
    assert.deepEqual(duplicated, [], `${tool} 控件 id 重复: ${duplicated.join(", ")}`);
  }
});

test("6 个目标工具都有带可访问语义的分类导航，且每个分类都有对应面板", () => {
  const expected = {
    "shaders-logo": [["media", "effect", "compose", "output"]],
    "shaders-bg": [["media", "effect", "compose", "output"]],
    "shaders-halftone": [["media", "effect", "compose", "output"]],
    "wave-grid": [["shape", "look", "motion", "output"]],
    "ascii-motion": [["shape", "look", "motion", "output"]],
    "extrude3d": [["import", "geometry"], ["material", "light", "background", "output"]]
  };
  for (const [tool, navs] of Object.entries(expected)) {
    const root = htmlOf(tool);
    const navNodes = findByAttr(root, "data-catnav", "");
    assert.equal(navNodes.length, navs.length, `${tool} 分类导航数量应为 ${navs.length}`);
    navs.forEach((cats, i) => {
      const nav = navNodes[i];
      assert.equal(nav.attrs.role, "tablist", `${tool} 分类导航需要 role=tablist`);
      const tabs = nav.children.filter((n) => n.attrs["data-cat"] !== undefined);
      assert.deepEqual(tabs.map((t) => t.attrs["data-cat"]), cats, `${tool} 第 ${i + 1} 个分类导航的分类`);
      let selected = 0;
      for (const tab of tabs) {
        assert.equal(tab.attrs.role, "tab", `${tool} 分类按钮需要 role=tab`);
        assert.ok(["true", "false"].includes(tab.attrs["aria-selected"]), `${tool} 分类按钮需要 aria-selected`);
        if (tab.attrs["aria-selected"] === "true") selected += 1;
        const controls = tab.attrs["aria-controls"];
        assert.ok(controls, `${tool}/${tab.attrs["data-cat"]} 缺少 aria-controls`);
        const panel = findById(root, controls);
        assert.ok(panel, `${tool}/${tab.attrs["data-cat"]} 的 aria-controls 指向不存在的 #${controls}`);
        assert.equal(panel.attrs.role, "tabpanel", `${tool}/#${controls} 需要 role=tabpanel`);
        assert.equal(panel.attrs["data-catpanel"], tab.attrs["data-cat"], `${tool}/#${controls} data-catpanel 不匹配`);
        const isSelected = tab.attrs["aria-selected"] === "true";
        const panelVisible = panel.attrs.hidden === undefined;
        assert.equal(isSelected, panelVisible, `${tool}/${tab.attrs["data-cat"]} 的选中态与面板显示不一致`);
      }
      assert.equal(selected, 1, `${tool} 第 ${i + 1} 个分类导航必须恰好一个 aria-selected=true`);
    });
  }
});

test("分类面板只包含各自分类的原有控件（不复制第二套参数）", () => {
  for (const [tool, mapping] of Object.entries(CATEGORY_CONTENT)) {
    const root = htmlOf(tool);
    for (const [cat, ids] of Object.entries(mapping)) {
      const panel = findByAttr(root, "data-catpanel", cat);
      assert.equal(panel.length, 1, `${tool} 缺少分类面板 ${cat}`);
      for (const id of ids) {
        const node = findById(root, id);
        assert.ok(node, `${tool} 缺少 #${id}`);
        assert.ok(hasAncestor(node, (n) => n === panel[0]), `${tool} 的 #${id} 应位于分类 ${cat}`);
      }
    }
  }
});

test("5 个动画工具的播放控件只存在一份且都位于画布播放条", () => {
  for (const [tool, cfg] of Object.entries(FIVE_ANIMATED)) {
    const root = htmlOf(tool);
    const playbars = findByAttr(root, "data-playbar", "");
    assert.equal(playbars.length, 1, `${tool} 应有且仅有一个播放条`);
    const playbar = playbars[0];
    for (const id of cfg.playbar) {
      assert.equal(countId(root, id), 1, `${tool} 的 #${id} 应只存在一份`);
      const node = findById(root, id);
      assert.ok(hasAncestor(node, (n) => n === playbar), `${tool} 的 #${id} 应位于播放条内`);
      const inPanel = hasAncestor(node, (n) => n.attrs.id === "panel");
      assert.ok(!inPanel, `${tool} 的 #${id} 不应再留在参数检查器内`);
    }
  }
});

test("播放条在 DOM 顺序上紧随画布容器之后", () => {
  for (const tool of Object.keys(FIVE_ANIMATED)) {
    const html = read(join("tools", tool, "index.html"));
    const canvasAt = html.indexOf('id="stage"');
    const playbarAt = html.indexOf("data-playbar");
    assert.ok(canvasAt > -1 && playbarAt > -1, `${tool} 缺少画布或播放条`);
    assert.ok(playbarAt > canvasAt, `${tool} 的播放条应在画布容器之后`);
    const mainEnd = html.indexOf("</main>");
    assert.ok(playbarAt < mainEnd, `${tool} 的播放条应在工作区内`);
  }
});

test("桌面 CSS 使用 100dvh 工作区与检查器内部滚动，小屏回退自然文档流", () => {
  const css = read("assets/workspace.css");
  assert.match(css, /100dvh/, "缺少 100dvh 工作区高度");
  assert.match(css, /@media\s*\(min-width:\s*1000px\)/, "缺少桌面 >=1000px 断点");
  assert.match(css, /@media\s*\(max-width:\s*999\.98px\)/, "缺少 <1000px 小屏回退断点");
  assert.match(css, /body\.il-workspace\s*\{[^}]*overflow:\s*hidden/s, "桌面 body 需要 overflow:hidden（不产生页面滚动）");
  assert.match(css, /\.il-panel\s*\{[^}]*overflow:\s*auto/s, "检查器需要内部滚动");
  assert.match(css, /body\.il-workspace \.il-main\s*\{[^}]*min-height:\s*0/s, "工作区需要 min-height:0");
  assert.match(css, /\.il-canvas\s*\{[^}]*min-height:\s*0/s, "画布需要 min-height:0，不滚出视口");
  assert.match(css, /\.il-playbar\s*\{[^}]*flex-wrap:\s*wrap/s, "播放条需要一行紧凑 / 窄屏换行");
  // 小屏回退：自然文档流允许纵向滚动，画布在前、面板在后。
  const mobile = css.slice(css.indexOf("@media (max-width: 999.98px)"));
  assert.match(mobile, /overflow-y:\s*auto/, "小屏应允许页面纵向滚动");
  assert.match(mobile, /\.il-stagecol\s*\{[^}]*order:\s*0/s, "小屏画布应在前面");
  assert.match(mobile, /\.il-panel\s*\{[^}]*order:\s*1/s, "小屏面板应排在画布之后");
});

test("分类导航辅助文件只做显示切换、不重建或重置控件", () => {
  const js = read("assets/workspace.js");
  assert.match(js, /export function mountCategoryTabs/, "需要导出 mountCategoryTabs");
  assert.match(js, /aria-selected/, "需要维护 aria-selected");
  assert.match(js, /\.hidden\s*=\s*!on/, "分类只通过 hidden 切换显示");
  assert.match(js, /ArrowRight|ArrowLeft/, "需要键盘可达");
  assert.doesNotMatch(js, /replaceChildren|innerHTML|\.value\s*=/, "分类导航不得重建或重置控件");
  for (const tool of Object.keys(FIVE_ANIMATED)) {
    const html = read(join("tools", tool, "index.html"));
    assert.ok(html.includes("../../assets/workspace.css"), `${tool} 未引入共享工作台样式`);
    const entry = tool.startsWith("shaders-") ? read(join("tools", tool, "ui.js")) : read(join("tools", tool, "main.js"));
    assert.ok(entry.includes("../../assets/workspace.js"), `${tool} 未引入分类导航辅助模块`);
  }
});

test("extrude3d 重建模 / 渲染主页签，检查器内再分类且不改变状态同步", () => {
  const root = htmlOf("extrude3d");
  const html = read("tools/extrude3d/index.html");
  for (const id of ["tab-model", "tab-render", "panel-model", "panel-render", "stage-model", "stage-render"]) {
    assert.equal(countId(root, id), 1, `extrude3d 缺少 #${id}`);
  }
  const modelImport = findByAttr(root, "data-catpanel", "import")[0];
  const modelGeometry = findByAttr(root, "data-catpanel", "geometry")[0];
  assert.ok(hasAncestor(findById(root, "sample"), (n) => n === modelImport), "内置样例应在建模-导入分类");
  assert.ok(hasAncestor(findById(root, "depth"), (n) => n === modelGeometry), "厚度应在建模-几何分类");
  const material = findByAttr(root, "data-catpanel", "material")[0];
  const light = findByAttr(root, "data-catpanel", "light")[0];
  const background = findByAttr(root, "data-catpanel", "background")[0];
  const output = findByAttr(root, "data-catpanel", "output")[0];
  assert.ok(hasAncestor(findById(root, "render-material"), (n) => n === material), "材质应在渲染-材质分类");
  assert.ok(hasAncestor(findById(root, "render-light-intensity"), (n) => n === light), "灯光应在渲染-灯光分类");
  assert.ok(hasAncestor(findById(root, "render-bg"), (n) => n === background), "背景应在渲染-背景分类");
  assert.ok(hasAncestor(findById(root, "render-export-png"), (n) => n === output), "导出应在渲染-输出分类");
  // 主页签仍由原有逻辑同步，不存在第二套渲染分支。
  const main = read("tools/extrude3d/main.js");
  assert.ok(main.includes("mountCategoryTabs"), "extrude3d 应初始化分类导航");
  assert.ok(/render\.setMesh\(snapshot\)/.test(main), "建模到渲染的网格交接保持不变");
});

test("extrude3d 重置视图位于渲染画布工具栏并复用 render-reset-view", () => {
  const root = htmlOf("extrude3d");
  const renderReset = findById(root, "render-reset-view");
  const modelReset = findById(root, "model-reset-view");
  assert.ok(renderReset && modelReset, "建模 / 渲染的重置入口都要保留原 id");
  const renderToolbar = closest(renderReset, (n) => n.attrs.class === "il-canvas-toolbar");
  const renderStage = closest(renderReset, (n) => n.attrs.id === "stage-render");
  const modelToolbar = closest(modelReset, (n) => n.attrs.class === "il-canvas-toolbar");
  const modelStage = closest(modelReset, (n) => n.attrs.id === "stage-model");
  assert.ok(renderToolbar && renderStage, "渲染重置视图必须在 #stage-render 的画布工具栏内");
  assert.ok(modelToolbar && modelStage, "建模重置视图必须在 #stage-model 的画布工具栏内");
  assert.equal(renderReset.attrs.title && renderReset.attrs.title.includes("观察中心"), true, "渲染重置视图需要写清恢复摄像机位置与观察中心");
  const html = read("tools/extrude3d/index.html");
  assert.ok(html.includes(">重置视图<"), "渲染重置入口中文名应为「重置视图」");
  const render = read("tools/extrude3d/render-vgpu.js");
  assert.ok(render.includes("els.resetView"), "render-vgpu.js 必须继续复用 render-reset-view 绑定");
  assert.ok(render.includes("controls.update()"), "重置后必须调用 controls.update() 触发重绘");
  assert.ok(render.includes("摄像机与模型构图已重置"), "重置后需要中文反馈");
  assert.ok(render.includes("VIEW_DIR") && render.includes("VIEW_DISTANCE") && render.includes("controls.target.set(0, 0, 0)"), "重置必须复用原有相机 / 观察中心逻辑");
  const modeling = read("tools/extrude3d/modeling.js");
  assert.ok(modeling.includes("model-reset-view") || modeling.includes("els.resetView"), "建模重置视角逻辑保持");
});

test("extrude3d 桌面工作区不产生页面纵向滚动", () => {
  const css = read("tools/extrude3d/style.css");
  assert.match(css, /body\s*\{[^}]*height:\s*100dvh/s, "extrude3d body 需要 100dvh");
  assert.match(css, /body\s*\{[^}]*overflow:\s*hidden/s, "extrude3d 桌面不应产生页面滚动");
  assert.match(css, /\.il-panel\s*\{[^}]*overflow:\s*auto/s, "extrude3d 检查器需要内部滚动");
  assert.match(css, /@media\s*\(max-width:\s*999\.98px\)/, "extrude3d 需要 <1000px 回退");
});
