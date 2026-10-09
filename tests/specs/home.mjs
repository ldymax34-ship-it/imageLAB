/**
 * 首页 smoke：大标题 / 分类 / 搜索可用；9 张内置卡片都有封面位（真实封面或明确占位，不许破图），
 * 且每个内置进入链接真的可达（HTTP 200）。这条测试保证「只列已可用入口」这条规则被真正执行。
 *
 * 3 个外部网站入口只做跳转：校验标注 / 按钮文案 / 两处链接 target-rel / 准确网址 / 关键词搜索，
 * 不向外部 URL 发请求（会 CORS 失败），也不纳入本地封面与可达断言。
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
  check.ok("首页共 12 个入口（9 内置 + 3 外部）", cardCount === 12, `${cardCount} 张`);
  const extCardCount = await page.$$eval(".card.is-external", (n) => n.length);
  check.ok("其中外部网站入口 3 个", extCardCount === 3, `${extCardCount} 张`);

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

  // 搜索：tools.js 的 keywords 是字符串（不是数组），首页必须能搜索到相应工具。
  const setSearch = async (value) => {
    await page.$eval(
      "#q",
      (n, v) => {
        n.value = v;
        n.dispatchEvent(new Event("input", { bubbles: true }));
      },
      value
    );
    await sleep(300);
  };

  await setSearch("bayer");
  const bayerHits = await page.$$eval(".card h3", (ns) => ns.map((n) => n.textContent.trim()));
  check.ok(
    "搜索 bayer 命中抖动工具（字符串关键词可搜索）",
    bayerHits.length === 1 && bayerHits[0].includes("抖动"),
    `命中 ${bayerHits.length} 张：${bayerHits.join("、") || "无"}`
  );

  await setSearch("zzzz-no-such-tool");
  const emptyShown = await page.$(".empty");
  check.ok("搜索无结果时给出空态", !!emptyShown);

  await setSearch("");
  const restored = await page.$$eval(".card", (n) => n.length);
  check.ok("清空搜索后卡片恢复", restored === cardCount, `${restored} 张`);

  // 外部网站入口：只做跳转。校验标注、按钮文案、两处链接 target/rel 与准确网址；
  // 不向外部 URL 发请求（会 CORS 失败），也不把外部入口纳入本地封面 / 可达断言。
  const EXPECT_EXTERNAL = [
    { id: "space-type-generator", name: "动态文字", href: "https://spacetypegenerator.com/" },
    { id: "shader-lab", name: "效果堆叠", href: "https://eng.basement.studio/tools/shader-lab" },
    { id: "tooooools", name: "图像网点", href: "https://www.tooooools.app/" }
  ];
  const externalCards = await page.$$eval(".card.is-external", (cards) =>
    cards.map((c) => {
      const shot = c.querySelector("a.shot");
      const enter = c.querySelector("a.enter");
      return {
        id: c.dataset.tool || "",
        shotLabel: (c.querySelector(".shot-external") || {}).textContent || "",
        note: (c.querySelector(".note") || {}).textContent || "",
        hasImg: !!c.querySelector("img"),
        shotHref: shot ? shot.getAttribute("href") : null,
        shotTarget: shot ? shot.getAttribute("target") : null,
        shotRel: shot ? shot.getAttribute("rel") : null,
        enterHref: enter ? enter.getAttribute("href") : null,
        enterTarget: enter ? enter.getAttribute("target") : null,
        enterRel: enter ? enter.getAttribute("rel") : null,
        enterText: enter ? enter.textContent.replace(/\s+/g, " ").trim() : ""
      };
    })
  );
  const relOk = (rel) =>
    (rel || "").split(/\s+/).includes("noopener") && (rel || "").split(/\s+/).includes("noreferrer");
  for (const e of EXPECT_EXTERNAL) {
    const c = externalCards.find((x) => x.id === e.id);
    check.ok(`外部入口「${e.name}」存在`, !!c, c ? "已渲染" : "未找到");
    if (!c) continue;
    check.ok(
      `外部入口「${e.name}」标注为 外部网站 · 跳转官网`,
      c.shotLabel.includes("外部网站") && c.shotLabel.includes("跳转官网") &&
        c.note.includes("外部网站") && c.note.includes("跳转官网"),
      `封面区=${c.shotLabel} / note=${c.note}`
    );
    check.ok(
      `外部入口「${e.name}」按钮为 打开官网 ↗`,
      c.enterText.includes("打开官网") && c.enterText.includes("↗"),
      c.enterText
    );
    check.ok(
      `外部入口「${e.name}」两处链接网址准确`,
      c.shotHref === e.href && c.enterHref === e.href,
      `封面区=${c.shotHref} / 按钮=${c.enterHref}`
    );
    check.ok(
      `外部入口「${e.name}」两处链接 target=_blank + rel=noopener noreferrer`,
      c.shotTarget === "_blank" && c.enterTarget === "_blank" && relOk(c.shotRel) && relOk(c.enterRel),
      `shot target=${c.shotTarget} rel=${c.shotRel}; enter target=${c.enterTarget} rel=${c.enterRel}`
    );
    check.ok(`外部入口「${e.name}」封面区是文字入口而非图片`, !c.hasImg && !!c.shotLabel, c.hasImg ? "出现 img" : "纯文字");
  }

  // 外部入口关键词沿用现有搜索系统即可命中，不新增 tab / filter 开关。
  const searchHits = async (q) => {
    await setSearch(q);
    return page.$$eval(".card h3", (ns) => ns.map((n) => n.textContent.trim()));
  };
  const stgHits = await searchHits("spacetypegenerator");
  check.ok("搜索 spacetypegenerator 命中动态文字", stgHits.length === 1 && stgHits[0] === "动态文字", `命中 ${stgHits.length}：${stgHits.join("、") || "无"}`);
  const slHits = await searchHits("basement");
  check.ok("搜索 basement 命中效果堆叠", slHits.length === 1 && slHits[0] === "效果堆叠", `命中 ${slHits.length}：${slHits.join("、") || "无"}`);
  const tooHits = await searchHits("tooooools");
  check.ok("搜索 tooooools 命中图像网点", tooHits.length === 1 && tooHits[0] === "图像网点", `命中 ${tooHits.length}：${tooHits.join("、") || "无"}`);
  await setSearch("");
  const restored2 = await page.$$eval(".card", (n) => n.length);
  check.ok("清空外部关键词搜索后恢复全部卡片", restored2 === cardCount, `${restored2} 张`);

  // 每张内置卡片都必须有「封面位」：要么是加载成功的真实封面，要么是明确的中性占位，
  // 不允许出现破图或 0 尺寸的 img（占位是首页对「封面尚未生成」的显式表达，不是伪装的效果图）。
  await sleep(400);
  const covers = await page.$$eval(".card:not(.is-external)", (cards) =>
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
    "每张内置卡片都有封面位（无破图、无 0 尺寸）",
    noSlot.length === 0 && covers.every((c) => !c.broken),
    `真实封面 ${realCovers.length}/${covers.length}` +
      (pendingCovers.length ? `；待生成：${pendingCovers.map((c) => c.name).join("、")}` : "")
  );
  // 原有 9 个内置入口的封面断言不降低：数量固定为 9，且都必须是真实封面而非占位。
  check.ok(
    "9 个内置入口都有真实封面（不降级为占位）",
    covers.length === 9 && realCovers.length === 9,
    `内置卡片 ${covers.length}，真实封面 ${realCovers.length}`
  );

  // 每个内置入口链接都要真的可达（外部入口不 fetch，避免 CORS 假失败）
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
