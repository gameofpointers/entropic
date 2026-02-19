# Entropic Development Guide

## System Requirements

### macOS
- **macOS 12.0+** (Monterey or later)
- Xcode Command Line Tools: `xcode-select --install`
- Docker Desktop or Colima (bundled in release builds)

### Linux
- **Ubuntu 24.04+** (or equivalent distro with glibc 2.39+)
- X11 or Wayland with XWayland
- WebKitGTK 4.1+ and GTK 3 dependencies:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
  ```
- Docker Engine (not Docker Desktop)

### All Platforms
- Node.js 18+ and pnpm
- Rust 1.70+ (install via [rustup](https://rustup.rs))
- **OpenClaw** (openclaw repo) - see below

---

## One-time Host Setup

### Linux

1. **Install Tauri dependencies:**
   ```bash
   sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
   ```

2. **Create entropic user for isolated X11 access:**
   ```bash
   sudo useradd -u 1337 -M -s /bin/false entropicuser
   ```

3. **Docker must be installed and running**

### macOS

1. **Install Xcode Command Line Tools:**
   ```bash
   xcode-select --install
   ```

2. **Install Rust:**
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

---

## OpenClaw Setup (Required)

Entropic requires the OpenClaw runtime image. This is built from the separate `openclaw` repository.

### 1. Clone and build OpenClaw

```bash
# Clone openclaw repo (sibling to Entropic)
cd ~/agent
git clone https://github.com/dominant-strategies/openclaw openclaw
cd openclaw

# Install dependencies and build
pnpm install
pnpm build
```

### 2. Build the runtime image

```bash
cd ~/agent/Entropic
./scripts/build-openclaw-runtime.sh
```

This creates the `openclaw-runtime:latest` Docker image containing:
- OpenClaw gateway server
- Bundled extensions (memory, discord, telegram, etc.)
- Node.js runtime

**Custom OpenClaw location:**
```bash
OPENCLAW_SOURCE=/path/to/openclaw ./scripts/build-openclaw-runtime.sh
```

**Optional Entropic skills (external plugins):**
```bash
# Sibling repo (recommended)
mkdir -p ../entropic-skills

# Or customize
ENTROPIC_SKILLS_SOURCE=/path/to/entropic-skills ./scripts/build-openclaw-runtime.sh
```
Plugins in the sibling `../entropic-skills` repo with `openclaw.plugin.json` will be bundled into the runtime image.

### 3. Verify the image

```bash
docker images openclaw-runtime:latest
```

---

## Development Workflow

### 1. Allow X11 access for Entropic container
```bash
xhost +si:localuser:entropicuser
```

### 2. Start the dev container
```bash
cd /home/alan/agent/Entropic
./dev.sh
```

First run builds the image (~5-10 min). Subsequent runs start instantly.

### 3. Inside the container

**Install dependencies (first time):**
```bash
pnpm install
```

**Run full Tauri app (React + Rust backend):**
```bash
pnpm tauri dev
```
- Compiles Rust (~2-3 min first time, fast after)
- Opens native window on your desktop

**Run isolated dev OAuth build (entropic-dev://):**
```bash
pnpm tauri:dev
```
This uses `src-tauri/tauri.conf.dev.json` and a dev-only deep link scheme
(`entropic-dev://`) plus a separate auth store (`entropic-auth-dev.json`).

#### macOS dev OAuth (localhost callback)
On macOS, `tauri dev` is **not** a bundle, so URL-scheme callbacks (`entropic-dev://`)
do not reliably return to the running dev process. For dev sign-in, we use a
localhost callback instead:

```
http://127.0.0.1:27100/auth/callback
```

This keeps the OAuth flow in the same dev process and avoids the extra app launch.
It is **dev-only**; bundled dev/prod builds still use `entropic://` / `entropic-dev://`.

**Supabase Redirect URLs (dev + prod)**
- Production: `entropic://auth/callback`
- Dev (scheme): `entropic-dev://auth/callback`
- Dev (localhost): `http://127.0.0.1:27100/auth/callback`

**Overrides**
- `VITE_AUTH_USE_LOCALHOST=1` → force localhost OAuth on any OS
- `VITE_AUTH_FORCE_DEEPLINK=1` → force deep-link OAuth even in dev
- `ENTROPIC_AUTH_LOCALHOST_PORT=27100` → override the localhost OAuth port (dev-only)

