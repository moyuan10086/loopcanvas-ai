import express, { type NextFunction, type Request, type Response } from "express";
import { request as requestUpstream } from "undici";

import { canvasProjectsRevision, DEFAULT_PORT, ensureSiteWorkspace, listCanvasFiles, loadAiConfig, loadApiUsage, loadCanvasProjects, loadConfig, readCanvasFile, saveAiConfig, saveApiUsage, saveCanvasFile, saveCanvasProjects, saveConfig, updateSiteWorkspace, type CanvasAgentConfig } from "./config.js";
import { CanvasSession } from "./canvas-session.js";
import { archiveCodexThread, interruptCodexTurn, listCodexModels, listCodexThreads, readCodexThread, resolveCodexApproval, resumeCodexThread, runClaudeTurn, runCodexTurn, startCodexThread, summarizeCodexThread, verifyCodexThreadWorkspace, withAgentPrompt } from "./agents.js";
import type { AgentAttachment, AgentPermissionMode, AgentReasoningEffort } from "./types.js";
import { scrapeModelPrices } from "./model-pricing.js";

export function startHttpServer() {
    const config = loadConfig(true);
    const port = Number(process.env.PORT) || Number(new URL(config.url).port) || DEFAULT_PORT;
    config.url = `http://127.0.0.1:${port}`;
    saveConfig(config);

    const session = new CanvasSession();
    const emit = (type: string, payload: unknown) => session.emitAll(type, payload);
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "30mb" }));
    app.use((req, res, next) => {
        const url = requestUrl(req, config);
        if (!setCors(req, res, url, config)) return void res.status(403).json({ ok: false, error: "origin not allowed" });
        if (req.method === "OPTIONS") return void res.json({});
        next();
    });
    app.get("/health", (_req, res) => res.json(session.health()));
    app.get("/config", (req, res) => {
        const origin = req.headers.origin;
        const trustedOrigin = typeof origin === "string" && Boolean(config.origins?.includes(origin));
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Vary", "Origin");
        res.json({ ok: true, url: config.url, hasToken: true, ...(trustedOrigin ? { token: config.token } : {}) });
    });
    app.use((req, res, next) => {
        if (validToken(req, requestUrl(req, config), config.token)) return next();
        res.status(401).json({ ok: false, error: "invalid token" });
    });
    app.get("/api/config", (_req, res) => res.json({ ok: true, config: loadAiConfig() }));
    app.put("/api/config", (req, res) => {
        if (!validAiConfig(req.body?.config)) return void res.status(400).json({ ok: false, error: "invalid config" });
        saveAiConfig(req.body.config);
        res.json({ ok: true });
    });
    app.get("/api/channel-proxy/capabilities", (_req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.json({ ok: true, imagesEdits: true });
    });
    app.post("/api/channel-proxy/images/edits", express.raw({ type: () => true, limit: "100mb" }), route(async (req, res) => {
        if (!Buffer.isBuffer(req.body)) return void res.status(400).json({ ok: false, error: "图片编辑请求体无效" });
        const contentType = String(req.headers["content-type"] || "");
        if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
            return void res.status(415).json({ ok: false, error: "图片编辑代理仅接受 multipart/form-data" });
        }

        const channelId = String(req.query.channelId || "").trim();
        const channel = configuredChannel(channelId);
        if (!channel) return void res.status(404).json({ ok: false, error: "未找到所选模型渠道，请刷新配置后重试" });
        if (channel.apiFormat !== "openai") return void res.status(400).json({ ok: false, error: "所选渠道不是 OpenAI 兼容格式" });
        if (!channel.apiKey) return void res.status(400).json({ ok: false, error: "所选渠道没有配置 API Key" });

        const targetUrl = channelApiUrl(channel.baseUrl, "/images/edits");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new Error("upstream timeout")), IMAGE_EDIT_PROXY_TIMEOUT_MS);
        const abortWhenClientLeaves = () => {
            if (!res.writableEnded) controller.abort(new Error("client disconnected"));
        };
        res.once("close", abortWhenClientLeaves);
        try {
            const upstream = await requestUpstream(targetUrl, {
                method: "POST",
                headers: {
                    accept: String(req.headers.accept || "application/json"),
                    authorization: `Bearer ${channel.apiKey}`,
                    "content-type": contentType,
                    "user-agent": "Infinite-Canvas-Agent/0.2",
                },
                body: req.body,
                signal: controller.signal,
                maxRedirections: 0,
                headersTimeout: IMAGE_EDIT_PROXY_TIMEOUT_MS,
                bodyTimeout: IMAGE_EDIT_PROXY_TIMEOUT_MS,
            });
            const declaredBytes = Number(firstHeader(upstream.headers["content-length"]) || 0);
            if (declaredBytes > IMAGE_EDIT_PROXY_RESPONSE_LIMIT_BYTES) {
                upstream.body.destroy();
                return void res.status(502).json({ ok: false, error: "上游图片响应超过 100 MB 限制" });
            }
            const body = Buffer.from(await upstream.body.arrayBuffer());
            if (body.byteLength > IMAGE_EDIT_PROXY_RESPONSE_LIMIT_BYTES) {
                return void res.status(502).json({ ok: false, error: "上游图片响应超过 100 MB 限制" });
            }
            res.status(upstream.statusCode);
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("x-canvas-channel-proxy", "images-edits");
            const responseType = firstHeader(upstream.headers["content-type"]);
            const responseEncoding = firstHeader(upstream.headers["content-encoding"]);
            const requestId = firstHeader(upstream.headers["x-request-id"]);
            if (responseType) res.setHeader("Content-Type", responseType);
            if (responseEncoding) res.setHeader("Content-Encoding", responseEncoding);
            if (requestId) res.setHeader("x-upstream-request-id", requestId);
            res.send(body);
        } catch (error) {
            if (!res.headersSent && !res.destroyed) {
                res.status(502).json({ ok: false, error: upstreamNetworkError(error) });
            }
        } finally {
            clearTimeout(timeout);
            res.off("close", abortWhenClientLeaves);
        }
    }));
    app.get("/api/canvas-projects", (_req, res) => {
        const projects = loadCanvasProjects();
        res.json({ ok: true, projects, revision: canvasProjectsRevision(projects) });
    });
    app.put("/api/canvas-projects", (req, res) => {
        if (!validCanvasProjects(req.body?.projects)) return void res.status(400).json({ ok: false, error: "invalid canvas projects" });
        const current = loadCanvasProjects();
        const revision = canvasProjectsRevision(current);
        if (req.body?.revision !== revision) return void res.status(409).json({ ok: false, error: "canvas projects changed", projects: current, revision });
        saveCanvasProjects(req.body.projects);
        res.json({ ok: true, revision: canvasProjectsRevision(req.body.projects) });
    });
    app.get("/api/canvas-files", (_req, res) => res.json({ ok: true, files: listCanvasFiles() }));
    app.get("/api/canvas-files/:storageKey", (req, res) => {
        try {
            const file = readCanvasFile(validStorageKey(routeParam(req.params.storageKey)));
            res.type(file.mimeType).send(file.data);
        } catch {
            res.status(404).json({ ok: false, error: "canvas file not found" });
        }
    });
    app.put("/api/canvas-files/:storageKey", express.raw({ type: "application/octet-stream", limit: "1gb" }), (req, res) => {
        try {
            const storageKey = validStorageKey(routeParam(req.params.storageKey));
            if (!Buffer.isBuffer(req.body)) return void res.status(400).json({ ok: false, error: "invalid canvas file" });
            saveCanvasFile(storageKey, req.body, String(req.headers["x-canvas-file-type"] || "application/octet-stream"));
            res.json({ ok: true });
        } catch (error) {
            res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "invalid canvas file" });
        }
    });
    app.post("/api/canvas-files/fetch", route(async (req, res) => {
        const storageKey = validStorageKey(String(req.body?.storageKey || ""));
        const sourceUrl = validRemoteFileUrl(String(req.body?.url || ""));
        const response = await fetch(sourceUrl, { redirect: "error", signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error(`remote file HTTP ${response.status}`);
        const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() || "application/octet-stream";
        if (!mimeType.startsWith("image/")) throw new Error("remote file is not an image");
        const length = Number(response.headers.get("content-length") || 0);
        if (length > 50 * 1024 * 1024) throw new Error("remote image is larger than 50 MB");
        const data = Buffer.from(await response.arrayBuffer());
        if (data.byteLength > 50 * 1024 * 1024) throw new Error("remote image is larger than 50 MB");
        saveCanvasFile(storageKey, data, mimeType);
        res.json({ ok: true, storageKey, mimeType, bytes: data.byteLength });
    }));
    app.get("/api/api-usage", (_req, res) => res.json({ ok: true, logs: loadApiUsage() }));
    app.put("/api/api-usage", (req, res) => {
        if (!Array.isArray(req.body?.logs)) return void res.status(400).json({ ok: false, error: "invalid api usage logs" });
        saveApiUsage(req.body.logs.slice(0, 2000));
        res.json({ ok: true });
    });
    app.post("/api/api-usage", (req, res) => {
        const incoming: unknown[] = Array.isArray(req.body?.logs) ? req.body.logs : [req.body?.log];
        const validLogs = incoming.filter(validApiUsageLog);
        if (validLogs.length !== incoming.length) return void res.status(400).json({ ok: false, error: "invalid api usage log" });
        const merged = new Map<string, unknown>();
        loadApiUsage().forEach((log) => {
            if (log && typeof log === "object" && typeof (log as { id?: unknown }).id === "string") merged.set((log as { id: string }).id, log);
        });
        validLogs.forEach((log) => merged.set(log.id, log));
        const logs = [...merged.values()]
            .sort((left, right) => Number((right as { startedAt?: unknown }).startedAt) - Number((left as { startedAt?: unknown }).startedAt))
            .slice(0, 2000);
        saveApiUsage(logs);
        res.json({ ok: true });
    });
    app.post("/api/model-prices/sync", route(async (req, res) => {
        const sourceUrl = String(req.body?.sourceUrl || "");
        const models = Array.isArray(req.body?.models) ? req.body.models.map(String) : [];
        const exchangeRate = Number(req.body?.exchangeRate);
        const proxyUrl = String(req.body?.proxyUrl || "");
        res.json({ ok: true, prices: await scrapeModelPrices(sourceUrl, models, exchangeRate, proxyUrl) });
    }));
    app.get("/events", (req, res) => session.openEvents(requestUrl(req, config), res));
    app.post("/canvas/state", (req, res) => {
        session.updateState(req.body, String(req.query.clientId || "") || undefined);
        res.json({ ok: true });
    });
    app.post("/canvas/result", (req, res) => {
        session.resolveResult(req.body);
        res.json({ ok: true });
    });
    app.post("/api/tools", route(async (req, res) => res.json({ ok: true, result: await session.callTool(req.body?.name, req.body?.input || {}) })));
    app.get("/agent/codex/workspace", (_req, res) => {
        const workspace = ensureSiteWorkspace(config);
        res.json({ ok: true, workspace });
    });
    app.get("/agent/codex/models", route(async (_req, res) => {
        const result = await listCodexModels(emit);
        res.json({ ok: true, result });
    }));
    app.post("/agent/codex/approval", (req, res) => {
        const requestId = String(req.body?.requestId || "");
        const decision = codexApprovalDecision(req.body?.decision);
        if (!requestId || !decision) return void res.status(400).json({ ok: false, error: "invalid approval" });
        if (!resolveCodexApproval(requestId, decision)) return void res.status(404).json({ ok: false, error: "approval not found" });
        res.json({ ok: true });
    });
    app.get("/agent/codex/threads", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const result = await listCodexThreads(emit, { cwd: workspace.workspacePath, searchTerm: String(req.query.searchTerm || "") });
        res.json({ ok: true, workspace, ...result });
    }));
    app.post("/agent/codex/threads/new", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const thread = await startCodexThread(emit, workspace.workspacePath, agentPermissionMode(req.body?.permissionMode));
        const activeThreadId = String((thread as Record<string, unknown>).id || "");
        updateSiteWorkspace(config, { activeThreadId });
        res.json({ ok: true, workspace: { ...workspace, activeThreadId }, thread: summarizeCodexThread(thread), messages: [] });
    }));
    app.get("/agent/codex/threads/:threadId", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const threadId = routeParam(req.params.threadId);
        res.json({ ok: true, workspace, ...(await readCodexThread(emit, threadId, workspace.workspacePath)) });
    }));
    app.post("/agent/codex/threads/:threadId/resume", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const threadId = routeParam(req.params.threadId);
        const result = await resumeCodexThread(emit, threadId, workspace.workspacePath, agentPermissionMode(req.body?.permissionMode));
        updateSiteWorkspace(config, { activeThreadId: threadId });
        res.json({ ok: true, workspace: { ...workspace, activeThreadId: threadId }, ...result });
    }));
    app.post("/agent/codex/threads/:threadId/delete", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const threadId = routeParam(req.params.threadId);
        await archiveCodexThread(emit, threadId, workspace.workspacePath);
        if (workspace.activeThreadId === threadId) updateSiteWorkspace(config, { activeThreadId: undefined });
        res.json({ ok: true });
    }));
    app.post("/agent/codex/turn", route(async (req, res) => {
        const attachments = Array.isArray(req.body?.attachments) ? (req.body.attachments as AgentAttachment[]) : [];
        const permissionMode = agentPermissionMode(req.body?.permissionMode);
        const model = String(req.body?.model || "").trim();
        const effort = agentReasoningEffort(req.body?.effort);
        const workspace = ensureSiteWorkspace(config);
        let threadId = String(req.body?.threadId || workspace.activeThreadId || "");
        if (!threadId) {
            const thread = await startCodexThread(emit, workspace.workspacePath, permissionMode);
            threadId = String((thread as Record<string, unknown>).id || "");
            updateSiteWorkspace(config, { activeThreadId: threadId });
        } else if (threadId !== workspace.activeThreadId) {
            await verifyCodexThreadWorkspace(emit, threadId, workspace.workspacePath);
            updateSiteWorkspace(config, { activeThreadId: threadId });
        }
        void runCodexTurn(withAgentPrompt(String(req.body?.prompt || "")), emit, attachments, { threadId, cwd: workspace.workspacePath, permissionMode, ...(model ? { model } : {}), ...(effort ? { effort } : {}) });
        res.json({ ok: true, threadId });
    }));
    app.post("/agent/codex/interrupt", route(async (_req, res) => {
        const ok = await interruptCodexTurn();
        res.json({ ok });
    }));
    app.post("/agent/claude/turn", (req, res) => {
        runClaudeTurn(withAgentPrompt(String(req.body?.prompt || "")), emit);
        res.json({ ok: true });
    });
    app.use((_req, res) => res.status(404).json({ ok: false, error: "not found" }));
    app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ ok: false, error: error.message }));

    app.listen(port, "127.0.0.1", () => {
        console.log("Infinite Canvas Agent");
        console.log(`Local URL: ${config.url}`);
        console.log(`Connect token: ${config.token}`);
        console.log("Codex MCP is not installed by this command.");
        console.log("Optional MCP add: codex mcp add infinite-canvas -- npx -y @basketikun/canvas-agent mcp");
        console.log("Remove manually added MCP: codex mcp remove infinite-canvas");
    });
}

