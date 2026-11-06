# Curiosa on a NAS (Synology and similar)

A step-by-step recipe for people who already run Docker projects on a home NAS. Written for Synology DSM 7 (Container Manager), but the same ideas fit QNAP, Unraid or TrueNAS. General Docker information: [INSTALL.md](INSTALL.md#docker).

## 1. Before you start

- **DSM 7.2 or newer with Container Manager** installed from Package Center.
- **Nothing is built on the NAS.** The image is pulled ready-made from `ghcr.io/helldog136/curiosa`: no source to copy, no compilation, a first start of a minute or two instead of a long build.
- **Intel/AMD and ARM NAS: both supported** (`linux/amd64` and `linux/arm64`). Docker picks the right one by itself. If an ARM NAS says "no matching manifest", the arm64 image is not in the manifest of that version: pin an older version or wait for the next release (`docker buildx imagetools inspect ghcr.io/helldog136/curiosa:latest` lists the platforms). 32-bit ARM models are not covered.
- About 1 GB of free space, and 1 GB of memory or more.
- A domain name, or a Synology DDNS name (`something.synology.me`), if you want to reach the site from outside.

## 2. Put two files on the NAS

1. In File Station, open the `docker` shared folder (create it in Control Panel > Shared Folder if it does not exist) and create a folder `curiosa`.
2. Download `docker-compose.yml` from the latest release of the project's GitHub page (the file is at `https://raw.githubusercontent.com/helldog136/Curiosa/master/docker-compose.yml`; "Save as") into `/volume1/docker/curiosa`. That is the only project file you need.
3. Create a folder `data` inside it. Your site's database, uploads and installed modules will live there, as a normal folder that Hyper Backup and snapshots can include.
4. Find the owner of that folder: User and group IDs. On Synology, your user is often `1026` and the `users` group `100`; check with SSH `id <your-user>` if you can. The container runs as this user so that the files stay yours and the NAS can back them up.
5. Create a file `.env` next to the compose file (File Station: upload a text file named `.env`; hidden files may need "show hidden files"). Put in it:

```
SITE_URL="https://example.org"
CURIOSA_DATA_DIR="/volume1/docker/curiosa/data"
CURIOSA_PORT="3000"
PUID="1026"
PGID="100"
SETUP_TOKEN="choose-a-long-secret"
CURIOSA_VERSION="0.6.15"
```

Use your own address in `SITE_URL`. `PUID` and `PGID` are the numbers of step 4 (the container starts as root only to give the `data` folder to them, then runs as them, never as root). `CURIOSA_VERSION` pins a version; leave it out to follow `latest`, or use `0.6` to get fixes only. Leave `CURIOSA_BIND` alone: the app then only answers on the NAS itself, and the DSM reverse proxy (step 4) is what visitors reach. If you only want to try it on your home network, set `CURIOSA_BIND="0.0.0.0"` and `SITE_URL="http://nas-address:3000"`, and skip step 4.

The guided script does steps 2 to 5 for you over SSH, if you have it enabled: `bash install-docker.sh --proxy none --data-dir /volume1/docker/curiosa/data --puid 1026 --pgid 100` (see [INSTALL.md](INSTALL.md#docker)).

## 3. Create the project

1. Open Container Manager > **Project** > **Create**.
2. Name: `curiosa`. Path: choose `/volume1/docker/curiosa`. Source: **Use existing docker-compose.yml**.
3. Do not enable the web portal option. Click Next until the end; the image is downloaded and the container starts.

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

- **First setup.** Open `https://example.org/admin/setup` and enter the `SETUP_TOKEN` you chose. Once the site is configured you can empty `SETUP_TOKEN` in `.env` and restart the project.
- **Backup.** Include `/volume1/docker/curiosa/data` in Hyper Backup or a snapshot schedule. The admin's backup page (see [BACKUP.md](BACKUP.md)) also works. At every start the container also copies the database into `data/backups/`.
- **Updating Curiosa.** The admin's *Updates* page tells you when a new version exists and shows what to run; it does not install the core itself (the container is replaced, not changed in place). In Container Manager: Project > `curiosa` > **Action > Pull** then **Start** (or, over SSH, in the folder: `docker compose pull && docker compose up -d`). If you pinned `CURIOSA_VERSION`, change it in `.env` first. Data is kept; migrations run at start, after a copy of the database. A very old site is carried through intermediate versions: the Updates page lists them in order.
- **Automatic updates (Watchtower and similar).** Only with the series tag: `CURIOSA_VERSION="0.6"` follows fixes of 0.6 and nothing else. Never point an automatic updater at `latest`. The container refuses to start on data that is too old or newer than its image, and says why in its log.
- **What still works from the admin in Docker:** installing and updating modules, backups, and all site settings.
- **What does not:** updating the core from the admin, and the automatic restart options (`CURIOSA_RESTART_COMMAND`); Docker restarts the container by itself (`restart: unless-stopped`).
- **Permission errors.** "The data folder is not writable" or "Cannot give the data folder..." in the container log: check that `PUID`/`PGID` match the owner of `data` (step 2, point 4), and that the folder is on a local volume, not on a network share.
