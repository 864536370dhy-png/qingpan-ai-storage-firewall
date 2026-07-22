import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import qingpanMark from "../public/qingpan-mark.png";

type Theme = "dark" | "light";
type NavId = "overview" | "applications" | "cleanup" | "investigate" | "vault" | "settings";
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

type CleanupCandidate = {
  id: string;
  app_id: string;
  app_name: string;
  category: string;
  display_name: string;
  display_path: string;
  path: string;
  item_type: "file" | "folder";
  file_kind: string;
  size_bytes: number;
  modified_unix: number;
  risk: "safe" | "confirm";
  reason: string;
};

type QuarantineItem = {
  id: string;
  app_id: string;
  app_name: string;
  display_name: string;
  original_path: string;
  quarantine_path: string;
  item_type: "file" | "folder";
  size_bytes: number;
  quarantined_unix: number;
};

type CleanupBatch = {
  moved: QuarantineItem[];
  errors: string[];
};

const providerDefaults: Record<Provider, string> = {
  gemini: "gemini-2.5-flash-lite",
  deepseek: "deepseek-v4-flash",
  openai: "gpt-5-mini",
};

const navItems: { id: NavId; icon: string; label: string }[] = [
  { id: "overview", icon: "⌂", label: "真实总览" },
  { id: "applications", icon: "◫", label: "本机软件" },
  { id: "cleanup", icon: "⌕", label: "具体文件清理" },
  { id: "investigate", icon: "✦", label: "AI 调查" },
  { id: "vault", icon: "↶", label: "安全隔离区" },
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

function nonOverlappingCandidates(items: CleanupCandidate[]) {
  const sorted = [...items].sort((left, right) => left.path.length - right.path.length);
  return sorted.filter((item, index) => !sorted.slice(0, index).some((parent) => item.path.startsWith(`${parent.path}/`)));
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
  const [candidates, setCandidates] = useState<CleanupCandidate[]>([]);
  const [candidateState, setCandidateState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [candidateError, setCandidateError] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [cleanupMessage, setCleanupMessage] = useState("");
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [candidateAiState, setCandidateAiState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [candidateAiResult, setCandidateAiResult] = useState<AiResponse | null>(null);
  const [quarantine, setQuarantine] = useState<QuarantineItem[]>([]);
  const [vaultMessage, setVaultMessage] = useState("");

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

  useEffect(() => {
    if (active === "cleanup" && selectedId) void loadCandidates(selectedId);
    if (active === "vault") void loadQuarantine();
  }, [active, selectedId]);

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

  async function loadCandidates(appId: string) {
    setCandidateState("loading");
    setCandidateError("");
    setSelectedPaths([]);
    setCleanupMessage("");
    setCandidateAiResult(null);
    setCandidateAiState("idle");
    try {
      const result = await invoke<CleanupCandidate[]>("scan_app_candidates", { appId });
      setCandidates(result);
      setCandidateState("done");
    } catch (error) {
      setCandidates([]);
      setCandidateError(String(error));
      setCandidateState("error");
    }
  }

  async function loadQuarantine() {
    try {
      setQuarantine(await invoke<QuarantineItem[]>("list_quarantine_items"));
    } catch (error) {
      setVaultMessage(String(error));
    }
  }

  async function runCleanup() {
    if (!selectedApp || !selectedPaths.length) return;
    const chosen = candidates.filter((item) => selectedPaths.includes(item.path));
    if (chosen.some((item) => item.risk === "confirm")) {
      const accepted = window.confirm("所选内容中包含聊天资料、工程素材或归档。轻盘无法判断文件内容是否仍有价值，确认先移入隔离区吗？");
      if (!accepted) return;
    }
    setCleanupBusy(true);
    setCleanupMessage("正在移入安全隔离区…");
    try {
      const result = await invoke<CleanupBatch>("quarantine_items", {
        appId: selectedApp.id,
        paths: selectedPaths,
      });
      const errorCopy = result.errors.length ? `；${result.errors.length} 项处理失败` : "";
      setCleanupMessage(`已将 ${result.moved.length} 项移入隔离区，释放 ${formatBytes(result.moved.reduce((sum, item) => sum + item.size_bytes, 0))}${errorCopy}`);
      setSelectedPaths([]);
      await Promise.all([loadCandidates(selectedApp.id), loadQuarantine()]);
    } catch (error) {
      setCleanupMessage(`处理失败：${String(error)}`);
    } finally {
      setCleanupBusy(false);
    }
  }

  async function reviewCandidatesWithAi() {
    if (!hasKey) {
      setCandidateAiState("error");
      setCandidateError(`请先在设置中配置${provider.toUpperCase()} API Key`);
      return;
    }
    const chosen = candidates.filter((item) => selectedPaths.includes(item.path));
    const reviewItems = chosen.length ? chosen : candidates.slice(0, 20);
    setCandidateAiState("loading");
    setCandidateAiResult(null);
    try {
      const result = await invoke<AiResponse>("analyze_cleanup_candidates", {
        provider,
        model,
        question: `复核${selectedApp?.name ?? "这个软件"}中这些大文件，告诉我哪些适合先移入隔离区。`,
        candidates: reviewItems,
      });
      setCandidateAiResult(result);
      setCandidateAiState("done");
    } catch (error) {
      setCandidateError(String(error));
      setCandidateAiState("error");
    }
  }

  async function restoreItem(id: string) {
    try {
      await invoke("restore_quarantine_item", { id });
      setVaultMessage("文件已经恢复到原位置。");
      await loadQuarantine();
    } catch (error) {
      setVaultMessage(`恢复失败：${String(error)}`);
    }
  }

  async function deleteItem(item: QuarantineItem) {
    if (!window.confirm(`永久删除“${item.display_name}”吗？此操作无法恢复。`)) return;
    try {
      await invoke("permanently_delete_quarantine_item", { id: item.id });
      setVaultMessage("已从隔离区永久删除。");
      await loadQuarantine();
    } catch (error) {
      setVaultMessage(`永久删除失败：${String(error)}`);
    }
  }

  return (
    <main className="desktop-shell actual-desktop" data-theme={theme}>
      <aside className="sidebar">
        <div className="desktop-titlebar" data-tauri-drag-region />
        <div className="brand">
          <span
            className="brand-mark"
            style={{ "--brand-mark-image": `url("${qingpanMark}")` } as React.CSSProperties}
            aria-hidden="true"
          />
          <div>
            <strong>轻盘</strong>
            <small>AI 驱动的智能空间管理产品</small>
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
              <b>安全清理已开启</b>
              <small>白名单目录 · 可恢复隔离</small>
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
                setActive("cleanup");
              }}
              onAi={() => setActive("investigate")}
            />
          )}
          {active === "applications" && (
            <ApplicationsPage apps={apps} selectedId={selectedApp?.id ?? ""} onSelect={setSelectedId} onScan={startScan} />
          )}
          {active === "cleanup" && (
            <CleanupPage
              apps={apps}
              app={selectedApp}
              candidates={candidates}
              state={candidateState}
              error={candidateError}
              selectedPaths={selectedPaths}
              message={cleanupMessage}
              busy={cleanupBusy}
              aiState={candidateAiState}
              aiResult={candidateAiResult}
              onSelectApp={setSelectedId}
              onToggle={(path) => setSelectedPaths((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path])}
              onSelectSafe={() => setSelectedPaths(nonOverlappingCandidates(candidates.filter((item) => item.risk === "safe")).map((item) => item.path))}
              onClear={() => setSelectedPaths([])}
              onRefresh={() => selectedApp && loadCandidates(selectedApp.id)}
              onAi={reviewCandidatesWithAi}
              onCleanup={runCleanup}
              onSettings={() => setActive("settings")}
              hasKey={hasKey}
            />
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
          {active === "vault" && (
            <VaultPage items={quarantine} message={vaultMessage} onRestore={restoreItem} onDelete={deleteItem} />
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

      <Inspector app={selectedApp} onAi={() => setActive("investigate")} onCleanup={() => setActive("cleanup")} />

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

function CleanupPage({
  apps,
  app,
  candidates,
  state,
  error,
  selectedPaths,
  message,
  busy,
  aiState,
  aiResult,
  onSelectApp,
  onToggle,
  onSelectSafe,
  onClear,
  onRefresh,
  onAi,
  onCleanup,
  onSettings,
  hasKey,
}: {
  apps: AppUsage[];
  app: AppUsage | null;
  candidates: CleanupCandidate[];
  state: "idle" | "loading" | "done" | "error";
  error: string;
  selectedPaths: string[];
  message: string;
  busy: boolean;
  aiState: "idle" | "loading" | "done" | "error";
  aiResult: AiResponse | null;
  onSelectApp: (id: string) => void;
  onToggle: (path: string) => void;
  onSelectSafe: () => void;
  onClear: () => void;
  onRefresh: () => void;
  onAi: () => void;
  onCleanup: () => void;
  onSettings: () => void;
  hasKey: boolean;
}) {
  const selected = nonOverlappingCandidates(candidates.filter((item) => selectedPaths.includes(item.path)));
  const selectedTotal = selected.reduce((sum, item) => sum + item.size_bytes, 0);
  const safeTotal = candidates.filter((item) => item.risk === "safe").reduce((sum, item) => sum + item.size_bytes, 0);
  const isSupported = app ? ["capcut", "wechat", "xcode", "lark"].includes(app.id) : false;

  return (
    <div className="page cleanup-page">
      <div className="page-heading cleanup-heading">
        <div>
          <p className="eyebrow">文件级空间溯源</p>
          <h1>找到具体文件，再决定清不清</h1>
          <p>轻盘只展示白名单软件目录中的大文件和大文件夹；你可以只处理其中一项。</p>
        </div>
        <button type="button" className="ghost-button" onClick={onRefresh} disabled={!app || state === "loading"}>重新检查</button>
      </div>

      <section className="cleanup-flow" aria-label="安全清理流程">
        <div className="active"><span>1</span><b>定位来源</b><small>具体到文件或文件夹</small></div>
        <i>→</i>
        <div><span>2</span><b>判断风险</b><small>本地规则 + AI复核</small></div>
        <i>→</i>
        <div><span>3</span><b>安全清理</b><small>先隔离，随时恢复</small></div>
      </section>

      <div className="cleanup-app-tabs" aria-label="选择软件">
        {apps.filter((item) => ["capcut", "wechat", "xcode", "lark"].includes(item.id)).map((item) => (
          <button type="button" key={item.id} className={app?.id === item.id ? "active" : ""} onClick={() => onSelectApp(item.id)}>
            <AppBadge app={item} small /><span><b>{item.name}</b><small>{formatBytes(item.size_bytes)}</small></span>
          </button>
        ))}
      </div>

      {!app && <div className="empty-scan"><span>⌕</span><b>请先完成真实扫描</b><p>扫描后才能定位本机的具体占用文件。</p></div>}
      {app && !isSupported && <div className="desktop-notice">{app.name}目前只能识别应用包大小，尚未建立安全的数据目录规则。请选择微信、剪映、Xcode或飞书。</div>}
      {error && <div className="desktop-error">{error}</div>}
      {message && <div className="cleanup-success">{message}</div>}

      {app && isSupported && (
        <>
          <section className="cleanup-summary-card">
            <div><span className="summary-icon">⌕</span><p><b>{app.name}具体占用</b><small>{state === "loading" ? "正在读取文件元数据…" : `发现 ${candidates.length} 个大文件或文件夹`}</small></p></div>
            <div><span>本地规则建议</span><strong>{formatBytes(safeTotal)}</strong><small>可优先移入隔离区</small></div>
            <div><span>本次已选择</span><strong>{formatBytes(selectedTotal)}</strong><small>{selected.length} 项</small></div>
          </section>

          <section className="candidate-panel">
            <header>
              <div><h2>具体是哪一个文件占空间</h2><p>不会整包清空；每一项都由你单独选择。</p></div>
              <div className="candidate-actions">
                <button type="button" onClick={onSelectSafe}>只选绿色安全项</button>
                <button type="button" onClick={onClear}>取消选择</button>
              </div>
            </header>
            {state === "loading" ? (
              <div className="candidate-loading"><span>⌁</span><b>正在定位具体文件…</b><p>大目录可能需要几十秒，请保持软件窗口开启。</p></div>
            ) : candidates.length ? (
              <div className="candidate-list">
                {candidates.map((item, index) => {
                  const checked = selectedPaths.includes(item.path);
                  return (
                    <label className={checked ? "candidate-row selected" : "candidate-row"} key={item.id}>
                      <input type="checkbox" checked={checked} onChange={() => onToggle(item.path)} />
                      <span className={`file-kind ${item.item_type}`}>{item.item_type === "folder" ? "▣" : "▤"}</span>
                      <span className="candidate-main">
                        <b>{item.display_name}</b>
                        <small>{item.display_path}</small>
                        <em>{item.reason}</em>
                      </span>
                      <span className="candidate-meta"><i>{item.category} · {item.file_kind}</i><strong>{formatBytes(item.size_bytes)}</strong></span>
                      <span className={item.risk === "safe" ? "candidate-risk safe" : "candidate-risk confirm"}>{item.risk === "safe" ? "可安全处理" : "需要确认"}</span>
                      <span className="candidate-index">#{index + 1}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="candidate-loading"><span>✓</span><b>没有发现明显的大文件</b><p>轻盘仅展示大于5MB的文件和大于50MB的一级文件夹。</p></div>
            )}
          </section>

          <section className="cleanup-decision-bar">
            <div><span>已选 {selected.length} 项</span><strong>{formatBytes(selectedTotal)}</strong><small>实际操作会先移入隔离区，不会直接永久删除。</small></div>
            <button type="button" className="ghost-button" onClick={hasKey ? onAi : onSettings} disabled={!candidates.length || aiState === "loading"}>
              {aiState === "loading" ? "AI正在复核…" : hasKey ? "✦ 让AI复核" : "配置AI后复核"}
            </button>
            <button type="button" className="primary-button cleanup-button" onClick={onCleanup} disabled={!selected.length || busy}>
              {busy ? "正在处理…" : "移入安全隔离区"}
            </button>
          </section>

          {aiResult && (
            <section className="real-ai-result candidate-ai-result">
              <header><span>✦</span><div><p className="eyebrow">AI匿名复核</p><h2>{aiResult.provider} · {aiResult.model}</h2></div></header>
              <div className="ai-content">{aiResult.content}</div>
              <footer>AI只看到编号、类型、大小、修改时间和风险标签；文件名、路径与文件内容不会上传。</footer>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function VaultPage({
  items,
  message,
  onRestore,
  onDelete,
}: {
  items: QuarantineItem[];
  message: string;
  onRestore: (id: string) => void;
  onDelete: (item: QuarantineItem) => void;
}) {
  const total = items.reduce((sum, item) => sum + item.size_bytes, 0);
  return (
    <div className="page vault-page">
      <div className="page-heading">
        <div><p className="eyebrow">可恢复清理</p><h1>安全隔离区</h1><p>清理后的项目先保存在这里。确认软件运行正常后，再决定是否永久删除。</p></div>
        <span className="vault-total">{items.length} 项 · {formatBytes(total)}</span>
      </div>
      {message && <div className="cleanup-success">{message}</div>}
      <section className="vault-explainer"><span>↶</span><div><b>为什么不直接删除？</b><p>微信聊天资料、剪映工程和Xcode归档都可能有误判。隔离让你先释放原目录空间，同时保留恢复机会。</p></div></section>
      <section className="vault-list">
        {items.length ? items.map((item) => (
          <article key={item.id} className="vault-item">
            <span className="file-kind">{item.item_type === "folder" ? "▣" : "▤"}</span>
            <div><b>{item.display_name}</b><small>{item.app_name} · 原位置 {item.original_path.replace(/^\/Users\/[^/]+/, "~")}</small><em>{new Date(item.quarantined_unix * 1000).toLocaleString("zh-CN")}</em></div>
            <strong>{formatBytes(item.size_bytes)}</strong>
            <button type="button" className="ghost-button" onClick={() => onRestore(item.id)}>恢复</button>
            <button type="button" className="danger-button" onClick={() => onDelete(item)}>永久删除</button>
          </article>
        )) : <div className="empty-scan"><span>↶</span><b>隔离区是空的</b><p>从“具体文件清理”移入的项目会显示在这里。</p></div>}
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
        <div className="setting-row"><div><b>真实扫描范围</b><p>应用包、微信、剪映、Xcode、飞书的常见数据目录</p></div><span className="read-only-pill">白名单</span></div>
        <div className="setting-row"><div><b>上传范围</b><p>仅软件名称、大小、分类和风险汇总，不上传文件正文与完整路径</p></div><span className="read-only-pill">匿名化</span></div>
        <div className="setting-row"><div><b>文件级安全清理</b><p>只能由你选择具体文件，先移入轻盘隔离区，支持恢复</p></div><span className="read-only-pill">已开放</span></div>
        <div className="setting-row"><div><b>永久删除</b><p>只能在隔离区手动执行，并需要再次确认；AI没有删除权限</p></div><span className="read-only-pill off">人工确认</span></div>
      </section>
    </div>
  );
}

function Inspector({ app, onAi, onCleanup }: { app: AppUsage | null; onAi: () => void; onCleanup: () => void }) {
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
      <div className="inspector-head"><p>真实应用详情</p><span className="read-only-pill">文件级</span></div>
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
        <div><span>✦</span><b>下一步不是整包删除</b><em>可恢复</em></div>
        <p>{app.reclaimable_bytes > 0 ? `发现约 ${formatBytes(app.reclaimable_bytes)} 的缓存或可重建内容。可以继续查看具体文件，只处理你选中的项目。` : "当前没有标记可自动处理的内容，但仍可以查看具体大文件并逐项确认。"}</p>
        <button type="button" onClick={onCleanup}>查看具体文件 →</button>
        <button type="button" onClick={onAi}>使用AI解释 →</button>
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
