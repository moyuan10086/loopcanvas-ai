import axios from "axios";

import { buildApiUrl, modelOptionName, resolveModelChannel, resolveModelRequestConfig, resolveModelScript, type AiConfig, type ModelChannel } from "@/stores/use-config-store";
import { normalizePluginImages, runModelPlugin } from "./model-plugin";
import { nanoid } from "nanoid";
import { dataUrlToFile } from "@/lib/image-utils";
import { buildImageReferencePromptText } from "@/lib/image-reference-prompt";
import { trackApiUsage } from "@/services/api-usage";
import { backendConnection } from "@/services/config-sync";
import { imageToDataUrl } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

type ResponseToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    thoughtSignature?: string;
};

type ResponseInputMessage =
    | AiTextMessage
    | { type: "function_call"; call_id: string; name: string; arguments: string; thoughtSignature?: string }
    | { role: "tool"; tool_call_id: string; content: string };

type ResponseFunctionTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
    };
};

type ToolResponseResult = {
    content: string;
    toolCalls: ResponseToolCall[];
};

type ToolChoice = "auto" | "required" | { type: "function"; name: string };
type ResponseMessageContent = AiTextMessage["content"] | string;
type ResponseInputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
type ResponseInputItem =
    | { role: "system" | "user" | "assistant"; content: string | ResponseInputContent[] }
    | { type: "function_call"; call_id: string; name: string; arguments: string }
    | { type: "function_call_output"; call_id: string; output: string };
type ResponseApiToolDefinition = {
    type: "function";
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
};
type ResponseApiOutputItem =
    | { type?: "message"; content?: Array<{ type?: string; text?: string }> }
    | { type?: "function_call"; id?: string; call_id?: string; name?: string; arguments?: string };
type ResponseApiPayload = {
    id?: string;
    output?: ResponseApiOutputItem[];
    output_text?: string;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type ResponseStreamState = { buffer: string; text: string; payload?: ResponseApiPayload; error?: string };

type ImageApiResponse = {
    data?: Array<Record<string, unknown>>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
type FalImageResponse = {
    images?: Array<{ url?: string }>;
    detail?: string | Array<{ msg?: string }>;
};
type GeminiPart = {
    text?: string;
    inlineData?: { mimeType?: string; data?: string };
    inline_data?: { mime_type?: string; mimeType?: string; data?: string };
    fileData?: { mimeType?: string; fileUri?: string };
    functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
    functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
    thoughtSignature?: string;
    thought_signature?: string;
};
type GeminiContent = { role?: "user" | "model"; parts: GeminiPart[] };
type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    models?: Array<{ name?: string }>;
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
};
type GeminiStreamState = { buffer: string; text: string; toolCalls: ResponseToolCall[]; error?: string };
type RequestOptions = { signal?: AbortSignal; usageOperation?: string; onTask?: (task: { taskId: string; workflowId?: string; useWallet?: boolean }) => void };
export type ImageAngleEditParams = { rotation: number; tilt: number; zoom: number; wideAngle: boolean };
export type ImageSuperResolutionParams = { targetLongEdge: number; width: number; height: number; useWallet?: boolean };

const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 2880,
    standard: 1024,
    hd: 2048,
};
const QUALITY_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const IMAGE_OUTPUT_FORMAT = "png";
const IMAGE_EDIT_TIMEOUT_MS = 180000;
const IMAGE_EDIT_PROXY_TIMEOUT_MS = 310000;

const GEMINI_SUPPORTED_RATIOS = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];
const GEMINI_IMAGE_SIZE_BY_QUALITY: Record<string, string> = { low: "1K", medium: "2K", high: "4K", standard: "1K", hd: "2K" };

function normalizeQuality(quality: string) {
    const value = quality.trim().toLowerCase();
    const normalized = QUALITY_ALIASES[value] || value;
    return QUALITY_BASE[normalized] ? normalized : undefined;
}

/** Only "transparent" is forwarded; any other value (incl. empty) means keep the default opaque background. */
function normalizeBackground(background: string | undefined) {
    return background?.trim().toLowerCase() === "transparent" ? "transparent" : undefined;
}

