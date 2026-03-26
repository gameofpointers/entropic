import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Cpu,
  Download,
  Flame,
  Loader2,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import clsx from "clsx";
import { DEFAULT_LOCAL_MODEL_API_KEY, type LocalModelConfig } from "../lib/auth";

type Props = {
  config: LocalModelConfig;
  onChange: (config: LocalModelConfig) => void;
  onCatalogChange?: () => void;
};

type RnnCatalogEntry = {
  id: string;
  name: string;
  display_name?: string;
  architecture?: string;
  params?: string;
  size_gb?: number;
  context?: number;
  description?: string;
  thinking?: boolean;
  downloaded?: boolean;
  loaded?: boolean;
};

type RnnLocalEntry = {
  name: string;
  filename: string;
  path: string;
  size_gb?: number;
  architecture?: string;
  display_name?: string;
  catalog_id?: string | null;
  description?: string;
  thinking?: boolean;
  loaded?: boolean;
};

type RnnCatalogSnapshot = {
  catalog: RnnCatalogEntry[];
  local: RnnLocalEntry[];
  loadedModel?: string | null;
  lastError?: string | null;
};

type RnnRuntimeStatus = {
  running: boolean;
  baseUrl: string;
  loadedModel?: string | null;
  lastError?: string | null;
  pid?: number | null;
  modelsDir: string;
  stateDir: string;
  logFile: string;
  scriptPath?: string | null;
};

type BusyAction = {
  kind: "refresh" | "download" | "load" | "warm" | "delete" | "unload";
  target?: string;
} | null;

function formatSize(sizeGb?: number): string | null {
  if (typeof sizeGb !== "number" || Number.isNaN(sizeGb) || sizeGb <= 0) {
    return null;
  }
  return `${sizeGb.toFixed(sizeGb >= 10 ? 0 : 1)} GB`;
}

function trimApiKey(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === DEFAULT_LOCAL_MODEL_API_KEY) {
    return null;
  }
  return trimmed;
}

