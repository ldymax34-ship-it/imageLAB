/* Node test suite for the curve document engine (curve-engine.js).
 *
 * Run with: node --test *.test.cjs
 * curve-engine.js has no DOM dependency, so it can be required directly in
 * Node. The SVG importer is browser-only and is exercised by
 * svg-import.test.html instead.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const PE = require("./engine.js");
const CE = require("./curve-engine.js");

const EPS = 1e-6;

test("invalid arc endpoint and disconnected segments reject",()=>{
  assert.equal(CE.normalizeSegment({kind:"arc",p0:[10,0],p1:[0,10],center:[0,0],r:10,sweep:Math.PI}),null);
  assert.throws(()=>CE.normalizeDoc({paths:[{id:"x",subpaths:[{segments:[
    {kind:"line",p0:[0,0],p1:[10,0]},{kind:"line",p0:[11,0],p1:[20,0]}
  ]}]}]}),/不连续/);
});
test("incomplete v2 config rejects instead of resetting both tabs",()=>{
  assert.throws(()=>CE.normalizeConfig({app:"pattern-studio",version:2}),/缺少/);
});

function linePath(id, a, b, closed) {
  return {id: id, source: "import", subpaths: [{closed: !!closed, segments: [{kind: "line", p0: a, p1: b}]}]};
}

function customFromDoc(doc) {
  return {polylines: CE.docPolylines(doc), segments: CE.docSegments(doc)};
}

/* ------------------------------------------------------------ keep-out */

test("custom curve paths replace built-in seams and drive keep-out", () => {
  const doc = CE.normalizeDoc({paths: [linePath("v", [200, 0], [200, 400])]});
  const settings = PE.normalize({
    width: 400, height: 400, grid: "square", shape: "circle",
    spacing: 20, diameter: 12, field: "uniform", seam: "diamond",
    keepout: 30, fade: 0, levels: 0
  });

  const scene = PE.generate(settings, null, customFromDoc(doc));
  assert.equal(scene.paths.length, 1, "the document must replace the built-in seams");
  assert.ok(scene.dots.length > 0);

  const half = 15;
  scene.dots.forEach((dot) => {
    const distance = PE.pathDistance(dot.x, dot.y, scene.paths);
    assert.ok(distance >= half - EPS, "dot centre enters the keep-out band");
    assert.ok(distance - half >= dot.r - EPS, "dot overlaps the keep-out band");
  });

  // A second, wider band must remove strictly more units than a narrow one.
  const wide = PE.generate(Object.assign({}, settings, {keepout: 60}), null, customFromDoc(doc));
  assert.ok(wide.dots.length < scene.dots.length);

  // Without custom paths the built-in diamond seams are used again.
  const builtin = PE.generate(settings);
  assert.ok(builtin.paths.length > 1);
});

test("the custom keep-out works for a closed outline without acting as a fill mask", () => {
  const corners = [[100, 100], [300, 100], [300, 300], [100, 300]];
  const segments = corners.map((c, i) => ({kind: "line", p0: c, p1: corners[(i + 1) % 4]}));
  const doc = CE.normalizeDoc({paths: [{id: "box", source: "import", subpaths: [{closed: true, segments}]}]});
  const settings = PE.normalize({
    width: 400, height: 400, grid: "square", shape: "circle",
    spacing: 20, diameter: 10, field: "uniform", keepout: 20, fade: 0, levels: 0
  });

  const scene = PE.generate(settings, null, customFromDoc(doc));
  assert.equal(scene.paths.length, 1, "a closed subpath is one outline polyline");
  assert.equal(scene.paths[0].length, 5, "outline includes the closing point");

  // The centre of the box is 100 px from any edge, so units must still appear
  // inside: a closed path is an outline, not a filled keep-out region.
  const inside = scene.dots.filter((d) => d.x > 150 && d.x < 250 && d.y > 150 && d.y < 250);
  assert.ok(inside.length > 0, "a closed outline must not blank its interior");

  // No unit may sit on or across the outline itself.
  scene.dots.forEach((dot) => {
    const distance = PE.pathDistance(dot.x, dot.y, scene.paths);
    assert.ok(distance - 10 >= dot.r - EPS);
  });
});

