# Moving a site to Node.js 24

Node.js 24 is the default for new installs, the Docker image and CI (core 0.43.0). Node.js 20 reached end of life on 2026-04-30 and Node.js 22 ends on 2027-04-30. Existing sites keep running on their Node.js: this guide is what the **owner** does on the server, **one site at a time, starting with the least critical**. Nothing here is done from the admin, and an in-app core update never changes the server's Node.js. Do not run a core update while you switch.

The release archive carries the SQLite driver of Node.js 20, 22 and 24 and picks the right one at start from the running version: **no `npm rebuild` is needed**. Node.js 26 is not supported yet (`better-sqlite3` publishes no driver for it).

## Steps (Ubuntu/Debian with NodeSource, systemd)

1. **Back up first.** Admin > Maintenance > Backup (download it), and note the current version: `node -v`.
2. **Check the unit.** `systemctl cat <site>.service`: the `ExecStart` line must start with the absolute path of `node` (for example `/usr/bin/node`). A site started with `npx`, or with a Node.js from `nvm` in a home folder, must be fixed first (see `docs/INSTALL.md`).
3. **Switch the NodeSource repository** from 20 (or 22) to 24:
   ```
   sudo sed -i 's/node_20\.x/node_24.x/; s/node_22\.x/node_24.x/' /etc/apt/sources.list.d/nodesource.list
   sudo apt-get update
   sudo apt-get install -y nodejs
   node -v    # v24.x
   ```
   If the repository file has another name or format, re-run NodeSource's setup for 24 instead. Other sites on the same server share this Node.js: they restart on it too (step 4).
4. **Restart the site.** `sudo systemctl restart <site>.service` (do it for each site on this server).
5. **Check.** `maintenance_status` (or the dashboard): `runtime.node` shows v24 and `runtime.support.state` is `ok`. Open the site and the admin, and look at Admin > Maintenance > Health.

## Rollback

If the site does not start: put the previous major back in the repository file (`node_24.x` to `node_20.x`), then `sudo apt-get update && sudo apt-get install -y --allow-downgrades nodejs=<previous version>` (or `sudo apt-get install -y nodejs` if the repository only carries one), `sudo systemctl restart <site>.service`. The database is not touched by a Node.js change; if anything looks wrong with the data, restore the backup of step 1.

## Docker

Pull the new image (it is built on Node.js 24) and recreate the container. Nothing else changes.
