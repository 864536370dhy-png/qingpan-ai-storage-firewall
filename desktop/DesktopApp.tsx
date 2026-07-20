import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Theme = "dark" | "light";
type NavId = "overview" | "applications" | "investigate" | "settings";
type Provider = "gemini" | "deepseek" | "openai";

type ScanCategory = {
  label: string;
  size_bytes: number;
  modified_24h_bytes: number;
  safe_to_review: boolean;
};

type AppUsage = {
  id: string;
  name: string;
  kind: string;
  glyph: string;
  color: string;
  installed: boolean;
  size_bytes: number;
  modified_24h_bytes: number;
  reclaimable_bytes: number;
  hourly_growth_bytes: number[];
  categories: ScanCategory[];
  permission_errors: number;
};

type ScanResult = {
  scanned_at: string;
  device_name: string;
  os_version: string;
  disk_total_bytes: number;
  disk_available_bytes: number;
  disk_used_bytes: number;
  recognized_apps_bytes: number;
  modified_24h_bytes: number;
  reclaimable_bytes: number;
  apps: AppUsage[];
  permission_errors: number;
  duration_ms: number;
};

type AiResponse = {
  provider: string;
  model: string;
  content: string;
};

const providerDefaults: Record<Provider, string> = {
  gemini: "gemini-2.5-flash-lite",
  deepseek: "deepseek-v4-flash",
  openai: "gpt-5-mini",
};

const navItems: { id: NavId; icon: string; label: string }[] = [
  { id: "overview", icon: "⌂", label: "真实总览" },
  { id: "applications", icon: "◫", label: "本机软件" },
  { id: "investigate", icon: "✦", label: "AI 调查" },
  { id: "settings", icon: "⚙", label: "设置" },
];

function bytesToGb(bytes: number) {
  return bytes / 1024 / 1024 / 1024;
}

