#!/usr/bin/env bash
# ==============================================================================
# Method B: Live Local Cluster with Argo CD UI (via Kind + Docker)
#
# Automates the end-to-end setup of a local Kubernetes (Kind) cluster,
# installs Argo CD, applies the Platform GitOps manifests (project & staging application),
# and provides access to the Argo CD web dashboard.
#
# Usage:
#   ./scripts/setup_local_argocd.sh [command]
#
# Commands:
#   up           (default) Provision cluster, install Argo CD, apply GitOps manifests
#   ui           Port-forward Argo CD web UI to http://localhost:8080
#   password     Print the initial admin password for Argo CD
#   status       Display cluster nodes, Argo CD pods, and GitOps application state
#   down         Tear down and delete the local Kind cluster
# ==============================================================================

set -euo pipefail

CLUSTER_NAME="inference-platform-local"
KIND_CONFIG="deploy/kubernetes/kind-cluster.yaml"
ARGOCD_MANIFESTS_URL="https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml"
PROJECT_MANIFEST="deploy/argocd/argocd-project.yaml"
STAGING_APP_MANIFEST="deploy/argocd/application-staging.yaml"

# Script directory and repository root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# Add ~/.local/bin to PATH in case kind/kubectl were installed there
export PATH="${HOME}/.local/bin:${PATH}"

# ------------------------------------------------------------------------------
# Helper functions
# ------------------------------------------------------------------------------
log_info() {
    echo -e "\033[1;34m==>\033[0m \033[1m$1\033[0m" >&2
}

log_success() {
    echo -e "\033[1;32m✓\033[0m \033[1m$1\033[0m" >&2
}

log_warn() {
    echo -e "\033[1;33m⚠\033[0m $1" >&2
}

log_error() {
    echo -e "\033[1;31m✖\033[0m \033[1;31mERROR:\033[0m $1" >&2
}

# ------------------------------------------------------------------------------
# 1. Verify Prerequisites & Install CLI Binaries
# ------------------------------------------------------------------------------
check_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker is required but not installed. Please install Docker first."
        exit 1
    fi

    if ! docker info >/dev/null 2>&1; then
        log_error "Docker daemon is not running or current user lacks docker group permissions."
        exit 1
    fi
}

resolve_install_dir() {
    if [[ -w "/usr/local/bin" ]]; then
        echo "/usr/local/bin"
    elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
        echo "sudo:/usr/local/bin"
    else
        mkdir -p "${HOME}/.local/bin"
        echo "${HOME}/.local/bin"
    fi
}

install_binary() {
    local name="$1"
    local download_url="$2"
    local install_target
    install_target="$(resolve_install_dir)"

    log_info "Downloading ${name} from ${download_url}..."
    local tmp_bin
    tmp_bin="$(mktemp)"
    curl -Lo "${tmp_bin}" "${download_url}"
    chmod +x "${tmp_bin}"

    if [[ "${install_target}" =~ ^sudo:(.*)$ ]]; then
        local target_dir="${BASH_REMATCH[1]}"
        sudo mv "${tmp_bin}" "${target_dir}/${name}"
    else
        mv "${tmp_bin}" "${install_target}/${name}"
    fi

    log_success "${name} successfully installed."
}

ensure_binaries() {
    check_docker

    if ! command -v kind >/dev/null 2>&1; then
        log_warn "'kind' not found in PATH. Installing kind v0.22.0..."
        install_binary "kind" "https://kind.sigs.k8s.io/dl/v0.22.0/kind-linux-amd64"
    fi

    if ! command -v kubectl >/dev/null 2>&1; then
        log_warn "'kubectl' not found in PATH. Installing latest stable kubectl..."
        local stable_version
        stable_version="$(curl -L -s https://dl.k8s.io/release/stable.txt)"
        install_binary "kubectl" "https://dl.k8s.io/release/${stable_version}/bin/linux/amd64/kubectl"
    fi

    log_success "Kind ($(kind --version)) and Kubectl ($(kubectl version --client --short 2>/dev/null || kubectl version --client)) are available."
}

