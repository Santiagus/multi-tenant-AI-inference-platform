import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getGrafanaBaseUrl,
  getGrafanaDashboardsUrl,
  getPrometheusBaseUrl,
  getPrometheusGraphUrl,
  getPrometheusAlertsUrl,
  getProviderGrafanaUrl,
  getProviderLogCommand,
  getKubectlLogCommand,
  isLocalEnvironment,
} from '../src/config/observability';

describe('Observability Configuration & Deep Links (Local vs AWS)', () => {
  test('isLocalEnvironment defaults to true in non-browser Node environments', () => {
    assert.equal(isLocalEnvironment(), true);
  });

  test('getGrafanaBaseUrl returns http://localhost:3001 in local environments', () => {
    const url = getGrafanaBaseUrl();
    assert.equal(url, 'http://localhost:3001');
  });

  test('getGrafanaDashboardsUrl returns http://localhost:3001/dashboards', () => {
    const url = getGrafanaDashboardsUrl();
    assert.equal(url, 'http://localhost:3001/dashboards');
  });

  test('getPrometheusBaseUrl returns http://localhost:9090 in local environments', () => {
    const url = getPrometheusBaseUrl();
    assert.equal(url, 'http://localhost:9090');
  });

  test('getPrometheusGraphUrl generates deep link with pre-filtered PromQL expression and 1h range', () => {
    const url = getPrometheusGraphUrl();
    assert.ok(url.startsWith('http://localhost:9090/graph?g0.expr='));
    assert.ok(url.includes('g0.tab=0'));
    assert.ok(url.includes('g0.range_input=1h'));

    const customUrl = getPrometheusGraphUrl('rate(inference_job_errors_total[1m])');
    assert.ok(customUrl.includes('g0.expr=rate(inference_job_errors_total%5B1m%5D)'));
  });

  test('getPrometheusAlertsUrl points directly to /alerts', () => {
    const url = getPrometheusAlertsUrl();
    assert.equal(url, 'http://localhost:9090/alerts');
  });

  test('getProviderGrafanaUrl builds valid deep link with pre-filled provider filter', () => {
    const url = getProviderGrafanaUrl('vast_ai');
    assert.equal(url, 'http://localhost:3001/d/platform-provider-routing?var-provider=vast_ai');
  });

  test('getProviderLogCommand returns Docker Compose command in local environment', () => {
    const cmd = getProviderLogCommand('vast_ai');
    assert.equal(cmd, 'docker compose logs --tail=100 -f api | grep -i "vast_ai"');
  });

  test('getKubectlLogCommand generates valid Kubernetes log command', () => {
    const cmd = getKubectlLogCommand('runpod');
    assert.equal(cmd, 'kubectl logs -n platform -l app=inference-api --tail=100 | grep -i "runpod"');
  });
});
