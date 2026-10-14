/*
 * imageLAB · 工具工作台分类导航（唯一的共享实现，六个自建工具复用）
 *
 * 只做一件事：在同一份已经渲染好的表单上切换「当前分类」的显示，
 * 因此切换分类不会重建控件、不会重置参数、上传素材、当前帧或相机状态。
 *
 * 约定（HTML 侧）：
 *   <div class="il-catnav" data-catnav role="tablist">
 *     <button class="il-cat" data-cat="media" role="tab"
 *             aria-selected="true" aria-controls="panel-media" tabindex="0">素材</button>
 *     ...
 *   </div>
 *   <section class="il-catpanel" data-catpanel="media" id="panel-media"
 *            role="tabpanel" aria-labelledby="...">…</section>
 *
 * 分类面板用 hidden 切换；aria-controls 指向对应面板 id，键盘支持 ←→↑↓ / Home / End。
 */

/** 取某个 tab 对应的面板：优先 aria-controls 指向的 id，其次 data-catpanel 匹配。 */
function panelFor(tab, scope) {
  const controls = tab.getAttribute("aria-controls");
  if (controls) {
    const byId = scope.getElementById ? scope.getElementById(controls) : null;
    if (byId) return byId;
  }
  const host = tab.closest("[data-catscope]") || scope;
  return host.querySelector(`[data-catpanel="${tab.dataset.cat}"]`);
}

/**
 * 初始化作用域内所有分类导航。
 * @param {Document|HTMLElement} scope 默认整个文档；可在单一工具内重复调用。
 * @returns {Array<{nav: HTMLElement, select: (cat: string) => void, tabs: HTMLElement[]}>}
 */
export function mountCategoryTabs(scope = document) {
  const instances = [];

  for (const nav of scope.querySelectorAll("[data-catnav]")) {
    const tabs = [...nav.querySelectorAll("[data-cat]")];
    if (!tabs.length) continue;

    const panels = new Map();
    for (const tab of tabs) {
      const panel = panelFor(tab, scope);
      if (panel) panels.set(tab.dataset.cat, panel);
    }

    const select = (cat, focus = false) => {
      const target = tabs.find((tab) => tab.dataset.cat === cat && !tab.hidden);
      if (!target) return;
      for (const tab of tabs) {
        const on = tab === target;
        tab.setAttribute("aria-selected", String(on));
        tab.tabIndex = on ? 0 : -1;
        const panel = panels.get(tab.dataset.cat);
        if (panel) panel.hidden = !on;
      }
      if (focus) target.focus();
    };

    nav.addEventListener("click", (event) => {
      const button = event.target.closest("[data-cat]");
      if (button && nav.contains(button) && !button.hidden) select(button.dataset.cat);
    });

    nav.addEventListener("keydown", (event) => {
      const list = tabs.filter((tab) => !tab.hidden);
      const index = list.indexOf(document.activeElement);
      if (index < 0) return;
      let next = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = list[(index + 1) % list.length];
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = list[(index - 1 + list.length) % list.length];
      else if (event.key === "Home") next = list[0];
      else if (event.key === "End") next = list[list.length - 1];
      if (!next) return;
      event.preventDefault();
      select(next.dataset.cat, true);
    });

    const initial =
      tabs.find((tab) => tab.getAttribute("aria-selected") === "true" && !tab.hidden) ||
      tabs.find((tab) => !tab.hidden) ||
      tabs[0];
    select(initial.dataset.cat);

    instances.push({ nav, select, tabs });
  }

  return instances;
}
