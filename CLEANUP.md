# Entropic Cleanup Guide

This guide explains how to clean up Entropic's runtime and data when uninstalling or resetting the application.

## Option 1: In-App Cleanup (Recommended)

If the app is still working, go to **Settings** → **Data Management**:

### Reset Application
Use this if you want to start fresh but keep your settings:
- Stops the runtime
- Deletes all Docker containers and volumes
- Removes Colima VMs
- Clears app cache
- **Preserves your auth settings and API keys**

### Cleanup and Quit (For Uninstalling)
Use this before moving Entropic to trash:
1. Click **"Cleanup and Quit"**
2. Confirm the cleanup
3. Wait for the app to quit automatically
4. Move Entropic.app to trash

This will:
- Stop the runtime
- Delete all Docker containers and volumes
- Remove Colima VMs
- **Delete ALL app data including settings**
- Quit the app automatically

## Option 2: Manual Cleanup Script

If the app won't start or you've already moved it to trash:

```bash
cd /path/to/entropic
./scripts/cleanup-entropic.sh
```

This script will remove:
- `~/.entropic/` - Colima VMs and runtime state
- Docker containers and volumes
- Docker contexts for Entropic
- App cache in `~/Library/Application Support/ai.openclaw.entropic/`

Your settings (auth.json) will be preserved.

## Option 3: Complete Manual Cleanup

If you want to completely remove everything including settings:

```bash
# Stop Colima VMs
colima delete -f -p entropic-vz
colima delete -f -p entropic-qemu

# Remove runtime directory
rm -rf ~/.entropic

# Remove app data (including settings)
rm -rf ~/Library/Application\ Support/ai.openclaw.entropic

# Clean Docker contexts (optional)
docker context rm colima-entropic-vz 2>/dev/null || true
docker context rm colima-entropic-qemu 2>/dev/null || true
```

## What Gets Cleaned

### Always Removed:
- Colima VMs (`entropic-vz`, `entropic-qemu`)
- Docker containers and volumes
- Docker images
- Runtime state in `~/.entropic/`
- App cache and logs

### Preserved (unless manually deleted):
- Auth settings (`~/Library/Application Support/ai.openclaw.entropic/auth.json`)
- Your API keys
- Onboarding progress
- Profile settings

## After Cleanup

Once cleanup is complete:

- **Reinstalling**: Just reinstall the app - you'll keep your settings
- **Starting fresh**: Delete the app data folder to reset everything
- **Uninstalling**: Move the app to trash after running cleanup

## Troubleshooting

**"Permission denied" when running script:**
```bash
chmod +x scripts/cleanup-entropic.sh
./scripts/cleanup-entropic.sh
```

**Colima VMs won't delete:**
```bash
# Force delete with limactl
limactl delete colima-entropic-vz --force
limactl delete colima-entropic-qemu --force
```

**Docker containers still running:**
```bash
# Stop all containers first
docker stop $(docker ps -aq)
docker rm $(docker ps -aq)
```

## Support

If you encounter issues with cleanup, please:
1. Check the logs in Settings → Diagnostics
2. Open an issue at: https://github.com/dominant-strategies/entropic/issues
