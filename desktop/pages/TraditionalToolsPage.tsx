import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AppBadge } from "../components/AppBadge";
import { EmptyState } from "../components/EmptyState";
import { UiIcon, type UiIconName } from "../components/UiIcon";
import { formatBytes } from "../format";
import type {
  CacheScanResult,
  CleanupBatch,
  DuplicateScanResult,
  InstalledApplication,
  LargeFileItem,
  LargeFileScanResult,
  TraditionalToolId,
} from "../types";

const tools: { id: TraditionalToolId; icon: UiIconName; title: string; description: string }[] = [
  { id: "large", icon: "file", title: "大文件", description: "按体积找到用户目录中的具体文件" },
  { id: "duplicates", icon: "files", title: "重复文件", description: "本机计算内容指纹，确认真正重复" },
  { id: "uninstall", icon: "apps", title: "应用卸载", description: "移除应用包与明确匹配的安全缓存" },
  { id: "cache", icon: "database", title: "缓存分析", description: "查看每个缓存目录的真实体积" },
];

function formatDate(unix: number) {
  if (!unix) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(new Date(unix * 1000));
}

function togglePath(paths: string[], path: string) {
  return paths.includes(path) ? paths.filter((item) => item !== path) : [...paths, path];
}

export function TraditionalToolsPage({ apps, onVaultChanged, onOpenVault }: {
  apps: InstalledApplication[];
  onVaultChanged: () => void;
  onOpenVault: () => void;
}) {
  const [activeTool, setActiveTool] = useState<TraditionalToolId>("large");
  const [largeMinimumMb, setLargeMinimumMb] = useState(500);
  const [duplicateMinimumMb, setDuplicateMinimumMb] = useState(10);
  const [largeResult, setLargeResult] = useState<LargeFileScanResult | null>(null);
  const [duplicateResult, setDuplicateResult] = useState<DuplicateScanResult | null>(null);
  const [cacheResult, setCacheResult] = useState<CacheScanResult | null>(null);
  const [largeSelected, setLargeSelected] = useState<string[]>([]);
  const [duplicateSelected, setDuplicateSelected] = useState<string[]>([]);
  const [cacheSelected, setCacheSelected] = useState<string[]>([]);
  const [appQuery, setAppQuery] = useState("");
  const [selectedAppId, setSelectedAppId] = useState("");
  const [includeSafeCache, setIncludeSafeCache] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const uninstallableApps = useMemo(() => apps
    .filter((app) => app.installed && !app.is_system_app && app.application_path)
    .filter((app) => `${app.name} ${app.bundle_id ?? ""}`.toLocaleLowerCase().includes(appQuery.trim().toLocaleLowerCase()))
    .sort((left, right) => right.app_size_bytes - left.app_size_bytes), [appQuery, apps]);
  const selectedApp = apps.find((app) => app.id === selectedAppId) ?? null;
  const selectedLargeItems = largeResult?.items.filter((item) => largeSelected.includes(item.path)) ?? [];
  const selectedDuplicateItems = duplicateResult?.groups.flatMap((group) => group.items).filter((item) => duplicateSelected.includes(item.path)) ?? [];
  const selectedCacheItems = cacheResult?.items.filter((item) => cacheSelected.includes(item.path)) ?? [];

  function resetFeedback() {
    setMessage("");
    setError("");
  }

  async function runLargeScan() {
    resetFeedback();
    setBusy(true);
    setLargeSelected([]);
    try {
      setLargeResult(await invoke<LargeFileScanResult>("scan_large_files", { minimumSizeBytes: largeMinimumMb * 1024 * 1024 }));
    } catch (scanError) {
      setError(`大文件扫描失败：${String(scanError)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runDuplicateScan() {
    resetFeedback();
    setBusy(true);
    setDuplicateSelected([]);
    try {
      setDuplicateResult(await invoke<DuplicateScanResult>("scan_duplicate_files", { minimumSizeBytes: duplicateMinimumMb * 1024 * 1024 }));
    } catch (scanError) {
      setError(`重复文件扫描失败：${String(scanError)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runCacheScan() {
    resetFeedback();
    setBusy(true);
    setCacheSelected([]);
    try {
      setCacheResult(await invoke<CacheScanResult>("scan_caches"));
    } catch (scanError) {
      setError(`缓存分析失败：${String(scanError)}`);
    } finally {
      setBusy(false);
    }
  }

  async function quarantine(scope: "large" | "duplicate" | "cache", paths: string[], label: string) {
    if (!paths.length) return;
    if (paths.length > 200) {
      setError("为便于核对与恢复，每次最多处理 200 项。请缩小选择范围。");
      return;
    }
    if (!window.confirm(`确认将所选 ${paths.length} 项${label}移入安全隔离区吗？操作后可以恢复。`)) return;
    resetFeedback();
    setBusy(true);
    try {
      const result = await invoke<CleanupBatch>("quarantine_traditional_items", { scope, paths });
      const failed = result.errors.length ? `，${result.errors.length} 项失败` : "";
      setMessage(`已移入隔离区 ${result.moved.length} 项，共 ${formatBytes(result.moved.reduce((sum, item) => sum + item.size_bytes, 0))}${failed}。`);
      const movedPaths = new Set(result.moved.map((item) => item.original_path));
      if (scope === "large") {
        setLargeResult((current) => current ? { ...current, items: current.items.filter((item) => !movedPaths.has(item.path)), total_size_bytes: current.items.filter((item) => !movedPaths.has(item.path)).reduce((sum, item) => sum + item.size_bytes, 0) } : current);
        setLargeSelected([]);
      }
      if (scope === "duplicate") {
        setDuplicateResult((current) => {
          if (!current) return current;
          const groups = current.groups.map((group) => {
            const items = group.items.filter((item) => !movedPaths.has(item.path));
            return { ...group, items, reclaimable_bytes: group.size_bytes * Math.max(0, items.length - 1) };
          }).filter((group) => group.items.length > 1);
          return { ...current, groups, reclaimable_bytes: groups.reduce((sum, group) => sum + group.size_bytes * (group.items.length - 1), 0) };
        });
        setDuplicateSelected([]);
      }
      if (scope === "cache") {
        setCacheResult((current) => current ? { ...current, items: current.items.filter((item) => !movedPaths.has(item.path)), total_size_bytes: current.items.filter((item) => !movedPaths.has(item.path)).reduce((sum, item) => sum + item.size_bytes, 0) } : current);
        setCacheSelected([]);
      }
      onVaultChanged();
    } catch (cleanupError) {
      setError(`处理失败：${String(cleanupError)}`);
    } finally {
      setBusy(false);
    }
  }

  async function uninstall() {
    if (!selectedApp?.application_path) return;
    const cacheCopy = includeSafeCache && selectedApp.bundle_id ? "，并处理与 Bundle ID 完全匹配的缓存" : "";
    if (!window.confirm(`确认卸载“${selectedApp.name}”${cacheCopy}吗？应用和缓存会先进入隔离区，可在安全隔离区恢复。`)) return;
    resetFeedback();
    setBusy(true);
    try {
      const result = await invoke<CleanupBatch>("uninstall_application", {
        applicationPath: selectedApp.application_path,
        bundleId: selectedApp.bundle_id,
        appName: selectedApp.name,
        includeSafeCache,
      });
      const failed = result.errors.length ? `，${result.errors.length} 项失败` : "";
      setMessage(`“${selectedApp.name}”已有 ${result.moved.length} 项进入隔离区${failed}。重新扫描后会刷新应用列表。`);
      setSelectedAppId("");
      onVaultChanged();
    } catch (uninstallError) {
      setError(`卸载失败：${String(uninstallError)}`);
    } finally {
      setBusy(false);
    }
  }

  function selectDuplicateCopies() {
    setDuplicateSelected(duplicateResult?.groups.flatMap((group) => group.items.slice(1)).filter((item) => item.risk !== "protected").map((item) => item.path) ?? []);
  }

  function cacheLabel(bundleId: string) {
    return apps.find((app) => app.bundle_id === bundleId)?.name ?? bundleId;
  }

  return (
    <div className="page traditional-tools-page">
      <div className="page-heading"><div><p className="eyebrow">CLASSIC CLEANUP TOOLKIT</p><h1>清理工具</h1><p>补齐常规空间清理能力；操作前展示具体对象，清理后统一进入可恢复隔离区。</p></div><button type="button" className="ghost-button" onClick={onOpenVault}>查看隔离区</button></div>
      <section className="tool-selector" aria-label="选择清理工具">
        {tools.map((tool) => <button type="button" key={tool.id} className={activeTool === tool.id ? "active" : ""} onClick={() => { setActiveTool(tool.id); resetFeedback(); }}><span><UiIcon name={tool.icon} size={20} /></span><div><b>{tool.title}</b><small>{tool.description}</small></div></button>)}
      </section>
      {error && <div className="desktop-error">{error}</div>}
      {message && <div className="cleanup-success">{message} <button type="button" onClick={onOpenVault}>去隔离区查看</button></div>}

      {activeTool === "large" && <>
        <section className="tool-control-card"><div><p className="eyebrow">LARGE FILES</p><h2>大文件扫描</h2><p>只读取桌面、文稿、下载、影片、图片和音乐目录的文件大小、类型与修改时间，不读取内容。</p></div><label><span>最小体积</span><select value={largeMinimumMb} onChange={(event) => setLargeMinimumMb(Number(event.target.value))}><option value={100}>100 MB</option><option value={500}>500 MB</option><option value={1024}>1 GB</option><option value={5120}>5 GB</option></select></label><button type="button" className="primary-button" disabled={busy} onClick={() => void runLargeScan()}>{busy ? "正在扫描…" : "开始扫描"}</button></section>
        {largeResult ? <ToolResultMeta title={`发现 ${largeResult.items.length} 个大文件`} total={largeResult.total_size_bytes} detail={`已检查 ${largeResult.scanned_files.toLocaleString()} 个文件${largeResult.partial ? " · 已达到扫描上限" : ""}${largeResult.permission_errors ? ` · ${largeResult.permission_errors} 个权限问题` : ""}`} /> : <EmptyState icon="file" title="按需扫描大文件" description="扫描不会自动删除，也不会读取文件内容。" />}
        {largeResult && largeResult.items.length > 0 && <><FileList items={largeResult.items} selected={largeSelected} onToggle={(item) => item.risk !== "protected" && setLargeSelected((current) => togglePath(current, item.path))} /><DecisionBar count={selectedLargeItems.length} total={selectedLargeItems.reduce((sum, item) => sum + item.size_bytes, 0)} busy={busy} label="移入安全隔离区" onClear={() => setLargeSelected([])} onConfirm={() => void quarantine("large", largeSelected, "大文件")} /></>}
      </>}

      {activeTool === "duplicates" && <>
        <section className="tool-control-card"><div><p className="eyebrow">DUPLICATE FILES</p><h2>重复文件扫描</h2><p>先按大小筛选候选项，再在本机读取候选文件并计算 SHA-256 指纹；文件内容不会上传。</p></div><label><span>最小体积</span><select value={duplicateMinimumMb} onChange={(event) => setDuplicateMinimumMb(Number(event.target.value))}><option value={1}>1 MB</option><option value={10}>10 MB</option><option value={100}>100 MB</option><option value={500}>500 MB</option></select></label><button type="button" className="primary-button" disabled={busy} onClick={() => void runDuplicateScan()}>{busy ? "正在校验…" : "扫描重复文件"}</button></section>
        {duplicateResult ? <ToolResultMeta title={`发现 ${duplicateResult.groups.length} 组重复文件`} total={duplicateResult.reclaimable_bytes} detail={`本机校验 ${duplicateResult.hashed_files.toLocaleString()} 个候选文件${duplicateResult.partial ? " · 结果可能不完整" : ""}${duplicateResult.permission_errors ? ` · ${duplicateResult.permission_errors} 个权限问题` : ""}`} action={<button type="button" onClick={selectDuplicateCopies}>每组保留第一个</button>} /> : <EmptyState icon="files" title="查找真正相同的文件" description="只有点击扫描后，轻盘才会在本机读取候选文件来比对内容指纹。" />}
        {duplicateResult && duplicateResult.groups.length > 0 && <><section className="duplicate-groups">{duplicateResult.groups.map((group, groupIndex) => <article key={group.id}><header><div><b>重复组 {groupIndex + 1}</b><small>{group.items.length} 份 · 每份 {formatBytes(group.size_bytes)}</small></div><strong>可释放 {formatBytes(group.reclaimable_bytes)}</strong></header><FileList items={group.items} selected={duplicateSelected} compact onToggle={(item) => item.risk !== "protected" && setDuplicateSelected((current) => togglePath(current, item.path))} /></article>)}</section><DecisionBar count={selectedDuplicateItems.length} total={selectedDuplicateItems.reduce((sum, item) => sum + item.size_bytes, 0)} busy={busy} label="隔离所选副本" onClear={() => setDuplicateSelected([])} onConfirm={() => void quarantine("duplicate", duplicateSelected, "重复文件")} /></>}
      </>}

      {activeTool === "uninstall" && <>
        <section className="tool-control-card uninstall-control"><div><p className="eyebrow">APPLICATION UNINSTALLER</p><h2>应用卸载</h2><p>仅开放普通用户应用；系统应用不显示。基础卸载处理应用包，可选处理与 Bundle ID 完全匹配的缓存。</p></div><label className="tool-search"><span><UiIcon name="search" size={16} /></span><input value={appQuery} onChange={(event) => setAppQuery(event.target.value)} placeholder="搜索应用" /></label></section>
        {!apps.length ? <EmptyState icon="apps" title="请先完成一次整机扫描" description="清理工具会复用“全部应用”的真实扫描结果。" /> : <div className="uninstall-layout"><section className="uninstall-app-list">{uninstallableApps.map((app) => <button type="button" key={app.id} className={selectedAppId === app.id ? "selected" : ""} onClick={() => setSelectedAppId(app.id)}><AppBadge app={app} small /><span><b>{app.name}</b><small>{app.bundle_id ?? "无 Bundle ID"}</small></span><strong>{formatBytes(app.app_size_bytes)}</strong></button>)}</section><aside className="uninstall-detail">{selectedApp ? <><AppBadge app={selectedApp} /><h2>{selectedApp.name}</h2><p>{selectedApp.application_path}</p><dl><div><dt>应用本体</dt><dd>{formatBytes(selectedApp.app_size_bytes)}</dd></div><div><dt>关联数据</dt><dd>{formatBytes(selectedApp.related_data_size_bytes)}</dd></div></dl><label className="cache-option"><input type="checkbox" checked={includeSafeCache} disabled={!selectedApp.bundle_id} onChange={(event) => setIncludeSafeCache(event.target.checked)} /><span><b>同时处理安全缓存</b><small>只匹配 `~/Library/Caches/{selectedApp.bundle_id ?? "Bundle ID"}`</small></span></label><button type="button" className="danger-button uninstall-button" disabled={busy} onClick={() => void uninstall()}>{busy ? "正在移入隔离区…" : "卸载并保留恢复能力"}</button><p className="uninstall-note">配置、文稿、聊天记录等不会在这里连带删除；请到“具体文件清理”查看已验证的应用级数据。</p></> : <div className="uninstall-placeholder"><span><UiIcon name="apps" size={25} /></span><b>选择一个应用</b><p>右侧会显示卸载范围和安全选项。</p></div>}</aside></div>}
      </>}

      {activeTool === "cache" && <>
        <section className="tool-control-card"><div><p className="eyebrow">CACHE ANALYSIS</p><h2>缓存分析</h2><p>统计用户缓存目录的一级项目。建议先退出对应应用；所选缓存仍会先进入隔离区。</p></div><button type="button" className="primary-button" disabled={busy} onClick={() => void runCacheScan()}>{busy ? "正在统计…" : "分析缓存"}</button></section>
        {cacheResult ? <ToolResultMeta title={`发现 ${cacheResult.items.length} 个缓存目录`} total={cacheResult.total_size_bytes} detail={`${cacheResult.permission_errors ? `${cacheResult.permission_errors} 个权限问题` : "缓存目录已完成统计"}`} action={<button type="button" onClick={() => setCacheSelected(cacheResult.items.slice(0, 200).map((item) => item.path))}>选择前 200 项</button>} /> : <EmptyState icon="database" title="查看缓存由谁产生" description="结果按目录展示，不会把所有缓存合并成一个不可判断的按钮。" />}
        {cacheResult && cacheResult.items.length > 0 && <><section className="cache-list">{cacheResult.items.map((item) => <label key={item.id} className={cacheSelected.includes(item.path) ? "selected" : ""}><input type="checkbox" checked={cacheSelected.includes(item.path)} onChange={() => setCacheSelected((current) => togglePath(current, item.path))} /><span className="file-kind folder"><UiIcon name="database" size={18} /></span><span><b>{cacheLabel(item.bundle_id)}</b><small>{item.display_path}</small></span><span><i>24小时变动</i><b>{formatBytes(item.modified_24h_bytes)}</b></span><strong>{formatBytes(item.size_bytes)}</strong></label>)}</section><DecisionBar count={selectedCacheItems.length} total={selectedCacheItems.reduce((sum, item) => sum + item.size_bytes, 0)} busy={busy} label="隔离所选缓存" onClear={() => setCacheSelected([])} onConfirm={() => void quarantine("cache", cacheSelected, "缓存")} /></>}
      </>}
    </div>
  );
}

function ToolResultMeta({ title, total, detail, action }: { title: string; total: number; detail: string; action?: ReactNode }) {
  return <section className="tool-result-meta"><div><b>{title}</b><small>{detail}</small></div><div><span>涉及空间</span><strong>{formatBytes(total)}</strong></div>{action}</section>;
}

function FileList({ items, selected, onToggle, compact = false }: { items: LargeFileItem[]; selected: string[]; onToggle: (item: LargeFileItem) => void; compact?: boolean }) {
  return <section className={compact ? "traditional-file-list compact" : "traditional-file-list"}>{items.map((item) => { const locked = item.risk === "protected"; return <label key={item.id} className={`${selected.includes(item.path) ? "selected" : ""}${locked ? " locked" : ""}`}><input type="checkbox" checked={selected.includes(item.path)} disabled={locked} onChange={() => onToggle(item)} /><span className="file-kind"><UiIcon name={locked ? "lock" : "file"} size={18} /></span><span><b>{item.name}</b><small>{item.display_path}</small></span><span><i>{item.file_kind} · {formatDate(item.modified_unix)}</i><strong>{formatBytes(item.size_bytes)}</strong></span><em>{locked ? "受保护" : "需确认"}</em></label>; })}</section>;
}

function DecisionBar({ count, total, busy, label, onClear, onConfirm }: { count: number; total: number; busy: boolean; label: string; onClear: () => void; onConfirm: () => void }) {
  return <section className="cleanup-decision-bar traditional-decision"><div><span>已选 {count} 项</span><strong>{formatBytes(total)}</strong><small>所有项目先进入隔离区，可恢复。</small></div><button type="button" className="ghost-button" disabled={!count || busy} onClick={onClear}>取消选择</button><button type="button" className="primary-button cleanup-button" disabled={!count || busy} onClick={onConfirm}>{busy ? "正在处理…" : label}</button></section>;
}
