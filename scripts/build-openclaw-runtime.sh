#!/bin/bash
set -euo pipefail

# Build the OpenClaw core runtime container

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RUNTIME_DIR="$PROJECT_ROOT/openclaw-runtime"
OPENCLAW_SOURCE="${OPENCLAW_SOURCE:-$PROJECT_ROOT/../openclaw}"
ENTROPIC_SKILLS_SOURCE="${ENTROPIC_SKILLS_SOURCE:-$PROJECT_ROOT/../entropic-skills}"
SCRIPT_BIN_DIRS="${PROJECT_ROOT}/src-tauri/target/debug/resources/bin:${PROJECT_ROOT}/src-tauri/resources/bin"
USER_UID="$(id -u)"
TMP_BASE="${TMPDIR:-/tmp}"
TMP_BASE="${TMP_BASE%/}"
FALLBACK_COLIMA_HOME_SHARED="/Users/Shared/entropic/colima-${USER_UID}"
FALLBACK_COLIMA_HOME_TMP="${TMP_BASE}/entropic-colima-${USER_UID}"
ACTIVE_DOCKER_HOST=""
ACTIVE_COLIMA_HOME=""
COLIMA_HOME_CANDIDATES=()
COLIMA_PROFILES=(entropic-vz entropic-qemu)
COLIMA_VM_TYPES=(vz qemu)

find_docker_binary() {
    local candidates=()

    if command -v docker >/dev/null 2>&1; then
        candidates+=("$(command -v docker)")
    fi

    local bundled="$PROJECT_ROOT/src-tauri/resources/bin/docker"
    if [ -x "$bundled" ]; then
        candidates+=("$bundled")
    fi

    local target_debug="$PROJECT_ROOT/src-tauri/target/debug/resources/bin/docker"
    if [ -x "$target_debug" ]; then
        candidates+=("$target_debug")
    fi

    local path
    for path in "${candidates[@]}"; do
        if "$path" --version >/dev/null 2>&1; then
            echo "$path"
            return 0
        fi
    done

    echo "docker"
}

find_colima_binary() {
    local target_debug="$PROJECT_ROOT/src-tauri/target/debug/resources/bin/colima"
    if [ -x "$target_debug" ]; then
        echo "$target_debug"
        return 0
    fi

    local bundled="$PROJECT_ROOT/src-tauri/resources/bin/colima"
    if [ -x "$bundled" ]; then
        echo "$bundled"
        return 0
    fi

    if command -v colima >/dev/null 2>&1; then
        echo "$(command -v colima)"
        return 0
    fi

    return 1
}

add_colima_home_candidate() {
    local candidate="$1"
    local existing
    [ -n "$candidate" ] || return 0
    for existing in "${COLIMA_HOME_CANDIDATES[@]-}"; do
        if [ "$existing" = "$candidate" ]; then
            return 0
        fi
    done
    COLIMA_HOME_CANDIDATES+=("$candidate")
}

build_colima_home_candidates() {
    if [ -n "${ENTROPIC_COLIMA_HOME:-}" ]; then
        add_colima_home_candidate "$ENTROPIC_COLIMA_HOME"
    fi
    add_colima_home_candidate "$HOME/.entropic/colima"
    add_colima_home_candidate "$HOME/.entropic/colima-dev"
    add_colima_home_candidate "$FALLBACK_COLIMA_HOME_SHARED"
    add_colima_home_candidate "$FALLBACK_COLIMA_HOME_TMP"
    add_colima_home_candidate "$HOME/.colima"
}

docker_host_is_available() {
    local candidate="$1"
    [ -n "$candidate" ] || return 1
    DOCKER_HOST="$candidate" "$DOCKER_BIN" info >/dev/null 2>&1
}

