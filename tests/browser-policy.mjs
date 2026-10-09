/**
 * 浏览器验收策略开关。
 *
 * 本批次的浏览器验收（Chrome / Puppeteer / 截图 / 封面）**统一交由 Codex 执行**；
 * 实现侧（DSH）不再自行启动浏览器。为避免误启动，浏览器相关入口默认关闭，
 * 只能由执行验收的一方显式打开：
 *
 *   IMAGELAB_BROWSER_TESTS=on npm run smoke
 *   IMAGELAB_BROWSER_TESTS=on node scripts/capture-covers.mjs
 *
 * Node 单测与构建不受影响（npm run build / npm run test 照常）。
 */

export const OPT_IN_ENV = "IMAGELAB_BROWSER_TESTS";

export function browserTestsEnabled() {
  return process.env[OPT_IN_ENV] === "on";
}

export const DISABLED_MESSAGE = `
[浏览器验收已集中到 Codex]
本批次约定：DSH 侧不再启动 Chrome / Puppeteer / 截图 / 封面抓取。
请在实现或修复完成后报告：页面 URL、可用控件、导出方式，状态标注为「待 Codex 验收」。
不要重试本命令，也不要另写脚本启动浏览器。

如你是执行验收的一方，请显式打开：
  ${OPT_IN_ENV}=on <命令>
`;

/** 未显式开启时直接退出（退出码 2，避免被误判为「测试通过」）。 */
export function requireBrowserOptIn(what) {
  if (browserTestsEnabled()) return true;
  console.error(DISABLED_MESSAGE);
  console.error(`（被拦截的入口：${what}）`);
  process.exit(2);
}
