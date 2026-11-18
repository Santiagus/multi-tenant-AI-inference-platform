import { useState, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { apiClient } from '../../api/client';
import type {
  RoutingPreference,
  ModelCloudOptionsResponse,
  CloudOption,
  GpuPricingItem,
  ModelCacheEntry,
  ModelDownloadStatus,
} from '../../types';
import {
  POPULAR_MODELS,
  defaultPromptForPurpose,
  defaultPromptForModel,
  maybeSwapDefaultPrompt,
  resolveModelPurpose,
  providerToRoutingPreference,
  resolveSpotPolicy,
  isInterruptiblePlacement,
  resolveBidMode,
  isBidEditable,
  filterGpusForModel,
  uniqueSorted,
  estimatePromptTokens,
  forecastJobCostTime,
  buildPlacementParameters,
  matchGpuFromPrefill,
  EXECUTION_ENGINES,
  ENGINE_TOOLTIPS,
  DEFAULT_INFERENCE_PARAMS,
  INFERENCE_PARAM_TOOLTIPS,
  isEngineSoftDisabled,
  buildInferenceParameters,
  supportsLocalProductionWeights,
  formatModelOptionLabel,
  formatModelCacheLabel,
  formatModelDiskCacheNote,
  formatBytes,
  findPopularModel,
  promptTipsForModel,
  paramSectionsForPurpose,
  inferenceDefaultsForModel,
  preferredModelForPurpose,
  fitsLocalVramBudget,
  LOCAL_VRAM_BUDGET_GB,
  predictVramPlacement,
  formatVramPlacement,
  normalizeUploadContentType,
  compatibleRoutingPreferences,
  ensureCompatibleRouting,
  dispatchRoutingForCloudOption,
  deviceInferHint,
  ROUTING_STRATEGY_OPTIONS,
  type SubmitJobPrefill,
  type BidMode,
  type InferenceParamFormState,
  type ExecutionEngineId,
} from './submitJobHelpers';
export type SubmitJobPayload = {
  model_id: string;
  routing_preference: RoutingPreference;
  priority: number;
  max_retries: number;
  expires_in_seconds?: number;
  input_uri?: string;
  input: {
    prompt: string;
    parameters?: Record<string, unknown>;
  };
};

interface SubmitJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId?: string;
  initialPrefill?: SubmitJobPrefill | null;
  onPrefillConsumed?: () => void;
  onSubmit: (payload: SubmitJobPayload) => Promise<void>;
  /** Current API worker gate from /healthz (mock vs real subprocess). */
  apiInferenceMode?: 'mock' | 'real';
  /** Flip API worker execution mode via POST /v1/worker/inference-mode. */
  onEnsureInferenceMode?: (mode: 'mock' | 'real') => Promise<void>;
}

function FieldLabel({
  children,
  tip,
}: {
  children: ReactNode;
  tip: string;
}) {
  return (
    <label
      title={tip}
      style={{
        display: 'block',
        fontSize: '11px',
        color: '#94a3b8',
        marginBottom: '4px',
        fontWeight: 600,
        cursor: 'help',
        borderBottom: '1px dotted #64748b',
        width: 'fit-content',
      }}
    >
      {children}
    </label>
  );
}

/**
 * AUTO executes on the local worker. Only a local FinOps option may badge as AUTO-match;
 * cloud "recommended" tips must not look like the live execution target.
 */
export function resolveAutoMatchOption(
  recommendations: ModelCloudOptionsResponse | null
): CloudOption | null {
  const recommended = recommendations?.recommendations?.recommended || null;
  if (!recommended) return null;
  const provider = recommended.provider.toLowerCase().replace(/-/g, '_');
  if (provider === 'local' || provider === 'local_pytorch') return recommended;
  const local =
    recommendations?.allOptions.find((o) => {
      const p = o.provider.toLowerCase().replace(/-/g, '_');
      return p === 'local' || p === 'local_pytorch';
    }) || null;
  return local;
}

export function formatAutoDropdownLabel(autoProposal: CloudOption | null): string {
  // Never imply a cloud SKU will run under auto — worker falls back to local_pytorch.
  if (autoProposal) {
    return `auto (local engine · FinOps tip: ${autoProposal.displayName})`;
  }
  return 'auto (local engine; device inferred)';
}

export function isOptionAutoMatch(
  _key: string,
  itemId: string,
  autoProposalId?: string
): boolean {
  return Boolean(autoProposalId) && itemId === autoProposalId;
}

const selectStyle: CSSProperties = {
  width: '100%',
  backgroundColor: '#1e293b',
  color: '#f8fafc',
  border: '1px solid #334155',
  padding: '8px 12px',
  borderRadius: '8px',
  fontSize: '13px',
  outline: 'none',
};

