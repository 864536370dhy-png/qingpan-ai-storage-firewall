import {
  IconApps,
  IconArrowRight,
  IconArrowUpRight,
  IconBox,
  IconBrain,
  IconCheck,
  IconCircleCheck,
  IconDatabase,
  IconFile,
  IconFiles,
  IconFolder,
  IconHelpCircle,
  IconHistory,
  IconLoader2,
  IconLock,
  IconRefresh,
  IconRobot,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconSparkles,
  IconTrash,
  IconZoomScan,
  type IconProps,
} from "@tabler/icons-react";

const icons = {
  apps: IconApps,
  arrowRight: IconArrowRight,
  arrowUpRight: IconArrowUpRight,
  box: IconBox,
  brain: IconBrain,
  check: IconCheck,
  circleCheck: IconCircleCheck,
  database: IconDatabase,
  file: IconFile,
  files: IconFiles,
  folder: IconFolder,
  help: IconHelpCircle,
  history: IconHistory,
  loader: IconLoader2,
  lock: IconLock,
  refresh: IconRefresh,
  robot: IconRobot,
  search: IconSearch,
  settings: IconSettings,
  shield: IconShieldCheck,
  sparkles: IconSparkles,
  trash: IconTrash,
  zoomScan: IconZoomScan,
} as const;

export type UiIconName = keyof typeof icons;

export function UiIcon({ name, size = 18, stroke = 1.8, ...props }: { name: UiIconName } & Omit<IconProps, "name">) {
  const Icon = icons[name];
  return <Icon size={size} stroke={stroke} aria-hidden="true" {...props} />;
}
