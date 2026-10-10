# Contributing to Multi-Tenant AI Inference Platform

Thank you for contributing to the Multi-Tenant AI Inference Platform. This repository is engineered for architectural rigor, measurable performance, reproducible deployment, and strict tenant isolation.

---

## Operating Principles

Before contributing, please review [AGENTS.md](AGENTS.md) and the milestone guidelines:
- **Evidence Over Claims**: Every claimed capability must be validated through automated tests, benchmarks, or reproducible artifacts. Never fabricate metrics.
- **Provider-Agnostic Core**: Keep business contracts independent of proprietary cloud providers.
- **Local-First, Cloud-Verifiable**: Core capabilities must run locally without requiring paid cloud infrastructure or proprietary emulators.
- **Milestone Scoping**: Changes should map to the active milestone without pre-empting future milestones.

---

## Development Environment / Editor Setup

### Recommended Extensions
When opening this repository in Visual Studio Code, you will be prompted to install recommended workspace extensions defined in [`.vscode/extensions.json`](.vscode/extensions.json). These include:
- **Python / PyTorch**: Python (`ms-python.python`), Pylance (`ms-python.vscode-pylance`), Ruff (`charliermarsh.ruff`), and Mypy (`ms-python.mypy-type-checker`).
- **TypeScript / Frontend**: ESLint (`dbaeumer.vscode-eslint`).
- **Infrastructure / Containers**: Docker (`ms-azuretools.vscode-docker`), Kubernetes (`ms-kubernetes-tools.vscode-kubernetes-tools`), and Terraform (`hashicorp.terraform`).
- **Data & Config**: YAML (`redhat.vscode-yaml`), Even Better TOML (`tamasfe.even-better-toml`), REST Client (`humao.rest-client`), and Database Client (`cweijan.vscode-database-client2`).

### System Prerequisites
To run the local platform and verification gates, ensure the following are available on your workstation:
- **Make**: Standard build automation tool (`/usr/bin/make`).
- **Node.js 22+ & pnpm 12+**: Control plane API runtime and workspace package manager.
- **Python 3.11+**: Base runtime for scripts and inference tooling.
- **Docker & Docker Compose**: Local platform runtime (PostgreSQL 16, MinIO, ElasticMQ).
- **Gitleaks**: Fast secret scanner for pre-commit verification ([Installation guide](https://github.com/gitleaks/gitleaks)).

---

## Git Workflow & Commits

### Branch Naming
Create focused branches scoped to the task or milestone:
- Milestones: `m<XX>-<short-description>` (e.g., `m00-github-foundation`)
- Features / Fixes: `feat/<description>`, `fix/<description>`

### Commit Messages
We follow the [Conventional Commits](https://www.conventionalcommits.org/) standard, referencing the milestone in the scope where applicable (refer to [`.gitmessage`](.gitmessage)):

```text
<type>(mXX): <imperative-summary>

[optional body explaining motivation and design decisions]

[optional footer(s)]
```

Examples:
- `feat(m00): add local CI validation gate and secret scanning`
- `docs(m00): update contributing guide and editor setup`

---

## Local Verification Gate

Before committing code or submitting a pull request, run the local CI gate:

```bash
# Run all local checks (formatting, linting, tests, secrets/PII, handoff)
make ci
```

Individual checks can be run on demand:
- `make format-check`: Validate code and markdown formatting.
- `make lint`: Run code linters.
- `make test`: Execute automated test suites.
- `make scan`: Execute secret and sensitive data scanning (Gitleaks + PII scan).
- `make handoff-check`: Verify milestone handoff protocol integrity.
- `make validate-mermaid`: Validate syntax and theme directives of Mermaid diagrams in Markdown docs.

---

## Documentation & Architecture Diagrams (Mermaid)

When creating or modifying architectural and workflow diagrams in documentation:
- **Engine**: Use GitHub-native fenced ```` ```mermaid ```` blocks.
- **Theme Directive**: Always specify `%%{init: {'theme': 'dark'}}%%` on the very first line of each diagram block to ensure consistent contrast and readability across dark and light GitHub themes.
- **Supported Types**: Flowcharts (`graph TD` / `flowchart TD`), sequence diagrams (`sequenceDiagram`), state diagrams (`stateDiagram-v2`), and class diagrams (`classDiagram`).
- **Arrow Syntax**: Flowchart connections must use valid Mermaid arrow syntax (`-->`, `-.->`, `==>`), never single dashes (`->`).
- **Automated Validation**: Run `make validate-mermaid` (or `make lint`) to verify syntax and formatting before committing.

---

## Milestone Lifecycle & Handoff Integrity

Every milestone follows a strict lifecycle documented in [`.agents/README.md`](.agents/README.md):
1. **In-Progress**: Marked with `in-progress` in [`.agents/README.md`](.agents/README.md) and requires a `## Progress` checklist (≤10 items) in the milestone file.
2. **Done**: Must not contain `_Pending._`, must delete `## Progress`, and must replace `## Outcome` with ≤10 concise lines summarizing deliverables and references.
3. The automated handoff check (`make handoff-check`) enforces these rules across all milestones.

---

## Security & Secrets

Never commit secrets, tokens, API keys, credentials, or private personal data (PII). All configuration must use placeholders and documented environment injection. Review [SECURITY.md](SECURITY.md) for details.

