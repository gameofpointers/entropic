import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Cpu, Key, Shield } from "lucide-react";
import clsx from "clsx";
import {
  DEFAULT_LOCAL_MODEL_API_KEY,
  defaultLocalModelApiMode,
  defaultLocalModelBaseUrl,
  inspectLocalModelEndpoint,
  LOCAL_MODEL_API_MODE_OPTIONS,
  LOCAL_MODEL_SERVICE_OPTIONS,
  type LocalModelApiMode,
  type LocalModelConfig,
  type LocalModelServiceType,
} from "../lib/auth";
import { RnnLocalModelManager } from "./RnnLocalModelManager";

type Props = {
  config: LocalModelConfig;
  onChange: (config: LocalModelConfig) => void;
  className?: string;
};

type LocalModelRecommendation = {
  label: string;
  description: string;
  modelId?: string;
};

export function LocalAiServiceForm({ config, onChange, className }: Props) {
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [discoveryStatus, setDiscoveryStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [modelInventoryVersion, setModelInventoryVersion] = useState(0);
  const discoveryRequestRef = useRef(0);
  const endpointSecurity = inspectLocalModelEndpoint(config.baseUrl);
  const endpointBlocked =
    endpointSecurity.status === "non-local" && !config.allowNonLocal;
  const endpointInvalid = endpointSecurity.status === "invalid";
  const recommendations = buildLocalModelRecommendations(suggestions);

  function requestApiKey(value: string): string | null {
    return value.trim() && value !== DEFAULT_LOCAL_MODEL_API_KEY ? value : null;
  }

  function updateConfig(nextConfig: LocalModelConfig) {
    setTestStatus("idle");
    setTestError(null);
    const endpointChanged =
      !nextConfig.enabled ||
      nextConfig.serviceType !== config.serviceType ||
      nextConfig.apiMode !== config.apiMode ||
      nextConfig.baseUrl.trim() !== config.baseUrl.trim() ||
      nextConfig.apiKey !== config.apiKey;
    if (endpointChanged) {
      setDiscoveryStatus("idle");
      setDiscoveryError(null);
      setSuggestions([]);
    }
    onChange(nextConfig);
  }

  function handleServiceTypeChange(serviceType: LocalModelServiceType) {
    const previousDefaultBaseUrl = defaultLocalModelBaseUrl(config.serviceType);
    const nextBaseUrl =
      serviceType === "rnn-local"
        ? defaultLocalModelBaseUrl(serviceType)
        : !config.baseUrl.trim() || config.baseUrl === previousDefaultBaseUrl
        ? defaultLocalModelBaseUrl(serviceType)
        : config.baseUrl;
    updateConfig({
      ...config,
      enabled: true,
      serviceType,
      apiMode: defaultLocalModelApiMode(serviceType),
      baseUrl: nextBaseUrl,
      allowNonLocal: serviceType === "rnn-local" ? false : config.allowNonLocal,
    });
  }

  function handleRnnCatalogChange() {
    setModelInventoryVersion((version) => version + 1);
  }

  async function discoverModelIds(snapshot: LocalModelConfig, requestId: number) {
    setDiscoveryStatus("loading");
    setDiscoveryError(null);
    try {
      const discovered = await invoke<string[]>("discover_local_model_ids", {
        serviceType: snapshot.serviceType,
        apiMode: snapshot.apiMode,
        baseUrl: snapshot.baseUrl,
        apiKey: requestApiKey(snapshot.apiKey),
        allowNonLocal: snapshot.allowNonLocal,
      });
      if (discoveryRequestRef.current !== requestId) {
        return;
      }
      setSuggestions(discovered);
      setDiscoveryStatus("success");
      if (!snapshot.modelName.trim() && discovered.length === 1) {
        updateConfig({ ...snapshot, enabled: true, modelName: discovered[0] });
      }
    } catch (error: any) {
      if (discoveryRequestRef.current !== requestId) {
        return;
      }
      setDiscoveryStatus("error");
      setDiscoveryError(String(error));
      setSuggestions([]);
    }
  }

  useEffect(() => {
    if (!config.enabled || !config.baseUrl.trim() || endpointInvalid || endpointBlocked) {
      discoveryRequestRef.current += 1;
      setDiscoveryStatus("idle");
      setDiscoveryError(null);
      setSuggestions([]);
      return;
    }

    const requestId = discoveryRequestRef.current + 1;
    discoveryRequestRef.current = requestId;
    const snapshot = { ...config };
    setDiscoveryStatus("loading");
    setDiscoveryError(null);

    const timeoutId = window.setTimeout(() => {
      void discoverModelIds(snapshot, requestId);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    config.enabled,
    config.serviceType,
    config.apiMode,
    config.baseUrl,
    config.apiKey,
    config.allowNonLocal,
    modelInventoryVersion,
    endpointInvalid,
    endpointBlocked,
  ]);

  async function testConnection() {
    setTestStatus("testing");
    setTestError(null);
    try {
      await invoke("test_local_model_connection", {
        serviceType: config.serviceType,
        apiMode: config.apiMode,
        baseUrl: config.baseUrl,
        apiKey: requestApiKey(config.apiKey),
        modelName: config.modelName,
        allowNonLocal: config.allowNonLocal,
      });
      setTestStatus("success");
    } catch (error: any) {
      setTestStatus("error");
      setTestError(String(error));
    }
  }

  const selectClassName =
    "w-full appearance-none rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2.5 pr-8 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--system-blue)]/25";
  const inputClassName =
    "w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--system-blue)]/25";

  return (
    <div className={clsx("space-y-4", className)}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Service Type" icon={Cpu}>
          <div className="relative">
            <select
              value={config.serviceType}
              onChange={(event) =>
                handleServiceTypeChange(event.target.value as LocalModelServiceType)
              }
              className={selectClassName}
            >
              {LOCAL_MODEL_SERVICE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
          </div>
        </Field>

        {config.serviceType !== "ollama" && config.serviceType !== "rnn-local" ? (
          <Field
            label="API Mode"
            icon={Shield}
            help="Select which API format this service uses."
          >
            <div className="relative">
              <select
                value={config.apiMode}
                onChange={(event) =>
                  updateConfig({
                    ...config,
                    enabled: true,
                    apiMode: event.target.value as LocalModelApiMode,
                  })
                }
                className={selectClassName}
              >
                {LOCAL_MODEL_API_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
            </div>
          </Field>
        ) : config.serviceType === "ollama" ? (
          <Field label="API Mode" icon={Shield} help="Ollama uses its native API automatically.">
            <div className={clsx(inputClassName, "flex items-center text-[var(--text-secondary)]")}>
              Ollama API
            </div>
          </Field>
        ) : (
          <Field
            label="API Mode"
            icon={Shield}
            help="The managed RNN runtime exposes an OpenAI-compatible chat completions endpoint."
          >
            <div className={clsx(inputClassName, "flex items-center text-[var(--text-secondary)]")}>
              Chat Completions
            </div>
          </Field>
        )}
      </div>

      <Field
        label="Base URL"
        icon={Key}
        help={
          config.serviceType === "ollama"
            ? "Example: http://localhost:11434"
            : config.serviceType === "rnn-local"
              ? "Managed by Entropic on http://localhost:11445/v1"
            : "Example: http://localhost:1234/v1"
        }
      >
        <input
          type="text"
          value={config.baseUrl}
          onChange={(event) =>
            updateConfig({ ...config, enabled: true, baseUrl: event.target.value })
          }
          disabled={config.serviceType === "rnn-local"}
          className={clsx(inputClassName, config.serviceType === "rnn-local" && "opacity-70")}
          placeholder={defaultLocalModelBaseUrl(config.serviceType)}
        />
        {endpointSecurity.status === "local" && (
          <div className="mt-2 text-xs text-green-600">
            Loopback endpoint detected. Local model traffic stays on this machine.
          </div>
        )}
        {endpointSecurity.status === "invalid" && (
          <div className="mt-2 text-xs text-red-500">{endpointSecurity.message}</div>
        )}
        {endpointSecurity.status === "non-local" && (
          <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
            <div className="font-medium text-amber-700">Non-local endpoint detected</div>
            <div className="mt-1 text-[var(--text-secondary)]">
              {endpointSecurity.host} is not a loopback address. Requests may traverse your LAN or
              another network.
              {!endpointSecurity.encrypted
                ? " This URL uses plain HTTP."
                : " This URL uses HTTPS."}
            </div>
            <label className="mt-3 flex items-start gap-2 text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={config.allowNonLocal}
                onChange={(event) =>
                  updateConfig({
                    ...config,
                    enabled: true,
                    allowNonLocal: event.target.checked,
                  })
                }
                className="mt-0.5 h-4 w-4 rounded border-[var(--border-subtle)]"
              />
              <span>
                Allow non-local endpoint
                <span className="mt-1 block text-[var(--text-secondary)]">
                  Use this only if you trust the server and network path.
                </span>
              </span>
            </label>
          </div>
        )}
      </Field>

      <Field
        label="API Key"
        icon={Key}
        help={
          config.serviceType === "rnn-local"
            ? "Optional Hugging Face token for gated downloads."
            : "Optional. Most local services don't require a key."
        }
      >
        <input
          type="password"
          value={config.apiKey === DEFAULT_LOCAL_MODEL_API_KEY ? "" : config.apiKey}
          onChange={(event) =>
            updateConfig({
              ...config,
              enabled: true,
              apiKey: event.target.value || DEFAULT_LOCAL_MODEL_API_KEY,
            })
          }
          className={inputClassName}
          placeholder="Optional"
        />
      </Field>

      {config.serviceType === "rnn-local" ? (
        <RnnLocalModelManager
          config={config}
          onChange={updateConfig}
          onCatalogChange={handleRnnCatalogChange}
        />
      ) : null}

      <Field
        label="Model ID"
        icon={Cpu}
        help={
          config.serviceType === "rnn-local"
            ? "Downloaded RNN models appear here automatically after refresh."
            : "Models are detected automatically when available."
        }
      >
        <div className="space-y-2">
          <div className="relative">
            <select
              value={suggestions.includes(config.modelName) ? config.modelName : ""}
              onChange={(event) =>
                updateConfig({ ...config, enabled: true, modelName: event.target.value })
              }
              disabled={discoveryStatus === "loading" || suggestions.length === 0}
              className={clsx(selectClassName, "disabled:opacity-60")}
            >
              <option value="">
                {discoveryStatus === "loading"
                  ? "Discovering models..."
                  : endpointInvalid
                    ? "Enter a valid base URL"
                    : endpointBlocked
                      ? "Allow non-local endpoint to continue"
                      : !config.baseUrl.trim()
                        ? "Enter a base URL first"
                        : discoveryStatus === "error"
                          ? "Could not detect models"
                          : suggestions.length === 0
                            ? "No models found"
                            : "Select a model..."}
              </option>
              {suggestions.map((modelId) => (
                <option key={modelId} value={modelId}>
                  {modelId}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
          </div>

          <input
            type="text"
            value={config.modelName}
            onChange={(event) =>
              updateConfig({ ...config, enabled: true, modelName: event.target.value })
            }
            className={inputClassName}
            placeholder={
              config.serviceType === "rnn-local" ? "rwkv7-g1d-2.9b-..." : "qwen3:8b"
            }
          />

          {discoveryStatus === "success" && suggestions.length > 0 && (
            <div className="text-xs text-[var(--text-secondary)]">
              Found {suggestions.length} model{suggestions.length === 1 ? "" : "s"} from this service.
            </div>
          )}
          {discoveryStatus === "success" && suggestions.length === 0 && (
            <div className="text-xs text-[var(--text-secondary)]">
              Connected, but no models were found. Type a model ID below.
            </div>
          )}
          {discoveryStatus === "error" && discoveryError && (
            <div className="text-xs text-red-500">{discoveryError}</div>
          )}
          <div className="grid gap-2 pt-1 md:grid-cols-3">
            {recommendations.map((recommendation) => {
              const selected = recommendation.modelId && recommendation.modelId === config.modelName;
              return (
                <button
                  key={recommendation.label}
                  type="button"
                  onClick={() => {
                    if (!recommendation.modelId) return;
                    updateConfig({
                      ...config,
                      enabled: true,
                      modelName: recommendation.modelId,
                    });
                  }}
                  disabled={!recommendation.modelId}
                  className={clsx(
                    "rounded-xl border px-3 py-2 text-left transition-colors",
                    recommendation.modelId
                      ? "border-[var(--border-subtle)] bg-[var(--bg-card)] hover:border-[var(--system-blue)]/50"
                      : "border-[var(--border-subtle)]/60 bg-[var(--bg-card)]/60 opacity-80",
                    selected && "border-[var(--system-blue)] bg-[var(--system-blue)]/8",
                  )}
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                    {recommendation.label}
                  </div>
                  <div className="mt-1 text-sm font-medium text-[var(--text-primary)]">
                    {recommendation.modelId || "Use your preferred model"}
                  </div>
                  <div className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                    {recommendation.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </Field>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => void testConnection()}
          disabled={
            testStatus === "testing" ||
            !config.modelName.trim() ||
            !config.baseUrl.trim() ||
            endpointInvalid ||
            endpointBlocked
          }
          className="rounded-xl bg-[var(--system-blue)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {testStatus === "testing" ? "Testing..." : "Test Connection"}
        </button>
        {testStatus === "success" && (
          <span className="text-sm font-medium text-green-600">Connected</span>
        )}
        {testStatus === "error" && (
          <span className="max-w-full text-sm text-red-500" title={testError || undefined}>
            {testError}
          </span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  children,
  help,
}: {
  label: string;
  icon: typeof Cpu | typeof Key | typeof Shield;
  children: ReactNode;
  help?: string;
}) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--system-blue)]/10 text-[var(--system-blue)]">
          <Icon className="h-4 w-4" />
        </span>
        <span>{label}</span>
      </div>
      {children}
      {help ? <div className="mt-1.5 text-xs text-[var(--text-secondary)]">{help}</div> : null}
    </label>
  );
}

function buildLocalModelRecommendations(suggestions: string[]): LocalModelRecommendation[] {
  const pick = (...patterns: RegExp[]): string | undefined =>
    suggestions.find((modelId) => patterns.every((pattern) => pattern.test(modelId)));
  const pickWithout = (include: RegExp[], exclude: RegExp[]): string | undefined =>
    suggestions.find(
      (modelId) =>
        include.every((pattern) => pattern.test(modelId)) &&
        exclude.every((pattern) => !pattern.test(modelId)),
    );

  const fastChat =
    pickWithout([/(?:^|[:/-])(7b|8b|4b|3b)\b/i], [/coder|codestral|codegemma|deepseek-coder/i]) ||
    pickWithout([/mini|small/i], [/coder|codestral|codegemma|deepseek-coder/i]) ||
    pickWithout([/qwen|llama|mistral|gemma/i], [/coder|codestral|codegemma|deepseek-coder/i]);
  const coding =
    pick(/coder|codestral|codegemma|deepseek-coder/i, /(?:^|[:/-])(7b|8b|14b)\b/i) ||
    pick(/coder|codestral|codegemma|deepseek-coder/i);
  const quality =
    pickWithout([/(?:^|[:/-])(14b|32b|70b)\b/i], [/coder|codestral|codegemma|deepseek-coder/i]) ||
    pickWithout([/qwen|llama|mistral/i, /(?:^|[:/-])14b\b/i], [/coder|codestral|codegemma|deepseek-coder/i]);

  return [
    {
      label: "Fast Chat",
      modelId: fastChat,
      description: fastChat
        ? "Good default when you want lower latency on a 12 GB GPU."
        : "For a 12 GB GPU, start with a 7B-8B instruct model for the best responsiveness.",
    },
    {
      label: "Coding",
      modelId: coding,
      description: coding
        ? "Prefer a smaller coder-specialized model for edits, debugging, and tool-heavy work."
        : "Prefer a 7B-8B coder model for code work instead of a larger general model.",
    },
    {
      label: "Higher Quality",
      modelId: quality,
      description: quality
        ? "Use a larger general model when quality matters more than speed."
        : "Use 14B+ general models only if you can tolerate slower first-token latency.",
    },
  ];
}
