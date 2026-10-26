import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

export type EnvironmentName = 'staging' | 'production';
export type SyncStatus = 'Synced' | 'OutOfSync' | 'Progressing' | 'Degraded';
export type HealthStatus = 'Healthy' | 'Progressing' | 'Degraded' | 'Missing';
export type SyncPolicyType = 'automated' | 'manual';

export class GitOpsBypassProhibitedError extends ForbiddenError {
  constructor(
    detail = 'GitHub Actions and CI/CD must never bypass GitOps by applying imperative Kubernetes state directly to clusters'
  ) {
    super(detail, 'GITOPS_BYPASS_PROHIBITED');
  }
}

export class ProductionApprovalRequiredError extends ValidationError {
  constructor(
    detail = 'Production promotion requires explicit approver credentials and sign-off'
  ) {
    super(detail, undefined, 'PRODUCTION_APPROVAL_REQUIRED');
  }
}

export interface EnvironmentState {
  environment: EnvironmentName;
  target_cluster: string;
  namespace: string;
  current_revision: string;
  desired_revision: string;
  image_tag: string;
  sync_status: SyncStatus;
  health_status: HealthStatus;
  sync_policy: SyncPolicyType;
  approval_required: boolean;
  last_synced_at: string;
  last_promoted_by?: string;
}

export interface GitOpsStatus {
  status: 'healthy' | 'degraded';
  gitops_reconciler: string;
  github_oidc_role_arn: string;
  repository_url: string;
  app_of_apps: string;
  environments: Record<EnvironmentName, EnvironmentState>;
  bypass_policy: {
    direct_apply_prohibited: true;
    enforcement_rule: string;
  };
}

export interface PromotionRequest {
  environment: EnvironmentName;
  image_tag: string;
  target_revision?: string;
  approver?: string;
  approval_token?: string;
  direct_cluster_apply?: boolean;
}

export interface PromotionResult {
  promoted: boolean;
  environment: EnvironmentName;
  previous_image_tag: string;
  new_image_tag: string;
  approver?: string;
  promoted_at: string;
  gitops_commit_sha: string;
  argo_app_name: string;
  reconciliation_mode: 'automated-prune-self-heal' | 'manual-sync-window';
}

export class GitOpsController {
  private environments: Map<EnvironmentName, EnvironmentState>;
  private readonly githubOidcRoleArn: string;
  private readonly repositoryUrl: string;

  constructor(options?: {
    githubOidcRoleArn?: string;
    repositoryUrl?: string;
    initialEnvironments?: EnvironmentState[];
  }) {
    this.githubOidcRoleArn =
      options?.githubOidcRoleArn ??
      'arn:aws:iam::000000000000:role/inference-platform-github-oidc-deployer';
    this.repositoryUrl =
      options?.repositoryUrl ??
      'https://github.com/org/multi-tenant-AI-inference-platform.git';

    this.environments = new Map();
    const defaults: EnvironmentState[] = options?.initialEnvironments ?? [
      {
        environment: 'staging',
        target_cluster: 'https://kubernetes.default.svc',
        namespace: 'inference-platform',
        current_revision: 'HEAD',
        desired_revision: 'HEAD',
        image_tag: '0.10.0-staging',
        sync_status: 'Synced',
        health_status: 'Healthy',
        sync_policy: 'automated',
        approval_required: false,
        last_synced_at: new Date().toISOString(),
        last_promoted_by: 'ci-bot',
      },
      {
        environment: 'production',
        target_cluster: 'https://kubernetes.default.svc',
        namespace: 'inference-platform',
        current_revision: 'HEAD',
        desired_revision: 'HEAD',
        image_tag: '0.10.0',
        sync_status: 'Synced',
        health_status: 'Healthy',
        sync_policy: 'manual',
        approval_required: true,
        last_synced_at: new Date().toISOString(),
        last_promoted_by: 'lead-operator',
      },
    ];

    for (const env of defaults) {
      this.environments.set(env.environment, { ...env });
    }
  }

  public getStatus(): GitOpsStatus {
    const envObj = {} as Record<EnvironmentName, EnvironmentState>;
    for (const [key, val] of this.environments.entries()) {
      envObj[key] = { ...val };
    }

    return {
      status: 'healthy',
      gitops_reconciler: 'Argo CD v2.10',
      github_oidc_role_arn: this.githubOidcRoleArn,
      repository_url: this.repositoryUrl,
      app_of_apps: 'inference-platform-root-apps',
      environments: envObj,
      bypass_policy: {
        direct_apply_prohibited: true,
        enforcement_rule:
          'GitHub Actions never mutates Kubernetes directly. Declarative GitOps reconciliation exclusively via Argo CD.',
      },
    };
  }

  public getEnvironments(): EnvironmentState[] {
    return Array.from(this.environments.values()).map((e) => ({ ...e }));
  }

  public getEnvironment(name: EnvironmentName): EnvironmentState {
    const env = this.environments.get(name);
    if (!env) {
      throw new NotFoundError(`Environment '${name}' not found`, 'ENVIRONMENT_NOT_FOUND');
    }
    return { ...env };
  }

  public promoteEnvironment(request: PromotionRequest): PromotionResult {
    // 1. Enforce M10 Acceptance Criteria: Direct cluster apply / bypass is strictly prohibited
    if (request.direct_cluster_apply) {
      throw new GitOpsBypassProhibitedError(
        'Direct imperative cluster mutation rejected. Deployments must be declared in GitOps manifests.'
      );
    }

    const env = this.environments.get(request.environment);
    if (!env) {
      throw new NotFoundError(
        `Target environment '${request.environment}' not registered`,
        'ENVIRONMENT_NOT_FOUND'
      );
    }

    // 2. Enforce explicit approval for production promotions
    if (request.environment === 'production') {
      if (!request.approver || !request.approver.trim()) {
        throw new ProductionApprovalRequiredError(
          'Production promotion requires explicit approver username identification.'
        );
      }
      if (!request.approval_token || !request.approval_token.trim()) {
        throw new ProductionApprovalRequiredError(
          'Production promotion requires valid approval sign-off token.'
        );
      }
    }

    const previousTag = env.image_tag;
    const newTag = request.image_tag;
    const now = new Date().toISOString();
    const commitSha = `sha-${Math.random().toString(16).substring(2, 10)}`;

    env.image_tag = newTag;
    env.desired_revision = request.target_revision ?? 'HEAD';
    env.last_promoted_by = request.approver ?? 'ci-pipeline';
    env.last_synced_at = now;
    env.sync_status = request.environment === 'staging' ? 'Synced' : 'OutOfSync';

    return {
      promoted: true,
      environment: request.environment,
      previous_image_tag: previousTag,
      new_image_tag: newTag,
      approver: request.approver,
      promoted_at: now,
      gitops_commit_sha: commitSha,
      argo_app_name: `inference-platform-${request.environment}`,
      reconciliation_mode:
        request.environment === 'staging'
          ? 'automated-prune-self-heal'
          : 'manual-sync-window',
    };
  }

  public syncEnvironment(name: EnvironmentName): EnvironmentState {
    const env = this.environments.get(name);
    if (!env) {
      throw new NotFoundError(`Environment '${name}' not found`, 'ENVIRONMENT_NOT_FOUND');
    }

    env.current_revision = env.desired_revision;
    env.sync_status = 'Synced';
    env.health_status = 'Healthy';
    env.last_synced_at = new Date().toISOString();

    return { ...env };
  }
}

