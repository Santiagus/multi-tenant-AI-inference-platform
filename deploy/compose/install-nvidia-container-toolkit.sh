#!/usr/bin/env bash
# Install NVIDIA Container Toolkit on the Compose host (Debian/Ubuntu).
# Invoked via the nvidia-toolkit-install service (privileged + nsenter into host PID 1).
# Host GPU drivers must already work (nvidia-smi). This only registers the Docker nvidia runtime.
set -euo pipefail

log() { printf '[nvidia-toolkit-install] %s\n' "$*"; }

if [[ "$(id -u)" -ne 0 ]]; then
  log "must run as root on the host (compose service uses privileged nsenter)"
  exit 1
fi

# WSL exposes nvidia-smi under /usr/lib/wsl/lib; host PID 1 PATH often omits it.
export PATH="/usr/lib/wsl/lib:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"
NVIDIA_SMI="$(command -v nvidia-smi || true)"
if [[ -z "${NVIDIA_SMI}" && -x /usr/lib/wsl/lib/nvidia-smi ]]; then
  NVIDIA_SMI=/usr/lib/wsl/lib/nvidia-smi
fi
if [[ -z "${NVIDIA_SMI}" ]]; then
  log "nvidia-smi not found on host — install NVIDIA drivers first, then re-run"
  exit 1
fi
log "host GPU probe: $(${NVIDIA_SMI} -L 2>/dev/null | head -1 || echo unknown)"

if command -v nvidia-ctk >/dev/null 2>&1 && docker info 2>/dev/null | grep -qi nvidia; then
  log "nvidia runtime already configured — nothing to do"
  "${NVIDIA_SMI}" -L || true
  exit 0
fi

# Host os-release is only available at install time on the Compose/WSL host.
# shellcheck source=/dev/null
. /etc/os-release
case "${ID:-}" in
  debian|ubuntu) ;;
  *)
    log "unsupported distro '${ID:-unknown}' — install nvidia-container-toolkit manually"
    exit 1
    ;;
esac

export DEBIAN_FRONTEND=noninteractive

log "adding NVIDIA Container Toolkit apt repository"
apt-get update -qq
apt-get install -y -qq curl gnupg ca-certificates

install -d -m 0755 /usr/share/keyrings
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  > /etc/apt/sources.list.d/nvidia-container-toolkit.list

log "installing nvidia-container-toolkit"
apt-get update -qq
apt-get install -y -qq nvidia-container-toolkit

log "configuring Docker nvidia runtime"
nvidia-ctk runtime configure --runtime=docker

# Do not restart Docker from this privileged installer: restarting the daemon
# kills the compose run itself and often leaves dockerd stopped under WSL without
# an interactive sudo to bring it back. Operator restarts once after install.
log "configured /etc/docker/daemon.json with nvidia runtime"
log "NEXT (required — run on the host):"
log "  sudo service docker restart    # or: sudo systemctl restart docker"
log "  docker info | grep -i nvidia"
log "  docker compose up -d --force-recreate api"
log "  docker exec platform-api python3 -c \"import torch; print(torch.cuda.is_available())\""
