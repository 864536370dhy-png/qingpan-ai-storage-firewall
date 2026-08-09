import { AppBadge } from "../components/AppBadge";
import { EmptyState } from "../components/EmptyState";
import { UiIcon, type UiIconName } from "../components/UiIcon";
import { formatBytes } from "../format";
import type { AiResponse, CleanupCandidate, InstalledApplication } from "../types";

export function nonOverlappingCandidates(items: CleanupCandidate[]) {
  return [...items]
    .sort((left, right) => left.path.length - right.path.length)
    .filter((item, index, sorted) => !sorted.slice(0, index).some((parent) => item.path.startsWith(`${parent.path}/`)));
}

export function CleanupPage({ apps, app, candidates, state, error, selectedPaths, message, busy, aiState, aiResult, hasKey, advancedMode, onAdvancedMode, onBack, onSelectApp, onSelectSafe, onClear, onRefresh, onAi, onCleanup, onSettings }: {
  apps: InstalledApplication[];
  app: InstalledApplication | null;
  candidates: CleanupCandidate[];
  state: "idle" | "loading" | "done" | "error";
  error: string;
  selectedPaths: string[];
  message: string;
  busy: boolean;
  aiState: "idle" | "loading" | "done" | "error";
  aiResult: AiResponse | null;
  hasKey: boolean;
  advancedMode: boolean;
  onAdvancedMode: (enabled: boolean) => void;
  onBack: () => void;
  onSelectApp: (id: string) => void;
  onSelectSafe: () => void;
  onClear: () => void;
  onRefresh: () => void;
  onAi: () => void;
  onCleanup: () => void;
  onSettings: () => void;
}) {
  const deepApps = apps.filter((item) => item.support_level === "deep");
  const selected = nonOverlappingCandidates(candidates.filter((item) => selectedPaths.includes(item.path)));
  const selectedTotal = selected.reduce((sum, item) => sum + item.size_bytes, 0);
  const recommended = nonOverlappingCandidates(candidates.filter((item) => item.selectable));
  const recommendedTotal = recommended.reduce((sum, item) => sum + item.size_bytes, 0);
  const supported = app?.support_level === "deep";
  const summaryItems = selected.length ? selected : recommended;
  const summaryTotal = selected.length ? selectedTotal : recommendedTotal;
  const largestItem = summaryItems.reduce<CleanupCandidate | null>((largest, item) => !largest || item.size_bytes > largest.size_bytes ? item : largest, null);
  const folderCount = summaryItems.filter((item) => item.item_type === "folder").length;
  const safeCount = summaryItems.filter((item) => item.risk === "safe").length;
  const reviewCount = summaryItems.filter((item) => item.risk === "review").length;
  const finished = state === "done";
  const prompt = app ? `帮我找出 ${app.name} 里占空间大、值得检查的具体文件` : "帮我找出占空间大、值得检查的具体文件";

  function toggleAdvancedMode() {
    if (advancedMode) {
      onAdvancedMode(false);
      onClear();
      return;
    }
    if (window.confirm("高级手动处理仅用于你明确了解的受保护文件。每次只能处理一项，并仍会先进入隔离区。确认开启吗？")) onAdvancedMode(true);
  }

  return (
    <div className="page cleanup-page cleanup-copilot-page">
      <div className="cleanup-subview-head"><button type="button" className="ghost-button" onClick={onBack}>← 返回扫描结果</button><span>智能扫描 · 文件处理</span></div>
      <section className="cleanup-prompt-bar"><span><UiIcon name="robot" size={18} /></span><b>{prompt}</b><small>{new Date().toLocaleDateString("zh-CN", { month: "short", day: "numeric" })}</small></section>
      <div className="cleanup-context-row">
        <div className="cleanup-app-tabs" aria-label="选择深度支持应用">
          {deepApps.map((item) => <button type="button" key={item.id} className={app?.id === item.id ? "active" : ""} onClick={() => { onAdvancedMode(false); onSelectApp(item.id); }}><AppBadge app={item} small /><span><b>{item.name}</b><small>{formatBytes(item.total_size_bytes)}</small></span></button>)}
        </div>
        <button type="button" className="ghost-button cleanup-refresh" onClick={onRefresh} disabled={!supported || state === "loading"}>{state === "loading" ? "正在检查…" : "重新检查"}</button>
      </div>

      {!app && <EmptyState icon="search" title="请先完成真实扫描" description="扫描后才能定位深度支持应用中的具体占用文件。" />}
      {app && !supported && <div className="desktop-notice">{app.name}当前没有经过验证的文件操作规则，请从上方选择深度支持应用。</div>}
      {supported && !app.installed && <div className="desktop-notice">检测到{app.name}残留数据。处理前请确认这些数据已不再需要。</div>}
      {error && <div className="desktop-error">{error}</div>}
      {message && <div className="cleanup-success">{message}</div>}

      {app && supported && <>
        <section className="cleanup-process-card" aria-label="AI空间分析过程">
          <ProcessStep index={1} icon="folder" title={`扫描 ${app.name} 关联目录`} description={candidates[0]?.display_path ?? app.application_path ?? "按应用规则检查可信关联目录"} state={state === "loading" ? "active" : "done"} />
          <ProcessStep index={2} icon="files" title={state === "loading" ? "正在识别大文件和文件夹" : `已识别 ${candidates.length} 个具体项目`} description="筛选大于 5 MB 的文件和大于 50 MB 的一级文件夹" state={finished ? "done" : state === "loading" ? "active" : "waiting"} />
          <ProcessStep index={3} icon="shield" title={finished ? "风险判断已完成" : "正在判断风险"} description="依据文件类型、目录规则和可重建性标注处理边界" state={finished ? "done" : state === "loading" ? "active" : "waiting"} />
          <ProcessStep index={4} icon="check" title={selected.length ? `等待确认 ${selected.length} 个项目` : "等待你的确认"} description="右侧查看证据，确认后统一移入安全隔离区" state={selected.length ? "active" : "waiting"} last />
        </section>

        <div className="cleanup-result-heading"><div><p className="eyebrow">SELECTION SUMMARY</p><h2>{selected.length ? "当前选择汇总" : "建议检查汇总"}</h2></div><button type="button" onClick={onSelectSafe}>选择通常可重建项</button></div>
        <section className="cleanup-recommendation-card">
          <header><div><b>{selected.length ? `已选择 ${selected.length} 个项目` : `建议先检查 ${recommended.length} 个项目`}</b><small>{selected.length ? "数量和容量与右侧勾选结果保持一致" : "具体文件只在右侧展示，避免重复信息"}</small></div><strong>{formatBytes(summaryTotal)}</strong></header>
          {summaryItems.length ? <div className="cleanup-selection-overview">
            <article><span>项目数量</span><strong>{summaryItems.length}</strong><small>{selected.length ? "当前已勾选" : "当前建议检查"}</small></article>
            <article><span>涉及空间</span><strong>{formatBytes(summaryTotal)}</strong><small>已排除父子路径重复计算</small></article>
            <article><span>文件构成</span><strong>{folderCount} 个文件夹</strong><small>{summaryItems.length - folderCount} 个具体文件</small></article>
            <article><span>风险构成</span><strong>{safeCount} 安全 · {reviewCount} 查看</strong><small>{largestItem ? `最大单项 ${formatBytes(largestItem.size_bytes)}` : "等待选择"}</small></article>
          </div> : <div className="candidate-loading"><span><UiIcon name={state === "loading" ? "loader" : "circleCheck"} size={19} /></span><b>{state === "loading" ? "正在定位具体文件…" : "没有发现可正常选择的项目"}</b><p>具体文件请在右侧证据列表查看。</p></div>}
          <footer className="cleanup-summary-foot"><span>右侧：具体文件与勾选</span><i><UiIcon name="arrowRight" size={14} /></i><span>左侧：数量、容量和风险汇总</span></footer>
        </section>

        <section className="cleanup-why-card"><span><UiIcon name="help" size={18} /></span><div><b>为什么建议先检查？</b><p>推荐项通常可以重新生成或已经长时间没有变化。受保护内容仍保持锁定，所有处理都会先进入隔离区。</p></div><button type="button" className={advancedMode ? "advanced-active" : ""} onClick={toggleAdvancedMode}>{advancedMode ? "退出高级模式" : "高级手动处理"}</button></section>

        {aiResult && <section className="real-ai-result candidate-ai-result"><header><span><UiIcon name="sparkles" size={20} /></span><div><p className="eyebrow">AI匿名复核</p><h2>{aiResult.provider} · {aiResult.model}</h2></div></header><div className="ai-content">{aiResult.content}</div><footer>AI只看到编号、类型、大小、修改时间和风险标签；文件名、路径与内容不会上传。</footer></section>}

        <section className="cleanup-action-dock"><div><span><UiIcon name="shield" size={19} /></span><p><b>不会直接永久删除</b><small>已选 {selected.length} 项 · {formatBytes(selectedTotal)}</small></p></div><button type="button" className="ghost-button" onClick={hasKey ? onAi : onSettings} disabled={!candidates.length || aiState === "loading"}>{aiState === "loading" ? "AI正在复核…" : hasKey ? "先让 AI 复核" : "配置 AI 后复核"}</button><button type="button" className="primary-button" onClick={onCleanup} disabled={!selected.length || busy}>{busy ? "正在处理…" : <><UiIcon name="box" size={16} /> 移入隔离区</>}</button></section>
      </>}
    </div>
  );
}

function ProcessStep({ index, icon, title, description, state, last = false }: { index: number; icon: UiIconName; title: string; description: string; state: "active" | "done" | "waiting"; last?: boolean }) {
  return <article className={`cleanup-process-step ${state}${last ? " last" : ""}`}><span className="process-index">{index}</span><span className="process-icon"><UiIcon name={icon} size={18} /></span><div><b>{title}</b><small>{description}</small></div><em>{state === "done" ? "● 已完成" : state === "active" ? "◌ 进行中" : "◉ 等待中"}</em></article>;
}
