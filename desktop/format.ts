import type { RiskLevel, ScanStage, SupportLevel } from "./types";

export function formatBytes(bytes: number, digits = 1) {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : digits)} ${units[index]}`;
}

export const supportLabels: Record<SupportLevel, string> = {
  deep: "深度支持",
  generic: "通用分析",
  basic: "基础识别",
};

export const riskLabels: Record<RiskLevel, string> = {
  safe: "通常可重建",
  review: "需要查看",
  protected: "受保护",
  unknown: "规则未知",
};

export const scanStageLabels: Record<ScanStage, string> = {
  discovering: "正在发现应用",
  metadata: "正在读取应用信息",
  related: "正在汇总已知数据目录",
  finalizing: "正在生成结果",
};
