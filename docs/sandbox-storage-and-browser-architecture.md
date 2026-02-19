# Entropic Sandbox Storage And Browser Architecture

## Storage Classes

- `persistent`: `/data/workspace`, `/data/skills`, `/data/skill-manifests`, `/data/browser`, `/data/tools`, `/data/.cache`, `/data/.npm`.
- `ephemeral`: `/tmp`, `/run`, and process-local scratch.
- `system`: runtime image layers and read-only root filesystem.

## Persistence Contract

The following should survive container restarts:

- Home files and folders (workspace)
- Installed skills and metadata
- Browser profiles/session state (when policy allows)
- Tool caches (npm/playwright/model caches)

The following should not be treated as durable:

- Temporary command output
- One-off downloads in task scratch
- Runtime PID/socket files

## Skill Install Model

- Canonical install root: `/data/skills/<skill-id>/<version>`.
- Active pointer: `/data/skills/<skill-id>/current` symlink.
- Manifest root: `/data/skill-manifests/<skill-id>/<version>.json`.
- Manifest includes:
  - source slug
  - install timestamp
  - best-effort integrity hash
  - inferred scope flags (`filesystem`, `network`, `browser`)
  - scanner summary

## Browser Model

Recommended target model:

- Browser sidecar container (Playwright + Chromium) with profile in `/data/browser/profile`.
- Explicit tool surface exposed to OpenClaw:
  - `navigate`
  - `click`
  - `type`
  - `wait_for`
  - `screenshot`
  - `download`
- Policy gates:
  - domain allow/block lists
  - download write paths
  - optional human confirmation for high-risk actions

## Migration Notes

- Workspace moved to `/data/workspace`.
- Legacy `/home/node/.openclaw/workspace` is linked to `/data/workspace`.
- Legacy skill locations are still read for compatibility; new installs write to `/data/skills/<id>/<version>`.
