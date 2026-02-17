import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Layout, Page } from "../components/Layout";
import { Chat, type ChatSession, type ChatSessionActionRequest } from "./Chat";
import { Store } from "./Store";
import { Channels } from "./Channels";
import { Files } from "./Files";
import { Tasks } from "./Tasks";
import { Logs } from "./Logs";
import { BillingPage } from "./BillingPage";
import { Settings } from "./Settings";
import { useAuth } from "../contexts/AuthContext";
import { createGatewayToken, getProxyUrl, getBalance, ApiRequestError } from "../lib/auth";
import {
  hasPendingIntegrationImports,
  syncPendingIntegrationImports,
  syncAllIntegrationsToGateway,
  getCachedIntegrationProviders,
  startIntegrationRefreshLoop,
  stopIntegrationRefreshLoop,
} from "../lib/integrations";
import { getGatewayStatusCached } from "../lib/gateway-status";
import { LOCAL_MODEL_IDS, PROXY_MODEL_IDS } from "../components/ModelSelector";
import { Store as TauriStore } from "@tauri-apps/plugin-store";

type RuntimeStatus = {
  colima_installed: boolean;
  docker_installed: boolean;
  vm_running: boolean;
  docker_ready: boolean;
};

type Props = {
  status: RuntimeStatus | null;
  onRefresh: () => void;
};

// Default models per mode
const DEFAULT_PROXY_MODEL = "openai/gpt-5.2";
const DEFAULT_LOCAL_MODEL = "anthropic/claude-opus-4-6:thinking";
const GATEWAY_FAILURE_THRESHOLD = 3;