# ------------------------------------------------------------------------------
# 2. Cluster Provisioning (Kind)
# ------------------------------------------------------------------------------
resolve_kind_config() {
    local src_config="${1:-${KIND_CONFIG}}"
    local target_config="${src_config}"

    # Check if host ports 3000, 3001, or 9090 are currently occupied on 127.0.0.1
    local conflict=0
    local occupied_ports=""
    for p in 3000 3001 9090; do
        if python3 -c "import socket; s = socket.socket(socket.AF_INET, socket.SOCK_STREAM); exit(0 if s.connect_ex(('127.0.0.1', ${p})) == 0 else 1)" 2>/dev/null; then
            conflict=1
            occupied_ports="${occupied_ports} ${p}"
        fi
    done

    if [[ ${conflict} -eq 1 ]]; then
        log_warn "Host port collision detected: ports [${occupied_ports# }] are already in use (e.g. by Docker Compose)."
        log_info "Auto-remapping Kind hostPorts to avoid conflicts (3000->13000, 3001->13001, 9090->19090)..."
        log_info "(Tip: Both Docker Compose and Kind cluster can now run simultaneously without port bind errors!)"
        local cache_dir="${REPO_ROOT}/.cache"
        mkdir -p "${cache_dir}"
        target_config="${cache_dir}/kind-cluster-resolved.yaml"
        sed -e 's/hostPort: 3000/hostPort: 13000/g' \
            -e 's/hostPort: 3001/hostPort: 13001/g' \
            -e 's/hostPort: 9090/hostPort: 19090/g' \
            "${src_config}" > "${target_config}"
        log_success "Generated non-conflicting Kind cluster config at ${target_config}."
    fi

    echo "${target_config}"
}

provision_cluster() {
    ensure_binaries

    local active_config
    active_config="$(resolve_kind_config "${KIND_CONFIG}")"

    if kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}"; then
        log_info "Kind cluster '${CLUSTER_NAME}' already exists. Reusing existing cluster."
    else
        if [[ ! -f "${active_config}" ]]; then
            log_error "Kind cluster configuration '${active_config}' not found."
            exit 1
        fi
        log_info "Spinning up local Kind cluster '${CLUSTER_NAME}' with config '${active_config}'..."
        if ! kind create cluster --config "${active_config}"; then
            log_error "Kind cluster creation failed. Cleaning up failed cluster container if present..."
            kind delete cluster --name "${CLUSTER_NAME}" 2>/dev/null || true
            exit 1
        fi
        log_success "Kind cluster '${CLUSTER_NAME}' created successfully."
    fi

    # Set context to kind cluster
    kubectl config use-context "kind-${CLUSTER_NAME}" >/dev/null 2>&1 || true
}

# ------------------------------------------------------------------------------
# 3. Argo CD Installation
# ------------------------------------------------------------------------------
install_argocd() {
    log_info "Configuring 'argocd' namespace..."
    kubectl get namespace argocd >/dev/null 2>&1 || kubectl create namespace argocd

    log_info "Installing Argo CD manifests (server-side apply)..."
    kubectl apply --server-side --force-conflicts -n argocd -f "${ARGOCD_MANIFESTS_URL}"

    log_info "Waiting for deployment/argocd-server to become available (timeout 300s)..."
    kubectl wait --for=condition=available deployment/argocd-server -n argocd --timeout=300s
    log_success "Argo CD control plane is up and running."
}

