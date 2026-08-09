import { AppBadge } from "./AppBadge";
import { EmptyState } from "./EmptyState";
import { UiIcon } from "./UiIcon";
import { formatBytes, riskLabels, supportLabels } from "../format";
import type { InstalledApplication } from "../types";

export function ApplicationDetail({ app, onAi, onCleanup }: { app: InstalledApplication | null; onAi: () => void; onCleanup: () => void }) {
  if (!app) {
    return (
      <aside className="inspector desktop-inspector-empty">
        <EmptyState icon="apps" title="等待真实扫描" description="扫描后可以查看应用本体、关联目录和风险分类。" />
      </aside>
    );
  }
  return (
    <aside className="inspector application-inspector">
      <div className="inspector-head"><p>应用详情</p><span className={`support-tag ${app.support_level}`}>{supportLabels[app.support_level]}</span></div>
      <div className="app-profile">
        <AppBadge app={app} />
        <div><h2>{app.name}</h2><p>{app.kind}</p></div>
        <span className={app.installed ? "safe-tag" : "risk-tag"}>{app.installed ? (app.is_system_app ? "系统应用" : "用户应用") : "检测到残留数据"}</span>
      </div>
      <div className="app-number">
        <span>应用与可信关联数据</span><strong>{formatBytes(app.total_size_bytes)}</strong>
        <p><i><UiIcon name="arrowUpRight" size={14} /></i> 24小时活跃文件体积 {formatBytes(app.modified_24h_bytes)}</p>
      </div>
      <dl className="application-metadata">
        <div><dt>Bundle ID</dt><dd>{app.bundle_id ?? "未提供"}</dd></div>
        <div><dt>版本</dt><dd>{app.version ?? "未知"}{app.bundle_version ? ` (${app.bundle_version})` : ""}</dd></div>
        <div><dt>安装路径</dt><dd>{app.application_path ?? "应用未安装，仅发现关联数据"}</dd></div>
      </dl>
      <section className="composition">
        <div className="inspector-section-title"><h3>空间分类</h3><span>{app.categories.length} 类</span></div>
        <div className="category-detail-list">
          {app.categories.map((category) => (
            <article key={category.id}>
              <div><b>{category.label}</b><span className={`risk-level ${category.risk_level}`}>{riskLabels[category.risk_level]}</span></div>
              <strong>{formatBytes(category.size_bytes)}</strong>
              <p>{category.description}</p>
            </article>
          ))}
        </div>
      </section>
      {app.support_level !== "deep" && (
        <div className="adaptation-note">当前仅提供{app.support_level === "basic" ? "基础空间分析" : "通用目录分析"}，轻盘不会将未知内容判断为可安全清理。</div>
      )}
      {app.permission_errors > 0 && <div className="permission-note">有 {app.permission_errors} 个目录无法读取，结果可能不完整。</div>}
      <section className="ai-insight">
        <div><span><UiIcon name="sparkles" size={17} /></span><b>{app.support_level === "deep" ? "可以继续查看具体文件" : "需要进一步解释？"}</b><em>{app.support_level === "deep" ? "先隔离" : "匿名汇总"}</em></div>
        <p>{app.support_level === "deep" ? "安全和需确认项目正常开放；受保护内容只能在高级模式中逐项授权，未知内容不开放。" : "AI只接收应用名称、容量、分类和风险等级，不接收文件名、路径或正文。"}</p>
        {app.support_level === "deep" && <button type="button" onClick={onCleanup}>查看具体文件 →</button>}
        <button type="button" onClick={onAi}>使用AI解释 →</button>
      </section>
    </aside>
  );
}