test("arc geometry is honoured by keep-out sampling", () => {
  const arc = {kind: "arc", p0: [260, 200], p1: [200, 260], center: [200, 200], r: 60, sweep: Math.PI / 2};
  const doc = CE.normalizeDoc({paths: [{id: "arc", source: "import", subpaths: [{closed: false, segments: [arc]}]}]});
  const polyline = CE.docPolylines(doc)[0];
  polyline.forEach((p) => {
    assert.ok(Math.abs(Math.hypot(p[0] - 200, p[1] - 200) - 60) <= CE.LIMITS.SAMPLE_TOLERANCE + EPS);
  });

  const settings = PE.normalize({
    width: 400, height: 400, grid: "square", shape: "circle",
    spacing: 16, diameter: 8, field: "uniform", keepout: 24, fade: 0, levels: 0
  });
  const scene = PE.generate(settings, null, customFromDoc(doc));
  scene.dots.forEach((dot) => {
    assert.ok(PE.pathDistance(dot.x, dot.y, scene.paths) - 12 >= dot.r - EPS);
  });
});

/* ------------------------------------------------------ normalization */

test("document normalization is strict about geometry and coordinates", () => {
  assert.deepEqual(CE.normalizeDoc(null).paths, []);
  assert.deepEqual(CE.normalizeDoc({paths: "nope"}).paths, []);

  // Non-finite coordinates are rejected rather than silently kept.
  assert.throws(() => CE.normalizeDoc({paths: [{subpaths: [{segments: [{kind: "line", p0: [NaN, 0], p1: [1, 1]}]}]}]}));
  assert.throws(() => CE.normalizeDoc({paths: [{subpaths: [{segments: [{kind: "line", p0: [1e12, 0], p1: [1, 1]}]}]}]}));

  // An arc whose centre does not match its radius is not accepted.
  assert.throws(() => CE.normalizeDoc({paths: [{subpaths: [{segments: [
    {kind: "arc", p0: [10, 0], p1: [0, 10], center: [0, 0], r: 999, sweep: Math.PI / 2}
  ]}]}]}));

  // Unknown segment kinds are dropped while a malformed known kind fails.
  assert.throws(() => CE.normalizeDoc({paths: [{subpaths: [{segments: [{kind: "line", p0: [0, 0]}]}]}]}));

  // Too many paths is an explicit budget error.
  const many = [];
  for (let i = 0; i <= CE.LIMITS.MAX_PATHS; i++) many.push(linePath("p" + i, [0, 0], [10, 10]));
  assert.throws(() => CE.normalizeDoc({paths: many}), /上限/);
});

test("document serialization round-trips geometry and stays clonable", () => {
  const arc = {kind: "arc", p0: [120, 100], p1: [100, 120], center: [100, 100], r: 20, sweep: Math.PI / 2};
  const doc = CE.normalizeDoc({paths: [
    {id: "a", source: "import", label: "arc", subpaths: [{closed: false, segments: [arc]}]},
    {id: "b", source: "hand", label: "hand", points: [[0, 0], [5, 5], [10, 0]], subpaths: [{closed: false, segments: [{kind: "line", p0: [0, 0], p1: [10, 0]}]}]}
  ]});
  const clone = CE.normalizeDoc(CE.serializeDoc(doc));
  assert.equal(clone.paths.length, 2);
  assert.equal(clone.paths[0].subpaths[0].segments[0].kind, "arc");
  assert.equal(clone.paths[0].subpaths[0].segments[0].r, 20);
  assert.deepEqual(clone.paths[1].points, [[0, 0], [5, 5], [10, 0]]);
  assert.deepEqual(CE.docStats(clone), CE.docStats(doc));

  const json = JSON.stringify(CE.serializeDoc(doc));
  assert.equal(JSON.parse(json).paths.length, 2);
});

