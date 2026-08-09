import type { Provider } from "../types";
import { UiIcon } from "../components/UiIcon";

export function SettingsPage({ provider, model, apiKey, hasKey, message, onProvider, onModel, onApiKey, onSave, onRemove }: {
  provider: Provider;
  model: string;
  apiKey: string;
  hasKey: boolean;
  message: string;
  onProvider: (provider: Provider) => void;
  onModel: (model: string) => void;
  onApiKey: (value: string) => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="page">
      <div className="page-heading"><div><p className="eyebrow">PREFERENCES</p><h1>设置</h1><p>配置AI模型、本地扫描策略与安全清理边界。</p></div></div>
      <section className="settings-panel">
        <div className="settings-panel-head"><span><UiIcon name="settings" size={20} /></span><div><h2>AI模型服务</h2><p>密钥只保存在macOS钥匙串，不写入项目或浏览器存储。</p></div></div>
        <label><span>服务商</span><select value={provider} onChange={(event) => onProvider(event.target.value as Provider)}><option value="gemini">Gemini</option><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option></select></label>
        <label><span>模型名称</span><input value={model} onChange={(event) => onModel(event.target.value)} /></label>
        <label><span>API Key</span><input type="password" value={apiKey} onChange={(event) => onApiKey(event.target.value)} placeholder={hasKey ? "已配置，如需替换请粘贴新Key" : "粘贴你的API Key"} /></label>
        <div className="key-actions"><span className={hasKey ? "key-status configured" : "key-status"}>{hasKey ? <><UiIcon name="circleCheck" size={15} /> 当前服务商已配置</> : "尚未配置"}</span>{hasKey && <button type="button" className="ghost-button" onClick={onRemove}>移除密钥</button>}<button type="button" className="primary-button" onClick={onSave}>保存到钥匙串</button></div>
        {message && <p className="key-message">{message}</p>}
      </section>
      <section className="settings-list desktop-safety-list">
        <div className="setting-row"><div><b>真实扫描范围</b><p>全部系统与用户应用包，以及经过规则或Bundle ID可信关联的数据目录</p></div><span className="read-only-pill">本地元数据</span></div>
        <div className="setting-row"><div><b>上传范围</b><p>仅应用名称、容量、分类和风险汇总，不上传文件名、完整路径或正文</p></div><span className="read-only-pill">匿名化</span></div>
        <div className="setting-row"><div><b>未知目录</b><p>统一标为规则未知或受保护，不声称可安全处理</p></div><span className="read-only-pill off">人工判断</span></div>
        <div className="setting-row"><div><b>具体文件清理</b><p>仅开放深度规则中的安全或需确认项目，处理时先移入轻盘隔离区</p></div><span className="read-only-pill">可恢复</span></div>
        <div className="setting-row"><div><b>传统清理工具</b><p>大文件只看元数据；重复文件仅在主动扫描后于本机读取内容并计算指纹</p></div><span className="read-only-pill">本机处理</span></div>
        <div className="setting-row"><div><b>应用卸载</b><p>普通应用包与明确匹配的缓存可恢复卸载；其他关联数据继续交给深度规则判断</p></div><span className="read-only-pill">范围可见</span></div>
        <div className="setting-row"><div><b>永久删除</b><p>只能在隔离区逐项操作，并再次确认；AI没有文件操作权限</p></div><span className="read-only-pill off">人工确认</span></div>
      </section>
    </div>
  );
}