function formatBytes(bytes: number, digits = 1) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent >= 3 ? digits : 0)} ${units[exponent]}`;
}

function AppBadge({ app, small = false }: { app: AppUsage; small?: boolean }) {
  return (
    <span
      className={small ? "app-badge app-badge-small" : "app-badge"}
      style={{ "--app-color": app.color } as React.CSSProperties}
      aria-hidden="true"
    >
      {app.glyph}
    </span>
  );
}

export default function DesktopApp() {
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = window.localStorage.getItem("qingpan-theme");
    return savedTheme === "light" || savedTheme === "dark" ? savedTheme : "dark";
  });
  const [active, setActive] = useState<NavId>("overview");
  const [scanState, setScanState] = useState<"idle" | "scanning" | "done" | "error">("idle");
  const [scanProgress, setScanProgress] = useState(0);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [provider, setProvider] = useState<Provider>("gemini");
  const [model, setModel] = useState(providerDefaults.gemini);
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [keyMessage, setKeyMessage] = useState("");
  const [question, setQuestion] = useState("分析本次扫描结果，告诉我空间主要被哪些软件占用，哪些内容值得优先检查，但不要执行删除。");
  const [aiState, setAiState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [aiResult, setAiResult] = useState<AiResponse | null>(null);
  const [aiError, setAiError] = useState("");

  const apps = useMemo(() => scan?.apps ?? [], [scan]);
  const selectedApp = apps.find((app) => app.id === selectedId) ?? apps[0] ?? null;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("qingpan-theme", theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    void invoke<boolean>("api_key_status", { provider })
      .then((configured) => {
        if (!cancelled) setHasKey(configured);
      })
      .catch(() => {
        if (!cancelled) setHasKey(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  useEffect(() => {
    if (scanState !== "scanning") return;
    const timer = window.setInterval(() => {
      setScanProgress((current) => Math.min(current + (current < 55 ? 5 : 1), 92));
    }, 260);
    return () => window.clearInterval(timer);
  }, [scanState]);

  async function startScan() {
    setScanError("");
    setScanProgress(3);
    setScanState("scanning");
    try {
      const result = await invoke<ScanResult>("scan_system");
      setScan(result);
      setSelectedId(result.apps[0]?.id ?? "");
      setScanProgress(100);
      setScanState("done");
    } catch (error) {
      setScanError(String(error));
      setScanState("error");
    }
  }

  async function saveKey() {
    if (!apiKey.trim()) {
      setKeyMessage("请先输入API Key");
      return;
    }
    setKeyMessage("正在保存…");
    try {
      await invoke("save_api_key", { provider, apiKey: apiKey.trim() });
      setApiKey("");
      setHasKey(true);
      setKeyMessage("已安全保存到macOS钥匙串");
    } catch (error) {
      setKeyMessage(`保存失败：${String(error)}`);
    }
  }

  async function removeKey() {
    try {
      await invoke("delete_api_key", { provider });
      setHasKey(false);
      setApiKey("");
      setKeyMessage("已从macOS钥匙串移除");
    } catch (error) {
      setKeyMessage(`移除失败：${String(error)}`);
    }
  }

  async function investigate() {
    if (!scan) {
      setAiError("请先完成一次真实扫描");
      setAiState("error");
      return;
    }
    if (!hasKey) {
      setAiError(`请先在设置中配置${provider.toUpperCase()} API Key`);
      setAiState("error");
      return;
    }
    setAiState("loading");
    setAiError("");
    setAiResult(null);
    try {
      const result = await invoke<AiResponse>("analyze_scan", {
        provider,
        model,
        question,
        scan,
      });
      setAiResult(result);
      setAiState("done");
    } catch (error) {
      setAiError(String(error));
      setAiState("error");
    }
  }

  return (
    <main className="desktop-shell actual-desktop" data-theme={theme}>
      <aside className="sidebar">
        <div className="desktop-titlebar" data-tauri-drag-region />
        <div className="brand">
          <span className="brand-mark">Q</span>
          <div>
            <strong>轻盘</strong>
            <small>SPACE FIREWALL</small>
          </div>
        </div>
        <nav className="primary-nav" aria-label="主导航">
          <p className="nav-caption">本地工作台</p>
          {navItems.map((item) => (
            <button
              type="button"
              key={item.id}
              className={active === item.id ? "nav-item active" : "nav-item"}
              onClick={() => setActive(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span className="status-orb">✓</span>
            <div>
              <b>只读保护已开启</b>
              <small>不读取正文 · 不执行删除</small>
            </div>
          </div>
        </div>
      </aside>

      <section className="center-pane">
        <header className="topbar">
          <div className="device-status">
            <span />
            {scan ? `${scan.device_name} · ${scan.os_version}` : "Mac · 等待首次扫描"}
          </div>
          <div className="top-actions">
            <span className="demo-badge actual-badge">● 桌面真实模式</span>
            <div className="theme-switch" role="group" aria-label="界面主题">
              <button type="button" className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}>☼ <span>浅色</span></button>
              <button type="button" className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>☾ <span>深色</span></button>
            </div>
          </div>
        </header>

        <div className="content-scroll">
          {active === "overview" && (
            <OverviewPage
              scan={scan}
              scanState={scanState}
              scanProgress={scanProgress}
              error={scanError}
              onScan={startScan}
              onSelect={(id) => {
                setSelectedId(id);
                setActive("applications");
              }}
              onAi={() => setActive("investigate")}
            />
          )}
          {active === "applications" && (
            <ApplicationsPage apps={apps} selectedId={selectedApp?.id ?? ""} onSelect={setSelectedId} onScan={startScan} />
          )}
          {active === "investigate" && (
            <AiPage
              scan={scan}
              provider={provider}
              hasKey={hasKey}
              question={question}
              state={aiState}
              result={aiResult}
              error={aiError}
              onQuestion={setQuestion}
              onInvestigate={investigate}
              onSettings={() => setActive("settings")}
            />
          )}
          {active === "settings" && (
            <SettingsPage
              provider={provider}
              model={model}
              apiKey={apiKey}
              hasKey={hasKey}
              message={keyMessage}
              onProvider={(nextProvider) => {
                setProvider(nextProvider);
                setModel(providerDefaults[nextProvider]);
                setKeyMessage("");
              }}
              onModel={setModel}
              onApiKey={setApiKey}
              onSave={saveKey}
              onRemove={removeKey}
            />
          )}
        </div>
      </section>

      <Inspector app={selectedApp} onAi={() => setActive("investigate")} />

      {scanState === "scanning" && (
        <div className="scan-toast" role="status">
          <div className="scan-orbit"><span>{scanProgress}%</span></div>
          <div>
            <b>正在读取本机应用与空间元数据</b>
            <p>扫描应用包和白名单数据目录，不读取文件内容</p>
            <div className="scan-track"><i style={{ width: `${scanProgress}%` }} /></div>
          </div>
        </div>
      )}
    </main>
  );
}

function OverviewPage({
  scan,
  scanState,
  scanProgress,
  error,
  onScan,
  onSelect,
  onAi,
}: {
  scan: ScanResult | null;
  scanState: string;
  scanProgress: number;
  error: string;
  onScan: () => void;
  onSelect: (id: string) => void;
  onAi: () => void;
}) {
  const freePercent = scan ? (scan.disk_available_bytes / scan.disk_total_bytes) * 100 : 18;
  const appPercent = scan ? (scan.recognized_apps_bytes / scan.disk_total_bytes) * 100 : 22;
  const otherPercent = Math.max(0, 100 - freePercent - appPercent);
  const topApps = scan?.apps.slice(0, 8) ?? [];

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">本机空间 · 实时扫描</p>
          <h1>{scan ? "真实空间已经识别" : "先扫描一次这台电脑"}</h1>
          <p>{scan ? `本次扫描耗时 ${(scan.duration_ms / 1000).toFixed(1)} 秒，仅分析文件元数据。` : "轻盘将读取应用大小、缓存目录和修改时间，不会打开文件内容。"}</p>
        </div>
        <button type="button" className="primary-button" onClick={onScan} disabled={scanState === "scanning"}>
          <span>{scanState === "scanning" ? `${scanProgress}%` : "⌁"}</span>
          {scanState === "scanning" ? "正在扫描" : scan ? "重新扫描" : "开始真实扫描"}
        </button>
      </div>

      {error && <div className="desktop-error">{error}</div>}

      <section className="storage-card">
        <div className="storage-copy">
          <p>Macintosh HD</p>
          <strong>{scan ? formatBytes(scan.disk_available_bytes) : "—"} <span>可用</span></strong>
          <small>{scan ? `共 ${formatBytes(scan.disk_total_bytes)} · 已使用 ${((scan.disk_used_bytes / scan.disk_total_bytes) * 100).toFixed(0)}%` : "等待读取磁盘信息"}</small>
        </div>
        <div className="storage-visual" aria-label="磁盘空间组成">
          <div className="storage-bar">
            <i style={{ width: `${appPercent}%`, background: "#6d8dff" }} />
            <i style={{ width: `${otherPercent}%`, background: "#405069" }} />
            <i style={{ width: `${freePercent}%`, background: "#202936" }} />
          </div>
          <div className="storage-legend">
            <span><i className="dot-apps" />已识别软件 {scan ? formatBytes(scan.recognized_apps_bytes) : "—"}</span>
            <span><i className="dot-system" />其他已用 {scan ? formatBytes(Math.max(0, scan.disk_used_bytes - scan.recognized_apps_bytes)) : "—"}</span>
            <span><i className="dot-free" />可用 {scan ? formatBytes(scan.disk_available_bytes) : "—"}</span>
          </div>
        </div>
      </section>

      <section className="metric-grid">
        <Metric label="已识别软件" value={scan ? String(scan.apps.length) : "—"} unit="个" note="应用包与常见数据目录" tone="safe" icon="◫" />
        <Metric label="24小时活跃文件" value={scan ? bytesToGb(scan.modified_24h_bytes).toFixed(1) : "—"} unit="GB" note="新增或修改，不等于净增长" tone="warning" icon="↗" />
        <Metric label="建议检查" value={scan ? bytesToGb(scan.reclaimable_bytes).toFixed(1) : "—"} unit="GB" note="仅候选内容，尚未清理" tone="safe" icon="✓" />
      </section>

      <section className="section-block">
        <div className="section-title">
          <div><p className="eyebrow">真实占用排行</p><h2>本机软件与数据</h2></div>
          {scan && <span className="scan-meta">{scan.permission_errors ? `${scan.permission_errors} 个目录需要更多权限` : "所有白名单目录均可读取"}</span>}
        </div>
        <div className="growth-list">
          {topApps.length ? topApps.map((app, index) => (
            <button type="button" className="growth-row actual-growth-row" key={app.id} onClick={() => onSelect(app.id)}>
              <span className="rank">{String(index + 1).padStart(2, "0")}</span>
              <AppBadge app={app} small />
              <span className="growth-name"><b>{app.name}</b><small>{app.kind}{!app.installed ? " · 检测到残留数据" : ""}</small></span>
              <span className="mini-track"><i style={{ width: `${Math.max((app.size_bytes / Math.max(topApps[0].size_bytes, 1)) * 100, 2)}%`, background: app.color }} /></span>
              <strong>{formatBytes(app.size_bytes)}</strong>
              <span className="chevron">›</span>
            </button>
          )) : (
            <div className="empty-scan"><span>⌁</span><b>还没有真实数据</b><p>点击“开始真实扫描”读取这台Mac的软件占用。</p></div>
          )}
        </div>
      </section>

      <section className="ai-callout">
        <span className="ai-symbol">✦</span>
        <div>
          <p className="eyebrow">AI 调查</p>
          <h2>{scan ? "让AI解释这次真实扫描结果" : "扫描完成后即可开始AI分析"}</h2>
          <p>只发送软件名称、大小和分类汇总，不发送文件正文和完整路径。</p>
        </div>
        <button type="button" className="secondary-button" onClick={onAi}>进入AI调查</button>
      </section>
    </div>
  );
}

function ApplicationsPage({
  apps,
  selectedId,
  onSelect,
  onScan,
}: {
  apps: AppUsage[];
  selectedId: string;
  onSelect: (id: string) => void;
  onScan: () => void;
}) {
  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">LOCAL APPLICATIONS</p><h1>本机软件</h1><p>来自 `/Applications`、用户应用目录和已识别的软件数据目录。</p></div>
        <button type="button" className="ghost-button" onClick={onScan}>重新扫描</button>
      </div>
      <section className="desktop-app-grid">
        {apps.length ? apps.map((app) => (
          <button type="button" key={app.id} className={selectedId === app.id ? "desktop-app-card selected" : "desktop-app-card"} onClick={() => onSelect(app.id)}>
            <AppBadge app={app} />
            <span><b>{app.name}</b><small>{app.kind}</small></span>
            <strong>{formatBytes(app.size_bytes)}</strong>
            <em>{app.modified_24h_bytes > 0 ? `24h活跃 ${formatBytes(app.modified_24h_bytes)}` : "24h无明显变化"}</em>
          </button>
        )) : <div className="empty-scan"><span>◫</span><b>等待首次扫描</b><p>完成扫描后，这里会列出本机软件和真实占用。</p></div>}
      </section>
    </div>
  );
}

function AiPage({
  scan,
  provider,
  hasKey,
  question,
  state,
  result,
  error,
  onQuestion,
  onInvestigate,
  onSettings,
}: {
  scan: ScanResult | null;
  provider: Provider;
  hasKey: boolean;
  question: string;
  state: string;
  result: AiResponse | null;
  error: string;
  onQuestion: (value: string) => void;
  onInvestigate: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="page investigation-page">
      <div className="page-heading">
        <div><p className="eyebrow">AI SPACE ANALYSIS</p><h1>AI 空间调查</h1><p>AI只接收匿名化汇总数据，所有处理建议都需要你确认。</p></div>
        <span className={hasKey ? "privacy-chip key-ready" : "privacy-chip"}>● {provider.toUpperCase()} {hasKey ? "已配置" : "未配置"}</span>
      </div>
      <section className="ask-card">
        <div className="ask-icon">✦</div>
        <textarea value={question} onChange={(event) => onQuestion(event.target.value)} aria-label="输入空间调查问题" />
        <div className="ask-footer">
          <span>{scan ? `已准备 ${scan.apps.length} 个软件的匿名汇总` : "需要先完成真实扫描"}</span>
          <button type="button" className="primary-button" onClick={onInvestigate} disabled={state === "loading"}>
            {state === "loading" ? "AI正在分析…" : "开始AI分析"} <i>→</i>
          </button>
        </div>
      </section>
      {!hasKey && <div className="desktop-notice">当前没有{provider.toUpperCase()}密钥。<button type="button" onClick={onSettings}>前往设置 →</button></div>}
      {error && <div className="desktop-error">{error}</div>}
      {result && (
        <section className="real-ai-result">
          <header><span>✦</span><div><p className="eyebrow">真实AI返回</p><h2>{result.provider} · {result.model}</h2></div></header>
          <div className="ai-content">{result.content}</div>
          <footer>本结论仅用于辅助判断，不会触发删除操作。</footer>
        </section>
      )}
    </div>
  );
}

function SettingsPage({
  provider,
  model,
  apiKey,
  hasKey,
  message,
  onProvider,
  onModel,
  onApiKey,
  onSave,
  onRemove,
}: {
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
      <div className="page-heading"><div><p className="eyebrow">PREFERENCES</p><h1>设置</h1><p>配置AI模型和本地安全策略。</p></div></div>
      <section className="settings-panel">
        <div className="settings-panel-head"><span>✦</span><div><h2>AI模型服务</h2><p>密钥只保存在macOS钥匙串，不写入项目或浏览器存储。</p></div></div>
        <label>
          <span>服务商</span>
          <select value={provider} onChange={(event) => onProvider(event.target.value as Provider)}>
            <option value="gemini">Gemini</option>
            <option value="deepseek">DeepSeek</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
        <label>
          <span>模型名称</span>
          <input value={model} onChange={(event) => onModel(event.target.value)} />
        </label>
        <label>
          <span>API Key</span>
          <input type="password" value={apiKey} onChange={(event) => onApiKey(event.target.value)} placeholder={hasKey ? "已配置，如需替换请粘贴新Key" : "粘贴你的API Key"} />
        </label>
        <div className="key-actions">
          <span className={hasKey ? "key-status configured" : "key-status"}>{hasKey ? "✓ 当前服务商已配置" : "尚未配置"}</span>
          {hasKey && <button type="button" className="ghost-button" onClick={onRemove}>移除密钥</button>}
          <button type="button" className="primary-button" onClick={onSave}>保存到钥匙串</button>
        </div>
        {message && <p className="key-message">{message}</p>}
      </section>
      <section className="settings-list desktop-safety-list">
        <div className="setting-row"><div><b>真实扫描范围</b><p>应用包、微信、剪映、Xcode、飞书的常见数据目录</p></div><span className="read-only-pill">只读</span></div>
        <div className="setting-row"><div><b>上传范围</b><p>仅软件名称、大小、分类和风险汇总，不上传文件正文与完整路径</p></div><span className="read-only-pill">匿名化</span></div>
        <div className="setting-row"><div><b>真实删除</b><p>第一版未开放任何删除命令，AI也没有文件操作权限</p></div><span className="read-only-pill off">未开放</span></div>
      </section>
    </div>
  );
}

function Inspector({ app, onAi }: { app: AppUsage | null; onAi: () => void }) {
  if (!app) {
    return (
      <aside className="inspector desktop-inspector-empty">
        <span>◫</span><h2>等待真实扫描</h2><p>扫描后可以查看每个软件的应用包、缓存和数据组成。</p>
      </aside>
    );
  }
  const total = Math.max(app.size_bytes, 1);
  return (
    <aside className="inspector">
      <div className="inspector-head"><p>真实应用详情</p><span className="read-only-pill">只读</span></div>
      <div className="app-profile">
        <AppBadge app={app} />
        <div><h2>{app.name}</h2><p>{app.kind}</p></div>
        <span className={app.installed ? "safe-tag" : "risk-tag"}>{app.installed ? "已安装" : "残留数据"}</span>
      </div>
      <div className="app-number">
        <span>当前识别占用</span><strong>{formatBytes(app.size_bytes)} </strong>
        <p><i>↗</i> 过去24小时活跃 {formatBytes(app.modified_24h_bytes)}</p>
      </div>
      <section className="composition">
        <div className="inspector-section-title"><h3>空间组成</h3><span>{formatBytes(app.size_bytes)}</span></div>
        <div className="composition-bar">
          {app.categories.map((item, index) => <i key={`${item.label}-${index}`} style={{ width: `${Math.max((item.size_bytes / total) * 100, 1)}%`, background: ["#6d8dff", "#9a72ff", "#48d597", "#405069"][index % 4] }} />)}
        </div>
        <div className="composition-list">
          {app.categories.length ? app.categories.map((item, index) => (
            <div key={`${item.label}-${index}`}><span><i style={{ background: ["#6d8dff", "#9a72ff", "#48d597", "#405069"][index % 4] }} />{item.label}</span><b>{formatBytes(item.size_bytes)}</b></div>
          )) : <div><span>暂无额外数据目录</span><b>—</b></div>}
        </div>
      </section>
      <section className="ai-insight">
        <div><span>✦</span><b>本地规则结论</b><em>只读</em></div>
        <p>{app.reclaimable_bytes > 0 ? `发现约 ${formatBytes(app.reclaimable_bytes)} 的缓存或可重建内容，建议交给AI进一步解释后再确认。` : "当前只识别到应用主体或普通数据，没有标记可安全处理的内容。"}</p>
        <button type="button" onClick={onAi}>使用AI分析 →</button>
      </section>
      {app.permission_errors > 0 && <div className="permission-note">有 {app.permission_errors} 个目录未获得读取权限，结果可能不完整。</div>}
    </aside>
  );
}

function Metric({ label, value, unit, note, tone, icon }: { label: string; value: string; unit: string; note: string; tone: string; icon: string }) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-top"><span>{label}</span><i>{icon}</i></div>
      <strong>{value} <small>{unit}</small></strong>
      <p>{note}</p>
    </article>
  );
}
