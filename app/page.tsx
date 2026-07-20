"use client";

import { useEffect, useMemo, useState } from "react";

type NavId = "overview" | "changes" | "budgets" | "investigate" | "vault" | "settings";
type AppId = "capcut" | "wechat" | "xcode" | "lark";
type Theme = "dark" | "light";
type ChartSourceId = AppId | "other";

type AppRecord = {
  id: AppId;
  name: string;
  glyph: string;
  color: string;
  size: number;
  growth: number;
  budget: number;
  kind: string;
  summary: string;
  composition: { label: string; size: number; color: string }[];
};

type PlanAction = {
  id: string;
  title: string;
  detail: string;
  size: number;
  risk: "安全" | "需确认";
};

type VaultRecord = {
  appName: string;
  total: number;
  actionTitles: string[];
};

const apps: AppRecord[] = [
  {
    id: "capcut",
    name: "剪映",
    glyph: "剪",
    color: "#6d8dff",
    size: 48.6,
    growth: 18.4,
    budget: 30,
    kind: "视频创作",
    summary: "增长主要来自预览缓存和已关闭项目的代理文件，原始素材与工程文件未被列入方案。",
    composition: [
      { label: "工程素材", size: 19.8, color: "#6d8dff" },
      { label: "代理文件", size: 14.6, color: "#9a72ff" },
      { label: "预览缓存", size: 10.2, color: "#48d597" },
      { label: "其他", size: 4, color: "#3b4658" },
    ],
  },
  {
    id: "wechat",
    name: "微信",
    glyph: "微",
    color: "#34c985",
    size: 27.8,
    growth: 9.7,
    budget: 20,
    kind: "沟通协作",
    summary: "最近群聊视频和重复下载增长明显，可先整理三个月前的大文件副本。",
    composition: [
      { label: "聊天图片", size: 10.4, color: "#34c985" },
      { label: "视频", size: 9.2, color: "#6d8dff" },
      { label: "文件", size: 5.6, color: "#f6b860" },
      { label: "缓存", size: 2.6, color: "#3b4658" },
    ],
  },
  {
    id: "xcode",
    name: "Xcode",
    glyph: "X",
    color: "#2fa8ff",
    size: 21.4,
    growth: 3.5,
    budget: 25,
    kind: "开发工具",
    summary: "空间仍在预算内，主要由模拟器和 DerivedData 构成，可按项目使用时间分批处理。",
    composition: [
      { label: "模拟器", size: 8.8, color: "#2fa8ff" },
      { label: "构建缓存", size: 7.1, color: "#6d8dff" },
      { label: "归档", size: 3.4, color: "#9a72ff" },
      { label: "其他", size: 2.1, color: "#3b4658" },
    ],
  },
  {
    id: "lark",
    name: "飞书",
    glyph: "飞",
    color: "#5877ff",
    size: 9.6,
    growth: 1.2,
    budget: 10,
    kind: "办公协作",
    summary: "接近预算上限，会议回放缓存与重复附件可安全释放约 2.1 GB。",
    composition: [
      { label: "会议缓存", size: 4.2, color: "#5877ff" },
      { label: "附件", size: 2.8, color: "#6d8dff" },
      { label: "图片", size: 1.7, color: "#48d597" },
      { label: "其他", size: 0.9, color: "#3b4658" },
    ],
  },
];

const planActionsByApp: Record<AppId, PlanAction[]> = {
  capcut: [
    { id: "capcut-preview", title: "过期预览缓存", detail: "30 天未访问，可由剪映重新生成", size: 8.2, risk: "安全" },
    { id: "capcut-proxy", title: "已关闭项目代理文件", detail: "对应原始素材仍在本地", size: 5.4, risk: "安全" },
    { id: "capcut-thumb", title: "缩略图与波形缓存", detail: "下次打开项目时自动重建", size: 3.1, risk: "安全" },
    { id: "capcut-export", title: "重复导出的视频", detail: "内容相同，但需要你确认保留版本", size: 2.7, risk: "需确认" },
  ],
  wechat: [
    { id: "wechat-video", title: "三个月前的群聊视频", detail: "聊天记录仍保留，仅移走本地大文件副本", size: 4.8, risk: "安全" },
    { id: "wechat-duplicate", title: "重复下载的文件", detail: "按文件内容校验，保留最新的一份", size: 2.6, risk: "安全" },
    { id: "wechat-cache", title: "图片缩略图与临时缓存", detail: "再次浏览聊天时可以自动生成", size: 1.2, risk: "安全" },
    { id: "wechat-original", title: "长期未打开的原始视频", detail: "可能仍有价值，需要你逐个确认", size: 1.7, risk: "需确认" },
  ],
  xcode: [
    { id: "xcode-derived", title: "DerivedData 构建缓存", detail: "重新编译项目时会自动生成", size: 5.8, risk: "安全" },
    { id: "xcode-simulator", title: "不再使用的模拟器", detail: "未被近期项目引用的旧系统版本", size: 3.4, risk: "安全" },
    { id: "xcode-support", title: "旧设备支持文件", detail: "90 天未连接过对应系统设备", size: 2.2, risk: "安全" },
    { id: "xcode-archive", title: "历史发布归档", detail: "可能用于崩溃符号化，需要你确认", size: 2.8, risk: "需确认" },
  ],
  lark: [
    { id: "lark-meeting", title: "会议回放缓存", detail: "云端回放仍保留，可按需重新加载", size: 2.1, risk: "安全" },
    { id: "lark-duplicate", title: "重复下载的附件", detail: "保留最近打开的一份本地文件", size: 1.4, risk: "安全" },
    { id: "lark-image", title: "图片缩略图缓存", detail: "不影响聊天中的原始图片", size: 0.8, risk: "安全" },
    { id: "lark-download", title: "长期未打开的下载文件", detail: "可能是工作资料，需要你确认", size: 0.9, risk: "需确认" },
  ],
};

