import { AppBadge } from "../components/AppBadge";
import { EmptyState } from "../components/EmptyState";
import { UiIcon, type UiIconName } from "../components/UiIcon";
import { formatBytes, scanStageLabels } from "../format";
import type { ScanResult, ScanStage, ScanState } from "../types";

function Metric({ label, value, note, tone, icon }: { label: string; value: string; note: string; tone: string; icon: UiIconName }) {
  return <article className={`metric-card ${tone}`}><div className="metric-top"><span>{label}</span><i><UiIcon name={icon} size={18} /></i></div><strong>{value}</strong><p>{note}</p></article>;
}

export function OverviewPage({
  scan,
  scanState,
  stage,
  error,
  onScan,
  onSelect,
  onAi,
}: {
  scan: ScanResult | null;
  scanState: ScanState;
  stage: ScanStage;
  error: string;
  onScan: () => void;
  onSelect: (id: string) => void;
  onAi: () => void;
}) {
  const topApps = scan?.apps.slice(0, 8) ?? [];
  const freePercent = scan ? (scan.disk_available_bytes / Math.max(scan.disk_total_bytes, 1)) * 100 : 18;
  const appsPercent = scan ? (scan.recognized_apps_bytes / Math.max(scan.disk_total_bytes, 1)) * 100 : 0;
  const otherUsedPercent = scan ? Math.max(0, 100 - freePercent - appsPercent) : 82;
  return (
    <div className="page overview-page">
      <div className="overview-hero">
        <div><p className="eyebrow">MAC SPACE OVERVIEW</p><h1>{scan ? "整台 Mac 的应用已经识别" : "先扫描一次这台 Mac"}</h1><p>{scan ? `共发现 ${scan.apps.length} 个应用，本次扫描耗时 ${(scan.duration_ms / 1000).toFixed(1)} 秒。` : "轻盘将发现系统与用户应用，并汇总可信关联目录，不读取用户文件正文。"}</p></div>
        <button type="button" className={`primary-button scan-trigger${scanState === "scanning" ? " is-scanning" : ""}`} onClick={onScan} disabled={scanState === "scanning"}>
          <span className="scan-trigger-icon"><UiIcon name={scanState === "scanning" ? "loader" : "zoomScan"} size={17} /></span>
          <b>{scanState === "scanning" ? scanStageLabels[stage] : scan ? "重新扫描" : "开始真实扫描"}</b>
        </button>
      </div>
      {error && <div className="desktop-error">扫描失败：{error}</div>}
      <section className="storage-card">
        <div className="storage-copy"><p>磁盘可用空间</p><strong>{scan ? formatBytes(scan.disk_available_bytes) : "—"}</strong><small>{scan ? `总容量 ${formatBytes(scan.disk_total_bytes)} · 已使用 ${((scan.disk_used_bytes / scan.disk_total_bytes) * 100).toFixed(0)}%` : "等待读取磁盘信息"}</small></div>
        <div className="storage-visual" aria-label="磁盘空间组成"><div className="storage-bar"><i className="storage-apps" style={{ width: `${appsPercent}%` }} /><i className="storage-system" style={{ width: `${otherUsedPercent}%` }} /><i className="storage-free" style={{ width: `${freePercent}%` }} /></div><div className="storage-legend"><span><i className="dot-apps" />应用与关联数据 {scan ? formatBytes(scan.recognized_apps_bytes) : "—"}</span><span><i className="dot-system" />其他已用 {scan ? formatBytes(Math.max(0, scan.disk_used_bytes - scan.recognized_apps_bytes)) : "—"}</span><span><i className="dot-free" />可用 {scan ? formatBytes(scan.disk_available_bytes) : "—"}</span></div></div>
      </section>
      <section className="metric-grid">
        <Metric label="全部应用" value={scan ? `${scan.apps.length} 个` : "—"} note="含系统应用与用户应用" tone="safe" icon="apps" />
        <Metric label="关联数据" value={scan ? formatBytes(scan.related_data_bytes) : "—"} note="基于规则或Bundle ID关联" tone="warning" icon="database" />
        <Metric label="24小时活跃文件体积" value={scan ? formatBytes(scan.modified_24h_bytes) : "—"} note="不是净增长，也不等于可清理" tone="safe" icon="arrowUpRight" />
      </section>
      <section className="growth-panel section-block">
        <div className="section-title"><div><p className="eyebrow">TOP APPLICATIONS</p><h2>应用空间占用</h2></div>{scan && <span className="scan-meta">{scan.permission_errors ? `${scan.permission_errors} 个目录存在权限问题` : "扫描目录均可读取"}</span>}</div>
        <div className="growth-list">
          {topApps.length ? topApps.map((app, index) => (
            <button type="button" className="growth-row actual-growth-row" key={app.id} onClick={() => onSelect(app.id)}>
              <span className="rank">{String(index + 1).padStart(2, "0")}</span><AppBadge app={app} small />
              <span className="growth-name"><b>{app.name}</b><small>{app.kind}{!app.installed ? " · 检测到残留数据" : ""}</small></span>
              <span className="mini-track"><i style={{ width: `${Math.max((app.total_size_bytes / Math.max(topApps[0].total_size_bytes, 1)) * 100, 2)}%`, background: app.color }} /></span>
              <strong>{formatBytes(app.total_size_bytes)}</strong><span className="chevron">›</span>
            </button>
          )) : <EmptyState icon="apps" title={scan ? "未发现应用" : "还没有真实数据"} description={scan ? "当前扫描目录中没有发现 .app 应用包。" : "点击“开始真实扫描”读取这台 Mac 的全部应用。"} />}
        </div>
      </section>
      <section className="ai-callout"><span className="ai-symbol"><UiIcon name="sparkles" size={20} /></span><div><p className="eyebrow">AI 调查</p><h2>{scan ? "让 AI 解释本次真实扫描结果" : "扫描完成后即可开始 AI 分析"}</h2><p>只发送应用名称、大小、分类和风险汇总，不发送文件名、路径或正文。</p></div><button type="button" className="secondary-button" onClick={onAi}>进入AI调查</button></section>
    </div>
  );
}