resolve_working_docker_host() {
    local profile
    local home
    local sock
    local candidate

    if [ -n "${DOCKER_HOST:-}" ] && docker_host_is_available "${DOCKER_HOST}"; then
        ACTIVE_DOCKER_HOST="${DOCKER_HOST}"
        ACTIVE_COLIMA_HOME=""
        return 0
    fi

    # Prefer whatever Docker context is already active (e.g., Docker Desktop)
    # before probing Colima sockets.
    if "$DOCKER_BIN" info >/dev/null 2>&1; then
        ACTIVE_DOCKER_HOST=""
        ACTIVE_COLIMA_HOME=""
        return 0
    fi

    for profile in "${COLIMA_PROFILES[@]}"; do
        for home in "${COLIMA_HOME_CANDIDATES[@]-}"; do
            sock="$home/$profile/docker.sock"
            candidate="unix://$sock"
            if [ -S "$sock" ] && docker_host_is_available "$candidate"; then
                ACTIVE_DOCKER_HOST="$candidate"
                ACTIVE_COLIMA_HOME="$home"
                return 0
            fi
        done
    done

    ACTIVE_DOCKER_HOST=""
    ACTIVE_COLIMA_HOME=""
    return 1
}

run_colima_with_home() {
    local home="$1"
    shift
    COLIMA_HOME="$home" \
    LIMA_HOME="$home/_lima" \
    PATH="${SCRIPT_BIN_DIRS}:$PATH" \
    "$COLIMA_BIN" "$@"
}

ensure_docker_ready() {
    if resolve_working_docker_host; then
        return 0
    fi

    if [ -z "${COLIMA_BIN:-}" ]; then
        return 1
    fi

    local i
    local profile
    local vm_type
    local home
    local start_output
    local wait_attempts

    for i in "${!COLIMA_PROFILES[@]}"; do
        profile="${COLIMA_PROFILES[$i]}"
        vm_type="${COLIMA_VM_TYPES[$i]}"
        for home in "${COLIMA_HOME_CANDIDATES[@]-}"; do
            mkdir -p "$home" >/dev/null 2>&1 || continue
            echo "Starting Colima profile ${profile} (${vm_type}) with COLIMA_HOME=${home}..."
            if start_output="$(run_colima_with_home "$home" --profile "$profile" start --vm-type "$vm_type" 2>&1)"; then
                wait_attempts=20
                while [ "$wait_attempts" -gt 0 ]; do
                    if resolve_working_docker_host; then
                        return 0
                    fi
                    wait_attempts=$((wait_attempts - 1))
                    sleep 1
                done
            else
                echo "Colima start failed for profile ${profile} in ${home}."
                echo "$start_output" | tail -n 8
            fi
        done
    done

    return 1
}

run_docker() {
    if [ -n "${ACTIVE_DOCKER_HOST}" ]; then
        DOCKER_HOST="$ACTIVE_DOCKER_HOST" "$DOCKER_BIN" "$@"
    else
        "$DOCKER_BIN" "$@"
    fi
}

DOCKER_BIN="$(find_docker_binary)"
COLIMA_BIN="$(find_colima_binary || true)"
build_colima_home_candidates

echo "=== Building OpenClaw Runtime Container ==="
echo ""

# Check if OpenClaw source exists
if [ ! -d "$OPENCLAW_SOURCE/dist" ]; then
    echo "ERROR: OpenClaw dist not found at $OPENCLAW_SOURCE/dist"
    echo "Please build openclaw first: cd $OPENCLAW_SOURCE && pnpm build"
    exit 1
fi

STAGING_DIR="$PROJECT_ROOT/.build/openclaw-runtime"
mkdir -p "$STAGING_DIR"

echo "Staging OpenClaw files..."

# Copy Dockerfile and entrypoint
rsync -a "$RUNTIME_DIR/Dockerfile" "$STAGING_DIR/Dockerfile"
rsync -a "$RUNTIME_DIR/entrypoint.sh" "$STAGING_DIR/entrypoint.sh"

# Copy dist
rsync -a --delete "$OPENCLAW_SOURCE/dist/" "$STAGING_DIR/dist/"

# Copy package.json
rsync -a "$OPENCLAW_SOURCE/package.json" "$STAGING_DIR/package.json"