function route(handler: (req: Request, res: Response) => Promise<unknown>) {
    return (req: Request, res: Response, next: NextFunction) => void handler(req, res).catch(next);
}

function routeParam(value: string | string[]) {
    return Array.isArray(value) ? value[0] || "" : value;
}

function agentPermissionMode(value: unknown): AgentPermissionMode {
    return value === "automatic" || value === "full" ? value : "request";
}

function agentReasoningEffort(value: unknown): AgentReasoningEffort | undefined {
    return value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max" || value === "ultra" ? value : undefined;
}

function codexApprovalDecision(value: unknown) {
    return value === "accept" || value === "acceptForSession" || value === "decline" ? value : undefined;
}

function requestUrl(req: Request, config: CanvasAgentConfig) {
    return new URL(req.originalUrl || req.url || "/", config.url);
}

function setCors(req: Request, res: Response, url: URL, config: CanvasAgentConfig) {
    const origin = req.headers.origin;
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type,x-canvas-agent-token,x-canvas-file-type");
    res.setHeader("Access-Control-Expose-Headers", "x-canvas-channel-proxy,x-upstream-request-id");
    // The web app persists its provider configuration with PUT. Include it in
    // the preflight response or browsers will reject the save before it reaches
    // the token-protected route.
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    if (!origin || req.method === "OPTIONS" || url.pathname === "/health" || url.pathname === "/config") return true;
    config.origins ||= [];
    if (validToken(req, url, config.token) && !config.origins.includes(origin)) {
        config.origins.push(origin);
        saveConfig(config);
    }
    res.setHeader("Vary", "Origin");
    return config.origins.includes(origin);
}