function defaultSelectedActions(id: AppId) {
  return planActionsByApp[id].filter((action) => action.risk === "安全").map((action) => action.id);
}

const navItems: { id: NavId; icon: string; label: string }[] = [
  { id: "overview", icon: "⌂", label: "总览" },
  { id: "changes", icon: "↗", label: "空间变化" },
  { id: "budgets", icon: "◎", label: "应用预算" },
  { id: "investigate", icon: "✦", label: "AI 调查" },
  { id: "vault", icon: "↶", label: "安全恢复" },
];

const timeline = [
  { time: "14:32", app: "剪映", note: "生成 4K 预览缓存", size: "+6.8 GB", tone: "purple" },
  { time: "12:18", app: "微信", note: "群聊接收 17 个视频", size: "+3.4 GB", tone: "green" },
  { time: "10:46", app: "Xcode", note: "新增 iOS 模拟器", size: "+2.1 GB", tone: "blue" },
  { time: "09:25", app: "飞书", note: "会议回放离线缓存", size: "+1.2 GB", tone: "indigo" },
];

const chartSourceMeta: Record<ChartSourceId, { name: string; color: string }> = {
  capcut: { name: "剪映", color: "#9a72ff" },
  wechat: { name: "微信", color: "#34c985" },
  xcode: { name: "Xcode", color: "#2fa8ff" },
  lark: { name: "飞书", color: "#5f7fe8" },
  other: { name: "其他文件", color: "#8f9aaa" },
};