# ------------------------------------------------------------------------------
# 4. Install Platform CRDs (KEDA, Kueue, Kyverno, Prometheus)
# ------------------------------------------------------------------------------
install_platform_crds() {
    log_info "Installing Platform CRDs (KEDA, Kueue, Kyverno, Prometheus Operator)..."

    # Prometheus Operator ServiceMonitor CRD
    kubectl apply --server-side --force-conflicts -f \
        https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/v0.71.2/example/prometheus-operator-crd/monitoring.coreos.com_servicemonitors.yaml >/dev/null 2>&1 || true

    # KEDA CRDs (ScaledObject, TriggerAuthentication)
    kubectl apply --server-side --force-conflicts -f \
        https://github.com/kedacore/keda/releases/download/v2.13.0/keda-2.13.0-crds.yaml >/dev/null 2>&1 || true

    # Kueue CRDs (ClusterQueue, LocalQueue, ResourceFlavor, WorkloadPriorityClass)
    kubectl apply --server-side --force-conflicts -f \
        https://github.com/kubernetes-sigs/kueue/releases/download/v0.6.2/manifests.yaml >/dev/null 2>&1 || true
    # Remove webhooks in local Kind so Kueue CRDs function without requiring webhook daemon readiness
    kubectl delete mutatingwebhookconfiguration kueue-mutating-webhook-configuration >/dev/null 2>&1 || true
    kubectl delete validatingwebhookconfiguration kueue-validating-webhook-configuration >/dev/null 2>&1 || true

    # Kyverno CRDs (ClusterPolicy)
    kubectl apply --server-side --force-conflicts -f \
        https://github.com/kyverno/kyverno/releases/download/v1.11.4/install.yaml >/dev/null 2>&1 || true

    # metrics-server for HPA (metrics.k8s.io)
    if ! kubectl get apiservice v1beta1.metrics.k8s.io >/dev/null 2>&1; then
        log_info "Installing metrics-server for HPA (metrics.k8s.io)..."
        kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml >/dev/null 2>&1 || true
        kubectl patch -n kube-system deployment/metrics-server --type='json' -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]' >/dev/null 2>&1 || true
    fi

    # Bridge local host Docker Compose services (Postgres, MinIO, ElasticMQ) into Kind
    setup_local_bridge_services

    # Pre-load local Docker images into Kind if available
    preload_local_images

    log_success "Platform CRDs ready."
}

# ------------------------------------------------------------------------------
# 5. Bridge Host Services & Preload Images into Kind
# ------------------------------------------------------------------------------
setup_local_bridge_services() {
    kubectl get namespace inference-platform >/dev/null 2>&1 || kubectl create namespace inference-platform

    local host_gateway="172.25.0.1"
    cat <<EOF | kubectl apply -f - >/dev/null 2>&1 || true
apiVersion: v1
kind: Service
metadata:
  name: platform-minio
  namespace: inference-platform
spec:
  ports:
    - port: 9000
      targetPort: 9000
---
apiVersion: v1
kind: Endpoints
metadata:
  name: platform-minio
  namespace: inference-platform
subsets:
  - addresses:
      - ip: ${host_gateway}
    ports:
      - port: 9000
---
apiVersion: v1
kind: Service
metadata:
  name: platform-elasticmq
  namespace: inference-platform
spec:
  ports:
    - port: 9324
      targetPort: 9324
---
apiVersion: v1
kind: Endpoints
metadata:
  name: platform-elasticmq
  namespace: inference-platform
subsets:
  - addresses:
      - ip: ${host_gateway}
    ports:
      - port: 9324
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: inference-platform
spec:
  ports:
    - port: 5432
      targetPort: 5432
---
apiVersion: v1
kind: Endpoints
metadata:
  name: postgres
  namespace: inference-platform
subsets:
  - addresses:
      - ip: ${host_gateway}
    ports:
      - port: 5432
EOF
}

preload_local_images() {
    log_info "Preloading local container images into Kind cluster..."
    if docker image inspect multi-tenant-ai-inference-platform-api:latest >/dev/null 2>&1; then
        docker tag multi-tenant-ai-inference-platform-api:latest ghcr.io/multi-tenant-ai-inference-platform/api:0.6.0 >/dev/null 2>&1 || true
        kind load docker-image ghcr.io/multi-tenant-ai-inference-platform/api:0.6.0 --name "${CLUSTER_NAME}" >/dev/null 2>&1 || true
    fi
    if docker image inspect ghcr.io/multi-tenant-ai-inference-platform/worker:0.6.0 >/dev/null 2>&1; then
        kind load docker-image ghcr.io/multi-tenant-ai-inference-platform/worker:0.6.0 --name "${CLUSTER_NAME}" >/dev/null 2>&1 || true
    fi
}

# ------------------------------------------------------------------------------
# 5. Apply Platform GitOps Manifests
# ------------------------------------------------------------------------------
apply_gitops_manifests() {
    install_platform_crds

    log_info "Applying Platform GitOps AppProject..."
    kubectl apply -f "${PROJECT_MANIFEST}"

    log_info "Applying Platform GitOps Staging Application..."
    kubectl apply -f "${STAGING_APP_MANIFEST}"

    log_success "Platform GitOps manifests applied successfully."
}