function validCanvasProjects(value: unknown): value is unknown[] {
    return (
        Array.isArray(value) &&
        value.every(
            (project) =>
                project &&
                typeof project === "object" &&
                typeof (project as { id?: unknown }).id === "string" &&
                typeof (project as { title?: unknown }).title === "string" &&
                Array.isArray((project as { nodes?: unknown }).nodes) &&
                Array.isArray((project as { connections?: unknown }).connections),
        )
    );
}

function validApiUsageLog(value: unknown): value is { id: string; startedAt?: unknown } {
    return Boolean(value) && typeof value === "object" && typeof (value as { id?: unknown }).id === "string";
}

function validAiConfig(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const config = value as Record<string, unknown>;
    if (!Array.isArray(config.channels)) return false;
    return config.channels.every((channel) => {
        if (!channel || typeof channel !== "object" || Array.isArray(channel)) return false;
        const item = channel as Record<string, unknown>;
        if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.baseUrl !== "string" || typeof item.apiKey !== "string") return false;
        if (!Array.isArray(item.models)) return false;
        return item.models.every((model) => {
            if (typeof model === "string") return true;
            if (!model || typeof model !== "object" || Array.isArray(model)) return false;
            return typeof (model as Record<string, unknown>).name === "string";
        });
    });
}

