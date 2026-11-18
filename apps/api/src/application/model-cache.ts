import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const VENV_PYTHON = path.resolve(REPO_ROOT, '.venv/bin/python');

export type ModelCacheEntry = {
  model_id: string;
  hub_id: string;
  cached: boolean;
  size_bytes: number;
  files?: number;
  revision?: string | null;
  path?: string | null;
  proprietary?: boolean;
};

export type ModelCacheListResponse = {
  ok: boolean;
  cache_root: string;
  cached_repo_count: number;
  catalog_cached_count: number;
  models: ModelCacheEntry[];
};

export type ModelDownloadStatus = {
  model_id: string;
  hub_id: string;
  status: 'idle' | 'queued' | 'downloading' | 'ready' | 'error' | 'cancelled';
  percent: number;
  message: string;
  bytes_cached?: number | null;
  bytes_total?: number | null;
  error?: string | null;
  updated_at: string;
};

function resolvePythonBin(): string {
  if (process.env.PYTHON_BIN && process.env.PYTHON_BIN.trim().length > 0) {
    return process.env.PYTHON_BIN;
  }
  if (fs.existsSync(VENV_PYTHON)) {
    return VENV_PYTHON;
  }
  return 'python3';
}

type RunPythonResult = {
  stdout: string;
  stderr: string;
  code: number;
  signal: NodeJS.Signals | null;
};

type ActiveDownload = {
  child: ChildProcess;
};

const downloadState = new Map<string, ModelDownloadStatus>();
const inFlight = new Map<string, Promise<void>>();
const activeDownloads = new Map<string, ActiveDownload>();
const cancelRequested = new Set<string>();

function nowIso(): string {
  return new Date().toISOString();
}

function setState(
  modelId: string,
  patch: Partial<ModelDownloadStatus> & Pick<ModelDownloadStatus, 'status'>
): ModelDownloadStatus {
  const prev = downloadState.get(modelId);
  const next: ModelDownloadStatus = {
    model_id: modelId,
    hub_id: prev?.hub_id ?? modelId,
    status: patch.status,
    percent: patch.percent ?? prev?.percent ?? 0,
    message: patch.message ?? prev?.message ?? '',
    bytes_cached: patch.bytes_cached ?? prev?.bytes_cached ?? null,
    bytes_total: patch.bytes_total ?? prev?.bytes_total ?? null,
    error: patch.error ?? null,
    updated_at: nowIso(),
    ...('hub_id' in patch && patch.hub_id ? { hub_id: patch.hub_id } : {}),
  };
  downloadState.set(modelId, next);
  return next;
}

function runPythonJson(
  args: string[],
  options?: {
    trackModelId?: string;
    onProgressLine?: (line: string) => void;
  }
): Promise<RunPythonResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolvePythonBin(), ['-m', 'apps.worker.model_cache', ...args], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PYTHONPATH: REPO_ROOT,
        PYTHONUNBUFFERED: '1',
      },
    });

    const trackId = options?.trackModelId?.trim();
    if (trackId) {
      activeDownloads.set(trackId, { child });
    }

    let stdout = '';
    let stderr = '';
    let errBuf = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      errBuf += text;
      const lines = errBuf.split('\n');
      errBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.includes('[MODEL_CACHE_PROGRESS]') && options?.onProgressLine) {
          options.onProgressLine(line.split('[MODEL_CACHE_PROGRESS]')[1]?.trim() ?? '');
        }
      }
    });
    child.on('error', (err) => {
      if (trackId) activeDownloads.delete(trackId);
      reject(err);
    });
    child.on('close', (code, signal) => {
      if (trackId) activeDownloads.delete(trackId);
      resolve({ stdout, stderr, code: code ?? 1, signal });
    });
  });
}

export function getModelDownloadStatus(modelId: string): ModelDownloadStatus {
  return (
    downloadState.get(modelId) ?? {
      model_id: modelId,
      hub_id: modelId,
      status: 'idle',
      percent: 0,
      message: 'No download requested',
      bytes_cached: null,
      bytes_total: null,
      error: null,
      updated_at: nowIso(),
    }
  );
}

export function listModelDownloadStatuses(): ModelDownloadStatus[] {
  return Array.from(downloadState.values()).sort((a, b) => a.model_id.localeCompare(b.model_id));
}

export async function listModelCache(modelIds: string[]): Promise<ModelCacheListResponse> {
  const unique = Array.from(new Set(modelIds.map((m) => m.trim()).filter(Boolean)));
  if (unique.length === 0) {
    return {
      ok: true,
      cache_root: '',
      cached_repo_count: 0,
      catalog_cached_count: 0,
      models: [],
    };
  }
  const { stdout, code, stderr } = await runPythonJson(['list', '--models', unique.join(',')]);
  if (code !== 0) {
    throw new Error(`model_cache list failed (exit ${code}): ${stderr || stdout}`);
  }
  const parsed = JSON.parse(stdout.trim()) as ModelCacheListResponse;
  for (const m of parsed.models) {
    if (m.cached) {
      setState(m.model_id, {
        status: 'ready',
        hub_id: m.hub_id,
        percent: 100,
        message: 'Present in local Hugging Face cache',
        bytes_cached: m.size_bytes,
        bytes_total: m.size_bytes,
        error: null,
      });
    }
  }
  return parsed;
}

