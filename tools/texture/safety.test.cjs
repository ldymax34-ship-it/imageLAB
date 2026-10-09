const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("./engine.js");

test("untrusted configuration cannot address inherited map keys", () => {
  const bad = JSON.parse('{"__proto__":{},"constructor":"x","toString":"x","ink":"<script>","width":-2,"seam":"bad"}');
  const s = E.normalize(bad);
  assert.equal(Object.getPrototypeOf(s), Object.prototype);
  assert.equal(s.width, 200);
  assert.equal(s.ink, E.defaults.ink);
  assert.equal(s.seam, E.defaults.seam);
  for (const v of [null, [], "not a config", true]) assert.deepEqual(E.normalize(v), E.defaults);
});

test("hexagonal square cells retain clearance between adjacent rows", () => {
  const model = E.generate({...E.defaults, width:200, height:200, grid:"hex", shape:"square",
    spacing:12, diameter:24, field:"uniform", seam:"none", levels:0});
  assert.ok(model.dots.length > 0);
  for (let i=0; i<model.dots.length; i++) for (let j=i+1; j<model.dots.length; j++) {
    const a=model.dots[i], b=model.dots[j], sum=a.r+b.r;
    const xgap=Math.abs(a.x-b.x)-sum, ygap=Math.abs(a.y-b.y)-sum;
    assert.ok(xgap>=2-1e-8 || ygap>=2-1e-8, "square edges need 2px clearance on a separating axis");
  }
});

test("image dark/light and inverse maps drive dimensions predictably", () => {
  const s={...E.defaults,width:200,height:200,field:"image",seam:"none",levels:0};
  const dark={width:1,height:1,data:new Float32Array([1])};
  const light={width:1,height:1,data:new Float32Array([0])};
  assert.ok(E.generate(s,dark).dots.length>0);
  assert.equal(E.generate(s,light).dots.length,0);
  assert.equal(E.generate({...s,invert:true},dark).dots.length,0);
});

test("zero fade keeps complete units outside the keep-out boundary", () => {
  for (const shape of ["circle","ellipse","square","diamond"]) {
    const m=E.generate({...E.defaults,width:300,height:200,seam:"diamond",shape,fade:0,keepout:26});
    for(const d of m.dots) {
      const radius=d.r*(shape==="square"?Math.SQRT2:1);
      assert.ok(E.pathDistance(d.x,d.y,m.paths)-radius>=13-1e-8);
    }
  }
});
