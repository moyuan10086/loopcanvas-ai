import axios from "axios";

import { resolveModelRequestConfig, type AiConfig, type ModelChannel } from "@/stores/use-config-store";

export type RunningHubTaskResult = { status: "queued" | "running" | "success" | "failed"; urls: string[]; error?: string };

export async function fetchRunningHubWorkflowJson(channel: Pick<ModelChannel, "baseUrl" | "apiKey" | "walletApiKey" | "runningHubKeyMode">, workflowId: string) {
    const id = workflowId.trim();
    if (!/^\d+$/.test(id)) throw new Error("RunningHub 工作流 ID 应为数字");
    const root = channel.baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    if (!root) throw new Error("请先填写 RunningHub 接口地址");
    const rhKey = channel.apiKey.trim();
    const walletKey = channel.walletApiKey?.trim() || "";
    const useWallet = channel.runningHubKeyMode === "wallet" || (channel.runningHubKeyMode !== "rh" && !rhKey && Boolean(walletKey));
    const apiKey = useWallet ? walletKey : rhKey;
    if (!apiKey) throw new Error("请先填写 RunningHub 消费级-会员或企业级-共享 API Key");

    try {
        const response = await axios.post<unknown>(
            `${root}/api/openapi/getJsonApiFormat`,
            { apiKey, workflowId: id },
            { headers: { "Content-Type": "application/json" } },
        );
        const payload = parseRunningHubPayload(response.data);
        if (payload && payload.code !== undefined && payload.code !== 0 && payload.code !== "0") throw new Error(String(payload.msg || "RunningHub 工作流读取失败"));
        const data = payload?.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : typeof payload?.data === "string" ? parseRunningHubPayload(payload.data) : payload;
        if (!data || !data.prompt) throw new Error(String(payload?.msg || "RunningHub 未返回工作流 JSON"));
        return data;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const response = error.response?.data as Record<string, unknown> | undefined;
            throw new Error(String(response?.msg || response?.message || error.message || "RunningHub 工作流读取失败"));
        }
        throw error instanceof Error ? error : new Error("RunningHub 工作流读取失败");
    }
}

export async function queryRunningHubTask(config: AiConfig, model: string, taskId: string, useWallet = false): Promise<RunningHubTaskResult> {
    const requestConfig = resolveModelRequestConfig(config, model);
    const root = requestConfig.baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
    const apiKey = useWallet ? requestConfig.walletApiKey : requestConfig.apiKey;
    if (!root || !apiKey) throw new Error("RunningHub API Key 未配置");
    const response = await axios.post<unknown>(
        `${root}/task/openapi/outputs`,
        { apiKey, taskId: taskId.trim() },
        { headers: { "Content-Type": "application/json" } },
    );
    const payload = parseRunningHubPayload(response.data);
    const code = payload?.code;
    const message = String(payload?.msg || payload?.message || "");
    if (code === 0 || code === "0") return { status: "success", urls: collectRunningHubUrls(payload?.data ?? payload) };
    if (code === 813 || code === "813" || /queued|queue|排队/i.test(message)) return { status: "queued", urls: [] };
    if (code === 804 || code === "804" || /running|processing|运行/i.test(message)) return { status: "running", urls: [] };
    const failedReason = payload?.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>).failedReason : undefined;
    const reason = failedReason && typeof failedReason === "object" ? (failedReason as Record<string, unknown>).exception_message || (failedReason as Record<string, unknown>).message : undefined;
    return { status: "failed", urls: [], error: String(reason || message || "RunningHub 任务失败") };
}

function parseRunningHubPayload(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
        } catch {
            return null;
        }
    }
    return null;
}

function collectRunningHubUrls(value: unknown, output: string[] = []): string[] {
    if (typeof value === "string") {
        const text = value.trim();
        if (/^https?:\/\//i.test(text)) output.push(text);
        else if (/^[\[{]/.test(text)) {
            try {
                collectRunningHubUrls(JSON.parse(text), output);
            } catch {
                // Some RunningHub responses contain non-JSON status strings.
            }
        }
    }
    else if (Array.isArray(value)) value.forEach((item) => collectRunningHubUrls(item, output));
    else if (value && typeof value === "object") Object.values(value).forEach((item) => collectRunningHubUrls(item, output));
    return Array.from(new Set(output));
}