const IMAGE_EDIT_PROXY_TIMEOUT_MS = 300000;
const IMAGE_EDIT_PROXY_RESPONSE_LIMIT_BYTES = 100 * 1024 * 1024;

type ProxyChannel = {
    id: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: string;
};

function configuredChannel(channelId: string): ProxyChannel | null {
    if (!channelId) return null;
    const config = loadAiConfig();
    if (!config || typeof config !== "object" || !Array.isArray((config as { channels?: unknown }).channels)) return null;
    const channel = (config as { channels: unknown[] }).channels.find((item) => {
        return Boolean(item) && typeof item === "object" && String((item as { id?: unknown }).id || "") === channelId;
    });
    if (!channel || typeof channel !== "object") return null;
    const value = channel as Record<string, unknown>;
    if (typeof value.baseUrl !== "string" || typeof value.apiKey !== "string") return null;
    return {
        id: channelId,
        baseUrl: value.baseUrl,
        apiKey: value.apiKey,
        apiFormat: String(value.apiFormat || "openai"),
    };
}

function channelApiUrl(baseUrl: string, path: "/images/edits") {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    const url = new URL(normalized);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("渠道 Base URL 无效");
    url.search = "";
    url.hash = "";
    const pathname = url.pathname.replace(/\/+$/, "");
    const lowerPath = pathname.toLowerCase();
    const apiBasePath = lowerPath.endsWith("/v1") || lowerPath.endsWith("/api/v3") || lowerPath.endsWith("/api/plan/v3") ? pathname : `${pathname}/v1`;
    url.pathname = `${apiBasePath}${path}`.replace(/\/{2,}/g, "/");
    return url.toString();
}