test("untrusted documents cannot pollute prototypes or inject ids", () => {
  const bad = JSON.parse('{"paths":[{"id":"<img src=x onerror=alert(1)>","source":"hand","points":[[0,0],[1,1]],"subpaths":[{"segments":[{"kind":"line","p0":[0,0],"p1":[1,1]}]}]}],"__proto__":{"polluted":true}}');
  const doc = CE.normalizeDoc(bad);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(doc), Object.prototype);
  assert.ok(!/[<>]/.test(doc.paths[0].id), "ids are sanitized to a safe character set");
});

/* --------------------------------------------------- primitive sampling */

test("primitive sampling round-trip stays within the sampling tolerance", () => {
  const segments = [
    {kind: "line", p0: [0, 0], p1: [100, 0]},
    {kind: "arc", p0: [100, 0], p1: [200, 0], center: [150, 0], r: 50, sweep: Math.PI}
  ];
  const polyline = CE.segmentsToPolyline(segments, false);
  assert.deepEqual(polyline[0], [0, 0]);
  assert.deepEqual(polyline[polyline.length - 1], [200, 0]);

  // The straight half must stay exactly on y = 0.
  polyline.filter((p) => p[0] <= 100 + EPS).forEach((p) => assert.ok(Math.abs(p[1]) <= EPS));

  // The arc half must stay within the sampling tolerance of the circle.
  polyline.filter((p) => p[0] > 100).forEach((p) => {
    const radial = Math.abs(Math.hypot(p[0] - 150, p[1]) - 50);
    assert.ok(radial <= CE.LIMITS.SAMPLE_TOLERANCE + EPS, "arc sample off by " + radial);
  });
});

test("fitting a rough gesture yields few straight/circular primitives", () => {
  // An almost-circular rough stroke, radius 180, with a little hand jitter.
  const rough = [];
  for (let i = 0; i <= 80; i++) {
    const a = -Math.PI / 3 + (i / 80) * (Math.PI * 2 / 3);
    const r = 180 + Math.sin(i * 1.7) * 2.2;
    rough.push([400 + r * Math.cos(a), 400 + r * Math.sin(a)]);
  }
  const fit = CE.fitStroke(rough, 0.6);
  assert.ok(fit.segments.length >= 1 && fit.segments.length <= 4, "expected a small primitive count, got " + fit.segments.length);
  assert.ok(fit.segments.every((s) => s.kind === "line" || s.kind === "arc"));

  const path = CE.makeHandPath(rough, 0.6, "hand-1", "test");
  assert.equal(path.source, "hand");
  assert.deepEqual(path.points, CE.sanitizePointList(rough));
  const sampled = path.subpaths[0].polyline;
  assert.ok(sampled.length >= 2);
  // Every fitted sample must stay near the intended radius.
  sampled.forEach((p) => {
    assert.ok(Math.abs(Math.hypot(p[0] - 400, p[1] - 400) - 180) < 25, "fit departed too far from the stroke");
  });

  // A near-straight gesture is reported as a line.
  const straight = [];
  for (let i = 0; i <= 40; i++) straight.push([100 + i * 6, 200 + Math.sin(i) * 0.2]);
  const straightFit = CE.fitStroke(straight, 0.5);
  assert.ok(straightFit.segments.some((s) => s.kind === "line"));
});

test("simplicity re-fitting only touches hand paths", () => {
  const rough = [];
  for (let i = 0; i <= 50; i++) rough.push([100 + i * 5, 200 + Math.sin(i / 4) * 30]);
  const doc = CE.normalizeDoc({paths: [
    CE.makeHandPath(rough, 0.1, "h1", "hand"),
    {id: "i1", source: "import", subpaths: [{closed: false, segments: [{kind: "line", p0: [0, 0], p1: [50, 50]}]}]}
  ]});
  const importedBefore = JSON.stringify(doc.paths[1].subpaths);
  const changed = CE.refitHandPaths(doc, 0.95);
  assert.equal(changed, true);
  assert.equal(JSON.stringify(doc.paths[1].subpaths), importedBefore, "imported geometry must not be re-fitted");
  assert.ok(doc.paths[0].subpaths.length === 1);
});

