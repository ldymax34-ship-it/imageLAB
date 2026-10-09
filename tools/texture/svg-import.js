/* 纹理间 · 曲线纹理 — safe local SVG geometry import.
 *
 * Browser-only: uses DOMParser, then rebuilds a *fresh* tree that contains
 * nothing but allowlisted SVG geometry elements and allowlisted geometry
 * attributes. No input markup, attributes or nodes are ever moved into the
 * page, and no scripts, event handlers, styles, filters, masks, clipping,
 * <use>/<image> or external references are accepted. The sanitized tree only
 * exists so the browser's own SVGGeometryElement sampling API can turn
 * arbitrary path commands (including C/S/Q/T/A) into polylines; nothing is
 * executed and no network resource is requested.
 *
 * Imported geometry is never run through curve-fit: it keeps its authored shape
 * (sampled only as finely as needed to stay visually exact).
 */
(function (root) {
  "use strict";

  var CE = root.CurveEngine;
  var SVG_NS = "http://www.w3.org/2000/svg";

  var MAX_SVG_BYTES = 2 * 1024 * 1024;
  var MAX_ELEMENTS = 4000;
  var MAX_POINTS_PER_ELEMENT = 4000;
  var DEVICE_STEP = 0.75;
  var VIEWPORT_MARGIN = 0; // logical units kept free around the imported artwork

  var GEOM_TAGS = {line: 1, polyline: 1, polygon: 1, rect: 1, circle: 1, ellipse: 1, path: 1};
  var SKIP_TAGS = {title: 1, desc: 1, metadata: 1, defs: 1};
  var BANNED_TAGS = {
    script: 1, foreignobject: 1, image: 1, use: 1, style: 1, animate: 1,
    animatetransform: 1, animatemotion: 1, set: 1, filter: 1, mask: 1,
    clippath: 1, pattern: 1, marker: 1, symbol: 1, text: 1, tspan: 1,
    textpath: 1, switch: 1, a: 1, view: 1, cursor: 1, font: 1, "font-face": 1,
    solidcolor: 1, iframe: 1, object: 1, embed: 1, video: 1, audio: 1,
    canvas: 1, link: 1, meta: 1
  };
  var BANNED_ATTRS = {
    filter: 1, mask: 1, "clip-path": 1, "marker-start": 1, "marker-mid": 1,
    "marker-end": 1, style: 1
  };

  function local(el) { return (el.localName || el.nodeName || "").toLowerCase(); }
  function fail(msg) { throw new Error(msg); }

  /* ------------------------------------------------------------- matrices */

  function ident() { return {a: 1, b: 0, c: 0, d: 1, e: 0, f: 0}; }
  function mul(m1, m2) {
    return {
      a: m1.a * m2.a + m1.c * m2.b,
      b: m1.b * m2.a + m1.d * m2.b,
      c: m1.a * m2.c + m1.c * m2.d,
      d: m1.b * m2.c + m1.d * m2.d,
      e: m1.a * m2.e + m1.c * m2.f + m1.e,
      f: m1.b * m2.e + m1.d * m2.f + m1.f
    };
  }
  function apply(m, p) { return [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f]; }
  function det(m) { return m.a * m.d - m.b * m.c; }
  function scaleOf(m) { return Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d), 1e-9); }
  function isSimilarity(m) {
    var c1 = m.a * m.a + m.b * m.b, c2 = m.c * m.c + m.d * m.d, dot = m.a * m.c + m.b * m.d;
    var mx = Math.max(c1, c2, 1e-12);
    return Math.abs(c1 - c2) <= 1e-6 * mx && Math.abs(dot) <= 1e-6 * mx && Math.abs(det(m)) > 1e-12;
  }

  function numbers(text) {
    var parts = String(text).trim().split(/[\s,]+/).filter(Boolean);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var v = Number(parts[i]);
      if (!Number.isFinite(v)) fail("SVG 含无效数字");
      out.push(v);
    }
    return out;
  }

  /* Parse a transform list into one matrix; rejects anything unsupported. */
  function parseTransform(text) {
    if (!text) return null;
    var m = ident();
    var re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g, last = 0, match;
    while ((match = re.exec(text))) {
      if (text.slice(last, match.index).replace(/[\s,]/g, "")) fail("SVG 含不支持的 transform 语法");
      last = re.lastIndex;
      var n = numbers(match[2]);
      var t;
      if (match[1] === "matrix") {
        if (n.length !== 6) fail("matrix() 需要 6 个参数");
        t = {a: n[0], b: n[1], c: n[2], d: n[3], e: n[4], f: n[5]};
      } else if (match[1] === "translate") {
        if (n.length < 1 || n.length > 2) fail("translate() 参数无效");
        t = {a: 1, b: 0, c: 0, d: 1, e: n[0], f: n.length > 1 ? n[1] : 0};
      } else if (match[1] === "scale") {
        if (n.length < 1 || n.length > 2) fail("scale() 参数无效");
        t = {a: n[0], b: 0, c: 0, d: n.length > 1 ? n[1] : n[0], e: 0, f: 0};
      } else if (match[1] === "rotate") {
        if (n.length !== 1 && n.length !== 3) fail("rotate() 参数无效");
        var r = n[0] * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
        var rot = {a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0};
        if (n.length === 3) t = mul(mul({a: 1, b: 0, c: 0, d: 1, e: n[1], f: n[2]}, rot), {a: 1, b: 0, c: 0, d: 1, e: -n[1], f: -n[2]});
        else t = rot;
      } else if (match[1] === "skewX") {
        if (n.length !== 1) fail("skewX() 参数无效");
        t = {a: 1, b: 0, c: Math.tan(n[0] * Math.PI / 180), d: 1, e: 0, f: 0};
      } else {
        if (n.length !== 1) fail("skewY() 参数无效");
        t = {a: 1, b: Math.tan(n[0] * Math.PI / 180), c: 0, d: 1, e: 0, f: 0};
      }
      m = mul(m, t);
    }
    if (text.slice(last).trim()) fail("SVG 含不支持的 transform 语法");
    return m;
  }

  /* ------------------------------------------------------------- threats */

  function scanThreats(rootNode) {
    var all = [rootNode].concat(Array.prototype.slice.call(rootNode.querySelectorAll("*")));
    if (all.length > MAX_ELEMENTS) fail("SVG 元素数量超过上限（" + MAX_ELEMENTS + "）");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var name = local(el);
      if (BANNED_TAGS[name]) fail("SVG 含不支持或可能不安全的内容：<" + name + ">");
      var attrs = el.attributes || [];
      for (var a = 0; a < attrs.length; a++) {
        var attrName = String(attrs[a].name || "").toLowerCase();
        var value = String(attrs[a].value || "");
        if (attrName.indexOf("on") === 0) fail("SVG 含事件处理属性：" + attrs[a].name);
        if (BANNED_ATTRS[attrName]) fail("SVG 含不支持的属性：" + attrs[a].name);
        if (attrName === "href" || attrName.slice(-5) === ":href") fail("SVG 含外部资源引用 href，已拒绝");
        if (/javascript:/i.test(value)) fail("SVG 含 javascript: 内容，已拒绝");
        var urls = value.match(/url\s*\([^)]*\)/gi);
        if (urls) {
          for (var u = 0; u < urls.length; u++) {
            if (!/^url\(\s*#[A-Za-z_][\w.\-]*\s*\)$/i.test(urls[u])) fail("SVG 含外部资源引用 url(...)，已拒绝");
          }
        }
      }
    }
  }

  /* --------------------------------------------------------- sanitizing */

  function numAttr(el, name, fallback) {
    var raw = el.getAttribute(name);
    if (raw === null || raw === "") return fallback;
    var v = Number(raw);
    if (!Number.isFinite(v)) fail("属性 " + name + " 不是有效数字");
    return v;
  }

  function parsePointsAttr(el) {
    var raw = el.getAttribute("points");
    if (raw === null || raw === "") return [];
    var nums = numbers(raw.replace(/[,\s]+/g, " "));
    if (nums.length % 2 !== 0 || nums.length < 2) fail("points 属性无效");
    var pts = [];
    for (var i = 0; i < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    return pts;
  }

  var PATH_DATA_RE = /^[\s\d.,+\-eEMmLlHhVvCcSsQqTtAaZz]*$/;
  function validatePathData(raw) {
    if (typeof raw !== "string" || !raw.trim()) fail("path 缺少 d 属性");
    if (raw.length > 200000) fail("path 数据超过上限");
    if (!PATH_DATA_RE.test(raw)) fail("path 的 d 属性含不允许的字符");
    if (!/[MmLlHhVvCcSsQqTtAaZz]/.test(raw)) fail("path 的 d 属性缺少路径命令");
  }

  /* Rebuild a sanitized copy containing only geometry + allowlisted attrs.
   * Fresh elements are created in the live document; no input node or attribute
   * is ever moved across. */
  function sanitizeTree(orig, matrixMap, warnings, state) {
    var name = local(orig);
    if (SKIP_TAGS[name]) return null;
    if (BANNED_TAGS[name]) return null; // already rejected by scanThreats
    var transform = orig.getAttribute && orig.getAttribute("transform");
    var localMatrix = transform ? parseTransform(transform) : null;

    if (name === "svg" || name === "g") {
      if (name === "svg" && orig.ownerDocument.documentElement !== orig) fail("暂不支持嵌套 SVG 视口，请先展开为普通分组");
      var group = document.createElementNS(SVG_NS, name);
      if (localMatrix) matrixMap.set(group, localMatrix);
      var children = orig.childNodes || [];
      for (var i = 0; i < children.length; i++) {
        if (children[i].nodeType !== 1) continue;
        var kid = sanitizeTree(children[i], matrixMap, warnings, state);
        if (kid) group.appendChild(kid);
      }
      return group;
    }
    if (GEOM_TAGS[name]) {
      if (++state.count > MAX_ELEMENTS) fail("SVG 几何元素数量超过上限");
      var el = document.createElementNS(SVG_NS, name);
      var keys;
      if (name === "path") {
        var d = orig.getAttribute("d");
        validatePathData(d);
        el.setAttribute("d", d);
      } else if (name === "polyline" || name === "polygon") {
        var pts = parsePointsAttr(orig);
        el.setAttribute("points", pts.map(function (p) { return p[0] + "," + p[1]; }).join(" "));
      } else if (name === "rect") {
        keys = ["x", "y", "width", "height", "rx", "ry"];
        for (var r = 0; r < keys.length; r++) {
          var rv = orig.getAttribute(keys[r]);
          if (rv !== null && rv !== "") {
            if (!Number.isFinite(Number(rv))) fail("rect 的 " + keys[r] + " 不是有效数字");
            el.setAttribute(keys[r], rv);
          }
        }
      } else if (name === "circle") {
        keys = ["cx", "cy", "r"];
        for (var c = 0; c < keys.length; c++) if (orig.hasAttribute(keys[c])) el.setAttribute(keys[c], orig.getAttribute(keys[c]));
      } else if (name === "ellipse") {
        keys = ["cx", "cy", "rx", "ry"];
        for (var e = 0; e < keys.length; e++) if (orig.hasAttribute(keys[e])) el.setAttribute(keys[e], orig.getAttribute(keys[e]));
      } else if (name === "line") {
        keys = ["x1", "y1", "x2", "y2"];
        for (var l = 0; l < keys.length; l++) if (orig.hasAttribute(keys[l])) el.setAttribute(keys[l], orig.getAttribute(keys[l]));
      }
      if (localMatrix) matrixMap.set(el, localMatrix);
      return el;
    }
    warnings.push("已跳过不支持的元素 <" + name + ">");
    return null;
  }

  /* ------------------------------------------------------- geometry build */

  function dedupePts(pts) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > 1e-6) out.push(p);
    }
    return out;
  }

  /* Remove only exactly-collinear interior points; this preserves geometry. */
  function removeCollinear(pts) {
    var p = dedupePts(pts);
    if (p.length <= 2) return p;
    var out = [p[0]];
    for (var i = 1; i < p.length - 1; i++) {
      var a = out[out.length - 1], b = p[i], c = p[i + 1];
      var cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      var dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
      var base = Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1]);
      if (Math.abs(cross) <= 1e-6 * Math.max(base, 1) && dot >= 0) continue;
      out.push(b);
    }
    out.push(p[p.length - 1]);
    return out;
  }

  function pointsToSegments(pts, closed) {
    var p = removeCollinear(pts);
    var segs = [];
    for (var i = 1; i < p.length; i++) {
      if (Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) > 1e-9) {
        segs.push({kind: "line", p0: p[i - 1].slice(), p1: p[i].slice()});
      }
    }
    if (closed && p.length > 2) {
      var a = p[p.length - 1], b = p[0];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-9) segs.push({kind: "line", p0: a.slice(), p1: b.slice()});
    }
    return {closed: !!closed, segments: segs};
  }

  function transformArc(seg, m) {
    var s = Math.sqrt(Math.abs(det(m)));
    return {
      kind: "arc", p0: apply(m, seg.p0), p1: apply(m, seg.p1), center: apply(m, seg.center),
      r: seg.r * s, sweep: seg.sweep * (det(m) > 0 ? 1 : -1)
    };
  }

  function subpathFromPoints(localPts, closed, m, budget) {
    var pts = [];
    for (var i = 0; i < localPts.length; i++) pts.push(apply(m, localPts[i]));
    if (pts.length > budget.limit) fail("SVG 采样点超过单元素上限");
    budget.points += pts.length;
    if (budget.points > budget.limit) fail("SVG 采样点总数超过上限，请简化图形后再导入");
    var sub = pointsToSegments(pts, closed);
    return sub.segments.length ? sub : null;
  }

  function subpathFromLocalArcs(localArcs, m, budget) {
    if (isSimilarity(m)) {
      var segs = [];
      for (var i = 0; i < localArcs.length; i++) segs.push(transformArc(localArcs[i], m));
      budget.points += segs.length * 2;
      if (budget.points > budget.limit) fail("SVG 采样点总数超过上限，请简化图形后再导入");
      return {closed: true, segments: segs};
    }
    var flat = CE.segmentsToPolyline(localArcs, true);
    return subpathFromPoints(flat.slice(0, flat.length - 1), true, m, budget);
  }

  function samplePathElement(el, m, budget) {
    if (typeof el.getTotalLength !== "function" || typeof el.getPointAtLength !== "function") {
      fail("当前浏览器无法安全采样 SVG 路径");
    }
    if (!root.SvgPathData) fail("SVG 路径语法模块未加载");
    var definitions = root.SvgPathData.splitPathData(el.getAttribute("d"));
    var paths = [];
    definitions.forEach(function (definition) {
      var part = document.createElementNS(SVG_NS, "path");
      part.setAttribute("d", definition.d);
      paths.push.apply(paths, sampleSinglePath(part, m, budget));
    });
    return paths;
  }

  function sampleSinglePath(el, m, budget) {
    var length;
    try { length = el.getTotalLength(); } catch (err) { fail("无法读取 SVG 路径长度"); }
    if (!(length > 0)) return [];
    var scale = scaleOf(m);
    var count = Math.max(2, Math.ceil(length / (DEVICE_STEP / scale)));
    if (count > MAX_POINTS_PER_ELEMENT) fail("SVG 单条子路径过长，请缩小或简化后再导入");
    if (budget.points + count + 1 > budget.limit) fail("SVG 采样点总数超过上限，请简化图形后再导入");
    budget.points += count + 1;
    var sub = [];
    for (var i = 0; i <= count; i++) {
      var pt;
      try { pt = el.getPointAtLength(length * i / count); } catch (err) { pt = null; }
      if (!pt) continue;
      var p = apply(m, [pt.x, pt.y]);
      sub.push(p);
    }
    return sub.length > 1 ? [sub] : [];
  }

  function ellipseLocalPoints(cx, cy, rx, ry, m) {
    var scale = scaleOf(m);
    var perim = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    var count = Math.max(24, Math.min(MAX_POINTS_PER_ELEMENT, Math.ceil(perim / (DEVICE_STEP / scale))));
    var pts = [];
    for (var i = 0; i < count; i++) {
      var a = Math.PI * 2 * i / count;
      pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    return pts;
  }

  function rectLocalPoints(x, y, w, h, rx, ry) {
    if (!(w > 0) || !(h > 0)) return [];
    if (!(rx > 0) && !(ry > 0)) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    rx = Math.min(rx > 0 ? rx : ry, w / 2);
    ry = Math.min(ry > 0 ? ry : rx, h / 2);
    var pts = [[x + rx, y], [x + w - rx, y]];
    var corners = [
      [x + w - rx, y + ry, -Math.PI / 2, 0],
      [x + w - rx, y + h - ry, 0, Math.PI / 2],
      [x + rx, y + h - ry, Math.PI / 2, Math.PI],
      [x + rx, y + ry, Math.PI, Math.PI * 1.5]
    ];
    for (var c = 0; c < corners.length; c++) {
      var q = corners[c];
      for (var s = 0; s <= 8; s++) {
        var a = q[2] + (q[3] - q[2]) * s / 8;
        pts.push([q[0] + rx * Math.cos(a), q[1] + ry * Math.sin(a)]);
      }
    }
    return pts;
  }

  function elementSubpaths(name, el, m, budget) {
    var out = [];
    if (name === "line") {
      var p = subpathFromPoints([[numAttr(el, "x1", 0), numAttr(el, "y1", 0)], [numAttr(el, "x2", 0), numAttr(el, "y2", 0)]], false, m, budget);
      if (p) out.push(p);
      return out;
    }
    if (name === "polyline" || name === "polygon") {
      var pts = parsePointsAttr(el);
      if (pts.length >= 2) {
        var sp = subpathFromPoints(pts, name === "polygon", m, budget);
        if (sp) out.push(sp);
      }
      return out;
    }
    if (name === "rect") {
      var x = numAttr(el, "x", 0), y = numAttr(el, "y", 0);
      var w = numAttr(el, "width", 0), h = numAttr(el, "height", 0);
      var rx = numAttr(el, "rx", NaN), ry = numAttr(el, "ry", NaN);
      if (!Number.isFinite(rx)) rx = Number.isFinite(ry) ? ry : 0;
      if (!Number.isFinite(ry)) ry = rx;
      var rp = rectLocalPoints(x, y, w, h, rx, ry);
      if (rp.length >= 2) {
        var rs = subpathFromPoints(rp, true, m, budget);
        if (rs) out.push(rs);
      }
      return out;
    }
    if (name === "circle") {
      var cx = numAttr(el, "cx", 0), cy = numAttr(el, "cy", 0), rad = numAttr(el, "r", 0);
      if (!(rad > 0)) return out;
      if (isSimilarity(m)) {
        var a0 = [cx + rad, cy], a1 = [cx - rad, cy];
        out.push(subpathFromLocalArcs([
          {kind: "arc", p0: a0, p1: a1, center: [cx, cy], r: rad, sweep: Math.PI},
          {kind: "arc", p0: a1, p1: a0, center: [cx, cy], r: rad, sweep: Math.PI}
        ], m, budget));
      } else {
        var cp = subpathFromPoints(ellipseLocalPoints(cx, cy, rad, rad, m), true, m, budget);
        if (cp) out.push(cp);
      }
      return out;
    }
    if (name === "ellipse") {
      var ex = numAttr(el, "cx", 0), ey = numAttr(el, "cy", 0);
      var erx = numAttr(el, "rx", 0), ery = numAttr(el, "ry", 0);
      if (!(erx > 0) || !(ery > 0)) fail("ellipse 的 rx/ry 无效");
      var ep = subpathFromPoints(ellipseLocalPoints(ex, ey, erx, ery, m), true, m, budget);
      if (ep) out.push(ep);
      return out;
    }
    if (name === "path") {
      var subs = samplePathElement(el, m, budget);
      for (var i = 0; i < subs.length; i++) {
        var raw = subs[i];
        var closed = raw.length > 2 && Math.hypot(raw[0][0] - raw[raw.length - 1][0], raw[0][1] - raw[raw.length - 1][1]) < 1e-3;
        var body = closed ? raw.slice(0, raw.length - 1) : raw;
        var seg = pointsToSegments(body, closed);
        if (seg.segments.length) out.push(seg);
      }
      return out;
    }
    return out;
  }

  /* --------------------------------------------------------- viewport */

  function parseViewBox(text) {
    if (!text) return null;
    var n = numbers(text.replace(/[,\s]+/g, " "));
    if (n.length !== 4 || !(n[2] > 0) || !(n[3] > 0)) return null;
    return {x: n[0], y: n[1], width: n[2], height: n[3]};
  }

  function parsePAR(text) {
    var par = {alignX: "xMid", alignY: "YMid", slice: false, none: false};
    if (!text) return par;
    var tokens = String(text).trim().split(/\s+/);
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t === "defer") continue;
      if (t === "meet") par.slice = false;
      else if (t === "slice") par.slice = true;
      else if (t === "none") par.none = true;
      else if (/^x(Min|Mid|Max)Y(Min|Mid|Max)$/.test(t)) {
        par.alignX = t.slice(0, 4);
        par.alignY = "Y" + t.slice(5);
      }
    }
    return par;
  }

  function viewportMatrix(vb, cw, ch, par) {
    if (!vb) return ident();
    var sx = cw / vb.width, sy = ch / vb.height;
    if (par.none) return {a: sx, b: 0, c: 0, d: sy, e: -vb.x * sx, f: -vb.y * sy};
    var s = par.slice ? Math.max(sx, sy) : Math.min(sx, sy);
    var ax = par.alignX === "xMin" ? 0 : par.alignX === "xMax" ? cw - vb.width * s : (cw - vb.width * s) / 2;
    var ay = par.alignY === "YMin" ? 0 : par.alignY === "YMax" ? ch - vb.height * s : (ch - vb.height * s) / 2;
    return {a: s, b: 0, c: 0, d: s, e: ax - vb.x * s, f: ay - vb.y * s};
  }

  function contentFitMatrix(bounds, cw, ch) {
    if (!bounds || !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) return ident();
    var bw = bounds.maxX - bounds.minX, bh = bounds.maxY - bounds.minY;
    var s = Math.min(bw > 0 ? (cw - 2 * VIEWPORT_MARGIN) / bw : Infinity,
      bh > 0 ? (ch - 2 * VIEWPORT_MARGIN) / bh : Infinity);
    if (!(s > 0) || !Number.isFinite(s)) s = 1;
    var tx = (cw - bw * s) / 2, ty = (ch - bh * s) / 2;
    return {a: s, b: 0, c: 0, d: s, e: tx - bounds.minX * s, f: ty - bounds.minY * s};
  }

  /* ------------------------------------------------------------- public */

  function withContainer(fn) {
    var container = document.getElementById("svg-sanitize");
    var created = false;
    if (!container) {
      container = document.createElement("div");
      container.id = "svg-sanitize";
      container.setAttribute("aria-hidden", "true");
      document.body.appendChild(container);
      created = true;
    }
    container.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;";
    try { return fn(container); } finally {
      container.textContent = "";
      if (created) container.remove();
    }
  }

  function parseSvgText(text, options) {
    options = options || {};
    if (typeof text !== "string" || !text.trim()) fail("SVG 文件为空");
    if (text.length > MAX_SVG_BYTES) fail("SVG 文件超过 " + Math.round(MAX_SVG_BYTES / 1024) + " KB 上限");
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) fail("SVG 含 DTD / 实体声明，已拒绝");
    if (typeof DOMParser !== "function") fail("当前环境不支持安全的 SVG 解析");
    if (!CE) fail("曲线引擎未加载");

    var canvasW = Math.max(1, Number(options.width) || 1200);
    var canvasH = Math.max(1, Number(options.height) || 800);

    var parsed;
    try { parsed = new DOMParser().parseFromString(text, "image/svg+xml"); }
    catch (err) { fail("SVG 解析失败，文件可能已损坏"); }
    var rootEl = parsed && parsed.documentElement;
    if (!rootEl) fail("SVG 解析失败，文件可能已损坏");
    if (local(rootEl) === "parsererror" || (parsed.getElementsByTagName && parsed.getElementsByTagName("parsererror").length)) {
      fail("SVG 解析失败，文件结构不完整");
    }
    if (local(rootEl) !== "svg") fail("根元素不是 <svg>");

    scanThreats(rootEl);

    var warnings = [];
    var matrixMap = new WeakMap();
    var state = {count: 0};
    var sanitizedRoot = sanitizeTree(rootEl, matrixMap, warnings, state);
    if (!sanitizedRoot) fail("SVG 中没有可导入的几何图形");

    var viewBox = parseViewBox(rootEl.getAttribute("viewBox"));
    var par = parsePAR(rootEl.getAttribute("preserveAspectRatio"));
    var hasViewport = !!viewBox;
    if (!hasViewport) {
      var wAttr = Number(rootEl.getAttribute("width"));
      var hAttr = Number(rootEl.getAttribute("height"));
      if (Number.isFinite(wAttr) && wAttr > 0 && Number.isFinite(hAttr) && hAttr > 0) {
        viewBox = {x: 0, y: 0, width: wAttr, height: hAttr};
        hasViewport = true;
      }
    }
    if (par.slice) {
      warnings.push("preserveAspectRatio 使用 slice，已按 meet 处理以避免裁切。");
      par.slice = false;
    }

    var rootMatrix = hasViewport ? viewportMatrix(viewBox, canvasW, canvasH, par) : ident();
    var rootTransform = matrixMap.get(sanitizedRoot);
    if (rootTransform) rootMatrix = mul(rootMatrix, rootTransform);
    var budget = {points: 0, limit: CE.LIMITS.MAX_TOTAL_POLYLINE_POINTS};

    var elements = [];
    withContainer(function (container) {
      container.appendChild(sanitizedRoot);
      var children = sanitizedRoot.childNodes;
      for (var i = 0; i < children.length; i++) {
        if (children[i].nodeType !== 1) continue;
        collectElement(children[i], rootMatrix, matrixMap, elements, budget, warnings);
      }
    });

    if (!elements.length || !elements.some(function (item) { return item.subpaths.length; })) {
      fail("SVG 中没有可导入的几何图形");
    }

    if (!hasViewport) {
      var b = {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity};
      elements.forEach(function (item) {
        item.subpaths.forEach(function (sp) {
          sp.segments.forEach(function (seg) {
            CE.segmentsToPolyline([seg], false).forEach(function (pt) {
              if (pt[0] < b.minX) b.minX = pt[0];
              if (pt[1] < b.minY) b.minY = pt[1];
              if (pt[0] > b.maxX) b.maxX = pt[0];
              if (pt[1] > b.maxY) b.maxY = pt[1];
            });
          });
        });
      });
      var fit = contentFitMatrix(b, canvasW, canvasH);
      elements.forEach(function (item) {
        item.subpaths = item.subpaths.map(function (sp) { return remapSubpath(sp, fit); }).filter(Boolean);
      });
      warnings.push("SVG 没有 viewBox，已按内容范围居中适配画布。");
    }

    var stamp = Date.now().toString(36);
    var records = [];
    elements.forEach(function (item, index) {
      var subs = item.subpaths.filter(function (sp) { return sp.segments.length; });
      if (!subs.length) return;
      records.push({
        id: "svg-" + stamp + "-" + index,
        source: "import",
        label: "SVG " + item.name + (item.subpaths.length > 1 ? " · " + item.subpaths.length + " 子路径" : ""),
        subpaths: subs
      });
    });

    var doc;
    try { doc = CE.normalizeDoc({paths: records}); }
    catch (err) { fail("SVG 几何超出限制：" + (err && err.message ? err.message : "未知错误")); }

    return {
      paths: doc.paths,
      warnings: warnings,
      viewBox: viewBox,
      stats: CE.docStats(doc)
    };
  }

  function collectElement(node, parentMatrix, matrixMap, elements, budget, warnings) {
    var name = local(node);
    var m = parentMatrix;
    var localM = matrixMap.get(node);
    if (localM) m = mul(parentMatrix, localM);
    if (name === "g" || name === "svg") {
      var kids = node.childNodes;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].nodeType !== 1) continue;
        collectElement(kids[i], m, matrixMap, elements, budget, warnings);
      }
      return;
    }
    if (!GEOM_TAGS[name]) return;
    var subpaths = elementSubpaths(name, node, m, budget);
    if (subpaths.length) elements.push({name: name, subpaths: subpaths});
  }

  function remapSubpath(sp, m) {
    if (!sp.segments.length) return null;
    if (isSimilarity(m) && sp.segments.every(function (s) { return s.kind === "arc"; })) {
      return {closed: sp.closed, segments: sp.segments.map(function (s) { return transformArc(s, m); })};
    }
    var pts = [];
    sp.segments.forEach(function (seg) {
      if (!pts.length) pts.push(seg.p0.slice());
      if (seg.kind === "line") pts.push(seg.p1.slice());
      else {
        var flat = CE.segmentsToPolyline([seg], false);
        for (var i = 1; i < flat.length; i++) pts.push(flat[i]);
      }
    });
    var out = pointsToSegments(pts.map(function (p) { return apply(m, p); }), sp.closed);
    return out.segments.length ? out : null;
  }

  var api = {
    MAX_SVG_BYTES: MAX_SVG_BYTES,
    MAX_ELEMENTS: MAX_ELEMENTS,
    parseSvgText: parseSvgText,
    parseTransform: parseTransform,
    parseViewBox: parseViewBox,
    parsePAR: parsePAR,
    viewportMatrix: viewportMatrix
  };

  root.SvgImport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
