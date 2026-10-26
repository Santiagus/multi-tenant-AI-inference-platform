import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  GitOpsController,
  GitOpsBypassProhibitedError,
  ProductionApprovalRequiredError,
} from '../../src/domain/gitops.js';
import { NotFoundError } from '../../src/domain/errors.js';

describe('GitOps Domain & Controller Unit Tests', () => {
  describe('Error Classes', () => {
    test('GitOpsBypassProhibitedError has default and custom messages', () => {
      const defaultErr = new GitOpsBypassProhibitedError();
      assert.equal(defaultErr.status, 403);
      assert.equal(defaultErr.code, 'GITOPS_BYPASS_PROHIBITED');
      assert.match(defaultErr.message, /must never bypass GitOps/);

      const customErr = new GitOpsBypassProhibitedError('Custom bypass error');
      assert.equal(customErr.message, 'Custom bypass error');
    });

    test('ProductionApprovalRequiredError has default and custom messages', () => {
      const defaultErr = new ProductionApprovalRequiredError();
      assert.equal(defaultErr.status, 400);
      assert.equal(defaultErr.code, 'PRODUCTION_APPROVAL_REQUIRED');
      assert.match(defaultErr.message, /explicit approver/);

      const customErr = new ProductionApprovalRequiredError('Custom approval message');
      assert.equal(customErr.message, 'Custom approval message');
    });
  });

  describe('GitOpsController Initialization & Status', () => {
    test('initializes with default settings and returns healthy status', () => {
      const controller = new GitOpsController();
      const status = controller.getStatus();

      assert.equal(status.status, 'healthy');
      assert.equal(status.gitops_reconciler, 'Argo CD v2.10');
      assert.match(status.github_oidc_role_arn, /github-oidc-deployer/);
      assert.match(status.repository_url, /multi-tenant-AI-inference-platform/);
      assert.equal(status.app_of_apps, 'inference-platform-root-apps');
      assert.equal(status.bypass_policy.direct_apply_prohibited, true);
      assert.ok(status.environments.staging);
      assert.ok(status.environments.production);
    });

    test('accepts custom initialization options', () => {
      const controller = new GitOpsController({
        githubOidcRoleArn: 'arn:aws:iam::123456789012:role/custom-oidc',
        repositoryUrl: 'https://github.com/custom/repo.git',
        initialEnvironments: [
          {
            environment: 'staging',
            target_cluster: 'https://k8s.custom.internal',
            namespace: 'custom-staging',
            current_revision: 'main',
            desired_revision: 'main',
            image_tag: '1.0.0-custom',
            sync_status: 'Synced',
            health_status: 'Healthy',
            sync_policy: 'automated',
            approval_required: false,
            last_synced_at: new Date().toISOString(),
          },
        ],
      });

      const status = controller.getStatus();
      assert.equal(status.github_oidc_role_arn, 'arn:aws:iam::123456789012:role/custom-oidc');
      assert.equal(status.repository_url, 'https://github.com/custom/repo.git');
      assert.equal(status.environments.staging.namespace, 'custom-staging');
      assert.equal(status.environments.staging.image_tag, '1.0.0-custom');
    });

    test('getEnvironments returns defensive copies of all environments', () => {
      const controller = new GitOpsController();
      const envs = controller.getEnvironments();
      assert.equal(envs.length, 2);

      envs[0].image_tag = 'mutated';
      const freshEnvs = controller.getEnvironments();
      assert.notEqual(freshEnvs[0].image_tag, 'mutated');
    });

    test('getEnvironment returns requested environment or throws NotFoundError', () => {
      const controller = new GitOpsController();
      const stg = controller.getEnvironment('staging');
      assert.equal(stg.environment, 'staging');
      assert.equal(stg.sync_policy, 'automated');

      const prod = controller.getEnvironment('production');
      assert.equal(prod.environment, 'production');
      assert.equal(prod.approval_required, true);

      assert.throws(
        () => controller.getEnvironment('nonexistent' as any),
        (err: any) => err instanceof NotFoundError && err.code === 'ENVIRONMENT_NOT_FOUND'
      );
    });
  });

  describe('GitOps Promotion & Invariant Enforcement', () => {
    test('enforces acceptance criteria: rejects direct_cluster_apply attempts', () => {
      const controller = new GitOpsController();
      assert.throws(
        () =>
          controller.promoteEnvironment({
            environment: 'staging',
            image_tag: 'v0.11.0',
            direct_cluster_apply: true,
          }),
        (err: any) => err instanceof GitOpsBypassProhibitedError && err.code === 'GITOPS_BYPASS_PROHIBITED'
      );
    });

    test('rejects promotion to unregistered environment', () => {
      const controller = new GitOpsController();
      assert.throws(
        () =>
          controller.promoteEnvironment({
            environment: 'unknown' as any,
            image_tag: 'v0.11.0',
          }),
        (err: any) => err instanceof NotFoundError && err.code === 'ENVIRONMENT_NOT_FOUND'
      );
    });

    test('promotes staging without requiring approver or token', () => {
      const controller = new GitOpsController();
      const result = controller.promoteEnvironment({
        environment: 'staging',
        image_tag: '0.10.1-staging',
        target_revision: 'release-0.10.1',
      });

      assert.equal(result.promoted, true);
      assert.equal(result.environment, 'staging');
      assert.equal(result.previous_image_tag, '0.10.0-staging');
      assert.equal(result.new_image_tag, '0.10.1-staging');
      assert.equal(result.reconciliation_mode, 'automated-prune-self-heal');
      assert.match(result.gitops_commit_sha, /^sha-/);

      const updated = controller.getEnvironment('staging');
      assert.equal(updated.image_tag, '0.10.1-staging');
      assert.equal(updated.desired_revision, 'release-0.10.1');
    });

    test('production promotion requires explicit approver identification', () => {
      const controller = new GitOpsController();
      assert.throws(
        () =>
          controller.promoteEnvironment({
            environment: 'production',
            image_tag: '0.10.1',
          }),
        (err: any) =>
          err instanceof ProductionApprovalRequiredError &&
          err.message.includes('explicit approver username')
      );

      assert.throws(
        () =>
          controller.promoteEnvironment({
            environment: 'production',
            image_tag: '0.10.1',
            approver: '   ',
          }),
        (err: any) =>
          err instanceof ProductionApprovalRequiredError &&
          err.message.includes('explicit approver username')
      );
    });

    test('production promotion requires valid approval sign-off token', () => {
      const controller = new GitOpsController();
      assert.throws(
        () =>
          controller.promoteEnvironment({
            environment: 'production',
            image_tag: '0.10.1',
            approver: 'lead-architect',
          }),
        (err: any) =>
          err instanceof ProductionApprovalRequiredError &&
          err.message.includes('approval sign-off token')
      );

      assert.throws(
        () =>
          controller.promoteEnvironment({
            environment: 'production',
            image_tag: '0.10.1',
            approver: 'lead-architect',
            approval_token: '   ',
          }),
        (err: any) =>
          err instanceof ProductionApprovalRequiredError &&
          err.message.includes('approval sign-off token')
      );
    });

    test('production promotion succeeds with valid approver and token', () => {
      const controller = new GitOpsController();
      const result = controller.promoteEnvironment({
        environment: 'production',
        image_tag: '0.10.1',
        approver: 'lead-architect',
        approval_token: 'sec-signoff-token-xyz',
      });

      assert.equal(result.promoted, true);
      assert.equal(result.environment, 'production');
      assert.equal(result.previous_image_tag, '0.10.0');
      assert.equal(result.new_image_tag, '0.10.1');
      assert.equal(result.approver, 'lead-architect');
      assert.equal(result.reconciliation_mode, 'manual-sync-window');
      assert.equal(result.argo_app_name, 'inference-platform-production');

      const updated = controller.getEnvironment('production');
      assert.equal(updated.image_tag, '0.10.1');
      assert.equal(updated.last_promoted_by, 'lead-architect');
      assert.equal(updated.sync_status, 'OutOfSync');
    });

    test('syncEnvironment reconciles revision and marks Synced and Healthy', () => {
      const controller = new GitOpsController();
      controller.promoteEnvironment({
        environment: 'production',
        image_tag: '0.10.1',
        target_revision: 'tag-v0.10.1',
        approver: 'lead-architect',
        approval_token: 'token-abc',
      });

      const synced = controller.syncEnvironment('production');
      assert.equal(synced.sync_status, 'Synced');
      assert.equal(synced.health_status, 'Healthy');
      assert.equal(synced.current_revision, 'tag-v0.10.1');

      assert.throws(
        () => controller.syncEnvironment('nonexistent' as any),
        (err: any) => err instanceof NotFoundError
      );
    });
  });
});

