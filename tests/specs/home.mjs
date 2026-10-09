/**
 * 首页 smoke：大标题 / 分类 / 搜索可用；每张卡片都有封面位（真实封面或明确占位，不许破图），
 * 且每个进入链接真的可达（HTTP 200）。这条测试保证「只列已可用入口」这条规则被真正执行。
 *
 * 封面说明：真实封面由验收阶段用工具的真实导出画面生成（`node scripts/capture-covers.mjs`）。
 * 尚未生成时首页显示中性文字占位，此项会如实报出「待生成」清单而不是伪造通过。
 */
export const id = "home";
export const title = "首页 ImageLAB";
export const gpu = null;

export async function run({ page, base, browser, check, sleep }) {
  const res = await page.goto(`${base}/index.html`, { waitUntil: "networkidle2", timeout: 60000 });
  check.ok("首页可进入（HTTP 200）", res && res.status() === 200, `status=${res && res.status()}`);
  check.ok("标题正确", (await page.title()).includes("ImageLAB"), await page.title());

  // hero 直接使用已批准的 ImageLAB 字标（h1 内图片，alt 提供可访问名）
  const hero = await page
    .$eval("h1 img", (n) => ({ alt: n.alt, natural: [n.naturalWidth, n.naturalHeight] }))
    .catch(() => null);
  check.ok(
    "hero 使用 ImageLAB 字标（h1 + alt 可访问）",
    !!hero && hero.alt === "ImageLAB" && hero.natural[0] > 0,
    hero ? `alt=${hero.alt} ${hero.natural.join("×")}` : "未找到 h1 img"
  );

  await page.waitForSelector(".card", { timeout: 15000 });
  const cardCount = await page.$$eval(".card", (n) => n.length);
  check.ok("工具卡片数量 ≥ 1", cardCount >= 1, `${cardCount} 张`);

  // 分类筛选：选中某分类后，页面上只应出现该分类的卡片
  const filterCount = await page.$$eval("#filters button", (n) => n.length);
  check.ok("存在分类筛选按钮", filterCount >= 2, `${filterCount} 个`);
  const pickedCat = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("#filters button")];
    const hit = btns.find((b) => b.textContent.trim() !== "全部");
    if (!hit) return null;
    hit.click();
    return hit.textContent.trim();
  });
  await sleep(300);
  const catCheck = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".card")];
    return {
      count: cards.length,
      cats: [...new Set(cards.map((c) => (c.querySelector(".cat") || {}).textContent || ""))]
    };
  });
  check.ok(
    "选择分类后只显示该分类",
    catCheck.count >= 1 && catCheck.cats.every((c) => c.startsWith(pickedCat)),
    `选中「${pickedCat}」→ ${catCheck.count} 张，类别=${JSON.stringify(catCheck.cats)}`
  );
  await page.$$eval("#filters button", (btns) => {
    const all = btns.find((b) => b.textContent.trim() === "全部");
    if (all) all.click();
  });
  await sleep(200);
  const backToAll = await page.$$eval(".card", (n) => n.length);
  check.ok("切回「全部」恢复所有卡片", backToAll === cardCount, `${backToAll} 张`);

  // 搜索
  await page.type("#q", "zzzz-no-such-tool", { delay: 10 });
  await sleep(300);
  const emptyShown = await page.$(".empty");
  check.ok("搜索无结果时给出空态", !!emptyShown);
  await page.$eval("#q", (n) => {
    n.value = "";
    n.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(300);
  const restored = await page.$$eval(".card", (n) => n.length);
  check.ok("清空搜索后卡片恢复", restored === cardCount, `${restored} 张`);

  // 每张卡片都必须有「封面位」：要么是加载成功的真实封面，要么是明确的中性占位，
  // 不允许出现破图或 0 尺寸的 img（占位是首页对「封面尚未生成」的显式表达，不是伪装的效果图）。
  await sleep(400);
  const covers = await page.$$eval(".card", (cards) =>
    cards.map((c) => {
      const img = c.querySelector("img");
      const link = c.querySelector("a.enter");
      const shot = c.querySelector(".shot");
      return {
        name: (c.querySelector("h3") || {}).textContent || "?",
        cover: img ? img.currentSrc || img.src : null,
        natural: img ? [img.naturalWidth, img.naturalHeight] : [0, 0],
        fallback: !!(shot && shot.classList.contains("is-cover-missing")),
        broken: !!img && img.complete && img.naturalWidth === 0,
        href: link ? link.getAttribute("href") : null
      };
    })
  );
  const realCovers = covers.filter((c) => c.natural[0] > 0);
  const pendingCovers = covers.filter((c) => !c.natural[0] && c.fallback);
  const noSlot = covers.filter((c) => !c.natural[0] && !c.fallback);
  check.ok(
    "每张卡片都有封面位（无破图、无 0 尺寸）",
    noSlot.length === 0 && covers.every((c) => !c.broken),
    `真实封面 ${realCovers.length}/${covers.length}` +
      (pendingCovers.length ? `；待生成：${pendingCovers.map((c) => c.name).join("、")}` : "")
  );

  // 每个入口链接都要真的可达
  for (const c of covers) {
    if (!c.href) {
      check.ok(`「${c.name}」有进入链接`, false, "缺少 a.enter");
      continue;
    }
    const url = new URL(c.href, `${base}/index.html`).href;
    const r = await page.evaluate(async (u) => {
      try {
        const resp = await fetch(u, { method: "GET" });
        return resp.status;
      } catch (e) {
        return String(e);
      }
    }, url);
    check.ok(`「${c.name}」入口可达`, r === 200, `${c.href} → ${r}`);
  }

  // 封面不能是「空白 / 纯色 / 破图」占位。
  // 注意：像素化、抖动、半调类工具的产物本身就是低色数（可能只有 4 色），
  // 因此判定标准是「有结构」而非「色数多」：至少 3 个色彩簇，且单一色彩占比不能接近 100%。
  if (covers.length) {
    const coverStats = await page.evaluate(async () => {
      const out = [];
      for (const img of document.querySelectorAll(".card img")) {
        if (!img.naturalWidth) continue;
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const x = c.getContext("2d");
        x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        const counts = new Map();
        let sum = 0;
        const px = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          const k = `${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`;
          counts.set(k, (counts.get(k) || 0) + 1);
          sum += d[i] + d[i + 1] + d[i + 2];
        }
        let top = 0;
        for (const v of counts.values()) if (v > top) top = v;
        out.push({
          src: img.currentSrc || img.src,
          colors: counts.size,
          dominantShare: +(top / px).toFixed(3),
          meanLuma: +(sum / (px * 3)).toFixed(1)
        });
      }
      return out;
    });
    for (const s of coverStats) {
      const name = s.src.split("/").pop();
      check.ok(`封面有内容 (${name})`, s.colors >= 3 && s.dominantShare < 0.995, `色彩簇=${s.colors} 单色占比=${s.dominantShare} 平均亮度=${s.meanLuma}`);
      check.ok(`封面不是纯色块 (${name})`, s.dominantShare < 0.995, `单色占比=${s.dominantShare}`);
    }
  }
}
