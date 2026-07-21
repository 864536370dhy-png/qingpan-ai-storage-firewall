import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the QINGPAN desktop workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>轻盘 · AI 驱动的智能空间管理产品<\/title>/i);
  assert.match(html, /class="desktop-shell"/);
  assert.match(html, /空间变化/);
  assert.match(html, /占用提醒/);
  assert.match(html, /AI 调查/);
  assert.match(html, /安全恢复/);
  assert.match(html, /前端演示模式/);
  assert.match(html, /qingpan-social\.png/);
});

test("keeps the interactive workflow and dark design tokens in source", async () => {
  const [page, css, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /startScan/);
  assert.match(page, /submitInvestigation/);
  assert.match(page, /confirmPlan/);
  assert.match(page, /PlanModal/);
  assert.match(page, /planActionsByApp/);
  assert.match(page, /三个月前的群聊视频/);
  assert.match(page, /\{app\.name\}处理方案/);
  assert.match(page, /record\.appName/);
  assert.match(page, /今天新增的文件 − 今天删除或释放的空间/);
  assert.match(page, /不是当前总占用/);
  assert.match(page, /hourlyGrowth/);
  assert.match(page, /chartSourceMeta/);
  assert.match(page, /先选择一个软件，再看它每小时增加了多少/);
  assert.match(page, /trendAppId/);
  assert.match(page, /single-trend-head/);
  assert.match(page, /Agent Reach/);
  assert.match(page, /qingpan-theme/);
  assert.match(page, /界面主题/);
  assert.match(page, /软件占用提醒/);
  assert.match(page, /超过这个数就提醒我/);
  assert.match(page, /让 AI 看看怎么处理/);
  assert.match(page, /gsap\.fromTo/);
  assert.match(css, /\.budget-guide/);
  assert.match(css, /\.budget-cards/);
  assert.match(css, /--canvas:\s*var\(--gray-1000\)/);
  assert.match(css, /grid-template-columns:\s*218px minmax\(560px,\s*1fr\) 354px/);
  assert.match(css, /\.desktop-shell\[data-theme="light"\]/);
  assert.match(css, /\[data-theme="light"\] \.net-growth-value/);
  assert.match(css, /@media \(max-width:\s*980px\)/);
  assert.match(layout, /轻盘 · AI 驱动的智能空间管理产品/);
  assert.doesNotMatch(page, /SkeletonPreview/);
});
