import type { AiConfig, ModelChannel } from "@/stores/use-config-store";

type BackendConfigResponse = { ok?: boolean; config?: AiConfig | null };
export type SyncedModelPrice = { model: string; display: string; note?: string; source: string };

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingConfig: AiConfig | null = null;
let initializedConnection = "";

export function backendConnection() {
    if (typeof window === "undefined") return null;
    const query = new URLSearchParams(window.location.search);
    const url = (window.localStorage.getItem("canvas-agent-url") || query.get("agentUrl") || "http://127.0.0.1:17371").replace(/\/+$/, "");
    const token = window.localStorage.getItem("canvas-agent-token") || query.get("agentToken") || "";
    return url && token ? { url, token } : null;
}

export async function loadBackendConfig() {
    const connection = backendConnection();
    if (!connection) return null;
    try {
        const response = await fetch(`${connection.url}/api/config`, { headers: { "x-canvas-agent-token": connection.token } });
        if (!response.ok) return null;
        const payload = (await response.json()) as BackendConfigResponse;
        if (!payload.ok || (payload.config && !validBackendConfig(payload.config))) return null;
        initializedConnection = backendConnectionId(connection);
        return payload.config || null;
    } catch {
        return null;
    }
}

export function scheduleBackendConfigSave(config: AiConfig) {
    pendingConfig = config;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        const next = pendingConfig;
        pendingConfig = null;
        saveTimer = null;
        if (next) void saveBackendConfig(next);
    }, 250);
}

async function saveBackendConfig(config: AiConfig) {
    const connection = backendConnection();
    if (!connection) return;
    try {
        const connectionId = backendConnectionId(connection);
        let nextConfig = config;
        if (initializedConnection !== connectionId) {
            const response = await fetch(`${connection.url}/api/config`, { headers: { "x-canvas-agent-token": connection.token } });
            if (!response.ok) return;
            const payload = (await response.json()) as BackendConfigResponse;
            if (!payload.ok || (payload.config && !validBackendConfig(payload.config))) return;
            if (payload.config) nextConfig = mergeBackendConfig(config, payload.config);
            initializedConnection = connectionId;
        }
        await fetch(`${connection.url}/api/config`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", "x-canvas-agent-token": connection.token },
            body: JSON.stringify({ config: nextConfig }),
        });
    } catch {
        // Local persistence remains the fallback when the Agent is offline.
    }
}

function validBackendConfig(value: unknown): value is AiConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const config = value as Partial<AiConfig>;
    return Array.isArray(config.channels) && config.channels.every((channel) => Boolean(channel && typeof channel.id === "string" && typeof channel.name === "string" && typeof channel.baseUrl === "string" && typeof channel.apiKey === "string" && Array.isArray(channel.models)));
}

function mergeBackendConfig(local: AiConfig, remote: AiConfig): AiConfig {
    const channels = new Map(remote.channels.map((channel) => [channel.id, channel]));
    local.channels.forEach((channel) => channels.set(channel.id, channel));
    return { ...remote, ...local, channels: [...channels.values()] };
}

function backendConnectionId(connection: NonNullable<ReturnType<typeof backendConnection>>) {
    return `${connection.url}|${connection.token.slice(-8)}`;
}

/** Immediately persist the current configuration when the user explicitly requests a sync. */
export async function syncConfigToBackend(config: AiConfig) {
    const connection = backendConnection();
    if (!connection) return false;
    const response = await fetch(`${connection.url}/api/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-canvas-agent-token": connection.token },
        body: JSON.stringify({ config }),
    });
    return response.ok;
}

export function pricingUrlForChannel(channel: Pick<ModelChannel, "name" | "baseUrl" | "pricingUrl">) {
    if (channel.pricingUrl?.trim()) return channel.pricingUrl.trim();
    const key = `${channel.name} ${channel.baseUrl}`;
    if (/deepkey/i.test(key)) return "https://deepkey.top/console/modelsquare";
    if (/apimart/i.test(key)) return "https://apimart.ai/zh/pricing";
    if (/toapis/i.test(key)) return "https://toapis.com/dashboard/pricing";
    return "";
}

export function pricingExchangeRateForChannel(channel: Pick<ModelChannel, "name" | "baseUrl" | "pricingUrl" | "pricingExchangeRate">) {
    if (Number.isFinite(channel.pricingExchangeRate) && Number(channel.pricingExchangeRate) > 0) return Number(channel.pricingExchangeRate);
    const key = `${channel.name} ${channel.baseUrl} ${channel.pricingUrl || ""}`;
    if (/toapis/i.test(key)) return 7;
    if (/apimart/i.test(key)) return 6.7801;
    return 1;
}

export async function syncModelPrices(sourceUrl: string, models: string[], exchangeRate: number, proxyUrl = "") {
    const connection = backendConnection();
    if (!connection) throw new Error("请先连接本地 Agent，再抓取定价页面");
    const response = await fetch(`${connection.url}/api/model-prices/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-canvas-agent-token": connection.token },
        body: JSON.stringify({ sourceUrl, models, exchangeRate, proxyUrl }),
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; prices?: SyncedModelPrice[]; error?: string } | null;
    if (response.status === 404) throw new Error("当前本地 Agent 版本过旧，请重启一键启动脚本后再抓取价格");
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || `价格抓取失败：HTTP ${response.status}`);
    return payload.prices || [];
}
