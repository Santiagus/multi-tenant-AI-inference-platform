#!/usr/bin/env bash
# Ephemeral AWS Cloud Deployment & Teardown Workflow (M07)
# Usage:
#   ./infrastructure/terraform/scripts/ephemeral-lifecycle.sh validate
#   ./infrastructure/terraform/scripts/ephemeral-lifecycle.sh plan [ephemeral|production]
#   ./infrastructure/terraform/scripts/ephemeral-lifecycle.sh deploy [ephemeral|production]
#   ./infrastructure/terraform/scripts/ephemeral-lifecycle.sh destroy [ephemeral]

set -euo pipefail

ACTION="${1:-validate}"
ENVIRONMENT="${2:-ephemeral}"
EPHEMERAL_RUN_ID="${EPHEMERAL_RUN_ID:-dev-ephemeral-01}"
ENABLE_EKS="${ENABLE_EKS:-false}"
ENABLE_GPU_NODE_GROUP="${ENABLE_GPU_NODE_GROUP:-false}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_DIR="${REPO_ROOT}/infrastructure/terraform/environments/${ENVIRONMENT}"

if [[ ! -d "${ENV_DIR}" ]]; then
  echo "ERROR: Unknown Terraform environment '${ENVIRONMENT}' (expected 'ephemeral' or 'production')." >&2
  exit 1
fi

if [[ "${ACTION}" == "validate" ]]; then
  echo "==> Running offline Terraform module, IAM least-privilege & cost guardrail validation..."
  python3 "${REPO_ROOT}/scripts/validate_terraform.py"
  exit 0
fi

if [[ "${ENVIRONMENT}" == "production" && "${ACTION}" == "deploy" ]]; then
  if [[ "${CONFIRM_PRODUCTION_APPLY:-no}" != "yes" ]]; then
    echo "ERROR: Production apply requires explicit approval (set CONFIRM_PRODUCTION_APPLY=yes)." >&2
    exit 1
  fi
fi

if ! command -v terraform >/dev/null 2>&1; then
  echo "==> 'terraform' CLI not installed; executing simulated lifecycle verification via scripts/validate_terraform.py..."
  python3 "${REPO_ROOT}/scripts/validate_terraform.py"
  exit 0
fi

echo "==> Initializing Terraform in ${ENV_DIR}..."
terraform -chdir="${ENV_DIR}" init -input=false

case "${ACTION}" in
  plan)
    terraform -chdir="${ENV_DIR}" plan \
      -input=false \
      -var="ephemeral_run_id=${EPHEMERAL_RUN_ID}" \
      -var="enable_eks=${ENABLE_EKS}" \
      -var="enable_gpu_node_group=${ENABLE_GPU_NODE_GROUP}" \
      -out=tfplan
    ;;
  deploy)
    terraform -chdir="${ENV_DIR}" apply \
      -input=false \
      -auto-approve \
      -var="ephemeral_run_id=${EPHEMERAL_RUN_ID}" \
      -var="enable_eks=${ENABLE_EKS}" \
      -var="enable_gpu_node_group=${ENABLE_GPU_NODE_GROUP}"
    ;;
  destroy)
    if [[ "${ENVIRONMENT}" != "ephemeral" ]]; then
      echo "ERROR: Automated teardown is restricted to the 'ephemeral' environment." >&2
      exit 1
    fi
    terraform -chdir="${ENV_DIR}" destroy \
      -input=false \
      -auto-approve \
      -var="ephemeral_run_id=${EPHEMERAL_RUN_ID}" \
      -var="enable_eks=${ENABLE_EKS}" \
      -var="enable_gpu_node_group=${ENABLE_GPU_NODE_GROUP}"
    ;;
  *)
    echo "ERROR: Unsupported action '${ACTION}' (use validate, plan, deploy, or destroy)." >&2
    exit 1
    ;;
esac
