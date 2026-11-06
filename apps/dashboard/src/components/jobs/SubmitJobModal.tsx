import { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import type { RoutingPreference, ModelCloudOptionsResponse, CloudOption } from '../../types';

interface SubmitJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    model_id: string;
    routing_preference: RoutingPreference;
    priority: number;
    max_retries: number;
    input: { prompt: string };
  }) => Promise<void>;
}

const POPULAR_MODELS = [
  { id: 'meta-llama/Llama-3-8B-Instruct', label: 'Llama 3 8B Instruct (Text / General)', purpose: 'text_to_text' },
  { id: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0', label: 'TinyLlama 1.1B Chat (Low Latency)', purpose: 'text_to_text' },
  { id: 'mistralai/Mistral-7B-Instruct-v0.2', label: 'Mistral 7B Instruct v0.2 (Text)', purpose: 'text_to_text' },
  { id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek-R1 Distill 70B (Code & Reasoning)', purpose: 'code_reasoning' },
  { id: 'runwayml/stable-diffusion-v1-5', label: 'Stable Diffusion v1.5 (Image Gen)', purpose: 'text_to_image' },
  { id: 'stabilityai/stable-diffusion-xl-base-1.0', label: 'SDXL Base 1.0 (High-Res Image)', purpose: 'text_to_image' },
  { id: 'THUDM/CogVideoX-5b', label: 'CogVideoX 5B (Text-to-Video)', purpose: 'text_to_video' },
  { id: 'openai/whisper-large-v3', label: 'Whisper Large v3 (Audio Speech-to-Text)', purpose: 'speech_to_text' },
  { id: 'anthropic/claude-3-haiku', label: 'Claude 3 Haiku (AWS Bedrock / Proprietary)', purpose: 'text_to_text' },
];

export function SubmitJobModal({ isOpen, onClose, onSubmit }: SubmitJobModalProps) {
  const [purposeFilter, setPurposeFilter] = useState<string>('all');
  const [modelId, setModelId] = useState(POPULAR_MODELS[0].id);
  const [customModel, setCustomModel] = useState('');
  const [prompt, setPrompt] = useState('Explain how multi-tenant AI inference routing protects gross margin.');
  const [routingPreference, setRoutingPreference] = useState<RoutingPreference>('auto');
  const [priority, setPriority] = useState(5);
  const [maxRetries, setMaxRetries] = useState(3);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredPopularModels = POPULAR_MODELS.filter((m) => {
    if (purposeFilter !== 'all' && m.purpose !== purposeFilter) return false;
    return true;
  });

  // Smart Cloud Option Recommendations
  const [recommendations, setRecommendations] = useState<ModelCloudOptionsResponse | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    const finalModel = customModel.trim() || modelId;
    setIsLoadingRecs(true);

    apiClient
      .getCloudRecommendations({ model_id: finalModel, prompt_tokens: 128, max_new_tokens: 64 })
      .then((res) => {
        if (isMounted) {
          setRecommendations(res);
          if (res.recommendations?.recommended) {
            setSelectedOptionId(res.recommendations.recommended.id);
            setRoutingPreference(res.recommendations.recommended.routingPreference as RoutingPreference);
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
  }, [isOpen, modelId, customModel]);

  if (!isOpen) return null;

  const handleSelectOption = (option: CloudOption) => {
    setSelectedOptionId(option.id);
    setRoutingPreference(option.routingPreference as RoutingPreference);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const finalModel = customModel.trim() || modelId;

    try {
      await onSubmit({
        model_id: finalModel,
        routing_preference: routingPreference,
        priority,
        max_retries: maxRetries,
        input: { prompt },
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit inference job');
    } finally {
      setIsSubmitting(false);
    }
  };

  const recList = recommendations?.recommendations
    ? [
        { key: 'cheapest', label: '💰 Cheapest', item: recommendations.recommendations.cheapest, color: '#10b981' },
        { key: 'fastest', label: '⚡ Fastest', item: recommendations.recommendations.fastest, color: '#3b82f6' },
        { key: 'balanced', label: '⚖️ Balanced', item: recommendations.recommendations.balanced, color: '#8b5cf6' },
        { key: 'recommended', label: '⭐ Recommended', item: recommendations.recommendations.recommended, color: '#f59e0b' },
      ]
    : [];

  const selectedOpt = recommendations?.allOptions.find((o) => o.id === selectedOptionId);

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
          maxWidth: '720px',
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
              Multi-cloud runtime analyzer: compares execution speed, hourly spot rates, and scale-to-zero cost.
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

          {/* Purpose Filter Pills */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
              Model Purpose Filter:
            </label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[
                { id: 'all', label: 'All' },
                { id: 'text_to_text', label: '💬 Text LLM' },
                { id: 'text_to_image', label: '🎨 Image Gen' },
                { id: 'text_to_video', label: '🎬 Video' },
                { id: 'speech_to_text', label: '🎙️ Audio' },
                { id: 'code_reasoning', label: '⚡ Code' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setPurposeFilter(p.id);
                    const matching = POPULAR_MODELS.filter((m) => p.id === 'all' || m.purpose === p.id);
                    if (matching.length > 0 && !matching.some((m) => m.id === modelId)) {
                      setModelId(matching[0].id);
                    }
                  }}
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

          {/* Model Selection */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
                Popular Model Catalog:
              </label>
              <select
                value={modelId}
                onChange={(e) => {
                  setModelId(e.target.value);
                  setCustomModel('');
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
                {filteredPopularModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#64748b', marginBottom: '6px' }}>
                Or Custom Model ID:
              </label>
              <input
                type="text"
                placeholder="e.g. meta-llama/Llama-3-70b"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
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
              />
            </div>
          </div>

          {/* Smart Cloud Options Header */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label style={{ fontSize: '13px', color: '#f8fafc', fontWeight: 700 }}>
                Smart Cloud Options for {(customModel || modelId).split('/').pop()}
              </label>
              {isLoadingRecs && (
                <span style={{ fontSize: '11px', color: '#60a5fa' }}>Evaluating live catalogs...</span>
              )}
            </div>

            {/* Recommendations Grid */}
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
                const isSelected = selectedOptionId === item.id;
                return (
                  <div
                    key={key}
                    onClick={() => handleSelectOption(item)}
                    style={{
                      backgroundColor: isSelected ? '#1e293b' : '#0f172a',
                      border: `1.5px solid ${isSelected ? color : '#334155'}`,
                      borderRadius: '8px',
                      padding: '10px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? `0 0 10px ${color}30` : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ color, fontSize: '11px', fontWeight: 700 }}>{label}</span>
                      {isSelected && <span style={{ color, fontSize: '11px' }}>✓</span>}
                    </div>
                    <div style={{ color: '#f8fafc', fontWeight: 600, fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.displayName}
                    </div>
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

            {/* Selected Option Insight Banner */}
            {selectedOpt && (
              <div
                style={{
                  backgroundColor: '#1e293b80',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  fontSize: '11px',
                  color: '#cbd5e1',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <span style={{ fontSize: '14px' }}>💡</span>
                <div>
                  <span style={{ fontWeight: 600, color: '#f8fafc' }}>{selectedOpt.displayName}: </span>
                  {selectedOpt.finopsInsight}
                </div>
              </div>
            )}
          </div>

          {/* Prompt */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
              Inference Prompt:
            </label>
            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
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

          {/* Routing Preference & Priority */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
                Routing Strategy / Override:
              </label>
              <select
                value={routingPreference}
                onChange={(e) => {
                  setRoutingPreference(e.target.value as RoutingPreference);
                  setSelectedOptionId(null);
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
                <option value="auto">auto (Deterministic Engine)</option>
                <option value="local_first">local_first (Local RTX 5070 Ti)</option>
                <option value="cost_optimized">cost_optimized (Lowest Cost)</option>
                <option value="low_latency">low_latency (SLO Priority)</option>
                <option value="local/gpu">local/gpu (Force Local)</option>
                <option value="cloud/runpod">cloud/runpod (RunPod GPU)</option>
                <option value="cloud/bedrock">cloud/bedrock (AWS Bedrock)</option>
                <option value="cloud/sagemaker">cloud/sagemaker (Private VPC)</option>
                <option value="mock">mock (Instant Test)</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
                Priority &amp; Retries:
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <select
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  style={{
                    flex: 1,
                    backgroundColor: '#1e293b',
                    color: '#f8fafc',
                    border: '1px solid #334155',
                    padding: '8px 8px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                  title="Queue priority (1-10)"
                >
                  <option value={1}>P1 (Lowest)</option>
                  <option value={5}>P5 (Standard)</option>
                  <option value={8}>P8 (High)</option>
                  <option value={10}>P10 (Urgent)</option>
                </select>
                <select
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(Number(e.target.value))}
                  style={{
                    flex: 1,
                    backgroundColor: '#1e293b',
                    color: '#f8fafc',
                    border: '1px solid #334155',
                    padding: '8px 8px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                  title="Max Retries before DLQ"
                >
                  <option value={0}>0 Retries</option>
                  <option value={1}>1 Retry</option>
                  <option value={3}>3 Retries</option>
                  <option value={5}>5 Retries</option>
                </select>
              </div>
            </div>
          </div>

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