function killActiveChild(modelId: string): boolean {
  cancelRequested.add(modelId);
  const active = activeDownloads.get(modelId);
  if (!active) return false;
  try {
    active.child.kill('SIGTERM');
  } catch {
    // already exited
  }
  const killer = setTimeout(() => {
    try {
      if (!active.child.killed) active.child.kill('SIGKILL');
    } catch {
      // ignore
    }
  }, 2500);
  active.child.once('close', () => clearTimeout(killer));
  return true;
}

/** Queue a Hub download without waiting for completion (dashboard polls status). */
export function startModelCacheEnsure(modelId: string): ModelDownloadStatus {
  const id = modelId.trim();
  if (!id) {
    throw new Error('model_id is required');
  }

  if (inFlight.has(id)) {
    return getModelDownloadStatus(id);
  }

  cancelRequested.delete(id);
  setState(id, {
    status: 'queued',
    percent: 0,
    message: 'Download queued',
    error: null,
  });

  const task = (async () => {
    if (cancelRequested.has(id)) {
      await runPythonJson(['purge-incomplete', '--model', id]).catch(() => undefined);
      cancelRequested.delete(id);
      setState(id, {
        status: 'cancelled',
        percent: 0,
        message: 'Download cancelled before start — incomplete blobs removed',
        error: null,
      });
      return;
    }
    setState(id, { status: 'downloading', percent: 1, message: 'Starting Hugging Face download' });
    const { stdout, code, stderr, signal } = await runPythonJson(['ensure', '--model', id], {
      trackModelId: id,
      onProgressLine: (jsonLine) => {
        try {
          if (cancelRequested.has(id)) return;
          const prog = JSON.parse(jsonLine) as Record<string, unknown>;
          setState(id, {
            status: String(prog.status ?? 'downloading') as ModelDownloadStatus['status'],
            hub_id: typeof prog.hub_id === 'string' ? prog.hub_id : id,
            percent: Number(prog.percent ?? 0),
            message: String(prog.message ?? 'Downloading'),
            bytes_cached: prog.bytes_cached === undefined ? null : Number(prog.bytes_cached),
            bytes_total:
              prog.bytes_total === undefined || prog.bytes_total === null
                ? null
                : Number(prog.bytes_total),
            error: prog.status === 'error' ? String(prog.message ?? 'Download failed') : null,
          });
        } catch {
          // ignore malformed progress
        }
      },
    });

    const cancelled =
      cancelRequested.has(id) ||
      signal === 'SIGTERM' ||
      signal === 'SIGKILL' ||
      getModelDownloadStatus(id).status === 'cancelled';
    cancelRequested.delete(id);

    if (cancelled) {
      // Best-effort: drop incomplete Hub blobs so a retry does not resume a 200GB+ pull.
      await runPythonJson(['purge-incomplete', '--model', id]).catch(() => undefined);
      setState(id, {
        status: 'cancelled',
        percent: Number(getModelDownloadStatus(id).percent || 0),
        message: 'Download cancelled — incomplete blobs removed',
        error: null,
      });
      return;
    }

    let result: Record<string, unknown> = {};
    try {
      result = JSON.parse(stdout.trim()) as Record<string, unknown>;
    } catch {
      result = { ok: false, error: stderr || stdout || 'Invalid ensure response' };
    }

    if (code !== 0 || result.ok === false) {
      setState(id, {
        status: 'error',
        percent: Number(getModelDownloadStatus(id).percent || 0),
        message: String(result.error ?? stderr ?? 'Download failed'),
        error: String(result.error ?? stderr ?? 'Download failed'),
        hub_id: typeof result.hub_id === 'string' ? result.hub_id : id,
      });
      return;
    }

    setState(id, {
      status: 'ready',
      percent: 100,
      message: result.download ? 'Download complete' : 'Already cached',
      hub_id: typeof result.hub_id === 'string' ? result.hub_id : id,
      bytes_cached: typeof result.size_bytes === 'number' ? result.size_bytes : null,
      bytes_total: typeof result.size_bytes === 'number' ? result.size_bytes : null,
      error: null,
    });
  })();

  inFlight.set(
    id,
    task.finally(() => {
      inFlight.delete(id);
    })
  );
  return getModelDownloadStatus(id);
}

/** Cancel an in-flight Hub download and purge incomplete blobs. */
export function cancelModelCacheEnsure(modelId: string): ModelDownloadStatus {
  const id = modelId.trim();
  if (!id) {
    throw new Error('model_id is required');
  }

  const hadChild = killActiveChild(id);
  setState(id, {
    status: 'cancelled',
    percent: Number(getModelDownloadStatus(id).percent || 0),
    message: hadChild
      ? 'Cancelling download…'
      : 'No active download process — marking cancelled and purging incomplete blobs',
    error: null,
  });

  // Always attempt incomplete purge (covers API-restart orphans).
  void runPythonJson(['purge-incomplete', '--model', id])
    .then(() => {
      if (getModelDownloadStatus(id).status === 'cancelled') {
        setState(id, {
          status: 'cancelled',
          message: 'Download cancelled — incomplete blobs removed',
          error: null,
        });
      }
    })
    .catch(() => undefined);

  return getModelDownloadStatus(id);
}

/** Await a full ensure (tests / synchronous callers). */
export async function ensureModelCached(modelId: string): Promise<ModelDownloadStatus> {
  startModelCacheEnsure(modelId);
  const flight = inFlight.get(modelId.trim());
  if (flight) await flight;
  return getModelDownloadStatus(modelId.trim());
}