const hourlyGrowth: { time: string; total: number; sources: { id: ChartSourceId; value: number }[] }[] = [
  { time: "00:00–01:00", total: 0.2, sources: [{ id: "wechat", value: 0.1 }, { id: "other", value: 0.1 }] },
  { time: "01:00–02:00", total: 0.2, sources: [{ id: "capcut", value: 0.1 }, { id: "other", value: 0.1 }] },
  { time: "02:00–03:00", total: 0.4, sources: [{ id: "wechat", value: 0.2 }, { id: "lark", value: 0.1 }, { id: "other", value: 0.1 }] },
  { time: "03:00–04:00", total: 0.4, sources: [{ id: "xcode", value: 0.2 }, { id: "wechat", value: 0.1 }, { id: "other", value: 0.1 }] },
  { time: "04:00–05:00", total: 0.5, sources: [{ id: "wechat", value: 0.3 }, { id: "lark", value: 0.1 }, { id: "other", value: 0.1 }] },
  { time: "05:00–06:00", total: 0.8, sources: [{ id: "xcode", value: 0.4 }, { id: "wechat", value: 0.2 }, { id: "other", value: 0.2 }] },
  { time: "06:00–07:00", total: 1.1, sources: [{ id: "capcut", value: 0.5 }, { id: "wechat", value: 0.3 }, { id: "xcode", value: 0.2 }, { id: "other", value: 0.1 }] },
  { time: "07:00–08:00", total: 1.3, sources: [{ id: "capcut", value: 0.7 }, { id: "wechat", value: 0.3 }, { id: "lark", value: 0.2 }, { id: "other", value: 0.1 }] },
  { time: "08:00–09:00", total: 1.4, sources: [{ id: "capcut", value: 0.8 }, { id: "wechat", value: 0.4 }, { id: "lark", value: 0.2 }] },
  { time: "09:00–10:00", total: 1.7, sources: [{ id: "capcut", value: 0.9 }, { id: "wechat", value: 0.5 }, { id: "xcode", value: 0.2 }, { id: "other", value: 0.1 }] },
  { time: "10:00–11:00", total: 2.0, sources: [{ id: "capcut", value: 1.2 }, { id: "wechat", value: 0.4 }, { id: "xcode", value: 0.3 }, { id: "lark", value: 0.1 }] },
  { time: "11:00–12:00", total: 2.0, sources: [{ id: "capcut", value: 1.0 }, { id: "wechat", value: 0.6 }, { id: "xcode", value: 0.3 }, { id: "other", value: 0.1 }] },
  { time: "12:00–13:00", total: 1.1, sources: [{ id: "wechat", value: 0.5 }, { id: "capcut", value: 0.3 }, { id: "lark", value: 0.2 }, { id: "other", value: 0.1 }] },
  { time: "13:00–14:00", total: 1.1, sources: [{ id: "capcut", value: 0.4 }, { id: "wechat", value: 0.4 }, { id: "xcode", value: 0.2 }, { id: "other", value: 0.1 }] },
  { time: "14:00–15:00", total: 2.2, sources: [{ id: "capcut", value: 1.4 }, { id: "wechat", value: 0.4 }, { id: "xcode", value: 0.3 }, { id: "other", value: 0.1 }] },
  { time: "15:00–16:00", total: 2.6, sources: [{ id: "capcut", value: 1.6 }, { id: "wechat", value: 0.5 }, { id: "xcode", value: 0.3 }, { id: "lark", value: 0.2 }] },
  { time: "16:00–17:00", total: 1.4, sources: [{ id: "capcut", value: 0.7 }, { id: "wechat", value: 0.4 }, { id: "lark", value: 0.2 }, { id: "other", value: 0.1 }] },
  { time: "17:00–18:00", total: 1.6, sources: [{ id: "capcut", value: 0.8 }, { id: "wechat", value: 0.5 }, { id: "xcode", value: 0.2 }, { id: "other", value: 0.1 }] },
  { time: "18:00–19:00", total: 1.9, sources: [{ id: "capcut", value: 1.0 }, { id: "wechat", value: 0.6 }, { id: "xcode", value: 0.2 }, { id: "lark", value: 0.1 }] },
  { time: "19:00–20:00", total: 1.9, sources: [{ id: "capcut", value: 1.1 }, { id: "wechat", value: 0.5 }, { id: "xcode", value: 0.2 }, { id: "other", value: 0.1 }] },
  { time: "20:00–21:00", total: 1.5, sources: [{ id: "capcut", value: 0.7 }, { id: "wechat", value: 0.5 }, { id: "lark", value: 0.2 }, { id: "other", value: 0.1 }] },
  { time: "21:00–22:00", total: 1.4, sources: [{ id: "capcut", value: 0.6 }, { id: "wechat", value: 0.5 }, { id: "xcode", value: 0.2 }, { id: "other", value: 0.1 }] },
  { time: "22:00–23:00", total: 1.3, sources: [{ id: "capcut", value: 0.5 }, { id: "wechat", value: 0.5 }, { id: "lark", value: 0.2 }, { id: "other", value: 0.1 }] },
  { time: "23:00–现在", total: 1.6, sources: [{ id: "capcut", value: 0.6 }, { id: "wechat", value: 0.6 }, { id: "xcode", value: 0.2 }, { id: "lark", value: 0.1 }, { id: "other", value: 0.1 }] },
];

