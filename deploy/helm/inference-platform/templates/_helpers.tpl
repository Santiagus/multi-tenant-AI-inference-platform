{{/*
Common labels for Multi-Tenant AI Inference Platform resources
*/}}
{{- define "inference-platform.labels" -}}
app.kubernetes.io/part-of: multi-tenant-ai-inference-platform
app.kubernetes.io/managed-by: Helm
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
platform.ai/environment: {{ .Values.global.environment | quote }}
{{- end -}}

