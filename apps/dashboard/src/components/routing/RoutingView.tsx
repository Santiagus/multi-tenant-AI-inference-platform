import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiClient } from '../../api/client';
import { SortableHeader, genericSort, type SortDirection } from '../common/SortableHeader';
import type { RoutingDecision } from '../../types';

export function RoutingView() {
  // Simulator inputs
  const [modelId, setModelId] = useState('meta-llama/Llama-3-8B-Instruct');
  const [promptTokens, setPromptTokens] = useState(16);
  const [maxNewTokens, setMaxNewTokens] = useState(64);
  const [estimatedVramMb, setEstimatedVramMb] = useState(8192);
  const [requiresVpc, setRequiresVpc] = useState(false);
  const [isProprietary, setIsProprietary] = useState(false);

  const [queueDepth, setQueueDepth] = useState(0);
  const [queueThreshold, setQueueThreshold] = useState(10);
  const [latencySloMs, setLatencySloMs] = useState(1500);

  const [routingPreference, setRoutingPreference] = useState('local_first');
  const [targetGrossMargin, setTargetGrossMargin] = useState(0.4);
  const [allowMarginDegradation, setAllowMarginDegradation] = useState(false);

  const [decision, setDecision] = useState<RoutingDecision | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sweep simulation state
  const [sweepResults, setSweepResults] = useState<Array<{
    queue_depth: number;
    selected_provider: string;
    decision_code: string;
    explanation: string;
    slo_risk_detected: boolean;
  }>>([]);
  const [isSweeping, setIsSweeping] = useState(false);

  const [sweepSortKey, setSweepSortKey] = useState<string>('queue_depth');
  const [sweepSortDir, setSweepSortDir] = useState<SortDirection>('asc');

  const handleSweepSort = (col: string) => {
    if (sweepSortKey === col) {
      setSweepSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSweepSortKey(col);
      setSweepSortDir('asc');
    }
  };

  const sortedSweepResults = useMemo(() => {
    return genericSort(sweepResults, sweepSortKey, sweepSortDir);
  }, [sweepResults, sweepSortKey, sweepSortDir]);

  const evaluate = useCallback(async () => {
    setIsEvaluating(true);
    setError(null);
    try {
      const res = await apiClient.evaluateRouting({
        workload: {
          model_id: modelId,
          prompt_tokens: promptTokens,
          max_new_tokens: maxNewTokens,
          estimated_vram_mb: estimatedVramMb,
          requires_vpc: requiresVpc,
          is_proprietary: isProprietary,
        },
        capacity: {
          local_vram_total_mb: 16384,
          local_vram_allocated_mb: 4096,
          local_queue_depth: queueDepth,
          local_queue_threshold: queueThreshold,
          worker_concurrency: 4,
          estimated_job_compute_ms: 150,
        },
        slo: {
          latency_slo_ms: latencySloMs,
        },
        tenant_policy: {
          tenant_id: 'tenant-default',
          routing_preference: routingPreference,
          max_cost_microcents: 500000,
          billed_rate_microcents_per_token: 40,
        },
        economics: {
          target_gross_margin: targetGrossMargin,
          allow_margin_degradation_for_slo: allowMarginDegradation,
        },
      });
      setDecision(res.decision);
    } catch (err: any) {
      setError(err?.message || 'Failed to evaluate routing decision');
    } finally {
      setIsEvaluating(false);
    }
  }, [
    modelId,
    promptTokens,
    maxNewTokens,
    estimatedVramMb,
    requiresVpc,
    isProprietary,
    queueDepth,
    queueThreshold,
    latencySloMs,
    routingPreference,
    targetGrossMargin,
    allowMarginDegradation,
  ]);

  const runSweep = async () => {
    setIsSweeping(true);
    try {
      const res = await apiClient.simulateRoutingSweep({
        workload: { model_id: modelId },
        queue_depth_range: [0, 2, 5, 8, 10, 12, 15, 20, 25, 30],
        tenant_policy: { routing_preference: routingPreference },
        economics: { target_gross_margin: targetGrossMargin },
      });
      setSweepResults(res.results);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsSweeping(false);
    }
  };

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Title */}
      <div>
        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
          Routing Decision Policy Engine &amp; Explainability Ledger
        </h2>
        <p style={{ fontSize: '13px', color: '#94a3b8', margin: '4px 0 0 0' }}>
          Deterministic 5-stage policy engine evaluating hardware constraints, queue depth, SLO risk, and FinOps margin protections.
        </p>
      </div>

      {/* Simulator Inputs & Decision Output Split */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: '20px' }}>
        {/* Controls Column */}
        <div
          style={{
            backgroundColor: '#0f172a',
            borderRadius: '12px',
            border: '1px solid #1e293b',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
            Policy Simulation Parameters
          </h3>

          {/* Model Presets */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
              Workload Model:
            </label>
            <select
              value={modelId}
              onChange={(e) => {
                const val = e.target.value;
                setModelId(val);
                if (val.includes('claude')) {
                  setIsProprietary(true);
                  setEstimatedVramMb(0);
                } else if (val.includes('CogVideoX')) {
                  setIsProprietary(false);
                  setEstimatedVramMb(18432);
                } else if (val.includes('TinyLlama')) {
                  setIsProprietary(false);
                  setEstimatedVramMb(2048);
                } else {
                  setIsProprietary(false);
                  setEstimatedVramMb(8192);
                }
              }}
              style={{
                width: '100%',
                backgroundColor: '#1e293b',
                color: '#f8fafc',
                border: '1px solid #334155',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '13px',
                outline: 'none',
              }}
            >
              <option value="meta-llama/Llama-3-8B-Instruct">meta-llama/Llama-3-8B-Instruct (Standard GPU)</option>
              <option value="TinyLlama/TinyLlama-1.1B-Chat-v1.0">TinyLlama/TinyLlama-1.1B-Chat-v1.0 (Low VRAM)</option>
              <option value="anthropic/claude-3-haiku">anthropic/claude-3-haiku (Proprietary Bedrock)</option>
              <option value="THUDM/CogVideoX-2b">THUDM/CogVideoX-2b (VRAM Overflow &gt; 16GB)</option>
            </select>
          </div>

          {/* Tokens Configuration */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
                Prompt Tokens:
              </label>
              <input
                type="number"
                min={1}
                value={promptTokens}
                onChange={(e) => setPromptTokens(Number(e.target.value))}
                style={{
                  width: '100%',
                  backgroundColor: '#1e293b',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '13px',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
                Max New Tokens:
              </label>
              <input
                type="number"
                min={1}
                value={maxNewTokens}
                onChange={(e) => setMaxNewTokens(Number(e.target.value))}
                style={{
                  width: '100%',
                  backgroundColor: '#1e293b',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '13px',
                }}
              />
            </div>
          </div>

          {/* Queue Depth Slider */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
              <span style={{ color: '#94a3b8', fontWeight: 600 }}>Local Queue Depth:</span>
              <span style={{ color: queueDepth >= queueThreshold ? '#f87171' : '#34d399', fontWeight: 700 }}>
                {queueDepth} jobs {queueDepth >= queueThreshold ? '(SATURATED)' : '(HEADROOM OK)'}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={30}
              value={queueDepth}
              onChange={(e) => setQueueDepth(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#6366f1' }}
            />
          </div>

          {/* Queue Threshold & SLO */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
                Queue Threshold:
              </label>
              <input
                type="number"
                value={queueThreshold}
                onChange={(e) => setQueueThreshold(Number(e.target.value))}
                style={{
                  width: '100%',
                  backgroundColor: '#1e293b',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '13px',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
                Latency SLO (ms):
              </label>
              <input
                type="number"
                value={latencySloMs}
                onChange={(e) => setLatencySloMs(Number(e.target.value))}
                style={{
                  width: '100%',
                  backgroundColor: '#1e293b',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '13px',
                }}
              />
            </div>
          </div>

          {/* Preference & Target Margin */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
                Routing Preference:
              </label>
              <select
                value={routingPreference}
                onChange={(e) => setRoutingPreference(e.target.value)}
                style={{
                  width: '100%',
                  backgroundColor: '#1e293b',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '13px',
                }}
              >
                <option value="local_first">local_first</option>
                <option value="cost_optimized">cost_optimized</option>
                <option value="latency_optimized">latency_optimized</option>
                <option value="auto">auto</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
                Target Margin (%):
              </label>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={targetGrossMargin}
                onChange={(e) => setTargetGrossMargin(Number(e.target.value))}
                style={{
                  width: '100%',
                  backgroundColor: '#1e293b',
                  color: '#f8fafc',
                  border: '1px solid #334155',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '13px',
                }}
              />
            </div>
          </div>

          {/* VPC & Degradation Toggles */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: '#e2e8f0' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={requiresVpc}
                onChange={(e) => setRequiresVpc(e.target.checked)}
              />
              Require Private VPC Endpoint (Triggers SageMaker / Local)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={allowMarginDegradation}
                onChange={(e) => setAllowMarginDegradation(e.target.checked)}
              />
              Allow Margin Degradation for SLO Risk Protection
            </label>
          </div>

          <button
            onClick={runSweep}
            disabled={isSweeping}
            style={{
              backgroundColor: '#1e293b',
              color: '#818cf8',
              border: '1px solid rgba(129, 140, 248, 0.3)',
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: isSweeping ? 'wait' : 'pointer',
              marginTop: '8px',
            }}
          >
            {isSweeping ? 'Sweeping...' : '📊 Run Queue Depth Spillover Sweep'}
          </button>
        </div>

        {/* Output & 5-Stage Ledger Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {isEvaluating && (
            <div style={{ fontSize: '12px', color: '#818cf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>⚡ Evaluating routing policy in real time...</span>
            </div>
          )}
          {error && (
            <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#f87171', padding: '12px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
              {error}
            </div>
          )}

          {decision && (
            <>
              {/* Selected Provider Card */}
              <div
                style={{
                  backgroundColor: '#0f172a',
                  borderRadius: '12px',
                  border: '1px solid #1e293b',
                  padding: '20px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 600 }}>
                    Selected Compute Provider
                  </div>
                  <span
                    style={{
                      padding: '3px 10px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(99, 102, 241, 0.2)',
                      color: '#a5b4fc',
                      fontWeight: 700,
                      fontSize: '11px',
                    }}
                  >
                    {decision.decisionCode}
                  </span>
                </div>

                <div style={{ fontSize: '24px', fontWeight: 800, color: '#34d399', textTransform: 'capitalize' }}>
                  {decision.selectedProvider.replace('_', ' ')}
                </div>

                <div
                  style={{
                    marginTop: '12px',
                    backgroundColor: '#1e293b',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    color: '#f8fafc',
                    fontFamily: 'monospace',
                    lineHeight: 1.4,
                  }}
                >
                  {decision.explanation}
                </div>
              </div>

              {/* 5-Stage Policy Ledger */}
              <div
                style={{
                  backgroundColor: '#0f172a',
                  borderRadius: '12px',
                  border: '1px solid #1e293b',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  5-Stage Explainability Evaluation Pipeline
                </div>

                {decision.stages.map((st, idx) => (
                  <div
                    key={st.stage}
                    style={{
                      backgroundColor: '#1e293b',
                      borderRadius: '8px',
                      padding: '12px 14px',
                      border: '1px solid #334155',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#f8fafc' }}>
                        {idx + 1}. {st.stage.replace(/_/g, ' ').toUpperCase()}
                      </span>
                      <span style={{ fontSize: '11px', color: '#10b981', fontWeight: 600 }}>
                        {st.passed.length} Passed
                      </span>
                    </div>

                    <div style={{ fontSize: '12px', color: '#94a3b8', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      <span>Passed:</span>
                      {st.passed.map((p) => (
                        <span key={p} style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#34d399', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                          {p}
                        </span>
                      ))}
                    </div>

                    {st.rejected.length > 0 && (
                      <div style={{ marginTop: '6px', fontSize: '11px', color: '#f87171' }}>
                        {st.rejected.map((r) => (
                          <div key={r.provider}>
                            ✕ <strong>{r.provider}:</strong> {r.reason} ({r.details})
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Sweep Results Display */}
      {sweepResults.length > 0 && (
        <div
          style={{
            backgroundColor: '#0f172a',
            borderRadius: '12px',
            border: '1px solid #1e293b',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              Queue Depth Threshold Spillover Sweep Results
            </h3>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0 0' }}>
              Reveals the exact queue depth at which local worker capacity saturates and workloads automatically spill over to cloud GPU.
            </p>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
              <thead>
                <tr style={{ backgroundColor: '#1e293b', color: '#94a3b8' }}>
                  <SortableHeader
                    column="queue_depth"
                    currentSortKey={sweepSortKey}
                    currentSortDir={sweepSortDir}
                    onSort={handleSweepSort}
                    style={{ padding: '10px 14px' }}
                  >
                    Queue Depth
                  </SortableHeader>
                  <SortableHeader
                    column="selected_provider"
                    currentSortKey={sweepSortKey}
                    currentSortDir={sweepSortDir}
                    onSort={handleSweepSort}
                    style={{ padding: '10px 14px' }}
                  >
                    Selected Provider
                  </SortableHeader>
                  <SortableHeader
                    column="decision_code"
                    currentSortKey={sweepSortKey}
                    currentSortDir={sweepSortDir}
                    onSort={handleSweepSort}
                    style={{ padding: '10px 14px' }}
                  >
                    Decision Code
                  </SortableHeader>
                  <SortableHeader
                    column="slo_risk_detected"
                    currentSortKey={sweepSortKey}
                    currentSortDir={sweepSortDir}
                    onSort={handleSweepSort}
                    style={{ padding: '10px 14px' }}
                  >
                    SLO Risk Detected
                  </SortableHeader>
                  <SortableHeader
                    column="explanation"
                    currentSortKey={sweepSortKey}
                    currentSortDir={sweepSortDir}
                    onSort={handleSweepSort}
                    style={{ padding: '10px 14px' }}
                  >
                    Explanation
                  </SortableHeader>
                </tr>
              </thead>
              <tbody>
                {sortedSweepResults.map((r) => (
                  <tr key={r.queue_depth} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '10px 14px', fontWeight: 700, color: '#f8fafc' }}>
                      {r.queue_depth} jobs
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontWeight: 600,
                          backgroundColor: r.selected_provider === 'local_pytorch' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(129, 140, 248, 0.15)',
                          color: r.selected_provider === 'local_pytorch' ? '#34d399' : '#818cf8',
                        }}
                      >
                        {r.selected_provider}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#94a3b8' }}>
                      {r.decision_code}
                    </td>
                    <td style={{ padding: '10px 14px', color: r.slo_risk_detected ? '#f87171' : '#34d399', fontWeight: 600 }}>
                      {r.slo_risk_detected ? 'YES' : 'NO'}
                    </td>
                    <td style={{ padding: '10px 14px', color: '#cbd5e1', fontSize: '11px', fontFamily: 'monospace' }}>
                      {r.explanation}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
