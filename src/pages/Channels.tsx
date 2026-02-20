import { useEffect, useState, type ReactNode } from "react";
import {
  CheckCircle2,
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

const TelegramIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.66.15-.17 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.18-.08-.04-.19-.03-.27-.01-.11.02-1.82 1.15-5.14 2.3-.49.17-.93.25-1.33.24-.44-.01-1.29-.25-1.92-.45-.77-.25-1.38-.39-1.33-.82.03-.23.34-.46.94-.7 3.68-1.6 6.13-2.66 7.35-3.17 3.5-.14 4.22.11 4.23.11.01.01.03.01.03.02z" />
  </svg>
);
export function Channels() {
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramPairingCode, setTelegramPairingCode] = useState("");
  const [telegramPairingStatus, setTelegramPairingStatus] = useState<string | null>(null);

  const [savingSetup, setSavingSetup] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    invoke<{
      telegram_enabled: boolean;
      telegram_token: string;
    }>("get_agent_profile_state")
      .then((state) => {
        setTelegramEnabled(state.telegram_enabled ?? false);
        setTelegramToken(state.telegram_token || "");

        // Auto-configure runtime if Telegram is enabled with a token
        if (state.telegram_enabled && state.telegram_token?.trim()) {
          console.log("[Channels] Auto-configuring Telegram on startup");
          autoConfigureTelegram(state.telegram_enabled, state.telegram_token);
        }
      })
      .catch(() => {});
  }, []);

  async function autoConfigureTelegram(enabled: boolean, token: string) {
    try {
      console.log("[Channels] Auto-configuring Telegram...");
      await invoke("set_channels_config", {
        discordEnabled: false,
        discordToken: "",
        telegramEnabled: enabled,
        telegramToken: token,
        slackEnabled: false,
        slackBotToken: "",
        slackAppToken: "",
        googlechatEnabled: false,
        googlechatServiceAccount: "",
        googlechatAudienceType: "app-url",
        googlechatAudience: "",
        whatsappEnabled: false,
        whatsappAllowFrom: "",
      });
      console.log("[Channels] Auto-configuration succeeded");
    } catch (err) {
      console.error("[Channels] Auto-configuration failed:", err);
    }
  }

  async function saveMessagingSetup() {
    console.log("[Channels] saveMessagingSetup called");
    console.log("[Channels] telegramEnabled:", telegramEnabled);
    console.log("[Channels] telegramToken length:", telegramToken.length);

    setSavingSetup(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      console.log("[Channels] Invoking set_channels_config...");
      await invoke("set_channels_config", {
        discordEnabled: false,
        discordToken: "",
        telegramEnabled,
        telegramToken,
        slackEnabled: false,
        slackBotToken: "",
        slackAppToken: "",
        googlechatEnabled: false,
        googlechatServiceAccount: "",
        googlechatAudienceType: "app-url",
        googlechatAudience: "",
        whatsappEnabled: false,
        whatsappAllowFrom: "",
      });
      console.log("[Channels] set_channels_config succeeded");
      setSaveMessage("Telegram setup saved.");
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[Channels] set_channels_config failed:", detail);
      setSaveError(`Failed to save Telegram setup: ${detail}`);
    } finally {
      setSavingSetup(false);
      console.log("[Channels] saveMessagingSetup completed");
    }
  }

  async function approveTelegramPairing() {
    console.log("[Channels] approveTelegramPairing called");
    console.log("[Channels] pairing code:", telegramPairingCode);

    setTelegramPairingStatus(null);
    try {
      console.log("[Channels] Invoking approve_pairing...");
      const result = await invoke<string>("approve_pairing", {
        channel: "telegram",
        code: telegramPairingCode,
      });
      console.log("[Channels] approve_pairing succeeded:", result);
      setTelegramPairingStatus(result || "Pairing approved.");
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[Channels] approve_pairing failed:", detail);
      setTelegramPairingStatus(`Failed to approve pairing: ${detail}`);
    }
  }

  const telegramReady = telegramEnabled && telegramToken.trim().length > 0;

  return (
    <div className="max-w-6xl mx-auto px-6 pb-12">
      <div className="pt-8 mb-8">
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2 tracking-tight">Telegram Setup</h1>
        <p className="text-lg text-[var(--text-secondary)]">Configure your Telegram bot to enable messaging.</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <ChannelGroup title="Telegram Bot">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-[#0088cc] rounded-xl flex items-center justify-center text-white flex-shrink-0">
              <TelegramIcon className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">Telegram Bot</h3>
                  <p className="text-sm text-[var(--text-secondary)]">Connect your Telegram bot to enable messaging with Joulie.</p>
                </div>
                <div className="flex items-center gap-3">
                  <SetupStateBadge enabled={telegramEnabled} ready={telegramReady} />
                  <ToggleSwitch checked={telegramEnabled} onChange={setTelegramEnabled} />
                </div>
              </div>

              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="text-sm font-semibold text-blue-900 mb-2">Setup Instructions:</h4>
                <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                  <li>Open Telegram and message <span className="font-mono bg-blue-100 px-1 rounded">@BotFather</span></li>
                  <li>Send <span className="font-mono bg-blue-100 px-1 rounded">/newbot</span> and follow prompts to create your bot</li>
                  <li>Copy the bot token and paste it below</li>
                  <li>Enable the toggle above and click "Save Telegram Setup"</li>
                  <li>Message your bot and send <span className="font-mono bg-blue-100 px-1 rounded">/start</span></li>
                  <li>Your bot will respond with a pairing code - paste it below and click "Approve"</li>
                </ol>
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
            {savingSetup ? "Saving..." : "Save Telegram Setup"}
          </button>
        </div>
      </div>
    </div>
  );
}
