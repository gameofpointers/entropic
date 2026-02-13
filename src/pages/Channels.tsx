import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  MessageCircle,
  MessageSquare,
  QrCode,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

function ChannelGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-10">
      <h2 className="text-xl font-bold text-[var(--text-primary)] mb-4">{title}</h2>
      <div className="bg-white rounded-2xl shadow-sm border border-[var(--border-subtle)] p-6 space-y-6">
        {children}
      </div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--system-blue)]" />
    </label>
  );
}

function SetupStateBadge({ enabled, ready }: { enabled: boolean; ready: boolean }) {
  if (!enabled) {
    return (
      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-[var(--system-gray-6)] text-[var(--text-tertiary)]">
        Off
      </span>
    );
  }
  if (ready) {
    return (
      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-green-50 text-green-700">
        Ready
      </span>
    );
  }
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-amber-50 text-amber-700">
      Needs Setup
    </span>
  );
}

const DiscordIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const TelegramIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.66.15-.17 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.18-.08-.04-.19-.03-.27-.01-.11.02-1.82 1.15-5.14 2.3-.49.17-.93.25-1.33.24-.44-.01-1.29-.25-1.92-.45-.77-.25-1.38-.39-1.33-.82.03-.23.34-.46.94-.7 3.68-1.6 6.13-2.66 7.35-3.17 3.5-.14 4.22.11 4.23.11.01.01.03.01.03.02z" />
  </svg>
);

const SlackIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" />
    <path fill="#36C5F0" d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" />
    <path fill="#2EB67D" d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" />
    <path fill="#ECB22E" d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z" />
  </svg>
);

const GoogleChatIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path fill="#34A853" d="M4 4h9a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4H9l-4 4V8a4 4 0 0 1 4-4z" />
    <path fill="#FBBC05" d="M20 7h-4v7a6 6 0 0 1-6 6h5l5 4V11a4 4 0 0 0-4-4z" />
    <circle cx="10" cy="10" r="1.2" fill="#fff" />
    <circle cx="13.5" cy="10" r="1.2" fill="#fff" />
  </svg>
);

const DISCORD_INVITE_PERMISSIONS = "117760";

