import { useState } from 'react';
import type { ProviderFleetStatus, PricingSyncAudit } from '../../types';

interface ProviderFleetBarProps {
  syncAudits: PricingSyncAudit[];
  onRefreshSync?: () => void;
  isSyncing?: boolean;
}

export const DEFAULT_PROVIDER_FLEET: ProviderFleetStatus[] = [
  {
    provider: 'runpod',
    displayName: 'RunPod',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 90 * 1000).toISOString(),
    updateCadenceCategory: 'realtime_auction',
    updateFrequencyDescription: 'Live Spot Auction & Community Pods',
    estimatedUpdateIntervalSec: 120,
    allowedPricingModels: ['on_demand', 'spot', 'serverless'],
    availableCreditsUsd: 15.0,
    creditType: 'prepaid_credits',
    interruptionRiskTier: '<5% risk',
    interruptionNoticeWindow: '2-min grace notice',
    websiteUrl: 'https://www.runpod.io/',
    pricingUrl: 'https://www.runpod.io/pricing',
    spotPricingUrl: 'https://docs.runpod.io/pods/pricing#spot-instances',
    billingUrl: 'https://www.runpod.io/console/user/billing',
    syncDocUrl: 'https://docs.runpod.io/reference/graphql-api',
    cadenceDocUrl: 'https://docs.runpod.io/pods/overview',
    cadenceExplanation: 'Real-time Auction: Live bid-based market clearing prices for community and secure pods, adjusting dynamically with GPU cluster load.',
    spotPolicy: {
      noticeWindowMinutes: 2,
      noticeWindowLabel: '2m grace notice',
      pricingType: 'floating_bid',
      pricingTypeLabel: 'Floating Bid',
      description: '2-minute preemption SIGTERM grace period before instance shutdown. Spot bids dynamically clear based on community capacity.',
    },
  },
  {
    provider: 'vast_ai',
    displayName: 'Vast.ai',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 45 * 1000).toISOString(),
    updateCadenceCategory: 'realtime_auction',
    updateFrequencyDescription: 'Unregulated Spot Bid & Auction Market',
    estimatedUpdateIntervalSec: 60,
    allowedPricingModels: ['on_demand', 'spot'],
    availableCreditsUsd: 84.2,
    creditType: 'prepaid_credits',
    interruptionRiskTier: '5-10% risk',
    interruptionNoticeWindow: 'Instant on outbid threshold',
    websiteUrl: 'https://vast.ai/',
    pricingUrl: 'https://cloud.vast.ai/create/',
    spotPricingUrl: 'https://vast.ai/docs/overview/pricing#interruptible-instances',
    billingUrl: 'https://cloud.vast.ai/billing/',
    syncDocUrl: 'https://vast.ai/docs/api/pricing',
    cadenceDocUrl: 'https://vast.ai/docs/overview/pricing',
    cadenceExplanation: 'Real-time Auction: Unregulated, decentralized marketplace where host providers set reserve rates and users bid continuously.',
    spotPolicy: {
      noticeWindowMinutes: 0,
      noticeWindowLabel: '0m instant outbid',
      pricingType: 'floating_bid',
      pricingTypeLabel: 'Floating Bid',
      description: 'Immediate eviction when outbid by another tenant placing a higher max bid. Best for stateless jobs or frequent checkpoints.',
    },
  },
  {
    provider: 'baseten',
    displayName: 'Baseten',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 300 * 1000).toISOString(),
    updateCadenceCategory: 'dynamic_shifts',
    updateFrequencyDescription: 'Scale-to-Zero Micro-Metered Serverless',
    estimatedUpdateIntervalSec: 600,
    allowedPricingModels: ['serverless', 'on_demand'],
    availableCreditsUsd: 250.0,
    creditType: 'prepaid_credits',
    interruptionRiskTier: 'Guaranteed (0%)',
    interruptionNoticeWindow: 'Zero interruption (Dedicated)',
    websiteUrl: 'https://www.baseten.co/',
    pricingUrl: 'https://www.baseten.co/pricing/',
    spotPricingUrl: 'https://docs.baseten.co/deploying-models/autoscaling',
    billingUrl: 'https://app.baseten.co/settings/billing',
    syncDocUrl: 'https://docs.baseten.co/api-reference',
    cadenceDocUrl: 'https://docs.baseten.co/models/scaling',
    cadenceExplanation: 'Dynamic Shifts: Micro-metered serverless model invocation with scale-to-zero autoscaling. Billed per millisecond of model execution.',
    spotPolicy: {
      noticeWindowMinutes: 0,
      noticeWindowLabel: 'Dedicated (0m)',
      pricingType: 'fixed_discount',
      pricingTypeLabel: 'Fixed Discount',
      description: 'Dedicated micro-metered serverless endpoints. No spot preemption; scales automatically down to zero when idle.',
    },
  },
  {
    provider: 'nebius',
    displayName: 'Nebius AI Studio',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 210 * 1000).toISOString(),
    updateCadenceCategory: 'dynamic_shifts',
    updateFrequencyDescription: 'Tier 3+ Neocloud Capacity & Preemptible',
    estimatedUpdateIntervalSec: 300,
    allowedPricingModels: ['on_demand', 'spot'],
    availableCreditsUsd: 120.0,
    creditType: 'prepaid_credits',
    interruptionRiskTier: '<5% risk',
    interruptionNoticeWindow: '30-sec SIGTERM notice',
    websiteUrl: 'https://nebius.com/studio/inference',
    pricingUrl: 'https://nebius.com/pricing',
    spotPricingUrl: 'https://docs.nebius.com/compute/pricing#preemptible-vms',
    billingUrl: 'https://console.nebius.com/billing',
    syncDocUrl: 'https://docs.nebius.com/api-reference',
    cadenceDocUrl: 'https://docs.nebius.com/compute/concepts/preemptible-vms',
    cadenceExplanation: 'Dynamic Shifts: Neocloud tier-3+ datacenter capacity, updating preemptible inventory and token factory endpoints continuously.',
    spotPolicy: {
      noticeWindowMinutes: 0.5,
      noticeWindowLabel: '30s SIGTERM notice',
      pricingType: 'dynamic_fixed',
      pricingTypeLabel: 'Dynamic Fixed',
      description: 'Preemptible VMs offer ~50% fixed discount. Terminated with 30-second ACPI/SIGTERM shutdown signal when capacity is reclaimed.',
    },
  },
  {
    provider: 'jarvislabs',
    displayName: 'JarvisLabs',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 150 * 1000).toISOString(),
    updateCadenceCategory: 'realtime_auction',
    updateFrequencyDescription: 'Token Factory MaaS & Instant Pods',
    estimatedUpdateIntervalSec: 180,
    allowedPricingModels: ['token_factory', 'on_demand', 'spot'],
    availableCreditsUsd: 50.0,
    creditType: 'prepaid_credits',
    interruptionRiskTier: '<5% risk',
    interruptionNoticeWindow: '2-min grace notice',
    websiteUrl: 'https://jarvislabs.ai/',
    pricingUrl: 'https://jarvislabs.ai/pricing/',
    spotPricingUrl: 'https://jarvislabs.ai/docs/faq/',
    billingUrl: 'https://jarvislabs.ai/dashboard/billing',
    syncDocUrl: 'https://jarvislabs.ai/docs/cli/',
    cadenceDocUrl: 'https://jarvislabs.ai/docs/',
    cadenceExplanation: 'Real-time Auction: Instant GPU pods and Token Factory MaaS with transparent hourly pricing updated on demand trends.',
    spotPolicy: {
      noticeWindowMinutes: 2,
      noticeWindowLabel: '2m grace notice',
      pricingType: 'floating_bid',
      pricingTypeLabel: 'Floating Bid',
      description: 'Spot pods paused on capacity pressure with 2-minute alert. State preserved on persistent volume for resumption.',
    },
  },
  {
    provider: 'coreweave',
    displayName: 'CoreWeave Forge',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 120 * 1000).toISOString(),
    updateCadenceCategory: 'dynamic_shifts',
    updateFrequencyDescription: 'Kubernetes Cloud GPU & Interruptible Virtual Servers',
    estimatedUpdateIntervalSec: 300,
    allowedPricingModels: ['on_demand', 'spot', 'serverless'],
    availableCreditsUsd: 175.0,
    creditType: 'prepaid_credits',
    interruptionRiskTier: '<5% risk',
    interruptionNoticeWindow: '2-min K8s grace',
    websiteUrl: 'https://www.coreweave.com/',
    pricingUrl: 'https://www.coreweave.com/pricing',
    spotPricingUrl: 'https://docs.coreweave.com/coreweave-kubernetes-service-cks/interruptible-virtual-servers',
    billingUrl: 'https://cloud.coreweave.com/billing',
    syncDocUrl: 'https://docs.coreweave.com/',
    cadenceDocUrl: 'https://docs.coreweave.com/',
    cadenceExplanation: 'Dynamic Shifts: Specialized modern GPU cloud with Kubernetes native orchestration and interruptible virtual servers.',
    spotPolicy: {
      noticeWindowMinutes: 2,
      noticeWindowLabel: '2m K8s grace',
      pricingType: 'fixed_discount',
      pricingTypeLabel: 'Fixed Discount',
      description: 'Interruptible nodes receive standard Kubernetes eviction notice with a 2-minute preemption window before pod SIGKILL.',
    },
  },
  {
    provider: 'fal',
    displayName: 'fal.ai',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 180 * 1000).toISOString(),
    updateCadenceCategory: 'dynamic_shifts',
    updateFrequencyDescription: 'Real-Time Diffusion & Media Inference',
    estimatedUpdateIntervalSec: 300,
    allowedPricingModels: ['pay_per_call'],
    availableCreditsUsd: 45.0,
    creditType: 'prepaid_credits',
    interruptionRiskTier: 'Guaranteed (0%)',
    interruptionNoticeWindow: 'Zero interruption (API)',
    websiteUrl: 'https://fal.ai/',
    pricingUrl: 'https://fal.ai/pricing',
    spotPricingUrl: 'https://fal.ai/pricing',
    billingUrl: 'https://fal.ai/dashboard/billing',
    syncDocUrl: 'https://fal.ai/docs',
    cadenceDocUrl: 'https://fal.ai/docs',
    cadenceExplanation: 'Dynamic Shifts: Ultra-low latency diffusion and media model inference API, micro-metered per mega-pixel and invocation.',
    spotPolicy: {
      noticeWindowMinutes: 0,
      noticeWindowLabel: 'Zero interruption (API)',
      pricingType: 'guaranteed',
      pricingTypeLabel: 'Guaranteed',
      description: 'Serverless execution engine with strict enterprise SLA. No preemption or eviction.',
    },
  },
  {
    provider: 'runware',
    displayName: 'Runware',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 240 * 1000).toISOString(),
    updateCadenceCategory: 'dynamic_shifts',
    updateFrequencyDescription: 'Shared Serverless Engine per Megapixel',
    estimatedUpdateIntervalSec: 300,
    allowedPricingModels: ['pay_per_call', 'serverless'],
    availableCreditsUsd: 35.0,
    creditType: 'prepaid_credits',
    interruptionRiskTier: 'Guaranteed (0%)',
    interruptionNoticeWindow: 'Zero interruption (API)',
    websiteUrl: 'https://runware.ai/',
    pricingUrl: 'https://runware.ai/pricing',
    spotPricingUrl: 'https://runware.ai/pricing',
    billingUrl: 'https://runware.ai/dashboard/billing',
    syncDocUrl: 'https://docs.runware.ai/',
    cadenceDocUrl: 'https://docs.runware.ai/',
    cadenceExplanation: 'Dynamic Shifts: High-throughput shared serverless inference engine with sub-second image generation pricing per unit.',
    spotPolicy: {
      noticeWindowMinutes: 0,
      noticeWindowLabel: 'Zero interruption (API)',
      pricingType: 'guaranteed',
      pricingTypeLabel: 'Guaranteed',
      description: 'Shared GPU worker pool with zero cold starts and sub-second execution SLAs.',
    },
  },
  {
    provider: 'hivenet',
    displayName: 'Hivenet',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    updateCadenceCategory: 'realtime_auction',
    updateFrequencyDescription: 'Decentralized P2P Compute & Elastic Spot Grid',
    estimatedUpdateIntervalSec: 60,
    allowedPricingModels: ['spot', 'on_demand'],
    availableCreditsUsd: 65.0,
    creditType: 'prepaid_credits',
    interruptionRiskTier: '5-10% risk',
    interruptionNoticeWindow: '1-min node drain',
    websiteUrl: 'https://www.hivenet.com/',
    pricingUrl: 'https://www.hivenet.com/pricing',
    spotPricingUrl: 'https://www.hivenet.com/technology',
    billingUrl: 'https://app.hivenet.com/billing',
    syncDocUrl: 'https://docs.hivenet.com/',
    cadenceDocUrl: 'https://docs.hivenet.com/',
    cadenceExplanation: 'Real-time Auction: Distributed peer-to-peer compute grid with dynamic crowd-sourced GPU pricing and heartbeat routing.',
    spotPolicy: {
      noticeWindowMinutes: 1,
      noticeWindowLabel: '1m node drain',
      pricingType: 'floating_bid',
      pricingTypeLabel: 'Floating Bid',
      description: 'Decentralized nodes emit 60-second drain warning upon disconnect or host preemption; automatically routed to peer.',
    },
  },
  {
    provider: 'wavespeed',
    displayName: 'WaveSpeed AI',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 180 * 1000).toISOString(),
    updateCadenceCategory: 'dynamic_shifts',
    updateFrequencyDescription: 'Sub-Second Accelerated Media & Token Engine',
    estimatedUpdateIntervalSec: 180,
    allowedPricingModels: ['serverless', 'pay_per_call'],
    availableCreditsUsd: 80.0,
    creditType: 'prepaid_credits',
    interruptionRiskTier: 'Guaranteed (0%)',
    interruptionNoticeWindow: 'Zero interruption (API)',
    websiteUrl: 'https://wavespeed.ai/',
    pricingUrl: 'https://wavespeed.ai/pricing',
    spotPricingUrl: 'https://wavespeed.ai/pricing',
    billingUrl: 'https://wavespeed.ai/dashboard/billing',
    syncDocUrl: 'https://docs.wavespeed.ai/',
    cadenceDocUrl: 'https://docs.wavespeed.ai/',
    cadenceExplanation: 'Dynamic Shifts: Accelerated serverless media and LLM inference engine with per-second micro-metering.',
    spotPolicy: {
      noticeWindowMinutes: 0,
      noticeWindowLabel: 'Zero interruption (API)',
      pricingType: 'guaranteed',
      pricingTypeLabel: 'Guaranteed',
      description: 'Ultra-fast API gateway backed by dedicated acceleration clusters with 99.9% uptime.',
    },
  },
  {
    provider: 'neocloudz',
    displayName: 'NeoCloudz',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 360 * 1000).toISOString(),
    updateCadenceCategory: 'scheduled',
    updateFrequencyDescription: 'Private Enterprise Bare-Metal & Scheduled Cluster',
    estimatedUpdateIntervalSec: 1800,
    allowedPricingModels: ['on_demand', 'spot'],
    availableCreditsUsd: 110.0,
    creditType: 'prepaid_credits',
    interruptionRiskTier: '<5% risk',
    interruptionNoticeWindow: '5-min graceful notice',
    websiteUrl: 'https://neocloudz.com/',
    pricingUrl: 'https://neocloudz.com/pricing',
    spotPricingUrl: 'https://neocloudz.com/pricing',
    billingUrl: 'https://portal.neocloudz.com/billing',
    syncDocUrl: 'https://docs.neocloudz.com/api',
    cadenceDocUrl: 'https://docs.neocloudz.com/',
    cadenceExplanation: 'Scheduled: Multi-tenant tier-3 datacenter cluster with predictable scheduled rate synchronization.',
    spotPolicy: {
      noticeWindowMinutes: 5,
      noticeWindowLabel: '5m graceful notice',
      pricingType: 'dynamic_fixed',
      pricingTypeLabel: 'Dynamic Fixed',
      description: '5-minute notice period before spot eviction; spot discount is dynamic fixed at 40% below on-demand.',
    },
  },
  {
    provider: 'bedrock',
    displayName: 'AWS Bedrock',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 900 * 1000).toISOString(),
    updateCadenceCategory: 'scheduled',
    updateFrequencyDescription: 'AWS Foundation Model Enterprise API',
    estimatedUpdateIntervalSec: 3600,
    allowedPricingModels: ['token_factory', 'on_demand'],
    availableCreditsUsd: null,
    creditType: 'postpaid_invoice',
    interruptionRiskTier: 'Guaranteed (0%)',
    interruptionNoticeWindow: 'Zero interruption (Enterprise SLA)',
    websiteUrl: 'https://aws.amazon.com/bedrock/',
    pricingUrl: 'https://aws.amazon.com/bedrock/pricing/',
    spotPricingUrl: 'https://aws.amazon.com/bedrock/pricing/',
    billingUrl: 'https://console.aws.amazon.com/billing/home',
    syncDocUrl: 'https://docs.aws.amazon.com/bedrock/',
    cadenceDocUrl: 'https://aws.amazon.com/bedrock/sla/',
    cadenceExplanation: 'Scheduled: Managed foundation model endpoints with published per-million token pricing and multi-AZ failover.',
    spotPolicy: {
      noticeWindowMinutes: 0,
      noticeWindowLabel: 'Enterprise SLA (0m)',
      pricingType: 'guaranteed',
      pricingTypeLabel: 'Guaranteed',
      description: 'Managed foundation model API backed by AWS enterprise 99.9% availability SLA. Zero preemption.',
    },
  },
  {
    provider: 'sagemaker',
    displayName: 'AWS SageMaker',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date(Date.now() - 900 * 1000).toISOString(),
    updateCadenceCategory: 'scheduled',
    updateFrequencyDescription: 'Managed EKS / SageMaker GPU Endpoints',
    estimatedUpdateIntervalSec: 3600,
    allowedPricingModels: ['on_demand', 'spot'],
    availableCreditsUsd: null,
    creditType: 'postpaid_invoice',
    interruptionRiskTier: '<5% risk',
    interruptionNoticeWindow: '2-min AWS Spot warning',
    websiteUrl: 'https://aws.amazon.com/sagemaker/',
    pricingUrl: 'https://aws.amazon.com/sagemaker/pricing/',
    spotPricingUrl: 'https://aws.amazon.com/ec2/spot/pricing/',
    billingUrl: 'https://console.aws.amazon.com/billing/home',
    syncDocUrl: 'https://docs.aws.amazon.com/sagemaker/',
    cadenceDocUrl: 'https://docs.aws.amazon.com/sagemaker/latest/dg/model-managed-spot-training.html',
    cadenceExplanation: 'Scheduled: Managed EKS / SageMaker GPU endpoints, synchronized with AWS EC2 Pricing API hourly.',
    spotPolicy: {
      noticeWindowMinutes: 2,
      noticeWindowLabel: '2m AWS Spot warning',
      pricingType: 'dynamic_fixed',
      pricingTypeLabel: 'Dynamic Fixed',
      description: 'AWS EC2 Spot warning delivered 2 minutes prior to instance reclamation via Amazon CloudWatch and instance metadata.',
    },
  },
  {
    provider: 'local_pytorch',
    displayName: 'Local PyTorch (RTX 5070 Ti)',
    isHealthy: true,
    syncStatus: 'live',
    lastSyncedAt: new Date().toISOString(),
    updateCadenceCategory: 'realtime_auction',
    updateFrequencyDescription: 'Dedicated Workstation GPU & Worker',
    estimatedUpdateIntervalSec: 1,
    allowedPricingModels: ['local'],
    availableCreditsUsd: 0,
    creditType: 'zero_commitment',
    interruptionRiskTier: 'Guaranteed (0%)',
    interruptionNoticeWindow: 'Dedicated local process',
    websiteUrl: '#local-workstation',
    pricingUrl: '#local-hardware',
    spotPricingUrl: '#local-hardware',
    billingUrl: '#zero-cloud-spend',
    syncDocUrl: 'http://localhost:3000/metrics',
    cadenceDocUrl: '#workstation-daemon',
    cadenceExplanation: 'Real-time Local: Dedicated workstation GPU (NVIDIA RTX 5070 Ti 16GB) running on local host with zero network latency.',
    spotPolicy: {
      noticeWindowMinutes: 0,
      noticeWindowLabel: 'Dedicated local process',
      pricingType: 'guaranteed',
      pricingTypeLabel: 'Guaranteed',
      description: 'Dedicated workstation hardware under 100% tenant control. Zero interruption and zero cloud egress cost.',
    },
  },
];

