import axios from "axios";

import { audioMimeType, isMiniMaxMusicModel, isMiniMaxSpeechModel, normalizeAudioFormatForModel, normalizeAudioSpeedForModel, normalizeAudioVoiceForModel } from "@/lib/audio-generation";
import { trackApiUsage } from "@/services/api-usage";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { buildApiUrl, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";

type RequestOptions = { signal?: AbortSignal };
type MiniMaxAudioResponse = {
    data?: { audio?: string; status?: number } | null;
    base_resp?: { status_code?: number; status_msg?: string } | null;
};

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
    };
}

export function requestAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<Blob> {
    const selectedModel = config.model || config.audioModel;
    const model = resolveModelRequestConfig(config, selectedModel).model;
    const music = isMiniMaxMusicModel(model);
    const speech = isMiniMaxSpeechModel(model);
    return trackApiUsage(
        {
            config,
            model: selectedModel,
            kind: "audio",
            operation: music ? "音乐生成" : "语音合成",
            endpoint: music ? "/music_generation" : speech ? "/t2a_v2" : "/audio/speech",
            input: `${prompt.length} 字`,
        },
        () => requestAudioGenerationRequest(config, prompt, options),
        (blob) => formatByteSummary(blob.size),
    );
}

async function requestAudioGenerationRequest(config: AiConfig, prompt: string, options?: RequestOptions): Promise<Blob> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.audioModel);
    const model = requestConfig.model.trim();
    const format = normalizeAudioFormatForModel(model, config.audioFormat);
    const script = resolveModelScript(config, config.model || config.audioModel);
    if (script) {
        if (!model) throw new Error("请先配置音频模型");
        if (!requestConfig.baseUrl.trim()) throw new Error("请先配置 Base URL");
        if (!requestConfig.apiKey.trim()) throw new Error("请先配置 API Key");
        try {
            const result = await runModelPlugin({
                capability: "audio",
                script,
                config: requestConfig,
                prompt,
                params: { voice: normalizeAudioVoiceForModel(model, config.audioVoice), format, speed: normalizeAudioSpeedForModel(model, config.audioSpeed), instructions: config.audioInstructions.trim() },
                signal: options?.signal,
            });
            return await audioPluginBlob(result, format);
        } catch (error) {
            throw new Error(readAxiosError(error, "音频生成失败"));
        }
    }
    assertAudioConfig(requestConfig, model);

    try {
        if (isMiniMaxMusicModel(model)) return requestMiniMaxMusic(requestConfig, prompt, options);
        if (isMiniMaxSpeechModel(model)) return requestMiniMaxSpeech(requestConfig, prompt, options);
        return requestOpenAIAudio(requestConfig, prompt, options);
    } catch (error) {
        throw new Error(readAxiosError(error, "音频生成失败"));
    }
}

async function audioPluginBlob(result: unknown, format: string): Promise<Blob> {
    if (result instanceof Blob) return result.type.startsWith("audio/") ? result : new Blob([result], { type: audioMimeType(format) });
    let source = "";
    if (typeof result === "string") source = result;
    else if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        source = typeof record.b64_json === "string" ? record.b64_json : typeof record.data === "string" ? record.data : typeof record.url === "string" ? record.url : "";
    }
    if (!source) throw new Error("模型调用脚本没有返回音频");
    const url = source.startsWith("data:") || /^https?:/i.test(source) ? source : `data:${audioMimeType(format)};base64,${source}`;
    const blob = await (await fetch(url)).blob();
    return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
}

