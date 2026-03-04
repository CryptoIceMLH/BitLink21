# Dev Server How-To

**Dev server:** 192.168.1.114
**User:** bitlink21
**SSH:** `ssh bitlink21@192.168.1.114`
**Repo path:** `/home/bitlink21/BitLink21`

---

## Key Facts

- Dev server builds images **locally from source** using `docker-compose.yml`
- Umbrel uses pre-built GHCR images from `ghcr.io/cryptoicemlh/`
- PlutoSDR must be reachable at `192.168.1.200` from the Docker host
- UI accessible at: **http://192.168.1.114:3000/**
- API accessible at: **http://192.168.1.114:8021/api/v1/health**
- WebSocket (waterfall): **ws://192.168.1.114:40134**

---

## Starting Fresh on Dev Server

### 1. Clone repo
```bash
git clone https://github.com/CryptoIceMLH/BitLink21.git
cd BitLink21
```

### 2. Build and start
```bash
docker compose build   # takes ~15 mins (compiles liquid-dsp, libiio, radio C++ from source)
docker compose up -d
```

### 3. Check status
```bash
docker ps
docker logs bitlink21-radio --tail=50
docker logs bitlink21-core --tail=50
```

### 4. Access UI
Open browser: http://192.168.1.114:3000/

---

## Stopping / Restarting

```bash
docker compose down      # stop containers (keeps data)
docker compose up -d     # start again (no rebuild needed)
```

## Full Clean (keep data)

```bash
docker compose down
docker system prune -af --volumes   # removes images, forces rebuild
# Data at ./data/ is never affected (host bind mount)
```

---

## Umbrel Deployment

Umbrel pulls pre-built images from GHCR:
- `ghcr.io/cryptoicemlh/bitlink21-radio:vX.X.X`
- `ghcr.io/cryptoicemlh/bitlink21-core:vX.X.X`
- `ghcr.io/cryptoicemlh/bitlink21-ui:vX.X.X`

Configuration via environment variables (Umbrel orchestration in `exports.sh`):
- `APP_CRYPTOICE_BITLINK21_PLUTO_URI` — PlutoSDR address
- `APP_CRYPTOICE_BITLINK21_API_PORT` — REST API port
- `APP_CRYPTOICE_BITLINK21_WS_PORT` — WebSocket waterfall port
- `APP_CRYPTOICE_BITLINK21_API_TOKEN` — auto-generated API token

Update on Umbrel: `sudo systemctl restart umbrel.service`

---

## Push Images to GHCR (after dev test passes)

```bash
# Log in to GHCR (once)
echo $GITHUB_TOKEN | docker login ghcr.io -u CryptoIceMLH --password-stdin

# Tag
docker tag bitlink21-radio ghcr.io/cryptoicemlh/bitlink21-radio:vX.X.X
docker tag bitlink21-core ghcr.io/cryptoicemlh/bitlink21-core:vX.X.X
docker tag bitlink21-ui ghcr.io/cryptoicemlh/bitlink21-ui:vX.X.X

# Push
docker push ghcr.io/cryptoicemlh/bitlink21-radio:vX.X.X
docker push ghcr.io/cryptoicemlh/bitlink21-core:vX.X.X
docker push ghcr.io/cryptoicemlh/bitlink21-ui:vX.X.X
```

---

## Git Workflow

**Branch Structure:**
- **Local:** `master` — development branch
- **Remote:** `origin/main` — production branch (what Umbrel watches)

**When pushing changes to Umbrel:**

1. **Edit files locally on `master`**
   ```bash
   git checkout master
   # make changes, test locally
   ```

2. **Commit and push to `main` on GitHub**
   ```bash
   git add <files>
   git commit -m "message"
   git push origin master:main    # pushes local master to remote main
   ```

3. **Tag and push images to GHCR** (from dev server after testing)
   ```bash
   # On 192.168.1.114 after docker compose build:
   docker tag bitlink21-radio ghcr.io/cryptoicemlh/bitlink21-radio:vX.X.X
   docker tag bitlink21-core ghcr.io/cryptoicemlh/bitlink21-core:vX.X.X
   docker tag bitlink21-ui ghcr.io/cryptoicemlh/bitlink21-ui:vX.X.X

   docker push ghcr.io/cryptoicemlh/bitlink21-radio:vX.X.X
   docker push ghcr.io/cryptoicemlh/bitlink21-core:vX.X.X
   docker push ghcr.io/cryptoicemlh/bitlink21-ui:vX.X.X
   ```

4. **Update Umbrel** (on Umbrel server)
   ```bash
   sudo systemctl restart umbrel.service
   ```

---

## Version Bump Checklist

When bumping version (e.g., v0.4.0 → v0.4.1):

- [ ] `VERSION` (root) — version string
- [ ] `radio/VERSION`, `core/VERSION`, `web-ui/VERSION` — component versions
- [ ] `umbrel-app.yml` (root) — `version:` field + `releaseNotes:`
- [ ] `cryptoice-bitlink21/umbrel-app.yml` — `version:` field + `releaseNotes:`
- [ ] **`cryptoice-bitlink21/docker-compose.yml` — update ALL image tags** ⚠️ **CRITICAL**
- [ ] Commit to `master`
- [ ] Push `master:main` to GitHub
- [ ] Rebuild on dev server with `docker compose build --no-cache`
- [ ] Test on dev server
- [ ] Tag and push images to GHCR with new version
- [ ] Update Umbrel with `sudo systemctl restart umbrel.service`

**⚠️ CRITICAL: `cryptoice-bitlink21/docker-compose.yml` image tags MUST be updated!**

If you skip this step, Umbrel will pull OLD images from GHCR.

---

## PlutoSDR Network Note

The radio container needs to reach the PlutoSDR at `192.168.1.200`. On the dev server
this works because the host is on the same subnet. On Umbrel, ensure the Umbrel host
can reach the PlutoSDR IP (same LAN or appropriate routing).
