import { UiIcon, type UiIconName } from "./UiIcon";

export function EmptyState({ icon, title, description }: { icon: UiIconName; title: string; description: string }) {
  return (
    <div className="empty-scan">
      <span><UiIcon name={icon} size={24} /></span>
      <b>{title}</b>
      <p>{description}</p>
    </div>
  );
}
