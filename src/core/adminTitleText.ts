// The text rule of an admin tab title, with no dependency (so a test can load it without the database).
/** The last part of every admin tab title (the product area, not a translated word). */
export const ADMIN_TITLE_SUFFIX = "Admin";
const SEPARATOR = " – ";

/** `<page> – <site name> – Admin`. Empty parts are left out and a part is never repeated side by side (a site named like its page). Pure: tested on its own. */
export function composeAdminTitle(page: string, siteName: string): string {
  const parts: string[] = [];
  for (const raw of [page, siteName, ADMIN_TITLE_SUFFIX]) {
    const part = raw.replace(/\s+/g, " ").trim();
    if (part && part.toLowerCase() !== parts[parts.length - 1]?.toLowerCase()) parts.push(part);
  }
  return parts.join(SEPARATOR);
}
