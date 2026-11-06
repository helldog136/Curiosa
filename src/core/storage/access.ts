import { can, hasRole, type AdminUser } from "../auth/access";

/** The detail (what the site takes, by category) and the Refresh action: administration and the people who have the backup right. */
export function canSeeStorage(user: AdminUser): boolean {
  return hasRole(user, "admin") || can(user, "core:backup");
}
