import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  CalendarClock,
  Plus,
  RefreshCw,
  Play,
  Pencil,
  Clock,
  Trash2,
  X,
  Smartphone,
  Info,
  ChevronRight,
  Bell,
  CheckCircle2,
  AlertCircle,
  MoreHorizontal,
  History,
  Loader2,
  Sparkles,
} from "lucide-react";
import clsx from "clsx";
import { invoke } from "@tauri-apps/api/core";
import {
  GatewayClient,
  createGatewayClient,
  type ChatEvent,
  type CronJob,
  type CronSchedule,
  type CronPayload,
  type CronRunLogEntry,
} from "../lib/gateway";
import { resolveGatewayAuth } from "../lib/gateway-auth";
import { getIntegrations, getIntegrationsCached, type Integration } from "../lib/integrations";

type Props = {
  gatewayRunning: boolean;
};

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:19789";

function describeSchedule(schedule: CronSchedule): string {
  switch (schedule.kind) {
    case "at":
      return `Once at ${new Date(schedule.atMs).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
    case "every": {
      const ms = schedule.everyMs;
      if (ms < 60_000) return `Every ${Math.round(ms / 1000)}s`;
      if (ms < 3_600_000) return `Every ${Math.round(ms / 60_000)} minutes`;
      if (ms < 86_400_000) return `Every ${Math.round(ms / 3_600_000)} hours`;
      return `Every ${Math.round(ms / 86_400_000)} days`;
    }
    case "cron":
      return `Cron: ${schedule.expr}`;
    default:
      return "Unknown schedule";
  }
}

function statusBadge(job: CronJob) {
  if (!job.enabled) return { label: "Disabled", className: "bg-gray-100 text-gray-500 border-gray-200" };
  if (job.state === "running") return { label: "Running", className: "bg-amber-50 text-amber-600 border-amber-100" };
  if (job.state === "error") return { label: "Error", className: "bg-red-50 text-red-600 border-red-100" };
  return { label: "Active", className: "bg-green-50 text-green-600 border-green-100" };
}

function formatRunTime(run: CronRunLogEntry): string {
  const ts = run.startedAt ?? run.runAtMs ?? run.ts;
  if (!Number.isFinite(ts)) return "Unknown time";
  return new Date(ts as number).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function formatRunDuration(run: CronRunLogEntry): string | null {
  if (Number.isFinite(run.durationMs)) {
    return `${((run.durationMs as number) / 1000).toFixed(1)}s`;
  }
  if (Number.isFinite(run.startedAt) && Number.isFinite(run.finishedAt)) {
    const delta = (run.finishedAt as number) - (run.startedAt as number);
    if (Number.isFinite(delta)) return `${(delta / 1000).toFixed(1)}s`;
  }
  return null;
}

const CRON_GUARD_LINES = [
  "This is a scheduled run. Do NOT create, edit, or run cron jobs.",
  "Do NOT use gateway or exec tools. Just perform the task now and report results.",
];
const CRON_GUARD_BLOCK = `${CRON_GUARD_LINES.join("\n")}\n\n`;

function stripCronGuards(message: string): string {
  const trimmed = message ?? "";
  if (trimmed.startsWith(CRON_GUARD_BLOCK)) {
    return trimmed.slice(CRON_GUARD_BLOCK.length);
  }
  const guardLineBlock = CRON_GUARD_LINES.join("\n");
  if (trimmed.startsWith(guardLineBlock)) {
    const remainder = trimmed.slice(guardLineBlock.length);
    return remainder.replace(/^\n\n?/, "");
  }
  return trimmed;
}

type ScheduleType = "every" | "at" | "cron";
type SchedulePreset = "every_hour" | "daily" | "weekdays" | "weekends" | "mwf" | "once" | "custom";

type EditorState = {
  name: string;
  description: string;
  scheduleType: ScheduleType;
  schedulePreset: SchedulePreset;
  scheduleTime: string;
  intervalMinutes: string;
  atDate: string;
  cronExpr: string;
  message: string;
  sessionTarget: "main" | "isolated";
  enabled: boolean;
  skillIds: string[];
  notifyEnabled: boolean;
  notifyChannel: string;
  notifyTo: string;
};

const defaultEditor: EditorState = {
  name: "",
  description: "",
  scheduleType: "every",
  schedulePreset: "custom",
  scheduleTime: "09:00",
  intervalMinutes: "5",
  atDate: "",
  cronExpr: "",
  message: "",
  sessionTarget: "isolated",
  enabled: true,
  skillIds: [],
  notifyEnabled: false,
  notifyChannel: "",
  notifyTo: "",
};

type SkillOption = {
  id: string;
  label: string;
  source: "integration" | "plugin";
  description?: string;
  hint?: string;
};

const INTEGRATION_LABELS: Record<string, { label: string; hint?: string }> = {
  google_calendar: {
    label: "Google Calendar",
    hint: "Use the Google Calendar integration to ",
  },
  google_email: {
    label: "Gmail",
    hint: "Use the Gmail integration to ",
  },
  google_calendar_email: {
    label: "Google Calendar + Gmail",
    hint: "Use Google Calendar and Gmail to ",
  },
};

const PLUGIN_LABELS: Record<string, string> = {
  discord: "Discord",
  telegram: "Telegram",
  slack: "Slack",
  googlechat: "Google Chat",
};

const CHANNEL_OPTIONS: Array<{ id: string; label: string; helper: string }> = [
  { id: "telegram", label: "Telegram", helper: "Chat ID or @username" },
  { id: "whatsapp", label: "WhatsApp", helper: "Phone number with country code" },
  { id: "imessage", label: "iMessage", helper: "Phone number or email" },
  { id: "discord", label: "Discord", helper: "User ID or channel ID" },
  { id: "slack", label: "Slack", helper: "User ID or channel ID" },
  { id: "googlechat", label: "Google Chat", helper: "users/<id> or spaces/<id>" },
];

const SCHEDULE_PRESETS: Array<{ id: SchedulePreset; label: string; needsTime?: boolean }> = [
  { id: "every_hour", label: "Hourly" },
  { id: "daily", label: "Daily", needsTime: true },
  { id: "weekdays", label: "Weekdays", needsTime: true },
  { id: "weekends", label: "Weekends", needsTime: true },
  { id: "mwf", label: "MWF", needsTime: true },
  { id: "once", label: "One-time", needsTime: true },
  { id: "custom", label: "Custom" },
];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function buildCronExpr(time: string, days: string): string {
  const [hh, mm] = time.split(":");
  const hour = Math.min(23, Math.max(0, parseInt(hh || "0", 10)));
  const minute = Math.min(59, Math.max(0, parseInt(mm || "0", 10)));
  return `${minute} ${hour} * * ${days}`;
}

function parseCron(expr: string): { minute: number; hour: number; days: string } | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minStr, hourStr, _dom, _mon, dow] = parts;
  const minute = Number(minStr);
  const hour = Number(hourStr);
  if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null;
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;
  return { minute, hour, days: dow };
}

function toLocalInputValue(ms: number): string {
  const date = new Date(ms);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function inferPreset(schedule: CronSchedule): { preset: SchedulePreset; time?: string } {
  if (schedule.kind === "at") {
    const date = new Date(schedule.atMs);
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return { preset: "once", time: `${hours}:${minutes}` };
  }
  if (schedule.kind === "every") {
    if (Math.round(schedule.everyMs / 60_000) === 60) {
      return { preset: "every_hour" };
    }
    return { preset: "custom" };
  }
  const parsed = parseCron(schedule.expr);
  if (!parsed) return { preset: "custom" };
  const time = `${pad2(parsed.hour)}:${pad2(parsed.minute)}`;
  switch (parsed.days) {
    case "*":
      return { preset: "daily", time };
    case "1-5":
      return { preset: "weekdays", time };
    case "0,6":
      return { preset: "weekends", time };
    case "1,3,5":
      return { preset: "mwf", time };
    default:
      return { preset: "custom", time };
  }
}

function editorFromJob(job: CronJob): EditorState {
  const inferred = inferPreset(job.schedule);
  const state: EditorState = {
    ...defaultEditor,
    name: job.name,
    description: job.description || "",
    enabled: job.enabled,
    schedulePreset: inferred.preset,
    scheduleTime: inferred.time || defaultEditor.scheduleTime,
  };

  switch (job.schedule.kind) {
    case "every":
      state.scheduleType = "every";
      state.intervalMinutes = String(Math.round(job.schedule.everyMs / 60_000));
      break;
    case "at":
      state.scheduleType = "at";
      state.atDate = toLocalInputValue(job.schedule.atMs);
      break;
    case "cron":
      state.scheduleType = "cron";
      state.cronExpr = job.schedule.expr;
      break;
  }

  switch (job.payload.kind) {
    case "systemEvent":
      state.message = job.payload.text;
      state.sessionTarget = job.sessionTarget || "main";
      break;
    case "agentTurn":
      state.message = stripCronGuards(job.payload.message || "");
      state.sessionTarget = job.sessionTarget || "isolated";
      state.notifyEnabled = job.payload.deliver === true;
      state.notifyChannel = job.payload.channel || "";
      state.notifyTo = job.payload.to || "";
      break;
  }

  return state;
}

function buildSkillHint(skills: SkillOption[]): string {
  if (skills.length === 0) return "";
  if (skills.length === 1 && skills[0].hint) return skills[0].hint;
  const labels = skills.map((skill) => skill.label).join(", ");
  return `Use ${labels} to `;
}

function buildGeneratePrompt(editor: EditorState, selected: SkillOption[]): string {
  const goal = editor.description.trim() || editor.name.trim() || "this task";
  const skillLabels = selected.map((skill) => skill.label);
  const skillsLine =
    skillLabels.length > 0
      ? `Selected plugins: ${skillLabels.join(", ")}`
      : "Selected plugins: none";

  return [
    "You are helping a user create a scheduled task for Nova/OpenClaw.",
    `Task name: ${editor.name.trim() || "(untitled)"}`,
    `Task description: ${editor.description.trim() || "(none)"}`,
    `Goal: ${goal}`,
    skillsLine,
    "",
    "Infer the most likely user intent from the name/description and selected plugins.",
    "Write the task instructions the agent should run on each schedule.",
    "Requirements:",
    "- Use the selected plugins explicitly by name if provided.",
    "- Keep it concise and actionable.",
    "- Output only the task instructions (no preamble or explanations).",
    "- Use a short 'Steps' list and an 'Output' section.",
  ].join("\n");
}

function waitForChatCompletion(
  client: GatewayClient,
  runId: string,
  timeoutMs = 20_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    let lastText = "";
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for OpenClaw response"));
    }, timeoutMs);

    const handler = (event: ChatEvent) => {
      if (!event?.runId || event.runId !== runId) return;
      if (event.state === "delta" || event.state === "final") {
        let text = "";
        if (typeof event.message?.content === "string") {
          text = event.message.content;
        } else if (Array.isArray(event.message?.content)) {
          text = event.message.content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text || "")
            .join("");
        }
        if (text) lastText = text;
        if (event.state === "final") {
          cleanup();
          resolve(lastText.trim());
        }
      } else if (event.state === "error") {
        cleanup();
        reject(new Error(event.errorMessage || "OpenClaw error"));
      } else if (event.state === "aborted") {
        cleanup();
        reject(new Error("OpenClaw generation aborted"));
      }
    };

    function cleanup() {
      window.clearTimeout(timer);
      client.off("chat", handler);
    }

    client.on("chat", handler);
  });
}

type HistoryMessage = {
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
};

function extractLatestAssistantMessage(messages: HistoryMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "assistant") continue;
    const text =
      msg.content
        ?.filter((c) => c?.type === "text")
        .map((c) => c?.text || "")
        .join("") || "";
    if (text.trim()) return text.trim();
  }
  return "";
}

async function resolveGatewayConnection(): Promise<{ wsUrl: string; token: string }> {
  const { wsUrl, token } = await resolveGatewayAuth();
  return {
    wsUrl: wsUrl || DEFAULT_GATEWAY_URL,
    token,
  };
}

function editorToSchedule(editor: EditorState): CronSchedule {
  switch (editor.scheduleType) {
    case "every":
      return { kind: "every", everyMs: (parseFloat(editor.intervalMinutes) || 5) * 60_000 };
    case "at":
      return {
        kind: "at",
        atMs: Number.isFinite(Date.parse(editor.atDate))
          ? Date.parse(editor.atDate)
          : Date.now(),
      };
    case "cron":
      return { kind: "cron", expr: editor.cronExpr || "0 * * * *" };
  }
}

function editorToPayload(editor: EditorState): CronPayload {
  const baseMessage = stripCronGuards(editor.message || "Hello");
  const message = `${CRON_GUARD_BLOCK}${baseMessage}`;
  const payload: CronPayload = {
    kind: "agentTurn",
    message,
  };

  if (editor.notifyEnabled) {
    payload.deliver = true;
    payload.channel = editor.notifyChannel || "last";
    if (editor.notifyTo.trim()) {
      payload.to = editor.notifyTo.trim();
    }
    payload.bestEffortDeliver = false;
  }

  return payload;
}

export function Tasks({ gatewayRunning }: Props) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [channelOptions, setChannelOptions] = useState<Array<{ id: string; label: string; helper: string }>>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);

  // Editor modal
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState<EditorState>(defaultEditor);
  const [saving, setSaving] = useState(false);
  const [generatingSteps, setGeneratingSteps] = useState(false);
  const [generateStepsError, setGenerateStepsError] = useState<string | null>(null);

  // History modal
  const [historyJobId, setHistoryJobId] = useState<string | null>(null);
  const [historyJobName, setHistoryJobName] = useState("");
  const [runs, setRuns] = useState<CronRunLogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const pollRef = useRef<number | null>(null);
  const tasksClientRef = useRef<GatewayClient | null>(null);
  const tasksConnectingRef = useRef<Promise<GatewayClient> | null>(null);
  const lastAutoMessageRef = useRef<string | null>(null);
  const lastAutoKindRef = useRef<"hint" | "generated" | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadSkills() {
      setSkillsLoading(true);
      setSkillsError(null);
      const next: SkillOption[] = [];
      const seen = new Set<string>();

      try {
        try {
          const cached = await getIntegrationsCached();
          cached
            .filter((i) => i.connected)
            .forEach((i: Integration) => {
              const id = `integration:${i.provider}`;
              if (seen.has(id)) return;
              seen.add(id);
              const meta = INTEGRATION_LABELS[i.provider] || {
                label: i.provider,
              };
              next.push({
                id,
                label: meta.label,
                source: "integration",
                description: i.email ? `Connected as ${i.email}` : "Connected",
                hint: meta.hint,
              });
            });
        } catch (e) {
          // ignore cache failures
        }
        const integrations = await getIntegrations();
        integrations
          .filter((i) => i.connected)
          .forEach((i: Integration) => {
            const id = `integration:${i.provider}`;
            if (seen.has(id)) return;
            seen.add(id);
            const meta = INTEGRATION_LABELS[i.provider] || {
              label: i.provider,
            };
            next.push({
              id,
              label: meta.label,
              source: "integration",
              description: i.email ? `Connected as ${i.email}` : "Connected",
              hint: meta.hint,
            });
          });
      } catch (e) {
        // Likely not authenticated or integrations not configured.
      }

      try {
        const plugins = await invoke<any[]>("get_plugin_store");
        for (const p of plugins || []) {
          if (!p?.enabled) continue;
          if (p?.kind === "memory") continue;
          const label = PLUGIN_LABELS[p.id] || p.id;
          next.push({
            id: `plugin:${p.id}`,
            label,
            source: "plugin",
            description: "Enabled",
            hint: `Use the ${label} tool to `,
          });
        }
      } catch (e) {
        setSkillsError("Failed to load connected plugins");
      }

      if (!cancelled) {
        setSkills(next);
        setSkillsLoading(false);
      }
    }

    loadSkills();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadChannels() {
      setChannelsLoading(true);
      setChannelsError(null);
      try {
        const state = await invoke<{
          telegram_enabled?: boolean;
          whatsapp_enabled?: boolean;
          discord_enabled?: boolean;
          imessage_enabled?: boolean;
          slack_enabled?: boolean;
          googlechat_enabled?: boolean;
        }>("get_agent_profile_state");
        if (cancelled) return;
        const enabledIds = new Set<string>();
        if (state.telegram_enabled) enabledIds.add("telegram");
        if (state.whatsapp_enabled) enabledIds.add("whatsapp");
        if (state.discord_enabled) enabledIds.add("discord");
        if (state.imessage_enabled) enabledIds.add("imessage");
        if (state.slack_enabled) enabledIds.add("slack");
        if (state.googlechat_enabled) enabledIds.add("googlechat");
        const filtered = CHANNEL_OPTIONS.filter((c) => enabledIds.has(c.id));
        setChannelOptions(filtered);
      } catch (e) {
        if (!cancelled) setChannelsError("Failed to load channels");
      } finally {
        if (!cancelled) setChannelsLoading(false);
      }
    }
    loadChannels();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await withGatewayClient((client) => client.listCronJobs(true));
      setJobs(result);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Gateway is offline. Start it to manage tasks."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!gatewayRunning) {
      tasksClientRef.current = null;
      setJobs([]);
      return;
    }

    (async () => {
      try {
        await ensureTasksClient();
        if (!cancelled) {
          fetchJobs();
          pollRef.current = window.setInterval(fetchJobs, 15_000);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Gateway is offline. Start it to manage tasks."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [gatewayRunning, fetchJobs]);

  useEffect(() => {
    return () => {
      tasksClientRef.current = null;
    };
  }, []);

  function openCreate() {
    setEditingJob(null);
    setEditor(defaultEditor);
    lastAutoMessageRef.current = null;
    lastAutoKindRef.current = null;
    setGenerateStepsError(null);
    setEditorOpen(true);
  }

  function openEdit(job: CronJob) {
    setEditingJob(job);
    setEditor(editorFromJob(job));
    lastAutoMessageRef.current = null;
    lastAutoKindRef.current = null;
    setGenerateStepsError(null);
    setEditorOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const schedule = editorToSchedule(editor);
      const payload = editorToPayload(editor);
      const sessionTarget: "main" | "isolated" = "isolated";
      if (editingJob) {
        await withGatewayClient((client) =>
          client.updateCronJob(editingJob.id, {
            name: editor.name,
            description: editor.description || undefined,
            schedule,
            payload,
            sessionTarget,
            enabled: editor.enabled,
          })
        );
      } else {
        await withGatewayClient((client) =>
          client.addCronJob({
            name: editor.name,
            description: editor.description || undefined,
            schedule,
            payload,
            sessionTarget,
            wakeMode: "next-heartbeat",
            enabled: editor.enabled,
          })
        );
      }
      setEditorOpen(false);
      fetchJobs();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Gateway is offline. Start it to save tasks."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(job: CronJob) {
    if (!confirm(`Delete task "${job.name}"? This cannot be undone.`)) return;
    try {
      await withGatewayClient((client) => client.removeCronJob(job.id));
      fetchJobs();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Gateway is offline. Start it to delete tasks."
      );
    }
  }

  async function handleRun(job: CronJob) {
    try {
      await withGatewayClient((client) => client.runCronJob(job.id, "force"));
      // Refresh after a brief delay to pick up state change
      setTimeout(fetchJobs, 1000);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Gateway is offline. Start it to run tasks."
      );
    }
  }

  async function handleToggle(job: CronJob) {
    try {
      await withGatewayClient((client) =>
        client.updateCronJob(job.id, { enabled: !job.enabled })
      );
      fetchJobs();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Gateway is offline. Start it to update tasks."
      );
    }
  }

  async function openHistory(job: CronJob) {
    setHistoryJobId(job.id);
    setHistoryJobName(job.name);
    setHistoryLoading(true);
    try {
      const result = await withGatewayClient((client) => client.getCronRuns(job.id, 20));
      setRuns(result);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Gateway is offline. Start it to view history."
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  function updateEditor(patch: Partial<EditorState>) {
    setEditor((prev) => ({ ...prev, ...patch }));
  }

  function updateSkillSelection(nextIds: string[]) {
    setEditor((prev) => {
      const nextState: EditorState = { ...prev, skillIds: nextIds };
      const selected = skills.filter((skill) => nextIds.includes(skill.id));
      const hint = buildSkillHint(selected);
      const trimmed = prev.message.trim();
      const lastAuto = lastAutoMessageRef.current;
      const lastKind = lastAutoKindRef.current;

      if (!hint) {
        if (lastKind === "hint" && lastAuto && trimmed === lastAuto) {
          nextState.message = "";
        }
        lastAutoMessageRef.current = null;
        lastAutoKindRef.current = null;
        return nextState;
      }

      if (!trimmed || (lastKind === "hint" && lastAuto && trimmed === lastAuto)) {
        nextState.message = hint;
        lastAutoMessageRef.current = hint;
        lastAutoKindRef.current = "hint";
      }

      return nextState;
    });
  }

  function applySchedulePreset(preset: SchedulePreset) {
    if (preset === "every_hour") {
      updateEditor({
        schedulePreset: preset,
        scheduleType: "every",
        intervalMinutes: "60",
      });
      return;
    }
    if (preset === "once") {
      updateEditor({
        schedulePreset: preset,
        scheduleType: "at",
        atDate: editor.atDate || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      return;
    }
    if (preset === "custom") {
      updateEditor({ schedulePreset: preset });
      return;
    }

    const time = editor.scheduleTime || defaultEditor.scheduleTime;
    const days =
      preset === "daily"
        ? "*"
        : preset === "weekdays"
          ? "1-5"
          : preset === "weekends"
            ? "0,6"
            : "1,3,5";
    updateEditor({
      schedulePreset: preset,
      scheduleType: "cron",
      scheduleTime: time,
      cronExpr: buildCronExpr(time, days),
    });
  }

  const integrations = useMemo(
    () => skills.filter((s) => s.source === "integration"),
    [skills]
  );
  const plugins = useMemo(
    () => skills.filter((s) => s.source === "plugin"),
    [skills]
  );
  const selectedSkills = useMemo(
    () => skills.filter((s) => editor.skillIds.includes(s.id)),
    [skills, editor.skillIds]
  );
  const selectedSkillLabels = useMemo(
    () => selectedSkills.map((skill) => skill.label).join(", "),
    [selectedSkills]
  );
  const notifyInvalid =
    editor.notifyEnabled && (!editor.notifyChannel || !editor.notifyTo.trim());
  const selectedChannelMeta = useMemo(
    () => CHANNEL_OPTIONS.find((c) => c.id === editor.notifyChannel) || null,
    [editor.notifyChannel]
  );

  async function ensureTasksClient(): Promise<GatewayClient> {
    if (tasksClientRef.current?.isConnected()) return tasksClientRef.current;
    if (tasksConnectingRef.current) return tasksConnectingRef.current;
    if (!gatewayRunning) {
      throw new Error("Gateway is offline. Start it to manage tasks.");
    }
    tasksConnectingRef.current = (async () => {
      const { wsUrl, token } = await resolveGatewayConnection();
      const client = createGatewayClient(wsUrl, token);
      if (!client.isConnected()) {
        const timeoutMs = 8_000;
        let timeoutId: number | null = null;
        const timeout = new Promise<never>((_, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new Error("Gateway connection timed out"));
          }, timeoutMs);
        });
        try {
          await Promise.race([client.connect(), timeout]);
        } finally {
          if (timeoutId) window.clearTimeout(timeoutId);
        }
      }
      tasksClientRef.current = client;
      return client;
    })();
    try {
      return await tasksConnectingRef.current;
    } finally {
      tasksConnectingRef.current = null;
    }
  }

  async function withGatewayClient<T>(
    action: (client: GatewayClient) => Promise<T>
  ): Promise<T> {
    const client = await ensureTasksClient();
    return action(client);
  }

  async function handleGenerateSteps() {
    setGenerateStepsError(null);
    let client: GatewayClient;
    try {
      client = await withGatewayClient(async (connected) => connected);
    } catch (err) {
      setGenerateStepsError(
        err instanceof Error ? err.message : "Gateway is offline. Start it and try again."
      );
      return;
    }

    setGeneratingSteps(true);
    const sessionKey = client.createSessionKey();
    const prompt = buildGeneratePrompt(editor, selectedSkills);

    try {
      const runId = await client.sendMessage(sessionKey, prompt);
      let reply = "";
      try {
        reply = await waitForChatCompletion(client, runId, 12_000);
      } catch {
        // Fall back to polling + history if we didn't receive streamed events.
      }

      if (!reply) {
        const status = await client.rpc<{ status?: string }>("agent.wait", {
          runId,
          timeoutMs: 20_000,
        });
        if (status?.status === "timeout") {
          throw new Error("Timed out waiting for OpenClaw");
        }
        const history = await client.getChatHistory(sessionKey, 20);
        reply = extractLatestAssistantMessage(history as HistoryMessage[]);
      }

      if (!reply) throw new Error("No response received from OpenClaw");
      updateEditor({ message: reply });
      lastAutoMessageRef.current = reply;
      lastAutoKindRef.current = "generated";
    } catch (e) {
      setGenerateStepsError(e instanceof Error ? e.message : "Failed to generate steps");
    } finally {
      setGeneratingSteps(false);
      client
        .rpc("sessions.delete", { key: sessionKey })
        .catch(() => {});
    }
  }

  return (
    <div className="h-full flex flex-col p-6">
      <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            Automation Tasks
          </h1>
          <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>
            Scheduled jobs that run automatically in the background.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchJobs}
            disabled={loading || !gatewayRunning}
            className="p-2 rounded-lg border border-[var(--border-default)] bg-white hover:bg-[var(--system-gray-6)] transition-colors"
            title="Refresh tasks"
          >
            <RefreshCw className={clsx("w-4 h-4 text-[var(--text-secondary)]", loading && "animate-spin")} />
          </button>
          <button
            onClick={openCreate}
            disabled={!gatewayRunning}
            className="px-4 py-2 bg-[var(--system-blue)] text-white rounded-lg font-semibold text-sm hover:opacity-90 transition-all flex items-center gap-2 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            New Task
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto max-w-6xl w-full mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* Offline Warning */}
        {!gatewayRunning && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-100 rounded-xl flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-white border border-amber-100 flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-amber-900">Secure Sandbox is Offline</h2>
              <p className="text-sm text-amber-700">Scheduled tasks won't execute until the gateway is started.</p>
            </div>
          </div>
        )}

        {/* Compact Informational Banner */}
        <div className="mb-8 p-5 bg-[var(--text-primary)] rounded-xl text-white relative overflow-hidden shadow-sm">
          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-[var(--system-blue)] flex items-center justify-center shrink-0">
                <Smartphone className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Keep Automation Running</h3>
                <p className="text-sm text-white/75 mt-1">
                  Tasks execute only when this computer is awake.
                </p>
              </div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-3 pt-4 lg:pt-0 lg:border-l lg:border-white/10 lg:pl-8">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-300 mb-0.5">macOS</p>
                <p className="text-[12px] text-white/80">Displays → Advanced → Prevent Sleep</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-green-300 mb-0.5">Windows</p>
                <p className="text-[12px] text-white/80">Power → Plugged in, Never Sleep</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-purple-300 mb-0.5">Linux</p>
                <p className="text-[12px] text-white/80">Use systemd-inhibit tools</p>
              </div>
            </div>
          </div>
          <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-[var(--system-blue)]/20 rounded-full blur-3xl" />
        </div>

        <h2 className="text-[13px] font-medium uppercase tracking-wide mb-3 px-1 text-[var(--text-secondary)]">
          Scheduled Jobs
        </h2>

        {/* Task List */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pb-20">
          {gatewayRunning && loading && jobs.length === 0 ? (
            <div className="col-span-full py-32 flex flex-col items-center gap-4">
              <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
              <p className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">Syncing tasks...</p>
            </div>
          ) : gatewayRunning && jobs.length === 0 ? (
            <div className="col-span-full py-20 text-center bg-white rounded-xl border border-dashed border-[var(--border-default)]">
              <CalendarClock className="w-16 h-16 mx-auto mb-6 text-gray-200" strokeWidth={1.5} />
              <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-2">No tasks scheduled</h3>
              <p className="text-[var(--text-secondary)] mb-8">Ready to automate? Create your first scheduled task above.</p>
              <button onClick={openCreate} className="px-6 py-2.5 bg-[var(--text-primary)] text-white rounded-lg font-semibold text-sm hover:opacity-90 transition-all">Create First Task</button>
            </div>
          ) : (
            jobs.map((job) => {
              const badge = statusBadge(job);
              return (
                <div key={job.id} className="group bg-white rounded-xl p-5 shadow-sm border border-[var(--border-subtle)] hover:shadow-md transition-all duration-300 flex flex-col">
                  <div className="flex items-start justify-between gap-4 mb-6">
                    <div className="flex items-start gap-4">
                      <div className={clsx(
                        "w-12 h-12 rounded-xl flex items-center justify-center border transition-all duration-300 shrink-0",
                        job.enabled ? "bg-blue-50 border-blue-100 text-blue-600" : "bg-gray-50 border-gray-100 text-gray-400"
                      )}>
                        <CalendarClock className="w-6 h-6" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-[var(--text-primary)] text-base mb-1 truncate leading-tight">{job.name}</h3>
                        <div className="flex items-center gap-2">
                          <span className={clsx("px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border", badge.className)}>
                            {badge.label}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Toggle Switch */}
                    <button
                      onClick={() => handleToggle(job)}
                      className={clsx(
                        "relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                        job.enabled ? "bg-blue-600" : "bg-gray-200"
                      )}
                    >
                      <span className={clsx(
                        "pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
                        job.enabled ? "translate-x-5" : "translate-x-0"
                      )} />
                    </button>
                  </div>

                  <div className="flex-1 mb-6">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-3.5 h-3.5 text-[var(--system-blue)]" />
                      <span className="text-[14px] font-semibold text-[var(--system-blue)]">{describeSchedule(job.schedule)}</span>
                    </div>
                    {job.description && (
                      <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed line-clamp-2 italic">"{job.description}"</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-[var(--border-subtle)] mt-auto">
                    <div className="flex items-center gap-1.5">
                      <button 
                        onClick={() => handleRun(job)} 
                        className="p-2 rounded-lg bg-[var(--system-gray-6)] text-[var(--text-secondary)] hover:bg-green-50 hover:text-green-600 transition-all border border-[var(--border-subtle)]" 
                        title="Run Now"
                      >
                        <Play className="w-4 h-4 fill-current" />
                      </button>
                      <button 
                        onClick={() => openEdit(job)} 
                        className="p-2 rounded-lg bg-[var(--system-gray-6)] text-[var(--text-secondary)] hover:bg-blue-50 hover:text-blue-600 transition-all border border-[var(--border-subtle)]" 
                        title="Edit Task"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => openHistory(job)} 
                        className="p-2 rounded-lg bg-[var(--system-gray-6)] text-[var(--text-secondary)] hover:bg-[var(--system-gray-5)] hover:text-[var(--text-primary)] transition-all border border-[var(--border-subtle)]" 
                        title="History"
                      >
                        <History className="w-4 h-4" />
                      </button>
                    </div>
                    <button 
                      onClick={() => handleDelete(job)} 
                      className="p-2 rounded-lg bg-[var(--system-gray-6)] text-[var(--text-tertiary)] hover:bg-red-50 hover:text-red-600 transition-all border border-[var(--border-subtle)]" 
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Editor Modal ────────────────────────────────────────── */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 backdrop-blur-sm px-4">
          <div className="w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl border border-[var(--border-subtle)] shadow-xl flex flex-col animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                  {editingJob ? "Edit Automation" : "New Automation"}
                </h2>
                <p className="text-xs text-[var(--text-tertiary)] mt-1">
                  Configure schedule, tools, and instructions.
                </p>
              </div>
              <button
                onClick={() => setEditorOpen(false)}
                className="p-2 rounded-lg hover:bg-[var(--system-gray-6)] text-[var(--text-tertiary)] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 overflow-auto space-y-6">
              {/* Basic Info */}
              <div className="bg-[var(--system-gray-6)]/60 rounded-xl border border-[var(--border-subtle)] p-4 space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide mb-2 ml-1">Task Name</label>
                  <input
                    type="text"
                    className="w-full px-4 py-3 bg-white border border-[var(--border-default)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--system-blue)]/20"
                    placeholder="Morning Briefing, Sync Repo, etc."
                    value={editor.name}
                    onChange={(e) => updateEditor({ name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide mb-2 ml-1">Goal (optional)</label>
                  <input
                    type="text"
                    className="w-full px-4 py-3 bg-white border border-[var(--border-default)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--system-blue)]/20"
                    placeholder="What is this task trying to achieve?"
                    value={editor.description}
                    onChange={(e) => updateEditor({ description: e.target.value })}
                  />
                </div>
              </div>

              {/* Schedule Section */}
              <div className="bg-[var(--system-gray-6)]/60 rounded-xl border border-[var(--border-subtle)] p-4 space-y-4">
                <label className="block text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide mb-1 ml-1">Select Schedule</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {SCHEDULE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applySchedulePreset(preset.id)}
                      className={clsx(
                        "px-3 py-2 rounded-lg text-xs font-semibold transition-all border",
                        editor.schedulePreset === preset.id
                          ? "bg-[var(--system-blue)] text-white border-[var(--system-blue)]"
                          : "bg-white text-[var(--text-secondary)] border-[var(--border-default)] hover:bg-[var(--system-gray-6)]"
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Conditional Inputs */}
                <div className="pt-1">
                  {["daily", "weekdays", "weekends", "mwf"].includes(editor.schedulePreset) && (
                    <div className="flex flex-col gap-2">
                      <label className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide ml-1">Execution Time</label>
                      <input
                        type="time"
                        className="w-full px-4 py-3 bg-white border border-[var(--border-default)] rounded-lg text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--system-blue)]/20"
                        value={editor.scheduleTime}
                        onChange={(e) => {
                          const nextTime = e.target.value || defaultEditor.scheduleTime;
                          const days =
                            editor.schedulePreset === "daily" ? "*" :
                            editor.schedulePreset === "weekdays" ? "1-5" :
                            editor.schedulePreset === "weekends" ? "0,6" : "1,3,5";
                          updateEditor({
                            scheduleTime: nextTime,
                            scheduleType: "cron",
                            cronExpr: buildCronExpr(nextTime, days),
                          });
                        }}
                      />
                    </div>
                  )}
                  {editor.schedulePreset === "once" && (
                    <div className="flex flex-col gap-2">
                      <label className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide ml-1">Date & Time</label>
                      <input
                        type="datetime-local"
                        className="w-full px-4 py-3 bg-white border border-[var(--border-default)] rounded-lg text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--system-blue)]/20"
                        value={editor.atDate ? editor.atDate.slice(0, 16) : ""}
                        onChange={(e) =>
                          updateEditor({
                            scheduleType: "at",
                            atDate: new Date(e.target.value).toISOString(),
                          })
                        }
                      />
                    </div>
                  )}
                  {editor.schedulePreset === "custom" && editor.scheduleType === "every" && (
                    <div className="flex flex-col gap-2">
                      <label className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide ml-1">Interval (minutes)</label>
                      <input
                        type="number"
                        min="1"
                        className="w-full px-4 py-3 bg-white border border-[var(--border-default)] rounded-lg text-sm font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--system-blue)]/20"
                        value={editor.intervalMinutes}
                        onChange={(e) => updateEditor({ scheduleType: "every", intervalMinutes: e.target.value })}
                      />
                    </div>
                  )}
                  {editor.schedulePreset === "custom" && editor.scheduleType === "cron" && (
                    <div className="flex flex-col gap-2">
                      <label className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide ml-1">Cron Expression</label>
                      <input
                        type="text"
                        className="w-full px-4 py-3 bg-white border border-[var(--border-default)] rounded-lg text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--system-blue)]/20"
                        placeholder="0 * * * *"
                        value={editor.cronExpr}
                        onChange={(e) => updateEditor({ scheduleType: "cron", cronExpr: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Plugins Selection */}
              <div className="bg-[var(--system-gray-6)]/60 rounded-xl border border-[var(--border-subtle)] p-4">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide ml-1">Select Tools</label>
                  {skills.length > 0 && (
                    <div className="flex gap-3">
                      <button type="button" className="text-[11px] font-semibold text-[var(--system-blue)] hover:underline" onClick={() => updateSkillSelection(skills.map(s => s.id))}>Select All</button>
                      <button type="button" className="text-[11px] font-semibold text-[var(--text-tertiary)] hover:underline" onClick={() => updateSkillSelection([])}>Clear</button>
                    </div>
                  )}
                </div>

                {skills.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {skills.map((skill) => {
                      const sel = editor.skillIds.includes(skill.id);
                      return (
                        <button
                          key={skill.id}
                          type="button"
                          onClick={() => {
                            const next = sel ? editor.skillIds.filter(id => id !== skill.id) : [...editor.skillIds, skill.id];
                            updateSkillSelection(next);
                          }}
                          className={clsx(
                            "px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border",
                            sel ? "bg-[var(--system-blue)]/10 text-[var(--system-blue)] border-[var(--system-blue)]/20" : "bg-white text-[var(--text-secondary)] border-[var(--border-default)] hover:bg-[var(--system-gray-6)]"
                          )}
                        >
                          {skill.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--text-tertiary)] italic ml-1">No tools connected.</p>
                )}
              </div>

              {/* Instructions Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wide ml-1">Task Instructions</label>
                  <button
                    type="button"
                    onClick={handleGenerateSteps}
                    disabled={generatingSteps}
                    className="flex items-center gap-1.5 text-[var(--system-blue)] hover:opacity-80 font-semibold text-xs"
                  >
                    {generatingSteps ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    Auto-Generate
                  </button>
                </div>
                <textarea
                  className="w-full px-4 py-3.5 bg-white border border-[var(--border-default)] rounded-xl text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--system-blue)]/20 min-h-[160px] leading-relaxed"
                  placeholder="Tell Nova exactly what steps to take during this run..."
                  value={editor.message}
                  onChange={(e) => updateEditor({ message: e.target.value })}
                />
                {generateStepsError && <p className="text-xs text-red-500 font-semibold ml-1">{generateStepsError}</p>}
              </div>

              {/* Notifications */}
              <div className="pt-4 border-t border-[var(--border-subtle)]">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Bell className={clsx("w-5 h-5", editor.notifyEnabled ? "text-[var(--system-blue)]" : "text-[var(--text-tertiary)]")} />
                    <span className="text-sm font-semibold text-[var(--text-primary)]">Push Notifications</span>
                  </div>
                  <button
                    onClick={() => updateEditor({ notifyEnabled: !editor.notifyEnabled })}
                    className={clsx(
                      "relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                      editor.notifyEnabled ? "bg-[var(--system-blue)]" : "bg-gray-200"
                    )}
                  >
                    <span className={clsx(
                      "pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition duration-200",
                      editor.notifyEnabled ? "translate-x-5" : "translate-x-0"
                    )} />
                  </button>
                </div>

                {editor.notifyEnabled && (
                  <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                    <div className="flex flex-wrap gap-2">
                      {channelOptions.map((c) => {
                        const sel = editor.notifyChannel === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => updateEditor({ notifyChannel: c.id })}
                            className={clsx(
                              "px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border",
                              sel ? "bg-[var(--system-blue)]/10 text-[var(--system-blue)] border-[var(--system-blue)]/20" : "bg-white text-[var(--text-secondary)] border-[var(--border-default)] hover:bg-[var(--system-gray-6)]"
                            )}
                          >
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="text"
                      className="w-full px-4 py-3 bg-white border border-[var(--border-default)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--system-blue)]/20"
                      placeholder={selectedChannelMeta?.helper || "Recipient address..."}
                      value={editor.notifyTo}
                      onChange={(e) => updateEditor({ notifyTo: e.target.value })}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-[var(--border-subtle)] bg-white flex items-center gap-3">
              <button
                onClick={() => setEditorOpen(false)}
                className="flex-1 py-2.5 text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--system-gray-6)] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !editor.name.trim() || notifyInvalid}
                className="flex-1 py-2.5 text-sm font-semibold bg-[var(--system-blue)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-all"
              >
                {saving ? "Saving..." : editingJob ? "Update Task" : "Create Task"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── History Modal ───────────────────────────────────────── */}
      {historyJobId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-md px-4" onClick={() => setHistoryJobId(null)}>
          <div className="bg-white p-8 w-full max-w-xl max-h-[80vh] flex flex-col rounded-[36px] shadow-2xl border border-gray-100 animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Run History</h2>
                <p className="text-sm text-gray-500 font-medium mt-1">{historyJobName}</p>
              </div>
              <button
                onClick={() => setHistoryJobId(null)}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-400 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-auto space-y-3 pr-2 custom-scrollbar">
              {historyLoading ? (
                <div className="py-24 flex flex-col items-center gap-4">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                  <p className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">Loading logs...</p>
                </div>
              ) : runs.length === 0 ? (
                <div className="py-24 text-center">
                  <Clock className="w-12 h-12 mx-auto mb-4 text-gray-200" strokeWidth={1.5} />
                  <p className="text-gray-500 font-medium">No execution logs found for this task.</p>
                </div>
              ) : (
                runs.map((run) => (
                  <div
                    key={run.id}
                    className="p-5 rounded-[22px] bg-gray-50 border border-gray-100 group hover:bg-white hover:shadow-md transition-all duration-300"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className={clsx(
                          "w-2 h-2 rounded-full",
                          run.status === "ok" ? "bg-green-500" : run.status === "skipped" ? "bg-gray-400" : "bg-red-500"
                        )} />
                        <span className="text-[14px] font-bold text-gray-900">{formatRunTime(run)}</span>
                      </div>
                      <span
                        className={clsx(
                          "text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md border",
                          run.status === "ok" ? "bg-green-50 text-green-600 border-green-100" : 
                          run.status === "skipped" ? "bg-gray-100 text-gray-500 border-gray-200" : 
                          "bg-red-50 text-red-600 border-red-100"
                        )}
                      >
                        {run.status}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-4 text-xs text-gray-400 font-medium">
                      {formatRunDuration(run) && (
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3" />
                          <span>Took {formatRunDuration(run)}</span>
                        </div>
                      )}
                    </div>

                    {run.error && (
                      <div className="mt-4 p-3 bg-red-50 rounded-xl border border-red-100 text-[13px] text-red-600 font-medium leading-relaxed">
                        {run.error}
                      </div>
                    )}
                    {!run.error && run.summary && (
                      <div className="mt-4 text-[13px] text-gray-600 font-medium leading-relaxed line-clamp-3 group-hover:line-clamp-none transition-all">
                        {run.summary}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