function firstHeader(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] || "" : value || "";
}

function upstreamNetworkError(error: unknown) {
    const value = error as { name?: unknown; message?: unknown; code?: unknown; cause?: { code?: unknown; message?: unknown } };
    const code = String(value.cause?.code || value.code || "").trim();
    const message = String(value.cause?.message || value.message || "").trim();
    if (value.name === "AbortError" || /timeout/i.test(message)) {
        return "上游图片编辑请求超时（300 秒），请求可能仍在渠道侧处理中，请先查消费记录再决定是否重试";
    }
    const detail = [code, message].filter(Boolean).join(" · ").slice(0, 240);
    return detail ? `本地 Agent 连接上游失败：${detail}` : "本地 Agent 连接上游失败";
}

function validStorageKey(value: string) {
    if (!/^(image|video|audio|file):[A-Za-z0-9_-]{1,200}$/.test(value)) throw new Error("invalid storage key");
    return value;
}

function validRemoteFileUrl(value: string) {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error("invalid remote file URL");
    }
    if (url.protocol !== "https:") throw new Error("remote file must use HTTPS");
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (url.username || url.password || /^(?:localhost|127\.|0\.0\.0\.0|169\.254\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.|::1$|fc|fd|fe80:)/i.test(hostname)) throw new Error("remote file host is not allowed");
    return url.toString();
}

function validToken(req: Request, url: URL, token: string) {
    const header = req.headers["x-canvas-agent-token"];
    return url.searchParams.get("token") === token || header === token || (Array.isArray(header) && header.includes(token));
}
