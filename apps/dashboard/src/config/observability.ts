/**
 * Observability configuration and deep link generators for Local and AWS deployments.
 * Supports Docker Compose, Kubernetes, and AWS ECS/CloudWatch environments.
 */

export function isLocalEnvironment(): boolean {
  if (typeof window === 'undefined') return true;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
}

export function getGrafanaBaseUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_GRAFANA_URL;
  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }
  return isLocalEnvironment() ? 'http://localhost:3001' : '/grafana';
}

export function getGrafanaDashboardsUrl(): string {
  return `${getGrafanaBaseUrl()}/dashboards`;
}

export function getPrometheusBaseUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_PROMETHEUS_URL;
  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }
  return isLocalEnvironment() ? 'http://localhost:9090' : '/prometheus';
}

export function getPrometheusGraphUrl(expr?: string): string {
  const base = getPrometheusBaseUrl();
  const query = expr || 'sum by (route) (rate(http_server_requests_total[1m]))';
  return `${base}/graph?g0.expr=${encodeURIComponent(query)}&g0.tab=0&g0.range_input=1h`;
}

export function getPrometheusAlertsUrl(): string {
  return `${getPrometheusBaseUrl()}/alerts`;
}

export function getProviderGrafanaUrl(provider?: string): string {
  const base = getGrafanaBaseUrl();
  const slug = '/d/platform-provider-routing';
  if (!provider) return `${base}${slug}`;
  return `${base}${slug}?var-provider=${encodeURIComponent(provider)}`;
}

export function getProviderLogCommand(provider: string): string {
  if (isLocalEnvironment()) {
    return `docker compose logs --tail=100 -f api | grep -i "${provider}"`;
  }
  // AWS ECS Fargate & CloudWatch Logs CLI command
  return `aws logs tail /aws/ecs/platform-api --follow --filter-pattern "${provider}"`;
}

export function getKubectlLogCommand(provider: string): string {
  return `kubectl logs -n platform -l app=inference-api --tail=100 | grep -i "${provider}"`;
}
