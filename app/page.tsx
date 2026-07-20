"use client";

import { useEffect, useMemo, useState } from "react";

type NavId = "overview" | "changes" | "budgets" | "investigate" | "vault" | "settings";
type AppId = "capcut" | "wechat" | "xcode" | "lark";

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

const planActions: PlanAction[] = [
  { id: "preview", title: "过期预览缓存", detail: "30 天未访问，可由剪映重新生成", size: 8.2, risk: "安全" },
  { id: "proxy", title: "已关闭项目代理文件", detail: "对应原始素材仍在本地", size: 5.4, risk: "安全" },
  { id: "thumb", title: "缩略图与波形缓存", detail: "下次打开项目时自动重建", size: 3.1, risk: "安全" },
  { id: "export", title: "重复导出的视频", detail: "内容相同，但需要你确认保留版本", size: 2.7, risk: "需确认" },
];

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
  const [selectedActions, setSelectedActions] = useState<string[]>(["preview", "proxy", "thumb"]);
  const [vaultItems, setVaultItems] = useState(0);
  const [restored, setRestored] = useState(false);
  const [query, setQuery] = useState("为什么今天突然多了 31 GB？找出来源，但先不要删除");
  const [investigated, setInvestigated] = useState(false);
  const [budgets, setBudgets] = useState<Record<AppId, number>>({
    capcut: 30,
    wechat: 20,
    xcode: 25,
    lark: 10,
  });

  const selectedApp = apps.find((app) => app.id === selectedId) ?? apps[0];
  const planTotal = useMemo(
    () => planActions.filter((action) => selectedActions.includes(action.id)).reduce((sum, action) => sum + action.size, 0),
    [selectedActions],
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

  function startScan() {
    setScanProgress(0);
    setScanState("scanning");
  }

  function submitInvestigation() {
    setInvestigated(false);
    window.setTimeout(() => setInvestigated(true), 550);
  }

  function confirmPlan() {
    setVaultItems((current) => current + 1);
    setRestored(false);
    setPlanOpen(false);
    setActive("vault");
  }

  function selectApp(id: AppId) {
    setSelectedId(id);
  }

  return (
    <main className="desktop-shell">
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
              {item.id === "vault" && vaultItems > 0 && <em>{vaultItems}</em>}
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
              query={query}
              investigated={investigated}
              onChange={setQuery}
              onSubmit={submitInvestigation}
              onPlan={() => setPlanOpen(true)}
            />
          )}
          {active === "vault" && (
            <Vault
              items={vaultItems}
              restored={restored}
              onRestore={() => {
                setRestored(true);
                setVaultItems(0);
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
  return (
    <div className="page">
      <div className="page-heading">
        <div><p className="eyebrow">SPACE ACTIVITY</p><h1>空间变化</h1><p>用时间线解释“空间什么时候、被谁占走了”。</p></div>
        <div className="period-tabs"><button className="active" type="button">24 小时</button><button type="button">7 天</button><button type="button">30 天</button></div>
      </div>
      <section className="change-summary">
        <div><span>今日净增长</span><strong>+31.6 GB</strong></div>
        <div className="chart-bars" aria-label="每小时空间增长柱状图">
          {[18, 22, 16, 24, 32, 28, 56, 42, 76, 46, 88, 35, 64, 94, 58, 46, 78, 52, 32, 44].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
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
  query,
  investigated,
  onChange,
  onSubmit,
  onPlan,
}: {
  query: string;
  investigated: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPlan: () => void;
}) {
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
        {["最近哪个应用增长最快？", "微信有哪些大文件能处理？", "为什么系统数据这么大？"].map((prompt) => (
          <button type="button" key={prompt} onClick={() => onChange(prompt)}>{prompt}</button>
        ))}
      </div>
      <section className="agent-grid">
        {[
          ["01", "本地分析 Agent", "读取空间变化索引", "完成", "safe"],
          ["02", "应用规则 Agent", "识别剪映文件用途", "完成", "safe"],
          ["03", "Agent Reach", "核对 3 条公开资料", "完成", "blue"],
          ["04", "安全审查 Agent", "排除工程与原素材", "通过", "safe"],
        ].map(([id, title, note, status, tone]) => (
          <article className="agent-card" key={id}>
            <span>{id}</span><div><b>{title}</b><small>{note}</small></div><i className={tone}>{status}</i>
          </article>
        ))}
      </section>
      {investigated && (
        <section className="finding-card">
          <div className="finding-head"><span>✦</span><div><p className="eyebrow">调查结论</p><h2>31.6 GB 增长已找到 93% 的来源</h2></div><em>置信度 96%</em></div>
          <div className="finding-breakdown">
            <div><span>剪映预览与代理</span><b>18.4 GB</b><i style={{ width: "92%" }} /></div>
            <div><span>微信群聊视频</span><b>9.7 GB</b><i style={{ width: "49%" }} /></div>
            <div><span>Xcode 模拟器</span><b>3.5 GB</b><i style={{ width: "18%" }} /></div>
          </div>
          <div className="evidence-strip"><span>证据</span><p>文件时间戳、应用目录结构、项目引用关系与公开规则交叉验证</p><button type="button" onClick={onPlan}>生成安全方案 →</button></div>
        </section>
      )}
    </div>
  );
}

function Vault({ items, restored, onRestore }: { items: number; restored: boolean; onRestore: () => void }) {
  return (
    <div className="page">
      <div className="page-heading"><div><p className="eyebrow">SAFE VAULT</p><h1>安全恢复</h1><p>处理后的文件先进入隔离区，7 天内随时一键还原。</p></div><span className="vault-count">{items} 个恢复点</span></div>
      {items > 0 ? (
        <section className="vault-entry">
          <div className="vault-entry-icon">↶</div>
          <div><p className="eyebrow">刚刚创建</p><h2>剪映空间处理</h2><p>过期预览缓存、已关闭项目代理文件、缩略图缓存</p></div>
          <div className="vault-size"><strong>16.7 GB</strong><span>保留至 7 月 28 日</span></div>
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
  selected,
  total,
  onToggle,
  onClose,
  onConfirm,
}: {
  selected: string[];
  total: number;
  onToggle: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="plan-modal" role="dialog" aria-modal="true" aria-labelledby="plan-title">
        <header><div><p className="eyebrow">AI SAFE PLAN</p><h2 id="plan-title">剪映处理方案</h2><p>只处理可重建或已有原始副本的文件。</p></div><button type="button" onClick={onClose} aria-label="关闭">×</button></header>
        <div className="plan-summary"><span>预计释放</span><strong>{total.toFixed(1)} GB</strong><em>风险等级：低</em></div>
        <div className="plan-items">
          {planActions.map((action) => {
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
