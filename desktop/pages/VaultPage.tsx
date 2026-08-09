import { EmptyState } from "../components/EmptyState";
import { UiIcon } from "../components/UiIcon";
import { formatBytes } from "../format";
import type { QuarantineItem } from "../types";

const scopeLabels: Record<QuarantineItem["scope"], string> = {
  deep: "应用深度清理",
  large: "大文件",
  duplicate: "重复文件",
  cache: "缓存",
  uninstall: "应用卸载",
};

export function VaultPage({ items, message, onRestore, onDelete }: { items: QuarantineItem[]; message: string; onRestore: (id: string) => void; onDelete: (item: QuarantineItem) => void }) {
  const total = items.reduce((sum, item) => sum + item.size_bytes, 0);
  return (
    <div className="page vault-page">
      <div className="page-heading"><div><p className="eyebrow">RECOVERABLE CLEANUP</p><h1>安全隔离区</h1><p>处理后的项目先保存在这里。确认应用运行正常后，再决定恢复或永久删除。</p></div><span className="vault-total">{items.length} 项 · {formatBytes(total)}</span></div>
      {message && <div className="cleanup-success">{message}</div>}
      <section className="vault-explainer"><span><UiIcon name="history" size={20} /></span><div><b>为什么不直接删除？</b><p>缓存规则仍可能遇到异常情况。隔离区保留原路径和恢复记录，让你有反悔机会。</p></div></section>
      <section className="vault-list">{items.length ? items.map((item) => <article key={item.id} className="vault-item"><span className={`file-kind ${item.item_type}`}><UiIcon name={item.item_type === "folder" ? "folder" : "file"} size={18} /></span><div><b>{item.display_name}</b><small>{scopeLabels[item.scope] ?? item.app_name} · 原位置 {item.original_path.replace(/^\/Users\/[^/]+/, "~")}</small><em>{new Date(item.quarantined_unix * 1000).toLocaleString("zh-CN")}</em></div><strong>{formatBytes(item.size_bytes)}</strong><button type="button" className="ghost-button" onClick={() => onRestore(item.id)}>恢复</button><button type="button" className="danger-button" onClick={() => onDelete(item)}>永久删除</button></article>) : <EmptyState icon="history" title="隔离区是空的" description="从清理工具或具体文件清理移入的项目会显示在这里。" />}</section>
    </div>
  );
}
