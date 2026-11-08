import fs from 'node:fs';
import path from 'node:path';
import type { ProviderBalanceStatus } from '../../domain/finops-pricing.js';

export interface IProviderBalanceService {
  getBalances(): Promise<Record<string, ProviderBalanceStatus>>;
  getProviderBalance(provider: string): Promise<ProviderBalanceStatus | null>;
}

function ensureEnvLoaded(): void {
  if (process.env.NODE_ENV === 'test') return;
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(process.cwd(), '../.env'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const text = fs.readFileSync(candidate, 'utf-8');
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
          if (match) {
            const key = match[1];
            let val = match[2].trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
        break;
      } catch {
        // ignore
      }
    }
  }
}

export class ProviderBalanceService implements IProviderBalanceService {
  constructor() {
    ensureEnvLoaded();
  }

  private isMockOrTest(): boolean {
    return (
      process.env.NODE_ENV === 'test' ||
      process.env.MOCK_PROVIDERS === '1' ||
      process.env.MOCK_PROVIDERS === 'true'
    );
  }

  async getBalances(): Promise<Record<string, ProviderBalanceStatus>> {
    ensureEnvLoaded();
    const providers = [
      'vast_ai',
      'runpod',
      'fal',
      'local_pytorch',
      'bedrock',
      'sagemaker',
      'baseten',
      'nebius',
      'modal',
      'beam',
      'jarvislabs',
      'runware',
      'hivenet',
      'wavespeed',
      'neocloudz',
    ];

    const results = await Promise.allSettled(
      providers.map((p) => this.getProviderBalance(p))
    );

    const map: Record<string, ProviderBalanceStatus> = {};
    providers.forEach((p, idx) => {
      const res = results[idx];
      if (res.status === 'fulfilled' && res.value) {
        map[p] = res.value;
      } else {
        map[p] = {
          provider: p,
          displayName: p,
          balanceUsd: null,
          currency: 'USD',
          status: 'UNKNOWN',
          creditType: 'prepaid_credits',
          checkedAt: new Date().toISOString(),
        };
      }
    });

    return map;
  }

  async getProviderBalance(provider: string): Promise<ProviderBalanceStatus | null> {
    ensureEnvLoaded();
    const now = new Date().toISOString();
    const key = provider.toLowerCase();

    // 1. Local Workstation Hardware (RTX 5070 Ti)
    if (key === 'local_pytorch') {
      return {
        provider: 'local_pytorch',
        displayName: 'Local PyTorch (RTX 5070 Ti)',
        balanceUsd: 0.0,
        currency: 'USD',
        status: 'LOCAL_HARDWARE',
        creditType: 'zero_commitment',
        checkedAt: now,
      };
    }

    // 2. AWS Invoiced Services (Postpaid Monthly Invoicing)
    if (key === 'bedrock') {
      return {
        provider: 'bedrock',
        displayName: 'AWS Bedrock',
        balanceUsd: null,
        currency: 'USD',
        status: 'POSTPAID_INVOICE',
        creditType: 'postpaid_invoice',
        checkedAt: now,
      };
    }
    if (key === 'sagemaker') {
      return {
        provider: 'sagemaker',
        displayName: 'AWS SageMaker',
        balanceUsd: null,
        currency: 'USD',
        status: 'POSTPAID_INVOICE',
        creditType: 'postpaid_invoice',
        checkedAt: now,
      };
    }

    // If running in test or offline mock mode, do not call external APIs
    if (this.isMockOrTest()) {
      if (key === 'vast_ai') {
        return {
          provider: 'vast_ai',
          displayName: 'Vast.ai',
          balanceUsd: 0.0,
          currency: 'USD',
          status: 'LIVE_VERIFIED',
          creditType: 'prepaid_credits',
          checkedAt: now,
        };
      }
      if (key === 'runpod') {
        return {
          provider: 'runpod',
          displayName: 'RunPod',
          balanceUsd: 15.0,
          currency: 'USD',
          status: 'LIVE_VERIFIED',
          creditType: 'prepaid_credits',
          checkedAt: now,
        };
      }
      if (key === 'fal') {
        return {
          provider: 'fal',
          displayName: 'fal.ai',
          balanceUsd: 0.0,
          currency: 'USD',
          status: 'LIVE_VERIFIED',
          creditType: 'prepaid_credits',
          checkedAt: now,
        };
      }
      return {
        provider,
        displayName: provider,
        balanceUsd: null,
        currency: 'USD',
        status: 'UNKNOWN',
        creditType: 'prepaid_credits',
        checkedAt: now,
      };
    }

    // 3. Vast.ai Live Balance Check
    if (key === 'vast_ai') {
      const apiKey = process.env.VAST_API_KEY;
      if (!apiKey) {
        return {
          provider: 'vast_ai',
          displayName: 'Vast.ai',
          balanceUsd: null,
          currency: 'USD',
          status: 'NO_API_KEY',
          creditType: 'prepaid_credits',
          checkedAt: now,
        };
      }
      try {
        const res = await fetch('https://console.vast.ai/api/v0/users/current/', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(3500),
        });
        if (res.ok) {
          const data = (await res.json()) as { balance?: number; credit?: number };
          const bal = typeof data.balance === 'number' ? data.balance : (typeof data.credit === 'number' ? data.credit : 0);
          return {
            provider: 'vast_ai',
            displayName: 'Vast.ai',
            balanceUsd: bal,
            currency: 'USD',
            status: 'LIVE_VERIFIED',
            creditType: 'prepaid_credits',
            checkedAt: now,
            rawDetails: `balance: ${data.balance}, credit: ${data.credit}`,
          };
        }
      } catch {
        // Fall back to UNKNOWN if network fails
      }
      return {
        provider: 'vast_ai',
        displayName: 'Vast.ai',
        balanceUsd: null,
        currency: 'USD',
        status: 'UNKNOWN',
        creditType: 'prepaid_credits',
        checkedAt: now,
      };
    }

