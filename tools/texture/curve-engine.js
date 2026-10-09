/* 纹理间 · 曲线纹理 — pure curve-document engine.
 *
 * No DOM, no network, no third-party runtime. Runs in the browser as
 * `window.CurveEngine` and in Node via `require("./curve-engine.js")` so the
 * document model, validation, sampling and config migration are unit-testable.
 *
 * A curve document is an ordered list of paths:
 *   {id, source:"hand"|"import", label, points?, subpaths:[{closed, segments,
 *    polyline}]}
 * `segments` is the authored geometry: exact straight lines and circular arcs.
 * `polyline` is a derived, evenly-sampled cache used for keep-out distance and
 * for the PNG preview; it is never written to disk.
 *
 * Hand paths keep their raw pointer `points` so the Simplifity slider can
 * re-run `CA.fit.fitStroke` without re-drawing. Imported paths keep only their
 * geometry (segments) and are never re-fitted.
 */
(function (root) {
  "use strict";

  var PE = root.PatternEngine || (typeof require === "function" ? require("./engine.js") : null);
  var CA = (root.CA && root.CA.fit) || null;
  if (!CA && typeof require === "function") {
    try { CA = require("./curve-fit.js"); } catch (err) { CA = null; }
  }
  if (!PE) throw new Error("PatternEngine 未加载");

  var CONFIG_APP = "pattern-studio";
  var CONFIG_VERSION = 2;
  var DEFAULT_SIMPLICITY = 0.6;

  var LIMITS = {
    MAX_PATHS: 64,
    MAX_SUBPATHS_PER_PATH: 64,
    MAX_SEGMENTS_PER_SUBPATH: 4096,
    MAX_SOURCE_POINTS_PER_PATH: 2048,
    MAX_POLYLINE_POINTS_PER_PATH: 8000,
    MAX_TOTAL_POLYLINE_POINTS: 30000,
    MAX_COORD: 1e6,
    MAX_ID_LENGTH: 64,
    MAX_LABEL_LENGTH: 80,
    SAMPLE_TOLERANCE: 0.5
  };

  var clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  var isNum = function (v) { return typeof v === "number" && Number.isFinite(v); };

  function coordOk(v) { return isNum(v) && Math.abs(v) <= LIMITS.MAX_COORD; }
  function normPt(p) {
    if (Array.isArray(p)) return coordOk(p[0]) && coordOk(p[1]) ? [p[0], p[1]] : null;
    if (p && typeof p === "object") return coordOk(p.x) && coordOk(p.y) ? [p.x, p.y] : null;
    return null;
  }
  function samePt(a, b) { return a && b && Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6; }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  /* ------------------------------------------------------------ segments */

  function normalizeSegment(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.kind === "line") {
      var l0 = normPt(raw.p0), l1 = normPt(raw.p1);
      if (!l0 || !l1 || samePt(l0, l1)) return null;
      return {kind: "line", p0: l0, p1: l1};
    }
    if (raw.kind === "arc") {
      var p0 = normPt(raw.p0), p1 = normPt(raw.p1), c = normPt(raw.center);
      var r = Number(raw.r), sweep = Number(raw.sweep);
      if (!p0 || !p1 || !c) return null;
      if (!isNum(r) || r <= 0 || r > LIMITS.MAX_COORD) return null;
      if (!isNum(sweep) || Math.abs(sweep) < 1e-6 || Math.abs(sweep) > Math.PI * 2 + 1e-6) return null;
      var tol = Math.max(1e-3, r * 1e-3);
      if (Math.abs(dist(p0, c) - r) > tol || Math.abs(dist(p1, c) - r) > tol) return null;
      var endAngle = Math.atan2(p0[1] - c[1], p0[0] - c[0]) + sweep;
      if (dist(p1, [c[0] + r * Math.cos(endAngle), c[1] + r * Math.sin(endAngle)]) > tol) return null;
      return {kind: "arc", p0: p0, p1: p1, center: c, r: r, sweep: sweep};
    }
    return null;
  }

  /* Flatten one subpath's exact segments into a polyline. Throws when the
   * sample budget would be exceeded so callers reject oversized documents. */
  function segmentsToPolyline(segments, closed) {
    var tol = LIMITS.SAMPLE_TOLERANCE;
    var maxPts = LIMITS.MAX_POLYLINE_POINTS_PER_PATH;
    var pts = [];
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      if (!pts.length || !samePt(pts[pts.length - 1], seg.p0)) pts.push(seg.p0.slice());
      if (seg.kind === "line") {
        pts.push(seg.p1.slice());
        continue;
      }
      var r = seg.r, c = seg.center, sweep = seg.sweep;
      var ratio = clamp(1 - tol / Math.max(r, tol), -1, 1);
      var step = Math.max(1e-3, 2 * Math.acos(ratio));
      var count = Math.max(2, Math.ceil(Math.abs(sweep) / step));
      if (pts.length + count > maxPts) throw new Error("曲线采样点数超过上限");
      var a0 = Math.atan2(seg.p0[1] - c[1], seg.p0[0] - c[0]);
      for (var k = 1; k <= count; k++) {
        var a = a0 + sweep * k / count;
        pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
      }
      pts[pts.length - 1] = seg.p1.slice();
    }
    if (closed && pts.length > 1 && !samePt(pts[0], pts[pts.length - 1])) pts.push(pts[0].slice());
    return pts;
  }

  function primitivesToSegments(prims) {
    var out = [];
    (prims || []).forEach(function (p) {
      if (!p || !p.p0 || !p.p1) return;
      var p0 = normPt(p.p0), p1 = normPt(p.p1);
      if (!p0 || !p1) return;
      if (p.kind === "line") {
        if (!samePt(p0, p1)) out.push({kind: "line", p0: p0, p1: p1});
        return;
      }
      if (p.kind === "arc" && p.center && isNum(p.radius) && isNum(p.sweep)) {
        var c = normPt(p.center);
        if (c && p.radius > 0 && Math.abs(p.sweep) > 1e-6) {
          out.push({kind: "arc", p0: p0, p1: p1, center: c, r: p.radius, sweep: p.sweep});
        }
      }
    });
    return out;
  }

  /* ------------------------------------------------------- document model */

  function normalizeId(raw, index) {
    if (typeof raw === "string") {
      var clean = raw.replace(/[^\w.\-:]/g, "").slice(0, LIMITS.MAX_ID_LENGTH);
      if (clean) return clean;
    }
    return "path-" + index + "-" + Math.random().toString(36).slice(2, 8);
  }

  function normalizeSubpath(raw, pathIndex) {
    if (!raw || typeof raw !== "object") throw new Error("第 " + (pathIndex + 1) + " 条路径的子路径格式无效");
    var rawSegs = Array.isArray(raw.segments) ? raw.segments : [];
    if (rawSegs.length > LIMITS.MAX_SEGMENTS_PER_SUBPATH) throw new Error("子路径段数超过上限");
    var segments = [];
    for (var i = 0; i < rawSegs.length; i++) {
      var seg = normalizeSegment(rawSegs[i]);
      if (seg) {
        if (segments.length && !samePt(segments[segments.length - 1].p1, seg.p0))
          throw new Error("子路径不连续；断开的曲线应使用独立子路径");
        segments.push(seg);
      }
      else if (rawSegs[i] && rawSegs[i].kind) throw new Error("子路径包含无效的几何段");
    }
    if (!segments.length) return null;
    var closed = !!raw.closed;
    return {closed: closed, segments: segments, polyline: segmentsToPolyline(segments, closed)};
  }

  function normalizePath(raw, index) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("第 " + (index + 1) + " 条路径格式无效");
    var source = raw.source === "import" ? "import" : "hand";
    var label = typeof raw.label === "string" ? raw.label.slice(0, LIMITS.MAX_LABEL_LENGTH) : ("路径 " + (index + 1));
    var points = null;
    if (Array.isArray(raw.points)) {
      if (raw.points.length > LIMITS.MAX_SOURCE_POINTS_PER_PATH) throw new Error("路径源点超过上限");
      points = [];
      for (var i = 0; i < raw.points.length; i++) {
        var q = normPt(raw.points[i]);
        if (!q) throw new Error("路径源点包含无效坐标");
        if (!points.length || !samePt(points[points.length - 1], q)) points.push(q);
      }
      if (points.length < 2) points = null;
    }
    var rawSubs = Array.isArray(raw.subpaths) ? raw.subpaths : [];
    if (rawSubs.length > LIMITS.MAX_SUBPATHS_PER_PATH) throw new Error("子路径数量超过上限");
    var subpaths = [];
    for (var j = 0; j < rawSubs.length; j++) {
      var sp = normalizeSubpath(rawSubs[j], index);
      if (sp) subpaths.push(sp);
    }
    if (!subpaths.length) return null;
    return {id: normalizeId(raw.id, index), source: source, label: label, points: points, subpaths: subpaths};
  }

  function normalizeDoc(raw) {
    var src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {paths: []};
    var rawPaths = Array.isArray(src.paths) ? src.paths : [];
    if (rawPaths.length > LIMITS.MAX_PATHS) throw new Error("路径数量超过 " + LIMITS.MAX_PATHS + " 条上限");
    var paths = [], total = 0, ids = new Set();
    for (var i = 0; i < rawPaths.length; i++) {
      var p = normalizePath(rawPaths[i], i);
      if (!p) continue;
      if (ids.has(p.id)) throw new Error("曲线路径 ID 重复");
      ids.add(p.id);
      for (var s = 0; s < p.subpaths.length; s++) {
        total += p.subpaths[s].polyline.length;
        if (total > LIMITS.MAX_TOTAL_POLYLINE_POINTS) throw new Error("曲线总采样点数超过上限");
      }
      paths.push(p);
    }
    return {version: CONFIG_VERSION, paths: paths};
  }

  function emptyDoc() { return {version: CONFIG_VERSION, paths: []}; }
  function cloneDoc(doc) { return normalizeDoc(serializeDoc(doc)); }

  function serializeDoc(doc) {
    return {
      paths: (doc && doc.paths ? doc.paths : []).map(function (p) {
        var out = {id: p.id, source: p.source, label: p.label};
        if (p.points && p.points.length) out.points = p.points.map(function (pt) { return [pt[0], pt[1]]; });
        out.subpaths = p.subpaths.map(function (sp) {
          return {
            closed: !!sp.closed,
            segments: sp.segments.map(function (seg) {
              if (seg.kind === "line") return {kind: "line", p0: [seg.p0[0], seg.p0[1]], p1: [seg.p1[0], seg.p1[1]]};
              return {kind: "arc", p0: [seg.p0[0], seg.p0[1]], p1: [seg.p1[0], seg.p1[1]],
                center: [seg.center[0], seg.center[1]], r: seg.r, sweep: seg.sweep};
            })
          };
        });
        return out;
      })
    };
  }

  function docHasGeometry(doc) {
    return !!(doc && doc.paths && doc.paths.some(function (p) {
      return p.subpaths.some(function (sp) { return sp.segments.length > 0; });
    }));
  }
  function docPolylines(doc) {
    var out = [];
    (doc && doc.paths ? doc.paths : []).forEach(function (p) {
      p.subpaths.forEach(function (sp) { if (sp.polyline.length > 1) out.push(sp.polyline); });
    });
    return out;
  }
  function docSegments(doc) {
    var out = [];
    (doc && doc.paths ? doc.paths : []).forEach(function (p) {
      p.subpaths.forEach(function (sp) { out.push({closed: sp.closed, segments: sp.segments}); });
    });
    return out;
  }
  function docStats(doc) {
    var paths = doc && doc.paths ? doc.paths.length : 0;
    var subs = 0, segs = 0, pts = 0, hand = 0, imported = 0;
    (doc && doc.paths ? doc.paths : []).forEach(function (p) {
      if (p.source === "import") imported++; else hand++;
      p.subpaths.forEach(function (sp) { subs++; segs += sp.segments.length; pts += sp.polyline.length; });
    });
    return {paths: paths, subpaths: subs, segments: segs, polylinePoints: pts, hand: hand, imported: imported};
  }

  /* ------------------------------------------------------------- fitting */

  function requireCA() {
    if (!CA || typeof CA.fitStroke !== "function") throw new Error("曲线拟合模块未加载");
    return CA;
  }

  function sanitizePointList(points) {
    var out = [];
    (points || []).forEach(function (p) {
      var q = normPt(p);
      if (!q) return;
      if (!out.length || !samePt(out[out.length - 1], q)) out.push(q);
      if (out.length >= LIMITS.MAX_SOURCE_POINTS_PER_PATH) return;
    });
    return out;
  }

  /* Interpret one rough hand gesture as a few straight/circular primitives. */
  function fitStroke(points, simplicity, options) {
    var lib = requireCA();
    var opts = {simplicity: clamp(isNum(simplicity) ? simplicity : DEFAULT_SIMPLICITY, 0, 1)};
    if (options) for (var k in options) if (options[k] !== undefined) opts[k] = options[k];
    // curve-fit.js consumes {x,y} objects; the document stores [x,y] tuples.
    var input = sanitizePointList(points).map(function (p) { return {x: p[0], y: p[1]}; });
    var result = lib.fitStroke(input, opts);
    return {segments: primitivesToSegments(result.primitives), stats: result.stats, errorBudget: result.errorBudget};
  }

  function makeHandPath(points, simplicity, id, label) {
    var clean = sanitizePointList(points);
    if (clean.length < 2) throw new Error("笔画太短");
    var fit = fitStroke(clean, simplicity);
    if (!fit.segments.length) throw new Error("笔画太短或无法拟合");
    return {
      id: normalizeId(id, 0), source: "hand", label: label || "手绘路径", points: clean,
      subpaths: [{closed: false, segments: fit.segments, polyline: segmentsToPolyline(fit.segments, false)}]
    };
  }

  function refitHandPaths(doc, simplicity) {
    var changed = false;
    (doc.paths || []).forEach(function (p) {
      if (p.source !== "hand" || !p.points || p.points.length < 2) return;
      try {
        var fit = fitStroke(p.points, simplicity);
        if (!fit.segments.length) return;
        p.subpaths = [{closed: false, segments: fit.segments, polyline: segmentsToPolyline(fit.segments, false)}];
        changed = true;
      } catch (err) { /* keep previous geometry for this path */ }
    });
    return changed;
  }

  /* Optional demo document built from the bundled reference gestures. */
  function demoDoc(box, simplicity) {
    var lib = requireCA();
    if (typeof lib.sampleStrokes !== "function") throw new Error("示例笔画不可用");
    var strokes = lib.sampleStrokes(box);
    var paths = [];
    strokes.forEach(function (stroke, index) {
      var pts = (stroke.points || []).map(function (p) { return [p.x, p.y]; });
      try {
        paths.push(makeHandPath(pts, simplicity, "demo-" + index, stroke.name || ("示例 " + (index + 1))));
      } catch (err) { /* skip an unusable reference stroke */ }
    });
    return normalizeDoc({paths: paths});
  }

  /* --------------------------------------------------------- settings */

  function normalizeCurveSettings(raw) {
    var s = PE.normalize(raw);
    s.seam = "none"; // built-in seams are replaced by the curve document
    var simp = raw && typeof raw === "object" ? Number(raw.simplicity) : NaN;
    s.simplicity = isNum(simp) ? clamp(simp, 0, 1) : DEFAULT_SIMPLICITY;
    return s;
  }

  function defaultCurveConfig() {
    return {settings: normalizeCurveSettings({}), mode: "draw", doc: emptyDoc()};
  }

  /* ------------------------------------------------- versioned config */

  /* Strictly validate a saved config. Version 1 (quick-tab only) files load
   * into the quick tab; version 2 carries both tabs, the active tab, the curve
   * mode and the editable curve document. */
  function normalizeConfig(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("文件内容不是有效的参数对象。");
    if (raw.app !== CONFIG_APP) throw new Error("这不是纹理间的参数文件。");
    if (raw.version === 1) {
      if (!raw.settings || typeof raw.settings !== "object" || Array.isArray(raw.settings)) {
        throw new Error("缺少有效的 settings 参数。");
      }
      return {version: 1, activeTab: "quick", quick: {settings: PE.normalize(raw.settings)}, curve: defaultCurveConfig()};
    }
    if (raw.version !== CONFIG_VERSION) throw new Error("不支持此参数文件版本。");
    if (!raw.quick || !raw.curve || !raw.quick.settings || !raw.curve.settings ||
        !raw.curve.doc || !Array.isArray(raw.curve.doc.paths))
      throw new Error("参数文件缺少完整的双页签数据");
    var quickRaw = raw.quick && typeof raw.quick === "object" ? raw.quick : {};
    var curveRaw = raw.curve && typeof raw.curve === "object" ? raw.curve : {};
    return {
      version: CONFIG_VERSION,
      activeTab: raw.activeTab === "curve" ? "curve" : "quick",
      quick: {settings: PE.normalize(quickRaw.settings)},
      curve: {
        settings: normalizeCurveSettings(curveRaw.settings),
        mode: curveRaw.mode === "move" ? "move" : "draw",
        doc: normalizeDoc(curveRaw.doc)
      }
    };
  }

  var api = {
    CONFIG_APP: CONFIG_APP,
    CONFIG_VERSION: CONFIG_VERSION,
    DEFAULT_SIMPLICITY: DEFAULT_SIMPLICITY,
    LIMITS: LIMITS,
    emptyDoc: emptyDoc,
    cloneDoc: cloneDoc,
    serializeDoc: serializeDoc,
    normalizeDoc: normalizeDoc,
    normalizeSegment: normalizeSegment,
    normalizeCurveSettings: normalizeCurveSettings,
    normalizeConfig: normalizeConfig,
    defaultCurveConfig: defaultCurveConfig,
    segmentsToPolyline: segmentsToPolyline,
    primitivesToSegments: primitivesToSegments,
    docHasGeometry: docHasGeometry,
    docPolylines: docPolylines,
    docSegments: docSegments,
    docStats: docStats,
    sanitizePointList: sanitizePointList,
    fitStroke: fitStroke,
    makeHandPath: makeHandPath,
    refitHandPaths: refitHandPaths,
    demoDoc: demoDoc,
    hasFitModule: function () { return !!CA; }
  };

  root.CurveEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
