/* Node test suite for the pure PatternEngine geometry.
 *
 * Run with: node --test tests.test.cjs
 * The engine is intentionally free of DOM/network dependencies, so it can be
 * required directly in Node.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const PE = require("./engine.js");

const base = (overrides) => PE.normalize(Object.assign({}, PE.defaults, overrides || {}));

/* Small tolerance for float comparisons. */
const EPS = 1e-6;

test("normalize fills defaults, clamps ranges and rejects bad enums", () => {
  const defaults = PE.normalize({});
  assert.equal(defaults.width, PE.defaults.width);
  assert.equal(defaults.grid, "hex");
  assert.equal(defaults.shape, "circle");
  assert.equal(defaults.seam, "wave");

  const clamped = PE.normalize({
    width: 100,          // below min 200
    height: 9999,        // above max 2000
    spacing: 4,          // below min 12
    keepout: 500,        // above max 80
    spread: 12,          // below min 15
    cx: -3,              // clamp to 0
    cy: 4.25,            // clamp to 1
    contrast: 0.05       // below min .3
  });
  assert.equal(clamped.width, 200);
  assert.equal(clamped.height, 2000);
  assert.equal(clamped.spacing, 12);
  assert.equal(clamped.keepout, 80);
  assert.equal(clamped.spread, 15);
  assert.equal(clamped.cx, 0);
  assert.equal(clamped.cy, 1);
  assert.equal(clamped.contrast, 0.3);

  const bad = PE.normalize({
    grid: "triangle",
    shape: "star",
    field: "spiral",
    seam: "zigzag",
    levels: 4,          // only 0/3/5/8 are valid
    scale: 3,           // only 1/2/4 are valid
    ink: "red",
    paper: "#GGGGGG",
    invert: "yes"       // not a boolean
  });
  assert.equal(bad.grid, "hex");
  assert.equal(bad.shape, "circle");
  assert.equal(bad.field, "uniform");
  assert.equal(bad.seam, "wave");
  assert.equal(bad.levels, 0);
  assert.equal(bad.scale, 2);
  assert.equal(bad.ink, PE.defaults.ink);
  assert.equal(bad.paper, PE.defaults.paper);
  assert.equal(bad.invert, PE.defaults.invert);

  const rounded = PE.normalize({ width: 640.4, height: 480.6 });
  assert.equal(rounded.width, 640);
  assert.equal(rounded.height, 481);

  const input = { width: 333, grid: "square", width2: 1 };
  PE.normalize(input);
  assert.deepEqual(input, { width: 333, grid: "square", width2: 1 });
});

test("normalize keeps every valid discrete option", () => {
  ["circle", "ellipse", "square", "diamond"].forEach((shape) => {
    assert.equal(base({ shape }).shape, shape);
  });
  ["hex", "square"].forEach((grid) => assert.equal(base({ grid }).grid, grid));
  ["radial", "linear", "wave", "uniform", "image"].forEach((field) => {
    assert.equal(base({ field }).field, field);
  });
  ["none", "diamond", "wave"].forEach((seam) => assert.equal(base({ seam }).seam, seam));
  [0, 3, 5, 8].forEach((levels) => assert.equal(base({ levels }).levels, levels));
  [1, 2, 4].forEach((scale) => assert.equal(base({ scale }).scale, scale));
});

test("generate is deterministic for identical settings", () => {
  const settings = base({
    width: 640, height: 480, grid: "square", shape: "diamond",
    field: "wave", seam: "diamond", seamScale: 240, keepout: 24, fade: 70,
    spacing: 26, diameter: 15, levels: 3, contrast: 1.7, cx: 0.42, cy: 0.61
  });

  const first = PE.generate(settings);
  const second = PE.generate(settings);
  assert.deepEqual(first.dots, second.dots);
  assert.deepEqual(first.paths, second.paths);
  assert.equal(first.coverage, second.coverage);
  assert.equal(first.maxDiameter, second.maxDiameter);

  // Re-creating the input in a different key order must not change output.
  const reordered = PE.generate(Object.assign({}, { cy: 0.61, cx: 0.42 }, settings));
  assert.deepEqual(first.dots, reordered.dots);
  assert.equal(PE.toSVG(first), PE.toSVG(reordered));
});

