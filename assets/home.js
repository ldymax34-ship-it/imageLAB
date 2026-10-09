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

  function card(t) {
    var article = el("article", "card");
    article.dataset.span = String(t.span || 4);

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
    article.appendChild(el("div", "cat", t.cat + (t.en ? " · " + t.en : "")));
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
    var toolsEl = document.getElementById("meta-tools");
    var catsEl = document.getElementById("meta-cats");
    if (toolsEl) toolsEl.textContent = String(tools.length);
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
    header.appendChild(el("p", null, list.length + " 个工具"));
    wrap.appendChild(header);
    var grid = el("div", "cards");
    list.forEach(function (t) { grid.appendChild(card(t)); });
    wrap.appendChild(grid);
    section.appendChild(wrap);
    host.appendChild(section);
  }

  function haystack(t) {
    return [t.name, t.en || "", t.cat, t.desc, (t.keywords || []).join(" ")]
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
