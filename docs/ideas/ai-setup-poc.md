# AI-assisted setup: proof of concept

Status: findings, not a specification. Companion of `docs/ideas/mcp-ia-editeur.md` (the tool proposal).

## Why this document exists

The question: can an AI assistant really help someone set up a Curiosa site, end to end, with
only the human approvals that make sense? A first run on a brand-new site answered "almost",
and the gaps it exposed are more useful than any desk review. This page records the scenario,
what worked, the gaps in the order they appeared, and a success criterion that can be replayed
on every release.

## Scenario (replayable)

A new site, the core installed, the setup assistant finished, an AI assistant connected through
MCP with every right ticked and the approval setting on "act without asking".

1. Read the state: status, health, diagnose, site info, the catalogue of modules and skins.
2. Install the modules needed for a showcase site (pages, blog, links, contacts, contact form,
   press kit, legal pages, a social-network module, a home banner).
3. Install and activate a skin.
4. Configure the installed modules.
5. Write the content in the site's two languages (English and French): pages, a blog article,
   links.
6. Publish it.
7. Do the remaining lines of the dashboard "Getting started" list: site name, tagline, logo,
   first page, a social network, the look, a first backup.

## What worked

- Read-only tools (status, health, diagnose, content check, catalogue, skins) answered well and
  without any secret.
- A backup could be made on request.
- Module installation as a request the owner approves: the plan, the permissions and the
  dependencies were listed before approval, and nothing was installed without it.
- Skin activation followed the approval setting (it was immediate with "act without asking").
- Content modules offered draft tools. A fresh sub-session created five pages, an article and
  three links in both languages, read them back, and configured the contact form, the home
  banner and the social-network module.

## Gaps, in the order they appeared

| # | Gap | Effect | Status |
|---|---|---|---|
| 1 | The tool list is fixed when the client connects. The server is stateless and cannot notify a client that rights or modules changed. | After every right change or module installation the assistant sees nothing new until it reconnects. A newcomer thinks "it does not work". | Documented; `maintenance_my_access` and "reconnect" messages proposed. |
| 2 | Install and skin tools were described in other tools' text but absent from the list (see 1). | Confusing, looks like a bug. | Descriptions to fix. |
| 3 | A maximum of 5 pending requests, one request per module. | A showcase site needs about ten approvals. | One approval for a whole plan proposed (`catalog_plan`, bundled install). |
| 4 | Content tools create drafts only; there is no publish tool, even with the approval setting on "act without asking". | The human must publish by hand, which defeats the purpose. | Generic publish tool proposed; it follows the approval setting. |
| 5 | No tool for the menu, the home page sections, the site name and tagline, the logo (media upload). | Five lines of the "Getting started" list cannot be done by an AI. | Site name, tagline, contact e-mail, logos and images: done (`site_settings_*`, `media_*`). Menu and home page sections: done (`navigation_*`, `home_sections_*`). |
| 6 | Some modules expose no setting an AI can see (for example the press kit). | The AI cannot fill them. | Press kit settings: image settings accept an uploaded `/uploads/…` image (tested). |
| 7 | The catalogue and the setup assistant mixed languages. | A site whose main language is English showed French module texts. | Fixed (module internationalisation). |
| 8 | The rights page needed one click per tool, and one control was ambiguous. | Slow and confusing. | Profiles, per-section buttons and a clear control in progress. |
| 9 | Pre-approval is not enough to cover everything: installing always needs a human, by design. | The owner was surprised that installs still waited. | Kept by design; the text of the page now says it plainly. |

## Success criterion

On a fresh site, with the rights of the "Full setup" profile, an AI assistant completes the whole
"Getting started" list and a showcase site in both languages, and the only human actions are the
approvals the owner wants to keep (installs) plus the choices only a person can make (legal
answers, the logo file if it is not uploaded). No step requires opening the admin to do
something the assistant could have done, and no step requires reconnecting the assistant
without the assistant saying so first.

Measure it on every release: count the human interventions of the scenario, list each one with
its reason, and keep the list shrinking.

## What stays human, on purpose

- Installing a module or a skin.
- Legal texts (they need the owner's answers and a local review).
- Anything involving a secret.
- Deleting data.

## Replaying the run

The scenario above is the test. A release note should state the number of human interventions
the last run needed, and the tool proposal (`docs/ideas/mcp-ia-editeur.md`) is the backlog that
reduces it.