test("every dot is finite, positive and fully inside the canvas", () => {
  const shapes = ["circle", "ellipse", "square", "diamond"];
  const grids = ["hex", "square"];
  const fields = ["radial", "linear", "wave", "uniform"];
  const seams = ["none", "wave", "diamond"];

  shapes.forEach((shape) => {
    grids.forEach((grid) => {
      fields.forEach((field) => {
        seams.forEach((seam) => {
          const settings = base({
            shape, grid, field, seam, width: 420, height: 300,
            spacing: 24, diameter: 14, keepout: seam === "none" ? 0 : 20, fade: 60
          });
          const scene = PE.generate(settings);
          assert.ok(scene.dots.length > 0, shape + "/" + grid + "/" + field + "/" + seam + " produced dots");
          scene.dots.forEach((dot) => {
            assert.ok(Number.isFinite(dot.x) && Number.isFinite(dot.y) && Number.isFinite(dot.r));
            assert.ok(dot.r > 0);
            assert.ok(dot.r <= scene.maxDiameter / 2 + EPS);
            assert.ok(dot.x - dot.r >= -EPS, "left edge");
            assert.ok(dot.y - dot.r >= -EPS, "top edge");
            assert.ok(dot.x + dot.r <= settings.width + EPS, "right edge");
            assert.ok(dot.y + dot.r <= settings.height + EPS, "bottom edge");
          });
          assert.ok(Number.isFinite(scene.coverage) && scene.coverage >= 0);
          scene.paths.forEach((path) => {
            path.forEach((point) => {
              assert.ok(Number.isFinite(point[0]) && Number.isFinite(point[1]));
            });
          });
        });
      });
    });
  });
});

test("image mode consumes a darkness sample and stays bounded", () => {
  const settings = base({ field: "image", width: 300, height: 200, spacing: 20, diameter: 12, seam: "none" });
  const allDark = { width: 8, height: 8, data: new Float32Array(64).fill(1) };
  const darkScene = PE.generate(settings, allDark);
  assert.ok(darkScene.dots.length > 0);
  darkScene.dots.forEach((dot) => {
    assert.ok(Number.isFinite(dot.x) && Number.isFinite(dot.y) && Number.isFinite(dot.r));
    assert.ok(dot.r > 0 && dot.r <= darkScene.maxDiameter / 2 + EPS);
  });

  const allWhite = { width: 8, height: 8, data: new Float32Array(64).fill(0) };
  const whiteScene = PE.generate(settings, allWhite);
  assert.equal(whiteScene.dots.length, 0);
});

test("levels quantize radii to the requested number of steps", () => {
  const settings = base({
    levels: 5, field: "radial", seam: "none",
    width: 600, height: 400, spacing: 18, diameter: 12, spread: 90
  });
  const scene = PE.generate(settings);
  const maxR = Math.min(settings.diameter, settings.spacing - 2) / 2;
  const step = maxR / settings.levels;

  assert.ok(scene.dots.length > 0);
  scene.dots.forEach((dot) => {
    const ratio = dot.r / step;
    assert.ok(Math.abs(ratio - Math.round(ratio)) < EPS, "radius " + dot.r + " is not on the step grid");
  });

  const distinct = new Set(scene.dots.map((dot) => Math.round(dot.r / step)));
  assert.ok(distinct.size <= settings.levels);
  assert.ok(distinct.size > 1, "radial fade should use more than one level");
});

