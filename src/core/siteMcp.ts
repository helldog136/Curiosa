import { callLevel3 } from "@/core/maintenance/actions";
import { refuseForbidden, SITE_SETTINGS_INPUT, siteSettingsGet } from "@/core/maintenance/siteSettings";
import { MEDIA_IMPORT_INPUT, mediaImport } from "@/core/mediaImport";
import { MEDIA_ALT_INPUT, MEDIA_LIST_INPUT, MEDIA_UPLOAD_INPUT, mediaList, mediaSetAlt, mediaUpload } from "@/core/mediaMcp";
import type { McpTool, McpToolProvider } from "@/core/services/mcp/types";
import { validateArgs } from "@/core/services/mcp/validate";

/**
 * CORE TOOLS FOR SETTING A SITE UP WITHOUT OPENING THE ADMIN: media (media.ts) and the site settings (maintenance/siteSettings.ts).
 *
 *   media_list          read       the images of the site (address, alternative text, size, date, where used)
 *   media_upload        write      an image sent as base64 in the call (checked on its bytes, random name, 3 MB), alternative text required
 *   media_import        write      up to 10 images downloaded from an https address, ONLY from the trusted image sources the owner set up (empty list = off); same checks as media_upload
 *   media_set_alt       write      changes the alternative text of an image already on the site
 *   site_settings_get   read       name, tagline, presentation per language, contact e-mail, languages (read only), logo slots
 *   site_settings_set   request    name, tagline, presentation, contact e-mail, logos. FOLLOWS the approval setting of the access, like publishing: a request the owner
 *                                  approves ("ask me first") or applied at once with the old values in the journal ("act without asking")
 * No deletion of an image, no language, address, role, secret or security setting. Each tool has its own right (`aim.tool.<name>`) and is assigned in services/mcp/profiles.ts.
 */
const tool = (t: Pick<McpTool, "name" | "title" | "description" | "readOnly" | "input" | "call"> & Partial<McpTool>): McpTool => ({ default: false, destructive: false, source: "core", ...t });

export const setupToolProvider: McpToolProvider = {
  id: "site-setup",
  async list() {
    return [
      tool({
        name: "media_list", title: "Images of the site", readOnly: true, input: MEDIA_LIST_INPUT,
        description: "Lists the images on the site, newest first, 50 per page: address (/uploads/…), alternative text, size, date, and where it is used when known. Read only.",
        call: (args) => mediaList(args),
      }),
      tool({
        name: "media_upload", title: "Upload an image", readOnly: false, audited: true, input: MEDIA_UPLOAD_INPUT,
        description: "Uploads ONE image sent as base64 in the call (png, jpeg, webp or gif up to 3 MB; svg for logos only, it is cleaned). The type is checked on the content, the file gets a random name, and the alternative text (alt) is required. Returns the address to use in content, in site_settings_set (logos) or in an image setting of a module. The site never downloads an image from an address. There is no tool to delete images.",
        call: (args, actor) => mediaUpload(args, actor),
      }),
      tool({
        name: "media_import", title: "Import images from trusted sources", readOnly: false, audited: true, input: MEDIA_IMPORT_INPUT,
        description: "Downloads images from an https address that the OWNER has put on the trusted image sources list (Admin > AI assistants > Trusted image sources; empty by default, and you cannot change it). One image: { url, alt }; several: { urls: [{ url, alt }] }, 10 at most per call, each with its own result. Same checks as media_upload (type read from the content, 3 MB, pixel limit, random name, svg only for logos, alt required). An address outside the list, a redirection outside the list, a private network address, a slow or oversized answer is refused with a plain message. Returns the /uploads/… address of each image.",
        call: (args, actor) => mediaImport(args, actor),
      }),
      tool({
        name: "media_set_alt", title: "Change the text of an image", readOnly: false, audited: true, input: MEDIA_ALT_INPUT,
        description: "Changes the alternative text (125 characters at most) of an image already on the site, given by its address. The previous text is written in the journal.",
        call: (args, actor) => mediaSetAlt(args, actor),
      }),
      tool({
        name: "site_settings_get", title: "Settings of the site", readOnly: true, input: { type: "object" },
        description: "Reads the identity of the site: name, tagline and presentation for each language, public contact e-mail, the languages (read only) and the logo slots with their current image address. Never a secret.",
        call: () => siteSettingsGet(),
      }),
      tool({
        name: "site_settings_set", title: "Change the settings of the site", readOnly: false, request: true, audited: true, input: SITE_SETTINGS_INPUT,
        description: "Changes ONLY what you give: name, tagline and presentation per language ({\"en\": \"…\", \"fr\": \"…\"}), the public contact e-mail, and the logo slots from an image already on the site (an address from media_upload). Same limits as Admin > Settings; everything is checked first and nothing is saved if one value is wrong. It cannot change languages, addresses, people, secrets or security. It FOLLOWS the approval setting of this access: either a request the owner approves (old and new values listed; poll maintenance_request_status), or applied at once with the old values in the journal.",
        call: (args, actor) => { refuseForbidden(args); return callLevel3("site_settings_set", { site: validateArgs(SITE_SETTINGS_INPUT, args) }, actor); },
      }),
    ];
  },
};