/** Map "quality + ratio" to an explicit pixel dimension like "3840x2160". */
function resolveSize(quality: string | undefined, ratio: string): string {
    const parsedRatio = parseImageRatio(ratio);
    const basePixels = quality ? QUALITY_BASE[quality] : undefined;
    const isLandscape = parsedRatio.width >= parsedRatio.height;
    const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
    let longSide: number;
    let shortSide: number;

    if (basePixels) {
        const targetPixels = basePixels * basePixels;
        const longSideRaw = Math.sqrt(targetPixels * longRatio);
        longSide = Math.floor(longSideRaw / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
        shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    } else {
        shortSide = DEFAULT_IMAGE_SHORT_SIDE;
        longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    }

    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    validateImageSize(width, height);
    return `${width}x${height}`;
}

function parseRatioValue(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error("图像比例必须是正数，例如 9:16");
    return { width: w, height: h };
}

function parseImageRatio(value: string) {
    const ratio = parseRatioValue(value);
    if (Math.max(ratio.width, ratio.height) / Math.min(ratio.width, ratio.height) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    return ratio;
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function validateImageSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("图像尺寸必须是正整数，例如 1024x1024");
    if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) throw new Error("图像尺寸的宽高必须是 16 的倍数，请调整尺寸");
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw new Error("图像尺寸最长边不能超过 3840px，请调整尺寸");
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw new Error("图像总像素需在 655360 到 8294400 之间，请调整尺寸");
}

function resolveRequestSize(quality: string | undefined, size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateImageSize(dimensions.width, dimensions.height);
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (value.includes(":")) return resolveSize(quality, value);
    throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
}

function resolveGeminiImageConfig(config: AiConfig) {
    const value = config.size.trim();
    const dimensions = parseImageDimensions(value);
    const ratio = dimensions ? `${dimensions.width}:${dimensions.height}` : value;
    const aspectRatio = value && value.toLowerCase() !== "auto" ? closestGeminiAspectRatio(ratio) : undefined;
    const imageSize = supportsGeminiImageSize(config.model) ? resolveGeminiImageSize(config.quality, dimensions) : undefined;
    const image = { ...(aspectRatio ? { aspectRatio } : {}), ...(imageSize ? { imageSize } : {}) };
    return Object.keys(image).length ? { responseFormat: { image } } : {};
}

function closestGeminiAspectRatio(value: string) {
    const ratio = parseImageRatio(value);
    const target = ratio.width / ratio.height;
    return GEMINI_SUPPORTED_RATIOS.reduce((best, item) => {
        const current = parseRatioValue(item);
        const bestRatio = parseRatioValue(best);
        return Math.abs(current.width / current.height - target) < Math.abs(bestRatio.width / bestRatio.height - target) ? item : best;
    });
}

function resolveGeminiImageSize(quality: string, dimensions: { width: number; height: number } | null) {
    const normalizedQuality = normalizeQuality(quality);
    if (normalizedQuality) return GEMINI_IMAGE_SIZE_BY_QUALITY[normalizedQuality];
    if (!dimensions) return undefined;
    const edge = Math.max(dimensions.width, dimensions.height);
    if (edge <= 768) return "512";
    if (edge <= 1536) return "1K";
    if (edge <= 3072) return "2K";
    return "4K";
}

function supportsGeminiImageSize(model: string) {
    const value = model.toLowerCase();
    return value.includes("gemini-3") || value.includes("3.1") || value.includes("3-pro");
}

function resolveImageDataUrl(item: Record<string, unknown>) {
    if (typeof item.b64_json === "string" && item.b64_json) {
        return `data:image/png;base64,${item.b64_json}`;
    }
    if (typeof item.url === "string" && item.url) {
        return item.url;
    }
    return null;
}

function parseImagePayload(payload: ImageApiResponse) {
    if (typeof payload.code === "number" && payload.code !== 0) {
        throw new Error(payload.msg || "请求失败");
    }
    // 支持 data / images / results 三种返回字段（兼容不同 API）
    const imageList = payload.data
        || (payload as Record<string, unknown>).images as Array<Record<string, unknown>> | undefined
        || (payload as Record<string, unknown>).results as Array<Record<string, unknown>> | undefined
        || [];
    const images =
        imageList
            .map(resolveImageDataUrl)
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl }));

    if (images.length === 0) {
        // 尝试检查是否有返回了但格式不被识别的数据
        const rawKeys = Object.keys(payload).filter((k) => k !== "code" && k !== "msg" && k !== "error");
        throw new Error(rawKeys.length > 0
            ? `接口返回了未知格式的数据（字段：${rawKeys.join("、")}），请检查模型或接口兼容性`
            : "接口没有返回图片，请检查提示词是否触发安全审核或模型是否支持该操作");
    }

    return images;
}

function falModelUrl(config: Pick<AiConfig, "baseUrl" | "model">) {
    const baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const model = config.model.trim().replace(/^\/+/, "");
    return baseUrl.endsWith(`/${model}`) ? baseUrl : `${baseUrl}/${model}`;
}

async function requestFalEdit(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, options?: RequestOptions) {
    const imageUrls = await Promise.all(references.map(async (image) => imageToDataUrl(image)));
    const response = await axios.post<FalImageResponse>(
        falModelUrl(config),
        {
            prompt: withSystemPrompt(config, prompt),
            image_urls: imageUrls,
            num_images: Math.min(4, count),
            output_format: IMAGE_OUTPUT_FORMAT,
            sync_mode: true,
            acceleration: "regular",
        },
        { headers: { Authorization: `Key ${config.apiKey}`, "Content-Type": "application/json" }, signal: options?.signal },
    );
    const images = (response.data.images || []).flatMap((image) => (image.url ? [{ id: nanoid(), dataUrl: image.url }] : []));
    if (!images.length) throw new Error("Fal 接口没有返回图片");
    return images;
}

async function requestApimartImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, edit: boolean, options?: RequestOptions) {
    const apiConfig = { ...config, baseUrl: config.baseUrl.replace(/^(https?:\/\/)(?:www[.])?apimart[.]ai(?=\/|$)/i, "$1api.apimart.ai") };
    const imageUrls = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const gptImage2 = isApimartGptImage(apiConfig);
    const response = await axios.post<unknown>(
        aiApiUrl(apiConfig, gptImage2 ? "/images/generations" : edit ? "/images/edits" : "/images/generations"),
        {
            model: config.model,
            prompt: withSystemPrompt(config, prompt),
            n: count,
            ...(gptImage2
                ? {
                      ...(apimartAspectRatio(config.size) ? { size: apimartAspectRatio(config.size) } : {}),
                      ...(apimartResolution(config.quality) ? { resolution: apimartResolution(config.quality) } : {}),
                  }
                : apimartAspectRatio(config.size) ? { aspect_ratio: apimartAspectRatio(config.size) } : {}),
            ...(imageUrls.length ? { image_urls: imageUrls } : {}),
        },
        { headers: aiHeaders(apiConfig, "application/json"), signal: options?.signal },
    );
    const direct = apimartImageUrls(response.data);
    if (direct.length) return direct.map((dataUrl) => ({ id: nanoid(), dataUrl }));

    const taskId = apimartTaskId(response.data);
    if (!taskId) throw new Error(responseErrorMessage(response.data) || "APIMart 没有返回图片或任务 ID");
    for (let poll = 0; poll < 60; poll += 1) {
        await imagePollDelay(5000, options?.signal);
        const taskResponse = await axios.get<unknown>(aiApiUrl(apiConfig, `/tasks/${encodeURIComponent(taskId)}`), {
            headers: aiHeaders(apiConfig),
            params: { language: "zh" },
            signal: options?.signal,
        });
        const task = isRecord(taskResponse.data) && isRecord(taskResponse.data.data) ? taskResponse.data.data : taskResponse.data;
        const status = isRecord(task) ? stringValue(task.status).toLowerCase() : "";
        if (["completed", "succeed", "succeeded", "success"].includes(status)) {
            const urls = apimartImageUrls(taskResponse.data);
            if (!urls.length) throw new Error("APIMart 任务已完成，但没有返回图片");
            return urls.map((dataUrl) => ({ id: nanoid(), dataUrl }));
        }
        if (["failed", "cancelled", "canceled", "error"].includes(status)) {
            throw new Error(responseErrorMessage(task) || `APIMart 任务${status}`);
        }
    }
    throw new Error("APIMart 图片任务等待超时");
}