export function RnnLocalModelManager({ config, onChange, onCatalogChange }: Props) {
  const [snapshot, setSnapshot] = useState<RnnCatalogSnapshot | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RnnRuntimeStatus | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestRef = useRef(0);

  async function refreshCatalog(opts?: { quiet?: boolean }): Promise<RnnCatalogSnapshot | null> {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (!opts?.quiet) {
      setBusyAction({ kind: "refresh" });
    }
    setError(null);

    try {
      const nextSnapshot = await invoke<RnnCatalogSnapshot>("get_rnn_catalog");
      const nextStatus = await invoke<RnnRuntimeStatus>("get_rnn_runtime_status");
      if (requestRef.current !== requestId) {
        return nextSnapshot;
      }
      setSnapshot(nextSnapshot);
      setRuntimeStatus(nextStatus);
      setBusyAction((current) => (current?.kind === "refresh" ? null : current));
      if (nextSnapshot.loadedModel && nextSnapshot.loadedModel !== config.modelName) {
        onChange({
          ...config,
          enabled: true,
          modelName: nextSnapshot.loadedModel,
        });
      }
      return nextSnapshot;
    } catch (nextError: any) {
      if (requestRef.current !== requestId) {
        return null;
      }
      setBusyAction((current) => (current?.kind === "refresh" ? null : current));
      setError(String(nextError));
      return null;
    }
  }

  useEffect(() => {
    if (config.serviceType !== "rnn-local") {
      return;
    }
    void refreshCatalog();
  }, [config.serviceType]);

  async function runAction(
    nextBusyAction: NonNullable<BusyAction>,
    request: () => Promise<any>,
    successMessage: string,
  ) {
    setBusyAction(nextBusyAction);
    setError(null);
    setMessage(null);
    try {
      const result = await request();
      const nextSnapshot = await refreshCatalog({ quiet: true });
      if (nextBusyAction.kind === "load") {
        const nextModel =
          (typeof result?.model === "string" && result.model.trim()) ||
          nextSnapshot?.loadedModel ||
          nextBusyAction.target;
        onChange({
          ...config,
          enabled: true,
          modelName: nextModel,
        });
      }
      if (
        nextBusyAction.kind === "delete" &&
        config.modelName === nextBusyAction.target &&
        !nextSnapshot?.local.some((entry) => entry.name === nextBusyAction.target)
      ) {
        onChange({
          ...config,
          enabled: true,
          modelName: "",
        });
      }
      if (nextBusyAction.kind === "unload" && nextSnapshot?.loadedModel === null) {
        setRuntimeStatus((current) =>
          current
            ? {
                ...current,
                loadedModel: null,
              }
            : current,
        );
      }
      setMessage(successMessage);
      onCatalogChange?.();
    } catch (nextError: any) {
      setError(String(nextError));
    } finally {
      setBusyAction(null);
    }
  }

  const localByCatalogId = new Map<string, RnnLocalEntry>();
  for (const entry of snapshot?.local || []) {
    if (entry.catalog_id) {
      localByCatalogId.set(entry.catalog_id, entry);
    }
  }

  const buttonClassName =
    "inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-50";
  const badgeClassName =
    "inline-flex items-center rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]";

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--system-blue)]/10 text-[var(--system-blue)]">
              <Cpu className="h-4 w-4" />
            </span>
            <span>Managed RNN Runtime</span>
          </div>
          <div className="mt-1 text-xs text-[var(--text-secondary)]">
            Curated RNN models download into a local cache and are exposed through the built-in
            OpenAI-compatible connector.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refreshCatalog()}
          disabled={busyAction !== null}
          className={buttonClassName}
        >
          {busyAction?.kind === "refresh" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
        <span className={badgeClassName}>
          {runtimeStatus?.running ? "Runtime ready" : "Runtime starting"}
        </span>
        {runtimeStatus?.loadedModel ? <span className={badgeClassName}>Loaded: {runtimeStatus.loadedModel}</span> : null}
        {runtimeStatus?.pid ? <span className={badgeClassName}>PID {runtimeStatus.pid}</span> : null}
      </div>

      {runtimeStatus?.logFile ? (
        <div className="text-xs text-[var(--text-secondary)]">
          Log: <span className="font-mono">{runtimeStatus.logFile}</span>
        </div>
      ) : null}

      {message ? <div className="text-xs text-green-600">{message}</div> : null}
      {error ? <div className="text-xs text-red-500">{error}</div> : null}
      {!error && snapshot?.lastError ? (
        <div className="text-xs text-amber-600">{snapshot.lastError}</div>
      ) : null}

      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
          Local Models
        </div>
        {snapshot?.local.length ? (
          <div className="space-y-2">
            {snapshot.local.map((entry) => {
              const isLoaded = snapshot.loadedModel === entry.name || entry.loaded === true;
              const isBusy =
                busyAction?.kind !== "refresh" && busyAction?.target === entry.name;
              return (
                <div
                  key={entry.name}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)]/40 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium text-[var(--text-primary)]">
                          {entry.display_name || entry.name}
                        </div>
                        {isLoaded ? <span className={badgeClassName}>Loaded</span> : null}
                        {entry.thinking ? <span className={badgeClassName}>Thinking</span> : null}
                      </div>
                      <div className="mt-1 text-xs text-[var(--text-secondary)]">
                        {[entry.architecture?.toUpperCase(), formatSize(entry.size_gb)]
                          .filter(Boolean)
                          .join(" • ") || entry.filename}
                      </div>
                      {entry.description ? (
                        <div className="mt-1 text-xs text-[var(--text-secondary)]">
                          {entry.description}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void runAction(
                            { kind: "load", target: entry.name },
                            () => invoke("load_rnn_model", { modelName: entry.name }),
                            `Loaded ${entry.display_name || entry.name}.`,
                          )
                        }
                        disabled={busyAction !== null}
                        className={buttonClassName}
                      >
                        {isBusy && busyAction?.kind === "load" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Cpu className="h-3.5 w-3.5" />
                        )}
                        Load
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void runAction(
                            { kind: "warm", target: entry.name },
                            () => invoke("warm_rnn_model", { modelName: entry.name }),
                            `Warmed ${entry.display_name || entry.name}.`,
                          )
                        }
                        disabled={busyAction !== null}
                        className={buttonClassName}
                      >
                        {isBusy && busyAction?.kind === "warm" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Flame className="h-3.5 w-3.5" />
                        )}
                        Warm
                      </button>
                      {isLoaded ? (
                        <button
                          type="button"
                          onClick={() =>
                            void runAction(
                              { kind: "unload" },
                              () => invoke("unload_rnn_model"),
                              `Unloaded ${entry.display_name || entry.name}.`,
                            )
                          }
                          disabled={busyAction !== null}
                          className={buttonClassName}
                        >
                          {busyAction?.kind === "unload" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Square className="h-3.5 w-3.5" />
                          )}
                          Unload
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() =>
                          void runAction(
                            { kind: "delete", target: entry.name },
                            () => invoke("delete_rnn_model", { modelName: entry.name }),
                            `Deleted ${entry.display_name || entry.name}.`,
                          )
                        }
                        disabled={busyAction !== null}
                        className={clsx(buttonClassName, "text-red-500")}
                      >
                        {isBusy && busyAction?.kind === "delete" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--border-subtle)] p-3 text-xs text-[var(--text-secondary)]">
            No local RNN models yet. Download one from the curated catalog below.
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
          Curated Catalog
        </div>
        <div className="space-y-2">
          {(snapshot?.catalog || []).map((entry) => {
            const localEntry = localByCatalogId.get(entry.id);
            const targetName = localEntry?.name || entry.id;
            const isBusy = busyAction?.kind !== "refresh" && busyAction?.target === targetName;
            return (
              <div
                key={entry.id}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)]/40 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-medium text-[var(--text-primary)]">
                        {entry.display_name || entry.name}
                      </div>
                      {entry.params ? <span className={badgeClassName}>{entry.params}</span> : null}
                      {entry.thinking ? <span className={badgeClassName}>Thinking</span> : null}
                      {localEntry ? <span className={badgeClassName}>Downloaded</span> : null}
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-secondary)]">
                      {[entry.architecture?.toUpperCase(), formatSize(entry.size_gb)]
                        .filter(Boolean)
                        .join(" • ")}
                    </div>
                    {entry.description ? (
                      <div className="mt-1 text-xs text-[var(--text-secondary)]">
                        {entry.description}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {localEntry ? (
                      <button
                        type="button"
                        onClick={() =>
                          void runAction(
                            { kind: "load", target: localEntry.name },
                            () => invoke("load_rnn_model", { modelName: localEntry.name }),
                            `Loaded ${localEntry.display_name || localEntry.name}.`,
                          )
                        }
                        disabled={busyAction !== null}
                        className={buttonClassName}
                      >
                        {isBusy && busyAction?.kind === "load" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Cpu className="h-3.5 w-3.5" />
                        )}
                        Load
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          void runAction(
                            { kind: "download", target: entry.id },
                            () =>
                              invoke("download_rnn_model", {
                                catalogId: entry.id,
                                hfToken: trimApiKey(config.apiKey),
                              }),
                            `Downloaded ${entry.display_name || entry.name}.`,
                          )
                        }
                        disabled={busyAction !== null}
                        className={buttonClassName}
                      >
                        {isBusy && busyAction?.kind === "download" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        Download
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