# ------------------------------------------------------------------------------
# 6. Credentials & Web UI Access
# ------------------------------------------------------------------------------
get_admin_password() {
    local retries=15
    local password=""
    while [[ ${retries} -gt 0 ]]; do
        password="$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" 2>/dev/null || true)"
        if [[ -n "${password}" ]]; then
            echo "${password}" | base64 -d
            return 0
        fi
        sleep 2
        retries=$((retries - 1))
    done
    log_warn "Initial admin secret not found. It may have already been removed or updated."
    return 1
}

print_summary() {
    echo ""
    echo "========================================================================"
    echo "  Argo CD Live Local Cluster Ready!"
    echo "========================================================================"
    echo "  Cluster Name:   ${CLUSTER_NAME}"
    echo "  Web UI URL:     https://localhost:8080"
    echo "  Default User:   admin"
    local pw
    pw="$(get_admin_password 2>/dev/null || true)"
    if [[ -n "${pw}" ]]; then
        echo "  Admin Password: ${pw}"
    else
        echo "  Admin Password: (Run '$0 password' to query or reset via kubectl)"
    fi
    echo ""
    echo "  To access the UI:"
    echo "    $0 ui"
    echo "    (or: kubectl port-forward svc/argocd-server -n argocd 8080:443)"
    echo "========================================================================"
    echo ""
}

start_ui() {
    log_info "Retrieving Argo CD credentials..."
    local pw
    pw="$(get_admin_password 2>/dev/null || true)"
    echo ""
    echo "  Argo CD Web UI: https://localhost:8080"
    echo "  Username:       admin"
    if [[ -n "${pw}" ]]; then
        echo "  Password:       ${pw}"
    fi
    echo ""
    log_info "Starting port forward (svc/argocd-server -> localhost:8080)..."
    log_info "Press Ctrl+C to terminate the port forward session."
    kubectl port-forward svc/argocd-server -n argocd 8080:443
}

# ------------------------------------------------------------------------------
# 6. Status and Teardown
# ------------------------------------------------------------------------------
show_status() {
    ensure_binaries
    echo "=== Kind Cluster Status ==="
    kind get clusters 2>/dev/null || true
    echo ""
    echo "=== Kubernetes Nodes ==="
    kubectl get nodes -o wide 2>/dev/null || true
    echo ""
    echo "=== Argo CD Deployments ==="
    kubectl -n argocd get deployments 2>/dev/null || true
    echo ""
    echo "=== Argo CD Applications ==="
    kubectl -n argocd get applications 2>/dev/null || true
}

teardown_cluster() {
    ensure_binaries
    if kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}"; then
        log_info "Tearing down and deleting Kind cluster '${CLUSTER_NAME}'..."
        kind delete cluster --name "${CLUSTER_NAME}"
        log_success "Kind cluster '${CLUSTER_NAME}' deleted successfully."
    else
        log_info "Kind cluster '${CLUSTER_NAME}' does not exist. Nothing to clean up."
    fi
}

# ------------------------------------------------------------------------------
# Main Dispatcher
# ------------------------------------------------------------------------------
CMD="${1:-up}"

case "${CMD}" in
    up)
        provision_cluster
        install_argocd
        apply_gitops_manifests
        print_summary
        ;;
    ui|port-forward)
        start_ui
        ;;
    password)
        get_admin_password
        echo ""
        ;;
    status)
        show_status
        ;;
    down|clean|delete)
        teardown_cluster
        ;;
    help|--help|-h)
        echo "Usage: $0 [up|ui|password|status|down]"
        echo "  up        Spin up Kind cluster, install Argo CD, and apply platform manifests"
        echo "  ui        Port-forward Argo CD web dashboard to localhost:8080"
        echo "  password  Show the Argo CD initial admin password"
        echo "  status    Show status of cluster nodes, Argo CD pods, and GitOps apps"
        echo "  down      Delete the local Kind cluster"
        ;;
    *)
        log_error "Unknown command: ${CMD}"
        echo "Usage: $0 [up|ui|password|status|down]"
        exit 1
        ;;
esac

