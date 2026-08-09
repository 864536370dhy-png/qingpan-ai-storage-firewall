import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  filterAndSortApplications,
  matchesApplicationFilter,
  matchesApplicationQuery,
  sortApplications,
} from "../desktop/applicationView.mjs";

const apps = [
  { id: "xcode", name: "Xcode", bundle_id: "com.apple.dt.Xcode", support_level: "deep", installed: true, is_system_app: false, app_size_bytes: 10, related_data_size_bytes: 90, total_size_bytes: 100, modified_24h_bytes: 4 },
  { id: "notes", name: "备忘录", bundle_id: "com.apple.Notes", support_level: "basic", installed: true, is_system_app: true, app_size_bytes: 60, related_data_size_bytes: 0, total_size_bytes: 60, modified_24h_bytes: 1 },
  { id: "tool", name: "Developer Tool", bundle_id: "com.example.tool", support_level: "generic", installed: true, is_system_app: false, app_size_bytes: 20, related_data_size_bytes: 30, total_size_bytes: 50, modified_24h_bytes: 20 },
  { id: "wechat", name: "微信", bundle_id: "com.tencent.xinWeChat", support_level: "deep", installed: false, is_system_app: false, app_size_bytes: 0, related_data_size_bytes: 40, total_size_bytes: 40, modified_24h_bytes: 0 },
];

test("application search matches name and Bundle ID", () => {
  assert.equal(matchesApplicationQuery(apps[0], "xco"), true);
  assert.equal(matchesApplicationQuery(apps[2], "COM.EXAMPLE"), true);
  assert.equal(matchesApplicationQuery(apps[1], "not-found"), false);
});

test("support, system, user and residual filters work", () => {
  assert.deepEqual(apps.filter((app) => matchesApplicationFilter(app, "deep")).map((app) => app.id), ["xcode", "wechat"]);
  assert.deepEqual(apps.filter((app) => matchesApplicationFilter(app, "system")).map((app) => app.id), ["notes"]);
  assert.deepEqual(apps.filter((app) => matchesApplicationFilter(app, "user")).map((app) => app.id), ["xcode", "tool"]);
  assert.deepEqual(apps.filter((app) => matchesApplicationFilter(app, "residual")).map((app) => app.id), ["wechat"]);
});

test("application sorting supports total, app, related, activity and name", () => {
  assert.deepEqual(sortApplications(apps, "total").map((app) => app.id), ["xcode", "notes", "tool", "wechat"]);
  assert.deepEqual(sortApplications(apps, "app").map((app) => app.id), ["notes", "tool", "xcode", "wechat"]);
  assert.deepEqual(sortApplications(apps, "related").map((app) => app.id), ["xcode", "wechat", "tool", "notes"]);
  assert.equal(sortApplications(apps, "active")[0].id, "tool");
  assert.equal(sortApplications(apps, "name").length, apps.length);
  assert.deepEqual(filterAndSortApplications(apps, "apple", "system", "total").map((app) => app.id), ["notes"]);
});

test("desktop source contains empty, unsupported, traditional tools and detail states", async () => {
  const [page, detail, app, cleanup, tools, vault, sidebar] = await Promise.all([
    readFile(new URL("../desktop/pages/ApplicationsPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../desktop/components/ApplicationDetail.tsx", import.meta.url), "utf8"),
    readFile(new URL("../desktop/DesktopApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../desktop/pages/CleanupPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../desktop/pages/TraditionalToolsPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../desktop/pages/VaultPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../desktop/components/Sidebar.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /等待首次扫描/);
  assert.match(page, /没有匹配结果/);
  assert.match(page, /检测到残留数据/);
  assert.match(page, /扫描建议/);
  assert.match(page, /磁盘空间分布/);
  assert.match(page, /空间占用最大的应用/);
  assert.match(page, /检查并移入隔离区/);
  assert.match(detail, /Bundle ID/);
  assert.match(detail, /安装路径/);
  assert.match(detail, /轻盘不会将未知内容判断为可安全清理/);
  assert.match(app, /quarantine_items/);
  assert.match(app, /restore_quarantine_item/);
  assert.match(app, /permanently_delete_quarantine_item/);
  assert.match(cleanup, /帮我找出/);
  assert.match(cleanup, /AI空间分析过程/);
  assert.match(cleanup, /当前选择汇总/);
  assert.match(cleanup, /具体文件只在右侧展示，避免重复信息/);
  assert.match(cleanup, /数量和容量与右侧勾选结果保持一致/);
  assert.match(cleanup, /item\.selectable/);
  assert.match(cleanup, /高级手动处理/);
  assert.match(cleanup, /移入隔离区/);
  assert.match(app, /CleanupEvidencePanel/);
  assert.match(app, /focusedCandidatePath/);
  assert.match(sidebar, /清理工具/);
  assert.match(sidebar, /智能扫描/);
  assert.doesNotMatch(sidebar, /智能建议/);
  assert.doesNotMatch(sidebar, /应用深度清理/);
  assert.match(tools, /大文件扫描/);
  assert.match(tools, /重复文件扫描/);
  assert.match(tools, /应用卸载/);
  assert.match(tools, /缓存分析/);
  assert.match(tools, /scan_large_files/);
  assert.match(tools, /scan_duplicate_files/);
  assert.match(tools, /uninstall_application/);
  assert.match(tools, /scan_caches/);
  assert.match(tools, /SHA-256/);
  assert.match(vault, /安全隔离区/);
  assert.match(vault, /永久删除/);
});