**Linux host networking (required for local entropic-web API)**
```bash
```
Use this when running `pnpm tauri dev` on the host so OpenClaw can reach the local `entropic-web` server.

**Linux dev deep links (entropic-dev://)**
```bash
./scripts/register-dev-protocol.sh
```
Run this on the host (outside the dev container) after the first successful `pnpm tauri:dev` so the debug binary exists. This registers `entropic-dev://` so OAuth callbacks open the dev app.

**Entropic skills mount (dev, optional)**
If you want to mount local plugins without rebuilding the image:
```bash
export ENTROPIC_SKILLS_PATH=/path/to/entropic-skills
pnpm tauri:dev
```
This mounts to `/data/entropic-skills` and enables any plugin found under it.

**Supabase OAuth Redirect URLs (dev + prod)**
- Add `entropic://auth/callback` for production.
- Add `entropic-dev://auth/callback` for dev isolation.

**Dev-only env overrides**
```bash
# .env.development (checked in)
VITE_AUTH_REDIRECT_URL="entropic-dev://auth/callback"
VITE_AUTH_STORE_NAME="entropic-auth-dev.json"
```

**Or run React UI only (faster, no Rust):**
```bash
pnpm dev
```
Then open http://localhost:5174 in your browser.

---

## Rebuild Container Image

If you change the Dockerfile in dev.sh:
```bash
docker rmi entropic-dev:latest
./dev.sh
```

---

## Security Notes

- **Dev container** (`dev.sh`) runs as your user for file access
- **OpenClaw agent containers** run as UID 1337 (`entropicuser`) for isolation
- Only the Entropic dev container has X11 display access
- Agent containers cannot access your display or home directory
- Project files are mounted read-write at `/app`

### Revoke X11 access after dev session
```bash
xhost -si:localuser:entropicuser
```

---

## Project Structure

```
Entropic/
├── src/                    # React frontend
│   ├── App.tsx            # Main app, routing
│   ├── pages/
│   │   ├── SetupScreen.tsx    # macOS Colima setup
│   │   ├── DockerInstall.tsx  # Linux Docker install guide
│   │   └── Dashboard.tsx      # Main UI
│   └── index.css          # Tailwind styles
├── src-tauri/             # Rust backend
│   ├── src/
│   │   ├── lib.rs         # Tauri app entry
│   │   ├── commands.rs    # Backend commands (invoke handlers)
│   │   └── runtime.rs     # Docker/Colima detection
│   ├── Cargo.toml         # Rust dependencies
│   └── tauri.conf.json    # Tauri config
├── scripts/               # Build scripts
│   ├── bundle-docker.sh   # Bundle Docker CLI
│   ├── bundle-node.sh     # Bundle Node.js
│   ├── bundle-runtime.sh  # Bundle Colima (macOS) or helper (Linux)
│   └── bundle-openclaw.sh # Bundle OpenClaw (with security scan)
├── dev.sh                 # Development container launcher
├── package.json           # JS dependencies
└── vite.config.ts         # Vite config
```

---

## Building for Release

### Bundle dependencies (run on target platform)
```bash
./scripts/bundle-node.sh
./scripts/bundle-docker.sh
./scripts/bundle-runtime.sh
./scripts/bundle-openclaw.sh
```

### Build release binary
```bash
pnpm tauri build
```

Output: `src-tauri/target/release/bundle/`

---

## Troubleshooting

### "Failed to initialize GTK"
X11 access not granted. Run on host:
```bash
xhost +si:localuser:entropicuser
```

### "Port 5174 already in use"
Kill existing process:
```bash
pkill -f vite
```

### Container can't access Docker
Check socket mount:
```bash
ls -la /var/run/docker.sock
```

### Rust compilation errors
Clean and rebuild:
```bash
cd /app/src-tauri
cargo clean
pnpm tauri dev
```

### DRM/KMS permission denied (Linux)
WebKitGTK GPU acceleration fails. Disable compositing:
```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 pnpm tauri dev
```

### OAuth callback doesn't open app (Linux)
The `entropic://` protocol handler isn't registered. Run on host (not in dev container):
```bash
./scripts/register-dev-protocol.sh
```
