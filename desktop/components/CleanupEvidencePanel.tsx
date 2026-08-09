import { EmptyState } from "./EmptyState";
import { UiIcon } from "./UiIcon";
import { formatBytes, riskLabels } from "../format";
import type { CleanupCandidate } from "../types";

export function CleanupEvidencePanel({
  candidates,
  selectedPaths,
  focusedPath,
  loading,
  advancedMode,
  onFocus,
  onToggle,
  onSelectSafe,
  onClear,
}: {
  candidates: CleanupCandidate[];
  selectedPaths: string[];
  focusedPath: string;
  loading: boolean;
  advancedMode: boolean;
  onFocus: (path: string) => void;
  onToggle: (item: CleanupCandidate) => void;
  onSelectSafe: () => void;
  onClear: () => void;
}) {
  const focused = candidates.find((item) => item.path === focusedPath) ?? candidates[0] ?? null;
  const selected = candidates.filter((item) => selectedPaths.includes(item.path));
  const selectedSize = selected.reduce((sum, item) => sum + item.size_bytes, 0);

  return (
    <aside className="inspector cleanup-evidence-inspector">
      <header className="evidence-head">
        <div><h2>证据与详情</h2><p>{candidates.length} 个具体项目</p></div>
        <button type="button" onClick={selected.length ? onClear : onSelectSafe}>{selected.length ? "取消选择" : "选择安全项"}</button>
      </header>
      <div className="evidence-selection-summary"><span>{selected.length ? `已选择 ${selected.length} 项` : "等待你确认"}</span><strong>{formatBytes(selectedSize)}</strong></div>
      {loading ? <div className="evidence-loading"><span><UiIcon name="loader" size={20} /></span><b>正在收集证据…</b><p>只读取文件元数据</p></div> : candidates.length ? (
        <section className="evidence-list" aria-label="清理证据列表">
          {candidates.map((item) => {
            const checked = selectedPaths.includes(item.path);
            const selectable = item.selectable || (advancedMode && item.risk === "protected");
            return (
              <article key={item.id} className={`${focused?.path === item.path ? "focused" : ""}${checked ? " selected" : ""}`}>
                <button type="button" className="evidence-main" onClick={() => onFocus(item.path)}>
                  <span className={`evidence-file-icon ${item.item_type}`}><UiIcon name={item.item_type === "folder" ? "folder" : "file"} size={20} /></span>
                  <span><b>{item.display_name}</b><small>{item.display_path}</small><em>{item.file_kind} · {item.category}</em></span>
                  <strong>{formatBytes(item.size_bytes)}</strong>
                </button>
                <label className={`evidence-check ${item.risk}`} title={selectable ? "选择此项目" : "当前风险等级不允许选择"}>
                  <input type="checkbox" checked={checked} disabled={!selectable} onChange={() => onToggle(item)} />
                  <span>{checked ? <UiIcon name="check" size={13} stroke={2.4} /> : null}</span>
                </label>
              </article>
            );
          })}
        </section>
      ) : <EmptyState icon="search" title="等待扫描结果" description="选择深度支持应用并开始检查后，这里会显示具体证据。" />}
      <section className="evidence-detail">
        <header><h3>详情</h3>{focused && <span className={`candidate-risk ${focused.risk}`}>{riskLabels[focused.risk]}</span>}</header>
        {focused ? <dl>
          <div><dt>名称</dt><dd>{focused.display_name}</dd></div>
          <div><dt>位置</dt><dd>{focused.display_path}</dd></div>
          <div><dt>类型</dt><dd>{focused.category} · {focused.file_kind}</dd></div>
          <div><dt>判断依据</dt><dd>{focused.reason}</dd></div>
        </dl> : <p>选中列表中的项目后，这里会解释位置、类型和风险依据。</p>}
      </section>
    </aside>
  );
}