async function resolveToApisImageTask(config: AiConfig, initial: unknown, options?: RequestOptions) {
    const direct = apimartImageUrls(initial);
    if (direct.length) return direct.map((dataUrl) => ({ id: nanoid(), dataUrl }));
    const taskId = toApisImageTaskId(initial);
    if (!taskId) throw new Error(responseErrorMessage(initial) || "ToAPIs 没有返回图片或任务 ID");
    for (let poll = 0; poll < 60; poll += 1) {
        await imagePollDelay(5000, options?.signal);
        const response = await axios.get<unknown>(aiApiUrl(config, `/images/generations/${encodeURIComponent(taskId)}`), { headers: aiHeaders(config), signal: options?.signal });
        const urls = apimartImageUrls(response.data);
        if (urls.length) return urls.map((dataUrl) => ({ id: nanoid(), dataUrl }));
        const status = toApisImageStatus(response.data);
        if (["failed", "cancelled", "canceled", "error"].includes(status)) throw new Error(responseErrorMessage(response.data) || `ToAPIs 图片任务${status}`);
        if (["completed", "succeed", "succeeded", "success"].includes(status)) throw new Error("ToAPIs 图片任务已完成，但没有返回图片");
    }
    throw new Error("ToAPIs 图片任务等待超时");
}

function toApisImageTaskId(value: unknown): string {
    if (!isRecord(value)) return "";
    const id = value.id || value.task_id;
    if (typeof id === "string" || typeof id === "number") return String(id);
    return toApisImageTaskId(value.data);
}

function toApisImageStatus(value: unknown): string {
    if (!isRecord(value)) return "";
    const status = stringValue(value.status).toLowerCase();
    return status || toApisImageStatus(value.data);
}

function apimartTaskId(value: unknown): string {
    if (!isRecord(value)) return "";
    const direct = value.task_id || value.id;
    if (typeof direct === "string" || typeof direct === "number") return String(direct);
    if (Array.isArray(value.data)) return value.data.map(apimartTaskId).find(Boolean) || "";
    return apimartTaskId(value.data);
}

function apimartImageUrls(value: unknown): string[] {
    if (typeof value === "string") {
        const text = value.trim();
        if (/^(?:https?:|data:image\/)/i.test(text)) return [text];
        try {
            return apimartImageUrls(JSON.parse(text));
        } catch {
            return Array.from(text.matchAll(/https?:\/\/[^\s"'<>]+/gi), (match) => match[0]);
        }
    }
    if (Array.isArray(value)) return value.flatMap(apimartImageUrls);
    if (!isRecord(value)) return [];
    const direct = resolveImageDataUrl(value);
    if (direct) return [direct];
    return [value.url, value.result, value.result_url, value.images, value.data, value.output, value.response, value.task_result].flatMap(apimartImageUrls);
}

function apimartAspectRatio(size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return "";
    const dimensions = parseImageDimensions(value);
    if (!dimensions) return value.includes(":") ? value : "";
    const divisor = greatestCommonDivisor(dimensions.width, dimensions.height);
    return `${dimensions.width / divisor}:${dimensions.height / divisor}`;
}

function apimartResolution(quality: string) {
    const value = quality.trim().toLowerCase();
    if (["4k", "high"].includes(value)) return "4k";
    if (["2k", "medium", "hd"].includes(value)) return "2k";
    if (["1k", "low", "standard"].includes(value)) return "1k";
    return "";
}

function greatestCommonDivisor(a: number, b: number): number {
    return b ? greatestCommonDivisor(b, a % b) : a;
}

function imagePollDelay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
    });
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<unknown>(error)) {
        if (error.code === "ECONNABORTED") return "图片请求等待超时；渠道后台可能仍在生成并计费，请先查消费记录，不要立即重复提交";
        if (!error.response) {
            const code = error.code && error.code !== "ERR_NETWORK" ? `（${error.code}）` : "";
            return `${fallback}：请求过程中网络连接被中断${code}。渠道后台可能仍在生成并计费，请先查消费记录，不要立即重复提交`;
        }
        const responseData = error.response?.data;
        if (typeof responseData === "string" && responseData.trim()) return responseData.trim().slice(0, 300);
        return responseErrorMessage(responseData) || readStatusError(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function readStatusError(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    if (status === 404) return "接口地址不存在（404），请检查 Base URL 和模型选择";
    if (status === 502) return "网关错误（502），接口服务暂时不可用，请稍后重试";
    if (status === 503) return "服务繁忙（503），请稍后重试";
    return status ? `请求失败（HTTP ${status}），请检查 Base URL 和 API Key 是否正确` : fallback;
}

function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

async function requestOpenAiImageEdit(
    config: AiConfig,
    selectedModel: string,
    requestConfig: AiConfig,
    formData: FormData,
    options?: RequestOptions,
) {
    const directRequest = () =>
        axios.post<ImageApiResponse>(aiApiUrl(requestConfig, "/images/edits"), formData, {
            headers: aiHeaders(requestConfig),
            signal: options?.signal,
            timeout: IMAGE_EDIT_TIMEOUT_MS,
        });
    const connection = backendConnection();
    if (!connection) return directRequest();
    if (!(await supportsImageEditProxy(connection, options?.signal))) return directRequest();

    const channel = resolveModelChannel(config, selectedModel);
    return axios.post<ImageApiResponse>(`${connection.url}/api/channel-proxy/images/edits`, formData, {
        headers: { "x-canvas-agent-token": connection.token },
        params: { channelId: channel.id },
        signal: options?.signal,
        timeout: IMAGE_EDIT_PROXY_TIMEOUT_MS,
    });
}

async function supportsImageEditProxy(connection: NonNullable<ReturnType<typeof backendConnection>>, signal?: AbortSignal) {
    try {
        const response = await axios.get<{ ok?: boolean; imagesEdits?: boolean }>(`${connection.url}/api/channel-proxy/capabilities`, {
            headers: { "x-canvas-agent-token": connection.token },
            signal,
            timeout: 1500,
        });
        return response.data?.ok === true && response.data.imagesEdits === true;
    } catch (error) {
        if (signal?.aborted || axios.isCancel(error)) throw error;
        return false;
    }
}

function geminiBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

function geminiModelName(model: string) {
    return model.trim().replace(/^models\//, "");
}

function geminiApiUrl(config: Pick<AiConfig, "baseUrl" | "model">, action?: "generateContent" | "streamGenerateContent") {
    const baseUrl = geminiBaseUrl(config);
    if (!action) return `${baseUrl}/models`;
    return `${baseUrl}/models/${encodeURIComponent(geminiModelName(config.model))}:${action}`;
}

function geminiHeaders(config: Pick<AiConfig, "apiKey">) {
    return {
        "x-goog-api-key": config.apiKey,
        "Content-Type": "application/json",
    };
}

function withSystemMessage<T extends ResponseInputMessage>(config: AiConfig, messages: T[]): ResponseInputMessage[] {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

function toResponseInput(messages: ResponseInputMessage[]): ResponseInputItem[] {
    return messages.flatMap((message): ResponseInputItem[] => {
        if ("type" in message) return [message];
        if (message.role === "tool") return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }];
        return [{ role: message.role, content: toResponseContent(message.content || "") }];
    });
}

function toResponseContent(content: ResponseMessageContent): string | ResponseInputContent[] {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? { type: "input_text" as const, text: item.text } : { type: "input_image" as const, image_url: item.image_url.url }));
}

