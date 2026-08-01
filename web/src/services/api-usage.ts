import localforage from "localforage";
import { nanoid } from "nanoid";

import { backendConnection } from "@/services/config-sync";
import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";

export type ApiUsageKind = "image" | "video" | "audio" | "text";
export type ApiUsageStatus = "success" | "error";

export type ApiUsageLog = {
    id: string;
    startedAt: number;
    durationMs: number;
    channelId: string;
    channelName: string;
    apiFormat: string;
    apiHost: string;
    model: string;
    kind: ApiUsageKind;
    operation: string;
    endpoint: string;
    status: ApiUsageStatus;
    input: string;
    output?: string;
    error?: string;
};

type ApiUsageContext = {
    config: AiConfig;
    model: string;
    kind: ApiUsageKind;
    operation: string;
    endpoint: string;
    input: string;
};

export const API_USAGE_UPDATED_EVENT = "infinite-canvas:api-usage-updated";

const MAX_LOGS = 2000;
const MIGRATION_KEY = "infinite-canvas:api-usage-backend-migrated";
const store = localforage.createInstance({ name: "infinite-canvas", storeName: "api_usage_logs" });
let backendHydration: Promise<ApiUsageLog[]> | null = null;

export async function trackApiUsage<T>(context: ApiUsageContext, request: () => Promise<T>, output: (result: T) => string | undefined = () => undefined) {
    const startedAt = Date.now();
    try {
        const result = await request();
        recordApiUsage(context, startedAt, "success", output(result));
        return result;
    } catch (error) {
        recordApiUsage(context, startedAt, "error", undefined, error instanceof Error ? error.message : "请求失败");
        throw error;
    }
}

export async function listApiUsageLogs() {
    if (!backendHydration) backendHydration = hydrateBackendLogs();
    return backendHydration;
}

/** Re-read the Agent copy after a late local-Agent connection. */
export async function refreshApiUsageLogs() {
    backendHydration = hydrateBackendLogs();
    const logs = await backendHydration;
    window.dispatchEvent(new CustomEvent(API_USAGE_UPDATED_EVENT));
    return logs;
}

async function listLocalApiUsageLogs() {
    const logs: ApiUsageLog[] = [];
    await store.iterate<ApiUsageLog, void>((value) => {
        if (value?.id && typeof value.startedAt === "number") logs.push(value);
    });
    return logs.sort((a, b) => b.startedAt - a.startedAt);
}

export async function clearApiUsageLogs() {
    await store.clear();
    backendHydration = Promise.resolve([]);
    window.localStorage.setItem(MIGRATION_KEY, "1");
    const connection = backendConnection();
    if (connection) {
        try {
            await fetch(`${connection.url}/api/api-usage`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", "x-canvas-agent-token": connection.token },
                body: JSON.stringify({ logs: [] }),
            });
        } catch {
            // Local clearing still succeeds while the Agent is offline.
        }
    }
    window.dispatchEvent(new CustomEvent(API_USAGE_UPDATED_EVENT));
}

function recordApiUsage(context: ApiUsageContext, startedAt: number, status: ApiUsageStatus, output?: string, error?: string) {
    const channel = resolveModelChannel(context.config, context.model);
    const log: ApiUsageLog = {
        id: nanoid(),
        startedAt,
        durationMs: Math.max(0, Date.now() - startedAt),
        channelId: channel.id,
        channelName: channel.name,
        apiFormat: channel.apiFormat,
        apiHost: readApiHost(channel.baseUrl),
        model: modelOptionName(context.model),
        kind: context.kind,
        operation: context.operation,
        endpoint: context.endpoint,
        status,
        input: context.input,
        ...(output ? { output } : {}),
        ...(error ? { error } : {}),
    };
    window.dispatchEvent(new CustomEvent<ApiUsageLog>(API_USAGE_UPDATED_EVENT, { detail: log }));
    void persistLog(log);
}

async function persistLog(log: ApiUsageLog) {
    try {
        await store.setItem(log.id, log);
        backendHydration = null;
        const keys = await store.keys();
        if (keys.length > MAX_LOGS) {
            const logs = await listLocalApiUsageLogs();
            await Promise.all(logs.slice(MAX_LOGS).map((item) => store.removeItem(item.id)));
        }
    } catch {
        // Statistics must never affect the generation request itself.
    }
    const connection = backendConnection();
    if (!connection) return;
    try {
        await fetch(`${connection.url}/api/api-usage`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-canvas-agent-token": connection.token },
            body: JSON.stringify({ log }),
        });
    } catch {
        // Statistics must never affect the generation request itself.
    }
}

async function hydrateBackendLogs() {
    const localLogs = await listLocalApiUsageLogs();
    const connection = backendConnection();
    if (!connection) return localLogs;
    try {
        const response = await fetch(`${connection.url}/api/api-usage`, { headers: { "x-canvas-agent-token": connection.token } });
        if (!response.ok) return localLogs;
        const payload = (await response.json()) as { ok?: boolean; logs?: ApiUsageLog[] };
        if (!payload.ok || !Array.isArray(payload.logs)) return localLogs;
        const migrated = window.localStorage.getItem(MIGRATION_KEY) === "1";
        const merged = new Map(payload.logs.map((log) => [log.id, log]));
        if (!migrated) localLogs.forEach((log) => merged.set(log.id, log));
        const logs = [...merged.values()].sort((left, right) => right.startedAt - left.startedAt).slice(0, MAX_LOGS);
        await store.clear();
        await Promise.all(logs.map((log) => store.setItem(log.id, log)));
        if (!migrated && localLogs.length) {
            await fetch(`${connection.url}/api/api-usage`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-canvas-agent-token": connection.token },
                body: JSON.stringify({ logs: localLogs }),
            });
        }
        window.localStorage.setItem(MIGRATION_KEY, "1");
        return logs;
    } catch {
        return localLogs;
    }
}

function readApiHost(baseUrl: string) {
    try {
        return new URL(baseUrl).host;
    } catch {
        return baseUrl.trim();
    }
}
