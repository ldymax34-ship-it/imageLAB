const {test}=require("node:test");
const assert=require("node:assert/strict");
const {splitPathData}=require("./svg-path-data.js");
test("nearby moveto never creates an unrequested connecting line",()=>{
  const p=splitPathData("M0 0L10 0M10.1 0L20 0");
  assert.equal(p.length,2);
  assert.equal(p[1].d,"M 10.1 0 L 20 0");
});
test("relative moveto resolves against previous subpath endpoint",()=>{
  const p=splitPathData("m10 20 30 40 m5 6 l7 8z");
  assert.deepEqual(p,[{d:"M 10 20 L 40 60",closed:false},{d:"M 45 66 L 52 74 Z",closed:true}]);
});
test("relative curves retain native curve commands and correct coordinates",()=>{
  const p=splitPathData("M10 20 c1 2 3 4 5 6 s3 4 5 6 q3 4 5 6 t5 6 h10 v-10");
  assert.equal(p[0].d,"M 10 20 C 11 22 13 24 15 26 S 18 30 20 32 Q 23 36 25 38 T 30 44 H 40 V 34");
});
test("compact arc flags and scientific notation remain legal",()=>{
  const p=splitPathData("M1e2-20 a30 40 0 0110 20");
  assert.equal(p[0].d,"M 100 -20 A 30 40 0 0 1 110 0");
});
test("invalid, truncated, negative-radius and overbudget commands reject",()=>{
  for(const s of ["L0 0","M0 0C1 2","M0 0A-1 3 0 0 1 4 5","M0 0R1 2","M0 0A1 1 0 2 0 2 2","M0 0L1e309 2"]) {
    assert.throws(()=>splitPathData(s));
  }
  assert.throws(()=>splitPathData("M0 0L1 1L2 2",2));
});
