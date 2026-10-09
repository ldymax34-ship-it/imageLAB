/* ImageLAB 首页：渲染工具卡片 + 分类筛选 + 关键词搜索。纯静态，无外部依赖。 */
(function () {
  "use strict";

  var tools = (window.IMAGELAB_TOOLS || []).slice();

  var CAT_ORDER = [
    "纹理生成",
    "像素与点阵",
    "字符与文字",
    "着色器效果",
    "三维与立体",
    "版式与切片"
  ];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function hostOf(href) {
    try {
      return new URL(href).host;
    } catch (e) {
      return href;
    }
  }

  function card(t) {
    var article = el("article", "card");
    article.dataset.span = String(t.span || 4);
    article.dataset.tool = t.id;

    if (t.external) {
      // 外部网站入口：封面区域是明确的文字入口，不伪造效果图、也不是缺失封面。
      // 两处链接都在新窗口打开，且不向外部发起任何运行时请求（不 iframe、不预取）。
      article.classList.add("is-external");
      article.dataset.external = "true";

      var extShot = el("a", "shot is-external-shot");
      extShot.href = t.href;
      extShot.target = "_blank";
      extShot.rel = "noopener noreferrer";
      extShot.setAttribute("aria-label", t.name + " 外部网站，打开官网");
      extShot.appendChild(el("span", "shot-external", "外部网站 · 跳转官网"));
      extShot.appendChild(el("span", "shot-host", hostOf(t.href)));
      article.appendChild(extShot);

      article.appendChild(el("h3", null, t.name));
      // 类别行只显示现有中文分类；英文副标题 en 仅保留在数据里供来源记录与搜索用。
      article.appendChild(el("div", "cat", t.cat));
      article.appendChild(el("p", null, t.desc));

      var extEnter = el("a", "enter");
      extEnter.href = t.href;
      extEnter.target = "_blank";
      extEnter.rel = "noopener noreferrer";
      extEnter.appendChild(document.createTextNode("打开官网"));
      var extArrow = document.createElement("s");
      extArrow.textContent = "↗";
      extEnter.appendChild(extArrow);
      article.appendChild(extEnter);
      article.appendChild(el("div", "note", "外部网站 · 跳转官网"));
      return article;
    }

    var shot = el("a", "shot");
    shot.href = t.href;
    shot.setAttribute("aria-label", t.name + " 预览");
    var img = document.createElement("img");
    img.src = t.cover;
    img.alt = t.name + " 实际运行效果封面";
    img.loading = "lazy";
    img.decoding = "async";
    // 封面缺失时退化为中性文字块，不显示破图；真实封面由实际运行工具导出后放入 public/assets/covers/
    img.addEventListener("error", function () {
      img.remove();
      shot.classList.add("is-cover-missing");
      shot.appendChild(el("span", "shot-fallback", t.name));
    });
    shot.appendChild(img);
    article.appendChild(shot);

    article.appendChild(el("h3", null, t.name));
    // 类别行只显示现有中文分类；英文副标题 en 仅保留在数据里供来源记录与搜索用。
    article.appendChild(el("div", "cat", t.cat));
    article.appendChild(el("p", null, t.desc));

    var enter = el("a", "enter");
    enter.href = t.href;
    enter.appendChild(document.createTextNode("进入工具"));
    var arrow = document.createElement("s");
    arrow.textContent = "→";
    enter.appendChild(arrow);
    article.appendChild(enter);

    if (t.note) article.appendChild(el("div", "note", t.note));
    return article;
  }

  function render(list) {
    var host = document.getElementById("sections");
    var countEl = document.getElementById("count");
    host.textContent = "";
    countEl.textContent = list.length + " / " + tools.length + " 个入口";

    var catTotal = new Set(tools.map(function (t) { return t.cat; })).size;
    var builtinTotal = tools.filter(function (t) { return !t.external; }).length;
    var externalTotal = tools.filter(function (t) { return !!t.external; }).length;
    var builtinEl = document.getElementById("meta-builtin");
    var externalEl = document.getElementById("meta-external");
    var catsEl = document.getElementById("meta-cats");
    if (builtinEl) builtinEl.textContent = String(builtinTotal);
    if (externalEl) externalEl.textContent = String(externalTotal);
    if (catsEl) catsEl.textContent = String(catTotal);

    if (!list.length) {
      var empty = el("div", "empty", "没有匹配的工具。清空搜索或切换分类试试。");
      var sec = el("section", "section");
      var wrap = el("div", "wrap");
      wrap.appendChild(empty);
      sec.appendChild(wrap);
      host.appendChild(sec);
      return;
    }

    // 全部视图与筛选结果都放进同一条连续 12 栏网格：桌面 3 列，
    // 不会因为某个类别只有 1–2 个工具而空出一整块。
    var section = el("section", "section");
    var wrap = el("div", "wrap");
    var header = document.createElement("header");
    header.appendChild(el("h2", null, state.cat === "全部" ? "全部工具" : state.cat));
    header.appendChild(el("p", null, list.length + " 个入口"));
    wrap.appendChild(header);
    var grid = el("div", "cards");
    list.forEach(function (t) { grid.appendChild(card(t)); });
    wrap.appendChild(grid);
    section.appendChild(wrap);
    host.appendChild(section);
  }

  // tools.js 的 keywords 是字符串；这里同时兼容数组写法，避免搜索整体失效。
  function keywordsText(t) {
    var k = t.keywords;
    if (Array.isArray(k)) return k.join(" ");
    return k == null ? "" : String(k);
  }

  function haystack(t) {
    return [t.name, t.en || "", t.cat, t.desc, keywordsText(t)]
      .join(" ")
      .toLowerCase();
  }

  var state = { cat: "全部", q: "" };

  function apply() {
    var q = state.q.trim().toLowerCase();
    var list = tools.filter(function (t) {
      if (state.cat !== "全部" && t.cat !== state.cat) return false;
      if (q && haystack(t).indexOf(q) === -1) return false;
      return true;
    });
    render(list);
  }

  function buildFilters() {
    var box = document.getElementById("filters");
    var cats = ["全部"].concat(
      CAT_ORDER.filter(function (c) {
        return tools.some(function (t) { return t.cat === c; });
      })
    );
    tools.forEach(function (t) {
      if (cats.indexOf(t.cat) === -1) cats.push(t.cat);
    });
    cats.forEach(function (c) {
      var b = el("button", null, c);
      b.type = "button";
      b.setAttribute("aria-pressed", c === "全部" ? "true" : "false");
      b.addEventListener("click", function () {
        state.cat = c;
        Array.prototype.forEach.call(box.children, function (n) {
          n.setAttribute("aria-pressed", n === b ? "true" : "false");
        });
        apply();
      });
      box.appendChild(b);
    });
  }

  function boot() {
    buildFilters();
    var input = document.getElementById("q");
    input.addEventListener("input", function () {
      state.q = input.value;
      apply();
    });
    apply();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