export function ProviderFleetBar({
  syncAudits,
  onRefreshSync,
  isSyncing = false,
}: ProviderFleetBarProps) {
  const [selectedProviderDetail, setSelectedProviderDetail] = useState<ProviderFleetStatus | null>(null);

  // Merge dynamic sync audits with baseline providers
  const providers = DEFAULT_PROVIDER_FLEET.map((p) => {
    const audit = syncAudits.find((a) => a.provider.toLowerCase() === p.provider.toLowerCase());
    if (audit) {
      return {
        ...p,
        lastSyncedAt: audit.syncedAt,
        updateFrequencyDescription: audit.updateFrequencyDescription || p.updateFrequencyDescription,
        estimatedUpdateIntervalSec: audit.estimatedUpdateIntervalSec || p.estimatedUpdateIntervalSec,
        updateCadenceCategory: audit.updateCadenceCategory || p.updateCadenceCategory,
      };
    }
    return p;
  });

  const totalPrepaidCredits = providers.reduce(
    (acc, p) => acc + (p.availableCreditsUsd !== null ? p.availableCreditsUsd : 0),
    0
  );

  return (
    <div
      style={{
        backgroundColor: '#0f172a',
        borderRadius: '12px',
        border: '1px solid #1e293b',
        padding: '18px 20px',
        marginBottom: '24px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      }}
    >
      {/* Top Banner Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '16px',
          paddingBottom: '12px',
          borderBottom: '1px solid #1e293b',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: '#10b981',
              boxShadow: '0 0 10px #10b981',
            }}
          />
          <div>
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc' }}>
              Multi-Cloud Provider Fleet &amp; Real-Time Sync Status
            </span>
            <span
              style={{
                marginLeft: '10px',
                fontSize: '12px',
                color: '#94a3b8',
              }}
            >
              {providers.length} Managed Inference Engines Active
            </span>
            {/* Connected Observability Exporter Badge */}
            <a
              href="https://wandb.ai/"
              target="_blank"
              rel="noopener noreferrer"
              title="Weights & Biases (Weave) is configured via WANDB_API_KEY in .env as the live OpenTelemetry trace and prompt evaluation sink."
              style={{
                marginLeft: '12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                backgroundColor: 'rgba(245, 158, 11, 0.12)',
                color: '#fbbf24',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '11px',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              📊 W&amp;B Weave Tracing ↗
            </a>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
              Neocloud Prepaid Pool
            </div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#34d399' }}>
              ${totalPrepaidCredits.toFixed(2)}{' '}
              <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 400 }}>+ AWS Postpaid</span>
            </div>
          </div>

          {onRefreshSync && (
            <button
              onClick={onRefreshSync}
              disabled={isSyncing}
              style={{
                backgroundColor: '#1e293b',
                color: '#38bdf8',
                border: '1px solid #0284c7',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: isSyncing ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ display: 'inline-block', transform: isSyncing ? 'rotate(180deg)' : 'none', transition: 'transform 0.5s' }}>
                ↻
              </span>
              {isSyncing ? 'Syncing...' : 'Sync Fleet'}
            </button>
          )}
        </div>
      </div>

      {/* Provider Fleet Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '12px',
        }}
      >
        {providers.map((p) => {
          const isSelected = selectedProviderDetail?.provider === p.provider;
          const cadenceColor =
            p.updateCadenceCategory === 'realtime_auction'
              ? '#10b981'
              : p.updateCadenceCategory === 'dynamic_shifts'
                ? '#38bdf8'
                : '#a78bfa';

          return (
            <div
              key={p.provider}
              onClick={() => setSelectedProviderDetail(isSelected ? null : p)}
              style={{
                backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.08)' : '#1e293b40',
                border: `1px solid ${isSelected ? '#38bdf8' : '#334155'}`,
                borderRadius: '8px',
                padding: '12px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.borderColor = '#475569';
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.borderColor = '#334155';
              }}
            >
              {/* Row 1: Provider Name (Link to Homepage) and Cadence Badge (Link with Tooltip) */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: p.isHealthy ? '#10b981' : '#f87171',
                    }}
                  />
                  {p.websiteUrl ? (
                    <a
                      href={p.websiteUrl}
                      target={p.websiteUrl.startsWith('http') ? '_blank' : '_self'}
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title={`Visit ${p.displayName} official portal`}
                      style={{
                        fontWeight: 700,
                        fontSize: '13px',
                        color: '#f8fafc',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#38bdf8')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = '#f8fafc')}
                    >
                      {p.displayName}
                      {p.websiteUrl.startsWith('http') && <span style={{ fontSize: '10px', color: '#64748b' }}>↗</span>}
                    </a>
                  ) : (
                    <span style={{ fontWeight: 700, fontSize: '13px', color: '#f8fafc' }}>
                      {p.displayName}
                    </span>
                  )}
                </div>

                {/* Cadence Category Badge with Link and Tooltip */}
                <a
                  href={p.cadenceDocUrl || p.websiteUrl || '#'}
                  target={p.cadenceDocUrl?.startsWith('http') ? '_blank' : '_self'}
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title={p.cadenceExplanation || `${p.updateCadenceCategory.replace('_', ' ')} update cadence model`}
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backgroundColor: `${cadenceColor}20`,
                    color: cadenceColor,
                    textTransform: 'uppercase',
                    textDecoration: 'none',
                    border: `1px solid ${cadenceColor}40`,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                >
                  {p.updateCadenceCategory.replace('_', ' ')}
                  <span style={{ fontSize: '9px', opacity: 0.7 }}>ℹ</span>
                </a>
              </div>

              {/* Row 2: Allowed Pricing Modalities Badges with Direct Links */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                {p.allowedPricingModels.map((mode) => {
                  const targetUrl =
                    mode === 'spot'
                      ? p.spotPricingUrl || p.pricingUrl
                      : p.pricingUrl || p.websiteUrl;

                  const badgeColor =
                    mode === 'spot'
                      ? '#34d399'
                      : mode === 'serverless'
                        ? '#22d3ee'
                        : mode === 'token_factory'
                          ? '#c084fc'
                          : mode === 'pay_per_call'
                            ? '#fbbf24'
                            : '#cbd5e1';

                  const badgeBg =
                    mode === 'spot'
                      ? 'rgba(16, 185, 129, 0.15)'
                      : mode === 'serverless'
                        ? 'rgba(6, 182, 212, 0.15)'
                        : mode === 'token_factory'
                          ? 'rgba(139, 92, 246, 0.15)'
                          : mode === 'pay_per_call'
                            ? 'rgba(245, 158, 11, 0.15)'
                            : 'rgba(148, 163, 184, 0.15)';

                  return (
                    <a
                      key={mode}
                      href={targetUrl || '#'}
                      target={targetUrl?.startsWith('http') ? '_blank' : '_self'}
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title={`View ${p.displayName} ${mode.replace('_', ' ')} pricing information`}
                      style={{
                        fontSize: '10px',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        backgroundColor: badgeBg,
                        color: badgeColor,
                        fontWeight: 600,
                        textDecoration: 'none',
                        border: `1px solid ${badgeColor}30`,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '2px',
                      }}
                    >
                      {mode.replace('_', ' ')}
                      <span style={{ fontSize: '8px', opacity: 0.6 }}>↗</span>
                    </a>
                  );
                })}
              </div>

              {/* Row 3: Spot Policy Banner (Notice window timing & Bid vs Fixed) */}
              {p.spotPolicy && (
                <div
                  title={`Spot Preemption Policy: ${p.spotPolicy.description}`}
                  style={{
                    backgroundColor: 'rgba(30, 41, 59, 0.8)',
                    border: '1px solid #334155',
                    borderRadius: '4px',
                    padding: '3px 6px',
                    fontSize: '10px',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '8px',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                    <span style={{ color: '#f59e0b', fontWeight: 700 }}>⚡ Spot:</span>
                    <strong style={{ color: '#f8fafc' }}>{p.spotPolicy.noticeWindowLabel}</strong>
                  </span>
                  <span
                    style={{
                      padding: '1px 4px',
                      borderRadius: '3px',
                      fontSize: '9px',
                      fontWeight: 700,
                      backgroundColor:
                        p.spotPolicy.pricingType === 'floating_bid'
                          ? 'rgba(245, 158, 11, 0.15)'
                          : 'rgba(16, 185, 129, 0.15)',
                      color:
                        p.spotPolicy.pricingType === 'floating_bid' ? '#fbbf24' : '#34d399',
                    }}
                  >
                    {p.spotPolicy.pricingTypeLabel}
                  </span>
                </div>
              )}

              {/* Row 4: Credits and Polling Info with Direct Links */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '11px',
                  color: '#94a3b8',
                }}
              >
                <div>
                  {p.availableCreditsUsd !== null ? (
                    <a
                      href={p.billingUrl || '#'}
                      target={p.billingUrl?.startsWith('http') ? '_blank' : '_self'}
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title={`Open ${p.displayName} billing & prepaid credits console`}
                      style={{
                        color: '#34d399',
                        fontWeight: 600,
                        textDecoration: 'none',
                        borderBottom: '1px dotted #34d399',
                      }}
                    >
                      ${p.availableCreditsUsd.toFixed(2)} credits ↗
                    </a>
                  ) : p.creditType === 'postpaid_invoice' ? (
                    <a
                      href={p.billingUrl || '#'}
                      target={p.billingUrl?.startsWith('http') ? '_blank' : '_self'}
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title="Open AWS Direct Invoice Billing Console"
                      style={{
                        color: '#60a5fa',
                        fontWeight: 500,
                        textDecoration: 'none',
                        borderBottom: '1px dotted #60a5fa',
                      }}
                    >
                      Direct AWS Invoice ↗
                    </a>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>$0 Local HW</span>
                  )}
                </div>

                <div>
                  <a
                    href={p.syncDocUrl || p.websiteUrl || '#'}
                    target={p.syncDocUrl?.startsWith('http') ? '_blank' : '_self'}
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title={`View ${p.displayName} telemetry API documentation and rate limits`}
                    style={{
                      color: '#64748b',
                      textDecoration: 'none',
                      borderBottom: '1px dotted #64748b',
                    }}
                  >
                    ~{Math.round(p.estimatedUpdateIntervalSec / 60)}m polling ↗
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Provider Popover Details */}
      {selectedProviderDetail && (
        <div
          style={{
            marginTop: '16px',
            padding: '14px 18px',
            backgroundColor: '#1e293b',
            borderRadius: '8px',
            border: '1px solid #38bdf8',
            fontSize: '12px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              marginBottom: '10px',
              paddingBottom: '8px',
              borderBottom: '1px solid #334155',
            }}
          >
            <div>
              <span style={{ color: '#38bdf8', fontWeight: 700, fontSize: '14px' }}>
                {selectedProviderDetail.displayName} Telemetry &amp; Verification Sources:
              </span>{' '}
              <span style={{ color: '#e2e8f0' }}>{selectedProviderDetail.updateFrequencyDescription}</span>
              <span style={{ color: '#94a3b8', marginLeft: '8px' }}>
                (Last sync: {new Date(selectedProviderDetail.lastSyncedAt).toLocaleTimeString()})
              </span>
            </div>

            {/* Quick Links per Selected Provider */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {selectedProviderDetail.websiteUrl && (
                <a
                  href={selectedProviderDetail.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    backgroundColor: '#0f172a',
                    color: '#38bdf8',
                    border: '1px solid #0284c7',
                    borderRadius: '4px',
                    padding: '3px 8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  🌐 Provider Console ↗
                </a>
              )}
              {selectedProviderDetail.pricingUrl && (
                <a
                  href={selectedProviderDetail.pricingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    backgroundColor: '#0f172a',
                    color: '#34d399',
                    border: '1px solid #059669',
                    borderRadius: '4px',
                    padding: '3px 8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  💵 On-Demand Rates ↗
                </a>
              )}
              {selectedProviderDetail.spotPricingUrl && (
                <a
                  href={selectedProviderDetail.spotPricingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    backgroundColor: '#0f172a',
                    color: '#f59e0b',
                    border: '1px solid #d97706',
                    borderRadius: '4px',
                    padding: '3px 8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  ⚡ Spot / Preemptible ↗
                </a>
              )}
              {selectedProviderDetail.billingUrl && (
                <a
                  href={selectedProviderDetail.billingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    backgroundColor: '#0f172a',
                    color: '#c084fc',
                    border: '1px solid #9333ea',
                    borderRadius: '4px',
                    padding: '3px 8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  💳 Manage Credits ↗
                </a>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
            <div style={{ color: '#cbd5e1' }}>
              <div>
                <strong>Risk Profile:</strong>{' '}
                <span style={{ color: '#f59e0b', fontWeight: 600 }}>{selectedProviderDetail.interruptionRiskTier}</span>
              </div>
              <div style={{ marginTop: '4px' }}>
                <strong>Notice Window:</strong>{' '}
                <span style={{ color: '#34d399', fontWeight: 600 }}>{selectedProviderDetail.interruptionNoticeWindow}</span>
              </div>
            </div>

            {selectedProviderDetail.spotPolicy && (
              <div style={{ color: '#94a3b8' }}>
                <div>
                  <strong style={{ color: '#e2e8f0' }}>Spot Policy Mechanism:</strong>{' '}
                  <span style={{ color: '#38bdf8', fontWeight: 600 }}>
                    {selectedProviderDetail.spotPolicy.pricingTypeLabel} ({selectedProviderDetail.spotPolicy.noticeWindowLabel})
                  </span>
                </div>
                <div style={{ marginTop: '4px', fontSize: '11px', color: '#94a3b8' }}>
                  {selectedProviderDetail.spotPolicy.description}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