export function SubmitJobModal({
  isOpen,
  onClose,
  onSubmit,
  tenantId = 'tenant-default',
  initialPrefill,
  onPrefillConsumed,
  apiInferenceMode = 'mock',
  onEnsureInferenceMode,
}: SubmitJobModalProps) {
  const [purposeFilter, setPurposeFilter] = useState<string>('all');
  const [modelId, setModelId] = useState(POPULAR_MODELS[0].id);
  const [customModel, setCustomModel] = useState('');
  const [prompt, setPrompt] = useState(defaultPromptForPurpose('text_to_text'));
  const [routingPreference, setRoutingPreference] = useState<RoutingPreference>('auto');
  const [routingBeforeMock, setRoutingBeforeMock] = useState<RoutingPreference>('auto');
  const [inferenceExecution, setInferenceExecution] = useState<'real' | 'mock'>(apiInferenceMode);
  const [useProductionWeights, setUseProductionWeights] = useState<boolean>(apiInferenceMode === 'real');
  const [inferenceParams, setInferenceParams] = useState<InferenceParamFormState>(DEFAULT_INFERENCE_PARAMS);
  const [priority, setPriority] = useState(5);
  const [maxRetries, setMaxRetries] = useState(3);
  const [modeSwitchError, setModeSwitchError] = useState<string | null>(null);

  const isMockInference = inferenceExecution === 'mock';
  const apiGateMismatch = !isMockInference && apiInferenceMode === 'mock';

  const patchInference = (patch: Partial<InferenceParamFormState>) => {
    setInferenceParams((prev) => ({ ...prev, ...patch }));
  };

  const handleInferenceExecutionChange = async (mode: 'real' | 'mock') => {
    setModeSwitchError(null);
    setInferenceExecution(mode);
    if (mode === 'mock') {
      if (routingPreference !== 'mock') {
        setRoutingBeforeMock(routingPreference);
      }
      setRoutingPreference('mock');
      setLockAutoRouting(false);
      setSelectedOptionId(null);
      setUseProductionWeights(false);
      patchInference({ engine: 'auto' });
    } else {
      const restored = routingBeforeMock === 'mock' ? 'auto' : routingBeforeMock;
      setRoutingPreference(restored);
      setLockAutoRouting(restored === 'auto');
      setUseProductionWeights(true);
      const proposal = resolveAutoMatchOption(recommendations);
      if (restored === 'auto' && proposal) {
        setSelectedOptionId(proposal.id);
      }
    }
    if (onEnsureInferenceMode) {
      try {
        await onEnsureInferenceMode(mode);
      } catch (err: any) {
        setModeSwitchError(
          err?.message ||
            `Could not set API worker to ${mode}. Jobs may still run as mock while MOCK_PROVIDERS=1.`
        );
      }
    }
  };
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelCacheById, setModelCacheById] = useState<Record<string, ModelCacheEntry>>({});
  const [modelDownload, setModelDownload] = useState<ModelDownloadStatus | null>(null);
  const [isEnsuringModel, setIsEnsuringModel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [recommendations, setRecommendations] = useState<ModelCloudOptionsResponse | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);

  const [gpuCatalog, setGpuCatalog] = useState<GpuPricingItem[]>([]);
  const [localGpuProbe, setLocalGpuProbe] = useState<{
    available: boolean;
    device_name: string | null;
    total_vram_gb: number | null;
    free_vram_gb: number | null;
  } | null>(null);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [isRefreshingPrice, setIsRefreshingPrice] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [selectedPricingModel, setSelectedPricingModel] = useState<string>('');
  const [selectedGpuId, setSelectedGpuId] = useState<string>('');
  const [bidUsdPerHour, setBidUsdPerHour] = useState<number>(0);
  const [bidMode, setBidMode] = useState<BidMode>('fixed');
  const [lockAutoRouting, setLockAutoRouting] = useState(true);

  const appliedPrefillRef = useRef<SubmitJobPrefill | null>(null);

  const finalModel = customModel.trim() || modelId;
  const catalogModel = findPopularModel(customModel.trim() ? finalModel : modelId);
  const canUseLocalProductionWeights = supportsLocalProductionWeights(finalModel);
  const effectivePurpose =
    catalogModel?.purpose ||
    (purposeFilter !== 'all' ? purposeFilter : resolveModelPurpose(modelId, purposeFilter));
  const paramSections = paramSectionsForPurpose(effectivePurpose);

  useEffect(() => {
    if (!isOpen) return;
    setInferenceExecution(apiInferenceMode);
    setUseProductionWeights(apiInferenceMode === 'real');
    setModeSwitchError(null);
    if (apiInferenceMode === 'mock') {
      setRoutingPreference((prev) => {
        if (prev !== 'mock') setRoutingBeforeMock(prev);
        return 'mock';
      });
    }
    // Sync once when the modal opens to the live API worker gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional open-only sync
  }, [isOpen]);

  useEffect(() => {
    const soft = isEngineSoftDisabled(inferenceParams.engine, effectivePurpose, routingPreference);
    if (soft.disabled) {
      patchInference({ engine: 'auto' });
    }
  }, [effectivePurpose, routingPreference, inferenceParams.engine]);

  const filteredPopularModels = POPULAR_MODELS.filter((m) => {
    if (purposeFilter !== 'all' && m.purpose !== purposeFilter) return false;
    return true;
  });

  const eligibleGpus = useMemo(
    () => filterGpusForModel(gpuCatalog, finalModel),
    [gpuCatalog, finalModel]
  );

  const providers = useMemo(
    () => uniqueSorted(eligibleGpus.map((g) => g.provider)),
    [eligibleGpus]
  );

  const placementsForProvider = useMemo(
    () =>
      uniqueSorted(
        eligibleGpus
          .filter((g) => g.provider === selectedProvider)
          .map((g) => g.pricingModel)
      ),
    [eligibleGpus, selectedProvider]
  );

  const skusForSelection = useMemo(
    () =>
      eligibleGpus.filter(
        (g) =>
          g.provider === selectedProvider && g.pricingModel === selectedPricingModel
      ),
    [eligibleGpus, selectedProvider, selectedPricingModel]
  );

  const selectedGpu =
    skusForSelection.find((g) => g.id === selectedGpuId) || skusForSelection[0] || null;

  const isLocalPlacement =
    !!selectedGpu &&
    (selectedGpu.provider === 'local' ||
      selectedGpu.provider === 'local_pytorch' ||
      selectedGpu.provider.toLowerCase().replace(/-/g, '_') === 'local' ||
      selectedGpu.provider.toLowerCase().replace(/-/g, '_') === 'local_pytorch');

  const effectiveLocalVramGb = useMemo(() => {
    if (!isLocalPlacement) return null;
    if (localGpuProbe?.available && localGpuProbe.total_vram_gb != null) {
      return localGpuProbe.total_vram_gb;
    }
    if (selectedGpu?.vramGb && selectedGpu.vramGb > 0) return selectedGpu.vramGb;
    return LOCAL_VRAM_BUDGET_GB;
  }, [isLocalPlacement, localGpuProbe, selectedGpu]);

  const localVramPlacement = useMemo(() => {
    if (!catalogModel || !isLocalPlacement) return null;
    return predictVramPlacement(catalogModel, effectiveLocalVramGb);
  }, [catalogModel, isLocalPlacement, effectiveLocalVramGb]);

  const spotPolicy = selectedProvider ? resolveSpotPolicy(selectedProvider) : undefined;
  const interruptible = selectedGpu
    ? isInterruptiblePlacement(selectedGpu.pricingModel, spotPolicy)
    : false;

  const forecast = useMemo(() => {
    if (!selectedGpu) return null;
    return forecastJobCostTime({
      gpu: selectedGpu,
      bidUsdPerHour:
        selectedGpu.provider === 'local' || selectedGpu.provider === 'local_pytorch'
          ? 0
          : bidUsdPerHour,
      maxNewTokens: inferenceParams.maxNewTokens,
      promptTokens: estimatePromptTokens(prompt),
      coldStartSec: selectedGpu.pricingModel === 'serverless' ? 8 : 0.08,
    });
  }, [selectedGpu, bidUsdPerHour, inferenceParams.maxNewTokens, prompt]);

  const applyGpuSelection = (gpu: GpuPricingItem, keepAuto?: boolean) => {
    setSelectedProvider(gpu.provider);
    setSelectedPricingModel(gpu.pricingModel);
    setSelectedGpuId(gpu.id);
    const policy = resolveSpotPolicy(gpu.provider);
    const mode = resolveBidMode(gpu.pricingModel, policy);
    setBidMode(mode);
    setBidUsdPerHour(Number(gpu.normalizedHourlyUsd.toFixed(4)));
    if (keepAuto) {
      // Keep auto only for local placement — cloud SKUs must bind a concrete dispatch pref.
      const isLocal =
        gpu.provider.toLowerCase().replace(/-/g, '_') === 'local' ||
        gpu.provider.toLowerCase().replace(/-/g, '_') === 'local_pytorch';
      if (isLocal) {
        setLockAutoRouting(true);
        setRoutingPreference('auto');
        patchInference({ device: '' });
        return;
      }
    }
    setLockAutoRouting(false);
    const nextRouting = providerToRoutingPreference(gpu.provider);
    setRoutingPreference(nextRouting);
    patchInference({ device: '' });
  };

  // Load GPU catalog when modal opens
  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    setIsLoadingCatalog(true);
    apiClient
      .getGpuPricing()
      .then((res) => {
        if (mounted) setGpuCatalog(res.data || []);
      })
      .catch((err) => {
        console.error('Failed to load GPU catalog for submit:', err);
      })
      .finally(() => {
        if (mounted) setIsLoadingCatalog(false);
      });
    return () => {
      mounted = false;
    };
  }, [isOpen]);

  // Recommendations with live token estimates
  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    const promptTokens = estimatePromptTokens(prompt) || 128;
    setIsLoadingRecs(true);

    apiClient
      .getCloudRecommendations({
        model_id: finalModel,
        prompt_tokens: promptTokens,
        max_new_tokens: inferenceParams.maxNewTokens,
      })
      .then((res) => {
        if (isMounted) {
          setRecommendations(res);
          if (lockAutoRouting) {
            // Only highlight a local AUTO-match — never a cloud FinOps tip.
            const localMatch = resolveAutoMatchOption(res);
            setSelectedOptionId(localMatch?.id ?? null);
          }
        }
      })
      .catch((err) => {
        console.error('Failed to load cloud recommendations:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoadingRecs(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, finalModel, inferenceParams.maxNewTokens, prompt, lockAutoRouting]);

  // Seed provider cascade when catalog / model changes (unless prefill pending)
  useEffect(() => {
    if (!isOpen || eligibleGpus.length === 0) return;
    if (initialPrefill && appliedPrefillRef.current !== initialPrefill) return;

    if (selectedGpuId && eligibleGpus.some((g) => g.id === selectedGpuId)) return;

    const preferred =
      eligibleGpus.find((g) => g.provider === 'local' || g.provider === 'local_pytorch') ||
      eligibleGpus[0];
    if (preferred) {
      applyGpuSelection(preferred, lockAutoRouting);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, eligibleGpus, initialPrefill]);

  // Apply pricing handoff prefill once
  useEffect(() => {
    if (!isOpen || !initialPrefill) return;
    if (appliedPrefillRef.current === initialPrefill) return;
    if (gpuCatalog.length === 0 && !initialPrefill.modelId) return;

    appliedPrefillRef.current = initialPrefill;

    if (initialPrefill.purpose && initialPrefill.purpose !== 'all') {
      setPurposeFilter(initialPrefill.purpose);
    }
    if (initialPrefill.modelId) {
      const known = POPULAR_MODELS.find((m) => m.id === initialPrefill.modelId);
      if (known) {
        setModelId(known.id);
        setCustomModel('');
        setPurposeFilter(known.purpose);
        setPrompt(defaultPromptForPurpose(known.purpose));
      } else {
        setCustomModel(initialPrefill.modelId);
      }
    }

    const matched = matchGpuFromPrefill(gpuCatalog, initialPrefill);
    if (matched) {
      applyGpuSelection(matched, false);
      if (typeof initialPrefill.bidUsdPerHour === 'number') {
        setBidUsdPerHour(initialPrefill.bidUsdPerHour);
        setBidMode('user');
      }
    } else if (initialPrefill.routingPreference) {
      setRoutingPreference(initialPrefill.routingPreference);
      setLockAutoRouting(initialPrefill.routingPreference === 'auto');
    }

    onPrefillConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialPrefill, gpuCatalog]);

  const autoProposal = resolveAutoMatchOption(recommendations);

  const allowedRoutingPrefs = useMemo(() => {
    if (!selectedProvider) {
      return ROUTING_STRATEGY_OPTIONS.map((o) => o.value);
    }
    return compatibleRoutingPreferences(selectedProvider);
  }, [selectedProvider]);

  const filteredRoutingOptions = useMemo(() => {
    return ROUTING_STRATEGY_OPTIONS.filter((o) => allowedRoutingPrefs.includes(o.value));
  }, [allowedRoutingPrefs]);

  // Keep routing in sync with the selected provider / FinOps placement.
  useEffect(() => {
    if (!isOpen || !selectedProvider || isMockInference) return;
    setRoutingPreference((prev) => {
      const next = ensureCompatibleRouting(prev, selectedProvider);
      return next === prev ? prev : next;
    });
  }, [isOpen, selectedProvider, isMockInference]);

  // Live CUDA probe when local GPU placement is selected (for offload forecast).
  useEffect(() => {
    if (!isOpen || !isLocalPlacement) return;
    let cancelled = false;
    void apiClient
      .getLocalGpu()
      .then((gpu) => {
        if (!cancelled) {
          setLocalGpuProbe({
            available: gpu.available,
            device_name: gpu.device_name,
            total_vram_gb: gpu.total_vram_gb,
            free_vram_gb: gpu.free_vram_gb,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setLocalGpuProbe(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, isLocalPlacement, selectedGpuId]);

  // Local HF cache inventory for the popular catalog.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiClient.getModelCache(POPULAR_MODELS.map((m) => m.id));
        if (cancelled) return;
        const map: Record<string, ModelCacheEntry> = {};
        for (const m of res.models) map[m.model_id] = m;
        setModelCacheById(map);
      } catch {
        if (!cancelled) setModelCacheById({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Poll download progress while a Hub fetch is in flight.
  useEffect(() => {
    if (!isOpen || !modelDownload) return;
    if (modelDownload.status !== 'queued' && modelDownload.status !== 'downloading') return;
    const modelKey = modelDownload.model_id;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const status = await apiClient.getModelCacheStatus(modelKey);
          setModelDownload(status);
          if (status.status === 'ready') {
            setModelCacheById((prev) => ({
              ...prev,
              [modelKey]: {
                model_id: modelKey,
                hub_id: status.hub_id,
                cached: true,
                size_bytes: status.bytes_cached ?? prev[modelKey]?.size_bytes ?? 0,
                proprietary: prev[modelKey]?.proprietary ?? false,
              },
            }));
          }
        } catch {
          // keep last known status
        }
      })();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [isOpen, modelDownload?.model_id, modelDownload?.status]);

  const selectedCache = modelCacheById[finalModel];
  const needsDownload =
    !isMockInference &&
    useProductionWeights &&
    canUseLocalProductionWeights &&
    selectedCache &&
    !selectedCache.proprietary &&
    !selectedCache.cached;

  const handleEnsureModelDownload = async () => {
    setIsEnsuringModel(true);
    setError(null);
    try {
      const status = await apiClient.ensureModelCached(finalModel);
      setModelDownload(status);
    } catch (err: any) {
      setError(err?.message || 'Failed to start model download');
    } finally {
      setIsEnsuringModel(false);
    }
  };

  const handleCancelModelDownload = async () => {
    setError(null);
    try {
      const status = await apiClient.cancelModelCache(finalModel);
      setModelDownload(status);
    } catch (err: any) {
      setError(err?.message || 'Failed to cancel model download');
    }
  };

  if (!isOpen) return null;

  const handlePurposeChange = (nextPurpose: string) => {
    const prevPurpose = effectivePurpose;
    const resolvedPurpose = nextPurpose === 'all' ? 'text_to_text' : nextPurpose;
    setPurposeFilter(nextPurpose);
    const preferred = preferredModelForPurpose(nextPurpose);
    const nextModelId = preferred?.id;
    if (nextModelId && nextModelId !== modelId) {
      setModelId(nextModelId);
      setCustomModel('');
    }
    const applyId = nextModelId || modelId;
    setPrompt((prev) => {
      const swapped = maybeSwapDefaultPrompt(prev, prevPurpose, resolvedPurpose);
      const modelPrompt = defaultPromptForModel(applyId, resolvedPurpose);
      // If still on a purpose default, prefer the model-specific prompt.
      return swapped === defaultPromptForPurpose(resolvedPurpose) ? modelPrompt : swapped;
    });
    patchInference(inferenceDefaultsForModel(applyId));
  };

  const handleModelChange = (nextId: string) => {
    const prevPurpose = effectivePurpose;
    const next = findPopularModel(nextId);
    setModelId(nextId);
    setCustomModel('');
    if (next) {
      setPrompt((prev) => {
        const swapped = maybeSwapDefaultPrompt(prev, prevPurpose, next.purpose);
        const modelPrompt = defaultPromptForModel(next.id, next.purpose);
        return swapped === defaultPromptForPurpose(next.purpose) ||
          swapped === defaultPromptForModel(modelId, prevPurpose)
          ? modelPrompt
          : swapped;
      });
      patchInference(inferenceDefaultsForModel(next.id));
      if (purposeFilter !== 'all' && purposeFilter !== next.purpose) {
        setPurposeFilter(next.purpose);
      }
    }
  };

  const handleMediaUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    setUploadFeedback(null);
    setError(null);
    const uploaded: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const contentType = normalizeUploadContentType(file);
        if (!contentType) {
          throw new Error(
            `Unsupported file type: ${file.name}. Use jpeg, png, webp, mp4, mov, mp3, wav, webm, flac, m4a, or pdf.`
          );
        }
        const res = await apiClient.uploadMediaFile(tenantId, file, contentType);
        uploaded.push(res.asset_uri);
      }
      const [primary, ...rest] = uploaded;
      const existingExtra = inferenceParams.additionalInputUris;
      patchInference({
        inputUri: primary || inferenceParams.inputUri,
        mediaAssetUri: primary || inferenceParams.mediaAssetUri,
        additionalInputUris: [...existingExtra, ...rest],
      });
      setUploadFeedback(
        uploaded.length === 1
          ? `Uploaded · ${uploaded[0]}`
          : `Uploaded ${uploaded.length} files · primary ${uploaded[0]}`
      );
    } catch (err: any) {
      setError(err?.message || 'Media upload failed');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSelectOption = (option: CloudOption, isAutoMatch?: boolean) => {
    setSelectedOptionId(option.id);
    const dispatchRouting = dispatchRoutingForCloudOption(option);
    const isLocalDispatch =
      dispatchRouting === 'auto' ||
      dispatchRouting === 'local/gpu' ||
      dispatchRouting === 'local/cpu' ||
      dispatchRouting === 'local_first' ||
      dispatchRouting === 'local';

    if (isAutoMatch && isLocalDispatch) {
      setLockAutoRouting(true);
      setRoutingPreference('auto');
    } else {
      // Smart-cloud / provider cards always bind a concrete executor routing pref.
      setLockAutoRouting(false);
      setRoutingPreference(dispatchRouting);
    }
    patchInference({ device: '' });

    const match = eligibleGpus.find(
      (g) =>
        g.provider === option.provider &&
        (g.hardwareDisplayName.includes(option.hardwareOrExecution.split('(')[0].trim()) ||
          option.displayName.toLowerCase().includes(g.provider))
    ) || eligibleGpus.find((g) => g.provider === option.provider);
    if (match) {
      applyGpuSelection(match, Boolean(isAutoMatch && isLocalDispatch));
    } else {
      setSelectedProvider(option.provider);
    }
  };

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider);
    const models = uniqueSorted(
      eligibleGpus.filter((g) => g.provider === provider).map((g) => g.pricingModel)
    );
    const nextModel = models.includes(selectedPricingModel)
      ? selectedPricingModel
      : models[0] || '';
    setSelectedPricingModel(nextModel);
    const skus = eligibleGpus.filter(
      (g) => g.provider === provider && g.pricingModel === nextModel
    );
    const nextGpu = skus[0];
    if (nextGpu) applyGpuSelection(nextGpu, false);
  };

  const handlePricingModelChange = (pricingModel: string) => {
    setSelectedPricingModel(pricingModel);
    const skus = eligibleGpus.filter(
      (g) => g.provider === selectedProvider && g.pricingModel === pricingModel
    );
    if (skus[0]) applyGpuSelection(skus[0], false);
  };

  const handleSkuChange = (gpuId: string) => {
    const gpu = eligibleGpus.find((g) => g.id === gpuId);
    if (gpu) applyGpuSelection(gpu, false);
  };

  const handleRefreshPrice = async () => {
    setIsRefreshingPrice(true);
    try {
      await apiClient.syncPricing();
      const res = await apiClient.getGpuPricing();
      setGpuCatalog(res.data || []);
      const refreshed =
        res.data?.find((g) => g.id === selectedGpuId) ||
        res.data?.find(
          (g) =>
            g.provider === selectedProvider &&
            g.pricingModel === selectedPricingModel &&
            g.hardwareSkuId === selectedGpu?.hardwareSkuId
        );
      if (refreshed) {
        setBidUsdPerHour(Number(refreshed.normalizedHourlyUsd.toFixed(4)));
        setSelectedGpuId(refreshed.id);
      }
    } catch (err) {
      console.error('Failed to refresh spot price:', err);
      setError('Failed to refresh live catalog rates');
    } finally {
      setIsRefreshingPrice(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setModeSwitchError(null);
    setIsSubmitting(true);

    try {
      // Align API worker gate with the form — otherwise MOCK_PROVIDERS=1 keeps simulating.
      if (onEnsureInferenceMode) {
        await onEnsureInferenceMode(isMockInference ? 'mock' : 'real');
      }

      const parameters = isMockInference
        ? {
            weights: 'synthetic',
            engine: 'auto',
            max_new_tokens: inferenceParams.maxNewTokens,
          }
        : buildInferenceParameters(inferenceParams, {
            useProductionWeights: useProductionWeights && canUseLocalProductionWeights,
            purpose: effectivePurpose,
          });

      if (!isMockInference && selectedGpu && forecast) {
        const effectiveBidMode: BidMode =
          bidMode === 'recommended' &&
          Math.abs(bidUsdPerHour - selectedGpu.normalizedHourlyUsd) > 0.0001
            ? 'user'
            : bidMode;
        parameters.placement = buildPlacementParameters({
          provider: selectedGpu.provider,
          pricingModel: selectedGpu.pricingModel,
          hardwareSkuId: selectedGpu.hardwareSkuId,
          hardwareDisplayName: selectedGpu.hardwareDisplayName,
          gpuId: selectedGpu.id,
          bidUsdPerHour:
            selectedGpu.provider === 'local' || selectedGpu.provider === 'local_pytorch'
              ? 0
              : bidUsdPerHour,
          bidMode: effectiveBidMode,
          tokensPerSec: forecast.tokensPerSec,
          forecastedExecutionMs: forecast.forecastedExecutionMs,
          forecastedCostUsd: forecast.forecastedCostUsd,
          interruptionRiskTier: selectedGpu.interruptionRiskTier,
          noticeWindowLabel:
            spotPolicy?.noticeWindowLabel ||
            resolveSpotPolicy(selectedGpu.provider)?.noticeWindowLabel,
          rateEvidence: forecast.rateEvidence,
          throughputEvidence: forecast.throughputEvidence,
        });
      }

      const payload: SubmitJobPayload = {
        model_id: finalModel,
        routing_preference: isMockInference ? 'mock' : routingPreference,
        priority,
        max_retries: maxRetries,
        expires_in_seconds: inferenceParams.expiresInSeconds,
        input: {
          prompt,
          parameters,
        },
      };
      if (!isMockInference && inferenceParams.inputUri.trim()) {
        payload.input_uri = inferenceParams.inputUri.trim();
      }

      await onSubmit(payload);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit inference job');
    } finally {
      setIsSubmitting(false);
    }
  };

  const recList = recommendations?.recommendations
    ? [
        { key: 'cheapest', label: 'Cheapest', item: recommendations.recommendations.cheapest, color: '#10b981' },
        { key: 'fastest', label: 'Fastest', item: recommendations.recommendations.fastest, color: '#3b82f6' },
        { key: 'balanced', label: 'Balanced', item: recommendations.recommendations.balanced, color: '#8b5cf6' },
        { key: 'recommended', label: 'Recommended', item: recommendations.recommendations.recommended, color: '#f59e0b' },
      ]
    : [];

  const selectedOpt =
    recommendations?.allOptions.find((o) => o.id === selectedOptionId) ||
    (routingPreference === 'auto' ? autoProposal : null);

  const bidEditable = isBidEditable(bidMode, spotPolicy) && interruptible;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '16px',
      }}
    >
      <div
        style={{
          backgroundColor: '#0f172a',
          borderRadius: '14px',
          border: '1px solid #334155',
          width: '100%',
          maxWidth: '760px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #1e293b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              Submit Inference Job &amp; Cloud Optimizer
            </h2>
            <p style={{ color: '#94a3b8', fontSize: '12px', margin: 0, marginTop: '2px' }}>
              Pick model, provider placement, and bid — forecasts use catalog rates and benchmark tok/s.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '18px',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '20px 24px', overflowY: 'auto' }}>
          {error && (
            <div
              style={{
                marginBottom: '16px',
                padding: '10px 14px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                color: '#f87171',
                fontSize: '13px',
                border: '1px solid rgba(239, 68, 68, 0.3)',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
              Model Purpose Filter:
            </label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[
                { id: 'all', label: 'All' },
                { id: 'text_to_text', label: 'Text LLM' },
                { id: 'text_to_image', label: 'Image Gen' },
                { id: 'text_to_video', label: 'Video' },
                { id: 'speech_to_text', label: 'Audio' },
                { id: 'code_reasoning', label: 'Code' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePurposeChange(p.id)}
                  style={{
                    backgroundColor: purposeFilter === p.id ? '#3b82f620' : '#1e293b',
                    color: purposeFilter === p.id ? '#38bdf8' : '#94a3b8',
                    border: `1px solid ${purposeFilter === p.id ? '#38bdf8' : '#334155'}`,
                    borderRadius: '16px',
                    padding: '3px 10px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px', marginBottom: '10px' }}>
            <div style={{ minWidth: 0 }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
                Popular Model Catalog:
              </label>
              <select
                value={modelId}
                onChange={(e) => handleModelChange(e.target.value)}
                style={{ ...selectStyle, width: '100%' }}
              >
                {filteredPopularModels.map((m) => {
                  const cache = modelCacheById[m.id];
                  return (
                    <option key={m.id} value={m.id} title={m.notes || formatModelOptionLabel(m)}>
                      {formatModelCacheLabel(m, cache ? cache.cached : null)}
                    </option>
                  );
                })}
              </select>
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={{ display: 'block', fontSize: '13px', color: '#64748b', marginBottom: '6px' }}>
                Or Custom Model ID:
              </label>
              <input
                type="text"
                placeholder="e.g. meta-llama/Llama-3-70b"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                style={{ ...selectStyle, width: '100%' }}
              />
            </div>
          </div>

          {catalogModel && (
            <div
              data-testid="model-resource-meta"
              title={INFERENCE_PARAM_TOOLTIPS.modelQuantization}
              style={{
                marginBottom: '10px',
                fontSize: '11px',
                color: '#94a3b8',
                lineHeight: 1.45,
                width: '100%',
              }}
            >
              <span style={{ color: '#cbd5e1' }}>{catalogModel.purpose.replace(/_/g, ' ')}</span>
              {' · '}
              {catalogModel.minVramGb > 0
                ? `~${catalogModel.minVramGb} GB VRAM`
                : 'API-managed compute'}
              {catalogModel.minRamGb > 0 ? ` · ≥${catalogModel.minRamGb} GB RAM` : ''}
              {' · '}
              <span
                style={{
                  color: fitsLocalVramBudget(catalogModel)
                    ? '#6ee7b7'
                    : catalogModel.localFit === 'offload'
                      ? '#fbbf24'
                      : '#94a3b8',
                  fontWeight: 600,
                }}
              >
                {catalogModel.localFit === 'fits_vram'
                  ? `fits ${LOCAL_VRAM_BUDGET_GB} GB`
                  : catalogModel.localFit === 'offload'
                    ? 'CPU offload (not fully in VRAM)'
                    : catalogModel.localFit === 'api'
                      ? 'managed API'
                      : 'cloud GPU'}
              </span>
              {' · '}
              <span style={{ color: '#a5b4fc' }}>{catalogModel.quantization}</span>
              {catalogModel.notes ? ` · ${catalogModel.notes}` : ''}
              {selectedCache && !selectedCache.proprietary && (
                <>
                  {' · '}
                  <span style={{ color: selectedCache.cached ? '#6ee7b7' : '#fbbf24' }}>
                    {selectedCache.cached
                      ? formatModelDiskCacheNote(catalogModel, selectedCache.size_bytes)
                      : catalogModel.diskGbHint
                        ? `not downloaded · expect ~${catalogModel.diskGbHint} GB on disk`
                        : 'not downloaded'}
                  </span>
                </>
              )}
            </div>
          )}
          {catalogModel?.promptTips && (
            <div
              data-testid="model-prompt-tips"
              style={{
                marginBottom: '10px',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #334155',
                backgroundColor: '#0f172a',
                fontSize: '12px',
                color: '#cbd5e1',
                lineHeight: 1.45,
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ fontWeight: 700, color: '#94a3b8', marginBottom: '4px' }}>
                Prompt recommendations
              </div>
              {catalogModel.promptTips}
            </div>
          )}
          {(needsDownload ||
            (modelDownload &&
              modelDownload.model_id === finalModel &&
              modelDownload.status !== 'idle')) && (
            <div
              data-testid="model-cache-download"
              style={{
                marginBottom: '14px',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #334155',
                backgroundColor: '#0f172a',
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                <div style={{ fontSize: '12px', color: '#e2e8f0', fontWeight: 600 }}>
                  Pretrained checkpoint
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {modelDownload &&
                    modelDownload.model_id === finalModel &&
                    (modelDownload.status === 'queued' || modelDownload.status === 'downloading') && (
                      <button
                        type="button"
                        data-testid="model-cache-cancel"
                        onClick={() => void handleCancelModelDownload()}
                        style={{
                          backgroundColor: 'transparent',
                          color: '#fca5a5',
                          border: '1px solid #7f1d1d',
                          borderRadius: '6px',
                          padding: '5px 10px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Cancel download
                      </button>
                    )}
                  {needsDownload &&
                    (!modelDownload ||
                      modelDownload.model_id !== finalModel ||
                      modelDownload.status === 'error' ||
                      modelDownload.status === 'cancelled' ||
                      modelDownload.status === 'idle') && (
                      <button
                        type="button"
                        onClick={() => void handleEnsureModelDownload()}
                        disabled={isEnsuringModel}
                        style={{
                          backgroundColor: '#6366f1',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '5px 10px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: isEnsuringModel ? 'wait' : 'pointer',
                        }}
                      >
                        {isEnsuringModel ? 'Starting…' : 'Download weights'}
                      </button>
                    )}
                </div>
              </div>
              {catalogModel?.diskGbHint != null && catalogModel.minVramGb > 0 && (
                <div style={{ marginTop: '6px', fontSize: '11px', color: '#94a3b8', lineHeight: 1.45 }}>
                  Disk ≈ {catalogModel.diskGbHint} GB (weights on disk) · VRAM ≈ {catalogModel.minVramGb} GB at
                  runtime
                  {catalogModel.localFit === 'fits_vram'
                    ? ` · fits ${LOCAL_VRAM_BUDGET_GB} GB card`
                    : catalogModel.localFit === 'offload'
                      ? ' · needs CPU offload on 16 GB'
                      : ''}
                </div>
              )}
              {modelDownload && modelDownload.model_id === finalModel && (
                <>
                  <div
                    style={{
                      marginTop: '8px',
                      fontSize: '11px',
                      color:
                        modelDownload.status === 'error'
                          ? '#fca5a5'
                          : modelDownload.status === 'cancelled'
                            ? '#fbbf24'
                            : modelDownload.status === 'ready'
                              ? '#6ee7b7'
                              : '#cbd5e1',
                      lineHeight: 1.45,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {modelDownload.message}
                    {modelDownload.bytes_cached != null && modelDownload.bytes_total
                      ? ` · ${formatBytes(Math.min(modelDownload.bytes_cached, modelDownload.bytes_total))} / ${formatBytes(modelDownload.bytes_total)}`
                      : modelDownload.bytes_cached
                        ? ` · ${formatBytes(modelDownload.bytes_cached)}`
                        : ''}
                  </div>
                  {(modelDownload.status === 'queued' || modelDownload.status === 'downloading') && (
                    <div
                      style={{
                        marginTop: '8px',
                        width: '100%',
                        height: '6px',
                        backgroundColor: '#1e293b',
                        borderRadius: '999px',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(2, modelDownload.percent)}%`,
                          height: '100%',
                          backgroundColor: '#818cf8',
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                  )}
                </>
              )}
              {needsDownload && !modelDownload && (
                <div style={{ marginTop: '6px', fontSize: '11px', color: '#94a3b8' }}>
                  Weights are not in the local Hugging Face cache yet. Download before submitting with Pretrained
                  Checkpoint enabled.
                </div>
              )}
            </div>
          )}

          {!isMockInference && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label style={{ fontSize: '13px', color: '#f8fafc', fontWeight: 700 }}>
                Smart Cloud Options for {finalModel.split('/').pop()}
              </label>
              {isLoadingRecs && (
                <span style={{ fontSize: '11px', color: '#60a5fa' }}>Evaluating live catalogs...</span>
              )}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '10px',
                marginBottom: '10px',
              }}
            >
              {recList.map(({ key, label, item, color }) => {
                if (!item) return null;
                const isAutoMatch = isOptionAutoMatch(key, item.id, autoProposal?.id);
                const isSelected =
                  routingPreference === 'auto'
                    ? isAutoMatch
                    : selectedOptionId === item.id;
                const activeColor = routingPreference === 'auto' && isAutoMatch ? '#6366f1' : color;
                return (
                  <div
                    key={key}
                    onClick={() => handleSelectOption(item, isAutoMatch)}
                    style={{
                      backgroundColor: isSelected ? '#1e293b' : '#0f172a',
                      border: `1.5px solid ${isSelected ? activeColor : '#334155'}`,
                      borderRadius: '8px',
                      padding: '10px',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ color: activeColor, fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>
                      {label}
                      {isAutoMatch ? ' · AUTO' : ''}
                    </div>
                    <div style={{ color: '#f8fafc', fontWeight: 600, fontSize: '12px' }}>{item.displayName}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '11px' }}>
                      <span style={{ color: '#94a3b8' }}>{item.forecastedExecutionMs} ms</span>
                      <span style={{ color: '#10b981', fontWeight: 700 }}>
                        {item.forecastedCostUsd === 0 ? '$0.00 (Local)' : `$${item.forecastedCostUsd.toFixed(5)}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedOpt && (
              <div
                style={{
                  backgroundColor: '#1e293b80',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  fontSize: '11px',
                  color: '#cbd5e1',
                }}
              >
                <span style={{ fontWeight: 600, color: '#f8fafc' }}>{selectedOpt.displayName}: </span>
                {selectedOpt.finopsInsight}
              </div>
            )}
          </div>
          )}

          {/* Provider × Placement × SKU */}
          {!isMockInference && (
          <div
            style={{
              marginBottom: '14px',
              padding: '12px',
              borderRadius: '10px',
              border: '1px solid #334155',
              backgroundColor: '#111827',
            }}
            data-testid="placement-picker"
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <label style={{ fontSize: '13px', color: '#f8fafc', fontWeight: 700 }}>
                Provider · Placement · Hardware
              </label>
              {(isLoadingCatalog || isRefreshingPrice) && (
                <span style={{ fontSize: '11px', color: '#60a5fa' }}>
                  {isRefreshingPrice ? 'Refreshing live rates...' : 'Loading catalog...'}
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Provider</label>
                <select
                  data-testid="placement-provider"
                  value={selectedProvider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  style={selectStyle}
                >
                  {providers.length === 0 && <option value="">No eligible providers</option>}
                  {providers.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Placement</label>
                <select
                  data-testid="placement-pricing-model"
                  value={selectedPricingModel}
                  onChange={(e) => handlePricingModelChange(e.target.value)}
                  style={selectStyle}
                >
                  {placementsForProvider.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>Hardware SKU</label>
                <select
                  data-testid="placement-sku"
                  value={selectedGpu?.id || ''}
                  onChange={(e) => handleSkuChange(e.target.value)}
                  style={selectStyle}
                >
                  {skusForSelection.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.hardwareDisplayName} · ${g.normalizedHourlyUsd.toFixed(3)}/hr
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isLocalPlacement && catalogModel && localVramPlacement && (
              <div
                data-testid="local-vram-placement"
                style={{
                  marginBottom: '12px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: `1px solid ${
                    localVramPlacement === 'resident'
                      ? '#065f46'
                      : localVramPlacement === 'offload'
                        ? '#92400e'
                        : '#7f1d1d'
                  }`,
                  backgroundColor: '#0f172a',
                  fontSize: '12px',
                  color: '#e2e8f0',
                  lineHeight: 1.45,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '4px', color: '#94a3b8' }}>
                  Local VRAM placement
                </div>
                <div>
                  {formatVramPlacement(localVramPlacement, effectiveLocalVramGb)}
                  {catalogModel.minVramGb > 0
                    ? ` · model needs ~${catalogModel.minVramGb} GB`
                    : ''}
                </div>
                {(localGpuProbe?.device_name || localGpuProbe?.free_vram_gb != null) && (
                  <div style={{ marginTop: '4px', color: '#94a3b8', fontSize: '11px' }}>
                    {localGpuProbe.device_name || 'CUDA device'}
                    {localGpuProbe.total_vram_gb != null
                      ? ` · ${localGpuProbe.total_vram_gb} GB total`
                      : ''}
                    {localGpuProbe.free_vram_gb != null
                      ? ` · ${localGpuProbe.free_vram_gb} GB free now`
                      : ''}
                    {!localGpuProbe.available ? ' · live probe unavailable (using catalog VRAM)' : ''}
                  </div>
                )}
              </div>
            )}

            {selectedGpu && (
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                    {bidEditable ? 'Recommended / max spot bid ($/hr)' : 'Fixed rate ($/hr)'}
                    <span style={{ color: '#64748b', fontWeight: 400 }}>
                      {' '}
                      · {spotPolicy?.pricingTypeLabel || 'Catalog'}
                    </span>
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      data-testid="placement-bid"
                      type="number"
                      step="0.001"
                      min="0"
                      value={bidUsdPerHour}
                      disabled={!bidEditable}
                      onChange={(e) => {
                        setBidUsdPerHour(Number(e.target.value));
                        setBidMode('user');
                        setLockAutoRouting(false);
                      }}
                      style={{
                        ...selectStyle,
                        opacity: bidEditable ? 1 : 0.7,
                        cursor: bidEditable ? 'text' : 'not-allowed',
                      }}
                    />
                    {bidEditable && (
                      <button
                        type="button"
                        data-testid="refresh-spot-price"
                        onClick={handleRefreshPrice}
                        disabled={isRefreshingPrice}
                        style={{
                          backgroundColor: '#1e293b',
                          color: '#a5b4fc',
                          border: '1px solid #4338ca',
                          borderRadius: '8px',
                          padding: '0 12px',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Refresh
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>
                    Catalog {selectedGpu.normalizedHourlyUsd.toFixed(4)}/hr · recorded{' '}
                    {new Date(selectedGpu.recordedAt).toLocaleString()} · provider-reported
                  </div>
                </div>

                <div
                  data-testid="placement-interrupt-panel"
                  style={{
                    backgroundColor: interruptible ? 'rgba(245, 158, 11, 0.08)' : 'rgba(16, 185, 129, 0.08)',
                    border: `1px solid ${interruptible ? '#f59e0b55' : '#10b98155'}`,
                    borderRadius: '8px',
                    padding: '8px 10px',
                    fontSize: '11px',
                    color: '#cbd5e1',
                  }}
                >
                  {interruptible ? (
                    <>
                      <div style={{ fontWeight: 700, color: '#fbbf24', marginBottom: '4px' }}>
                        Interruptible placement
                      </div>
                      <div>
                        Notice:{' '}
                        <strong style={{ color: '#f8fafc' }}>
                          {spotPolicy?.noticeWindowLabel || 'provider policy'}
                        </strong>
                      </div>
                      <div>
                        Forecast risk:{' '}
                        <strong style={{ color: '#f8fafc' }}>{selectedGpu.interruptionRiskTier}</strong>
                        <span style={{ color: '#64748b' }}> (provider-reported / sync-mapped)</span>
                      </div>
                      {spotPolicy?.description && (
                        <div style={{ marginTop: '4px', color: '#94a3b8' }}>{spotPolicy.description}</div>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ fontWeight: 700, color: '#34d399', marginBottom: '4px' }}>
                        Not interruptible
                      </div>
                      <div>
                        {spotPolicy?.noticeWindowLabel || 'Guaranteed / dedicated / local capacity'}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {forecast && selectedGpu && (
              <div
                data-testid="placement-forecast-strip"
                style={{
                  marginTop: '10px',
                  display: 'flex',
                  gap: '16px',
                  flexWrap: 'wrap',
                  fontSize: '12px',
                  color: '#e2e8f0',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  backgroundColor: '#0f172a',
                  border: '1px solid #1e293b',
                }}
              >
                <span>
                  <strong style={{ color: '#94a3b8' }}>tok/s</strong>{' '}
                  {forecast.tokensPerSec}
                  <span style={{ color: '#64748b' }}> ({forecast.throughputEvidence})</span>
                </span>
                <span>
                  <strong style={{ color: '#94a3b8' }}>est. time</strong>{' '}
                  {forecast.forecastedExecutionMs} ms
                </span>
                <span>
                  <strong style={{ color: '#94a3b8' }}>est. cost</strong>{' '}
                  {forecast.forecastedCostUsd === 0
                    ? '$0.00 (local)'
                    : `$${forecast.forecastedCostUsd.toFixed(5)}`}
                </span>
                <span style={{ color: '#64748b' }}>
                  from {inferenceParams.maxNewTokens} new tokens · ~{estimatePromptTokens(prompt)} prompt tokens
                </span>
              </div>
            )}
          </div>
          )}

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
              Inference Prompt:
            </label>
            <textarea
              rows={paramSections.video ? 3 : 2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
              data-testid="inference-prompt"
              placeholder={
                promptTipsForModel(finalModel)
                  ? 'One subject, one continuous camera move, no multi-shot script…'
                  : undefined
              }
              style={{
                width: '100%',
                backgroundColor: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #334155',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '13px',
                outline: 'none',
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div>
              <FieldLabel tip="Must match the selected provider/placement. Smart-cloud cards bind a concrete dispatch preference so AUTO cannot advertise RunPod while executing on local CPU.">
                Routing Strategy / Override
              </FieldLabel>
              <select
                value={isMockInference ? 'mock' : routingPreference}
                disabled={isMockInference}
                onChange={(e) => {
                  const val = e.target.value as RoutingPreference;
                  const coerced =
                    selectedProvider && val !== 'mock'
                      ? ensureCompatibleRouting(val, selectedProvider)
                      : val;
                  setRoutingPreference(coerced);
                  setRoutingBeforeMock(coerced);
                  setLockAutoRouting(coerced === 'auto');
                  patchInference({ device: '' });
                  if (coerced === 'auto' && autoProposal) {
                    setSelectedOptionId(autoProposal.id);
                  } else if (coerced !== routingPreference) {
                    // Keep current FinOps card if still compatible; otherwise clear.
                    setSelectedOptionId((prev) => prev);
                  }
                }}
                style={{ ...selectStyle, opacity: isMockInference ? 0.55 : 1 }}
                data-testid="routing-preference"
              >
                {filteredRoutingOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.value === 'auto'
                      ? formatAutoDropdownLabel(autoProposal || null)
                      : opt.label}
                  </option>
                ))}
                {isMockInference && <option value="mock">mock (forced by inference mode)</option>}
              </select>
              {selectedProvider && !isMockInference && (
                <div style={{ marginTop: '4px', fontSize: '10px', color: '#64748b' }}>
                  Filtered for provider <span style={{ color: '#94a3b8' }}>{selectedProvider}</span>
                  {' · '}
                  device{' '}
                  <span style={{ color: '#94a3b8' }}>
                    {inferenceParams.device || deviceInferHint(routingPreference)}
                  </span>
                </div>
              )}
            </div>
            <div>
              <FieldLabel tip={`${INFERENCE_PARAM_TOOLTIPS.priority} ${INFERENCE_PARAM_TOOLTIPS.maxRetries}`}>
                Priority &amp; Retries
              </FieldLabel>
              <div style={{ display: 'flex', gap: '8px' }}>
                <select
                  value={priority}
                  title={INFERENCE_PARAM_TOOLTIPS.priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  style={selectStyle}
                >
                  <option value={1}>P1 (Lowest)</option>
                  <option value={5}>P5 (Standard)</option>
                  <option value={8}>P8 (High)</option>
                  <option value={10}>P10 (Urgent)</option>
                </select>
                <select
                  value={maxRetries}
                  title={INFERENCE_PARAM_TOOLTIPS.maxRetries}
                  onChange={(e) => setMaxRetries(Number(e.target.value))}
                  style={selectStyle}
                >
                  <option value={0}>0 Retries</option>
                  <option value={1}>1 Retry</option>
                  <option value={3}>3 Retries</option>
                  <option value={5}>5 Retries</option>
                </select>
              </div>
            </div>
          </div>

          <div
            data-testid="inference-params-panel"
            style={{
              marginBottom: '14px',
              padding: '12px',
              borderRadius: '10px',
              border: '1px solid #334155',
              backgroundColor: '#111827',
            }}
          >
            <div style={{ fontSize: '13px', color: '#f8fafc', fontWeight: 700, marginBottom: '10px' }}>
              Inference parameters
              <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 500, marginLeft: '8px' }}>
                {isMockInference
                  ? 'Mock path · synthetic response · routing forced to mock'
                  : `Adapted to ${effectivePurpose.replace(/_/g, ' ')} · hover labels for tooltips`}
              </span>
            </div>

            <div
              data-testid="inference-execution-toggle"
              style={{
                display: 'flex',
                gap: '8px',
                marginBottom: isMockInference ? 0 : '14px',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600, marginRight: '4px' }}>
                Inference mode
              </span>
              <button
                type="button"
                data-testid="inference-mode-real"
                aria-pressed={!isMockInference}
                onClick={() => handleInferenceExecutionChange('real')}
                style={{
                  backgroundColor: !isMockInference ? 'rgba(16, 185, 129, 0.2)' : '#1e293b',
                  color: !isMockInference ? '#34d399' : '#94a3b8',
                  border: `1.5px solid ${!isMockInference ? '#059669' : '#334155'}`,
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: !isMockInference ? '0 0 0 2px rgba(16,185,129,0.25)' : 'none',
                }}
              >
                {!isMockInference ? '✓ ' : ''}REAL
              </button>
              <button
                type="button"
                data-testid="inference-mode-mock"
                aria-pressed={isMockInference}
                onClick={() => handleInferenceExecutionChange('mock')}
                style={{
                  backgroundColor: isMockInference ? 'rgba(148, 163, 184, 0.2)' : '#1e293b',
                  color: isMockInference ? '#e2e8f0' : '#94a3b8',
                  border: `1.5px solid ${isMockInference ? '#94a3b8' : '#334155'}`,
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: isMockInference ? '0 0 0 2px rgba(148,163,184,0.25)' : 'none',
                }}
              >
                {isMockInference ? '✓ ' : ''}MOCK
              </button>
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                {isMockInference
                  ? 'Engine, placement, diffusion/ASR params, and uploads are skipped — only model + prompt matter.'
                  : 'Flips the API worker to real PyTorch/GPU and keeps routing + production weights.'}
              </span>
              <span
                data-testid="api-inference-gate"
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: apiInferenceMode === 'real' ? '#34d399' : '#fbbf24',
                  marginLeft: '4px',
                }}
              >
                API worker: {apiInferenceMode.toUpperCase()}
              </span>
            </div>

            {(apiGateMismatch || modeSwitchError) && (
              <div
                data-testid="api-gate-warning"
                style={{
                  marginBottom: '12px',
                  padding: '8px 10px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(245, 158, 11, 0.12)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  color: '#fbbf24',
                  fontSize: '11px',
                  lineHeight: 1.45,
                }}
              >
                {modeSwitchError ||
                  'Form is REAL but the API worker gate is still MOCK. Click REAL again (or turn MOCK_PROVIDERS OFF in the header) so the API clears MOCK_PROVIDERS and opens the live Python path. Docker Compose needs CUDA torch in the API image + nvidia toolkit; for host GPU/.venv checkpoints, run the API on the host against Compose Postgres/MinIO/SQS.'}
              </div>
            )}

            {!isMockInference && <>
            {/* General / local runtime */}
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>
              General
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '12px' }}>
              <div>
                <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.engine}>Execution engine</FieldLabel>
                <select
                  data-testid="execution-engine"
                  value={inferenceParams.engine}
                  title={ENGINE_TOOLTIPS[inferenceParams.engine]}
                  onChange={(e) => patchInference({ engine: e.target.value as ExecutionEngineId })}
                  style={selectStyle}
                >
                  {EXECUTION_ENGINES.map((eng) => {
                    const soft = isEngineSoftDisabled(eng, effectivePurpose, routingPreference);
                    return (
                      <option
                        key={eng}
                        value={eng}
                        disabled={soft.disabled}
                        title={soft.reason || ENGINE_TOOLTIPS[eng]}
                      >
                        {eng}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.device}>Device</FieldLabel>
                <select
                  value={inferenceParams.device}
                  title={INFERENCE_PARAM_TOOLTIPS.device}
                  onChange={(e) =>
                    patchInference({ device: e.target.value as InferenceParamFormState['device'] })
                  }
                  style={selectStyle}
                  data-testid="device-preference"
                >
                  <option value="">
                    Infer from routing ({deviceInferHint(routingPreference)})
                  </option>
                  <option value="cuda">cuda</option>
                  <option value="cpu">cpu</option>
                </select>
              </div>
              <div>
                <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.expiresInSeconds}>Expires (sec)</FieldLabel>
                <input
                  type="number"
                  min={60}
                  max={604800}
                  value={inferenceParams.expiresInSeconds}
                  title={INFERENCE_PARAM_TOOLTIPS.expiresInSeconds}
                  onChange={(e) => patchInference({ expiresInSeconds: Number(e.target.value) || 3600 })}
                  style={selectStyle}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '18px' }}>
                <label
                  title={INFERENCE_PARAM_TOOLTIPS.allowAutoUpgrade}
                  style={{ fontSize: '11px', color: '#cbd5e1', cursor: 'help', display: 'flex', gap: '6px', alignItems: 'center' }}
                >
                  <input
                    type="checkbox"
                    checked={inferenceParams.allowAutoUpgrade}
                    onChange={(e) => patchInference({ allowAutoUpgrade: e.target.checked })}
                    style={{ accentColor: '#6366f1' }}
                  />
                  Auto-upgrade
                </label>
                <label
                  title={INFERENCE_PARAM_TOOLTIPS.useTorchscript}
                  style={{ fontSize: '11px', color: '#cbd5e1', cursor: 'help', display: 'flex', gap: '6px', alignItems: 'center' }}
                >
                  <input
                    type="checkbox"
                    checked={inferenceParams.useTorchscript}
                    onChange={(e) => patchInference({ useTorchscript: e.target.checked })}
                    style={{ accentColor: '#6366f1' }}
                  />
                  use_torchscript
                </label>
              </div>
            </div>

            {paramSections.text && (
              <>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>
                  Text / multimodal generation
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                  <div>
                    <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.temperature}>Temperature</FieldLabel>
                    <input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={inferenceParams.temperature}
                      title={INFERENCE_PARAM_TOOLTIPS.temperature}
                      onChange={(e) => patchInference({ temperature: Number(e.target.value) })}
                      style={selectStyle}
                      data-testid="param-temperature"
                    />
                  </div>
                  <div>
                    <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.maxNewTokens}>Max new tokens</FieldLabel>
                    <input
                      type="number"
                      min={1}
                      max={4096}
                      value={inferenceParams.maxNewTokens}
                      title={INFERENCE_PARAM_TOOLTIPS.maxNewTokens}
                      onChange={(e) => patchInference({ maxNewTokens: Number(e.target.value) || 128 })}
                      style={selectStyle}
                      data-testid="max-new-tokens"
                    />
                  </div>
                </div>
              </>
            )}

            {paramSections.image && (
              <>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>
                  Image / diffusion
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '12px' }}>
                  <div>
                    <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.width}>Width</FieldLabel>
                    <input
                      type="number"
                      min={16}
                      value={inferenceParams.width}
                      onChange={(e) => patchInference({ width: Number(e.target.value) || 1024 })}
                      style={selectStyle}
                    />
                  </div>
                  <div>
                    <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.height}>Height</FieldLabel>
                    <input
                      type="number"
                      min={16}
                      value={inferenceParams.height}
                      onChange={(e) => patchInference({ height: Number(e.target.value) || 1024 })}
                      style={selectStyle}
                    />
                  </div>
                  <div>
                    <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.numInferenceSteps}>Steps</FieldLabel>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={inferenceParams.numInferenceSteps}
                      onChange={(e) => patchInference({ numInferenceSteps: Number(e.target.value) || 4 })}
                      style={selectStyle}
                    />
                  </div>
                  <div>
                    <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.guidanceScale}>Guidance</FieldLabel>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      step={0.5}
                      value={inferenceParams.guidanceScale}
                      onChange={(e) => patchInference({ guidanceScale: Number(e.target.value) })}
                      style={selectStyle}
                    />
                  </div>
                  <div>
                    <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.seed}>Seed</FieldLabel>
                    <input
                      type="text"
                      placeholder="optional"
                      value={inferenceParams.seed}
                      onChange={(e) => patchInference({ seed: e.target.value })}
                      style={selectStyle}
                    />
                  </div>
                </div>
              </>
            )}

            {paramSections.video && (
              <>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>
                  Video (Wan2.1) — model defaults apply on select (tight geometry for 16 GB offload)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '10px' }}>
                  <div>
                    <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.width}>Width</FieldLabel>
                    <input
                      type="number"
                      min={16}
                      value={inferenceParams.width}
                      onChange={(e) => patchInference({ width: Number(e.target.value) || 640 })}
                      style={selectStyle}
                      data-testid="param-video-width"
                    />
                  </div>
                  <div>
                    <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.height}>Height</FieldLabel>
                    <input
                      type="number"
                      min={16}
                      value={inferenceParams.height}
                      onChange={(e) => patchInference({ height: Number(e.target.value) || 368 })}
                      style={selectStyle}
                      data-testid="param-video-height"
                    />
                  </div>
                  <div>
                    <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.numInferenceSteps}>Denoise steps</FieldLabel>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={inferenceParams.numInferenceSteps}
                      onChange={(e) => patchInference({ numInferenceSteps: Number(e.target.value) || 30 })}
                      style={selectStyle}
                    />
                  </div>
                  <div>
                    <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.guidanceScale}>Guidance</FieldLabel>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      step={0.5}
                      value={inferenceParams.guidanceScale}
                      onChange={(e) => patchInference({ guidanceScale: Number(e.target.value) || 5 })}
                      style={selectStyle}
                      data-testid="param-video-guidance"
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '12px' }}>
                  <div>
                    <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.fps}>FPS</FieldLabel>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={inferenceParams.fps}
                      onChange={(e) => patchInference({ fps: Number(e.target.value) || 24 })}
                      style={selectStyle}
                      data-testid="param-video-fps"
                    />
                  </div>
                  <div>
                    <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.durationSeconds}>Duration (sec)</FieldLabel>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={inferenceParams.durationSeconds}
                      onChange={(e) => patchInference({ durationSeconds: Number(e.target.value) || 3 })}
                      style={selectStyle}
                      data-testid="param-video-duration"
                    />
                  </div>
                  <div>
                    <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.seed}>Seed</FieldLabel>
                    <input
                      type="text"
                      placeholder="optional"
                      value={inferenceParams.seed}
                      onChange={(e) => patchInference({ seed: e.target.value })}
                      style={selectStyle}
                    />
                  </div>
                </div>
              </>
            )}

            {paramSections.audio && (
              <>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>
                  Audio / speech-to-text (Whisper)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                  <div>
                    <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.language}>Language</FieldLabel>
                    <input
                      type="text"
                      placeholder="auto-detect (e.g. en, es)"
                      value={inferenceParams.language}
                      title={INFERENCE_PARAM_TOOLTIPS.language}
                      onChange={(e) => patchInference({ language: e.target.value })}
                      style={selectStyle}
                      data-testid="param-audio-language"
                    />
                  </div>
                  <div>
                    <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.audioTask}>Task</FieldLabel>
                    <select
                      value={inferenceParams.audioTask}
                      title={INFERENCE_PARAM_TOOLTIPS.audioTask}
                      onChange={(e) =>
                        patchInference({
                          audioTask: e.target.value as InferenceParamFormState['audioTask'],
                        })
                      }
                      style={selectStyle}
                      data-testid="param-audio-task"
                    >
                      <option value="transcribe">transcribe</option>
                      <option value="translate">translate (to English)</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            <>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>
                  {paramSections.mediaInput ? 'Media input' : 'Optional media input'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', marginBottom: '8px' }}>
                  <div>
                    <FieldLabel tip={INFERENCE_PARAM_TOOLTIPS.inputUri}>input_uri</FieldLabel>
                    <input
                      type="text"
                      placeholder="s3://… or upload below"
                      value={inferenceParams.inputUri}
                      title={INFERENCE_PARAM_TOOLTIPS.inputUri}
                      onChange={(e) =>
                        patchInference({
                          inputUri: e.target.value,
                          mediaAssetUri: e.target.value || inferenceParams.mediaAssetUri,
                        })
                      }
                      style={selectStyle}
                      data-testid="input-uri"
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button
                      type="button"
                      data-testid="upload-media-button"
                      disabled={isUploading}
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        ...selectStyle,
                        width: 'auto',
                        padding: '8px 14px',
                        cursor: isUploading ? 'wait' : 'pointer',
                        color: '#a5b4fc',
                        borderColor: '#4338ca',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isUploading ? 'Uploading…' : 'Upload file(s)'}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/webm,audio/flac,audio/mp4,application/pdf,.jpg,.jpeg,.png,.webp,.mp4,.mov,.mp3,.wav,.webm,.flac,.m4a,.pdf"
                      style={{ display: 'none' }}
                      onChange={(e) => handleMediaUpload(e.target.files)}
                    />
                  </div>
                </div>
                {uploadFeedback && (
                  <div style={{ fontSize: '11px', color: '#34d399', marginBottom: '6px' }}>{uploadFeedback}</div>
                )}
                {inferenceParams.additionalInputUris.length > 0 && (
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '6px' }}>
                    Extra assets:{' '}
                    {inferenceParams.additionalInputUris.map((uri) => (
                      <span
                        key={uri}
                        style={{
                          display: 'inline-block',
                          marginRight: '6px',
                          marginBottom: '4px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          backgroundColor: '#1e293b',
                          border: '1px solid #334155',
                        }}
                      >
                        {uri.split('/').pop()}
                      </span>
                    ))}
                  </div>
                )}
            </>
            </>}
          </div>

          {!isMockInference && (
          <div
            style={{
              marginTop: '14px',
              padding: '10px 14px',
              backgroundColor:
                useProductionWeights && canUseLocalProductionWeights
                  ? 'rgba(99, 102, 241, 0.12)'
                  : '#1e293b',
              border: `1px solid ${
                useProductionWeights && canUseLocalProductionWeights ? '#6366f1' : '#334155'
              }`,
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: canUseLocalProductionWeights ? 'pointer' : 'not-allowed',
              opacity: canUseLocalProductionWeights ? 1 : 0.65,
            }}
            title={
              canUseLocalProductionWeights
                ? INFERENCE_PARAM_TOOLTIPS.weights
                : 'This model is proprietary / API-managed — local Hugging Face checkpoints do not apply.'
            }
            onClick={() => {
              if (!canUseLocalProductionWeights) return;
              setUseProductionWeights(!useProductionWeights);
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                Pretrained Model Checkpoint
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                {canUseLocalProductionWeights
                  ? INFERENCE_PARAM_TOOLTIPS.weights
                  : 'Unavailable for proprietary API models — use a Bedrock/cloud placement instead.'}
              </div>
            </div>
            <input
              type="checkbox"
              checked={useProductionWeights && canUseLocalProductionWeights}
              disabled={!canUseLocalProductionWeights}
              onChange={(e) => setUseProductionWeights(e.target.checked)}
              onClick={(e) => e.stopPropagation()}
              style={{
                accentColor: '#6366f1',
                width: '18px',
                height: '18px',
                cursor: canUseLocalProductionWeights ? 'pointer' : 'not-allowed',
              }}
            />
          </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                backgroundColor: '#1e293b',
                color: '#94a3b8',
                border: '1px solid #334155',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                backgroundColor: '#6366f1',
                color: '#ffffff',
                border: 'none',
                padding: '8px 20px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: isSubmitting ? 'wait' : 'pointer',
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting ? 'Enqueueing...' : 'Enqueue Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
