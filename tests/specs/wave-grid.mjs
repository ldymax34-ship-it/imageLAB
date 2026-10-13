/**
 * 辉光点阵：竖幅网格密度真值、宽厚分段色带、辉光长度 / 方向 / 强度独立、
 * 黑留白、字母高度、非法上传保留、暂停 / 隐藏 / 缩放与当前帧 PNG 像素一致。
 *
 * 全部断言都基于真实像素（不是 PNG 字符串前缀或单个 flag）。
 */
import { pngInfo } from "../harness.mjs";

export const id = "wave-grid";
export const title = "辉光点阵";
export const gpu = null;

const SETTLE = 280;

export async function run({ page, base, downloads, check, sleep }) {
  const res = await page.goto(`${base}/tools/wave-grid/index.html`, { waitUntil: "networkidle2", timeout: 60000 });
  check.ok("入口可达", !!res && res.status() === 200);
  check.ok("标题为辉光点阵", (await page.title()).includes("辉光点阵"));
  await page.waitForFunction(() => window.imagelab?.ready);
  await sleep(400);

  // 页面内像素度量：全部在浏览器里解码，只把小数返回 Node。
  await page.evaluate(() => {
    window.__wg = {
      decode(src) {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const c = document.createElement("canvas");
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const x = c.getContext("2d");
            x.drawImage(img, 0, 0);
            resolve({ w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data });
          };
          img.onerror = reject;
          img.src = src;
        });
      },
      async summary(src) {
        const { w, h, data } = await this.decode(src);
        let black = 0;
        let lit = 0;
        let halo = 0;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          sum += l;
          if (l < 14) black += 1;
          if (l > 90) lit += 1;
          if (l >= 14) halo += 1;
        }
        const px = w * h;
        return { w, h, black: black / px, lit: lit / px, halo: halo / px, mean: sum / px };
      },
      // 低亮光斑 halo 的空间方差与包围范围：用于在「单个居中白点」上判断辉光轴向。
      async haloAxes(src, threshold = 16) {
        const { w, h, data } = await this.decode(src);
        let n = 0;
        let sx = 0;
        let sy = 0;
        let sxx = 0;
        let syy = 0;
        let minX = w;
        let maxX = -1;
        let minY = h;
        let maxY = -1;
        for (let y = 0; y < h; y += 1) {
          for (let x = 0; x < w; x += 1) {
            const i = (y * w + x) * 4;
            const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            if (l <= threshold) continue;
            n += 1;
            sx += x;
            sy += y;
            sxx += x * x;
            syy += y * y;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        if (!n) return { n: 0, vx: 0, vy: 0, w: 0, h: 0 };
        const mx = sx / n;
        const my = sy / n;
        return { n, vx: sxx / n - mx * mx, vy: syy / n - my * my, w: maxX - minX + 1, h: maxY - minY + 1 };
      },
      // glow-only 差异：同一输入在辉光 1 / 0 两张暂停帧上做逐通道相加差。
      // sharp 层两帧一致、相减抵消，只剩纯发光能量，因此可用来统计 halo 的色相与增益。
      async glowDiff(onSrc, offSrc, floor = 2) {
        const A = await this.decode(onSrc);
        const B = await this.decode(offSrc);
        if (A.w !== B.w || A.h !== B.h) return { n: 0, r: 0, g: 0, b: 0, colored: 0, mean: 0 };
        let n = 0;
        let colored = 0;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let sum = 0;
        for (let i = 0; i < A.data.length; i += 4) {
          const dr = Math.max(0, A.data[i] - B.data[i]);
          const dg = Math.max(0, A.data[i + 1] - B.data[i + 1]);
          const db = Math.max(0, A.data[i + 2] - B.data[i + 2]);
          const l = dr * 0.299 + dg * 0.587 + db * 0.114;
          sum += l;
          if (l <= floor) continue;
          n += 1;
          sr += dr;
          sg += dg;
          sb += db;
          const spread = Math.max(dr, dg, db) - Math.min(dr, dg, db);
          if (spread >= 3) colored += 1;
        }
        return {
          n,
          r: n ? sr / n : 0,
          g: n ? sg / n : 0,
          b: n ? sb / n : 0,
          colored: n ? colored / n : 0,
          mean: sum / (A.w * A.h)
        };
      },
      async diff(a, b) {
        const A = await this.decode(a);
        const B = await this.decode(b);
        if (A.w !== B.w || A.h !== B.h) return { same: false, differing: -1, total: A.w * A.h };
        let differing = 0;
        for (let i = 0; i < A.data.length; i += 4) {
          if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2]) differing += 1;
        }
        return { same: differing === 0, differing, total: A.w * A.h };
      },
      async identical(a, b) {
        const A = await this.decode(a);
        const B = await this.decode(b);
        if (A.w !== B.w || A.h !== B.h) return false;
        for (let i = 0; i < A.data.length; i += 1) if (A.data[i] !== B.data[i]) return false;
        return true;
      },
      async colorFamilies(src) {
        const refs = [[49, 166, 255], [237, 88, 255], [255, 74, 89], [72, 244, 199]];
        const { data } = await this.decode(src);
        const counts = [0, 0, 0, 0];
        let colored = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (Math.min(r, g, b) > 195) continue;
          if (r + g + b < 70) continue;
          let best = 0;
          let dist = Infinity;
          for (let k = 0; k < 4; k += 1) {
            const dr = r - refs[k][0];
            const dg = g - refs[k][1];
            const db = b - refs[k][2];
            const d = dr * dr + dg * dg + db * db;
            if (d < dist) {
              dist = d;
              best = k;
            }
          }
          counts[best] += 1;
          colored += 1;
        }
        return { counts, colored };
      },
      async glyphBox(src, threshold = 120) {
        const { w, h, data } = await this.decode(src);
        let top = h;
        let bottom = -1;
        let lit = 0;
        for (let y = 0; y < h; y += 1) {
          for (let x = 0; x < w; x += 1) {
            const i = (y * w + x) * 4;
            const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            if (l > threshold) {
              if (y < top) top = y;
              if (y > bottom) bottom = y;
              lit += 1;
            }
          }
        }
        return { height: bottom >= top ? bottom - top + 1 : 0, frame: h, lit };
      }
    };
  });

  const setRange = async (selector, value) => {
    await page.$eval(selector, (n, v) => {
      n.value = String(v);
      n.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  };
  const stats = () => page.evaluate(() => window.imagelab.stats());
  const snap = () => page.evaluate(() => window.imagelab.snapshot());
  const box = (sel) => page.$eval(sel, (n) => ({ w: n.clientWidth, h: n.clientHeight, pw: n.width, ph: n.height }));

  // 先暂停：所有像素比较都在静止帧上进行。
  await page.click("#btn-pause");
  await sleep(120);

  /* ---------- 1. 竖幅与默认密度 ---------- */
  const stage = await box("#stage");
  const canvasBox = await box("#wave-canvas");
  check.ok("默认竖幅 4:5 且最大宽 720 居中", stage.w <= 720 && Math.abs(stage.w / stage.h - 0.8) < 0.03, `${stage.w}×${stage.h}`);
  check.ok("画布像素尺寸有效且单边 ≤1600", canvasBox.pw > 0 && canvasBox.ph > 0 && canvasBox.pw <= 1600 && canvasBox.ph <= 1600, `${canvasBox.pw}×${canvasBox.ph}`);
  const initial = await stats();
  check.ok("默认约 9px 间距、7px 左右字形", initial.spacing >= 8.4 && initial.spacing <= 9.8, `${initial.spacing.toFixed(2)}px`);
  check.ok("默认格点数不超过 12000", initial.cells > 4000 && initial.cells <= 12000, `${initial.cols}×${initial.rows}=${initial.cells}`);
  check.ok("每帧低分辨率 drawImage 在 8–16 次预算内", initial.drawCalls > 0 && initial.drawCalls <= 16, `drawCalls=${initial.drawCalls}`);

  /* ---------- 2. 密度真值：低 / 中 / 高分别改变格数与画面 ---------- */
  const densityShots = {};
  const densityData = [];
  for (const [label, value] of [["low", 0.12], ["mid", 0.55], ["high", 0.95]]) {
    await setRange("#p-density", value);
    await sleep(SETTLE);
    const s = await stats();
    densityShots[label] = await snap();
    densityData.push({ label, cells: s.cells, spacing: s.spacing });
  }
  check.ok(
    "密度低 / 中 / 高格数严格单调递增",
    densityData[0].cells < densityData[1].cells && densityData[1].cells < densityData[2].cells,
    densityData.map((d) => `${d.label}:${d.cells}`).join(" < ")
  );
  check.ok(
    "密度低 / 中 / 高间距严格单调递减",
    densityData[0].spacing > densityData[1].spacing && densityData[1].spacing > densityData[2].spacing,
    densityData.map((d) => `${d.label}:${d.spacing.toFixed(2)}`).join(" > ")
  );
  const dLowMid = await page.evaluate(([a, b]) => window.__wg.diff(a, b), [densityShots.low, densityShots.mid]);
  const dMidHigh = await page.evaluate(([a, b]) => window.__wg.diff(a, b), [densityShots.mid, densityShots.high]);
  check.ok(
    "密度档位之间画面真实不同（非同一网格）",
    dLowMid.differing > dLowMid.total * 0.02 && dMidHigh.differing > dMidHigh.total * 0.02,
    `低↔中 ${dLowMid.differing}，中↔高 ${dMidHigh.differing}`
  );

  /* ---------- 3. 粗 / 中 / 细预设按钮与同一参数同步 ---------- */
  const presetCells = {};
  for (const [button, key] of [["#preset-coarse", "coarse"], ["#preset-medium", "medium"], ["#preset-fine", "fine"]]) {
    await page.click(button);
    await sleep(SETTLE);
    const s = await stats();
    presetCells[key] = s.cells;
    const pressed = await page.$eval(button, (n) => n.getAttribute("aria-pressed"));
    const slider = await page.$eval("#p-density", (n) => Number(n.value));
    check.ok(`${button} 高亮且与密度控件同步`, pressed === "true" && Math.abs(slider - s.density) < 0.001, `density=${s.density}`);
  }
  check.ok("粗 / 中 / 细预设真正改变格数", presetCells.coarse < presetCells.medium && presetCells.medium < presetCells.fine, `${presetCells.coarse} < ${presetCells.medium} < ${presetCells.fine}`);

  /* ---------- 4. 移动 390 宽下密度仍真实改变 ---------- */
  await page.setViewport({ width: 390, height: 844 });
  await sleep(360);
  await setRange("#p-density", 0.55);
  await sleep(SETTLE);
  const mobileStage = await box("#stage");
  const mobileMid = await stats();
  await setRange("#p-density", 0.92);
  await sleep(SETTLE);
  const mobileFine = await stats();
  check.ok("移动窄屏画布自适应且不超过 720", mobileStage.w <= 390 && mobileStage.w >= 240 && Math.abs(mobileStage.w / mobileStage.h - 0.8) < 0.05, `${mobileStage.w}×${mobileStage.h}`);
  check.ok("移动窄屏密度高 → 格数更多", mobileFine.cells > mobileMid.cells, `${mobileMid.cells} → ${mobileFine.cells}`);
  await page.setViewport({ width: 1440, height: 960 });
  await sleep(400);
  await page.click("#preset-medium");
  await sleep(SETTLE);

  /* ---------- 5. 辉光强度：0 无光、独立于长度 ---------- */
  await setRange("#p-glow", 1);
  await setRange("#p-glowLength", 0);
  await setRange("#p-glowAngle", 90);
  await sleep(SETTLE);
  const bloomOnly = await snap();
  const bloomFrame = await stats();
  await setRange("#p-glow", 0);
  await sleep(SETTLE);
  const noGlow = await snap();
  const noGlowFrame = await stats();
  const bloomStats = await page.evaluate((s) => window.__wg.summary(s), bloomOnly);
  const noneStats = await page.evaluate((s) => window.__wg.summary(s), noGlow);
  const glowDiff = await page.evaluate(([a, b]) => window.__wg.diff(a, b), [noGlow, bloomOnly]);
  check.ok("辉光强度 0 时只有锐利字形（无 bloom / 拉丝）", noGlowFrame.drawCalls === 1 && noGlowFrame.glow === 0, `drawCalls=${noGlowFrame.drawCalls}`);
  check.ok(
    "辉光强度 0 与 1 真实像素不同且亮区更大",
    glowDiff.differing > glowDiff.total * 0.01 && bloomStats.mean > noneStats.mean,
    `differing=${glowDiff.differing}，mean ${noneStats.mean.toFixed(2)} → ${bloomStats.mean.toFixed(2)}`
  );
  check.ok("长度 0 时保留圆形 bloom（不是全黑）", bloomStats.lit > noneStats.lit, `lit ${noneStats.lit.toFixed(4)} → ${bloomStats.lit.toFixed(4)}`);
  check.ok("有辉光时每帧 drawImage 仍 ≤16", bloomFrame.drawCalls > 1 && bloomFrame.drawCalls <= 16, `drawCalls=${bloomFrame.drawCalls}`);

  /* ---------- 5b. 辉光强度高段 0.6 / 0.8 / 1 连续（旧 clamp 死区回归） ---------- */
  // 旧实现把 3.6 增益乘进最终合成 alpha 再 clamp，glow≥0.56 时三档都截到 1、画面逐像素相同，
  // 复现用户「参数不能选」。现在增益放在低分辨率缓存曝光阶段，最终 alpha 随 glow 严格单调连续变化。
  await setRange("#p-glowLength", 72);
  await setRange("#p-glowAngle", 90);
  const glowTicks = [];
  for (const value of [0.6, 0.8, 1]) {
    await setRange("#p-glow", value);
    await sleep(SETTLE);
    const shot = await snap();
    const summary = await page.evaluate((s) => window.__wg.summary(s), shot);
    glowTicks.push({ value, shot, mean: summary.mean });
  }
  const tick68 = await page.evaluate(([a, b]) => window.__wg.diff(a, b), [glowTicks[0].shot, glowTicks[1].shot]);
  const tick81 = await page.evaluate(([a, b]) => window.__wg.diff(a, b), [glowTicks[1].shot, glowTicks[2].shot]);
  check.ok(
    "辉光强度 0.6 / 0.8 / 1 停顿 PNG 两两不同（不再是 clamp 死区同一帧）",
    !tick68.same && !tick81.same && tick68.differing > tick68.total * 0.005 && tick81.differing > tick81.total * 0.005,
    `0.6↔0.8 改变 ${tick68.differing}，0.8↔1 改变 ${tick81.differing}`
  );
  check.ok(
    "辉光强度 0.6 / 0.8 / 1 平均亮度严格递增（至少小幅变亮）",
    glowTicks[0].mean < glowTicks[1].mean && glowTicks[1].mean < glowTicks[2].mean,
    glowTicks.map((t) => `${t.value}=${t.mean.toFixed(2)}`).join(" < ")
  );

  /* ---------- 6. 辉光长度与方向：在自制透明小光点上验证轴向 ---------- */
  // 用程序生成的透明画幅（中心一个白色小方块，非真实用户素材）载入并自动 alpha 取样；
  // 整幅只有一个居中光斑，避免色带自身的斜向协方差把「90° 纵向」误判成横向铺开。
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 120;
    c.height = 120;
    const x = c.getContext("2d");
    x.clearRect(0, 0, 120, 120);
    x.fillStyle = "#ffffff";
    x.fillRect(56, 56, 8, 8);
    const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
    const input = document.querySelector("#image-file");
    const data = new DataTransfer();
    data.items.add(new File([blob], "centered-dot.png", { type: "image/png" }));
    input.files = data.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => window.imagelab.hasImage() && window.imagelab.stats().alphaMode);
  await sleep(SETTLE);

  // 暂停状态下对同一输入只改长度 / 角度。
  await setRange("#p-glow", 1);
  await setRange("#p-glowAngle", 90);
  await setRange("#p-glowLength", 0);
  await sleep(SETTLE);
  const dot0 = await snap();
  await setRange("#p-glowLength", 120);
  await sleep(SETTLE);
  const dotVertical = await snap();
  await setRange("#p-glowAngle", 0);
  await sleep(SETTLE);
  const dotHorizontal = await snap();

  const axes0 = await page.evaluate((s) => window.__wg.haloAxes(s), dot0);
  const axesV = await page.evaluate((s) => window.__wg.haloAxes(s), dotVertical);
  const axesH = await page.evaluate((s) => window.__wg.haloAxes(s), dotHorizontal);
  const lenDiff = await page.evaluate(([a, b]) => window.__wg.diff(a, b), [dot0, dotVertical]);
  check.ok(
    "光点长度 0 → 120 真实改变纵向分布",
    lenDiff.differing > lenDiff.total * 0.004 && axesV.h > axes0.h && axesV.vy > axes0.vy,
    `改变像素 ${lenDiff.differing}，纵向范围 ${axes0.h} → ${axesV.h}，vy ${axes0.vy.toFixed(0)} → ${axesV.vy.toFixed(0)}`
  );
  check.ok(
    "方向 90° 纵向拉长、0° 横向铺开（光斑 halo 空间方差 / 范围）",
    axesV.vy > axesV.vx * 1.25 && axesV.h > axesV.w &&
      axesH.vx > axesH.vy * 1.25 && axesH.w > axesH.h &&
      axesV.vy > axes0.vy && axesH.vx > axes0.vx,
    `90° vx ${axesV.vx.toFixed(0)} / vy ${axesV.vy.toFixed(0)}（范围 ${axesV.w}×${axesV.h}）；0° vx ${axesH.vx.toFixed(0)} / vy ${axesH.vy.toFixed(0)}（范围 ${axesH.w}×${axesH.h}）`
  );

  // 测完清除自制光点、恢复色带与默认控件，再继续宽核 / 四色 / 后续上传测试。
  await page.click("#image-clear");
  await page.click("#preset-ribbons");
  await setRange("#p-density", 0.55);
  await setRange("#p-glow", 0.55);
  await setRange("#p-glowLength", 72);
  await setRange("#p-glowAngle", 90);
  await setRange("#p-bandWidth", 1);
  await sleep(SETTLE);
  check.ok("清除自制光点后回到色带（不残留图片状态）", !(await page.evaluate(() => window.imagelab.hasImage())));

  /* ---------- 7. 黑留白、宽亮核与四色（默认辉光能量显著高于 0） ---------- */
  await setRange("#p-glowAngle", 90);
  await setRange("#p-glowLength", 72);
  await setRange("#p-glow", 0.55);
  await setRange("#p-density", 0.55);
  await sleep(SETTLE);
  const defaultShot = await snap();
  const defaultStats = await stats();
  const defaultSummary = await page.evaluate((s) => window.__wg.summary(s), defaultShot);
  check.ok("存在大块黑留白（不是全屏均匀亮网格）", defaultSummary.black > 0.2 && defaultSummary.black < 0.75, `黑占比 ${(defaultSummary.black * 100).toFixed(1)}%`);
  // 默认辉光 vs 强度 0：低亮 halo 的亮度 / 覆盖必须显著增加，同时远角黑留白不被整屏染亮。
  await setRange("#p-glow", 0);
  await sleep(SETTLE);
  const offShot = await snap();
  const offSummary = await page.evaluate((s) => window.__wg.summary(s), offShot);
  check.ok(
    "默认辉光相对强度 0 明显提高 halo 亮度与覆盖",
    defaultSummary.mean > offSummary.mean * 1.25 && defaultSummary.halo > offSummary.halo * 1.1 && defaultSummary.lit > offSummary.lit,
    `mean ${offSummary.mean.toFixed(1)} → ${defaultSummary.mean.toFixed(1)}，覆盖 ${(offSummary.halo * 100).toFixed(1)}% → ${(defaultSummary.halo * 100).toFixed(1)}%`
  );
  check.ok("默认辉光下黑色留白仍 >20%", defaultSummary.black > 0.2 && offSummary.black > defaultSummary.black, `关 ${(offSummary.black * 100).toFixed(1)}% → 开 ${(defaultSummary.black * 100).toFixed(1)}%`);
  await setRange("#p-glow", 0.55);
  await sleep(SETTLE);
  check.ok("色块占比约 40–55%（含过渡）", defaultStats.coverage > 0.3 && defaultStats.coverage < 0.66, `亮格 ${(defaultStats.coverage * 100).toFixed(1)}%`);
  const solid = defaultStats.glyphCounts[3];
  const boxGlyph = defaultStats.glyphCounts[2];
  const crossGlyph = defaultStats.glyphCounts[1];
  check.ok(
    "宽亮核由连排实心 ■ 构成，外围有 □ 与 ×",
    solid > defaultStats.cells * 0.05 && boxGlyph > defaultStats.cells * 0.03 && crossGlyph > defaultStats.cells * 0.02,
    `■${solid} □${boxGlyph} ×${crossGlyph}`
  );
  const families = await page.evaluate((s) => window.__wg.colorFamilies(s), defaultShot);
  const shares = families.counts.map((c) => (families.colored ? c / families.colored : 0));
  check.ok(
    "蓝青 / 品红 / 红 / 绿青四色都真实出现",
    families.colored > 0 && shares.every((v) => v > 0.01),
    shares.map((v, i) => `${["蓝", "品红", "红", "绿"][i]}=${(v * 100).toFixed(1)}%`).join(" ")
  );

  /* ---------- 7b. 单色小光点 glow-only halo 保色（unpremultiplied brightness 回归） ---------- */
  // 旧实现对透明辉光缓存做模糊前 brightness(3.6)：Skia 先解预乘，饱和主色（如品红 237/88/255）
  // 每通道都被截到 1，bloom 被冲成灰白。现缓存改为黑底不透明 RGB、曝光移到模糊后的最终 lighter
  // 合成。这里用程序生成的单色小光点（品红 / 红 / 绿青，均取色带主色，非用户素材）验证 halo
  // 的 glow-only 亮度与主色通道关系，避免只看 glyph 本体那几粒颜色就误判辉光保色。
  const haloColors = [
    { label: "品红", hex: "#ed58ff", main: ["r", "b"], weak: ["g"] },
    { label: "红", hex: "#ff4a59", main: ["r"], weak: ["g", "b"] },
    { label: "绿青", hex: "#48f4c7", main: ["g"], weak: ["r"] }
  ];
  await setRange("#p-glowLength", 0);
  await setRange("#p-glowAngle", 90);
  for (const item of haloColors) {
    // 先清掉上一张，保证 waitForFunction 等的是本次新图（hasImage 不会因旧图直接为真）。
    await page.$eval("#image-clear", (n) => n.click());
    await sleep(120);
    await page.evaluate(async (color) => {
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 120;
      const x = c.getContext("2d");
      // 不透明黑底 + 单色小方块：自动走明暗取样，辉光沿用该主色（不是透明轮廓的浅色核）。
      x.fillStyle = "#000000";
      x.fillRect(0, 0, 120, 120);
      x.fillStyle = color;
      x.fillRect(56, 56, 8, 8);
      const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
      const input = document.querySelector("#image-file");
      const data = new DataTransfer();
      data.items.add(new File([blob], "mono-dot.png", { type: "image/png" }));
      input.files = data.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, item.hex);
    await page.waitForFunction(() => window.imagelab.hasImage());
    await page.$eval("#image-sampling", (n) => {
      n.value = "brightness";
      n.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await setRange("#p-glow", 1);
    await sleep(SETTLE);
    const dotOn = await snap();
    const dotOnSummary = await page.evaluate((s) => window.__wg.summary(s), dotOn);
    await setRange("#p-glow", 0);
    await sleep(SETTLE);
    const dotOff = await snap();
    const dotOffSummary = await page.evaluate((s) => window.__wg.summary(s), dotOff);
    const glow = await page.evaluate(([a, b]) => window.__wg.glowDiff(a, b), [dotOn, dotOff]);
    check.ok(
      `${item.label}光点：glow-only 真实增加亮度与覆盖`,
      glow.n > 40 && glow.mean > 0 && dotOnSummary.mean > dotOffSummary.mean && dotOnSummary.halo > dotOffSummary.halo,
      `发光像素 ${glow.n}，mean ${dotOffSummary.mean.toFixed(2)} → ${dotOnSummary.mean.toFixed(2)}，覆盖 ${(dotOffSummary.halo * 100).toFixed(1)}% → ${(dotOnSummary.halo * 100).toFixed(1)}%`
    );
    check.ok(
      `${item.label}光点：halo 保留主色通道关系（大多数不是 R≈G≈B 灰白）`,
      item.main.every((m) => item.weak.every((w) => glow[m] > glow[w] * 1.3)) && glow.colored > 0.5,
      `glow 平均 R${glow.r.toFixed(1)} / G${glow.g.toFixed(1)} / B${glow.b.toFixed(1)}，非灰白 ${(glow.colored * 100).toFixed(1)}%`
    );
  }
  // 清掉自制光点并恢复取样 / 色带状态，避免图片状态影响后续字母与透明 Logo 用例。
  await page.click("#image-clear");
  await page.$eval("#image-sampling", (n) => {
    n.value = "auto";
    n.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.click("#preset-ribbons");
  await setRange("#p-glow", 0.55);
  await setRange("#p-glowLength", 72);
  await sleep(SETTLE);

  /* ---------- 8. 小写 a 居中约 15–20% 高（关辉光只看字形本体） ---------- */
  await setRange("#p-glow", 0);
  await page.click("#preset-letters");
  await sleep(SETTLE);
  const aShot = await snap();
  const aBox = await page.evaluate((s) => window.__wg.glyphBox(s), aShot);
  const aFrac = aBox.height / aBox.frame;
  check.ok("小写 a 高度约画面 15–20%", aBox.lit > 0 && aFrac > 0.13 && aFrac < 0.23, `高度 ${aBox.height}/${aBox.frame} = ${(aFrac * 100).toFixed(1)}%`);
  await page.$eval("#mask-text", (n) => {
    n.value = "imageLAB";
    n.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(SETTLE);
  const lettersShot = await snap();
  const lettersDiff = await page.evaluate(([a, b]) => window.__wg.diff(a, b), [aShot, lettersShot]);
  check.ok("文字图形按固定字符格真实生效", lettersDiff.differing > lettersDiff.total * 0.01, `differing=${lettersDiff.differing}`);
  await page.click("#preset-ribbons");
  await setRange("#p-glow", 0.55);
  await sleep(SETTLE);

  /* ---------- 9. 本地图片合法 / 非法保留 ---------- */
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 48;
    const x = c.getContext("2d");
    x.fillStyle = "#000";
    x.fillRect(28, 10, 40, 28);
    const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
    const input = document.querySelector("#image-file");
    const data = new DataTransfer();
    data.items.add(new File([blob], "transparent-logo.png", { type: "image/png" }));
    input.files = data.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => window.imagelab.hasImage() && window.imagelab.stats().alphaMode);
  await sleep(150);
  check.ok("透明 Logo 自动按 alpha 轮廓取样", await page.evaluate(() => window.imagelab.stats().alphaMode));
  const goodShot = await snap();

  const dispatchFile = async (name, type, bytes) => {
    await page.evaluate(
      ({ name, type, bytes }) => {
        const input = document.querySelector("#image-file");
        const data = new DataTransfer();
        data.items.add(new File([new Uint8Array(bytes)], name, { type }));
        input.files = data.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { name, type, bytes }
    );
    await sleep(220);
  };

  await dispatchFile("bad.gif", "image/gif", [71, 73, 70, 56, 57, 97]);
  check.ok("非白名单类型被拒且保留当前图片", (await page.evaluate(() => window.imagelab.hasImage())) && (await snap()) === goodShot);
  await dispatchFile("fake.png", "image/png", [110, 111, 116, 32, 97, 32, 112, 110, 103]);
  check.ok("伪 PNG 解码失败仍保留当前图片", (await page.evaluate(() => window.imagelab.hasImage())) && (await snap()) === goodShot);
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 4097;
    c.height = 2;
    const x = c.getContext("2d");
    x.fillStyle = "#fff";
    x.fillRect(0, 0, 4097, 2);
    const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
    const input = document.querySelector("#image-file");
    const data = new DataTransfer();
    data.items.add(new File([blob], "too-wide.png", { type: "image/png" }));
    input.files = data.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(420);
  check.ok("单边 >4096 被拒且保留当前图片", (await page.evaluate(() => window.imagelab.hasImage())) && (await snap()) === goodShot);
  await page.click("#image-clear");
  await sleep(SETTLE);
  check.ok("清除图片后回到色带（不残留图片状态）", !(await page.evaluate(() => window.imagelab.hasImage())));

  /* ---------- 10. 暂停 / 隐藏 / 缩放 ---------- */
  await page.click("#btn-pause");
  await sleep(150);
  const pausedBefore = (await stats()).renderCount;
  await sleep(420);
  check.ok("暂停后不再重绘", (await stats()).renderCount === pausedBefore, `renderCount=${pausedBefore}`);

  const beforeResize = await page.evaluate(() => document.querySelector("#wave-canvas").width);
  await page.setViewport({ width: 560, height: 900 });
  await sleep(450);
  const resized = (await stats()).renderCount;
  const afterResize = await page.evaluate(() => document.querySelector("#wave-canvas").width);
  check.ok("暂停下缩放真正改变画布且只重绘一次", afterResize !== beforeResize && resized >= pausedBefore + 1 && resized <= pausedBefore + 2, `画布 ${beforeResize} → ${afterResize}，renderCount ${pausedBefore} → ${resized}`);
  await page.setViewport({ width: 1440, height: 960 });
  await sleep(450);
  await page.click("#preset-medium");
  await sleep(SETTLE);

  await page.click("#btn-play");
  await sleep(220);
  const playing = (await stats()).renderCount;
  await sleep(340);
  check.ok("播放时持续重绘", (await stats()).renderCount > playing);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await sleep(150);
  const hiddenCount = (await stats()).renderCount;
  await sleep(420);
  check.ok("页面隐藏后停止连续重绘", (await stats()).renderCount === hiddenCount, `renderCount=${hiddenCount}`);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await sleep(340);
  check.ok("恢复可见后继续重绘", (await stats()).renderCount > hiddenCount);
  await page.click("#btn-pause");
  await sleep(150);

  /* ---------- 11. 导出 PNG 与当前帧像素一致 ---------- */
  // 暂停下再改一次参数，强制把最后一帧画完并清掉 dirty，确保导出的是快照同一帧。
  await setRange("#p-density", 0.55);
  await sleep(SETTLE);
  const currentShot = await snap();
  const currentDims = await page.evaluate(() => ({ w: document.querySelector("#wave-canvas").width, h: document.querySelector("#wave-canvas").height }));
  await page.click("#btn-export");
  const file = await downloads.waitForFile({ ext: ".png", timeoutMs: 30000 });
  const info = pngInfo(file.bytes);
  check.ok("导出 PNG 与当前画布尺寸相同", info.width === currentDims.w && info.height === currentDims.h, `${info.width}×${info.height}`);
  const exportedDataUrl = `data:image/png;base64,${Buffer.from(file.bytes).toString("base64")}`;
  const identical = await page.evaluate(([a, b]) => window.__wg.identical(a, b), [currentShot, exportedDataUrl]);
  check.ok("导出 PNG 与当前 canvas 快照逐像素一致", identical);
}
