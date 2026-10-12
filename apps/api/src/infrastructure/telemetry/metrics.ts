export type MetricType = 'counter' | 'gauge' | 'histogram';

export type Labels = Record<string, string | number>;

function serializeLabels(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}="${String(labels[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
}

function appendExtraLabel(existingSerialized: string, extraKey: string, extraVal: string): string {
  const formattedExtra = `${extraKey}="${extraVal}"`;
  if (!existingSerialized) return formattedExtra;
  return `${existingSerialized},${formattedExtra}`;
}

export function computeQuantile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const pos = (sortedValues.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sortedValues[base + 1] ?? sortedValues[base];
  return Number((sortedValues[base] + rest * (next - sortedValues[base])).toFixed(6));
}

interface CounterSeries {
  help: string;
  values: Map<string, number>;
}

interface GaugeSeries {
  help: string;
  values: Map<string, number>;
}

interface HistogramBucketSample {
  bucketCounts: number[];
  sum: number;
  count: number;
  observations: number[];
}

interface HistogramSeries {
  help: string;
  buckets: number[];
  samples: Map<string, HistogramBucketSample>;
}

const DEFAULT_LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export class MetricsRegistry {
  private counters = new Map<string, CounterSeries>();
  private gauges = new Map<string, GaugeSeries>();
  private histograms = new Map<string, HistogramSeries>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    // Control plane metrics
    this.defineCounter(
      'http_server_requests_total',
      'Total number of HTTP requests handled by the control plane'
    );
    this.defineHistogram(
      'http_server_request_duration_seconds',
      'Histogram of control-plane HTTP ingress latency in seconds',
      DEFAULT_LATENCY_BUCKETS
    );
    this.defineCounter(
      'jobs_submitted_total',
      'Total number of accepted asynchronous inference job submissions'
    );
    this.defineCounter(
      'jobs_rejected_total',
      'Total number of rejected job requests (validation, conflict, quota)'
    );
    this.defineGauge(
      'queue_messages_visible',
      'Current number of visible pending job messages in queue'
    );
    this.defineHistogram(
      'queue_wait_duration_seconds',
      'Time a job spent waiting in queue from creation until worker processing in seconds',
      DEFAULT_LATENCY_BUCKETS
    );

    // Worker & inference metrics
    this.defineHistogram(
      'inference_job_duration_seconds',
      'End-to-end inference execution duration in seconds (with P50/P95/P99 quantiles)',
      DEFAULT_LATENCY_BUCKETS
    );
    this.defineHistogram(
      'inference_token_generation_duration_seconds',
      'Time-to-first-token (TTFT) and inter-token generation duration in seconds',
      [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5]
    );
    this.defineCounter(
      'inference_tokens_total',
      'Total processed prompt and completion tokens across tenants and models'
    );
    this.defineCounter(
      'inference_cost_microcents_total',
      'Accumulated inference cost in integer microcents (1/10,000 cent)'
    );
    this.defineCounter(
      'inference_job_errors_total',
      'Total number of worker inference execution errors by error code and transient classification'
    );
    this.defineCounter(
      'inference_job_retries_total',
      'Total number of transient inference job retry attempts'
    );
    this.defineCounter(
      'inference_job_dlq_total',
      'Total number of exhausted or permanent failure jobs quarantined in the Dead-Letter Queue'
    );
    this.defineGauge(
      'worker_active_jobs',
      'Number of inference jobs currently in flight on workers'
    );
    this.defineGauge(
      'worker_utilization_ratio',
      'Current worker slot utilization ratio (0.0 to 1.0)'
    );

    // Hardware & GPU/CPU telemetry metrics (NVIDIA DCGM & Host CPU/RAM)
    this.defineGauge(
      'DCGM_FI_DEV_GPU_UTIL',
      'Real-time GPU compute utilization percentage (0-100)'
    );
    this.defineGauge(
      'DCGM_FI_DEV_FB_USED',
      'GPU framebuffer (VRAM) allocated in MiB'
    );
    this.defineGauge(
      'worker_cpu_utilization_pct',
      'Worker process CPU compute utilization percentage (0-100)'
    );
    this.defineGauge(
      'worker_process_rss_mb',
      'Worker process resident set size (RSS) memory in MiB'
    );

    // Kubernetes scheduling, KEDA autoscaling, Kueue admission & Kyverno policy metrics (M06)
    this.defineGauge(
      'keda_scaler_desired_replicas',
      'Desired worker pod replica count calculated by KEDA queue-depth scaler'
    );
    this.defineGauge(
      'keda_scaler_active_replicas',
      'Current active worker pod replica count reported to KEDA scaler'
    );
    this.defineGauge(
      'kueue_cluster_queue_gpu_quota_used',
      'Current NVIDIA GPU count allocated to admitted Kueue batch workloads'
    );
    this.defineGauge(
      'kueue_cluster_queue_gpu_quota_nominal',
      'Nominal NVIDIA GPU quota configured on the Kueue ClusterQueue'
    );
    this.defineGauge(
      'kueue_pending_workloads',
      'Number of batch GPU workloads suspended and waiting for quota in Kueue ClusterQueue'
    );
    this.defineCounter(
      'kueue_admitted_workloads_total',
      'Total number of GPU/batch workloads admitted by Kueue ClusterQueue'
    );
    this.defineCounter(
      'kyverno_policy_evaluations_total',
      'Total number of Kubernetes admission evaluations checked against Kyverno policies'
    );
  }

  defineCounter(name: string, help: string): void {
    if (!this.counters.has(name)) {
      this.counters.set(name, { help, values: new Map() });
    }
  }

  defineGauge(name: string, help: string): void {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, { help, values: new Map() });
    }
  }

  defineHistogram(name: string, help: string, buckets: number[] = DEFAULT_LATENCY_BUCKETS): void {
    if (!this.histograms.has(name)) {
      const sortedBuckets = [...buckets].sort((a, b) => a - b);
      this.histograms.set(name, { help, buckets: sortedBuckets, samples: new Map() });
    }
  }

  incCounter(name: string, labels: Labels = {}, delta = 1): void {
    if (!this.counters.has(name)) {
      this.defineCounter(name, `${name} counter`);
    }
    const series = this.counters.get(name)!;
    const key = serializeLabels(labels);
    series.values.set(key, (series.values.get(key) ?? 0) + delta);
  }

  setGauge(name: string, labels: Labels = {}, value: number): void {
    if (!this.gauges.has(name)) {
      this.defineGauge(name, `${name} gauge`);
    }
    const series = this.gauges.get(name)!;
    const key = serializeLabels(labels);
    series.values.set(key, value);
  }

  observeHistogram(name: string, labels: Labels = {}, value: number): void {
    if (!this.histograms.has(name)) {
      this.defineHistogram(name, `${name} histogram`);
    }
    const series = this.histograms.get(name)!;
    const key = serializeLabels(labels);
    let sample = series.samples.get(key);
    if (!sample) {
      sample = {
        bucketCounts: new Array(series.buckets.length).fill(0),
        sum: 0,
        count: 0,
        observations: [],
      };
      series.samples.set(key, sample);
    }

    const safeVal = Math.max(value, 0);
    sample.sum = Number((sample.sum + safeVal).toFixed(6));
    sample.count += 1;
    sample.observations.push(safeVal);
    if (sample.observations.length > 2000) {
      sample.observations.shift();
    }

    for (let i = 0; i < series.buckets.length; i++) {
      if (safeVal <= series.buckets[i]) {
        sample.bucketCounts[i] += 1;
      }
    }
  }

  getCounterValue(name: string, labels: Labels = {}): number {
    const series = this.counters.get(name);
    if (!series) return 0;
    return series.values.get(serializeLabels(labels)) ?? 0;
  }

  getGaugeValue(name: string, labels: Labels = {}): number {
    const series = this.gauges.get(name);
    if (!series) return 0;
    return series.values.get(serializeLabels(labels)) ?? 0;
  }

  getHistogramQuantiles(
    name: string,
    labels: Labels = {}
  ): { count: number; sum: number; p50: number; p95: number; p99: number } {
    const series = this.histograms.get(name);
    if (!series) {
      return { count: 0, sum: 0, p50: 0, p95: 0, p99: 0 };
    }
    const sample = series.samples.get(serializeLabels(labels));
    if (!sample || sample.observations.length === 0) {
      return { count: 0, sum: 0, p50: 0, p95: 0, p99: 0 };
    }
    const sorted = [...sample.observations].sort((a, b) => a - b);
    return {
      count: sample.count,
      sum: sample.sum,
      p50: computeQuantile(sorted, 0.5),
      p95: computeQuantile(sorted, 0.95),
      p99: computeQuantile(sorted, 0.99),
    };
  }

  renderPrometheus(): string {
    const lines: string[] = [];

    for (const [name, series] of this.counters.entries()) {
      lines.push(`# HELP ${name} ${series.help}`);
      lines.push(`# TYPE ${name} counter`);
      for (const [labelKey, val] of series.values.entries()) {
        const suffix = labelKey ? `{${labelKey}}` : '';
        lines.push(`${name}${suffix} ${val}`);
      }
    }

    for (const [name, series] of this.gauges.entries()) {
      lines.push(`# HELP ${name} ${series.help}`);
      lines.push(`# TYPE ${name} gauge`);
      for (const [labelKey, val] of series.values.entries()) {
        const suffix = labelKey ? `{${labelKey}}` : '';
        lines.push(`${name}${suffix} ${val}`);
      }
    }

    for (const [name, series] of this.histograms.entries()) {
      lines.push(`# HELP ${name} ${series.help}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const [labelKey, sample] of series.samples.entries()) {
        for (let i = 0; i < series.buckets.length; i++) {
          const leLabel = appendExtraLabel(labelKey, 'le', String(series.buckets[i]));
          lines.push(`${name}_bucket{${leLabel}} ${sample.bucketCounts[i]}`);
        }
        const infLabel = appendExtraLabel(labelKey, 'le', '+Inf');
        lines.push(`${name}_bucket{${infLabel}} ${sample.count}`);
        const suffix = labelKey ? `{${labelKey}}` : '';
        lines.push(`${name}_sum${suffix} ${sample.sum}`);
        lines.push(`${name}_count${suffix} ${sample.count}`);
      }

      // Also expose exact P50/P95/P99 summary gauges for operational convenience
      if (series.samples.size > 0) {
        const quantileGaugeName = `${name}_quantile`;
        lines.push(`# HELP ${quantileGaugeName} Exact P50/P95/P99 quantiles for ${name}`);
        lines.push(`# TYPE ${quantileGaugeName} gauge`);
        for (const [labelKey, sample] of series.samples.entries()) {
          const sorted = [...sample.observations].sort((a, b) => a - b);
          for (const [qStr, qNum] of [
            ['0.5', 0.5],
            ['0.95', 0.95],
            ['0.99', 0.99],
          ] as const) {
            const qVal = computeQuantile(sorted, qNum);
            const qLabel = appendExtraLabel(labelKey, 'quantile', qStr);
            lines.push(`${quantileGaugeName}{${qLabel}} ${qVal}`);
          }
        }
      }
    }

    return `${lines.join('\n')}\n`;
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.registerDefaults();
  }
}

export const defaultMetrics = new MetricsRegistry();

