/* 纹理间 · 曲线纹理 — browser test harness for the safe SVG importer.
 *
 * This file is NOT part of the application runtime. Open svg-import.test.html
 * in a modern browser to run it; it uses the browser's own DOMParser and SVG
 * geometry API, which Node does not provide. It is loaded before the page's
 * inline reporter and only defines `window.SvgImportTests`.
 */
(function (root) {
  "use strict";
  var SvgImport = root.SvgImport;
  var CE = root.CurveEngine;

  function assert(cond, msg) { if (!cond) throw new Error(msg || "断言失败"); }
  function approx(a, b, tol, msg) {
    if (Math.abs(a - b) > (tol == null ? 0.5 : tol)) throw new Error((msg || "数值不符") + "：" + a + " vs " + b);
  }
  function assertThrows(fn, re, msg) {
    var threw = false, err = null;
    try { fn(); } catch (e) { threw = true; err = e; }
    assert(threw, msg || "应当抛出错误");
    if (re) assert(re.test(err.message), "错误信息不含预期内容：" + err.message);
  }
  function svg(inner, attrs) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"' + (attrs || "") + ">" + inner + "</svg>";
  }
  function boundsOf(path) {
    var b = {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity};
    path.subpaths.forEach(function (sp) {
      sp.polyline.forEach(function (p) {
        if (p[0] < b.minX) b.minX = p[0];
        if (p[1] < b.minY) b.minY = p[1];
        if (p[0] > b.maxX) b.maxX = p[0];
        if (p[1] > b.maxY) b.maxY = p[1];
      });
    });
    return b;
  }

  var TESTS = [];
  function test(name, fn) { TESTS.push({name: name, fn: fn}); }

  /* ------------------------------------------------------- primitives */

  test("line/polyline/polygon/rect/circle/ellipse all import", function () {
    var src = svg('<rect x="10" y="20" width="40" height="30"/>' +
      '<circle cx="200" cy="200" r="25"/>' +
      '<ellipse cx="300" cy="100" rx="30" ry="10"/>' +
      '<line x1="0" y1="0" x2="50" y2="50"/>' +
      '<polyline points="0,0 10,10 20,0"/>' +
      '<polygon points="50,50 60,50 55,60"/>');
    var r = SvgImport.parseSvgText(src, {width: 400, height: 400});
    assert(r.paths.length === 6, "expected six imported paths, got " + r.paths.length);
    var circle = r.paths[1];
    assert(circle.subpaths[0].closed === true, "circle must be closed");
    assert(circle.subpaths[0].segments.every(function (s) { return s.kind === "arc"; }), "circle must stay arcs");
    approx(circle.subpaths[0].segments[0].r, 25, 0.5, "circle radius");
    var rect = r.paths[0];
    assert(rect.subpaths[0].closed === true, "rect must be closed");
    var poly = r.paths[5];
    assert(poly.subpaths[0].closed === true, "polygon must be closed");
    assert(r.paths[4].subpaths[0].closed === false, "polyline must stay open");
  });

  test("multiple M subpaths never bridge the gap", function () {
    var r = SvgImport.parseSvgText(svg('<path d="M0 0 L100 0 M200 200 L200 300"/>'), {width: 400, height: 400});
    assert(r.paths.length === 1, "one path element");
    var path = r.paths[0];
    assert(path.subpaths.length === 2, "expected two subpaths, got " + path.subpaths.length);
    var a = path.subpaths[0].polyline;
    var b = path.subpaths[1].polyline;
    assert(a[a.length - 1][0] <= 100.5, "first subpath must stop at its own end");
    assert(b[0][0] >= 199, "second subpath must start at its own moveto");
    // No element of the first subpath may jump towards the second one.
    a.forEach(function (p) { assert(p[1] <= 0.5 && p[0] <= 100.5, "first subpath left its own run"); });
  });

  test("relative + absolute commands, curves, arcs and close", function () {
    var d = "m40,40 l60,0 q30,30 60,0 c0,40 -40,60 -60,20 a20,20 0 0 1 40,0 z";
    var r = SvgImport.parseSvgText(svg('<path d="' + d + '"/>'), {width: 400, height: 400});
    assert(r.paths.length === 1);
    var sp = r.paths[0].subpaths[0];
    assert(sp.closed === true, "Z must mark the subpath closed");
    assert(sp.segments.length >= 3, "sampled curve should contain several segments");
    var b = boundsOf(r.paths[0]);
    assert(b.minX >= 39 && b.minY >= 39 && b.maxX <= 220 && b.maxY <= 130, "geometry left the expected area: " + JSON.stringify(b));
  });

  test("nested group transforms are composed", function () {
    var src = svg('<g transform="translate(100,50)"><g transform="scale(2)"><rect x="0" y="0" width="10" height="10"/></g></g>');
    var r = SvgImport.parseSvgText(src, {width: 400, height: 400});
    var b = boundsOf(r.paths[0]);
    approx(b.minX, 100, 0.5, "minX");
    approx(b.minY, 50, 0.5, "minY");
    approx(b.maxX, 120, 0.5, "maxX");
    approx(b.maxY, 70, 0.5, "maxY");
  });

  test("viewBox origin and aspect-fit map into the logical canvas", function () {
    var src = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100"><circle cx="0" cy="0" r="10"/></svg>';
    var r = SvgImport.parseSvgText(src, {width: 400, height: 200});
    var seg = r.paths[0].subpaths[0].segments[0];
    approx(seg.center[0], 200, 1, "centre x");
    approx(seg.center[1], 100, 1, "centre y");
    approx(seg.r, 20, 0.5, "fitted radius");
  });

  test("uniform scale keeps circles as exact arcs", function () {
    var r = SvgImport.parseSvgText(svg('<circle cx="50" cy="50" r="20" transform="scale(2)"/>'), {width: 400, height: 400});
    var segs = r.paths[0].subpaths[0].segments;
    assert(segs.every(function (s) { return s.kind === "arc"; }), "scaled circle stays arcs");
    approx(segs[0].center[0], 100, 0.5, "scaled centre x");
    approx(segs[0].center[1], 100, 0.5, "scaled centre y");
    approx(segs[0].r, 40, 0.5, "scaled radius");
  });

  test("non-uniform transforms fall back to sampling without error", function () {
    var r = SvgImport.parseSvgText(svg('<circle cx="50" cy="50" r="20" transform="scale(2,0.5)"/>'), {width: 400, height: 400});
    var b = boundsOf(r.paths[0]);
    approx(b.minX, 60, 1, "ellipse minX");
    approx(b.maxX, 140, 1, "ellipse maxX");
    approx(b.minY, 15, 1, "ellipse minY");
    approx(b.maxY, 35, 1, "ellipse maxY");
  });

  /* ------------------------------------------------------ rejections */

  var BAD = [
    ["script", '<script>alert(1)</script><rect x="0" y="0" width="10" height="10"/>'],
    ["foreignObject", '<foreignObject width="10" height="10"></foreignObject>'],
    ["image", '<image href="tracker.png" width="10" height="10"/>'],
    ["use", '<use href="#secret"/>'],
    ["style element", '<style>.a{fill:red}</style><rect x="0" y="0" width="10" height="10"/>'],
    ["style attribute", '<rect x="0" y="0" width="10" height="10" style="fill:red"/>'],
    ["clipPath", '<defs><clipPath id="c"><rect width="1" height="1"/></clipPath></defs><rect x="0" y="0" width="10" height="10"/>'],
    ["mask", '<defs><mask id="m"><rect width="1" height="1"/></mask></defs><rect x="0" y="0" width="10" height="10"/>'],
    ["filter", '<defs><filter id="f"></filter></defs><rect x="0" y="0" width="10" height="10"/>'],
    ["event handler", '<rect x="0" y="0" width="10" height="10" onload="alert(1)"/>'],
    ["external url", '<rect x="0" y="0" width="10" height="10" fill="url(http://evil.example/x)"/>'],
    ["external href", '<rect x="0" y="0" width="10" height="10" href="http://evil.example/x"/>'],
    ["javascript url", '<rect x="0" y="0" width="10" height="10" fill="javascript:alert(1)"/>'],
    ["DTD / entity", '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rect x="0" y="0" width="10" height="10"/>']
  ];

  BAD.forEach(function (pair) {
    test("rejects " + pair[0], function () {
      assertThrows(function () { SvgImport.parseSvgText(svg(pair[1]), {width: 400, height: 400}); }, /拒绝|不支持|不安全|外部|事件|属性|内容/);
    });
  });

  test("a non-svg root is rejected", function () {
    assertThrows(function () {
      SvgImport.parseSvgText("<html><body><p>hi</p></body></html>", {width: 400, height: 400});
    }, /根元素/);
  });

  test("broken XML is rejected without executing anything", function () {
    assertThrows(function () {
      SvgImport.parseSvgText("<svg xmlns='http://www.w3.org/2000/svg'><rect", {width: 400, height: 400});
    }, /解析|损坏|不完整/);
  });

  test("invalid path data characters are rejected", function () {
    assertThrows(function () { SvgImport.parseSvgText(svg('<path d="M0 0 @ 10 10"/>'), {width: 400, height: 400}); }, /d 属性|字符|路径/);
    assertThrows(function () { SvgImport.parseSvgText(svg('<path d=""/>'), {width: 400, height: 400}); }, /d 属性|缺少/);
  });

  test("file byte limit is enforced", function () {
    var chunk = '<rect x="0" y="0" width="1" height="1"/>';
    var big = '<svg xmlns="http://www.w3.org/2000/svg">' + chunk.repeat(60000) + "</svg>";
    assert(big.length > SvgImport.MAX_SVG_BYTES, "fixture must exceed the limit");
    assertThrows(function () { SvgImport.parseSvgText(big, {width: 400, height: 400}); }, /上限/);
  });

  test("polyline point budget is enforced", function () {
    var parts = [];
    for (var i = 0; i < 40000; i++) parts.push(i + "," + ((i * 7) % 100));
    assertThrows(function () {
      SvgImport.parseSvgText(svg('<polyline points="' + parts.join(" ") + '"/>'), {width: 400, height: 400});
    }, /上限/);
  });

  test("unknown non-geometry elements are skipped with a warning", function () {
    var r = SvgImport.parseSvgText(svg('<foo bar="1"/><rect x="5" y="5" width="10" height="10"/>'), {width: 400, height: 400});
    assert(r.paths.length === 1, "the geometry still imports");
    assert(r.warnings.some(function (w) { return w.indexOf("foo") !== -1; }), "a warning mentions the skipped element");
  });

  test("near-adjacent moveto subpaths stay separate", function () {
    var r = SvgImport.parseSvgText(svg('<path d="M0 10L40 10M40.1 10L80 10"/>'), {width:100,height:100});
    assert(r.paths[0].subpaths.length === 2, "close endpoints must not be inferred as connected");
  });
  test("truncated path grammar rejects instead of partial import", function () {
    assertThrows(function () { SvgImport.parseSvgText(svg('<path d="M0 0L40 40C1 2"/>')); }, /语法/);
  });
  test("no-viewBox content fit actually remaps line geometry", function () {
    var r = SvgImport.parseSvgText('<svg xmlns="http://www.w3.org/2000/svg"><line x1="1000" y1="1000" x2="1100" y2="1100"/></svg>', {width:400,height:400});
    var s = r.paths[0].subpaths[0].segments[0];
    approx(s.p0[0],0,0.1); approx(s.p1[0],400,0.1);
  });
  test("root transform is applied", function () {
    var r = SvgImport.parseSvgText('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" transform="translate(10 20)"><line x1="0" y1="0" x2="10" y2="10"/></svg>', {width:100,height:100});
    var s = r.paths[0].subpaths[0].segments[0];
    approx(s.p0[0],10,0.01); approx(s.p0[1],20,0.01);
  });
  test("horizontal no-viewBox geometry fits and centers", function () {
    var r = SvgImport.parseSvgText('<svg xmlns="http://www.w3.org/2000/svg"><line x1="1000" y1="1000" x2="1100" y2="1000"/></svg>', {width:400,height:300});
    var s = r.paths[0].subpaths[0].segments[0];
    approx(s.p0[0],0,0.1); approx(s.p1[0],400,0.1); approx(s.p0[1],150,0.1);
  });

  function run(report) {
    var results = [];
    TESTS.forEach(function (t) {
      try { t.fn(); results.push({name: t.name, ok: true}); }
      catch (err) { results.push({name: t.name, ok: false, error: err && err.message ? err.message : String(err)}); }
    });
    if (typeof report === "function") report(results);
    return results;
  }

  root.SvgImportTests = {
    tests: TESTS,
    run: run,
    assert: assert,
    approx: approx,
    assertThrows: assertThrows
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.SvgImportTests;
})(typeof window !== "undefined" ? window : globalThis);
