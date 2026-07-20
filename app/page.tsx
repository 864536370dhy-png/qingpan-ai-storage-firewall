"use client";

import { useMemo, useState } from "react";

type PlanItem = {
  id: string;
  icon: string;
  title: string;
  detail: string;
  size: number;
  tag: string;
  tone: "safe" | "review" | "move";
  selected: boolean;
};

const initialPlan: PlanItem[] = [
  {
    id: "cache",
    icon: "◌",
    title: "可重新生成的缓存",
    detail: "微信、飞书、Chrome 等 7 个应用",
    size: 8.6,
    tag: "放心清理",
    tone: "safe",
    selected: true,
  },
  {
    id: "duplicate",
    icon: "▱",
    title: "重复文件",
    detail: "发现 42 组内容完全相同的文件",
    size: 5.2,
    tag: "需要确认",
    tone: "review",
    selected: true,
  },
  {
    id: "archive",
    icon: "⌁",
    title: "半年未使用的旧项目",
    detail: "压缩归档，不删除原始内容",
    size: 6.8,
    tag: "建议压缩",
    tone: "review",
    selected: false,
  },
  {
    id: "cloud",
    icon: "☁",
    title: "已同步到云端的大视频",
    detail: "仅释放本地副本，云端文件会保留",
    size: 12.4,
    tag: "建议迁移",
    tone: "move",
    selected: true,
  },
];

const appRows = [
  { name: "微信", note: "图片缓存与重复视频", size: "12.8 GB", color: "#7ac7a5" },
  { name: "剪映", note: "代理文件与已导出视频", size: "9.4 GB", color: "#ffb276" },
  { name: "飞书", note: "会议缓存与下载附件", size: "4.7 GB", color: "#83a8e8" },
];