export function Dashboard({ status: _status, onRefresh: _onRefresh }: Props) {
  const { isAuthenticated, isAuthConfigured } = useAuth();
  const [useLocalKeys, setUseLocalKeys] = useState(false);
  const [currentPage, setCurrentPage] = useState<Page>("files");
  const [gatewayRunning, setGatewayRunning] = useState(false);
  const [isTogglingGateway, setIsTogglingGateway] = useState(false);
  const [showGatewayStartup, setShowGatewayStartup] = useState(false);
  const [gatewayStartupStage, setGatewayStartupStage] = useState<"idle" | "credits" | "token" | "launch" | "health">("idle");
  const [startupError, setStartupError] = useState<{
    message: string;
    actions?: Array<{ label: string; onClick: () => void }>;
  } | null>(null);
  const [gatewayRetryIn, setGatewayRetryIn] = useState<number | null>(null);
  const [integrationsSyncing, setIntegrationsSyncing] = useState(false);
  const [integrationsMissing, setIntegrationsMissing] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_PROXY_MODEL);
  const [codeModel, setCodeModel] = useState("openai/gpt-5.2-codex");
  const [imageModel, setImageModel] = useState("google/gemini-3-pro-image-preview");
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [currentChatSession, setCurrentChatSession] = useState<string | null>(null);
  const [pendingChatSession, setPendingChatSession] = useState<string | null>(null);
  const [pendingChatAction, setPendingChatAction] = useState<ChatSessionActionRequest | null>(null);
  const gatewayTokenRef = useRef<string | null>(null);
  const autoStartAttemptedRef = useRef(false);
  const startGatewayAttemptRef = useRef(0);
  const startGatewayInFlightRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const retryTimeoutRef = useRef<number | null>(null);
  const retryIntervalRef = useRef<number | null>(null);
  const fullSyncRef = useRef(false);
  const [providerSwitchConfirm, setProviderSwitchConfirm] = useState<{
    oldProvider: string;
    newProvider: string;
    newModel: string;
  } | null>(null);
  const gatewayHealthFailureStreakRef = useRef(0);

  // Load saved model preference
  useEffect(() => {
    async function loadModel() {
      try {
        const store = await TauriStore.load("nova-settings.json");
        const storedUseLocal = await store.get("useLocalKeys") as boolean | null;
        if (typeof storedUseLocal === "boolean") setUseLocalKeys(storedUseLocal);
        const isLocal = storedUseLocal === true;

        const saved = await store.get("selectedModel") as string | null;
        if (saved) {
          // If the saved model doesn't match the current mode, pick a sensible default
          if (isLocal && !LOCAL_MODEL_IDS.has(saved)) {
            setSelectedModel(DEFAULT_LOCAL_MODEL);
          } else if (!isLocal && !PROXY_MODEL_IDS.has(saved)) {
            setSelectedModel(DEFAULT_PROXY_MODEL);
          } else {
            setSelectedModel(saved);
          }
        } else {
          setSelectedModel(isLocal ? DEFAULT_LOCAL_MODEL : DEFAULT_PROXY_MODEL);
        }

        const savedCode = await store.get("codeModel") as string | null;
        if (savedCode) setCodeModel(savedCode);
        const savedImage = await store.get("imageModel") as string | null;
        if (savedImage) setImageModel(savedImage);
      } catch (error) {
        console.error("[Nova] Failed to load model preference:", error);
      } finally {
        setPrefsLoaded(true);
      }
    }
    loadModel();
  }, []);

  useEffect(() => {
    const intervalMs =
      gatewayRunning && !showGatewayStartup && !isTogglingGateway ? 15_000 : 5_000;
    checkGateway();
    const interval = window.setInterval(checkGateway, intervalMs);
    return () => window.clearInterval(interval);
  }, [gatewayRunning, showGatewayStartup, isTogglingGateway]);

  useEffect(() => {
    if (!gatewayRunning) {
      stopIntegrationRefreshLoop();
      setIntegrationsSyncing(false);
      fullSyncRef.current = false;
      return;
    }
    let cancelled = false;
    let intervalId: number | null = null;
    const deadline = Date.now() + 5 * 60_000;

    const syncOnce = async () => {
      if (cancelled) return;
      let didWork = false;
      try {
        if (!fullSyncRef.current) {
          setIntegrationsSyncing(true);
          const synced = await syncAllIntegrationsToGateway();
          fullSyncRef.current = true;
          didWork = true;
          if (!cancelled) {
            const cached = await getCachedIntegrationProviders().catch(() => []);
            const missing = synced.length === 0 && cached.length > 0;
            setIntegrationsMissing(missing);
          }
        }
        await syncPendingIntegrationImports();
        didWork = true;
      } catch (err) {
        console.warn("[Nova] Failed to sync integration tokens:", err);
      }
      try {
        const stillPending = await hasPendingIntegrationImports();
        if (!cancelled) {
          setIntegrationsSyncing(stillPending || (!fullSyncRef.current && didWork));
        }
        if ((!stillPending && fullSyncRef.current) || Date.now() > deadline) {
          if (intervalId !== null) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
        }
      } catch {
        if (Date.now() > deadline && intervalId !== null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      }
    };

    syncOnce();
    intervalId = window.setInterval(syncOnce, 10_000);
    startIntegrationRefreshLoop();
    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      stopIntegrationRefreshLoop();
    };
  }, [gatewayRunning]);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        window.clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      if (retryIntervalRef.current) {
        window.clearInterval(retryIntervalRef.current);
        retryIntervalRef.current = null;
      }
    };
  }, []);

  function clearGatewayRetry() {
    if (retryTimeoutRef.current) {
      window.clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (retryIntervalRef.current) {
      window.clearInterval(retryIntervalRef.current);
      retryIntervalRef.current = null;
    }
    retryAttemptRef.current = 0;
    setGatewayRetryIn(null);
  }

  function scheduleGatewayRetry(action: () => void) {
    const attempt = Math.min(retryAttemptRef.current + 1, 5);
    retryAttemptRef.current = attempt;
    const delayMs = Math.min(30000, 1000 * Math.pow(2, attempt));
    const endAt = Date.now() + delayMs;
    setGatewayRetryIn(Math.ceil(delayMs / 1000));

    if (retryIntervalRef.current) {
      window.clearInterval(retryIntervalRef.current);
    }
    retryIntervalRef.current = window.setInterval(() => {
      const remainingMs = endAt - Date.now();
      if (remainingMs <= 0) {
        setGatewayRetryIn(null);
        return;
      }
      setGatewayRetryIn(Math.ceil(remainingMs / 1000));
    }, 1000);

    if (retryTimeoutRef.current) {
      window.clearTimeout(retryTimeoutRef.current);
    }
    retryTimeoutRef.current = window.setTimeout(() => {
      if (retryIntervalRef.current) {
        window.clearInterval(retryIntervalRef.current);
        retryIntervalRef.current = null;
      }
      setGatewayRetryIn(null);
      action();
    }, delayMs);
  }

  function normalizeProxyModel(model: string) {
    return model.startsWith("openrouter/") ? model : `openrouter/${model}`;
  }

  function extractGatewayStartError(error: unknown): string {
    if (error instanceof Error) {
      return error.message || "Failed to start gateway";
    }
    if (typeof error === "string") {
      return error;
    }
    const candidate =
      (error && typeof error === "object" && ("message" in error || "error" in error))
        ? (error as Record<string, unknown>)
        : null;
    if (candidate) {
      const message = candidate.message;
      const nestedError = candidate.error;
      if (typeof message === "string" && message.trim()) {
        return message.trim();
      }
      if (typeof nestedError === "string" && nestedError.trim()) {
        return nestedError.trim();
      }
    }
    return "Failed to start gateway";
  }

  async function persistUseLocalKeys(value: boolean) {
    setUseLocalKeys(value);
    try {
      const store = await TauriStore.load("nova-settings.json");
      await store.set("useLocalKeys", value);
      await store.save();
    } catch (error) {
      console.error("[Nova] Failed to save useLocalKeys:", error);
    }
  }

  async function startGatewayProxyFlow({
    model,
    image,
    stopFirst = false,
    allowRetry = true,
  }: {
    model: string;
    image: string;
    stopFirst?: boolean;
    allowRetry?: boolean;
  }): Promise<boolean> {
    console.log("[Nova] startGatewayProxyFlow called with:", {
      model,
      image,
      stopFirst,
      allowRetry,
      isAuthConfigured,
      isAuthenticated,
      useLocalKeys
    });

    if (!isAuthConfigured || !isAuthenticated || useLocalKeys) {
      console.log("[Nova] Skipping proxy flow - auth not ready or using local keys");
      return false;
    }
    if (startGatewayInFlightRef.current) {
      console.log("[Nova] Waiting for in-flight gateway start attempt to finish");
      while (startGatewayInFlightRef.current) {
        await new Promise((r) => setTimeout(r, 120));
      }
      return checkGateway();
    }

    startGatewayInFlightRef.current = true;
    const attemptId = ++startGatewayAttemptRef.current;
    setStartupError(null);
    setShowGatewayStartup(true);
    setGatewayStartupStage("credits");
    gatewayHealthFailureStreakRef.current = 0;
    setGatewayRunning(false);
    try {
      if (stopFirst) {
        try {
          await invoke("stop_gateway");
        } catch (error) {
          console.error("[Nova] Failed to stop gateway:", error);
        }
      }

      try {
        const balance = await getBalance();
        if (balance.balance_cents <= 0) {
          setStartupError({
            message: "You’re out of credits. Add credits to continue using Nova in proxy mode.",
            actions: [{ label: "Add Credits", onClick: () => setCurrentPage("billing") }],
          });
          setShowGatewayStartup(false);
          return false;
        }
      } catch (error) {
        console.warn("[Nova] Balance check failed:", error);
      }

      setGatewayStartupStage("token");
      console.log("[Nova] Creating gateway token...");
      const { token } = await createGatewayToken();
      gatewayTokenRef.current = token;
      console.log("[Nova] Gateway token created successfully");

      const proxyUrl = getProxyUrl();
      const proxyModel = normalizeProxyModel(model);
      const proxyImageModel = normalizeProxyModel(image);
      console.log("[Nova] Proxy configuration:", {
        proxyUrl,
        proxyModel,
        proxyImageModel
      });

      setGatewayStartupStage("launch");
      console.log("[Nova] Invoking start_gateway_with_proxy...");
      await invoke("start_gateway_with_proxy", {
        gatewayToken: token,
        proxyUrl,
        model: proxyModel,
        imageModel: proxyImageModel,
      });
      console.log("[Nova] start_gateway_with_proxy completed");

      setGatewayStartupStage("health");
      if (startGatewayAttemptRef.current !== attemptId) {
        return false;
      }
      // The Rust side may return Ok while the container is still in the
      // "starting" Docker health state (WS not accepting connections yet).
      // Poll until the WS endpoint is actually ready before declaring success.
      {
        const HEALTH_POLL_MS = 2000;
        const HEALTH_TIMEOUT_MS = 90_000;
        const healthStart = Date.now();
        let wsReady = false;
        while (Date.now() - healthStart < HEALTH_TIMEOUT_MS) {
          if (startGatewayAttemptRef.current !== attemptId) {
            return false;
          }
          const ok = await getGatewayStatusCached({ force: true });
          if (ok) {
            wsReady = true;
            break;
          }
          await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
        }
        if (!wsReady) {
          throw new Error(
            "Gateway started but did not become healthy within 90 s. Please try again."
          );
        }
      }
      gatewayHealthFailureStreakRef.current = 0;
      setGatewayRunning(true);
      clearGatewayRetry();
      setStartupError(null);
      setGatewayStartupStage("idle");
      setShowGatewayStartup(false);
      return true;
    } catch (error: any) {
      if (startGatewayAttemptRef.current !== attemptId) {
        return false;
      }
      console.error("[Nova] Proxy start failed:", error);

      const isApiError = error instanceof ApiRequestError;
      const status = isApiError ? error.status : undefined;
      const message = extractGatewayStartError(error);
      const isNetwork =
        (isApiError && error.kind === "network") ||
        (typeof message === "string" &&
          /load failed|failed to fetch|network/i.test(message));

      if (status === 402) {
        setStartupError({
          message: "You’re out of credits. Add credits to continue using Nova in proxy mode.",
          actions: [{ label: "Add Credits", onClick: () => setCurrentPage("billing") }],
        });
        setGatewayStartupStage("idle");
        setShowGatewayStartup(false);
        return false;
      }

      if (status === 401) {
        setStartupError({
          message: "Your session expired. Please sign in again.",
          actions: [{ label: "Open Settings", onClick: () => setCurrentPage("settings") }],
        });
        setGatewayStartupStage("idle");
        setShowGatewayStartup(false);
        return false;
      }

      if (isNetwork) {
        setStartupError({
          message:
            "Can’t reach the Nova backend from the app (network/API error). Check backend availability and local proxy settings.",
          actions: [
            { label: "Retry", onClick: () => startGatewayProxyFlow({ model, image, stopFirst, allowRetry: false }) },
            { label: "Use Local Keys", onClick: () => persistUseLocalKeys(true) },
          ],
        });
        setGatewayStartupStage("idle");
        setShowGatewayStartup(false);
        return false;
      }

      setStartupError({
        message,
      });
      if (allowRetry) {
        scheduleGatewayRetry(() => {
          startGatewayProxyFlow({ model, image, stopFirst, allowRetry });
        });
      } else {
        setGatewayStartupStage("idle");
        setShowGatewayStartup(false);
      }
      return false;
    } finally {
      startGatewayInFlightRef.current = false;
    }
  }

  // Auto-start gateway for authenticated users
  useEffect(() => {
    if (!prefsLoaded) return; // Wait for stored preferences before deciding proxy vs local

    async function autoStartGateway() {
      const proxyEnabled = isAuthConfigured && isAuthenticated && !useLocalKeys;
      console.log("[Nova] Auto-start check:", {
        isAuthConfigured,
        isAuthenticated,
        useLocalKeys,
        proxyEnabled,
        prefsLoaded,
        gatewayRunning,
        isTogglingGateway,
        gatewayRetryIn,
        autoStartAttempted: autoStartAttemptedRef.current
      });

      if (autoStartAttemptedRef.current || gatewayRunning || isTogglingGateway || gatewayRetryIn !== null) {
        return;
      }

      // Check if gateway is already running
      const alreadyRunning = await getGatewayStatusCached({ force: true });
      console.log("[Nova] Auto-start: alreadyRunning =", alreadyRunning, "proxyEnabled =", proxyEnabled, "useLocalKeys =", useLocalKeys);

      if (alreadyRunning) {
        autoStartAttemptedRef.current = true;
        gatewayHealthFailureStreakRef.current = 0;
        clearGatewayRetry();
        setStartupError(null);
        setGatewayStartupStage("idle");
        setShowGatewayStartup(false);

        if (proxyEnabled) {
          // Proxy mode — refresh token/config so stale gateway tokens don't persist across app launches.
          console.log("[Nova] Auto-start: existing container found, refreshing proxy config...");
          setGatewayRunning(true);
          setIsTogglingGateway(true);
          try {
            await startGatewayProxyFlow({
              model: selectedModel,
              image: imageModel,
              stopFirst: false,
              allowRetry: true,
            });
          } catch (error) {
            console.error("[Nova] Proxy refresh for running gateway failed:", error);
          } finally {
            setIsTogglingGateway(false);
          }
        } else if (useLocalKeys) {
          // Local-keys mode but a (likely stale proxy) container is running — stop and restart with correct config.
          console.log("[Nova] Auto-start: existing container found but we're in local-keys mode — restarting with local keys...");
          setShowGatewayStartup(true);
          setGatewayStartupStage("launch");
          setIsTogglingGateway(true);
          try {
            await invoke("stop_gateway");
            console.log("[Nova] Auto-start: stopped stale container, starting with local keys...");
            await invoke("start_gateway", { model: selectedModel });
            setGatewayStartupStage("health");
            await new Promise((r) => setTimeout(r, 2000));
            await checkGateway();
            console.log("[Nova] Auto-start: local-keys restart completed");
          } catch (error) {
            console.error("[Nova] Auto-start: local-keys restart failed:", error);
          } finally {
            setIsTogglingGateway(false);
            setShowGatewayStartup(false);
          }
        } else {
          setGatewayRunning(true);
        }
        return;
      }

      autoStartAttemptedRef.current = true;

      if (proxyEnabled) {
        // Auto-start in proxy mode
        console.log("[Nova] Auto-starting gateway in proxy mode...");
        setIsTogglingGateway(true);
        try {
          const result = await startGatewayProxyFlow({
            model: selectedModel,
            image: imageModel,
            stopFirst: false,
            allowRetry: true,
          });
          console.log("[Nova] Auto-start proxy result:", result);
        } catch (error) {
          console.error("[Nova] Auto-start proxy error:", error);
        } finally {
          setIsTogglingGateway(false);
        }
      } else if (useLocalKeys) {
        // Auto-start in local-keys mode
        console.log("[Nova] Auto-starting gateway in local-keys mode (no existing container)...");
        setShowGatewayStartup(true);
        setGatewayStartupStage("launch");
        setIsTogglingGateway(true);
        try {
          await invoke("start_gateway", { model: selectedModel });
          setGatewayStartupStage("health");
          await new Promise((r) => setTimeout(r, 2000));
          await checkGateway();
          console.log("[Nova] Auto-start (local keys) completed");
        } catch (error) {
          console.error("[Nova] Auto-start (local keys) error:", error);
        } finally {
          setIsTogglingGateway(false);
          setShowGatewayStartup(false);
        }
      }
    }

    autoStartGateway();
  }, [prefsLoaded, isAuthenticated, isAuthConfigured, useLocalKeys, gatewayRunning, isTogglingGateway, selectedModel, gatewayRetryIn, imageModel]);

  async function checkGateway(): Promise<boolean> {
    try {
      const running = await getGatewayStatusCached({ force: true });
      if (running) {
        gatewayHealthFailureStreakRef.current = 0;
        setGatewayRunning(true);
        console.log("[Nova] Gateway health check: healthy");
        setGatewayStartupStage("idle");
        setShowGatewayStartup(false);
        clearGatewayRetry();
        return true;
      }

      gatewayHealthFailureStreakRef.current += 1;
      const failureStreak = gatewayHealthFailureStreakRef.current;
      if (gatewayRunning && failureStreak < GATEWAY_FAILURE_THRESHOLD) {
        console.warn(
          `[Nova] Gateway health transient miss (${failureStreak}/${GATEWAY_FAILURE_THRESHOLD}); keeping running state`
        );
        return true;
      }

      setGatewayRunning(false);
      console.log("[Nova] Gateway health check: not responding");
      return false;
    } catch (error) {
      console.error("[Nova] Gateway check failed:", error);
      gatewayHealthFailureStreakRef.current += 1;
      const failureStreak = gatewayHealthFailureStreakRef.current;
      if (gatewayRunning && failureStreak < GATEWAY_FAILURE_THRESHOLD) {
        console.warn(
          `[Nova] Gateway status check error treated as transient (${failureStreak}/${GATEWAY_FAILURE_THRESHOLD})`
        );
        return true;
      }
      setGatewayRunning(false);
      return false;
    }
  }

  async function toggleGateway() {
    setIsTogglingGateway(true);
    try {
      if (gatewayRunning) {
        console.log("[Nova] Stopping gateway...");
        await invoke("stop_gateway");
        console.log("[Nova] Gateway stopped successfully");
        gatewayHealthFailureStreakRef.current = 0;
        setGatewayRunning(false);
      } else {
        console.log("[Nova] Starting gateway...");
        gatewayHealthFailureStreakRef.current = 0;
        setGatewayRunning(false);
        // If authenticated via OAuth, use proxy mode
        if (isAuthConfigured && isAuthenticated && !useLocalKeys) {
          const started = await startGatewayProxyFlow({
            model: selectedModel,
            image: imageModel,
            stopFirst: false,
            allowRetry: false,
          });
          if (!started) {
            console.error("[Nova] Proxy mode failed; not falling back to local mode.");
            return;
          }
        } else {
          // Not authenticated, use direct API keys
          await invoke("start_gateway", { model: selectedModel });
        }

        console.log("[Nova] Gateway started successfully");
      }
      await new Promise((r) => setTimeout(r, 2000));
      await checkGateway();
    } catch (error) {
      console.error("[Nova] Failed to toggle gateway:", error);
      setStartupError({ message: error instanceof Error ? error.message : "Failed to toggle gateway" });
    } finally {
      setIsTogglingGateway(false);
    }
  }

  async function startGatewayFromChat() {
    if (gatewayRunning || isTogglingGateway) return;
    await toggleGateway();
  }

  async function recoverProxyAuthFromChat(): Promise<boolean> {
    if (!isAuthConfigured || !isAuthenticated || useLocalKeys) {
      return false;
    }
    if (isTogglingGateway) {
      return false;
    }

    setIsTogglingGateway(true);
    try {
      const started = await startGatewayProxyFlow({
        model: selectedModel,
        image: imageModel,
        stopFirst: false,
        allowRetry: false,
      });
      await new Promise((r) => setTimeout(r, 1200));
      await checkGateway();
      return started;
    } catch (error) {
      console.error("[Nova] Proxy auth recovery failed:", error);
      return false;
    } finally {
      setIsTogglingGateway(false);
    }
  }

  // Handle model change - restart gateway with new model
  function handleModelChange(newModel: string) {
    // In local-keys mode, warn if switching providers (container restart interrupts running tasks)
    if (useLocalKeys && gatewayRunning) {
      const oldProvider = selectedModel.split("/")[0];
      const newProvider = newModel.split("/")[0];
      if (oldProvider !== newProvider) {
        setProviderSwitchConfirm({ oldProvider, newProvider, newModel });
        return;
      }
    }
    executeModelChange(newModel);
  }

  // Handle confirmed provider switch (called from confirmation modal)
  async function executeModelChange(newModel: string) {
    setProviderSwitchConfirm(null);
    setSelectedModel(newModel);

    // Save preference
    try {
      const store = await TauriStore.load("nova-settings.json");
      await store.set("selectedModel", newModel);
      await store.save();
    } catch (error) {
      console.error("[Nova] Failed to save model preference:", error);
    }

    if (!gatewayRunning) return;

    if (isAuthConfigured && isAuthenticated && !useLocalKeys && gatewayTokenRef.current) {
      // Proxy mode — restart with new model via proxy flow
      setIsTogglingGateway(true);
      try {
        await startGatewayProxyFlow({
          model: newModel,
          image: imageModel,
          stopFirst: true,
          allowRetry: true,
        });
      } catch (error) {
        console.error("[Nova] Failed to restart gateway with new model:", error);
      } finally {
        setIsTogglingGateway(false);
      }
    } else if (useLocalKeys) {
      const oldProvider = selectedModel.split("/")[0];
      const newProvider = newModel.split("/")[0];
      if (oldProvider !== newProvider) {
        // Provider switch — full container restart needed (different API keys/env vars)
        console.log("[Nova] Provider switch in local-keys mode, restarting gateway with:", newModel);
        setShowGatewayStartup(true);
        setGatewayStartupStage("launch");
        setIsTogglingGateway(true);
        try {
          await invoke("restart_gateway", { model: newModel });
          setGatewayStartupStage("health");
          await new Promise((r) => setTimeout(r, 2000));
          await checkGateway();
        } catch (error) {
          console.error("[Nova] Failed to restart gateway with new model:", error);
        } finally {
          setIsTogglingGateway(false);
          setShowGatewayStartup(false);
        }
      } else {
        // Same provider — hot-swap model in config (no container restart)
        console.log("[Nova] Same-provider model change, hot-swapping to:", newModel);
        try {
          await invoke("update_gateway_model", { model: newModel });
        } catch (error) {
          console.error("[Nova] Failed to hot-swap model:", error);
        }
      }
    }
  }

  function renderPage() {
    switch (currentPage) {
      case "chat":
        {
          const gatewayStarting =
            showGatewayStartup || (isTogglingGateway && !gatewayRunning) || gatewayRetryIn !== null;
        return (
          <Chat
            gatewayRunning={gatewayRunning}
            gatewayStarting={gatewayStarting}
            gatewayRetryIn={gatewayRetryIn}
            onStartGateway={startGatewayFromChat}
            onRecoverProxyAuth={recoverProxyAuthFromChat}
            useLocalKeys={useLocalKeys}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            imageModel={imageModel}
            integrationsSyncing={integrationsSyncing}
            integrationsMissing={integrationsMissing}
            onNavigate={setCurrentPage}
            onSessionsChange={(sessions, currentKey) => {
              setChatSessions(sessions);
              setCurrentChatSession((prev) => currentKey ?? prev);
              setPendingChatSession((pending) => {
                if (!pending) return pending;
                if (pending === "__new__") {
                  return currentKey ? null : pending;
                }
                return pending === currentKey ? null : pending;
              });
              setPendingChatAction(null);
            }}
            requestedSession={pendingChatSession}
            requestedSessionAction={pendingChatAction}
          />
        );
        }
      case "store":
        return (
          <Store
            view="plugins"
            integrationsSyncing={integrationsSyncing}
            integrationsMissing={integrationsMissing}
            onNavigate={(page) => setCurrentPage(page)}
          />
        );
      case "skills":
        return (
          <Store
            view="skills"
            integrationsSyncing={integrationsSyncing}
            integrationsMissing={integrationsMissing}
            onNavigate={(page) => setCurrentPage(page)}
          />
        );
      case "channels":
        return <Channels />;
      case "files":
        return (
          <Files
            gatewayRunning={gatewayRunning}
            integrationsSyncing={integrationsSyncing}
            integrationsMissing={integrationsMissing}
            onGatewayToggle={toggleGateway}
            isTogglingGateway={isTogglingGateway}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            useLocalKeys={useLocalKeys}
            onUseLocalKeysChange={setUseLocalKeys}
            codeModel={codeModel}
            imageModel={imageModel}
            onCodeModelChange={setCodeModel}
            onImageModelChange={setImageModel}
          />
        );
      case "tasks":
        return <Tasks gatewayRunning={gatewayRunning} />;
      case "logs":
        return <Logs />;
      case "billing":
        return <BillingPage />;
      case "settings":
        return (
          <Settings
            gatewayRunning={gatewayRunning}
            onGatewayToggle={toggleGateway}
            isTogglingGateway={isTogglingGateway}
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
            useLocalKeys={useLocalKeys}
            onUseLocalKeysChange={async (value) => {
              setUseLocalKeys(value);

              // Reset model if current selection doesn't exist in the target mode
              const validIds = value ? LOCAL_MODEL_IDS : PROXY_MODEL_IDS;
              const newModel = validIds.has(selectedModel)
                ? selectedModel
                : value ? DEFAULT_LOCAL_MODEL : DEFAULT_PROXY_MODEL;
              if (newModel !== selectedModel) {
                setSelectedModel(newModel);
              }

              try {
                const store = await TauriStore.load("nova-settings.json");
                await store.set("useLocalKeys", value);
                await store.set("selectedModel", newModel);
                await store.save();
              } catch (error) {
                console.error("[Nova] Failed to save useLocalKeys:", error);
              }

              // Stop existing container — the auto-start effect will restart
              // in the correct mode once React commits the state update.
              // We can't call startGatewayProxyFlow directly because it reads
              // useLocalKeys from the closure (still the old value).
              if (gatewayRunning) {
                try {
                  await invoke("stop_gateway");
                } catch (error) {
                  console.error("[Nova] Failed to stop gateway:", error);
                }
                setGatewayRunning(false);
              }
              // Reset auto-start guard so the effect fires again
              autoStartAttemptedRef.current = false;
            }}
            codeModel={codeModel}
            imageModel={imageModel}
            onCodeModelChange={async (value) => {
              setCodeModel(value);
              try {
                const store = await TauriStore.load("nova-settings.json");
                await store.set("codeModel", value);
                await store.save();
              } catch (error) {
                console.error("[Nova] Failed to save codeModel:", error);
              }
            }}
            onImageModelChange={async (value) => {
              setImageModel(value);
              try {
                const store = await TauriStore.load("nova-settings.json");
                await store.set("imageModel", value);
                await store.save();
              } catch (error) {
                console.error("[Nova] Failed to save imageModel:", error);
              }

              if (gatewayRunning && isAuthConfigured && isAuthenticated && !useLocalKeys && gatewayTokenRef.current) {
                try {
                  await startGatewayProxyFlow({
                    model: selectedModel,
                    image: value,
                    stopFirst: true,
                    allowRetry: true,
                  });
                } catch (error) {
                  console.error("[Nova] Failed to restart gateway with new image model:", error);
                }
              }
            }}
          />
        );
    }
  }

  return (
    <Layout
      currentPage={currentPage}
      onNavigate={setCurrentPage}
      gatewayRunning={gatewayRunning}
      integrationsSyncing={integrationsSyncing}
      chatSessions={chatSessions}
      currentChatSession={currentChatSession}
      onSelectChatSession={(key) => {
        setPendingChatSession(key);
        setCurrentChatSession(key);
        setCurrentPage("chat");
      }}
      onNewChat={() => {
        setPendingChatSession("__new__");
        setCurrentPage("chat");
      }}
      onChatSessionAction={(action) => {
        setPendingChatAction({ id: crypto.randomUUID(), ...action });
        setCurrentPage("chat");
      }}
    >
      {providerSwitchConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center">
          <div className="w-full max-w-sm mx-4 rounded-2xl bg-white border border-[var(--border-subtle)] shadow-xl p-6">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Switch provider?</h2>
            <p className="text-xs text-[var(--text-secondary)] mt-2">
              Switching from <strong>{providerSwitchConfirm.oldProvider}</strong> to <strong>{providerSwitchConfirm.newProvider}</strong> will restart the sandbox container. Any running tasks will be interrupted.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-full border border-[var(--border-subtle)] bg-white px-4 py-1.5 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-muted)]"
                onClick={() => setProviderSwitchConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="rounded-full bg-[var(--text-primary)] px-4 py-1.5 text-xs text-white hover:opacity-90"
                onClick={() => executeModelChange(providerSwitchConfirm.newModel)}
              >
                Switch Provider
              </button>
            </div>
          </div>
        </div>
      )}
      {showGatewayStartup && (
        <div className="absolute inset-0 z-50 flex items-center justify-center">
          <div className="w-full max-w-sm mx-4 rounded-2xl bg-white border border-[var(--border-subtle)] shadow-xl p-6">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-[var(--system-gray-6)] p-2">
                <Loader2 className="w-4 h-4 animate-spin text-[var(--text-primary)]" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  {gatewayRetryIn ? "Reconnecting secure sandbox" : "Starting secure sandbox"}
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  {gatewayRetryIn
                    ? `Retrying in ${gatewayRetryIn}s. We’ll keep trying until the sandbox is ready.`
                    : "Nova is preparing the secure sandbox so tools and plugins are available."}
                </p>
                <div className="mt-3 text-xs text-[var(--text-tertiary)]">
                  This can take a few seconds the first time.
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-xs text-[var(--text-secondary)]">
              <div className="flex items-center gap-2">
                {gatewayStartupStage === "credits" || gatewayStartupStage === "token" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-tertiary)]" />
                ) : gatewayStartupStage === "launch" || gatewayStartupStage === "health" ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border border-[var(--border-subtle)]" />
                )}
                <span>Creating gateway token</span>
              </div>
              <div className="flex items-center gap-2">
                {gatewayStartupStage === "launch" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-tertiary)]" />
                ) : gatewayStartupStage === "health" ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border border-[var(--border-subtle)]" />
                )}
                <span>Launching gateway container</span>
              </div>
              <div className="flex items-center gap-2">
                {gatewayStartupStage === "health" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-tertiary)]" />
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border border-[var(--border-subtle)]" />
                )}
                <span>Waiting for health check</span>
              </div>
            </div>
            {startupError && (
              <div className="mt-3 text-xs text-red-600">
                {startupError.message}
                {startupError.actions && startupError.actions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {startupError.actions.map((action) => (
                      <button
                        key={action.label}
                        className="rounded-full border border-[var(--border-subtle)] bg-white px-3 py-1 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-muted)]"
                        onClick={action.onClick}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {!showGatewayStartup && startupError && (
        <div className="absolute right-4 top-4 z-40 w-[min(28rem,calc(100%-2rem))] rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 shadow-lg">
          <div className="font-medium">Gateway Start Failed</div>
          <div className="mt-1 text-xs">{startupError.message}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {startupError.actions && startupError.actions.length > 0 && startupError.actions.map((action) => (
              <button
                key={action.label}
                className="rounded-full border border-red-200 bg-white px-3 py-1 text-xs text-red-700 hover:bg-red-100"
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ))}
            <button
              className="rounded-full border border-red-200 bg-white px-3 py-1 text-xs text-red-700 hover:bg-red-100"
              onClick={() => setStartupError(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {renderPage()}
    </Layout>
  );
}
