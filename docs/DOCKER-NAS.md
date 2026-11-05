# Curiosa on a NAS (Synology and similar)

A step-by-step recipe for people who already run Docker projects on a home NAS. Written for Synology DSM 7 (Container Manager), but the same ideas fit QNAP, Unraid or TrueNAS. General Docker information: [INSTALL.md](INSTALL.md#docker).

## 1. Before you start

- **DSM 7.2 or newer with Container Manager** installed from Package Center.
- **Intel or AMD NAS (x86-64): supported.** This is what Curiosa is tested on.
- **ARM NAS (some J-series, Realtek or Marvell models): not tested, no promise.** The base images (`node:22-slim`, `caddy:2`) exist for ARM and the image is built on the NAS itself, so it may well work, but nobody has checked it. Curiosa's own release archives are `linux-x64` only; that only matters for the admin's in-place updates, which Docker does not use. If it fails on your ARM model, please open an issue with the build log.
- About 3 GB of free space and some patience: the first build downloads and compiles for 10 to 30 minutes on a small NAS.
- A domain name, or a Synology DDNS name (`something.synology.me`), if you want to reach the site from outside.

## 2. Put the files on the NAS

Curiosa is built on the NAS from its source, so the whole project folder is needed, not only the compose file.

1. In File Station, open the `docker` shared folder (create it in Control Panel > Shared Folder if it does not exist) and create a folder `curiosa`.
2. Download the latest release source from the project's GitHub page (green "Code" button > "Download ZIP", or the "Source code" file of the latest release), unzip it, and copy **everything** into `/volume1/docker/curiosa`. You should see `docker-compose.yml` and `Dockerfile` directly in that folder.
3. Create a folder `data` inside it. Your site's database, uploads and installed modules will live there, as a normal folder that Hyper Backup and snapshots can include.
4. Copy `.env.example` to `.env` (File Station: copy, then rename; hidden files may need "show hidden files" in the settings). Open `.env` with the text editor and set:

```
SITE_URL="https://example.org"
CURIOSA_DATA_DIR="/volume1/docker/curiosa/data"
CURIOSA_PORT="3000"
SETUP_TOKEN="choose-a-long-secret"
```

Use your own address in `SITE_URL`. Leave `CURIOSA_BIND` alone: the app then only answers on the NAS itself, and the DSM reverse proxy (step 4) is what visitors reach. If you only want to try it on your home network, set `CURIOSA_BIND="0.0.0.0"` and `SITE_URL="http://nas-address:3000"`, and skip step 4.

## 3. Create the project

1. Open Container Manager > **Project** > **Create**.
2. Name: `curiosa`. Path: choose `/volume1/docker/curiosa`. Source: **Use existing docker-compose.yml**.
3. Do not enable the web portal option. Click Next until the end; the build starts and the container then runs. The first build is long.

Do not use the `https` profile or the Traefik file here: DSM already owns ports 80 and 443.

## 4. HTTPS the Synology way

1. **Certificate.** Control Panel > Security > Certificate > Add > "Get a certificate from Let's Encrypt", with your domain (it must point to your NAS, see step 5).
2. **Reverse proxy.** Control Panel > Login Portal > Advanced > **Reverse Proxy** > Create:
   - Source: protocol HTTPS, host name `example.org`, port 443.
   - Destination: protocol HTTP, host name `localhost`, port 3000 (your `CURIOSA_PORT`).
   - Custom header tab: click Create > **WebSocket**. It keeps live pages working through the proxy.
3. **Certificate assignment.** In the same Security > Certificate page, click Settings and pick the Let's Encrypt certificate for `example.org`.
4. `CURIOSA_TRUSTED_PROXIES` is already 1 by default, which is right for one proxy. Do not change it.

## 5. Reaching the site from outside

- On your router, forward TCP port 443 (and 80 if the certificate request needs it) to the NAS.
- Point your domain to your home address, or use a Synology DDNS name (Control Panel > External Access > DDNS).
- **Warning.** Some internet boxes and mobile networks share one public address between many customers (CGNAT): forwarding then cannot work. Ask your provider for a public address, or use a tunnel instead (Tailscale Funnel or Cloudflare Tunnel): the tunnel reaches `http://localhost:3000` from the NAS and gives the site a public HTTPS address without opening any port. Set `SITE_URL` to that address.

## 6. First setup, backup, updates

- **First setup.** Open `https://example.org/admin/setup` and enter the `SETUP_TOKEN` you chose. Once the site is configured you can empty `SETUP_TOKEN` in `.env` and rebuild the project.
- **Backup.** Include `/volume1/docker/curiosa/data` in Hyper Backup or a snapshot schedule. The admin's backup page (see [BACKUP.md](BACKUP.md)) also works.
- **Updating Curiosa.** The admin's update page does **not** install the core in Docker (the container is replaced, not changed in place; `CURIOSA_INSTALL=docker` is set in the image), but it tells you when a new version exists and what to run. To update: download the new release source, copy it over `/volume1/docker/curiosa` (keep `.env` and `data`), then Container Manager > Project > `curiosa` > **Action > Build** (or Stop, then Clean, then Build and Start). Data is kept and migrations run at start.
- **What still works from the admin in Docker:** installing and updating modules, backups, and all site settings.
- **What does not:** updating the core, and the automatic restart options (`CURIOSA_RESTART_COMMAND`); Docker restarts the container by itself (`restart: unless-stopped`).

## Why building on the NAS is a pain, and what comes next

The compose file uses `build: .`: it needs the source tree on the NAS and a long build on a small processor. A prebuilt multi-architecture image (x86-64 and ARM) published on GHCR by the release workflow would make this a "paste the compose file and start" job and would settle the ARM question. That is a planned follow-up, not part of this recipe.
