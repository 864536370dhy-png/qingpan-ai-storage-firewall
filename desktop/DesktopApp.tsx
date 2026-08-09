import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { ApplicationDetail } from "./components/ApplicationDetail";
import { CleanupEvidencePanel } from "./components/CleanupEvidencePanel";
import { Sidebar } from "./components/Sidebar";
import { UiIcon } from "./components/UiIcon";
import { formatBytes, scanStageLabels } from "./format";
import { useSystemScan } from "./hooks/useSystemScan";
import { ApplicationsPage } from "./pages/ApplicationsPage";
import { CleanupPage, nonOverlappingCandidates } from "./pages/CleanupPage";
import { InvestigatePage } from "./pages/InvestigatePage";
import { SettingsPage } from "./pages/SettingsPage";
import { TraditionalToolsPage } from "./pages/TraditionalToolsPage";
import { VaultPage } from "./pages/VaultPage";
import type { AiResponse, CleanupBatch, CleanupCandidate, NavId, Provider, QuarantineItem, Theme } from "./types";

const providerDefaults: Record<Provider, string> = {
  gemini: "gemini-2.5-flash",
  deepseek: "deepseek-chat",
  openai: "gpt-4.1-mini",
};

export default function DesktopApp() {
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = window.localStorage.getItem("qingpan-theme");
    return savedTheme === "light" || savedTheme === "dark" ? savedTheme : "dark";
  });
  const [active, setActive] = useState<NavId>("applications");
  const [selectedId, setSelectedId] = useState("");
  const [provider, setProvider] = useState<Provider>("gemini");
  const [model, setModel] = useState(providerDefaults.gemini);
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [keyMessage, setKeyMessage] = useState("");
  const [question, setQuestion] = useState("分析本次扫描结果，告诉我应用空间主要来自哪里、哪些内容值得优先检查，但不要声称已经查看或处理文件。");
  const [aiState, setAiState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [aiResult, setAiResult] = useState<AiResponse | null>(null);
  const [aiError, setAiError] = useState("");
  const [candidates, setCandidates] = useState<CleanupCandidate[]>([]);
  const [candidateState, setCandidateState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [candidateError, setCandidateError] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [focusedCandidatePath, setFocusedCandidatePath] = useState("");
  const [advancedCleanupMode, setAdvancedCleanupMode] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState("");
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [candidateAiState, setCandidateAiState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [candidateAiResult, setCandidateAiResult] = useState<AiResponse | null>(null);
  const [quarantine, setQuarantine] = useState<QuarantineItem[]>([]);
  const [vaultMessage, setVaultMessage] = useState("");
  const { scan, state: scanState, stage, error: scanError, startScan } = useSystemScan();
  const apps = useMemo(() => scan?.apps ?? [], [scan]);
  const selectedApp = apps.find((app) => app.id === selectedId) ?? apps[0] ?? null;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("qingpan-theme", theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    void invoke<boolean>("api_key_status", { provider })
      .then((configured) => { if (!cancelled) setHasKey(configured); })
      .catch(() => { if (!cancelled) setHasKey(false); });
    return () => { cancelled = true; };
  }, [provider]);

  async function runScan() {
    const result = await startScan();
    if (result?.apps.length) setSelectedId(result.apps[0].id);
  }

  async function saveKey() {
    if (!apiKey.trim()) { setKeyMessage("请先输入API Key"); return; }
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
    if (!scan) { setAiError("请先完成一次真实扫描"); setAiState("error"); return; }
    if (!hasKey) { setAiError(`请先在设置中配置${provider.toUpperCase()} API Key`); setAiState("error"); return; }
    setAiState("loading");
    setAiError("");
    setAiResult(null);
    try {
      const result = await invoke<AiResponse>("analyze_scan", { provider, model, question, scan });
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
    setFocusedCandidatePath("");
    setCleanupMessage("");
    setCandidateAiResult(null);
    setCandidateAiState("idle");
    try {
      const result = await invoke<CleanupCandidate[]>("scan_app_candidates", { appId });
      setCandidates(result);
      setFocusedCandidatePath(result[0]?.path ?? "");
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

  function openCleanup(appId?: string) {
    const target = apps.find((app) => app.id === appId && app.support_level === "deep")
      ?? (selectedApp?.support_level === "deep" ? selectedApp : null)
      ?? apps.find((app) => app.support_level === "deep")
      ?? null;
    if (target) {
      setAdvancedCleanupMode(false);
      setSelectedId(target.id);
      void loadCandidates(target.id);
    }
    setActive("cleanup");
  }

  function navigate(id: NavId) {
    if (id === "vault") void loadQuarantine();
    setActive(id);
  }

  async function runCleanup() {
    if (!selectedApp || !selectedPaths.length) return;
    const chosen = nonOverlappingCandidates(candidates.filter((item) => (item.selectable || item.risk === "protected") && selectedPaths.includes(item.path)));
    const protectedItems = chosen.filter((item) => item.risk === "protected");
    if (protectedItems.length) {
      if (chosen.length !== 1 || protectedItems.length !== 1) {
        setCleanupMessage("受保护内容只能单项处理，不能与其他项目一起操作。");
        return;
      }
      const accepted = window.confirm(`“${protectedItems[0].display_name}”属于受保护内容，可能是工程、聊天数据或数据库。确认仅将这一项移入隔离区吗？`);
      if (!accepted) return;
    }
    if (chosen.some((item) => item.risk === "review")) {
      const accepted = window.confirm("所选内容中包含需要人工判断的项目。轻盘无法知道文件内容是否仍有价值，确认先移入隔离区吗？");
      if (!accepted) return;
    }
    setCleanupBusy(true);
    setCleanupMessage("正在移入安全隔离区…");
    try {
      const result = await invoke<CleanupBatch>("quarantine_items", { appId: selectedApp.id, paths: chosen.map((item) => item.path), advancedProtectedPaths: protectedItems.map((item) => item.path) });
      const errorCopy = result.errors.length ? `；${result.errors.length} 项处理失败` : "";
      setCleanupMessage(`已将 ${result.moved.length} 项移入隔离区，共 ${formatBytes(result.moved.reduce((sum, item) => sum + item.size_bytes, 0))}${errorCopy}`);
      setSelectedPaths([]);
      await Promise.all([loadCandidates(selectedApp.id), loadQuarantine()]);
    } catch (error) {
      setCleanupMessage(`处理失败：${String(error)}`);
    } finally {
      setCleanupBusy(false);
    }
  }

  async function reviewCandidatesWithAi() {
    if (!hasKey) { setCandidateError(`请先在设置中配置${provider.toUpperCase()} API Key`); setCandidateAiState("error"); return; }
    const chosen = candidates.filter((item) => selectedPaths.includes(item.path));
    const reviewItems = chosen.length ? chosen : candidates.slice(0, 20);
    setCandidateAiState("loading");
    setCandidateAiResult(null);
    try {
      setCandidateAiResult(await invoke<AiResponse>("analyze_cleanup_candidates", { provider, model, question: `复核${selectedApp?.name ?? "这个应用"}中的这些项目，说明哪些适合先移入隔离区。`, candidates: reviewItems }));
      setCandidateAiState("done");
    } catch (error) {
      setCandidateError(String(error));
      setCandidateAiState("error");
    }
  }

  function toggleCandidate(item: CleanupCandidate) {
    if (selectedPaths.includes(item.path)) {
      setSelectedPaths((current) => current.filter((path) => path !== item.path));
      return;
    }
    if (item.risk === "protected") {
      const confirmation = window.prompt(`你正在选择受保护项目：\n${item.display_name}\n${item.display_path}\n\n请输入“确认处理”后继续。`);
      if (confirmation !== "确认处理") return;
      setSelectedPaths([item.path]);
      return;
    }
    if (!item.selectable) return;
    setSelectedPaths((current) => {
      const hasProtected = candidates.some((candidate) => candidate.risk === "protected" && current.includes(candidate.path));
      if (hasProtected) return [item.path];
      const withoutOverlaps = current.filter((path) => !path.startsWith(`${item.path}/`) && !item.path.startsWith(`${path}/`));
      return [...withoutOverlaps, item.path];
    });
  }

  async function restoreItem(id: string) {
    try {
      await invoke("restore_quarantine_item", { id });
      setVaultMessage("项目已经恢复到原位置。建议重新扫描以刷新容量。");
      await loadQuarantine();
    } catch (error) {
      setVaultMessage(`恢复失败：${String(error)}`);
    }
  }

  async function deleteItem(item: QuarantineItem) {
    if (!window.confirm(`永久删除“${item.display_name}”吗？此操作无法恢复。`)) return;
    try {
      await invoke("permanently_delete_quarantine_item", { id: item.id });
      setVaultMessage("已从隔离区永久删除。建议重新扫描以刷新容量。");
      await loadQuarantine();
    } catch (error) {
      setVaultMessage(`永久删除失败：${String(error)}`);
    }
  }

  return (
    <main className="desktop-shell actual-desktop" data-theme={theme}>
      <Sidebar active={active === "cleanup" ? "applications" : active} onNavigate={navigate} />
      <section className="center-pane">
        <header className="topbar">
          <div className="device-status"><span />{scan ? `${scan.device_name} · ${scan.os_version}` : "Mac · 等待首次扫描"}</div>
          <div className="top-actions"><span className="demo-badge actual-badge">本机运行</span><div className="theme-switch" role="group" aria-label="界面主题"><button type="button" className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}>☼ <span>浅色</span></button><button type="button" className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>☾ <span>深色</span></button></div></div>
        </header>
        <div className="content-scroll">
          {active === "applications" && <ApplicationsPage scan={scan} scanState={scanState} scanError={scanError} selectedId={selectedApp?.id ?? ""} onSelect={setSelectedId} onScan={() => void runScan()} onAi={() => setActive("investigate")} onCleanup={(id) => openCleanup(id)} />}
          {active === "tools" && <TraditionalToolsPage apps={apps} onVaultChanged={() => void loadQuarantine()} onOpenVault={() => { void loadQuarantine(); setActive("vault"); }} />}
          {active === "cleanup" && <CleanupPage apps={apps} app={selectedApp} candidates={candidates} state={candidateState} error={candidateError} selectedPaths={selectedPaths} message={cleanupMessage} busy={cleanupBusy} aiState={candidateAiState} aiResult={candidateAiResult} hasKey={hasKey} advancedMode={advancedCleanupMode} onAdvancedMode={setAdvancedCleanupMode} onBack={() => setActive("applications")} onSelectApp={(id) => { setSelectedId(id); void loadCandidates(id); }} onSelectSafe={() => setSelectedPaths(nonOverlappingCandidates(candidates.filter((item) => item.risk === "safe" && item.selectable)).map((item) => item.path))} onClear={() => setSelectedPaths([])} onRefresh={() => { if (selectedApp) void loadCandidates(selectedApp.id); }} onAi={() => void reviewCandidatesWithAi()} onCleanup={() => void runCleanup()} onSettings={() => setActive("settings")} />}
          {active === "investigate" && <InvestigatePage scan={scan} provider={provider} hasKey={hasKey} question={question} state={aiState} result={aiResult} error={aiError} onQuestion={setQuestion} onInvestigate={() => void investigate()} onSettings={() => setActive("settings")} />}
          {active === "vault" && <VaultPage items={quarantine} message={vaultMessage} onRestore={(id) => void restoreItem(id)} onDelete={(item) => void deleteItem(item)} />}
          {active === "settings" && <SettingsPage provider={provider} model={model} apiKey={apiKey} hasKey={hasKey} message={keyMessage} onProvider={(nextProvider) => { setProvider(nextProvider); setModel(providerDefaults[nextProvider]); setKeyMessage(""); }} onModel={setModel} onApiKey={setApiKey} onSave={() => void saveKey()} onRemove={() => void removeKey()} />}
        </div>
      </section>
      {active === "cleanup" ? <CleanupEvidencePanel candidates={candidates} selectedPaths={selectedPaths} focusedPath={focusedCandidatePath} loading={candidateState === "loading"} advancedMode={advancedCleanupMode} onFocus={setFocusedCandidatePath} onToggle={toggleCandidate} onSelectSafe={() => setSelectedPaths(nonOverlappingCandidates(candidates.filter((item) => item.risk === "safe" && item.selectable)).map((item) => item.path))} onClear={() => setSelectedPaths([])} /> : <ApplicationDetail app={selectedApp} onAi={() => setActive("investigate")} onCleanup={() => openCleanup(selectedApp?.id)} />}
      {scanState === "scanning" && <div className="scan-toast stage-scan-toast" role="status"><div className="scan-orbit"><span><UiIcon name="loader" size={19} /></span></div><div><b>{scanStageLabels[stage]}</b><p>扫描应用包和可信关联目录，不读取文件内容；阶段提示不代表精确进度。</p><div className="scan-stage-dots" aria-hidden="true"><i className="active" /><i className={stage !== "discovering" ? "active" : ""} /><i className={["related", "finalizing"].includes(stage) ? "active" : ""} /><i className={stage === "finalizing" ? "active" : ""} /></div></div></div>}
    </main>
  );
}
