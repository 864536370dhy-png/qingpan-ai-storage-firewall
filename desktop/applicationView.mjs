export function matchesApplicationQuery(app, query) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [app.name, app.bundle_id ?? ""]
    .some((value) => value.toLocaleLowerCase().includes(normalized));
}

export function matchesApplicationFilter(app, filter) {
  if (filter === "all") return true;
  if (["basic", "generic", "deep"].includes(filter)) return app.support_level === filter;
  if (filter === "system") return app.is_system_app && app.installed;
  if (filter === "user") return !app.is_system_app && app.installed;
  if (filter === "residual") return !app.installed && app.related_data_size_bytes > 0;
  return true;
}

export function sortApplications(apps, sort) {
  const copy = [...apps];
  const descendingField = {
    total: "total_size_bytes",
    app: "app_size_bytes",
    related: "related_data_size_bytes",
    active: "modified_24h_bytes",
  }[sort];
  if (descendingField) {
    return copy.sort((left, right) =>
      (right[descendingField] - left[descendingField]) || left.name.localeCompare(right.name, "zh-CN"));
  }
  return copy.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

export function filterAndSortApplications(apps, query, filter, sort) {
  return sortApplications(
    apps.filter((app) => matchesApplicationQuery(app, query) && matchesApplicationFilter(app, filter)),
    sort,
  );
}
