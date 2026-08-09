/* eslint-disable @next/next/no-img-element -- icons are local .icns assets exposed by Tauri */
import { convertFileSrc } from "@tauri-apps/api/core";
import { useState } from "react";
import type { CSSProperties } from "react";
import type { InstalledApplication } from "../types";

export function AppBadge({ app, small = false }: { app: InstalledApplication; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const source = app.icon_path && !failed ? convertFileSrc(app.icon_path) : null;
  return (
    <span className={small ? "app-badge app-badge-small" : "app-badge"} style={{ "--app-color": app.color } as CSSProperties}>
      {source ? <img src={source} alt="" onError={() => setFailed(true)} /> : app.glyph}
    </span>
  );
}
