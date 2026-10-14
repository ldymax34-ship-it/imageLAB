/**
 * 首页 smoke：大标题 / 分类 / 搜索可用；12 张内置卡片都有真实封面，且每个内置进入链接真的可达（HTTP 200）。
 * 这条测试保证「只列已可用入口」这条规则被真正执行。
 *
 * 4 个外部网站入口只做跳转：校验标注 / 按钮文案 / 两处链接 target-rel / 准确网址 / 关键词搜索，
 * 以及「有本地加载成功的 cover img，且 cover URL 是本地 assets/covers 路径、不是远程 URL」；
 * 不向外部 URL 发请求（会 CORS 失败），也不纳入内置封面与可达断言。
 *
 * 封面说明：内置封面由验收阶段用工具真实导出画面生成（`node scripts/capture-covers.mjs`）；
 * 外链封面是验收方从公开官网当前页面截取、保存进本仓库的本地缩略图
 * （`node scripts/capture-external-covers.mjs`）——首页运行时只加载仓库本地图片。
 */
export const id = "home";
export const title = "首页 ImageLAB";
export const gpu = null;

/**
 * 切到指定视口，回报首页的真实布局事实：
 * 每行工具卡片数（12 栏网格的列数）、横向溢出、贯穿视口的大区块线宽、内容宽度、hero 高度，
 * 以及首屏字标尺寸。只读测量，不改页面内容。
 */