function formatByteSummary(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function requestOpenAIAudio(config: AiConfig, prompt: string, options?: RequestOptions) {
    const format = normalizeAudioFormatForModel(config.model, config.audioFormat);
    const instructions = config.audioInstructions.trim();
    const response = await axios.post<Blob>(
        aiApiUrl(config, "/audio/speech"),
        {
            model: config.model,
            input: prompt,
            voice: normalizeAudioVoiceForModel(config.model, config.audioVoice),
            response_format: format,
            speed: Number(normalizeAudioSpeedForModel(config.model, config.audioSpeed)),
            ...(instructions ? { instructions } : {}),
        },
        { headers: aiHeaders(config), responseType: "blob", signal: options?.signal },
    );
    await assertAudioBlob(response.data);
    return response.data.type.startsWith("audio/") ? response.data : new Blob([response.data], { type: audioMimeType(format) });
}

async function requestMiniMaxSpeech(config: AiConfig, prompt: string, options?: RequestOptions) {
    if (!prompt.trim()) throw new Error("请输入要合成的文本");
    if (prompt.length >= 10000) throw new Error("MiniMax 同步语音合成文本需要少于 10000 个字符");
    const format = normalizeAudioFormatForModel(config.model, config.audioFormat);
    const response = await axios.post<MiniMaxAudioResponse>(
        aiApiUrl(config, "/t2a_v2"),
        {
            model: config.model,
            text: prompt,
            stream: false,
            voice_setting: {
                voice_id: normalizeAudioVoiceForModel(config.model, config.audioVoice),
                speed: Number(normalizeAudioSpeedForModel(config.model, config.audioSpeed)),
                vol: 1,
                pitch: 0,
            },
            audio_setting: { sample_rate: 32000, bitrate: 128000, format, channel: 1 },
            output_format: "hex",
            subtitle_enable: false,
        },
        { headers: aiHeaders(config), signal: options?.signal },
    );
    return miniMaxAudioBlob(response.data, format, "MiniMax 语音接口没有返回音频");
}

async function requestMiniMaxMusic(config: AiConfig, prompt: string, options?: RequestOptions) {
    const format = normalizeAudioFormatForModel(config.model, config.audioFormat);
    const lyrics = config.audioMusicLyrics.trim();
    const instrumental = config.audioMusicInstrumental === "true";
    if (!prompt.trim()) throw new Error("请输入音乐风格、情绪或场景描述");
    if (prompt.length > 2000) throw new Error("MiniMax 音乐描述不能超过 2000 个字符");
    if (lyrics.length > 3500) throw new Error("MiniMax 歌词不能超过 3500 个字符");
    const response = await axios.post<MiniMaxAudioResponse>(
        aiApiUrl(config, "/music_generation"),
        {
            model: config.model,
            prompt,
            stream: false,
            output_format: "hex",
            audio_setting: { sample_rate: 44100, bitrate: 256000, format },
            is_instrumental: instrumental,
            ...(instrumental ? {} : lyrics ? { lyrics } : { lyrics_optimizer: true }),
        },
        { headers: aiHeaders(config), signal: options?.signal },
    );
    return miniMaxAudioBlob(response.data, format, "MiniMax 音乐接口没有返回音频");
}

function miniMaxAudioBlob(payload: MiniMaxAudioResponse, format: string, fallback: string) {
    const code = payload.base_resp?.status_code;
    if (typeof code === "number" && code !== 0) throw new Error(payload.base_resp?.status_msg || `${fallback}（${code}）`);
    const audio = payload.data?.audio?.trim();
    if (!audio) throw new Error(payload.base_resp?.status_msg || fallback);
    if (!/^[\da-f]+$/i.test(audio) || audio.length % 2 !== 0) throw new Error("MiniMax 返回的音频数据格式不正确");
    const bytes = new Uint8Array(audio.length / 2);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(audio.slice(index * 2, index * 2 + 2), 16);
    return new Blob([bytes], { type: audioMimeType(format) });
}

export async function storeGeneratedAudio(blob: Blob, format = "mp3"): Promise<UploadedFile> {
    const audio = blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    return uploadMediaFile(audio, "audio");
}

function assertAudioConfig(config: AiConfig, model: string) {
    if (!model) throw new Error("请先配置音频模型");
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    if (config.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持音频生成，请使用 OpenAI 格式渠道");
}

async function assertAudioBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "音频生成失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return `服务返回了 HTML 错误页面（${value.slice(0, 80)}...）`;
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    const errorMsg =
        typeof payload.error === "string"
            ? payload.error
            : (payload.error as { message?: unknown })?.message;
    return (
        readApiErrorMessage(payload.msg) ||
        readApiErrorMessage(payload.message) ||
        readApiErrorMessage(errorMsg) ||
        readApiErrorMessage(payload.detail) ||
        ""
    );
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; code?: number; base_resp?: { status_code?: number; status_msg?: string } }>(error)) {
        const responseData = error.response?.data;
        return responseData?.base_resp?.status_msg || responseData?.msg || responseData?.error?.message || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    if (status === 404) return "接口地址不存在（404），请检查 Base URL 和模型选择";
    if (status === 502) return "网关错误（502），接口服务暂时不可用，请稍后重试";
    if (status === 503) return "服务繁忙（503），请稍后重试";
    return status ? `请求失败（HTTP ${status}），请检查 Base URL 和 API Key 是否正确` : fallback;
}
