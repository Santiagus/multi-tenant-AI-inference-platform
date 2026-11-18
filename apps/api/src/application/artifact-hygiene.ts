import type { Job } from '../domain/job.js';
import type { IStorageClient } from '../infrastructure/storage/storage-client.js';
import { getJobOutputModality } from './job-worker.js';

export type ArtifactKindFlag = 'json' | 'image' | 'video';

export function resolveArtifactFlags(job: Pick<Job, 'outputUri' | 'modelId'>): {
  has_artifacts: boolean;
  artifact_kind: ArtifactKindFlag | null;
} {
  if (!job.outputUri) {
    return { has_artifacts: false, artifact_kind: null };
  }
  const modality = getJobOutputModality(job.modelId);
  const artifact_kind: ArtifactKindFlag =
    modality === 'image' ? 'image' : modality === 'video' ? 'video' : 'json';
  return { has_artifacts: true, artifact_kind };
}

/** Extract distinct job-id folder names under tenants/{tenantId}/outputs/{jobId}/... */
export function extractOutputJobIdsFromKeys(tenantId: string, keys: string[]): string[] {
  const prefix = `tenants/${tenantId}/outputs/`;
  const ids = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const jobId = rest.split('/')[0];
    if (jobId) ids.add(jobId);
  }
  return Array.from(ids).sort();
}

export async function deleteJobArtifactPrefixes(
  storage: IStorageClient,
  jobs: Array<Pick<Job, 'id' | 'tenantId' | 'inputUri'>>
): Promise<number> {
  let deletedObjects = 0;
  for (const job of jobs) {
    deletedObjects += await storage.deleteByPrefix(`tenants/${job.tenantId}/outputs/${job.id}/`);
    if (job.inputUri?.startsWith('s3://')) {
      const key = job.inputUri.replace(/^s3:\/\/[^/]+\//, '');
      // Only delete tenant-scoped input keys for this job folder when path encodes the job id,
      // otherwise leave shared inputs alone. Prefer exact key delete via prefix of dirname.
      if (key.includes(`/inputs/`) && key.includes(job.id)) {
        const dir = key.includes('/') ? key.slice(0, key.lastIndexOf('/') + 1) : key;
        deletedObjects += await storage.deleteByPrefix(dir);
      }
    }
  }
  return deletedObjects;
}

export async function findOrphanOutputPrefixes(
  storage: IStorageClient,
  tenantId: string,
  knownJobIds: Set<string> | string[]
): Promise<string[]> {
  const known = knownJobIds instanceof Set ? knownJobIds : new Set(knownJobIds);
  const keys = await storage.listKeysByPrefix(`tenants/${tenantId}/outputs/`);
  const folderIds = extractOutputJobIdsFromKeys(tenantId, keys);
  return folderIds
    .filter((id) => !known.has(id))
    .map((id) => `tenants/${tenantId}/outputs/${id}/`);
}

export async function purgeOrphanOutputPrefixes(
  storage: IStorageClient,
  orphanPrefixes: string[]
): Promise<number> {
  let deleted = 0;
  for (const prefix of orphanPrefixes) {
    deleted += await storage.deleteByPrefix(prefix);
  }
  return deleted;
}
