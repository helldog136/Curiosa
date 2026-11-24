---
name: install-curiosa
description: Helps someone put Curiosa (a personal-site framework) online, from choosing the server and the domain up to /admin/setup, by driving scripts/install.sh. Use when someone wants to install, deploy or start Curiosa, choose a server or set up a domain name for Curiosa, or migrate a Grav site to Curiosa. The person may write in French or English: answer in their language.
---

# Install Curiosa

The path is: **three questions, one command, one browser**. First read `docs/AGENT-INSTALL.md` in full (decision tree, server choice, DNS, common errors), then drive `scripts/install.sh` instead of rebuilding the commands by hand. Speak simply: the person has no technical background, a technical word = one sentence of explanation, an error = what happened + one single thing to do. Never scare them.

**Language.** Talk to the person in their language (French or English: the language of their first message), not in the language of these instructions. Pass it to the script with `--lang fr` or `--lang en`. The script and the setup assistant of the site (`/admin/setup`) speak both; the assistant opens in the language of the person's browser (French or English, otherwise English) and the person can change it at its first step.

## Steps

1. **Where is the person?** Do they have a Linux server? A domain name? If not, help them (next step). **Do they have SSH access?** Some VPS are rented with a preinstalled CMS and no SSH: Curiosa does not install there, they need an offer with a bare system (Ubuntu LTS or Debian) and SSH access; when in doubt, they should ask the host's support before paying. If they have a server: `uname -m` must answer `x86_64`.
2. **Help choose the server and the DNS** (before anything else, without imposing anything): Ubuntu LTS or Debian profile, **x86_64 / amd64** (never ARM with `install.sh`: it can only install the x86_64 archive; on ARM, use Docker, see the "Docker" rule below), 1 vCPU, 1 to 2 GB of RAM, about 20 GB of disk; how to tell x86_64 from ARM on a host's page; connect over SSH from PowerShell or Terminal; create the **A** DNS record (and **AAAA** only if the host gives an IPv6 address) at the registrar and check the propagation (`getent hosts <domain>`); ports 80 and 443 open at the host. Providers are named as examples only, **without prices** ("check the current offers") and without imposing one.
3. **Ask the three questions at once**: the **site name** (short, lowercase), the **domain name** (or `--no-domain` for a simple trial), the **dedicated Linux user** (suggest `<site>-web`, do not choose it for them). **Explain the dedicated user before asking**: the site is a program exposed on the Internet; if a flaw is ever exploited, a malicious person acts with the rights of the user running it. With `root` or an administrator account they get the whole server; with a dedicated user without administrator rights the damage stays limited to this one site (the key to one room rather than to the whole house). It also makes cleaning up and updating from the admin easier. The script refuses `root`.
4. **Download, then read, never `curl | bash`**:
   ```bash
   curl -fsSL https://github.com/helldog136/Curiosa/releases/latest/download/install.sh -o install.sh
   less install.sh      # or show it / summarise it to the person
   ```
5. **Dry run first** (add `--lang fr` or `--lang en` according to the person's language: the script speaks both, and on a machine set to "C" it would choose English): `sudo bash install.sh --site <site> --domain <domain> --user <user> --dry-run`. It changes nothing; it says what it found (processor, system, Node, existing web server, chosen port, DNS, release) and what it would do. Read it with the person, explain each confirmation it will ask for (install Node.js, install Caddy, open ports 80/443 in ufw).
6. **Real installation**: the same command without `--dry-run`, with `--yes` **only after the person agrees** to these confirmations. The script can be resumed: if it stops, read the message (one remedy per error), fix, then run **the same command** again.
   - **HTTPS certificate with nginx or Apache**: by default the script only prints the certbot command (Caddy gets its certificate by itself). If the person wants it, add `--certbot --email <address>` (in the dry run as in the real installation): the script installs certbot if needed and gets the certificate for this one domain, provided the DNS already points to the server. **Ask for their agreement and their e-mail first** (expiry notices) and tell them that with `--certbot` they accept the Let's Encrypt terms; `--yes` alone never asks for a certificate. If it fails the site stays on HTTP and the script gives the command to retry.
7. **Hand over**: the script prints the `/admin/setup` address and the **command to read the setup code on the server**. The person opens the address and types that command **themselves**. Then suggest a backup from the admin and remind them to remove `SETUP_TOKEN` from `.env` once the site is set up.

Script language: `--lang fr|en` (otherwise `CURIOSA_LANG`, then the system language, otherwise English). Exit codes (`0`, `1`, `2`, `10`) and options are the same in every language: decide from the exit code, never from the text of a message. Messages are in the chosen language; translate them for the person if they speak another language. The setup assistant at `/admin/setup` does not depend on the script's language: it starts in the language of the browser that opens it (French or English, otherwise English), and its language question (second field of the first step, after the name) changes it immediately.

Exit code `10`: installed, but the public address does not answer yet (DNS, ports 80/443 at the host, certificate in progress): follow the "To do" list of the final page.

## Rules not to break

- Never ask for, read or show a secret (`SETUP_TOKEN`, `.env`, passwords, SSH keys); the script does not print it, the person reads it on the server.
- Never work around a refusal of the script: non-empty folder (do not overwrite it), existing user or service, web server that serves other sites (the script ADDS a site, saves and tests before reloading).
- Busy port: the script takes another one without touching the process that holds it; do not kill it.
- ARM processor with `install.sh`, unsupported system or no stable release published: say so and stop (nothing was changed), suggest an x86_64 server. Never compile on the server, never invent an ARM release.
- No `curl | bash`. No invented price, no imposed commercial offer.
- Docker: if the person prefers Docker (NAS, server already on Docker, ARM), use `scripts/install-docker.sh` instead of `install.sh`: ready-made image (nothing to compile), x86_64 and ARM PCs, HTTPS by Caddy (provided), Traefik or the machine's web server. Same method: download, read (`less`), `--dry-run` first (with `--lang fr` or `--lang en`), then without `--dry-run`, with `--yes` only after the person agrees. It asks at most three questions (domain, e-mail for the certificate, setup code), keeps `.env` and deletes nothing. It never installs Docker without `--install-docker` (propose it only with the person's agreement). Update afterwards: `docker compose pull && docker compose up -d` (the Updates page of the admin shows the command). See "Docker" in `docs/INSTALL.md` and `docs/DOCKER-NAS.md`.
- To undo: `sudo bash install.sh --uninstall --site <site>` (keeps folder and data); `--purge` only runs in a terminal, with a backup and a confirmation typed by the person.
- Coming from a Grav site: see `docs/IMPORT-GRAV.md` (conversion to a backup, restored afterwards through "I already have a backup").
- Installation on a system without systemd or outside Ubuntu/Debian: see "Manual installation (advanced)" in `docs/AGENT-INSTALL.md`.