test("seam keep-out is respected, including square corner bounds", () => {
  ["circle", "square", "diamond"].forEach((shape) => {
    const settings = base({
      shape, seam: "wave", keepout: 30, fade: 80,
      width: 800, height: 600, spacing: 22, diameter: 16,
      levels: 0, field: "radial"
    });
    const scene = PE.generate(settings);
    const bound = shape === "square" ? Math.SQRT2 : 1;
    const halfKeepout = settings.keepout / 2;

    assert.ok(scene.dots.length > 0, shape + " produced dots");
    scene.dots.forEach((dot) => {
      const distance = PE.pathDistance(dot.x, dot.y, scene.paths);
      assert.ok(distance >= halfKeepout - EPS, shape + " center enters keep-out");
      assert.ok(
        distance - halfKeepout >= dot.r * bound - EPS,
        shape + " shape overlaps the seam (r=" + dot.r + ", d=" + distance + ")"
      );
    });
  });

  // The square shape must stay clear by its diagonal radius, not just its
  // half-width, for diamond quilting too.
  const diamondSeam = base({
    shape: "square", seam: "diamond", keepout: 26, fade: 100,
    width: 700, height: 520, spacing: 24, diameter: 18, levels: 0, field: "uniform"
  });
  const diamondScene = PE.generate(diamondSeam);
  const halfKeepout = diamondSeam.keepout / 2;
  assert.ok(diamondScene.dots.length > 0);
  diamondScene.dots.forEach((dot) => {
    const distance = PE.pathDistance(dot.x, dot.y, diamondScene.paths);
    assert.ok(distance >= halfKeepout - EPS);
    assert.ok(distance - halfKeepout >= dot.r * Math.SQRT2 - EPS);
  });
});

test("SVG renders the requested shapes", () => {
  const shapes = [
    ["circle", "<circle "],
    ["ellipse", "<ellipse "],
    ["square", "<rect "],
    ["diamond", "<path "]
  ];
  shapes.forEach(([shape, token]) => {
    const settings = base({ shape, transparent: true, seam: "none", width: 300, height: 200, spacing: 20, diameter: 10 });
    const scene = PE.generate(settings);
    const svg = PE.toSVG(scene);
    assert.ok(scene.dots.length > 0);
    assert.ok(svg.indexOf(token) !== -1, shape + " should emit " + token);
    if (shape === "square") {
      assert.equal((svg.match(/<rect /g) || []).length, scene.dots.length);
    }
    if (shape === "circle") {
      assert.equal((svg.match(/<circle /g) || []).length, scene.dots.length);
    }
    if (shape === "ellipse") {
      assert.equal((svg.match(/<ellipse /g) || []).length, scene.dots.length);
    }
    if (shape === "diamond") {
      assert.equal((svg.match(/<path d="M/g) || []).length, scene.dots.length);
      assert.ok(svg.indexOf("Z") !== -1, "diamond paths should close");
    }
  });
});

test("SVG background follows the transparency setting", () => {
  const opaque = PE.generate(base({
    shape: "circle", transparent: false, seam: "none",
    width: 300, height: 200, paper: "#123456"
  }));
  const opaqueSvg = PE.toSVG(opaque);
  assert.ok(opaqueSvg.indexOf('<rect width="300" height="200" fill="#123456"/>') !== -1);
  assert.ok(opaqueSvg.indexOf('viewBox="0 0 300 200"') !== -1);

  const clear = PE.generate(base({
    shape: "circle", transparent: true, seam: "none",
    width: 300, height: 200, paper: "#123456"
  }));
  const clearSvg = PE.toSVG(clear);
  assert.equal(clearSvg.indexOf('fill="#123456"'), -1, "transparent export must not paint a background");
});

test("SVG guides are emitted only when requested", () => {
  const withGuides = PE.generate(base({
    shape: "circle", seam: "wave", exportGuides: true,
    width: 360, height: 240, keepout: 20
  }));
  const guidedSvg = PE.toSVG(withGuides);
  assert.ok(guidedSvg.indexOf('id="seam-guides"') !== -1);
  assert.ok(guidedSvg.indexOf("stroke-dasharray") !== -1);
  assert.ok(guidedSvg.indexOf("canvas-clip") !== -1);

  const withoutGuides = PE.generate(base({
    shape: "circle", seam: "wave", exportGuides: false,
    width: 360, height: 240, keepout: 20
  }));
  assert.equal(PE.toSVG(withoutGuides).indexOf("seam-guides"), -1);

  // The explicit option wins over the stored exportGuides setting.
  assert.equal(PE.toSVG(withGuides, { guides: false }).indexOf("seam-guides"), -1);
  assert.ok(PE.toSVG(withoutGuides, { guides: true }).indexOf("seam-guides") !== -1);

  // A model without seam paths never emits a guide group.
  const noSeam = PE.generate(base({ seam: "none", exportGuides: true }));
  assert.equal(PE.toSVG(noSeam, { guides: true }).indexOf("seam-guides"), -1);
});
