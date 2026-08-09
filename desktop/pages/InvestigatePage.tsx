import type { AiResponse, Provider, ScanResult } from "../types";
import { UiIcon } from "../components/UiIcon";

export function InvestigatePage({ scan, provider, hasKey, question, state, result, error, onQuestion, onInvestigate, onSettings }: {
  scan: ScanResult | null;
  provider: Provider;
  hasKey: boolean;
  question: string;
  state: "idle" | "loading" | "done" | "error";
  result: AiResponse | null;
  error: string;
  onQuestion: (value: string) => void;
  onInvestigate: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="page investigation-page">
      <div className="page-heading"><div><p className="eyebrow">AI SPACE ANALYSIS</p><h1>AI 空间调查</h1><p>AI只接收匿名容量、分类与风险汇总，所有建议都需要你自行判断。</p></div><span className={hasKey ? "privacy-chip key-ready" : "privacy-chip"}>● {provider.toUpperCase()} {hasKey ? "已配置" : "未配置"}</span></div>
      <section className="ask-card"><div className="ask-icon"><UiIcon name="brain" size={22} /></div><textarea value={question} onChange={(event) => onQuestion(event.target.value)} aria-label="输入空间调查问题" /><div className="ask-footer"><span>{scan ? `已准备 ${scan.apps.length} 个应用的匿名汇总` : "需要先完成真实扫描"}</span><button type="button" className="primary-button" onClick={onInvestigate} disabled={state === "loading"}>{state === "loading" ? "AI正在分析…" : "开始AI分析"} <i><UiIcon name="arrowRight" size={15} /></i></button></div></section>
      {!hasKey && <div className="desktop-notice">当前没有 {provider.toUpperCase()} 密钥。<button type="button" onClick={onSettings}>前往设置 →</button></div>}
      {error && <div className="desktop-error">{error}</div>}
      {result && <section className="real-ai-result"><header><span><UiIcon name="sparkles" size={20} /></span><div><p className="eyebrow">真实AI返回</p><h2>{result.provider} · {result.model}</h2></div></header><div className="ai-content">{result.content}</div><footer>AI没有文件系统操作权限，也不会声称已经检查、移动或删除文件。</footer></section>}
    </div>
  );
}