export default function Home() {
  const [active, setActive] = useState("home");
  const [goal, setGoal] = useState("帮我安全释放 30 GB，不要动工作文件和家庭照片");
  const [generated, setGenerated] = useState(false);
  const [items, setItems] = useState(initialPlan);
  const [drawer, setDrawer] = useState<PlanItem | null>(null);
  const [cleaned, setCleaned] = useState(false);

  const selectedSize = useMemo(
    () => items.filter((item) => item.selected).reduce((sum, item) => sum + item.size, 0),
    [items],
  );

  function buildPlan() {
    setGenerated(true);
    setCleaned(false);
  }

  function toggleItem(id: string) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item)),
    );
  }

  function confirmClean() {
    setCleaned(true);
    setActive("recovery");
  }

  return (
    <main className="desktop-app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">轻</span>
          <div>
            <strong>轻盘</strong>
            <small>AI 空间管家</small>
          </div>
        </div>

        <nav aria-label="产品导航">
          {[
            ["home", "⌂", "首页"],
            ["tasks", "✦", "智能方案"],
            ["files", "▤", "文件整理"],
            ["apps", "◫", "应用空间"],
            ["recovery", "↶", "安全恢复"],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              className={active === id ? "nav-item active" : "nav-item"}
              onClick={() => setActive(id)}
            >
              <span>{icon}</span>
              {label}
              {id === "recovery" && cleaned && <i>1</i>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="privacy-pill">
            <span>●</span>
            本地分析，文件不上传
          </div>
          <button className="settings-link">⚙ 设置与保护规则</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="device">
            <span className="device-dot" />
            邓皓阳的 MacBook Pro
          </div>
          <div className="top-actions">
            <button aria-label="通知">◌</button>
            <span className="avatar">D</span>
          </div>
        </header>

        {active === "home" && (
          <div className="page home-page">
            <div className="welcome-row">
              <div>
                <p className="eyebrow">下午好，皓阳</p>
                <h1>今天想让电脑<br />轻一点吗？</h1>
                <p className="lead">告诉我你的空间目标，我会给你一套安全方案。</p>
              </div>
              <div className="storage-orbit" aria-label="磁盘已使用 81%">
                <div className="orbit-ring">
                  <div className="orbit-center">
                    <strong>81%</strong>
                    <span>已使用</span>
                  </div>
                </div>
                <div className="storage-copy">
                  <b>96 GB</b>
                  <span>剩余空间</span>
                </div>
              </div>
            </div>

            <section className="ai-command">
              <div className="ai-command-head">
                <span className="spark">✦</span>
                <div>
                  <b>AI 帮我规划空间</b>
                  <span>不用研究哪些能删，直接说出你的目标</span>
                </div>
              </div>
              <div className="command-box">
                <textarea
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  aria-label="输入空间清理目标"
                />
                <button onClick={buildPlan}>生成方案 <span>→</span></button>
              </div>
              <div className="quick-prompts">
                {["安全释放 20 GB", "清理微信和飞书", "整理下载文件夹", "找出重复视频"].map(
                  (prompt) => (
                    <button key={prompt} onClick={() => setGoal(prompt)}>
                      {prompt}
                    </button>
                  ),
                )}
              </div>
            </section>

            {!generated ? (
              <section className="overview-grid">
                <div className="insight-card">
                  <div className="section-head">
                    <div>
                      <p className="eyebrow">空间观察</p>
                      <h2>主要空间去了哪里</h2>
                    </div>
                    <button onClick={() => setActive("apps")}>查看全部</button>
                  </div>
                  <div className="app-list">
                    {appRows.map((app) => (
                      <div className="app-row" key={app.name}>
                        <span className="app-icon" style={{ background: app.color }}>{app.name[0]}</span>
                        <div>
                          <b>{app.name}</b>
                          <small>{app.note}</small>
                        </div>
                        <strong>{app.size}</strong>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="suggestion-card">
                  <span className="suggestion-icon">✦</span>
                  <p className="eyebrow">今日建议</p>
                  <h2>剪映产生了<br />6.3 GB 代理文件</h2>
                  <p>删除后不会影响原始素材和已导出视频。</p>
                  <button onClick={buildPlan}>加入空间方案</button>
                </div>
              </section>
            ) : (
              <PlanPanel
                items={items}
                selectedSize={selectedSize}
                onToggle={toggleItem}
                onDetails={setDrawer}
                onConfirm={confirmClean}
              />
            )}
          </div>
        )}

        {active === "tasks" && (
          <div className="page simple-page">
            <p className="eyebrow">AI 空间方案</p>
            <h1>用目标代替工具</h1>
            <p className="lead">选择一个任务，AI会组合删除、压缩和迁移来完成。</p>
            <div className="task-grid">
              {[
                ["30 GB", "快速腾出空间", "综合清理、压缩与迁移", "最常用"],
                ["微信", "整理聊天文件", "区分聊天记录、缓存和重复视频", "国产应用"],
                ["下载", "收拾下载目录", "找出安装包、重复项和旧文件", "简单"],
                ["项目", "归档旧工作", "压缩半年未使用的项目文件", "安全"],
              ].map(([icon, title, desc, tag]) => (
                <button
                  className="task-card"
                  key={title}
                  onClick={() => {
                    setGoal(title === "快速腾出空间" ? "帮我安全释放 30 GB" : title);
                    setGenerated(true);
                    setActive("home");
                  }}
                >
                  <span>{icon}</span>
                  <i>{tag}</i>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                  <b>开始规划 →</b>
                </button>
              ))}
            </div>
          </div>
        )}

        {active === "files" && (
          <div className="page simple-page">
            <p className="eyebrow">文件整理</p>
            <h1>不只看大小，也看价值</h1>
            <p className="lead">AI结合位置、来源和使用时间，帮你理解每一类文件。</p>
            <div className="file-layout">
              <div className="treemap" aria-label="磁盘空间分布示意图">
                <div className="tree-cell cell-video">视频 <b>42 GB</b></div>
                <div className="tree-cell cell-work">工作项目 <b>28 GB</b></div>
                <div className="tree-cell cell-chat">聊天文件 <b>21 GB</b></div>
                <div className="tree-cell cell-app">应用数据 <b>18 GB</b></div>
                <div className="tree-cell cell-other">其他 <b>12 GB</b></div>
              </div>
              <div className="plain-explain">
                <span>✦ AI 发现</span>
                <h2>最大的文件不一定最该删</h2>
                <p>“工作项目”虽然占用 28 GB，但最近仍在使用；聊天缓存体积更小，却更适合优先处理。</p>
                <button onClick={() => { setGenerated(true); setActive("home"); }}>生成安全方案</button>
              </div>
            </div>
          </div>
        )}

        {active === "apps" && (
          <div className="page simple-page">
            <p className="eyebrow">应用空间</p>
            <h1>看懂每个应用占了什么</h1>
            <p className="lead">区分真正的个人数据和可以重新生成的缓存。</p>
            <div className="apps-table">
              {appRows.concat([
                { name: "Chrome", note: "网页缓存与下载记录", size: "4.1 GB", color: "#e9c766" },
                { name: "WPS", note: "历史版本与云文档副本", size: "3.6 GB", color: "#ef8585" },
              ]).map((app, index) => (
                <div className="apps-table-row" key={app.name}>
                  <span className="app-icon" style={{ background: app.color }}>{app.name[0]}</span>
                  <div><b>{app.name}</b><small>{app.note}</small></div>
                  <span className="space-bar"><i style={{ width: `${90 - index * 13}%` }} /></span>
                  <strong>{app.size}</strong>
                  <button onClick={() => { setGenerated(true); setActive("home"); }}>分析</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {active === "recovery" && (
          <div className="page simple-page">
            <p className="eyebrow">安全恢复</p>
            <h1>{cleaned ? "清理完成，随时可以反悔" : "所有操作都留有退路"}</h1>
            <p className="lead">文件会在安全区保留7天，到期前不会永久删除。</p>
            <div className={cleaned ? "recovery-card has-files" : "recovery-card"}>
              <span className="vault-icon">↶</span>
              <div>
                <b>{cleaned ? `${selectedSize.toFixed(1)} GB 已移入安全区` : "安全区目前是空的"}</b>
                <p>{cleaned ? "来自刚刚完成的空间方案 · 7月20日 14:32" : "清理后的文件会显示在这里"}</p>
              </div>
              {cleaned && (
                <div className="recovery-actions">
                  <button>查看文件</button>
                  <button className="restore-btn" onClick={() => setCleaned(false)}>全部恢复</button>
                </div>
              )}
            </div>
            <div className="safety-promise">
              <div><span>01</span><b>保留原始路径</b><p>恢复后回到原来的位置。</p></div>
              <div><span>02</span><b>7天反悔时间</b><p>到期前不会永久删除。</p></div>
              <div><span>03</span><b>AI无权清空</b><p>永久删除只能由你确认。</p></div>
            </div>
          </div>
        )}
      </section>

      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(null)}>
          <aside className="detail-drawer" onClick={(event) => event.stopPropagation()}>
            <button className="drawer-close" onClick={() => setDrawer(null)}>×</button>
            <span className={`detail-icon ${drawer.tone}`}>{drawer.icon}</span>
            <p className="eyebrow">{drawer.tag}</p>
            <h2>{drawer.title}</h2>
            <strong className="detail-size">{drawer.size} GB</strong>
            <div className="explanation">
              <span>✦ AI 解释</span>
              <p>
                {drawer.id === "cache"
                  ? "这些是应用为了加快打开速度生成的临时文件。删除后不会影响聊天记录或个人文档，需要时应用会重新生成。"
                  : drawer.id === "cloud"
                    ? "这些视频已经完整同步到云端。操作只释放本地副本，之后仍可在云盘中查看或重新下载。"
                    : "这些文件需要你确认。系统会展示来源、最近使用时间和预览，不会自动删除个人内容。"}
              </p>
            </div>
            <div className="detail-facts">
              <div><span>处理方式</span><b>{drawer.tone === "move" ? "仅释放本地副本" : "移入7天安全区"}</b></div>
              <div><span>删除风险</span><b>{drawer.tone === "safe" ? "低" : "需要确认"}</b></div>
              <div><span>是否可恢复</span><b>可以</b></div>
            </div>
            <button className="primary-wide" onClick={() => setDrawer(null)}>明白了</button>
          </aside>
        </div>
      )}
    </main>
  );
}

function PlanPanel({
  items,
  selectedSize,
  onToggle,
  onDetails,
  onConfirm,
}: {
  items: PlanItem[];
  selectedSize: number;
  onToggle: (id: string) => void;
  onDetails: (item: PlanItem) => void;
  onConfirm: () => void;
}) {
  return (
    <section className="plan-panel">
      <div className="plan-title">
        <div>
          <p className="eyebrow">✦ AI 已生成方案</p>
          <h2>预计可以安全释放 <strong>{selectedSize.toFixed(1)} GB</strong></h2>
          <p>工作文件和家庭照片已自动排除。</p>
        </div>
        <div className="risk-score"><span>低风险</span><b>安全规则已检查</b></div>
      </div>

      <div className="plan-list">
        {items.map((item) => (
          <div className={item.selected ? "plan-row selected" : "plan-row"} key={item.id}>
            <button
              className="check"
              onClick={() => onToggle(item.id)}
              aria-label={`${item.selected ? "取消" : "选择"}${item.title}`}
            >
              {item.selected ? "✓" : ""}
            </button>
            <span className={`plan-icon ${item.tone}`}>{item.icon}</span>
            <div className="plan-copy">
              <div><b>{item.title}</b><i className={item.tone}>{item.tag}</i></div>
              <p>{item.detail}</p>
            </div>
            <strong className="plan-size">{item.size} GB</strong>
            <button className="detail-link" onClick={() => onDetails(item)}>为什么？</button>
          </div>
        ))}
      </div>

      <div className="plan-footer">
        <div className="vault-note"><span>↶</span><div><b>全部进入7天安全区</b><small>删错可以一键恢复</small></div></div>
        <button className="clean-button" onClick={onConfirm}>确认处理 {selectedSize.toFixed(1)} GB <span>→</span></button>
      </div>
    </section>
  );
}