/* --------------------------------------------------------- settings */

test("curve settings force no built-in seam and clamp simplicity", () => {
  const s = CE.normalizeCurveSettings({width: 640, seam: "wave", simplicity: 4});
  assert.equal(s.seam, "none");
  assert.equal(s.simplicity, 1);
  assert.equal(CE.normalizeCurveSettings({simplicity: -2}).simplicity, 0);
  assert.equal(CE.normalizeCurveSettings({}).simplicity, CE.DEFAULT_SIMPLICITY);
});

test("config v2 validates both tabs and v1 migrates into the quick tab", () => {
  const doc = CE.normalizeDoc({paths: [linePath("v", [0, 0], [100, 100])]});
  const cfg = CE.normalizeConfig({
    app: "pattern-studio",
    version: 2,
    activeTab: "curve",
    quick: {settings: {width: 640, shape: "diamond"}},
    curve: {settings: {simplicity: 0.85, grid: "square"}, mode: "move", doc: doc}
  });
  assert.equal(cfg.version, 2);
  assert.equal(cfg.activeTab, "curve");
  assert.equal(cfg.quick.settings.width, 640);
  assert.equal(cfg.quick.settings.shape, "diamond");
  assert.equal(cfg.curve.settings.simplicity, 0.85);
  assert.equal(cfg.curve.settings.grid, "square");
  assert.equal(cfg.curve.mode, "move");
  assert.equal(cfg.curve.doc.paths.length, 1);

  const v1 = CE.normalizeConfig({app: "pattern-studio", version: 1, settings: {width: 800, seam: "diamond"}});
  assert.equal(v1.version, 1);
  assert.equal(v1.activeTab, "quick");
  assert.equal(v1.quick.settings.width, 800);
  assert.equal(v1.quick.settings.seam, "diamond");
  assert.equal(v1.curve.doc.paths.length, 0);

  assert.throws(() => CE.normalizeConfig(null));
  assert.throws(() => CE.normalizeConfig({app: "other", version: 2}));
  assert.throws(() => CE.normalizeConfig({app: "pattern-studio", version: 99}));
  assert.throws(() => CE.normalizeConfig({app: "pattern-studio", version: 1}));
});

/* ------------------------------------------------------------- export */

test("SVG export keeps custom arcs and honours the guide toggle", () => {
  const arc = {kind: "arc", p0: [260, 200], p1: [200, 260], center: [200, 200], r: 60, sweep: Math.PI / 2};
  const doc = CE.normalizeDoc({paths: [{id: "arc", source: "import", subpaths: [{closed: false, segments: [arc]}]}]});
  const settings = PE.normalize({
    width: 400, height: 400, transparent: true, keepout: 24, fade: 60,
    spacing: 18, diameter: 10, field: "uniform", levels: 0
  });
  const scene = PE.generate(settings, null, customFromDoc(doc));
  assert.ok(scene.pathSegments && scene.pathSegments.length === 1);

  const withGuides = PE.toSVG(scene, {guides: true});
  assert.ok(withGuides.indexOf('id="seam-guides"') !== -1);
  assert.ok(withGuides.indexOf("A60 60 0") !== -1, "arcs must be exported as arcs, not flattened");
  assert.ok(withGuides.indexOf("stroke-dasharray") !== -1);

  const withoutGuides = PE.toSVG(scene, {guides: false});
  assert.equal(withoutGuides.indexOf("seam-guides"), -1);
});

test("demo document loads reference strokes as hand paths", () => {
  const demo = CE.demoDoc({x: 0, y: 0, width: 1200, height: 800}, 0.6);
  assert.ok(demo.paths.length >= 1);
  demo.paths.forEach((p) => {
    assert.equal(p.source, "hand");
    assert.ok(p.points.length >= 2);
    assert.ok(p.subpaths[0].segments.length >= 1);
  });
  const renormalized = CE.normalizeDoc(CE.serializeDoc(demo));
  assert.equal(renormalized.paths.length, demo.paths.length);
});