async function layoutAt(page, sleep, width, height = 900) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(260);
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll(".card")];
    const rows = new Map();
    for (const c of cards) {
      const key = Math.round(c.getBoundingClientRect().top);
      rows.set(key, (rows.get(key) || 0) + 1);
    }
    const perRow = [...rows.values()];
    const bleed = [".hero", ".toolbar", ".section-head", "footer"].map((sel) => {
      const n = document.querySelector(sel);
      return n ? Math.round(n.getBoundingClientRect().width) : -1;
    });
    const bodyWrap = document.querySelector(".section-body .wrap");
    const mark = document.querySelector(".hero-mark");
    const hero = document.querySelector(".hero");
    const markRect = mark ? mark.getBoundingClientRect() : null;
    const heroRect = hero ? hero.getBoundingClientRect() : null;
    const toolbarRect = document.querySelector(".toolbar")
      ? document.querySelector(".toolbar").getBoundingClientRect()
      : null;
    return {
      maxPerRow: perRow.length ? Math.max(...perRow) : 0,
      perRow,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      bleedWidths: bleed,
      wrapWidth: bodyWrap ? Math.round(bodyWrap.getBoundingClientRect().width) : 0,
      markWidth: markRect ? Math.round(markRect.width) : 0,
      markHeight: markRect ? Math.round(markRect.height) : 0,
      cardCount: cards.length,
      heroBottom: heroRect ? Math.round(heroRect.bottom) : 0,
      heroHeight: heroRect ? Math.round(heroRect.height) : 0,
      // 首屏留白要「定量」：顶栏横线→字标、字标→工具栏横线各自的实际间距。
      gapAboveMark: markRect ? Math.round(markRect.top - heroRect.top) : 0,
      gapBelowMark: markRect && toolbarRect ? Math.round(toolbarRect.top - markRect.bottom) : 0
    };
  });
}

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
  check.ok("首页共 16 个入口（12 内置 + 4 外部）", cardCount === 16, `${cardCount} 张`);
  const extCardCount = await page.$$eval(".card.is-external", (n) => n.length);
  check.ok("其中外部网站入口 4 个", extCardCount === 4, `${extCardCount} 张`);
  const firstRow = await page.$$eval(".card", (cards) => cards.slice(0, 4).map((c) => c.dataset.tool));
  check.ok("成熟视觉工具优先，SVG 转 3D 排第一", firstRow.join(",") === "extrude3d,shaders-logo,shaders-bg,shaders-halftone", firstRow.join(","));
  const textureName = await page.$eval('[data-tool="texture"] h3', (n) => n.textContent);
  check.ok("纹理工具使用直观名称", textureName === "纹理生成器", textureName);

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

  // 外部网站入口：只做跳转。校验标注、按钮文案、两处链接 target/rel 与准确网址，
  // 以及「有本地加载成功的 cover img，且 cover URL 是本地 assets/covers 路径、不是远程 URL」；
  // 不向外部 URL 发请求（会 CORS 失败），也不把外部入口纳入内置封面 / 可达断言。
  // 封面是 lazy 加载的本地图片：先滚到底再回顶部触发，再等所有卡片 img 完成，避免读到 0 尺寸。
  const waitCoversLoaded = async () => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await sleep(600);
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await page
      .waitForFunction(
        () => {
          const imgs = [...document.querySelectorAll(".card img")];
          return imgs.length > 0 && imgs.every((n) => n.complete);
        },
        { timeout: 20000 }
      )
      .catch(() => {});
    await sleep(200);
  };
  await waitCoversLoaded();

  const EXPECT_EXTERNAL = [
    { id: "space-type-generator", name: "动态文字", href: "https://spacetypegenerator.com/" },
    { id: "shader-lab", name: "图片特效", href: "https://eng.basement.studio/tools/shader-lab" },
    { id: "tooooools", name: "图像网点", href: "https://www.tooooools.app/" },
    { id: "brand-assets-generator", name: "品牌素材生成", href: "https://brand-generator.stoyanov.works/" }
  ];
  const externalCards = await page.$$eval(".card.is-external", (cards) =>
    cards.map((c) => {
      const shot = c.querySelector("a.shot");
      const enter = c.querySelector("a.enter");
      const img = c.querySelector("img");
      const host = c.querySelector(".shot-host");
      return {
        id: c.dataset.tool || "",
        shotLabel: (c.querySelector(".shot-external") || {}).textContent || "",
        host: host ? host.textContent : "",
        hasImg: !!img,
        coverSrc: img ? img.currentSrc || img.src : null,
        coverNatural: img ? [img.naturalWidth, img.naturalHeight] : [0, 0],
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
  const baseOrigin = new URL(base).origin;
  const isLocalCover = (src) => {
    if (!src) return false;
    try {
      const u = new URL(src);
      return u.origin === baseOrigin && /^\/assets\/covers\//.test(u.pathname);
    } catch {
      return false;
    }
  };
  for (const e of EXPECT_EXTERNAL) {
    const c = externalCards.find((x) => x.id === e.id);
    check.ok(`外部入口「${e.name}」存在`, !!c, c ? "已渲染" : "未找到");
    if (!c) continue;
    check.ok(
      `外部入口「${e.name}」标注为 外部网站 · 跳转官网`,
      c.shotLabel.includes("外部网站") && c.shotLabel.includes("跳转官网"),
      `封面区=${c.shotLabel}`
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
    check.ok(
      `外部入口「${e.name}」有本地官网缩略图并成功加载`,
      c.hasImg && c.coverNatural[0] > 0,
      c.hasImg ? `natural=${c.coverNatural.join("×")}` : "没有 cover img"
    );
    check.ok(
      `外部入口「${e.name}」缩略图来自本地 assets/covers（非远程 URL）`,
      isLocalCover(c.coverSrc),
      c.coverSrc || "无 src"
    );
    check.ok(
      `外部入口「${e.name}」同时保留主机名信息`,
      c.host.includes(new URL(e.href).host),
      `host=${c.host}`
    );
  }

  // 外部入口关键词沿用现有搜索系统即可命中，不新增 tab / filter 开关。
  const searchHits = async (q) => {
    await setSearch(q);
    return page.$$eval(".card h3", (ns) => ns.map((n) => n.textContent.trim()));
  };
  const stgHits = await searchHits("spacetypegenerator");
  check.ok("搜索 spacetypegenerator 命中动态文字", stgHits.length === 1 && stgHits[0] === "动态文字", `命中 ${stgHits.length}：${stgHits.join("、") || "无"}`);
  const slHits = await searchHits("basement");
  check.ok("搜索 basement 命中图片特效", slHits.length === 1 && slHits[0] === "图片特效", `命中 ${slHits.length}：${slHits.join("、") || "无"}`);
  const tooHits = await searchHits("tooooools");
  check.ok("搜索 tooooools 命中图像网点", tooHits.length === 1 && tooHits[0] === "图像网点", `命中 ${tooHits.length}：${tooHits.join("、") || "无"}`);
  const brandHits = await searchHits("stoyanov");
  check.ok("搜索 stoyanov 命中品牌素材生成", brandHits.length === 1 && brandHits[0] === "品牌素材生成", `命中 ${brandHits.length}：${brandHits.join("、") || "无"}`);
  await setSearch("");
  const restored2 = await page.$$eval(".card", (n) => n.length);
  check.ok("清空外部关键词搜索后恢复全部卡片", restored2 === cardCount, `${restored2} 张`);

  // 搜索会重建卡片 DOM；恢复「全部」后再等一轮本地封面加载完成，避免读到 0 尺寸的 img。
  await waitCoversLoaded();

  // 每张内置卡片都必须有加载成功的**真实封面**：不允许出现破图或 0 尺寸的 img。
  // 本批已由验收方用真实导出刷新全部 12 张，内置卡片不再接受「待生成占位」。
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
  const noCover = covers.filter((c) => !c.natural[0]);
  check.ok(
    "12 张内置卡片都有真实封面（无破图、无 0 尺寸、无占位）",
    covers.length === 12 && realCovers.length === 12 && noCover.length === 0 && covers.every((c) => !c.broken),
    `真实封面 ${realCovers.length}/${covers.length}` +
      (noCover.length ? `；缺失：${noCover.map((c) => c.name).join("、")}` : "")
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
      const name = s.src.split("?")[0].split("/").pop();
      check.ok(`封面有内容 (${name})`, s.colors >= 3 && s.dominantShare < 0.995, `色彩簇=${s.colors} 单色占比=${s.dominantShare} 平均亮度=${s.meanLuma}`);
      check.ok(`封面不是纯色块 (${name})`, s.dominantShare < 0.995, `单色占比=${s.dominantShare}`);
    }
  }

  // ---------- 宽排版：工具一览一行 4 个 / 中屏 2 个 / 小屏 1 个，且无横溢出 ----------
  // 首屏改成「只有一个字标 + 顶到工具栏的大留白」，因此 hero 高度按「首屏填满」断言。
  const wide = await layoutAt(page, sleep, 1440, 900);
  check.ok("1440 工具一览一行 4 个", wide.maxPerRow === 4, `每行 ${wide.perRow.join("/")}`);
  check.ok(
    "1440 无横向溢出",
    wide.scrollWidth <= wide.innerWidth + 1 && wide.bodyScrollWidth <= wide.innerWidth + 1,
    `文档 ${wide.scrollWidth} / body ${wide.bodyScrollWidth} / 视口 ${wide.innerWidth}`
  );
  check.ok(
    "顶部 / hero / 工具区标题 / 页脚横线横穿整个视口",
    wide.bleedWidths.every((w) => w >= wide.innerWidth - 2),
    `区块线宽=${wide.bleedWidths.join(",")} 视口=${wide.innerWidth}`
  );
  // 首屏留白必须「定量」而不是失控：顶栏→字标 96–150px，字标→工具栏 84–140px，
  // 首屏整块 240–420px。既不允许空掉半个屏幕，也不允许被压成小头图。
  check.ok(
    "首屏留白定量：顶栏→字标 96–150px",
    wide.gapAboveMark >= 96 && wide.gapAboveMark <= 150,
    `顶栏横线→字标 ${wide.gapAboveMark}px`
  );
  check.ok(
    "首屏留白定量：字标→工具栏横线 84–140px",
    wide.gapBelowMark >= 84 && wide.gapBelowMark <= 140,
    `字标→工具栏横线 ${wide.gapBelowMark}px`
  );
  check.ok(
    "首屏整块高度 240–420px（留白受控，不空掉半个屏幕）",
    wide.heroHeight >= 240 && wide.heroHeight <= 420,
    `首屏高 ${wide.heroHeight}px（视口 ${wide.innerWidth}×900）`
  );
  // 首屏只有一个字标：必须够大够稳（≈ 33vw 宽、64–96px 高），但不能铺满整屏。
  check.ok(
    "首屏字标为紧凑 logo（≤ 视口 36% 宽、≤ 100px 高）",
    wide.markWidth >= 140 && wide.markWidth <= wide.innerWidth * 0.36 && wide.markHeight <= 100,
    `首屏字标 ${wide.markWidth}×${wide.markHeight}px / 视口 ${wide.innerWidth}px`
  );
  check.ok(
    "顶部无重复小 logo 和说明导航",
    !(await page.$(".masthead, .brand-mark, .nav")),
    "只保留主字标与工具筛选栏"
  );
  // 首屏已去掉说明文字 / 按钮 / 数字徽标：hero 内只允许有字标这一块可见内容。
  const heroOnlyMark = await page.evaluate(() => {
    const hero = document.querySelector(".hero");
    if (!hero) return { ok: false, detail: "未找到 .hero" };
    const kids = [...hero.querySelector(".wrap").children].map(
      (n) => n.tagName.toLowerCase() + (n.className ? "." + String(n.className).split(/\s+/).join(".") : "")
    );
    const text = hero.innerText.replace(/\s+/g, "");
    return { ok: kids.length === 1 && kids[0].startsWith("h1") && text === "", detail: `子元素=${kids.join(",") || "无"} 可见文字="${text}"` };
  });
  check.ok(
    "首屏不再有说明文字 / 按钮 / 数字徽标，只有字标",
    heroOnlyMark.ok,
    heroOnlyMark.detail
  );

  const big = await layoutAt(page, sleep, 1920, 1080);
  check.ok("1920 大屏仍为一行 4 个", big.maxPerRow === 4, `每行 ${big.perRow.join("/")}`);
  check.ok(
    "1920 内容不再受 1360px 上限，且无横向溢出",
    big.wrapWidth > 1360 && big.scrollWidth <= big.innerWidth + 1,
    `内容宽 ${big.wrapWidth} 视口 ${big.innerWidth} 文档 ${big.scrollWidth}`
  );

  const huge = await layoutAt(page, sleep, 2560, 1440);
  check.ok("2560 大屏仍为一行 4 个", huge.maxPerRow === 4, `每行 ${huge.perRow.join("/")}`);
  check.ok(
    "2560 内容铺满视口（无 1360px 上限）且无横向溢出",
    huge.wrapWidth > 1360 && huge.scrollWidth <= huge.innerWidth + 1,
    `内容宽 ${huge.wrapWidth} 视口 ${huge.innerWidth} 文档 ${huge.scrollWidth}`
  );

  const mid = await layoutAt(page, sleep, 900, 900);
  check.ok("中屏一行 2 个", mid.maxPerRow === 2, `每行 ${mid.perRow.join("/")}`);
  check.ok("中屏无横向溢出", mid.scrollWidth <= mid.innerWidth + 1, `文档 ${mid.scrollWidth} 视口 ${mid.innerWidth}`);

  const mobile = await layoutAt(page, sleep, 390, 844);
  check.ok("小屏 1 列", mobile.maxPerRow === 1, `每行 ${mobile.perRow.join("/")}`);
  check.ok(
    "移动端无横向溢出",
    mobile.scrollWidth <= mobile.innerWidth + 1 && mobile.bodyScrollWidth <= mobile.innerWidth + 1,
    `文档 ${mobile.scrollWidth} / body ${mobile.bodyScrollWidth} / 视口 ${mobile.innerWidth}`
  );
}
