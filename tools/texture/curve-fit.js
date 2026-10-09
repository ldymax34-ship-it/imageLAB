/* ============================================================================
 * Curvature Axis v2 — simplicity-prior curve interpreter
 * ----------------------------------------------------------------------------
 * Pure math, no DOM. Exposes `window.CA.fit` in the browser and
 * `module.exports` in Node (used by test/geometry-fit.test.js).
 *
 * WHAT THIS IS
 * ------------
 * A rough freehand gesture is interpreted as a STANDARD GEOMETRIC CURVE built
 * by cutting the stroke into a very small number of smooth runs and describing
 * every run with exact straight lines and circular arcs whose internal
 * junctions are tangent (G1). It is deliberately NOT a faithful tracer and NOT
 * a generic spline smoother: it will happily depart from the raw gesture in
 * order to stay simple and geometrically clean.
 *
 * Only semantic intent survives: the two endpoints, any obvious sharp
 * peak/cusp, the general rise/fall and the broad proportions.
 *
 * THE PIPELINE
 * ------------
 *   pointer samples
 *     -> dedupe
 *     -> distance resampling              (evenly spaced points)
 *     -> heavy smoothing                  (windowed average, endpoints pinned)
 *     -> high-confidence cusp detection   (mandatory cut points only)
 *     -> per-run simplicity-prior fitting  (line / arc / biarc / tiny chain)
 *     -> tangent-merge pass               (drop cuts that turned out tangent)
 *     -> junction tangency report
 *
 * THE OBJECTIVE
 * -------------
 * For every smooth run a whole family of descriptions is built — one line, one
 * arc, a tangent biarc (two arcs, or line+arc / arc+line), and a few tiny
 * three- and four-primitive chains — and every candidate is scored with
 *
 *   cost = wCount   * primitiveCount
 *        + (maxDeviation / errorBudget)^2
 *        + wTangent * internalTangentMismatchDeg / 90
 *        + wRadius  * smallRadiusPenalty
 *
 * Primitive count is the dominant term and the error term is quadratic, so a
 * small departure is nearly free while a large one is punished decisively: the
 * result may exceed a per-point tolerance whenever the simpler description is
 * good enough. `errorBudget` grows with the Simplicity control; at zero
 * Simplicity it is a strict few pixels and the fitter becomes faithful again.
 *
 * Internal junctions are tangent BY CONSTRUCTION: the biarc family is closed
 * form (joint tangent chosen, chord lengths solved), and a chain split recovers
 * G1 by handing the left primitive's end tangent to the right chain as its
 * start tangent. Only cusp junctions are allowed to be non-tangent, and the
 * measured mismatch is always reported.
 * ==========================================================================*/
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var DEG = 180 / Math.PI;
  var RAD = Math.PI / 180;

  var DEFAULTS = {
    resampleSpacing: 3,        // px between resampled points
    smoothRadius: 2,           // heavy smoothing half-window, in samples
    smoothIterations: 3,       // heavy smoothing passes
    simplicity: 0.6,           // dominant control: 0 faithful .. 1 simplest
    cornerSensitivity: 0.5,    // 0 only the sharpest cusps .. 1 more eager
    minRadius: 24,             // px smallest admissible arc radius (hard gate)
    tangencyDeg: 8,            // junction mismatch below this reads as G1
    maxPrimitivesPerRun: 4,    // hard ceiling per smooth run
    cuspWindowPx: 10,          // turning-angle window, in px
    countWeight: 1,
    tangentWeight: 1.1,
    radiusWeight: 0.7,
    lengthSanity: 1.9,         // a chain may not be much longer than the run
    straightSagittaPx: 3.5      // an arc that bows less than this is emitted as a line
  };

  /* ---------------------------------------------------------------- basics */

  function clamp(v, lo, hi) {
    if (!isFinite(v)) v = lo;   // a missing/NaN control falls back to its floor
    return v < lo ? lo : v > hi ? hi : v;
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function copyPt(p) { return { x: p.x, y: p.y }; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isPt(p) { return !!p && isNum(p.x) && isNum(p.y); }

  function wrapPi(a) {
    a = (a + Math.PI) % TAU;
    if (a < 0) a += TAU;
    return a - Math.PI;
  }

  function unit(v) {
    var l = Math.hypot(v.x, v.y);
    return l > 1e-12 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 };
  }

  /* Standard rotation matrix. Our angles come from atan2 in the same y-down
   * space the board draws in, so a positive angle is clockwise on screen; the
   * algebra below is self-consistent either way. */
  function rot(v, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
  }

  function angleOf(v) { return Math.atan2(v.y, v.x); }
  function signedAngle(a, b) { return wrapPi(angleOf(b) - angleOf(a)); }

  function dedupe(points, eps) {
    eps = eps == null ? 0.01 : eps;
    var out = [];
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (!isPt(p)) continue;
      if (out.length && dist(out[out.length - 1], p) < eps) continue;
      out.push({ x: p.x, y: p.y });
    }
    return out;
  }

  function polylineLength(points) {
    var total = 0;
    for (var i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
    return total;
  }

  function boundsOf(points) {
    if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (p.x < b.minX) b.minX = p.x;
      if (p.y < b.minY) b.minY = p.y;
      if (p.x > b.maxX) b.maxX = p.x;
      if (p.y > b.maxY) b.maxY = p.y;
    }
    b.width = b.maxX - b.minX;
    b.height = b.maxY - b.minY;
    return b;
  }

  function fitToBox(points, box, margin) {
    margin = margin == null ? 60 : margin;
    var b = boundsOf(points);
    if (b.width < 1e-6 && b.height < 1e-6) return points.map(copyPt);
    var sx = (box.width - 2 * margin) / Math.max(b.width, 1e-6);
    var sy = (box.height - 2 * margin) / Math.max(b.height, 1e-6);
    var s = Math.min(sx, sy);
    var cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    var tx = box.x + box.width / 2, ty = box.y + box.height / 2;
    return points.map(function (p) {
      return { x: tx + (p.x - cx) * s, y: ty + (p.y - cy) * s };
    });
  }

  /* ------------------------------------------------- 1. distance resample */

  function resample(points, spacing) {
    if (points.length < 2) return points.map(copyPt);
    if (!(spacing > 0)) spacing = 1;

    var out = [copyPt(points[0])];
    var prev = copyPt(points[0]);
    var carried = 0;
    var i = 1;

    while (i < points.length) {
      var p = points[i];
      var seg = dist(prev, p);
      if (seg <= 1e-9) { prev = copyPt(p); i++; continue; }

      if (carried + seg >= spacing) {
        var t = (spacing - carried) / seg;
        var np = { x: prev.x + (p.x - prev.x) * t, y: prev.y + (p.y - prev.y) * t };
        if (dist(out[out.length - 1], np) > 1e-6) out.push(np);
        prev = np;
        carried = 0;
      } else {
        carried += seg;
        prev = copyPt(p);
        i++;
      }
    }

    var last = points[points.length - 1];
    if (dist(out[out.length - 1], last) > 1e-6) out.push(copyPt(last));
    return out;
  }

  /* --------------------------------------------------------- 2. smoothing */

  /* Triangular weighted moving average over +/-k samples. Endpoints are pinned
   * so a stroke keeps its exact ends. Run several passes: the interpreter wants
   * a *heavy* smooth because it is going to simplify aggressively anyway. */
  function smooth(points, k, iterations) {
    var n = points.length;
    var cur = points.map(copyPt);
    k = Math.round(k || 0);
    if (n < 3 || k < 1) return cur;
    var iters = Math.max(1, iterations || 1);

    for (var it = 0; it < iters; it++) {
      var src = cur;
      var next = src.map(copyPt);
      for (var i = 1; i < n - 1; i++) {
        var sx = 0, sy = 0, w = 0;
        for (var j = -k; j <= k; j++) {
          var idx = clamp(i + j, 0, n - 1);
          var ww = 1 - Math.abs(j) / (k + 1);
          sx += src[idx].x * ww;
          sy += src[idx].y * ww;
          w += ww;
        }
        next[i] = { x: sx / w, y: sy / w };
      }
      cur = next;
    }
    return cur;
  }

  /* ------------------------------------------------ 3. cusp detection */

  function tangentWindow(spacing) {
    return clamp(Math.round(14 / (spacing || DEFAULTS.resampleSpacing)), 2, 8);
  }

  function turningAngles(points, w) {
    var n = points.length;
    var out = new Array(n);
    for (var i = 0; i < n; i++) {
      var a = points[clamp(i - w, 0, n - 1)];
      var b = points[i];
      var c = points[clamp(i + w, 0, n - 1)];
      var v1x = b.x - a.x, v1y = b.y - a.y;
      var v2x = c.x - b.x, v2y = c.y - b.y;
      var l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
      if (l1 < 1e-9 || l2 < 1e-9) { out[i] = 0; continue; }
      var cosv = (v1x * v2x + v1y * v2y) / (l1 * l2);
      out[i] = Math.acos(clamp(cosv, -1, 1));
    }
    return out;
  }

  /* Only high-confidence cusps survive. A sample is a cusp when
   *   - its turning angle (measured over a fixed px window) clears the
   *     sensitivity threshold, and
   *   - it stands well above the median turning in a wider neighbourhood.
   *
   * The second test is what separates a cusp from a tight arc: a constant
   * radius spreads its turn evenly, so peak and neighbourhood average are the
   * same number, while a cusp concentrates the whole turn into a short bump.
   * Non-maximum suppression keeps one cut per cusp. */
  function detectCusps(points, options) {
    var n = points.length;
    if (n < 5) return [];

    var o = options || {};
    var spacing = o.resampleSpacing == null ? DEFAULTS.resampleSpacing : o.resampleSpacing;
    var w = clamp(Math.round((o.cuspWindowPx == null ? DEFAULTS.cuspWindowPx : o.cuspWindowPx) / (spacing || 1)), 2, 8);
    var ang = turningAngles(points, w);

    var sens = clamp(o.cornerSensitivity == null ? DEFAULTS.cornerSensitivity : o.cornerSensitivity, 0, 1);
    var thresh = (32 - 24 * sens) * RAD;   // 32 deg calm .. 8 deg eager
    var ratio = 2.6 - 1.2 * sens;          // 2.6 calm .. 1.4 eager vs local average
    var nb = w * 3;
    var minSep = Math.max(2, w);

    var cand = [];
    var margin = 2 * w;   // cusps are interior features; the ends are cuts anyway
    for (var i = 1 + margin; i < n - 1 - margin; i++) {
      var a = ang[i];
      if (a < thresh) continue;

      var vals = [];
      for (var j = i - nb; j <= i + nb; j++) {
        if (Math.abs(j - i) <= w) continue;
        vals.push(ang[clamp(j, 0, n - 1)]);
      }
      if (!vals.length) continue;
      vals.sort(function (x, y) { return x - y; });
      var base = vals[Math.floor(vals.length / 2)];
      if (a < base * ratio && a < 100 * RAD) continue;

      cand.push({ i: i, a: a });
    }

    cand.sort(function (x, y) { return y.a - x.a; });
    var chosen = [];
    for (var c = 0; c < cand.length; c++) {
      var dup = false;
      for (var q = 0; q < chosen.length; q++) {
        if (Math.abs(chosen[q].i - cand[c].i) < minSep) { dup = true; break; }
      }
      if (!dup) chosen.push(cand[c]);
    }

    // Consolidate: a single sharp corner smeared by the smoother can leave two
    // nearby local maxima. Keep the stronger one so one corner yields one cut
    // and no tiny fragment gets trapped between the pair.
    var minRun = Math.max(5, 3 * w);
    var stable = false;
    while (!stable) {
      stable = true;
      chosen.sort(function (x, y) { return x.i - y.i; });
      for (var z = 0; z < chosen.length - 1; z++) {
        if (chosen[z + 1].i - chosen[z].i < minRun) {
          if (chosen[z + 1].a > chosen[z].a) chosen.splice(z, 1);
          else chosen.splice(z + 1, 1);
          stable = false;
          break;
        }
      }
    }

    return chosen.map(function (x) { return x.i; }).sort(function (x, y) { return x - y; });
  }

  /* ---------------------------------------------------------- tangents */

  function tangentAt(P, i, dir, k) {
    var n = P.length;
    var j = clamp(i + dir * k, 0, n - 1);
    if (j === i) return { x: 1, y: 0 };
    var v = dir > 0
      ? { x: P[j].x - P[i].x, y: P[j].y - P[i].y }
      : { x: P[i].x - P[j].x, y: P[i].y - P[j].y };
    return unit(v);
  }

  /* Signed net turning of a run: sum of per-step chord direction changes, so
   * windings are counted rather than wrapped away. */
  function netTurning(P, a, b) {
    if (b - a < 2) return 0;
    var total = 0;
    var prev = angleOf({ x: P[a + 1].x - P[a].x, y: P[a + 1].y - P[a].y });
    for (var i = a + 1; i < b; i++) {
      var cur = angleOf({ x: P[i + 1].x - P[i].x, y: P[i + 1].y - P[i].y });
      total += wrapPi(cur - prev);
      prev = cur;
    }
    return total;
  }

  function tangentsOf(prim) {
    if (prim.kind === 'line') {
      var d = unit({ x: prim.p1.x - prim.p0.x, y: prim.p1.y - prim.p0.y });
      return { start: d, end: d };
    }
    var s = prim.sweep > 0 ? 1 : -1;
    function tangentAtAngle(th) { return { x: -s * Math.sin(th), y: s * Math.cos(th) }; }
    return {
      start: tangentAtAngle(prim.startAngle),
      end: tangentAtAngle(prim.startAngle + prim.sweep)
    };
  }

  function angleBetween(a, b) {
    var d = clamp(a.x * b.x + a.y * b.y, -1, 1);
    return Math.acos(d) * DEG;
  }

  /* ------------------------------------------------------- circle fitting */

  function solve3(M) {
    for (var col = 0; col < 3; col++) {
      var piv = col;
      for (var r = col + 1; r < 3; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      }
      if (Math.abs(M[piv][col]) < 1e-12) return null;
      if (piv !== col) { var tmp = M[piv]; M[piv] = M[col]; M[col] = tmp; }
      for (var r2 = 0; r2 < 3; r2++) {
        if (r2 === col) continue;
        var f = M[r2][col] / M[col][col];
        if (!f) continue;
        for (var c2 = col; c2 < 4; c2++) M[r2][c2] -= f * M[col][c2];
      }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  /* Algebraic (Kasa) circle fit on centroid-centred points. */
  function fitCircle(pts) {
    var n = pts.length;
    if (n < 3) return null;

    var cx = 0, cy = 0, i;
    for (i = 0; i < n; i++) { cx += pts[i].x; cy += pts[i].y; }
    cx /= n; cy /= n;

    var Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0;
    var Sux = 0, Suy = 0, Su = 0;
    for (i = 0; i < n; i++) {
      var x = pts[i].x - cx, y = pts[i].y - cy;
      var u = x * x + y * y;
      Sxx += x * x; Sxy += x * y; Syy += y * y;
      Sx += x; Sy += y;
      Sux += u * x; Suy += u * y; Su += u;
    }

    var sol = solve3([
      [Sxx, Sxy, Sx, -Sux],
      [Sxy, Syy, Sy, -Suy],
      [Sx, Sy, n, -Su]
    ]);
    if (!sol) return null;

    var D = sol[0], E = sol[1], F = sol[2];
    var lx = -D / 2, ly = -E / 2;
    var r2 = lx * lx + ly * ly - F;
    if (!(r2 > 0) || !isFinite(r2)) return null;

    var center = { x: lx + cx, y: ly + cy };
    var R = Math.sqrt(r2);
    if (!isPt(center) || !isNum(R)) return null;
    return { center: center, radius: R };
  }

  /* Project a centre onto the perpendicular bisector of two exact endpoints.
   * Every point on that bisector is equidistant from them, so the resulting
   * circle passes exactly through both endpoints. */
  function snapCenter(center, p0, p1) {
    var dx = p1.x - p0.x, dy = p1.y - p0.y;
    var L = Math.hypot(dx, dy);
    if (L < 1e-9) return null;
    var mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
    var px = -dy / L, py = dx / L;
    var t = (center.x - mx) * px + (center.y - my) * py;
    var c = { x: mx + px * t, y: my + py * t };
    var R = Math.hypot(p0.x - c.x, p0.y - c.y);
    if (!(R > 1e-9) || !isFinite(R)) return null;
    return c;
  }

  /* Legacy helper kept for tests and external callers. */
  function snapCircleToEndpoints(circle, p0, p1) {
    if (!circle || !circle.center) return null;
    var c = snapCenter(circle.center, p0, p1);
    if (!c) return null;
    return { center: c, radius: Math.hypot(p0.x - c.x, p0.y - c.y) };
  }

  function radialStats(P, a, b, C, R) {
    var maxE = 0, sq = 0, errs = [];
    var count = Math.max(1, b - a + 1);
    for (var i = a; i <= b; i++) {
      var d = Math.hypot(P[i].x - C.x, P[i].y - C.y);
      var e = Math.abs(d - R);
      errs.push(e);
      if (e > maxE) maxE = e;
      sq += e * e;
    }
    return { maxError: maxE, rmsError: Math.sqrt(sq / count), errors: errs };
  }

  /* Signed angular sweep + direction validation. */
  function sweepInfo(P, a, b, C) {
    if (!C || !isPt(C)) return { startAngle: 0, sweep: 0, valid: false, reverse: 0 };
    var th0 = Math.atan2(P[a].y - C.y, P[a].x - C.x);
    var pos = 0, neg = 0, prev = th0;
    for (var i = a + 1; i <= b; i++) {
      var th = Math.atan2(P[i].y - C.y, P[i].x - C.x);
      var d = wrapPi(th - prev);
      if (d > 0) pos += d; else neg -= d;
      prev = th;
    }
    var sweep = pos - neg;
    var mag = Math.abs(sweep);
    var reverse = Math.min(pos, neg);
    var valid = mag > 0.045 && mag < TAU - 1e-3 && reverse < 0.2 * mag + 0.05;
    return { startAngle: th0, sweep: sweep, valid: valid, reverse: reverse };
  }

  /* ---------------------------------------------------- primitive builders */

  function makeLine(p0, p1) {
    var len = dist(p0, p1);
    var dir = len > 1e-9
      ? { x: (p1.x - p0.x) / len, y: (p1.y - p0.y) / len }
      : { x: 1, y: 0 };
    return {
      kind: 'line', p0: copyPt(p0), p1: copyPt(p1),
      length: len, dir: dir, radius: null, center: null,
      startAngle: null, endAngle: null, sweep: null, ccw: null
    };
  }

  /* Sagitta of a circular arc: how far the arc bows away from its own chord.
   * Below a pixel it is a straight line in every way that matters, and a line
   * is the cleaner primitive. */
  function arcSagitta(R, delta) {
    if (!isFinite(R) || !isFinite(delta)) return 0;
    return Math.abs(R) * (1 - Math.cos(Math.abs(delta) / 2));
  }

  function makeArc(p0, p1, center, sweep) {
    var r = Math.hypot(p0.x - center.x, p0.y - center.y);
    var startAngle = Math.atan2(p0.y - center.y, p0.x - center.x);
    return {
      kind: 'arc', p0: copyPt(p0), p1: copyPt(p1),
      center: { x: center.x, y: center.y }, radius: r,
      startAngle: startAngle, endAngle: startAngle + sweep,
      sweep: sweep, ccw: sweep > 0, length: Math.abs(sweep) * r
    };
  }

  /* Free least-squares arc through a run, pinned to its exact endpoints. */
  function freeArc(P, a, b, o) {
    var n = b - a + 1;
    if (n < 3 || b - a < 2) return null;
    var circle = fitCircle(P.slice(a, b + 1));
    if (!circle) return null;
    var c = snapCenter(circle.center, P[a], P[b]);
    if (!c) return null;
    var R = Math.hypot(P[a].x - c.x, P[a].y - c.y);
    if (!(R >= o.minRadius) || !isFinite(R)) return null;

    var th0 = Math.atan2(P[a].y - c.y, P[a].x - c.x);
    var th1 = Math.atan2(P[b].y - c.y, P[b].x - c.x);
    var d = wrapPi(th1 - th0);
    var net = netTurning(P, a, b);
    var sweep;
    if (net >= 0) sweep = d >= 0 ? d : d + TAU;
    else sweep = d <= 0 ? d : d - TAU;
    if (Math.abs(sweep) < 1e-4 || Math.abs(sweep) > TAU - 1e-3) return null;

    var si = sweepInfo(P, a, b, c);
    if (si.reverse > 0.35 * Math.abs(sweep) + 0.05) return null;
    // a circle that bows less than a pixel off its chord is just a line
    if (arcSagitta(R, sweep) < (o.straightSagittaPx || 3.5)) return null;

    return makeArc(P[a], P[b], c, sweep);
  }

  /* Arc that leaves A with the prescribed tangent and reaches B exactly.
   * The chord direction of a circular arc is the start tangent rotated by half
   * the sweep, which fixes the sweep from the chord alone. */
  function arcThroughTangent(A, B, tStart, o) {
    if (!tStart || dist(A, B) < 1e-6) return null;
    var chord = unit({ x: B.x - A.x, y: B.y - A.y });
    var half = signedAngle(tStart, chord);
    var delta = 2 * half;
    if (Math.abs(delta) < 1e-9 || Math.abs(delta) > TAU - 1e-3) return null;
    var s = Math.sin(half);
    if (Math.abs(s) < 1e-7) return null;
    var R = dist(A, B) / (2 * s);
    if (!isFinite(R) || Math.abs(R) < o.minRadius) return null;
    if (arcSagitta(R, delta) < (o.straightSagittaPx || 3.5)) return null;   // near-straight: use a line
    var center = {
      x: A.x + R * rot(tStart, Math.PI / 2).x,
      y: A.y + R * rot(tStart, Math.PI / 2).y
    };
    var snapped = snapCenter(center, A, B);
    if (!snapped) return null;
    return makeArc(A, B, snapped, delta);
  }

  /* Arc that reaches B with the prescribed tangent. */
  function arcThroughTangentBack(A, B, tEnd, o) {
    if (!tEnd || dist(A, B) < 1e-6) return null;
    var chord = unit({ x: B.x - A.x, y: B.y - A.y });
    var half = signedAngle(chord, tEnd);
    var delta = 2 * half;
    if (Math.abs(delta) < 1e-9 || Math.abs(delta) > TAU - 1e-3) return null;
    var s = Math.sin(half);
    if (Math.abs(s) < 1e-7) return null;
    var R = dist(A, B) / (2 * s);
    if (!isFinite(R) || Math.abs(R) < o.minRadius) return null;
    if (arcSagitta(R, delta) < (o.straightSagittaPx || 3.5)) return null;   // near-straight: use a line
    var tStart = rot(chord, -half);
    var center = {
      x: A.x + R * rot(tStart, Math.PI / 2).x,
      y: A.y + R * rot(tStart, Math.PI / 2).y
    };
    var snapped = snapCenter(center, A, B);
    if (!snapped) return null;
    return makeArc(A, B, snapped, delta);
  }

  /* Closed-form tangent biarc: choose the joint tangent tJ, then solve the two
   * chord lengths so the chain runs exactly from A to B. Returns the two
   * primitives or null when the joint tangent gives no positive solution. */
  function solveBiarc(A, B, tA, tJ, d1, d2, o) {
    var D = { x: B.x - A.x, y: B.y - A.y };
    var u1 = Math.abs(d1) < 1e-9 ? tA : rot(tA, d1 / 2);
    var u2 = Math.abs(d2) < 1e-9 ? tJ : rot(tJ, d2 / 2);
    var det = u1.x * u2.y - u1.y * u2.x;
    if (Math.abs(det) < 1e-9) return null;

    var k1 = (D.x * u2.y - D.y * u2.x) / det;
    var k2 = (u1.x * D.y - u1.y * D.x) / det;
    if (!(k1 > 1e-6) || !(k2 > 1e-6)) return null;

    var prims = [];
    var J;

    var r1 = Math.abs(d1) < 1e-9 ? Infinity : k1 / (2 * Math.sin(d1 / 2));
    var straight1 = !isFinite(r1) || arcSagitta(r1, d1) < (o.straightSagittaPx || 3.5);
    if (!straight1 && Math.abs(r1) < o.minRadius) return null;
    if (straight1) {
      J = { x: A.x + u1.x * k1, y: A.y + u1.y * k1 };
      prims.push(makeLine(A, J));
    } else {
      J = { x: A.x + u1.x * k1, y: A.y + u1.y * k1 };
      var n1 = rot(tA, Math.PI / 2);
      var c1 = snapCenter({ x: A.x + r1 * n1.x, y: A.y + r1 * n1.y }, A, J);
      if (!c1) return null;
      prims.push(makeArc(A, J, c1, d1));
    }

    var Jp = prims[0].p1;
    var r2 = Math.abs(d2) < 1e-9 ? Infinity : k2 / (2 * Math.sin(d2 / 2));
    var straight2 = !isFinite(r2) || arcSagitta(r2, d2) < (o.straightSagittaPx || 3.5);
    if (!straight2 && Math.abs(r2) < o.minRadius) return null;
    if (straight2) {
      prims.push(makeLine(Jp, B));
    } else {
      var n2 = rot(tJ, Math.PI / 2);
      var c2 = snapCenter({ x: Jp.x + r2 * n2.x, y: Jp.y + r2 * n2.y }, Jp, B);
      if (!c2) return null;
      prims.push(makeArc(Jp, B, c2, d2));
    }
    return prims;
  }

  function chainDeviation(prims, P, a, b) {
    var maxE = 0, sq = 0, count = 0;
    for (var i = a; i <= b; i++) {
      var d = Infinity;
      for (var k = 0; k < prims.length; k++) {
        var dd = pointPrimDistance(prims[k], P[i]);
        if (dd < d) d = dd;
      }
      if (!isFinite(d)) d = 0;
      if (d > maxE) maxE = d;
      sq += d * d;
      count++;
    }
    return { max: maxE, rms: count ? Math.sqrt(sq / count) : 0 };
  }

  function chainLength(prims) {
    var l = 0;
    for (var i = 0; i < prims.length; i++) l += prims[i].length;
    return l;
  }

  /* Best tangent biarc for a run: scan the joint tangent, keep the candidate
   * with the smallest deviation from the run. */
  function bestBiarc(P, a, b, tA, tB, o) {
    if (!tA || !tB) return null;
    var A = P[a], B = P[b];
    if (dist(A, B) < 1e-6) return null;

    var base = signedAngle(tA, tB);
    var deltas = [0, base];
    var Q = 36;
    for (var q = 1; q < Q; q++) deltas.push(-Math.PI + TAU * q / Q);

    var best = null, bestErr = Infinity;
    for (var i = 0; i < deltas.length; i++) {
      var d1 = deltas[i];
      var tJ = rot(tA, d1);
      var d2 = signedAngle(tJ, tB);
      var prims = solveBiarc(A, B, tA, tJ, d1, d2, o);
      if (!prims) continue;
      var e = chainDeviation(prims, P, a, b);
      if (e.max < bestErr - 1e-9) { bestErr = e.max; best = prims; }
    }
    return best;
  }

  function pointSegDistance(a, b, p) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
    var t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }

  function pointPrimDistance(prim, p) {
    if (!prim) return Infinity;
    if (prim.kind === 'line') return pointSegDistance(prim.p0, prim.p1, p);
    var dx = p.x - prim.center.x, dy = p.y - prim.center.y;
    var d = Math.hypot(dx, dy);
    var rel = wrapPi(Math.atan2(dy, dx) - prim.startAngle);
    var inside = prim.sweep > 0
      ? (rel >= -1e-9 && rel <= prim.sweep + 1e-9)
      : (rel <= 1e-9 && rel >= prim.sweep - 1e-9);
    if (inside) return Math.abs(d - prim.radius);
    return Math.min(Math.hypot(p.x - prim.p0.x, p.y - prim.p0.y),
                    Math.hypot(p.x - prim.p1.x, p.y - prim.p1.y));
  }

  /* ------------------------------------------------- candidate generation */

  function maxPrimsFor(simplicity, sampleCount) {
    if (sampleCount < 4) return 1;
    if (simplicity >= 0.9) return 2;
    if (simplicity >= 0.45) return 3;
    return 4;
  }

  function splitIndices(P, a, b, o) {
    var n = b - a;
    if (n < 4) return [];
    var minSeg = Math.max(2, Math.round(8 / (o.resampleSpacing || 3)));
    var set = {};
    [0.22, 0.32, 0.42, 0.5, 0.58, 0.68, 0.78].forEach(function (f) {
      var m = a + Math.round(n * f);
      if (m >= a + minSeg && m <= b - minSeg) set[m] = true;
    });

    var arc = freeArc(P, a, b, o);
    if (arc) {
      var worst = -1, wi = -1;
      for (var i = a; i <= b; i++) {
        var d = pointPrimDistance(arc, P[i]);
        if (d > worst) { worst = d; wi = i; }
      }
      if (wi >= a + minSeg && wi <= b - minSeg) set[wi] = true;
    }

    var w = clamp(Math.round(9 / (o.resampleSpacing || 3)), 2, 6);
    var ang = turningAngles(P, w);
    var mv = -1, mi = -1;
    for (var j = a + minSeg; j <= b - minSeg; j++) {
      if (ang[j] > mv) { mv = ang[j]; mi = j; }
    }
    if (mi >= 0) set[mi] = true;

    return Object.keys(set).map(Number).sort(function (x, y) { return x - y; });
  }

  /* Every plausible description of one smooth run, shortest first. Each entry is
   * a chain of primitives whose internal junctions are tangent by construction
   * (or carry a measurable mismatch that the score will punish). */
  function chainCandidates(P, a, b, tA, tB, maxPrims, o) {
    var A = P[a], B = P[b];
    var out = [];
    function push(prims) {
      if (!prims || !prims.length) return;
      for (var i = 0; i < prims.length; i++) {
        if (!prims[i] || !isPt(prims[i].p0) || !isPt(prims[i].p1)) return;
      }
      out.push(prims);
    }

    // --- one primitive
    push([makeLine(A, B)]);
    var fa = freeArc(P, a, b, o);
    if (fa) push([fa]);
    if (tA) push([arcThroughTangent(A, B, tA, o)]);
    if (tB) push([arcThroughTangentBack(A, B, tB, o)]);

    // --- two primitives
    if (maxPrims >= 2) push(bestBiarc(P, a, b, tA, tB, o));

    // --- two primitives, split: two independently fitted singles. The junction
    //     keeps its measured mismatch, which the score punishes; on a smooth
    //     run (an S-ease, say) that mismatch is tiny and G1 comes for free.
    if (maxPrims >= 2 && b - a >= 4) {
      var split2 = splitIndices(P, a, b, o);
      for (var s2 = 0; s2 < split2.length; s2++) {
        var m2 = split2[s2];
        var J2 = P[m2];
        var left2 = [];
        var l2a = freeArc(P, a, m2, o);
        if (l2a) left2.push(l2a);
        left2.push(makeLine(A, J2));
        var right2 = [];
        var r2a = freeArc(P, m2, b, o);
        if (r2a) right2.push(r2a);
        right2.push(makeLine(J2, B));
        var tM2 = tangentAt(P, m2, 1, tangentWindow(o.resampleSpacing));
        if (tM2) {
          var r2t = arcThroughTangent(J2, B, tM2, o);
          if (r2t) right2.push(r2t);
          var l2t = arcThroughTangentBack(A, J2, tM2, o);
          if (l2t) left2.push(l2t);
        }
        for (var x2 = 0; x2 < left2.length; x2++) {
          for (var y2 = 0; y2 < right2.length; y2++) push([left2[x2], right2[y2]]);
        }
      }
    }

    // --- three and four primitives: split, then recover G1 by handing the left
    //     primitive's end tangent to the right chain as its start tangent
    if (maxPrims >= 3 && b - a >= 4) {
      var splits = splitIndices(P, a, b, o);
      for (var s = 0; s < splits.length; s++) {
        var m = splits[s];
        var J = P[m];
        var tM = tangentAt(P, m, 1, tangentWindow(o.resampleSpacing));

        var leftSingles = [makeLine(A, J)];
        if (tA) {
          var la = arcThroughTangent(A, J, tA, o);
          if (la) leftSingles.push(la);
        }
        var faLeft = freeArc(P, a, m, o);
        if (faLeft) leftSingles.push(faLeft);

        for (var li = 0; li < leftSingles.length; li++) {
          var L = leftSingles[li];
          var tLe = tangentsOf(L).end;
          var right = bestBiarc(P, m, b, tLe, tB, o);
          if (right) push([L].concat(right));
        }

        if (tM) {
          var leftBi = bestBiarc(P, a, m, tA, tM, o);
          if (leftBi) {
            var rCon = arcThroughTangent(J, B, tM, o);
            if (rCon) push(leftBi.concat([rCon]));
            push(leftBi.concat([makeLine(J, B)]));
          }
        }

        if (maxPrims >= 4) {
          for (var dj = -2; dj <= 2; dj++) {
            var tJ4 = rot(tM, dj * 8 * RAD);
            var lb4 = bestBiarc(P, a, m, tA, tJ4, o);
            var rb4 = bestBiarc(P, m, b, tJ4, tB, o);
            if (lb4 && rb4) push(lb4.concat(rb4));
          }
        }
      }
    }
    return out;
  }

  function chainMetrics(prims, P, a, b, budget, o) {
    var dev = chainDeviation(prims, P, a, b);
    var mismatch = 0, maxJunction = 0;
    for (var i = 0; i < prims.length - 1; i++) {
      var mm = angleBetween(tangentsOf(prims[i]).end, tangentsOf(prims[i + 1]).start);
      mismatch += mm;
      if (mm > maxJunction) maxJunction = mm;
    }
    var radiusPen = 0;
    for (var k = 0; k < prims.length; k++) {
      if (prims[k].kind === 'arc') {
        var pref = o.minRadius * 2;
        if (prims[k].radius < pref) radiusPen += (pref - prims[k].radius) / pref;
      }
    }
    var cost = o.countWeight * prims.length
      + sq(dev.max / Math.max(1e-6, budget))
      + o.tangentWeight * (mismatch / 90)
      + o.radiusWeight * radiusPen;
    return {
      maxError: dev.max, rmsError: dev.rms, mismatchDeg: mismatch,
      maxJunctionDeg: maxJunction, radiusPenalty: radiusPen, cost: cost
    };
  }

  function sq(v) { return v * v; }

  /* Assign each sample to its nearest primitive and report honest per-primitive
   * errors plus the sample range each primitive covers. */
  function annotatePrimitives(prims, P, a, b) {
    var maxE = [], rmsAcc = [], cnt = [], lo = [], hi = [];
    for (var k = 0; k < prims.length; k++) { maxE.push(0); rmsAcc.push(0); cnt.push(0); lo.push(a); hi.push(a); }
    for (var i = a; i <= b; i++) {
      var bi = 0, bd = Infinity;
      for (var q = 0; q < prims.length; q++) {
        var d = pointPrimDistance(prims[q], P[i]);
        if (d < bd) { bd = d; bi = q; }
      }
      if (bd > maxE[bi]) maxE[bi] = bd;
      rmsAcc[bi] += bd * bd;
      cnt[bi]++;
      if (i < lo[bi]) lo[bi] = i;
      if (i > hi[bi]) hi[bi] = i;
    }
    for (var j = 0; j < prims.length; j++) {
      prims[j].maxError = maxE[j];
      prims[j].rmsError = Math.sqrt(rmsAcc[j] / Math.max(1, cnt[j]));
      prims[j].a = lo[j];
      prims[j].b = hi[j];
    }
    return prims;
  }

  /* -------------------------------------------------------- run fitting */

  function fitRun(P, a, b, budget, o) {
    var tw = tangentWindow(o.resampleSpacing);
    var tA = tangentAt(P, a, 1, tw);
    var tB = tangentAt(P, b, -1, tw);
    var maxPrims = Math.min(o.maxPrimitivesPerRun, maxPrimsFor(o.simplicity, b - a + 1));
    var cands = chainCandidates(P, a, b, tA, tB, maxPrims, o);
    var runLen = polylineLength(P.slice(a, b + 1));
    var limit = runLen * o.lengthSanity + 40;

    var best = null;
    for (var i = 0; i < cands.length; i++) {
      var prims = cands[i];
      if (chainLength(prims) > limit) continue;
      var m = chainMetrics(prims, P, a, b, budget, o);
      // a smooth run is never allowed a corner inside it: every internal
      // junction must read G1. Only detected cusps may be non-tangent.
      if (m.maxJunctionDeg > o.tangencyDeg) continue;
      if (!best || m.cost < best.cost - 1e-9 ||
          (Math.abs(m.cost - best.cost) <= 1e-9 && prims.length < best.prims.length)) {
        best = { prims: prims, cost: m.cost, maxError: m.maxError, rmsError: m.rmsError, mismatchDeg: m.mismatchDeg };
      }
    }
    if (!best) best = { prims: [makeLine(P[a], P[b])], cost: 0, maxError: 0, rmsError: 0, mismatchDeg: 0 };
    annotatePrimitives(best.prims, P, a, b);
    return { a: a, b: b, prims: best.prims, cost: best.cost, maxError: best.maxError };
  }

  /* Merge adjacent runs whose fitted tangents agree: a cut that turned out
   * tangent was not a real cusp, so it should not survive as a boundary. */
  function mergeTangentRuns(runs, P, budget, o) {
    var changed = true, guard = 0;
    while (changed && guard++ < 200) {
      changed = false;
      for (var i = 0; i < runs.length - 1; i++) {
        var left = runs[i], right = runs[i + 1];
        if (left.b !== right.a) continue;
        var mismatch = angleBetween(
          tangentsOf(left.prims[left.prims.length - 1]).end,
          tangentsOf(right.prims[0]).start
        );
        if (mismatch > o.tangencyDeg) continue;
        var union = fitRun(P, left.a, right.b, budget, o);
        if (union.cost <= left.cost + right.cost + 1e-6) {
          runs.splice(i, 2, union);
          changed = true;
          break;
        }
      }
    }
    return runs;
  }

  /* ------------------------------------------------------ junctions/export */

  function computeJunctions(prims, tangencyDeg) {
    var out = [];
    for (var i = 0; i < prims.length - 1; i++) {
      var A = prims[i], B = prims[i + 1];
      var mismatch = angleBetween(tangentsOf(A).end, tangentsOf(B).start);
      out.push({
        index: i,
        at: { x: (A.p1.x + B.p0.x) / 2, y: (A.p1.y + B.p0.y) / 2 },
        leftId: A.id, rightId: B.id,
        mismatchDeg: mismatch,
        gap: dist(A.p1, B.p0),
        type: mismatch <= tangencyDeg ? 'g1' : 'corner',
        atCusp: !!(A.endsAtCut)
      });
    }
    return out;
  }

  /* ----------------------------------------------------------- main entry */

  function emptyResult(raw, o) {
    return {
      raw: raw, resampled: [], smoothed: [], cusps: [], cuts: raw.length ? [0, raw.length - 1] : [],
      primitives: [], junctions: [],
      options: o, errorBudget: 0,
      stats: {
        rawPoints: raw.length, samples: 0, cusps: 0, runs: 0, primitives: 0,
        maxError: 0, rmsError: 0, maxMismatchDeg: 0, meanMismatchDeg: 0, withinBudget: true
      }
    };
  }

  function fitStroke(points, options, doc) {
    var o = {};
    for (var key in DEFAULTS) o[key] = DEFAULTS[key];
    if (options) {
      for (var k2 in options) {
        if (options[k2] === undefined) continue;
        o[k2] = options[k2];
      }
    }
    // never let a missing or broken control leak NaN into the geometry
    for (var nk in DEFAULTS) {
      if (typeof DEFAULTS[nk] === 'number' && !isFinite(o[nk])) o[nk] = DEFAULTS[nk];
    }
    o.simplicity = clamp(o.simplicity, 0, 1);
    o.cornerSensitivity = clamp(o.cornerSensitivity, 0, 1);
    o.minRadius = Math.max(0, o.minRadius);
    var idBase = (doc && doc.id) || 'stroke';

    var raw = dedupe(points || [], 0.01);
    if (raw.length < 2) return emptyResult(raw, o);
    if (polylineLength(raw) < 1) return emptyResult(raw, o);

    var resampledPts = resample(raw, o.resampleSpacing);
    var smoothed = smooth(resampledPts, o.smoothRadius, o.smoothIterations);
    var N = smoothed.length;
    if (N < 2) return emptyResult(raw, o);

    var scale = Math.max(1, Math.hypot(boundsOf(smoothed).width, boundsOf(smoothed).height));
    var simplicity = clamp(o.simplicity, 0, 1);
    var errorBudget = (0.008 + 0.055 * simplicity) * scale;

    var cuspIdx = detectCusps(smoothed, o);
    var cuspSet = {};
    cuspIdx.forEach(function (i) { cuspSet[i] = true; });

    var cuts = [0];
    cuspIdx.forEach(function (i) { if (i > 1 && i < N - 2) cuts.push(i); });
    cuts.push(N - 1);
    cuts = cuts.filter(function (v, i, arr) { return i === 0 || v > arr[i - 1]; });

    var runs = [];
    for (var ci = 0; ci < cuts.length - 1; ci++) {
      var a = cuts[ci], b = cuts[ci + 1];
      if (b - a < 2) {
        if (runs.length) { runs[runs.length - 1].b = b; }
        continue;
      }
      runs.push(fitRun(smoothed, a, b, errorBudget, o));
    }
    if (!runs.length) return emptyResult(raw, o);

    runs = mergeTangentRuns(runs, smoothed, errorBudget, o);

    var prims = [];
    for (var ri = 0; ri < runs.length; ri++) {
      var run = runs[ri];
      for (var pi = 0; pi < run.prims.length; pi++) {
        var p = run.prims[pi];
        p.run = ri;
        p.endsAtCut = false;
        p.cutIndex = null;
        if (pi === run.prims.length - 1) {
          p.endsAtCut = true;
          p.cutIndex = run.b;
        }
        prims.push(p);
      }
    }
    // a boundary is a cusp only when the run end is a detected cusp point and
    // the merge pass did not dissolve it
    for (var qi = 0; qi < prims.length; qi++) {
      if (prims[qi].endsAtCut) prims[qi].endsAtCut = !!cuspSet[prims[qi].cutIndex];
    }

    for (var ei = 0; ei < prims.length; ei++) {
      prims[ei].index = ei;
      prims[ei].id = idBase + ':' + ei;
      if (prims[ei].endsAtCut === undefined) prims[ei].endsAtCut = false;
    }

    var junctions = computeJunctions(prims, o.tangencyDeg);

    var maxErr = 0, rmsAcc = 0, mmSum = 0, mmMax = 0, cornerCount = 0;
    for (var mi = 0; mi < prims.length; mi++) {
      if (prims[mi].maxError > maxErr) maxErr = prims[mi].maxError;
      rmsAcc += prims[mi].rmsError * prims[mi].rmsError;
    }
    junctions.forEach(function (j) {
      mmSum += j.mismatchDeg;
      if (j.mismatchDeg > mmMax) mmMax = j.mismatchDeg;
      if (j.type === 'corner') cornerCount++;
    });

    return {
      raw: raw,
      resampled: resampledPts,
      smoothed: smoothed,
      cusps: cuspIdx,
      cuts: cuts,
      primitives: prims,
      junctions: junctions,
      options: o,
      errorBudget: errorBudget,
      stats: {
        rawPoints: raw.length,
        samples: N,
        cusps: cuspIdx.length,
        corners: cornerCount,
        runs: runs.length,
        primitives: prims.length,
        maxError: maxErr,
        rmsError: prims.length ? Math.sqrt(rmsAcc / prims.length) : 0,
        maxMismatchDeg: mmMax,
        meanMismatchDeg: junctions.length ? mmSum / junctions.length : 0,
        withinBudget: maxErr <= errorBudget + 1e-9
      }
    };
  }

  /* ----------------------------------------------------------- SVG output */

  function arcFlags(prim) {
    var sweep = prim.sweep;
    return {
      largeArc: Math.abs(sweep) > Math.PI ? 1 : 0,
      sweepFlag: sweep > 0 ? 1 : 0
    };
  }

  function num(v) { return Math.round(v * 1000) / 1000; }

  function primitiveCommand(prim) {
    if (prim.kind === 'line') return 'L ' + num(prim.p1.x) + ' ' + num(prim.p1.y);
    var f = arcFlags(prim);
    return 'A ' + num(prim.radius) + ' ' + num(prim.radius) + ' 0 ' + f.largeArc + ' ' + f.sweepFlag +
      ' ' + num(prim.p1.x) + ' ' + num(prim.p1.y);
  }

  function primitivePathData(prim) {
    return 'M ' + num(prim.p0.x) + ' ' + num(prim.p0.y) + ' ' + primitiveCommand(prim);
  }

  function buildPathData(prims) {
    var d = '', prev = null;
    for (var i = 0; i < prims.length; i++) {
      var p = prims[i];
      var contiguous = prev && dist(prev.p1, p.p0) < 1e-6;
      if (!contiguous) d += (d ? ' ' : '') + 'M ' + num(p.p0.x) + ' ' + num(p.p0.y);
      d += (d ? ' ' : '') + primitiveCommand(p);
      prev = p;
    }
    return d;
  }

  /* -------------------------------------------------------- sample strokes */

  function lcg(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function integrate(startX, startY, headingDeg, pieces, ds) {
    ds = ds || 3;
    var pts = [{ x: startX, y: startY }];
    var h = headingDeg * RAD;
    var x = startX, y = startY;
    for (var i = 0; i < pieces.length; i++) {
      var pc = pieces[i];
      if (pc.type === 'line') {
        var rem = pc.len;
        while (rem > 1e-6) {
          var step = Math.min(ds, rem);
          x += Math.cos(h) * step;
          y += Math.sin(h) * step;
          rem -= step;
          pts.push({ x: x, y: y });
        }
      } else {
        var sign = pc.turn >= 0 ? 1 : -1;
        var remArc = Math.abs(pc.turn) * RAD;
        while (remArc > 1e-6) {
          var dth = Math.min(ds / pc.radius, remArc);
          var stepLen = dth * pc.radius;
          x += Math.cos(h) * stepLen;
          y += Math.sin(h) * stepLen;
          h += sign * dth;
          remArc -= dth;
          pts.push({ x: x, y: y });
        }
      }
    }
    return pts;
  }

  function jitter(points, amp, seed) {
    var rnd = lcg(seed);
    var ox = 0, oy = 0, out = [];
    for (var i = 0; i < points.length; i++) {
      ox = ox * 0.88 + (rnd() - 0.5) * amp * 0.25;
      oy = oy * 0.88 + (rnd() - 0.5) * amp * 0.25;
      out.push({
        x: points[i].x + ox + (rnd() - 0.5) * amp * 0.7,
        y: points[i].y + oy + (rnd() - 0.5) * amp * 0.7
      });
    }
    return out;
  }

  /* Three generated reference gestures, each normalised onto the board. */
  function sampleStrokes(box) {
    box = box || { x: 0, y: 0, width: 1600, height: 1000 };

    // 1. pointed crest + long easing tail: a steep straight rise, a true cusp
    //    at the apex, then tangent arcs of increasing radius.
    var rise = integrate(0, 0, -72, [{ type: 'line', len: 640 }], 3);
    var apex = rise[rise.length - 1];
    var tail = integrate(apex.x, apex.y, 8, [
      { type: 'arc', radius: 900, turn: 6 },
      { type: 'arc', radius: 2400, turn: 10 },
      { type: 'line', len: 320 }
    ], 3);
    var crest = rise.concat(tail.slice(1));

    // 2. a fully tangent (G1) S-ease.
    var sEase = integrate(0, 0, -12, [
      { type: 'line', len: 220 },
      { type: 'arc', radius: 620, turn: 44 },
      { type: 'arc', radius: 620, turn: -44 },
      { type: 'line', len: 300 }
    ], 3);

    // 3. a bracket: one hard 90 degree corner, then a rounded tangent corner.
    var leg1 = integrate(0, 0, 0, [{ type: 'line', len: 500 }], 3);
    var leg2 = integrate(leg1[leg1.length - 1].x, leg1[leg1.length - 1].y, 90, [
      { type: 'line', len: 400 },
      { type: 'arc', radius: 190, turn: 90 },
      { type: 'line', len: 280 }
    ], 3);
    var bracket = leg1.concat(leg2.slice(1));

    return [
      { id: 'crest', name: 'Pointed crest + easing tail', points: jitter(fitToBox(crest, box, 120), 1.5, 20240517) },
      { id: 'sease', name: 'Tangent S-ease', points: jitter(fitToBox(sEase, box, 120), 1.1, 987654321) },
      { id: 'bracket', name: 'Bracket corners', points: jitter(fitToBox(bracket, box, 120), 1.2, 13571113) }
    ];
  }

  /* --------------------------------------------------------------- export */

  var api = {
    DEFAULTS: DEFAULTS,
    TAU: TAU,
    dedupe: dedupe,
    resample: resample,
    smooth: smooth,
    turningAngles: turningAngles,
    detectCusps: detectCusps,
    detectCorners: detectCusps,
    tangentWindow: tangentWindow,
    tangentAt: tangentAt,
    netTurning: netTurning,
    fitCircle: fitCircle,
    snapCenter: snapCenter,
    snapCircleToEndpoints: snapCircleToEndpoints,
    radialStats: radialStats,
    sweepInfo: sweepInfo,
    makeLine: makeLine,
    makeArc: makeArc,
    freeArc: freeArc,
    arcThroughTangent: arcThroughTangent,
    arcThroughTangentBack: arcThroughTangentBack,
    solveBiarc: solveBiarc,
    bestBiarc: bestBiarc,
    pointPrimDistance: pointPrimDistance,
    chainDeviation: chainDeviation,
    chainCandidates: chainCandidates,
    chainMetrics: chainMetrics,
    fitRun: fitRun,
    tangentsOf: tangentsOf,
    angleBetween: angleBetween,
    computeJunctions: computeJunctions,
    fitStroke: fitStroke,
    interpretStroke: fitStroke,
    buildPathData: buildPathData,
    primitivePathData: primitivePathData,
    primitiveCommand: primitiveCommand,
    arcFlags: arcFlags,
    polylineLength: polylineLength,
    boundsOf: boundsOf,
    fitToBox: fitToBox,
    sampleStrokes: sampleStrokes,
    integrate: integrate,
    jitter: jitter
  };

  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.CA = window.CA || {};
    window.CA.fit = api;
  }
})();
