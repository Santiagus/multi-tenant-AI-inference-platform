#!/usr/bin/env bash
# Initialize the local development and verification environment inside the repository:
# 1. Creates and activates the Python virtual environment at .venv
# 2. Enables pnpm inside .venv/bin via Corepack (keeping all binaries inside the repo)
# 3. Installs Python worker and validation dependencies into .venv
# 4. Installs and builds Node.js workspace dependencies via pnpm
#
# Usage:
#   source scripts/init_env.sh   (recommended: initializes and activates .venv in your current bash/zsh shell)
#   ./scripts/init_env.sh        (or `make init`: initializes .venv; then run `source .venv/bin/activate`)

_init_platform_env() {
    local is_sourced=0
    local script_path=""

    if [[ -n "${ZSH_VERSION:-}" ]]; then
        # shellcheck disable=SC2296
        script_path="${(%):-%x}"
        if [[ "${ZSH_EVAL_CONTEXT:-}" == *:file* ]]; then
            is_sourced=1
        fi
    elif [[ -n "${BASH_VERSION:-}" ]]; then
        script_path="${BASH_SOURCE[0]}"
        if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
            is_sourced=1
        fi
    else
        script_path="$0"
    fi

    local script_dir
    script_dir="$(cd "$(dirname "${script_path}")" && pwd)"
    local repo_root
    repo_root="$(cd "${script_dir}/.." && pwd)"
    local venv_dir="${repo_root}/.venv"

    echo "==> Initializing repository environment in ${repo_root}/.venv..."

    # 1. Create Python virtual environment (.venv) inside the repo
    if [[ ! -x "${venv_dir}/bin/python" ]]; then
        echo "==> Creating Python virtual environment at .venv..."
        python3 -m venv "${venv_dir}" || {
            echo "ERROR: Failed to create Python virtual environment." >&2
            return 1
        }
    fi

    # Make .venv/bin/activate executable so even direct invocation has +x permissions,
    # and source it so the current shell (when sourced) has .venv/bin on PATH.
    chmod +x "${venv_dir}/bin/activate" 2>/dev/null || true
    # shellcheck disable=SC1091
    source "${venv_dir}/bin/activate"

    # 2. Load NVM if installed and node/corepack are not yet on PATH
    if ! command -v node >/dev/null 2>&1; then
        export NVM_DIR="${NVM_DIR:-${HOME}/.nvm}"
        if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
            # shellcheck disable=SC1091
            \. "${NVM_DIR}/nvm.sh"
        fi
    fi

    # Symlink node, npm, npx, and corepack into .venv/bin so activating .venv
    # provides both Python and Node/pnpm tools directly from the repo folder.
    local node_bin_dir=""
    if command -v node >/dev/null 2>&1; then
        node_bin_dir="$(dirname "$(command -v node)")"
        for tool in node npm npx corepack; do
            if [[ -x "${node_bin_dir}/${tool}" && ! -e "${venv_dir}/bin/${tool}" ]]; then
                ln -sf "${node_bin_dir}/${tool}" "${venv_dir}/bin/${tool}"
            fi
        done
    fi

    # 3. Enable pnpm directly inside .venv/bin via Corepack (no files outside repo)
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
    export COREPACK_HOME="${repo_root}/.cache/corepack"
    if [[ ! -x "${venv_dir}/bin/pnpm" ]]; then
        if command -v corepack >/dev/null 2>&1; then
            echo "==> Installing pnpm shim into .venv/bin via Corepack..."
            corepack enable --install-directory "${venv_dir}/bin" pnpm
        fi
    fi

    # 4. Install Python worker (including PyTorch GPU support) and validation dependencies into .venv
    echo "==> Installing Python worker and validation dependencies into .venv..."
    "${venv_dir}/bin/python" -m pip install --upgrade pip --quiet || return 1
    "${venv_dir}/bin/pip" install --quiet -e "${repo_root}/apps/worker[gpu]" mypy pytest ruff || return 1

    # 5. Install and build Node.js workspace dependencies via pnpm (using repo-local store)
    if [[ -x "${venv_dir}/bin/pnpm" && -f "${repo_root}/package.json" ]]; then
        echo "==> Installing Node.js workspace dependencies (pnpm install)..."
        (cd "${repo_root}" && "${venv_dir}/bin/pnpm" install --store-dir "${repo_root}/.pnpm-store") || return 1
        echo "==> Building TypeScript workspace packages (pnpm build)..."
        (cd "${repo_root}" && "${venv_dir}/bin/pnpm" build) || return 1
    else
        echo "WARNING: pnpm not available in .venv/bin; skipping Node.js workspace setup." >&2
    fi

    echo "==> Environment initialized successfully (all tools in .venv/bin)!"
    echo "    Python : $("${venv_dir}/bin/python" --version 2>&1) (${venv_dir}/bin/python)"
    if [[ -x "${venv_dir}/bin/pnpm" ]]; then
        echo "    pnpm   : $("${venv_dir}/bin/pnpm" --version 2>&1) (${venv_dir}/bin/pnpm)"
    fi

    if [[ "${is_sourced}" -eq 0 ]]; then
        echo ""
        echo "To activate the environment in your current terminal, run:"
        echo "    source .venv/bin/activate"
        echo "or:"
        echo "    source scripts/init_env.sh"
    fi
    return 0
}

_init_platform_env "$@"