function decodeDiscordApplicationIdFromToken(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(".");
  if (parts.length < 2) return null;
  const raw = parts[0].replace(/-/g, "+").replace(/_/g, "/");
  const padded = raw.padEnd(Math.ceil(raw.length / 4) * 4, "=");
  try {
    const decoded = atob(padded);
    if (!/^\d{17,20}$/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

function discordInviteUrl(applicationId: string): string {
  const params = new URLSearchParams({
    client_id: applicationId,
    permissions: DISCORD_INVITE_PERMISSIONS,
    scope: "bot applications.commands",
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export function Channels() {
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [discordToken, setDiscordToken] = useState("");
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramPairingCode, setTelegramPairingCode] = useState("");
  const [telegramPairingStatus, setTelegramPairingStatus] = useState<string | null>(null);
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackBotToken, setSlackBotToken] = useState("");
  const [slackAppToken, setSlackAppToken] = useState("");
  const [googlechatEnabled, setGooglechatEnabled] = useState(false);
  const [googlechatServiceAccount, setGooglechatServiceAccount] = useState("");
  const [googlechatAudienceType, setGooglechatAudienceType] = useState<"app-url" | "project-number">("app-url");
  const [googlechatAudience, setGooglechatAudience] = useState("");

  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [whatsappAllowFrom, setWhatsappAllowFrom] = useState("");
  const [whatsappQr, setWhatsappQr] = useState<string | null>(null);
  const [whatsappMessage, setWhatsappMessage] = useState<string | null>(null);
  const [whatsappLoading, setWhatsappLoading] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<string | null>(null);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const pollRef = useRef<number | null>(null);

  const [imessageEnabled, setImessageEnabled] = useState(false);
  const [imessageCliPath, setImessageCliPath] = useState("/usr/local/bin/imsg");
  const [imessageDbPath, setImessageDbPath] = useState("");
  const [imessageRemoteHost, setImessageRemoteHost] = useState("");
  const [imessageIncludeAttachments, setImessageIncludeAttachments] = useState(true);

  const [savingSetup, setSavingSetup] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const discordApplicationId = decodeDiscordApplicationIdFromToken(discordToken);

  useEffect(() => {
    invoke<{
      discord_enabled: boolean;
      discord_token: string;
      telegram_enabled: boolean;
      telegram_token: string;
      slack_enabled: boolean;
      slack_bot_token: string;
      slack_app_token: string;
      googlechat_enabled: boolean;
      googlechat_service_account: string;
      googlechat_audience_type: "app-url" | "project-number";
      googlechat_audience: string;
      whatsapp_enabled: boolean;
      whatsapp_allow_from: string;
      imessage_enabled: boolean;
      imessage_cli_path: string;
      imessage_db_path: string;
      imessage_remote_host: string;
      imessage_include_attachments: boolean;
    }>("get_agent_profile_state")
      .then((state) => {
        setDiscordEnabled(state.discord_enabled ?? false);
        setDiscordToken(state.discord_token || "");
        setTelegramEnabled(state.telegram_enabled ?? false);
        setTelegramToken(state.telegram_token || "");
        setSlackEnabled(state.slack_enabled ?? false);
        setSlackBotToken(state.slack_bot_token || "");
        setSlackAppToken(state.slack_app_token || "");
        setGooglechatEnabled(state.googlechat_enabled ?? false);
        setGooglechatServiceAccount(state.googlechat_service_account || "");
        setGooglechatAudienceType(
          state.googlechat_audience_type === "project-number" ? "project-number" : "app-url"
        );
        setGooglechatAudience(state.googlechat_audience || "");
        setWhatsappEnabled(state.whatsapp_enabled ?? false);
        setWhatsappAllowFrom(state.whatsapp_allow_from || "");
        setImessageEnabled(state.imessage_enabled ?? false);
        setImessageCliPath(state.imessage_cli_path || "/usr/local/bin/imsg");
        setImessageDbPath(state.imessage_db_path || "");
        setImessageRemoteHost(state.imessage_remote_host || "");
        setImessageIncludeAttachments(state.imessage_include_attachments ?? true);
      })
      .catch(() => {});
  }, []);

  async function saveMessagingSetup() {
    setSavingSetup(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      await invoke("set_channels_config", {
        discordEnabled,
        discordToken,
        telegramEnabled,
        telegramToken,
        slackEnabled,
        slackBotToken,
        slackAppToken,
        googlechatEnabled,
        googlechatServiceAccount,
        googlechatAudienceType,
        googlechatAudience,
        whatsappEnabled,
        whatsappAllowFrom,
      });
      await invoke("set_imessage_config", {
        enabled: imessageEnabled,
        cliPath: imessageCliPath,
        dbPath: imessageDbPath,
        remoteHost: imessageRemoteHost,
        includeAttachments: imessageIncludeAttachments,
      });
      setSaveMessage("Messaging setup saved.");
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setSaveError(`Failed to save messaging setup: ${detail}`);
    } finally {
      setSavingSetup(false);
    }
  }

  async function approveTelegramPairing() {
    setTelegramPairingStatus(null);
    try {
      const result = await invoke<string>("approve_pairing", {
        channel: "telegram",
        code: telegramPairingCode,
      });
      setTelegramPairingStatus(result || "Pairing approved.");
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setTelegramPairingStatus(`Failed to approve pairing: ${detail}`);
    }
  }

  async function fetchWhatsAppLogin() {
    try {
      const result = await invoke<{
        status: string;
        message: string;
        qr_data_url?: string | null;
        connected?: boolean | null;
        last_error?: string | null;
        error_status?: number | null;
      }>("get_whatsapp_login");
      setWhatsappMessage(result.message || null);
      setWhatsappQr(result.qr_data_url ?? null);
      setWhatsappConnected(Boolean(result.connected));
      if (result.connected) {
        setWhatsappStatus("Connected");
      }
      if (result.error_status === 515) {
        setWhatsappStatus("WhatsApp connection restarting (normal after scan)...");
      }
      setWhatsappError(result.last_error ?? null);
      return result;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (detail.toLowerCase().includes("connection refused")) {
        setWhatsappStatus("Gateway restarting... retrying");
      } else {
        setWhatsappError(detail);
      }
      return null;
    }
  }

  function startWhatsAppPolling() {
    if (pollRef.current) return;
    pollRef.current = window.setInterval(async () => {
      const result = await fetchWhatsAppLogin();
      if (result?.qr_data_url || result?.connected) {
        setWhatsappLoading(false);
      }
    }, 2000);
  }

  function stopWhatsAppPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function showWhatsAppQr(force = false) {
    setWhatsappLoading(true);
    setWhatsappStatus(null);
    setWhatsappError(null);
    try {
      await invoke("start_whatsapp_login", { force, timeout_ms: 8000 });
      await fetchWhatsAppLogin();
      startWhatsAppPolling();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setWhatsappMessage(`Could not generate QR. ${detail}`);
      setWhatsappQr(null);
      setWhatsappError(detail);
    } finally {
      if (!whatsappQr) setWhatsappLoading(false);
    }
  }

  useEffect(() => {
    startWhatsAppPolling();
    return () => stopWhatsAppPolling();
  }, []);

  const discordReady = discordEnabled && discordToken.trim().length > 0;
  const telegramReady = telegramEnabled && telegramToken.trim().length > 0;
  const slackReady = slackEnabled && slackBotToken.trim().length > 0 && slackAppToken.trim().length > 0;
  const googlechatReady =
    googlechatEnabled &&
    googlechatServiceAccount.trim().length > 0 &&
    googlechatAudience.trim().length > 0;
  const whatsappReady = whatsappEnabled && whatsappConnected;
  const imessageReady =
    imessageEnabled &&
    imessageCliPath.trim().length > 0 &&
    (imessageDbPath.trim().length > 0 || imessageRemoteHost.trim().length > 0);

  const setupStates = [
    { id: "discord", name: "Discord", enabled: discordEnabled, ready: discordReady },
    { id: "telegram", name: "Telegram", enabled: telegramEnabled, ready: telegramReady },
    { id: "slack", name: "Slack", enabled: slackEnabled, ready: slackReady },
    { id: "googlechat", name: "Google Chat", enabled: googlechatEnabled, ready: googlechatReady },
    { id: "whatsapp", name: "WhatsApp", enabled: whatsappEnabled, ready: whatsappReady },
    { id: "imessage", name: "iMessage", enabled: imessageEnabled, ready: imessageReady },
  ];
  const readyCount = setupStates.filter((entry) => entry.ready).length;

  return (
    <div className="max-w-6xl mx-auto px-6 pb-12">
      <div className="pt-8 mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2 tracking-tight">Messaging Setup</h1>
        <p className="text-lg text-[var(--text-secondary)]">Choose how people can talk to your assistant.</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-[var(--border-subtle)] p-6 mb-6 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-[var(--system-gray-6)] flex items-center justify-center text-[var(--system-blue)]">
          <MessageCircle className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-[var(--text-primary)]">Single setup for channels + plugins</p>
          <p className="text-sm text-[var(--text-secondary)]">
            Enable Discord, Telegram, Slack, Google Chat, WhatsApp, and iMessage here. Nova manages the underlying plugin wiring automatically.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-[var(--text-tertiary)]">Ready</p>
          <p className="text-xl font-bold text-[var(--text-primary)]">{readyCount}/6</p>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 md:grid-cols-3 gap-3">
        {setupStates.map((entry) => (
          <div key={entry.id} className="bg-white rounded-xl border border-[var(--border-subtle)] px-3 py-2 flex items-center justify-between">
            <p className="text-sm font-medium text-[var(--text-primary)]">{entry.name}</p>
            <SetupStateBadge enabled={entry.enabled} ready={entry.ready} />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4">
        <ChannelGroup title="WhatsApp">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-green-500 rounded-xl flex items-center justify-center text-white flex-shrink-0">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">WhatsApp Messenger</h3>
                  <p className="text-sm text-[var(--text-secondary)]">Enable, save setup, then connect with QR.</p>
                </div>
                <div className="flex items-center gap-3">
                  <SetupStateBadge enabled={whatsappEnabled} ready={whatsappReady} />
                  <ToggleSwitch checked={whatsappEnabled} onChange={setWhatsappEnabled} />
                </div>
              </div>

              <div className="space-y-4">
                <input
                  type="text"
                  value={whatsappAllowFrom}
                  onChange={(e) => setWhatsappAllowFrom(e.target.value)}
                  placeholder="Your phone number (E.164, optional)"
                  className="w-full px-4 py-2 bg-[var(--system-gray-6)] border-transparent rounded-lg focus:ring-2 focus:ring-[var(--system-blue)]/20 outline-none text-sm"
                />

                <div className="flex gap-2">
                  <button
                    onClick={() => showWhatsAppQr(false)}
                    disabled={whatsappLoading}
                    className="btn btn-primary bg-black text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-800 disabled:opacity-50"
                  >
                    {whatsappLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4 mr-2" />}
                    Show QR Code
                  </button>
                  <button
                    onClick={() => showWhatsAppQr(true)}
                    className="btn btn-secondary px-4 py-2 border border-[var(--border-subtle)] rounded-lg text-sm font-semibold hover:bg-[var(--system-gray-6)]"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Refresh
                  </button>
                </div>

                {whatsappStatus && (
                  <p className="text-sm font-medium text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> {whatsappStatus}
                  </p>
                )}
                {whatsappMessage && <p className="text-xs text-[var(--text-tertiary)]">{whatsappMessage}</p>}
                {whatsappError && <p className="text-sm text-red-500">{whatsappError}</p>}

                {whatsappQr && (
                  <div className="mt-4 p-4 bg-white border border-[var(--border-subtle)] rounded-xl inline-block shadow-inner">
                    <img src={whatsappQr} alt="WhatsApp QR" className="w-48 h-48" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </ChannelGroup>

        <ChannelGroup title="Discord">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-[#5865F2] rounded-xl flex items-center justify-center text-white flex-shrink-0">
              <DiscordIcon className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">Discord Bot</h3>
                  <p className="text-sm text-[var(--text-secondary)]">Paste bot token, invite via OAuth, then save setup.</p>
                </div>
                <div className="flex items-center gap-3">
                  <SetupStateBadge enabled={discordEnabled} ready={discordReady} />
                  <ToggleSwitch checked={discordEnabled} onChange={setDiscordEnabled} />
                </div>
              </div>

              <input
                type="password"
                value={discordToken}
                onChange={(e) => setDiscordToken(e.target.value)}
                placeholder="Discord bot token"
                className="w-full px-4 py-2 bg-[var(--system-gray-6)] border-transparent rounded-lg focus:ring-2 focus:ring-[var(--system-blue)]/20 outline-none text-sm"
              />

              <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--system-gray-6)]/60 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] mb-1">Setup Checklist</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Required: bot token, Message Content intent, and an OAuth invite to your server.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => window.open("https://discord.com/developers/applications", "_blank", "noopener,noreferrer")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--system-gray-6)]"
                  >
                    Open Developer Portal
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      if (!discordApplicationId) return;
                      window.open(discordInviteUrl(discordApplicationId), "_blank", "noopener,noreferrer");
                    }}
                    disabled={!discordApplicationId}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    Invite Bot with OAuth
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
                {discordApplicationId ? (
                  <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">Detected application ID from token: {discordApplicationId}</p>
                ) : (
                  <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">Paste a valid bot token to enable one-click OAuth invite.</p>
                )}
              </div>
            </div>
          </div>
        </ChannelGroup>

        <ChannelGroup title="Telegram">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-[#0088cc] rounded-xl flex items-center justify-center text-white flex-shrink-0">
              <TelegramIcon className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">Telegram Bot</h3>
                  <p className="text-sm text-[var(--text-secondary)]">Paste token from @BotFather and approve pairing when prompted.</p>
                </div>
                <div className="flex items-center gap-3">
                  <SetupStateBadge enabled={telegramEnabled} ready={telegramReady} />
                  <ToggleSwitch checked={telegramEnabled} onChange={setTelegramEnabled} />
                </div>
              </div>

              <div className="space-y-3">
                <input
                  type="password"
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  placeholder="Bot token"
                  className="w-full px-4 py-2 bg-[var(--system-gray-6)] border-transparent rounded-lg focus:ring-2 focus:ring-[var(--system-blue)]/20 outline-none text-sm"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={telegramPairingCode}
                    onChange={(e) => setTelegramPairingCode(e.target.value)}
                    placeholder="Pairing code"
                    className="flex-1 px-4 py-2 bg-[var(--system-gray-6)] border-transparent rounded-lg focus:ring-2 focus:ring-[var(--system-blue)]/20 outline-none text-sm"
                  />
                  <button
                    onClick={approveTelegramPairing}
                    disabled={telegramPairingCode.trim().length === 0}
                    className="px-4 py-2 bg-black text-white rounded-lg text-sm font-semibold hover:bg-gray-800 disabled:opacity-50"
                  >
                    Approve
                  </button>
                </div>
                {telegramPairingStatus && <p className="text-xs text-[var(--text-tertiary)]">{telegramPairingStatus}</p>}
              </div>
            </div>
          </div>
        </ChannelGroup>

        <ChannelGroup title="Slack">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-[#4A154B] rounded-xl flex items-center justify-center text-white flex-shrink-0">
              <SlackIcon className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">Slack App</h3>
                  <p className="text-sm text-[var(--text-secondary)]">Paste bot token + app token, then save setup.</p>
                </div>
                <div className="flex items-center gap-3">
                  <SetupStateBadge enabled={slackEnabled} ready={slackReady} />
                  <ToggleSwitch checked={slackEnabled} onChange={setSlackEnabled} />
                </div>
              </div>

              <div className="space-y-3">
                <input
                  type="password"
                  value={slackBotToken}
                  onChange={(e) => setSlackBotToken(e.target.value)}
                  placeholder="Slack Bot Token (xoxb-...)"
                  className="w-full px-4 py-2 bg-[var(--system-gray-6)] border-transparent rounded-lg text-sm outline-none"
                />
                <input
                  type="password"
                  value={slackAppToken}
                  onChange={(e) => setSlackAppToken(e.target.value)}
                  placeholder="Slack App Token (xapp-...)"
                  className="w-full px-4 py-2 bg-[var(--system-gray-6)] border-transparent rounded-lg text-sm outline-none"
                />
              </div>
              <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--system-gray-6)]/60 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] mb-1">Setup Checklist</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Create a Slack app, install it to your workspace, then copy bot and app tokens.
                </p>
                <button
                  onClick={() => window.open("https://api.slack.com/apps", "_blank", "noopener,noreferrer")}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--system-gray-6)]"
                >
                  Open Slack App Setup
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </ChannelGroup>

        <ChannelGroup title="Google Chat">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-[#0F9D58] rounded-xl flex items-center justify-center text-white flex-shrink-0">
              <GoogleChatIcon className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">Google Chat App</h3>
                  <p className="text-sm text-[var(--text-secondary)]">Paste service account JSON and webhook audience, then save setup.</p>
                </div>
                <div className="flex items-center gap-3">
                  <SetupStateBadge enabled={googlechatEnabled} ready={googlechatReady} />
                  <ToggleSwitch checked={googlechatEnabled} onChange={setGooglechatEnabled} />
                </div>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <select
                    value={googlechatAudienceType}
                    onChange={(e) => setGooglechatAudienceType(e.target.value === "project-number" ? "project-number" : "app-url")}
                    className="w-full px-4 py-2 bg-[var(--system-gray-6)] border-transparent rounded-lg text-sm outline-none"
                  >
                    <option value="app-url">Audience Type: App URL</option>
                    <option value="project-number">Audience Type: Project Number</option>
                  </select>
                  <input
                    type="text"
                    value={googlechatAudience}
                    onChange={(e) => setGooglechatAudience(e.target.value)}
                    placeholder={googlechatAudienceType === "project-number" ? "Project number" : "https://your.host/googlechat"}
                    className="w-full px-4 py-2 bg-[var(--system-gray-6)] border-transparent rounded-lg text-sm outline-none"
                  />
                </div>
                <textarea
                  value={googlechatServiceAccount}
                  onChange={(e) => setGooglechatServiceAccount(e.target.value)}
                  placeholder='Service account JSON (single line or full JSON object)'
                  className="w-full min-h-[120px] px-4 py-2 bg-[var(--system-gray-6)] border-transparent rounded-lg text-sm outline-none font-mono"
                />
              </div>
              <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--system-gray-6)]/60 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] mb-1">Setup Checklist</p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Google Chat uses service account + webhook verification, not user OAuth.
                </p>
                <button
                  onClick={() => window.open("https://console.cloud.google.com/apis/api/chat.googleapis.com/credentials", "_blank", "noopener,noreferrer")}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--system-gray-6)]"
                >
                  Open Google Chat Credentials
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </ChannelGroup>

        <ChannelGroup title="Apple iMessage">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white flex-shrink-0">
              <Smartphone className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">iMessage (macOS)</h3>
                  <p className="text-sm text-[var(--text-secondary)]">Configure local or remote imsg bridge settings.</p>
                </div>
                <div className="flex items-center gap-3">
                  <SetupStateBadge enabled={imessageEnabled} ready={imessageReady} />
                  <ToggleSwitch checked={imessageEnabled} onChange={setImessageEnabled} />
                </div>
              </div>

              <div className="space-y-3">
                <input
                  type="text"
                  value={imessageCliPath}
                  onChange={(e) => setImessageCliPath(e.target.value)}
                  placeholder="CLI Path"
                  className="w-full px-4 py-2 bg-[var(--system-gray-6)] border-transparent rounded-lg text-sm outline-none"
                />
                <input
                  type="text"
                  value={imessageDbPath}
                  onChange={(e) => setImessageDbPath(e.target.value)}
                  placeholder="Database Path"
                  className="w-full px-4 py-2 bg-[var(--system-gray-6)] border-transparent rounded-lg text-sm outline-none"
                />
                <input
                  type="text"
                  value={imessageRemoteHost}
                  onChange={(e) => setImessageRemoteHost(e.target.value)}
                  placeholder="Remote host (optional)"
                  className="w-full px-4 py-2 bg-[var(--system-gray-6)] border-transparent rounded-lg text-sm outline-none"
                />
                <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    checked={imessageIncludeAttachments}
                    onChange={(e) => setImessageIncludeAttachments(e.target.checked)}
                  />
                  Include attachments
                </label>
              </div>
            </div>
          </div>
        </ChannelGroup>

        <div className="flex items-end justify-between gap-3 pt-4">
          <div>
            {saveError && <p className="text-sm text-red-600">{saveError}</p>}
            {saveMessage && (
              <p className="text-sm text-green-700 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" />
                {saveMessage}
              </p>
            )}
          </div>
          <button
            onClick={saveMessagingSetup}
            disabled={savingSetup}
            className="px-6 py-2.5 bg-black text-white rounded-xl font-bold text-sm hover:bg-gray-800 shadow-lg transition-all disabled:opacity-60"
          >
            {savingSetup ? "Saving..." : "Save Messaging Setup"}
          </button>
        </div>
      </div>
    </div>
  );
}
