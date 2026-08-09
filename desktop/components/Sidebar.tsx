import type { CSSProperties } from "react";
import qingpanMark from "../../public/qingpan-mark.png";
import type { NavId } from "../types";
import { UiIcon, type UiIconName } from "./UiIcon";

const navItems: { id: NavId; icon: UiIconName; label: string }[] = [
  { id: "applications", icon: "zoomScan", label: "智能扫描" },
  { id: "tools", icon: "files", label: "通用清理工具" },
  { id: "investigate", icon: "brain", label: "AI 调查" },
  { id: "vault", icon: "history", label: "安全隔离区" },
];

export function Sidebar({ active, onNavigate }: { active: NavId; onNavigate: (id: NavId) => void }) {
  return (
    <aside className="sidebar">
      <div className="desktop-titlebar" data-tauri-drag-region />
      <div className="brand">
        <span
          className="brand-mark"
          style={{ "--brand-mark-image": `url("${qingpanMark}")` } as CSSProperties}
          aria-hidden="true"
        />
        <div><strong>轻盘</strong><small>AI 智能空间管理</small></div>
      </div>
      <nav className="primary-nav" aria-label="主导航">
        <p className="nav-caption">AI 本地工作台</p>
        {navItems.map((item) => (
          <button type="button" key={item.id} className={active === item.id ? "nav-item active" : "nav-item"} onClick={() => onNavigate(item.id)}>
            <span className="nav-icon"><UiIcon name={item.icon} /></span><span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button type="button" className={active === "settings" ? "sidebar-settings active" : "sidebar-settings"} onClick={() => onNavigate("settings")}><span><UiIcon name="settings" size={17} /></span><b>设置</b></button>
        <div className="local-status">
          <span className="status-orb"><UiIcon name="shield" size={14} stroke={2.1} /></span>
          <div><b>安全清理已开启</b><small>规则目录 · 先隔离 · 可恢复</small></div>
        </div>
      </div>
    </aside>
  );
}
