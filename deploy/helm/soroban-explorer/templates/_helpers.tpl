{{- define "se.name" -}}{{ .Release.Name }}{{- end -}}
{{- define "se.labels" -}}
app.kubernetes.io/part-of: soroban-explorer
app.kubernetes.io/instance: {{ .Release.Name }}
explorer/region: {{ .Values.region }}
{{- end -}}
{{- define "se.dbEnv" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ if .Values.preview.enabled }}{{ .Release.Name }}-postgres{{ else }}{{ .Values.databaseUrlSecret }}{{ end }}
      key: DATABASE_URL
{{- end -}}
{{- define "se.strategy" -}}
{{- if .root.Values.canary.enabled }}
canary:
  canaryService: {{ .name }}-canary
  stableService: {{ .name }}
  # Split by new connections only; existing (sticky WebSocket) clients stay put.
  trafficRouting:
    nginx:
      stableIngress: {{ .name }}
  analysis:
    templates:
      - templateName: http-slo
    startingStep: 1
    args:
      - name: service
        value: {{ .name }}
      - name: canary-service
        value: {{ .name }}-canary
  steps:
    - setWeight: 5
    - pause: {duration: 5m}
    - setWeight: 25
    - pause: {duration: 10m}
    - setWeight: 50
    - pause: {duration: 10m}
    - setWeight: 100
{{- else }}
blueGreen:
  activeService: {{ .name }}
  autoPromotionEnabled: true
{{- end }}
{{- end -}}
