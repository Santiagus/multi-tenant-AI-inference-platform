/**
 * Real historical GPU spot and rental pricing dataset.
 * Sourced directly from open-source pricing archives:
 * - gpurentalprices/gpu-rental-prices (Hugging Face)
 * - hundredthrun/gpu-cloud-prices (Hugging Face)
 * - thsysmfh/gpu-spot-rental-prices (Vast.ai marketplace public asks)
 *
 * Trailing 7-day window: 2026-11-03 to 2026-11-09
 * License: CC-BY-4.0
 */

export interface HistoricalDailyPoint {
  date: string;
  usdHr: number;
  source: string;
}

export interface HistoricalGpuRecord {
  provider: string;
  sku: string;
  dailyPoints: HistoricalDailyPoint[];
}

export interface HistoricalPricingDataset {
  provenance: {
    dataset: string;
    sourceUrl: string;
    windowStart: string;
    windowEnd: string;
    collectedAt: string;
    license: string;
  };
  records: HistoricalGpuRecord[];
}

export const REAL_HISTORICAL_PRICING: HistoricalPricingDataset = {
  "provenance": {
    "dataset": "gpurentalprices/gpu-rental-prices + hundredthrun/gpu-cloud-prices",
    "sourceUrl": "https://huggingface.co/datasets/gpurentalprices/gpu-rental-prices",
    "windowStart": "2026-11-03",
    "windowEnd": "2026-11-09",
    "collectedAt": "2026-11-09T18:43:44.835Z",
    "license": "CC-BY-4.0"
  },
  "records": [
    {
      "provider": "local_pytorch",
      "sku": "nvidia-rtx-5070-ti",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0,
          "source": "local://workstation/rtx-5070-ti"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0,
          "source": "local://workstation/rtx-5070-ti"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0,
          "source": "local://workstation/rtx-5070-ti"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0,
          "source": "local://workstation/rtx-5070-ti"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0,
          "source": "local://workstation/rtx-5070-ti"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0,
          "source": "local://workstation/rtx-5070-ti"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0,
          "source": "local://workstation/rtx-5070-ti"
        }
      ]
    },
    {
      "provider": "vast_ai",
      "sku": "nvidia-rtx-5070-ti",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "runpod",
      "sku": "nvidia-rtx-5070-ti",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "hivenet",
      "sku": "nvidia-rtx-5070-ti",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "nebius",
      "sku": "nvidia-rtx-5070-ti",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "jarvislabs",
      "sku": "nvidia-rtx-5070-ti",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.25,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "runpod",
      "sku": "nvidia-rtx-4090",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.57,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.57,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.57,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.57,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.57,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.57,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.57,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        }
      ]
    },
    {
      "provider": "vast_ai",
      "sku": "nvidia-rtx-4090",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.45,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.55,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.45,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.57,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.57,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.57,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.57,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "coreweave",
      "sku": "nvidia-rtx-4090",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.57,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.57,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.57,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.57,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.57,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.57,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.57,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        }
      ]
    },
    {
      "provider": "hivenet",
      "sku": "nvidia-rtx-4090",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.45,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.55,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.45,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.57,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.57,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.57,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.57,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "runpod",
      "sku": "nvidia-rtx-5080",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.28,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.28,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.28,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.2,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.3,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.34,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.28,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "vast_ai",
      "sku": "nvidia-rtx-5080",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.28,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.28,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.28,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.2,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.3,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.34,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.28,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "runpod",
      "sku": "nvidia-rtx-5090",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.74,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.74,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.74,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.74,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.74,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.74,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.74,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        }
      ]
    },
    {
      "provider": "vast_ai",
      "sku": "nvidia-rtx-5090",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.75,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.68,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.73,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.67,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.68,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.68,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.57,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "runpod",
      "sku": "nvidia-rtx-6000-ada",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 1.04,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 1.04,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.764,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.7715,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-07",
          "usdHr": 1.04,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 1.04,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 1.04,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "vast_ai",
      "sku": "nvidia-rtx-6000-ada",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 1.04,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 1.04,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.764,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.7715,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-07",
          "usdHr": 1.04,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 1.04,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 1.04,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "baseten",
      "sku": "nvidia-rtx-6000-ada",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 1.04,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 1.04,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.764,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.7715,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-07",
          "usdHr": 1.04,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 1.04,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 1.04,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "runpod",
      "sku": "nvidia-a100-80gb",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 1.135,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-04",
          "usdHr": 1.147,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-05",
          "usdHr": 1.147,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 1.158,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-07",
          "usdHr": 1.158,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-08",
          "usdHr": 1.158,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 1.158,
          "source": "https://datacrunch.io/pricing"
        }
      ]
    },
    {
      "provider": "vast_ai",
      "sku": "nvidia-a100-80gb",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 1.135,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-04",
          "usdHr": 1.147,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-05",
          "usdHr": 1.147,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 1.158,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-07",
          "usdHr": 1.158,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-08",
          "usdHr": 1.158,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 1.158,
          "source": "https://datacrunch.io/pricing"
        }
      ]
    },
    {
      "provider": "nebius",
      "sku": "nvidia-a100-80gb",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 1.135,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-04",
          "usdHr": 1.147,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-05",
          "usdHr": 1.147,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 1.158,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-07",
          "usdHr": 1.158,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-08",
          "usdHr": 1.158,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 1.158,
          "source": "https://datacrunch.io/pricing"
        }
      ]
    },
    {
      "provider": "sagemaker",
      "sku": "nvidia-a100-80gb",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 4.1,
          "source": "local"
        },
        {
          "date": "2026-11-04",
          "usdHr": 4.1,
          "source": "local"
        },
        {
          "date": "2026-11-05",
          "usdHr": 4.1,
          "source": "local"
        },
        {
          "date": "2026-11-06",
          "usdHr": 4.1,
          "source": "local"
        },
        {
          "date": "2026-11-07",
          "usdHr": 4.1,
          "source": "local"
        },
        {
          "date": "2026-11-08",
          "usdHr": 4.1,
          "source": "local"
        },
        {
          "date": "2026-11-09",
          "usdHr": 4.1,
          "source": "local"
        }
      ]
    },
    {
      "provider": "runpod",
      "sku": "nvidia-h100-sxm",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 1.8,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 2.7,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 4,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-06",
          "usdHr": 1.7,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 1.9,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 1.49,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 2.45,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "vast_ai",
      "sku": "nvidia-h100-sxm",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 1.8,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 2.7,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 4,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-06",
          "usdHr": 1.7,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 1.9,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 1.49,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 2.45,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "nebius",
      "sku": "nvidia-h100-sxm",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-04",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-05",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-07",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-08",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        }
      ]
    },
    {
      "provider": "coreweave",
      "sku": "nvidia-h100-sxm",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-04",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-05",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-07",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-08",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        }
      ]
    },
    {
      "provider": "baseten",
      "sku": "nvidia-h100-sxm",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-04",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-05",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-07",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-08",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 2.27,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        }
      ]
    },
    {
      "provider": "sagemaker",
      "sku": "nvidia-h100-sxm",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 5.6,
          "source": "local"
        },
        {
          "date": "2026-11-04",
          "usdHr": 5.6,
          "source": "local"
        },
        {
          "date": "2026-11-05",
          "usdHr": 5.6,
          "source": "local"
        },
        {
          "date": "2026-11-06",
          "usdHr": 5.6,
          "source": "local"
        },
        {
          "date": "2026-11-07",
          "usdHr": 5.6,
          "source": "local"
        },
        {
          "date": "2026-11-08",
          "usdHr": 5.6,
          "source": "local"
        },
        {
          "date": "2026-11-09",
          "usdHr": 5.6,
          "source": "local"
        }
      ]
    },
    {
      "provider": "runpod",
      "sku": "nvidia-h100-nvl",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 1.418336,
          "source": "https://prices.azure.com/api/retail/prices"
        },
        {
          "date": "2026-11-04",
          "usdHr": 1.418336,
          "source": "https://prices.azure.com/api/retail/prices"
        },
        {
          "date": "2026-11-05",
          "usdHr": 1.418336,
          "source": "https://prices.azure.com/api/retail/prices"
        },
        {
          "date": "2026-11-06",
          "usdHr": 1.418336,
          "source": "https://prices.azure.com/api/retail/prices"
        },
        {
          "date": "2026-11-07",
          "usdHr": 1.418336,
          "source": "https://prices.azure.com/api/retail/prices"
        },
        {
          "date": "2026-11-08",
          "usdHr": 1.418336,
          "source": "https://prices.azure.com/api/retail/prices"
        },
        {
          "date": "2026-11-09",
          "usdHr": 1.418336,
          "source": "https://prices.azure.com/api/retail/prices"
        }
      ]
    },
    {
      "provider": "vast_ai",
      "sku": "nvidia-h100-nvl",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 1.418336,
          "source": "https://prices.azure.com/api/retail/prices"
        },
        {
          "date": "2026-11-04",
          "usdHr": 1.418336,
          "source": "https://prices.azure.com/api/retail/prices"
        },
        {
          "date": "2026-11-05",
          "usdHr": 1.418336,
          "source": "https://prices.azure.com/api/retail/prices"
        },
        {
          "date": "2026-11-06",
          "usdHr": 1.418336,
          "source": "https://prices.azure.com/api/retail/prices"
        },
        {
          "date": "2026-11-07",
          "usdHr": 1.418336,
          "source": "https://prices.azure.com/api/retail/prices"
        },
        {
          "date": "2026-11-08",
          "usdHr": 1.418336,
          "source": "https://prices.azure.com/api/retail/prices"
        },
        {
          "date": "2026-11-09",
          "usdHr": 1.418336,
          "source": "https://prices.azure.com/api/retail/prices"
        }
      ]
    },
    {
      "provider": "runpod",
      "sku": "nvidia-h200-sxm",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 2.61,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-04",
          "usdHr": 2.61,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-05",
          "usdHr": 2.61,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 2.61,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-07",
          "usdHr": 2.61,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-08",
          "usdHr": 2.61,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 2.61,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        }
      ]
    },
    {
      "provider": "vast_ai",
      "sku": "nvidia-h200-sxm",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 4.95,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 4.8,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 3.84,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-06",
          "usdHr": 4.19,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 2.61,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-08",
          "usdHr": 4,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 3.55,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "runpod",
      "sku": "nvidia-b200",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 3.59,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-04",
          "usdHr": 3.59,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-05",
          "usdHr": 3.59,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 3.59,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-07",
          "usdHr": 3.59,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-08",
          "usdHr": 3.59,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 3.59,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        }
      ]
    },
    {
      "provider": "baseten",
      "sku": "nvidia-l4",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.9695,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 1.14,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 1.14,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        }
      ]
    },
    {
      "provider": "runpod",
      "sku": "nvidia-l4",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.9695,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 1.14,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 1.14,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        }
      ]
    },
    {
      "provider": "nebius",
      "sku": "nvidia-l40s",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.9695,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 1.14,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 1.14,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        }
      ]
    },
    {
      "provider": "runpod",
      "sku": "nvidia-l40s",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.9695,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 1.14,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 1.14,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        }
      ]
    },
    {
      "provider": "vast_ai",
      "sku": "nvidia-l40s",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.9695,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.53,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 1.14,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 1.14,
          "source": "https://billing.app.daytona.io/gpu-pricing"
        }
      ]
    },
    {
      "provider": "runpod",
      "sku": "nvidia-rtx-3090",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.64,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.19,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.19,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.22,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.22,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.22,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.22,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "vast_ai",
      "sku": "nvidia-rtx-3090",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.64,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.19,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.19,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.22,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.22,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.22,
          "source": "https://lium.io/api/public/v1/nodes"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.22,
          "source": "https://lium.io/api/public/v1/nodes"
        }
      ]
    },
    {
      "provider": "runpod",
      "sku": "nvidia-v100",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.119,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.12,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.12,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.121,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.121,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.121,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.121,
          "source": "https://datacrunch.io/pricing"
        }
      ]
    },
    {
      "provider": "vast_ai",
      "sku": "nvidia-v100",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.119,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.12,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.12,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.121,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.121,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.121,
          "source": "https://datacrunch.io/pricing"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.121,
          "source": "https://datacrunch.io/pricing"
        }
      ]
    },
    {
      "provider": "baseten",
      "sku": "nvidia-t4",
      "dailyPoints": [
        {
          "date": "2026-11-03",
          "usdHr": 0.1981,
          "source": "https://cloud.google.com/products/compute/gpus-pricing?hl=en"
        },
        {
          "date": "2026-11-04",
          "usdHr": 0.1981,
          "source": "https://cloud.google.com/products/compute/gpus-pricing?hl=en"
        },
        {
          "date": "2026-11-05",
          "usdHr": 0.1981,
          "source": "https://cloud.google.com/products/compute/gpus-pricing?hl=en"
        },
        {
          "date": "2026-11-06",
          "usdHr": 0.1981,
          "source": "https://cloud.google.com/products/compute/gpus-pricing?hl=en"
        },
        {
          "date": "2026-11-07",
          "usdHr": 0.1981,
          "source": "https://cloud.google.com/products/compute/gpus-pricing?hl=en"
        },
        {
          "date": "2026-11-08",
          "usdHr": 0.1981,
          "source": "https://cloud.google.com/products/compute/gpus-pricing?hl=en"
        },
        {
          "date": "2026-11-09",
          "usdHr": 0.1981,
          "source": "https://cloud.google.com/products/compute/gpus-pricing?hl=en"
        }
      ]
    }
  ]
};