# Copy docs/reference/templates (required for agent workspace)
echo "Copying templates..."
mkdir -p "$STAGING_DIR/docs/reference"
rsync -a --delete "$OPENCLAW_SOURCE/docs/reference/templates/" "$STAGING_DIR/docs/reference/templates/"

# Copy bundled plugins (curated set for the store)
mkdir -p "$STAGING_DIR/extensions"

PLUGINS_TO_BUNDLE=(
    "memory-core"
    "memory-lancedb"
    "entropic-integrations"
    "discord"
    "telegram"
    "slack"
    "whatsapp"
    "imessage"
    "msteams"
    "voice-call"
    "matrix"
    "googlechat"
)

for plugin in "${PLUGINS_TO_BUNDLE[@]}"; do
    if [ -d "$OPENCLAW_SOURCE/extensions/$plugin" ]; then
        echo "Copying ${plugin} plugin..."
        rsync -a --delete \
            --exclude='node_modules' \
            --exclude='.git' \
            "$OPENCLAW_SOURCE/extensions/$plugin/" "$STAGING_DIR/extensions/$plugin/"
    else
        echo "WARNING: ${plugin} plugin not found in OpenClaw source."
    fi
done

# Copy Entropic-owned skills/plugins (optional)
if [ -d "$ENTROPIC_SKILLS_SOURCE" ]; then
    echo "Copying Entropic skills from $ENTROPIC_SKILLS_SOURCE..."
    for plugin_dir in "$ENTROPIC_SKILLS_SOURCE"/*; do
        if [ -d "$plugin_dir" ] && [ -f "$plugin_dir/openclaw.plugin.json" ]; then
            plugin_name="$(basename "$plugin_dir")"
            echo "Copying ${plugin_name} plugin..."
            rsync -a --delete \
                --exclude='node_modules' \
                --exclude='.git' \
                "$plugin_dir/" "$STAGING_DIR/extensions/$plugin_name/"
        fi
    done
else
    echo "No Entropic skills directory found at $ENTROPIC_SKILLS_SOURCE (skipping)."
fi

# Copy node_modules (production only)
echo "Copying node_modules (this may take a moment)..."
mkdir -p "$STAGING_DIR/node_modules"
rsync -a --delete \
    --exclude='.cache' \
    --exclude='*.map' \
    --exclude='test' \
    --exclude='tests' \
    --exclude='.git' \
    "$OPENCLAW_SOURCE/node_modules/" "$STAGING_DIR/node_modules/"

# Security scan - check for actual secrets in config files only
echo ""
echo "Running security scan..."
if find "$STAGING_DIR" -type f \( -name "*.env" -o -name "*.json" -o -name "*.yaml" -o -name "*.yml" -o -name "*.toml" \) \
    -exec grep -lE "sk-[a-zA-Z0-9]{40,}|key-[a-zA-Z0-9]{40,}" {} \; 2>/dev/null | head -5 | grep -q .; then
    echo "ERROR: Potential secrets found! Aborting."
    exit 1
fi
echo "Security scan passed."

# Build container
echo ""
echo "Building container image..."
if ! ensure_docker_ready; then
    echo "ERROR: Docker is not reachable."
    echo "Tried Docker Desktop plus Colima profiles (${COLIMA_PROFILES[*]}) in:"
    if [ "${#COLIMA_HOME_CANDIDATES[@]}" -gt 0 ]; then
        printf '  - %s\n' "${COLIMA_HOME_CANDIDATES[@]}"
    fi
    echo "Start runtime first with ./scripts/dev-runtime.sh start, then retry."
    exit 1
fi

if [ -n "${ACTIVE_DOCKER_HOST}" ]; then
    echo "Using Docker host: ${ACTIVE_DOCKER_HOST}"
elif [ -n "${DOCKER_HOST:-}" ]; then
    echo "Using Docker host from environment: ${DOCKER_HOST}"
else
    echo "Using default Docker context."
fi

export DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-1}"
run_docker build --cache-from openclaw-runtime:latest -t openclaw-runtime:latest "$STAGING_DIR"

echo ""
echo "=== OpenClaw runtime image built: openclaw-runtime:latest ==="
run_docker images openclaw-runtime:latest
