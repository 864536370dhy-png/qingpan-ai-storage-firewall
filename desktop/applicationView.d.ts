import type { ApplicationFilter, ApplicationSort, InstalledApplication } from "./types";

export function matchesApplicationQuery(app: InstalledApplication, query: string): boolean;
export function matchesApplicationFilter(app: InstalledApplication, filter: ApplicationFilter): boolean;
export function sortApplications(apps: InstalledApplication[], sort: ApplicationSort): InstalledApplication[];
export function filterAndSortApplications(
  apps: InstalledApplication[],
  query: string,
  filter: ApplicationFilter,
  sort: ApplicationSort,
): InstalledApplication[];