function toResponseTool(tool: ResponseFunctionTool): ResponseApiToolDefinition {
    return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: tool.function.strict,
    };
}

function parseToolResponse(payload: ResponseApiPayload): ToolResponseResult {
    const output = payload.output || [];
    const content =
        payload.output_text ||
        output
            .flatMap((item) => (item.type === "message" ? item.content || [] : []))
            .map((item) => item.text || "")
            .join("");
    const toolCalls = output
        .filter((item): item is Extract<ResponseApiOutputItem, { type?: "function_call" }> => item.type === "function_call")
        .map((item) => ({
            id: item.call_id || item.id || "",
            type: "function" as const,
            function: { name: item.name || "", arguments: item.arguments || "{}" },
        }))
        .filter((item) => item.id && item.function.name);
    return { content, toolCalls };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function responseErrorMessage(value: unknown) {
    if (!isRecord(value)) return "";
    const error = isRecord(value.error) ? value.error : undefined;
    const response = isRecord(value.response) ? value.response : undefined;
    const responseError = response && isRecord(response.error) ? response.error : undefined;
    const message = stringValue(value.msg) || stringValue(value.message) || stringValue(value.error) || stringValue(error?.message) || stringValue(responseError?.message);
    const code = stringValue(error?.code) || stringValue(responseError?.code);
    return message && code ? `${message}（${code}）` : message;
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

function validateResponsePayload(payload: ResponseApiPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "请求失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function validateGeminiPayload(payload: GeminiPayload) {
    if (payload.error?.message) throw new Error(payload.error.message);
    if (payload.promptFeedback?.blockReason) throw new Error(`Gemini 拒绝了本次请求：${payload.promptFeedback.blockReason}`);
}

async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return readStatusError(response.status, fallback);
    try {
        return responseErrorMessage(JSON.parse(text)) || readStatusError(response.status, fallback);
    } catch {
        return text.slice(0, 300) || readStatusError(response.status, fallback);
    }
}

function consumeResponseStreamBlock(block: string, state: ResponseStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as Record<string, unknown>;
    const type = stringValue(event.type);
    const errorMessage = responseErrorMessage(event);
    if (errorMessage) state.error = errorMessage;
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
        state.text += event.delta;
        onDelta?.(state.text);
    }
    if (type === "response.output_text.done" && !state.text && typeof event.text === "string") {
        state.text = event.text;
        onDelta?.(state.text);
    }
    if (type === "response.completed" && isRecord(event.response)) {
        state.payload = event.response as ResponseApiPayload;
    } else if (Array.isArray(event.output)) {
        state.payload = event as ResponseApiPayload;
    }
}