    // 4. RunPod Live GraphQL Balance Check
    if (key === 'runpod') {
      const apiKey = process.env.RUNPOD_API_KEY;
      if (!apiKey) {
        return {
          provider: 'runpod',
          displayName: 'RunPod',
          balanceUsd: null,
          currency: 'USD',
          status: 'NO_API_KEY',
          creditType: 'prepaid_credits',
          checkedAt: now,
        };
      }
      try {
        const res = await fetch('https://api.runpod.io/graphql', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: 'query { myself { clientBalance } }' }),
          signal: AbortSignal.timeout(3500),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            data?: { myself?: { clientBalance?: number } };
          };
          const bal = data?.data?.myself?.clientBalance;
          return {
            provider: 'runpod',
            displayName: 'RunPod',
            balanceUsd: typeof bal === 'number' ? bal : null,
            currency: 'USD',
            status: typeof bal === 'number' ? 'LIVE_VERIFIED' : 'UNKNOWN',
            creditType: 'prepaid_credits',
            checkedAt: now,
            rawDetails: bal !== undefined ? `clientBalance: ${bal}` : undefined,
          };
        }
      } catch {
        // Fall back to UNKNOWN on error
      }
      return {
        provider: 'runpod',
        displayName: 'RunPod',
        balanceUsd: null,
        currency: 'USD',
        status: 'UNKNOWN',
        creditType: 'prepaid_credits',
        checkedAt: now,
      };
    }

    // 5. fal.ai User & Account Status Check
    if (key === 'fal') {
      const apiKey = process.env.FAL_KEY;
      if (!apiKey) {
        return {
          provider: 'fal',
          displayName: 'fal.ai',
          balanceUsd: null,
          currency: 'USD',
          status: 'NO_API_KEY',
          creditType: 'prepaid_credits',
          checkedAt: now,
        };
      }
      try {
        const res = await fetch('https://rest.alpha.fal.ai/users/current', {
          headers: { Authorization: `Key ${apiKey}` },
          signal: AbortSignal.timeout(3500),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            is_locked?: boolean;
            lock_reason?: string;
            balance?: number;
          };
          let bal: number | null = null;
          if (typeof data.balance === 'number') {
            bal = data.balance;
          } else if (data.is_locked && data.lock_reason?.toLowerCase().includes('exhausted balance')) {
            bal = 0.0;
          }
          return {
            provider: 'fal',
            displayName: 'fal.ai',
            balanceUsd: bal,
            currency: 'USD',
            status: bal !== null ? 'LIVE_VERIFIED' : 'UNKNOWN',
            creditType: 'prepaid_credits',
            checkedAt: now,
            rawDetails: data.lock_reason,
          };
        }
      } catch {
        // Fall back to UNKNOWN
      }
      return {
        provider: 'fal',
        displayName: 'fal.ai',
        balanceUsd: null,
        currency: 'USD',
        status: 'UNKNOWN',
        creditType: 'prepaid_credits',
        checkedAt: now,
      };
    }

    // 6. Default / Unconfigured or Unsupported Provider
    return {
      provider,
      displayName: provider,
      balanceUsd: null,
      currency: 'USD',
      status: 'UNKNOWN',
      creditType: 'prepaid_credits',
      checkedAt: now,
    };
  }
}

export const providerBalanceService = new ProviderBalanceService();
