# The base image of the Docker image

The published image (`Dockerfile`) starts from `node:22-bookworm-slim`, **pinned by digest**:

```
FROM node:22-bookworm-slim@sha256:<digest> AS target-amd64
```

The tag stays written for people who read the file; the digest decides what is built. The same commit therefore always builds on exactly the same Node.js and Debian, and a tag moved on Docker Hub (by mistake or by an attacker) changes nothing until someone accepts it. The digest is the one of the **multi-architecture index**, so the same line serves amd64 and arm64. Both `FROM` lines carry the same digest (a test checks it).

## How security fixes still come in

A pinned image does not follow Node.js or Debian fixes by itself. They come in through these steps:

1. **Dependabot** (`.github/dependabot.yml`) checks the tag every week and opens a pull request on `dev` that moves the digest when Docker Hub has a new one. Majors are never proposed.
2. The pull request is merged like any other (CI green on its head). The next release builds its image on the new digest; the smoke test of the image (`scripts/smoke-image.mjs`) starts it before it is pushed.
3. For an urgent Node.js security release, do not wait for the weekly run: move the digest by hand (below), then publish a release, or rebuild the images of the current release with the `release_tag` input of the Release workflow.

## Moving the digest by hand

```
docker buildx imagetools inspect node:22-bookworm-slim
```

Copy the `Digest:` line printed at the top (the index, not one of the per-platform manifests listed under it), check that `linux/amd64` and `linux/arm64` are listed, and replace the digest on **both** `FROM` lines of `Dockerfile`. Write the date in the comment above them. Without Docker, the registry answers too:

```
TOKEN=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/node:pull" | jq -r .token)
curl -sI -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.oci.image.index.v1+json" \
  https://registry-1.docker.io/v2/library/node/manifests/22-bookworm-slim | grep -i docker-content-digest
```

## Another Node.js major

Moving to another major (for example `node:24-bookworm-slim`) is a separate change: the release archive must carry the SQLite driver of that Node.js (`scripts/release-pack.mjs`), and the installer and the development image (`Dockerfile.source`, not pinned: it is never published) follow the same major.