function consumeResponseStreamText(state: ResponseStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeResponseStreamBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeResponseStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

async function requestStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(aiApiUrl(config, "/responses"), {
        method: "POST",
        headers: { ...aiHeaders(config, "application/json"), Accept: "text/event-stream" },
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as ResponseApiPayload;
        validateResponsePayload(payload);
        return parseToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ResponseStreamState = { buffer: "", text: "" };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeResponseStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeResponseStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    if (!state.payload) return { content: state.text, toolCalls: [] };
    validateResponsePayload(state.payload);
    const result = parseToolResponse(state.payload);
    return { ...result, content: state.text || result.content };
}

function toGeminiBody(config: AiConfig, messages: ResponseInputMessage[], extra?: Record<string, unknown>) {
    const systemText = [
        config.systemPrompt.trim(),
        ...messages.flatMap((message) => (!("type" in message) && message.role === "system" ? [geminiTextContent(message.content)] : [])),
    ]
        .filter(Boolean)
        .join("\n\n");
    const contents = toGeminiContents(messages.filter((message) => ("type" in message ? true : message.role !== "system")));
    return {
        contents,
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        ...extra,
    };
}

function toGeminiContents(messages: ResponseInputMessage[]): GeminiContent[] {
    const callNameById = new Map<string, string>();
    return messages.flatMap((message): GeminiContent[] => {
        if ("type" in message) {
            callNameById.set(message.call_id, message.name);
            return [{ role: "model", parts: [{ functionCall: { id: message.call_id, name: message.name, args: jsonObject(message.arguments) }, ...(message.thoughtSignature ? { thoughtSignature: message.thoughtSignature } : {}) }] }];
        }
        if (message.role === "tool") {
            const name = callNameById.get(message.tool_call_id) || "tool_result";
            return [{ role: "user", parts: [{ functionResponse: { id: message.tool_call_id, name, response: { result: jsonValue(message.content) } } }] }];
        }
        return [{ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) }];
    });
}

function toGeminiParts(content: ResponseMessageContent): GeminiPart[] {
    if (!Array.isArray(content)) return [{ text: String(content || "") }];
    return content.map((item) => (item.type === "text" ? { text: item.text } : toGeminiImagePart(item.image_url.url)));
}

function toGeminiImagePart(url: string): GeminiPart {
    const match = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url, mimeType: "image/png" } };
}

function geminiTextContent(content: ResponseMessageContent) {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? item.text : item.image_url.url)).join("\n");
}

function jsonObject(value: string): Record<string, unknown> {
    const parsed = jsonValue(value);
    return isRecord(parsed) ? parsed : {};
}

function jsonValue(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function toGeminiToolOptions(tools: ResponseFunctionTool[], toolChoice: ToolChoice) {
    if (!tools.length) return {};
    const functionDeclarations = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
    }));
    const functionCallingConfig =
        typeof toolChoice === "object"
            ? { mode: "ANY", allowedFunctionNames: [toolChoice.name] }
            : { mode: toolChoice === "required" ? "ANY" : "AUTO" };
    return {
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig },
    };
}

async function requestGeminiStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const response = await fetch(`${geminiApiUrl(config, "streamGenerateContent")}?alt=sse`, {
        method: "POST",
        headers: geminiHeaders(config),
        body: JSON.stringify(body),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as GeminiPayload;
        return parseGeminiToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: GeminiStreamState = { buffer: "", text: "", toolCalls: [] };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeGeminiStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeGeminiStreamText(state, decoder.decode(), onDelta, true);
    if (state.error) throw new Error(state.error);
    return { content: state.text, toolCalls: state.toolCalls };
}

function consumeGeminiStreamText(state: GeminiStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeGeminiStreamBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeGeminiStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

function consumeGeminiStreamBlock(block: string, state: GeminiStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const result = parseGeminiToolResponse(JSON.parse(data) as GeminiPayload);
    if (result.content) {
        state.text += result.content;
        onDelta?.(state.text);
    }
    state.toolCalls.push(...result.toolCalls);
}

function parseGeminiToolResponse(payload: GeminiPayload): ToolResponseResult {
    validateGeminiPayload(payload);
    const parts = payload.candidates?.flatMap((candidate) => candidate.content?.parts || []) || [];
    const content = parts.map((part) => part.text || "").join("");
    const toolCalls = parts
        .map((part) => part.functionCall)
        .filter((call): call is NonNullable<GeminiPart["functionCall"]> => Boolean(call?.name))
        .map((call) => {
            const part = parts.find((item) => item.functionCall === call);
            const thoughtSignature = part?.thoughtSignature || part?.thought_signature;
            return {
                id: call.id || nanoid(),
                type: "function" as const,
                function: { name: call.name || "", arguments: JSON.stringify(call.args || {}) },
                ...(thoughtSignature ? { thoughtSignature } : {}),
            };
        });
    return { content, toolCalls };
}

async function requestGeminiImages(config: AiConfig, prompt: string, references: ReferenceImage[], count: number, options?: RequestOptions) {
    const requests = Array.from({ length: count }, () => requestGeminiImagesOnce(config, prompt, references, options));
    return (await Promise.all(requests)).flat();
}

async function requestGeminiImagesOnce(config: AiConfig, prompt: string, references: ReferenceImage[], options?: RequestOptions) {
    const parts: GeminiPart[] = [{ text: prompt }];
    for (const image of references) {
        parts.push(toGeminiImagePart(await imageToDataUrl(image)));
    }
    const response = await axios.post<GeminiPayload>(
        geminiApiUrl(config, "generateContent"),
        {
            ...toGeminiBody(config, [{ role: "user", content: prompt }], { generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...resolveGeminiImageConfig(config) } }),
            contents: [{ role: "user", parts }],
        },
        { headers: geminiHeaders(config), signal: options?.signal },
    );
    return parseGeminiImagePayload(response.data);
}

function parseGeminiImagePayload(payload: GeminiPayload) {
    validateGeminiPayload(payload);
    const images =
        payload.candidates
            ?.flatMap((candidate) => candidate.content?.parts || [])
            .map((part) => {
                const inlineData = part.inlineData || (part.inline_data ? { mimeType: part.inline_data.mimeType || part.inline_data.mime_type, data: part.inline_data.data } : undefined);
                if (inlineData?.data) return `data:${inlineData.mimeType || "image/png"};base64,${inlineData.data}`;
                return part.fileData?.fileUri || null;
            })
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];
    if (!images.length) throw new Error("Gemini 接口没有返回图片");
    return images;
}

export function requestGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    const model = config.model || config.imageModel;
    return trackApiUsage(
        { config, model, kind: "image", operation: options?.usageOperation || "图片生成", endpoint: imageUsageEndpoint(config, model, "/images/generations"), input: `${prompt.length} 字` },
        () => requestGenerationRequest(config, prompt, options),
        (images) => `${images.length} 张图片`,
    );
}