function AppBadge({ app, small = false }: { app: AppRecord; small?: boolean }) {
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

export default function Home() {
  const [active, setActive] = useState<NavId>("overview");
  const [selectedId, setSelectedId] = useState<AppId>("capcut");
  const [scanState, setScanState] = useState<"idle" | "scanning" | "done">("idle");
  const [scanProgress, setScanProgress] = useState(0);
  const [planOpen, setPlanOpen] = useState(false);
  const [selectedActions, setSelectedActions] = useState<string[]>(defaultSelectedActions("capcut"));
  const [vaultRecord, setVaultRecord] = useState<VaultRecord | null>(null);
  const [restored, setRestored] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [query, setQuery] = useState("为什么今天突然多了 31 GB？找出来源，但先不要删除");
  const [investigated, setInvestigated] = useState(false);
  const [budgets, setBudgets] = useState<Record<AppId, number>>({
    capcut: 30,
    wechat: 20,
    xcode: 25,
    lark: 10,
  });

  const selectedApp = apps.find((app) => app.id === selectedId) ?? apps[0];
  const currentPlanActions = planActionsByApp[selectedId];
  const planTotal = useMemo(
    () => currentPlanActions.filter((action) => selectedActions.includes(action.id)).reduce((sum, action) => sum + action.size, 0),
    [currentPlanActions, selectedActions],
  );

  useEffect(() => {
    if (scanState !== "scanning") return;
    const timer = window.setInterval(() => {
      setScanProgress((current) => {
        if (current >= 100) {
          window.clearInterval(timer);
          setScanState("done");
          return 100;
        }
        return Math.min(current + 4, 100);
      });
    }, 55);
    return () => window.clearInterval(timer);
  }, [scanState]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("qingpan-theme");
    const frame = window.requestAnimationFrame(() => {
      if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("qingpan-theme", theme);
  }, [theme]);

  function startScan() {
    setScanProgress(0);
    setScanState("scanning");
  }

  function submitInvestigation() {
    setInvestigated(false);
    window.setTimeout(() => setInvestigated(true), 550);
  }

  function confirmPlan() {
    setVaultRecord({
      appName: selectedApp.name,
      total: planTotal,
      actionTitles: currentPlanActions.filter((action) => selectedActions.includes(action.id)).map((action) => action.title),
    });
    setRestored(false);
    setPlanOpen(false);
    setActive("vault");
  }

  function selectApp(id: AppId) {
    setSelectedId(id);
    setSelectedActions(defaultSelectedActions(id));
    const app = apps.find((item) => item.id === id);
    if (app) setQuery(`分析${app.name}最近为什么占用变大，找出可以安全处理的内容，但先不要删除`);
  }

  return (
    <main className="desktop-shell" data-theme={theme}>
      <aside className="sidebar">
        <div className="window-controls" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>

        <div className="brand">
          <span className="brand-mark">Q</span>
          <div>
            <strong>轻盘</strong>
            <small>SPACE FIREWALL</small>
          </div>
        </div>

        <nav className="primary-nav" aria-label="主导航">
          <p className="nav-caption">工作台</p>
          {navItems.map((item) => (
            <button
              type="button"
              key={item.id}
              className={active === item.id ? "nav-item active" : "nav-item"}
              onClick={() => setActive(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === "vault" && vaultRecord && <em>1</em>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="local-status">
            <span className="status-orb">✓</span>
            <div>
              <b>本地保护已开启</b>
              <small>文件内容不会上传</small>
            </div>
          </div>
          <button type="button" className="nav-item" onClick={() => setActive("settings")}>
            <span className="nav-icon">⚙</span>
            <span>设置</span>
          </button>
        </div>
      </aside>

      <section className="center-pane">
        <header className="topbar">
          <div className="device-status">
            <span />
            MacBook Pro · 在线
          </div>
          <div className="top-actions">
            <span className="demo-badge">前端演示模式</span>
            <div className="theme-switch" role="group" aria-label="界面主题">
              <button
                type="button"
                className={theme === "light" ? "active" : ""}
                onClick={() => setTheme("light")}
                aria-pressed={theme === "light"}
              >
                ☼ <span>浅色</span>
              </button>
              <button
                type="button"
                className={theme === "dark" ? "active" : ""}
                onClick={() => setTheme("dark")}
                aria-pressed={theme === "dark"}
              >
                ☾ <span>深色</span>
              </button>
            </div>
            <button type="button" className="icon-button" aria-label="通知">◌</button>
            <span className="avatar">D</span>
          </div>
        </header>

        <div className="content-scroll">
          {active === "overview" && (
            <Overview
              scanState={scanState}
              scanProgress={scanProgress}
              onScan={startScan}
              onNavigate={setActive}
              onSelectApp={selectApp}
              onPlan={() => setPlanOpen(true)}
            />
          )}
          {active === "changes" && <Changes onSelectApp={selectApp} />}
          {active === "budgets" && (
            <Budgets budgets={budgets} onChange={(id, value) => setBudgets((current) => ({ ...current, [id]: value }))} />
          )}
          {active === "investigate" && (
            <Investigation
              app={selectedApp}
              actions={currentPlanActions}
              query={query}
              investigated={investigated}
              onChange={setQuery}
              onSubmit={submitInvestigation}
              onPlan={() => setPlanOpen(true)}
            />
          )}
          {active === "vault" && (
            <Vault
              record={vaultRecord}
              restored={restored}
              onRestore={() => {
                setRestored(true);
                setVaultRecord(null);
              }}
            />
          )}
          {active === "settings" && <Settings />}
        </div>
      </section>

      <Inspector app={selectedApp} budget={budgets[selectedApp.id]} onPlan={() => setPlanOpen(true)} onInvestigate={() => setActive("investigate")} />

      {scanState === "scanning" && (
        <div className="scan-toast" role="status">
          <div className="scan-orbit"><span>{scanProgress}%</span></div>
          <div>
            <b>正在建立空间变化索引</b>
            <p>只读取文件元信息，不上传文件内容</p>
            <div className="scan-track"><i style={{ width: `${scanProgress}%` }} /></div>
          </div>
        </div>
      )}

      {scanState === "done" && (
        <button type="button" className="done-toast" onClick={() => setScanState("idle")}>
          <span>✓</span>
          扫描完成：发现 21.4 GB 可安全释放
          <i>×</i>
        </button>
      )}

      {planOpen && (
        <PlanModal
          app={selectedApp}
          actions={currentPlanActions}
          selected={selectedActions}
          total={planTotal}
          onToggle={(id) =>
            setSelectedActions((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
          }
          onClose={() => setPlanOpen(false)}
          onConfirm={confirmPlan}
        />
      )}
    </main>
  );
}

function Overview({
  scanState,
  scanProgress,
  onScan,
  onNavigate,
  onSelectApp,
  onPlan,
}: {
  scanState: "idle" | "scanning" | "done";
  scanProgress: number;
  onScan: () => void;
  onNavigate: (id: NavId) => void;
  onSelectApp: (id: AppId) => void;
  onPlan: () => void;
}) {
  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">空间总览 · 今天</p>
          <h1>下午好，皓阳</h1>
          <p>电脑空间正在快速变化，轻盘已经找到了原因。</p>
        </div>
        <button type="button" className="primary-button" onClick={onScan} disabled={scanState === "scanning"}>
          <span>{scanState === "scanning" ? `${scanProgress}%` : "⌁"}</span>
          {scanState === "scanning" ? "正在扫描" : scanState === "done" ? "重新扫描" : "开始扫描"}
        </button>
      </div>

      <section className="storage-card">
        <div className="storage-copy">
          <p>Macintosh HD</p>
          <strong>96 <span>GB 可用</span></strong>
          <small>共 512 GB · 已使用 81%</small>
        </div>
        <div className="storage-visual" aria-label="磁盘空间组成">
          <div className="storage-bar">
            <i className="storage-apps" />
            <i className="storage-files" />
            <i className="storage-system" />
            <i className="storage-free" />
          </div>
          <div className="storage-legend">
            <span><i className="dot-apps" />应用 128 GB</span>
            <span><i className="dot-files" />个人文件 174 GB</span>
            <span><i className="dot-system" />系统 114 GB</span>
            <span><i className="dot-free" />可用 96 GB</span>
          </div>
        </div>
      </section>

      <section className="metric-grid">
        <Metric label="24 小时增长" value="+31.6" unit="GB" note="比日常高 4.2 倍" tone="danger" icon="↗" />
        <Metric label="预计用满" value="2.8" unit="天" note="按当前速度计算" tone="warning" icon="◷" />
        <Metric label="可安全释放" value="21.4" unit="GB" note="不影响原文件" tone="safe" icon="✓" />
      </section>

      <section className="section-block">
        <div className="section-title">
          <div>
            <p className="eyebrow">增长排行</p>
            <h2>谁在占用新空间</h2>
          </div>
          <button type="button" className="text-button" onClick={() => onNavigate("changes")}>查看完整变化 →</button>
        </div>
        <div className="growth-list">
          {apps.map((app, index) => {
            const ratio = Math.min((app.growth / 18.4) * 100, 100);
            return (
              <button type="button" className="growth-row" key={app.id} onClick={() => onSelectApp(app.id)}>
                <span className="rank">{String(index + 1).padStart(2, "0")}</span>
                <AppBadge app={app} small />
                <span className="growth-name"><b>{app.name}</b><small>{app.kind}</small></span>
                <span className="mini-track"><i style={{ width: `${ratio}%`, background: app.color }} /></span>
                <strong>+{app.growth} GB</strong>
                <span className="chevron">›</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="ai-callout">
        <span className="ai-symbol">✦</span>
        <div>
          <p className="eyebrow">AI 发现</p>
          <h2>剪映在 6 小时内新增了 18.4 GB</h2>
          <p>主要是预览缓存和已关闭项目代理文件，预计可安全释放 16.7 GB。</p>
        </div>
        <button type="button" className="secondary-button" onClick={onPlan}>生成处理方案</button>
      </section>
    </div>
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

function Changes({ onSelectApp }: { onSelectApp: (id: AppId) => void }) {
  const [trendAppId, setTrendAppId] = useState<AppId>("capcut");
  const trendApp = apps.find((app) => app.id === trendAppId) ?? apps[0];
  const trendPoints = hourlyGrowth.map((item) => ({
    time: item.time,
    value: item.sources.find((source) => source.id === trendAppId)?.value ?? 0,
  }));
  const peakValue = Math.max(...trendPoints.map((item) => item.value), 0.1);
  const selectedDayTotal = trendPoints.reduce((sum, item) => sum + item.value, 0);

  function selectTrendApp(id: AppId) {
    setTrendAppId(id);
    onSelectApp(id);
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">SPACE ACTIVITY</p><h1>空间变化</h1><p>用时间线解释“空间什么时候、被谁占走了”。</p></div>
        <div className="period-tabs"><button className="active" type="button">24 小时</button><button type="button">7 天</button><button type="button">30 天</button></div>
      </div>
      <section className="change-summary">
        <div className="change-summary-head">
          <div>
            <span>今天电脑最终多占用</span>
            <small>今天新增的文件 − 今天删除或释放的空间</small>
          </div>
          <strong className="net-growth-value">+31.6 GB<small>不是当前总占用</small></strong>
        </div>
        <div className="chart-explainer">
          <span><i />先选择一个软件，再看它每小时增加了多少</span>
          <em>一次只看一个软件，避免颜色混在一起</em>
        </div>
        <div className="app-trend-picker" aria-label="选择要查看的软件">
          {apps.map((app, index) => {
            const dayTotal = hourlyGrowth.reduce(
              (sum, item) => sum + (item.sources.find((source) => source.id === app.id)?.value ?? 0),
              0,
            );
            return (
              <button
                type="button"
                key={app.id}
                className={trendAppId === app.id ? "trend-app active" : "trend-app"}
                style={{ "--trend-color": chartSourceMeta[app.id].color } as React.CSSProperties}
                onClick={() => selectTrendApp(app.id)}
              >
                <span className="trend-rank">{index + 1}</span>
                <AppBadge app={app} small />
                <span className="trend-app-name"><b>{app.name}</b><small>今日增加</small></span>
                <strong>+{dayTotal.toFixed(1)} GB</strong>
              </button>
            );
          })}
        </div>
        <div className="single-trend-head">
          <div><AppBadge app={trendApp} small /><span><b>{trendApp.name}每小时增长</b><small>鼠标移到柱子上查看具体数值</small></span></div>
          <strong>全天 +{selectedDayTotal.toFixed(1)} GB</strong>
        </div>
        <div className="chart-bars single-source" aria-label={`${trendApp.name}每小时空间增长柱状图`}>
          {trendPoints.map((item) => (
            <button
              type="button"
              className="chart-bar"
              key={item.time}
              aria-label={`${item.time} ${trendApp.name}新增 ${item.value} GB`}
              data-value={`${item.time} · ${trendApp.name} +${item.value} GB`}
            >
              <span
                className="single-bar"
                style={{ height: `${Math.max((item.value / peakValue) * 100, 3)}%`, background: chartSourceMeta[trendAppId].color }}
              />
            </button>
          ))}
        </div>
        <div className="chart-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>现在</span></div>
      </section>
      <section className="timeline-card">
        <div className="section-title"><div><p className="eyebrow">事件记录</p><h2>今天发生了什么</h2></div><span className="live-pill">● 实时记录</span></div>
        {timeline.map((item, index) => {
          const app = apps[index];
          return (
            <button type="button" className="timeline-row" key={item.time} onClick={() => onSelectApp(app.id)}>
              <time>{item.time}</time><span className={`timeline-dot ${item.tone}`} /><AppBadge app={app} small />
              <span><b>{item.app}</b><small>{item.note}</small></span><strong>{item.size}</strong><i>›</i>
            </button>
          );
        })}
      </section>
    </div>
  );
}

function Budgets({ budgets, onChange }: { budgets: Record<AppId, number>; onChange: (id: AppId, value: number) => void }) {
  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">APP BUDGETS</p><h1>应用空间预算</h1><p>像管理银行卡额度一样，提前限制每个应用能占多少空间。</p></div>
        <button type="button" className="ghost-button">＋ 添加应用</button>
      </div>
      <section className="budget-list">
        {apps.map((app) => {
          const budget = budgets[app.id];
          const over = app.size > budget;
          const used = Math.min((app.size / budget) * 100, 100);
          return (
            <article className="budget-row" key={app.id}>
              <AppBadge app={app} />
              <div className="budget-main">
                <div><span><b>{app.name}</b><small>{app.kind}</small></span><strong className={over ? "over" : ""}>{app.size} / {budget} GB</strong></div>
                <div className="budget-track"><i className={over ? "over" : ""} style={{ width: `${used}%` }} /></div>
                <div className="range-labels"><span>0 GB</span><span>{over ? `已超出 ${(app.size - budget).toFixed(1)} GB` : `剩余 ${(budget - app.size).toFixed(1)} GB`}</span><span>{budget} GB</span></div>
              </div>
              <div className="budget-control">
                <button type="button" aria-label={`降低${app.name}预算`} onClick={() => onChange(app.id, Math.max(5, budget - 5))}>−</button>
                <span>{budget} GB</span>
                <button type="button" aria-label={`提高${app.name}预算`} onClick={() => onChange(app.id, Math.min(100, budget + 5))}>＋</button>
              </div>
            </article>
          );
        })}
      </section>
      <div className="rule-note"><span>⌁</span><div><b>预算不会自动删除文件</b><p>应用接近预算时，轻盘会先解释原因并生成方案，由你确认后才执行。</p></div></div>
    </div>
  );
}

function Investigation({
  app,
  actions,
  query,
  investigated,
  onChange,
  onSubmit,
  onPlan,
}: {
  app: AppRecord;
  actions: PlanAction[];
  query: string;
  investigated: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPlan: () => void;
}) {
  const findings = actions.slice(0, 3);
  const largestFinding = Math.max(...findings.map((action) => action.size));

  return (
    <div className="page investigation-page">
      <div className="page-heading">
        <div><p className="eyebrow">SUBAGENT WORKSPACE</p><h1>AI 空间调查</h1><p>你只需要说问题，多个 Agent 会并行查来源、验证风险并给出证据。</p></div>
        <span className="privacy-chip">● 本地元数据优先</span>
      </div>
      <section className="ask-card">
        <div className="ask-icon">✦</div>
        <textarea value={query} onChange={(event) => onChange(event.target.value)} aria-label="输入空间调查问题" />
        <div className="ask-footer">
          <span>不会直接删除 · 全程可追溯</span>
          <button type="button" className="primary-button" onClick={onSubmit}>开始调查 <i>→</i></button>
        </div>
      </section>
      <div className="prompt-chips">
        {[`${app.name}有哪些内容能安全处理？`, `${app.name}为什么突然变大？`, "为什么系统数据这么大？"].map((prompt) => (
          <button type="button" key={prompt} onClick={() => onChange(prompt)}>{prompt}</button>
        ))}
      </div>
      <section className="agent-grid">
        {[
          ["01", "本地分析 Agent", "读取空间变化索引", "完成", "safe"],
          ["02", "应用规则 Agent", `识别${app.name}文件用途`, "完成", "safe"],
          ["03", "Agent Reach", "核对 3 条公开资料", "完成", "blue"],
          ["04", "安全审查 Agent", "排除关键文件与原始内容", "通过", "safe"],
        ].map(([id, title, note, status, tone]) => (
          <article className="agent-card" key={id}>
            <span>{id}</span><div><b>{title}</b><small>{note}</small></div><i className={tone}>{status}</i>
          </article>
        ))}
      </section>
      {investigated && (
        <section className="finding-card">
          <div className="finding-head"><span>✦</span><div><p className="eyebrow">调查结论</p><h2>{app.name}新增 {app.growth} GB 的来源已确认</h2></div><em>置信度 96%</em></div>
          <div className="finding-breakdown">
            {findings.map((action) => (
              <div key={action.id}>
                <span>{action.title}</span>
                <b>{action.size} GB</b>
                <i style={{ width: `${Math.max((action.size / largestFinding) * 100, 12)}%` }} />
              </div>
            ))}
          </div>
          <div className="evidence-strip"><span>证据</span><p>文件时间戳、应用目录结构、项目引用关系与公开规则交叉验证</p><button type="button" onClick={onPlan}>生成安全方案 →</button></div>
        </section>
      )}
    </div>
  );
}

function Vault({ record, restored, onRestore }: { record: VaultRecord | null; restored: boolean; onRestore: () => void }) {
  return (
    <div className="page">
      <div className="page-heading"><div><p className="eyebrow">SAFE VAULT</p><h1>安全恢复</h1><p>处理后的文件先进入隔离区，7 天内随时一键还原。</p></div><span className="vault-count">{record ? 1 : 0} 个恢复点</span></div>
      {record ? (
        <section className="vault-entry">
          <div className="vault-entry-icon">↶</div>
          <div><p className="eyebrow">刚刚创建</p><h2>{record.appName}空间处理</h2><p>{record.actionTitles.join("、")}</p></div>
          <div className="vault-size"><strong>{record.total.toFixed(1)} GB</strong><span>保留至 7 月 28 日</span></div>
          <button type="button" className="secondary-button" onClick={onRestore}>全部还原</button>
        </section>
      ) : (
        <section className="empty-vault">
          <span>{restored ? "✓" : "↶"}</span>
          <h2>{restored ? "文件已恢复到原位置" : "安全区暂无文件"}</h2>
          <p>{restored ? "本次恢复没有覆盖任何现有文件。" : "执行方案后，文件会先在这里保留 7 天。"}</p>
        </section>
      )}
      <section className="promise-grid">
        <div><span>01</span><b>先隔离，后释放</b><p>不直接永久删除，先给你反悔时间。</p></div>
        <div><span>02</span><b>恢复路径明确</b><p>每个文件都记录原位置和处理原因。</p></div>
        <div><span>03</span><b>执行有日志</b><p>每一步都能追溯，不做静默操作。</p></div>
      </section>
    </div>
  );
}

function Settings() {
  return (
    <div className="page">
      <div className="page-heading"><div><p className="eyebrow">PREFERENCES</p><h1>设置</h1><p>控制扫描范围、隐私和安全恢复规则。</p></div></div>
      <section className="settings-list">
        {[
          ["后台记录空间变化", "仅记录文件大小、路径和时间，不读取文件正文", true],
          ["应用接近预算时提醒", "达到预算的 85% 时发送通知", true],
          ["处理前进入安全区", "默认保留 7 天后再释放磁盘空间", true],
          ["允许读取外接硬盘", "当前仅分析 Macintosh HD", false],
        ].map(([title, note, enabled]) => (
          <div className="setting-row" key={String(title)}><div><b>{title}</b><p>{note}</p></div><button type="button" className={enabled ? "switch on" : "switch"} aria-label={String(title)}><i /></button></div>
        ))}
      </section>
    </div>
  );
}

function Inspector({ app, budget, onPlan, onInvestigate }: { app: AppRecord; budget: number; onPlan: () => void; onInvestigate: () => void }) {
  const total = app.composition.reduce((sum, item) => sum + item.size, 0);
  const over = app.size > budget;
  return (
    <aside className="inspector">
      <div className="inspector-head"><p>应用详情</p><button type="button" aria-label="更多操作">•••</button></div>
      <div className="app-profile">
        <AppBadge app={app} />
        <div><h2>{app.name}</h2><p>{app.kind}</p></div>
        <span className={over ? "risk-tag" : "safe-tag"}>{over ? "超出预算" : "预算内"}</span>
      </div>
      <div className="app-number">
        <span>当前占用</span><strong>{app.size}<small> GB</small></strong>
        <p><i>↗</i> 过去 24 小时增长 {app.growth} GB</p>
      </div>
      <div className="budget-meter">
        <div><span>空间预算</span><b>{app.size} / {budget} GB</b></div>
        <div className="budget-track"><i className={over ? "over" : ""} style={{ width: `${Math.min((app.size / budget) * 100, 100)}%` }} /></div>
        <small>{over ? `已超出 ${(app.size - budget).toFixed(1)} GB` : `还可使用 ${(budget - app.size).toFixed(1)} GB`}</small>
      </div>
      <section className="composition">
        <div className="inspector-section-title"><h3>空间组成</h3><span>{total.toFixed(1)} GB</span></div>
        <div className="composition-bar">
          {app.composition.map((item) => <i key={item.label} style={{ width: `${(item.size / total) * 100}%`, background: item.color }} />)}
        </div>
        <div className="composition-list">
          {app.composition.map((item) => <div key={item.label}><span><i style={{ background: item.color }} />{item.label}</span><b>{item.size} GB</b></div>)}
        </div>
      </section>
      <section className="ai-insight">
        <div><span>✦</span><b>AI 结论</b><em>96% 可信</em></div>
        <p>{app.summary}</p>
        <button type="button" onClick={onInvestigate}>查看调查证据 →</button>
      </section>
      <div className="inspector-actions">
        <button type="button" className="primary-button" onClick={onPlan}>生成处理方案</button>
        <p><span>✓</span> 执行前可逐项确认，支持安全恢复</p>
      </div>
    </aside>
  );
}

function PlanModal({
  app,
  actions,
  selected,
  total,
  onToggle,
  onClose,
  onConfirm,
}: {
  app: AppRecord;
  actions: PlanAction[];
  selected: string[];
  total: number;
  onToggle: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="plan-modal" role="dialog" aria-modal="true" aria-labelledby="plan-title">
        <header><div><p className="eyebrow">AI SAFE PLAN</p><h2 id="plan-title">{app.name}处理方案</h2><p>根据 {app.name} 的文件类型生成，可逐项确认。</p></div><button type="button" onClick={onClose} aria-label="关闭">×</button></header>
        <div className="plan-summary"><span>预计释放</span><strong>{total.toFixed(1)} GB</strong><em>风险等级：低</em></div>
        <div className="plan-items">
          {actions.map((action) => {
            const checked = selected.includes(action.id);
            return (
              <button type="button" className={checked ? "plan-item selected" : "plan-item"} key={action.id} onClick={() => onToggle(action.id)}>
                <span className="checkbox">{checked ? "✓" : ""}</span>
                <span><b>{action.title}</b><small>{action.detail}</small></span>
                <em className={action.risk === "安全" ? "safe" : "review"}>{action.risk}</em>
                <strong>{action.size} GB</strong>
              </button>
            );
          })}
        </div>
        <div className="plan-warning"><span>↶</span><p><b>不会立刻永久删除</b><br />文件将先进入安全区并保留 7 天，期间可一键恢复。</p></div>
        <footer><button type="button" className="ghost-button" onClick={onClose}>暂不处理</button><button type="button" className="primary-button" disabled={selected.length === 0} onClick={onConfirm}>确认移入安全区 · {total.toFixed(1)} GB</button></footer>
      </section>
    </div>
  );
}
