import { useMemo, useState } from "react";
import { filterAndSortApplications } from "../applicationView.mjs";
import { AppBadge } from "../components/AppBadge";
import { EmptyState } from "../components/EmptyState";
import { UiIcon } from "../components/UiIcon";
import { formatBytes, supportLabels } from "../format";
import type { ApplicationFilter, ApplicationSort, InstalledApplication, ScanResult, ScanState } from "../types";

const filters: { id: ApplicationFilter; label: string }[] = [
  { id: "all", label: "全部" }, { id: "deep", label: "深度支持" }, { id: "generic", label: "通用分析" },
  { id: "basic", label: "基础识别" }, { id: "system", label: "系统应用" }, { id: "user", label: "用户应用" },
  { id: "residual", label: "检测到残留数据" },
];
const PAGE_SIZE = 40;

export function ApplicationsPage({ scan, scanState, scanError, selectedId, onSelect, onScan, onAi, onCleanup }: { scan: ScanResult | null; scanState: ScanState; scanError: string; selectedId: string; onSelect: (id: string) => void; onScan: () => void; onAi: () => void; onCleanup: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ApplicationFilter>("all");
  const [sort, setSort] = useState<ApplicationSort>("total");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const apps = useMemo(() => scan?.apps ?? [], [scan]);
  const result = useMemo(() => filterAndSortApplications(apps, query, filter, sort), [apps, filter, query, sort]);
  const visible = result.slice(0, visibleCount);
  const selectedApp = apps.find((app) => app.id === selectedId) ?? null;
  const largestApp = useMemo(() => [...apps].sort((left, right) => right.total_size_bytes - left.total_size_bytes)[0] ?? null, [apps]);
  const topApps = useMemo(() => [...apps].sort((left, right) => right.total_size_bytes - left.total_size_bytes).slice(0, 5), [apps]);
  const freePercent = scan ? Math.min(100, (scan.disk_available_bytes / Math.max(scan.disk_total_bytes, 1)) * 100) : 0;
  const appsPercent = scan ? Math.min(100 - freePercent, (scan.recognized_apps_bytes / Math.max(scan.disk_total_bytes, 1)) * 100) : 0;
  const otherUsedPercent = Math.max(0, 100 - freePercent - appsPercent);

  return (
    <div className="page applications-page">
      <div className="page-heading"><div><p className="eyebrow">SMART LOCAL SCAN</p><h1>智能扫描</h1><p>扫描本机应用和可信关联目录，在同一条流程里查看占用、获得建议并安全处理具体文件。</p></div><button type="button" className={`primary-button scan-trigger${scanState === "scanning" ? " is-scanning" : ""}`} onClick={onScan} disabled={scanState === "scanning"}><span className="scan-trigger-icon"><UiIcon name={scanState === "scanning" ? "loader" : "zoomScan"} size={17} /></span><b>{scanState === "scanning" ? "正在扫描" : scan ? "重新扫描" : "开始扫描"}</b></button></div>
      {scanError && <div className="desktop-error">扫描失败：{scanError}</div>}
      {scan && (
        <section className="application-summary-grid">
          <article><span>发现应用</span><strong>{apps.length}</strong><small>全部 .app 与残留规则</small></article>
          <article><span>应用本体</span><strong>{formatBytes(scan.application_bundles_bytes)}</strong><small>已安装应用包</small></article>
          <article><span>关联数据</span><strong>{formatBytes(scan.related_data_bytes)}</strong><small>规则与Bundle ID映射</small></article>
          <article><span>深度支持</span><strong>{scan.deep_supported_apps}</strong><small>已验证应用规则</small></article>
          <article className={scan.permission_errors ? "has-warning" : ""}><span>权限问题</span><strong>{scan.permission_errors}</strong><small>扫描继续，结果可能不完整</small></article>
        </section>
      )}
      {scan && <section className="scan-visual-grid" aria-label="扫描数据可视化">
        <article className="scan-disk-visual">
          <header><div><p className="eyebrow">磁盘空间分布</p><h2>{formatBytes(scan.disk_available_bytes)} 可用</h2></div><span>总容量 {formatBytes(scan.disk_total_bytes)}</span></header>
          <div className="storage-bar" aria-label="应用、其他已用和可用空间占比"><i className="storage-apps" style={{ width: `${appsPercent}%` }} /><i className="storage-system" style={{ width: `${otherUsedPercent}%` }} /><i className="storage-free" style={{ width: `${freePercent}%` }} /></div>
          <div className="storage-legend"><span><i className="dot-apps" />应用与关联数据 <b>{formatBytes(scan.recognized_apps_bytes)}</b></span><span><i className="dot-system" />其他已用 <b>{formatBytes(Math.max(0, scan.disk_used_bytes - scan.recognized_apps_bytes))}</b></span><span><i className="dot-free" />可用 <b>{formatBytes(scan.disk_available_bytes)}</b></span></div>
        </article>
        <article className="scan-top-apps-visual">
          <header><div><p className="eyebrow">占用排行</p><h2>空间占用最大的应用</h2></div><span>点击查看详情</span></header>
          <div className="scan-top-app-list">{topApps.map((app, index) => <button type="button" key={app.id} className={selectedId === app.id ? "selected" : ""} onClick={() => onSelect(app.id)}><span className="scan-top-rank">{index + 1}</span><AppBadge app={app} small /><span className="scan-top-name"><b>{app.name}</b><i><em style={{ width: `${Math.max((app.total_size_bytes / Math.max(topApps[0]?.total_size_bytes ?? 1, 1)) * 100, 3)}%`, background: app.color }} /></i></span><strong>{formatBytes(app.total_size_bytes)}</strong></button>)}</div>
        </article>
      </section>}
      {scan && <section className="smart-scan-guidance">
        <span className="smart-scan-guidance-icon"><UiIcon name="sparkles" size={21} /></span>
        <div><p className="eyebrow">扫描建议</p><h2>{largestApp ? `建议优先查看 ${largestApp.name}` : "扫描结果已经准备好"}</h2><p>{largestApp ? `${largestApp.name} 当前共占用 ${formatBytes(largestApp.total_size_bytes)}。先选择应用查看右侧证据，再决定是否处理具体文件。` : "选择一个应用查看空间构成和处理边界。"}</p></div>
        <div className="smart-scan-actions">
          <button type="button" className="ghost-button" onClick={onAi}><UiIcon name="brain" size={17} />AI 解读扫描结果</button>
          {selectedApp?.support_level === "deep" ? <button type="button" className="primary-button" onClick={() => onCleanup(selectedApp.id)}><UiIcon name="box" size={17} />检查并移入隔离区</button> : <span>{selectedApp ? `${selectedApp.name} 暂未开放文件处理` : "选择深度支持应用后可处理文件"}</span>}
        </div>
      </section>}
      <section className="application-toolbar">
        <label className="application-search"><span><UiIcon name="search" size={16} /></span><input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }} placeholder="搜索应用名称或 Bundle ID" aria-label="搜索应用名称或Bundle ID" /></label>
        <label className="application-sort"><span>排序</span><select value={sort} onChange={(event) => { setSort(event.target.value as ApplicationSort); setVisibleCount(PAGE_SIZE); }}><option value="total">总占用从大到小</option><option value="app">应用本体大小</option><option value="related">关联数据大小</option><option value="active">24小时活跃文件体积</option><option value="name">应用名称</option></select></label>
      </section>
      <div className="application-filters" role="group" aria-label="应用筛选">
        {filters.map((item) => <button type="button" key={item.id} className={filter === item.id ? "active" : ""} onClick={() => { setFilter(item.id); setVisibleCount(PAGE_SIZE); }}>{item.label}</button>)}
      </div>
      {!scan ? <EmptyState icon="apps" title="等待首次扫描" description="完成扫描后，这里会列出整台 Mac 的全部应用。" /> : !result.length ? <EmptyState icon="search" title="没有匹配结果" description="试试更换关键词或支持等级筛选。" /> : (
        <section className="application-table" aria-label="全部应用列表">
          <header><span>应用</span><span>支持等级</span><span>应用本体</span><span>关联数据</span><span>总占用</span><span>权限</span></header>
          {visible.map((app: InstalledApplication) => (
            <button type="button" key={app.id} className={selectedId === app.id ? "application-row selected" : "application-row"} onClick={() => onSelect(app.id)}>
              <span className="application-identity"><AppBadge app={app} small /><span><b>{app.name}</b><small>{app.version ? `v${app.version}` : "版本未知"} · {app.bundle_id ?? "无 Bundle ID"}</small></span></span>
              <span><i className={`support-tag ${app.support_level}`}>{supportLabels[app.support_level]}</i>{!app.installed && <small className="residual-label">检测到残留数据</small>}</span>
              <strong>{formatBytes(app.app_size_bytes)}</strong><strong>{formatBytes(app.related_data_size_bytes)}</strong><strong>{formatBytes(app.total_size_bytes)}</strong>
              <span>{app.permission_errors ? <i className="permission-status warning">需要权限</i> : <i className="permission-status">正常</i>}</span>
            </button>
          ))}
        </section>
      )}
      {visible.length < result.length && <button type="button" className="load-more-button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>继续显示 · 剩余 {result.length - visible.length} 个</button>}
      {scan && result.length > 0 && <p className="application-result-meta">当前显示 {visible.length} / {result.length} 个匹配应用，共发现 {apps.length} 个。</p>}
    </div>
  );
}