async function requestGenerationRequest(config: AiConfig, prompt: string, options?: RequestOptions) {
    const selectedModel = config.model || config.imageModel;
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const runningHubParams = runningHubKeyParams(config, selectedModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const script = resolveModelScript(config, config.model || config.imageModel);
    if (script) {
        const quality = normalizeQuality(config.quality);
        const requestSize = resolveRequestSize(quality, config.size);
        const background = normalizeBackground(config.background);
        try {
            const result = await runModelPlugin({
                capability: "image",
                script,
                config: requestConfig,
                prompt: withSystemPrompt(requestConfig, prompt),
                images: [],
                params: { size: requestSize, quality, count: n, ...runningHubParams, ...(background ? { background } : {}) },
                signal: options?.signal,
            });
            return normalizePluginImages(result).map((dataUrl) => ({ id: nanoid(), dataUrl }));
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    if (requestConfig.apiFormat === "gemini") {
        try {
            return await requestGeminiImages(requestConfig, prompt, [], n, options);
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    if (requestConfig.apiFormat === "fal") throw new Error("Fal 的 Qwen 视角编辑模型需要一张参考图片");
    if (isApimartGrokImage(requestConfig) || isApimartGptImage(requestConfig)) {
        try {
            return await requestApimartImages(requestConfig, prompt, [], n, false, options);
        } catch (error) {
            throw new Error(readAxiosError(error, "APIMart 图片生成失败"));
        }
    }
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    const background = normalizeBackground(config.background);
    try {
        const response = await axios.post<ImageApiResponse>(
            aiApiUrl(requestConfig, "/images/generations"),
            {
                model: requestConfig.model,
                prompt: withSystemPrompt(requestConfig, prompt),
                n,
                ...(quality ? { quality } : {}),
                ...(requestSize && !isToApisImage(requestConfig) ? { size: requestSize } : {}),
                ...(background ? { background } : {}),
                ...(!isToApisImage(requestConfig) ? { response_format: "b64_json", output_format: IMAGE_OUTPUT_FORMAT } : {}),
            },
            {
                headers: aiHeaders(requestConfig, "application/json"),
                signal: options?.signal,
            },
        );
        if (isToApisImage(requestConfig)) return await resolveToApisImageTask(requestConfig, response.data, options);
        const images = parseImagePayload(response.data);
        return images;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export function requestEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions) {
    const model = config.model || config.imageModel;
    return trackApiUsage(
        {
            config,
            model,
            kind: "image",
            operation: options?.usageOperation || (mask ? "局部编辑" : "图片编辑"),
            endpoint: imageUsageEndpoint(config, model, "/images/edits"),
            input: `${prompt.length} 字 · ${references.length} 张参考图${mask ? " · 1 个蒙版" : ""}`,
        },
        () => requestEditRequest(config, prompt, references, mask, options),
        (images) => `${images.length} 张图片`,
    );
}

async function requestEditRequest(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions) {
    const selectedModel = config.model || config.imageModel;
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const runningHubParams = runningHubKeyParams(config, selectedModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const qwenImageEdit = isQwenImageEditModel(requestConfig.model);
    const requestPrompt = qwenImageEdit && references.length === 1 ? prompt.trim() : buildImageReferencePromptText(prompt, references);
    const script = resolveModelScript(config, config.model || config.imageModel);
    if (script) {
        const quality = normalizeQuality(config.quality);
        const requestSize = resolveRequestSize(quality, config.size);
        const background = normalizeBackground(config.background);
        const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
        try {
            const result = await runModelPlugin({
                capability: "image",
                script,
                config: requestConfig,
                prompt: withSystemPrompt(requestConfig, requestPrompt),
                images: refs,
                params: { size: requestSize, quality, count: n, ...runningHubParams, ...(background ? { background } : {}) },
                signal: options?.signal,
            });
            return normalizePluginImages(result).map((dataUrl) => ({ id: nanoid(), dataUrl }));
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    if (requestConfig.apiFormat === "fal") {
        if (mask) throw new Error("Fal Qwen 视角编辑暂不支持蒙版");
        try {
            return await requestFalEdit(requestConfig, prompt, references, n, options);
        } catch (error) {
            throw new Error(readAxiosError(error, "Fal 图片编辑失败"));
        }
    }
    if (isApimartGrokImage(requestConfig) || isApimartGptImage(requestConfig)) {
        try {
            return await requestApimartImages(requestConfig, requestPrompt, references, n, true, options);
        } catch (error) {
            throw new Error(readAxiosError(error, "APIMart 图片编辑失败"));
        }
    }
    if (requestConfig.apiFormat === "gemini") {
        if (mask) throw new Error("Gemini 调用格式暂不支持蒙版编辑");
        try {
            return await requestGeminiImages(requestConfig, requestPrompt, references, n, options);
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }

    if (requestConfig.apiFormat === "ark") {
        if (mask) throw new Error("蒙版编辑暂不支持该模型，请使用其他渠道");
        const quality = normalizeQuality(config.quality);
        const requestSize = resolveRequestSize(quality, config.size);
        const background = normalizeBackground(config.background);
        const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
        try {
            const response = await axios.post<ImageApiResponse>(
                aiApiUrl(requestConfig, "/images/generations"),
                {
                    model: requestConfig.model,
                    prompt: withSystemPrompt(requestConfig, requestPrompt),
                    n,
                    response_format: "b64_json",
                    output_format: IMAGE_OUTPUT_FORMAT,
                    image: refs,
                    ...(quality ? { quality } : {}),
                    ...(requestSize ? { size: requestSize } : {}),
                    ...(background ? { background } : {}),
                },
                {
                    headers: aiHeaders(requestConfig, "application/json"),
                    signal: options?.signal,
                },
            );
            return parseImagePayload(response.data);
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }

    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    const background = normalizeBackground(config.background);
    const formData = new FormData();
    formData.set("model", requestConfig.model);
    formData.set("prompt", withSystemPrompt(requestConfig, requestPrompt));
    if (!isToApisFluxImage(requestConfig)) formData.set("n", String(n));
    if (!isToApisImage(requestConfig)) formData.set("response_format", "b64_json");
    if (!qwenImageEdit && !isToApisImage(requestConfig)) formData.set("output_format", IMAGE_OUTPUT_FORMAT);
    if (quality) {
        formData.set("quality", quality);
    }
    if (requestSize) {
        formData.set("size", requestSize);
    }
    if (background) {
        formData.set("background", background);
    }
    const files = await Promise.all(references.map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => formData.append("image", file));
    if (mask) formData.set("mask", dataUrlToFile(mask));

    try {
        const response = await requestOpenAiImageEdit(config, selectedModel, requestConfig, formData, options);
        if (isToApisImage(requestConfig)) return await resolveToApisImageTask(requestConfig, response.data, options);
        const images = parseImagePayload(response.data);
        return images;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

export function requestAngleEdit(config: AiConfig, reference: ReferenceImage, params: ImageAngleEditParams, options?: RequestOptions) {
    return requestEdit({ ...config, count: "1", size: "auto", quality: "auto" }, buildQwenAngleEditPrompt(params), [reference], undefined, { ...options, usageOperation: "视角调整" });
}

export function requestImageSuperResolution(config: AiConfig, reference: ReferenceImage, params: ImageSuperResolutionParams, options?: RequestOptions) {
    const model = config.model || config.imageModel;
    return trackApiUsage(
        { config, model, kind: "image", operation: options?.usageOperation || "AI 超分", endpoint: "/task/openapi/create", input: `1 张参考图 · ${params.targetLongEdge}px` },
        async () => {
            const requestConfig = resolveModelRequestConfig(config, model);
            const script = resolveModelScript(config, model);
            if (!script) throw new Error("所选模型没有可执行的 RunningHub 工作流");
            try {
                const result = await runModelPlugin({
                    capability: "image",
                    script,
                    config: requestConfig,
                    prompt: "",
                    images: [await imageToDataUrl(reference)],
                    params: { size: `${params.width}x${params.height}`, targetLongEdge: params.targetLongEdge, quality: "high", count: 1, useWallet: Boolean(params.useWallet), walletApiKey: requestConfig.walletApiKey },
                    signal: options?.signal,
                    onTask: options?.onTask,
                });
                return normalizePluginImages(result).map((dataUrl) => ({ id: nanoid(), dataUrl }));
            } catch (error) {
                throw new Error(readAxiosError(error, "AI 超分失败"));
            }
        },
        (images) => `${images.length} 张图片`,
    );
}

function runningHubKeyParams(config: AiConfig, model: string) {
    const channel = resolveModelChannel(config, model);
    const walletApiKey = channel.walletApiKey?.trim() || "";
    const useWallet = channel.runningHubKeyMode === "wallet" || (channel.runningHubKeyMode !== "rh" && !channel.apiKey.trim() && Boolean(walletApiKey));
    return { useWallet, walletApiKey };
}

export function buildQwenAngleEditPrompt(params: ImageAngleEditParams) {
    const rotation = clampNumber(params.rotation, -180, 180);
    const tilt = clampNumber(params.tilt, -45, 45);
    const moveForward = Math.round(clampNumber(params.zoom, 0, 10) * 10) / 10;
    const view = horizontalAnglePrompt(rotation);
    const vertical = verticalAnglePrompt(tilt);
    const orbit = Math.abs(rotation) < 10 ? "Keep the camera in front of the scene." : `Orbit the camera to the ${rotation > 0 ? "right" : "left"} around the center of the entire scene until it reaches the requested ${view.name}.`;
    const distance = cameraDistancePrompt(moveForward);
    const lens = params.wideAngle ? "Use a natural wide-angle lens without fisheye distortion." : "Use a natural standard lens.";
    return `Re-render the entire input as a coherent 3D scene from a clearly different ${view.name}, ${vertical}. ${orbit} Rotate the camera around the whole scene, not only the person or foreground object. Viewpoint requirement: ${view.requirement} ${distance} ${lens} Keep the original aspect ratio and full composition. Preserve subject identity, body proportions, pose, clothing, colors, materials, props, lighting, and visual style as closely as geometrically possible. Infer and reconstruct newly visible surfaces and occluded background areas consistently. Do not crop, pan, mirror, rotate the original 2D pixels, apply a perspective warp, or return the original viewpoint.`;
}

function verticalAnglePrompt(tilt: number) {
    const angle = Math.abs(tilt);
    if (angle < 8) return "eye-level view";
    if (angle < 25) return tilt > 0 ? "moderately elevated view from above" : "moderately low-angle view from below";
    return tilt > 0 ? "strong high-angle view from above" : "strong low-angle view from below";
}

function cameraDistancePrompt(moveForward: number) {
    if (moveForward < 2) return "Keep the original camera distance, framing, and subject scale.";
    if (moveForward < 7) return "Use a moderately closer camera while keeping every main subject fully visible.";
    return "Use a close camera position without cropping any main subject or important scene element.";
}

function horizontalAnglePrompt(rotation: number) {
    const angle = Math.abs(rotation);
    const side = rotation > 0 ? "right" : "left";
    if (angle < 10) return { name: "front view", requirement: "Show the front-facing surfaces as in the source, without changing the composition." };
    if (angle < 75) return { name: `${side} front three-quarter view`, requirement: `Show both the front and ${side} sides of subjects and scene objects with clear three-dimensional parallax.` };
    if (angle <= 105) return { name: `${side} side profile view`, requirement: `The camera is located at the ${side} side; show side surfaces and strong side-on spatial parallax rather than a frontal image.` };
    if (angle < 170) return { name: `${side} rear three-quarter view`, requirement: `The camera is behind the scene on its ${side} side. Back and ${side} surfaces must dominate; front-facing faces, chests, and object fronts must not remain fully visible.` };
    return { name: "direct back view", requirement: "The camera is directly behind the scene. Show the backs of subjects and objects; front-facing faces and front surfaces must not be visible." };
}

export function qwenAngleViewLabel(rotation: number) {
    const normalized = clampNumber(rotation, -180, 180);
    const angle = Math.abs(normalized);
    const side = normalized > 0 ? "右" : "左";
    if (angle < 10) return "正面视角";
    if (angle < 75) return `${side}前侧 3/4 视角`;
    if (angle <= 105) return `${side}侧面视角`;
    if (angle < 170) return `${side}后侧 3/4 视角`;
    return "背面视角";
}

function isQwenImageEditModel(model: string) {
    return /(?:^|\/)qwen-image-edit-(?:max(?:-|$)|plus(?:-|$)|2511(?:-|$))/i.test(model);
}

function clampNumber(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

export function requestImageQuestion(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const model = config.model || config.textModel;
    return trackApiUsage(
        { config, model, kind: "text", operation: options?.usageOperation || "文本与视觉问答", endpoint: imageUsageEndpoint(config, model, "/responses"), input: textMessageInputSummary(messages) },
        () => requestImageQuestionRequest(config, messages, onDelta, options),
        (answer) => `${answer.length} 字`,
    );
}

async function requestImageQuestionRequest(config: AiConfig, messages: AiTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.textModel);
    const script = resolveModelScript(config, config.model || config.textModel);
    if (script) {
        try {
            const answer = await runModelPlugin<string>({
                capability: "text",
                script,
                config: requestConfig,
                messages: withSystemMessage(requestConfig, messages),
                signal: options?.signal,
                onDelta,
            });
            const text = String(answer ?? "").trim() || "没有返回内容";
            if (text === "没有返回内容") onDelta(text);
            return text;
        } catch (error) {
            throw new Error(readAxiosError(error, "请求失败"));
        }
    }
    try {
        if (requestConfig.apiFormat === "gemini") {
            const answer = (await requestGeminiStreamingResponse(requestConfig, toGeminiBody(requestConfig, messages), onDelta, options)).content || "没有返回内容";
            if (answer === "没有返回内容") onDelta(answer);
            return answer;
        }
        const answer = (await requestStreamingResponse(requestConfig, {
            model: requestConfig.model,
            input: toResponseInput(withSystemMessage(requestConfig, messages)),
            ...(requestConfig.reasoningEffort === "auto" ? {} : { reasoning: { effort: requestConfig.reasoningEffort } }),
        }, onDelta, options)).content || "没有返回内容";
        if (answer === "没有返回内容") onDelta(answer);
        return answer;
    } catch (error) {
        throw new Error(readAxiosError(error, "请求失败"));
    }
}

function imageUsageEndpoint(config: AiConfig, model: string, openAiPath: string) {
    const channel = resolveModelChannel(config, model);
    if (channel.apiFormat === "fal") return `/${modelOptionName(model)}`;
    if (channel.apiFormat === "gemini") return `/models/${modelOptionName(model)}:generateContent`;
    return openAiPath;
}

function isApimartGrokImage(config: Pick<AiConfig, "baseUrl" | "model">) {
    return /(?:^|[.])apimart[.]ai/i.test(config.baseUrl) && /^grok-imagine-1[.][05](?:-edit)?-apimart$/i.test(config.model);
}

function isApimartGptImage(config: Pick<AiConfig, "baseUrl" | "model">) {
    return /(?:^|[.])apimart[.]ai/i.test(config.baseUrl) && /^gpt-image-2(?:-ext)?$/i.test(config.model);
}

function isToApisFluxImage(config: Pick<AiConfig, "baseUrl" | "model">) {
    return /(?:^|[.])toapis[.]com/i.test(config.baseUrl) && /^flux-/i.test(config.model);
}

function isToApisImage(config: Pick<AiConfig, "baseUrl" | "model">) {
    return /(?:^|[.])toapis[.]com/i.test(config.baseUrl) && /^(?:gpt-image-2|flux-)/i.test(config.model);
}

function textMessageInputSummary(messages: AiTextMessage[]) {
    let characters = 0;
    let images = 0;
    messages.forEach((message) => {
        if (typeof message.content === "string") {
            characters += message.content.length;
            return;
        }
        message.content.forEach((item) => {
            if (item.type === "text") characters += item.text.length;
            else images += 1;
        });
    });
    return `${characters} 字${images ? ` · ${images} 张图片` : ""}`;
}

export async function fetchImageModels(config: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat">) {
    try {
        if (config.apiFormat === "fal") return ["fal-ai/qwen-image-edit-2511"];
        if (config.apiFormat === "gemini") {
            const response = await axios.get<GeminiPayload>(geminiApiUrl({ ...defaultGeminiConfig, ...config }), { headers: geminiHeaders({ ...defaultGeminiConfig, ...config }) });
            validateGeminiPayload(response.data);
            return (response.data.models || [])
                .map((model) => model.name?.replace(/^models\//, ""))
                .filter((id): id is string => Boolean(id))
                .sort((a, b) => a.localeCompare(b));
        }
        const response = await axios.get<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(buildApiUrl(config.baseUrl, "/models"), {
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
            },
        });
        return (response.data.data || [])
            .map((model) => model.id)
            .filter((id): id is string => Boolean(id))
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        throw new Error(readAxiosError(error, "读取模型失败"));
    }
}

export async function fetchChannelModels(channel: ModelChannel) {
    return fetchImageModels({ baseUrl: channel.baseUrl, apiKey: channel.apiKey, apiFormat: channel.apiFormat });
}

const defaultGeminiConfig: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat" | "model" | "systemPrompt"> = {
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "",
    apiFormat: "gemini",
    model: "",
    systemPrompt: "",
};
