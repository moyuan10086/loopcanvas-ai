import axios from "axios";
import { nanoid } from "nanoid";

import { dataUrlToFile } from "@/lib/image-utils";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { boolConfig, buildSeedancePromptText, isSeedanceVideoConfig, isToApisBaseUrl, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceVideoReferenceError, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { normalizeVideoFrameMode, videoFrameModeError, videoFramePreset } from "@/lib/video-frame-mode";
import { trackApiUsage } from "@/services/api-usage";
import { buildApiUrl, modelOptionName, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo, VideoFrameMode } from "@/types/media";

type VideoResponse = { id: string; status?: string; error?: { message?: string }; url?: string; result_url?: string; video_url?: string; content?: { video_url?: string; url?: string } | null };
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type SeedanceTask = {
    id: string;
    status?: "queued" | "running" | "succeeded" | "completed" | "failed" | "cancelled" | "expired";
    error?: { code?: string; message?: string } | null;
    content?: { video_url?: string; url?: string; last_frame_url?: string } | null;
    url?: string;
    result_url?: string;
    video_url?: string;
};
type ToApisTask = {
    id: string;
    status?: "queued" | "in_progress" | "completed" | "failed";
    error?: { code?: string; message?: string } | null;
    result?: { type?: string; data?: Array<{ url?: string; format?: string; last_frame_url?: string }> } | null;
};
type ToApisMediaUploadResponse = {
    success?: boolean;
    message?: string;
    data?: { id?: string; url?: string; mime_type?: string; size?: number } | null;
};
type KlingTask = {
    task_id: string;
    task_status?: string;
    task_status_msg?: string;
    task_result?: { videos?: Array<{ id?: string; url?: string; duration?: string }> } | null;
};
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type RequestOptions = { signal?: AbortSignal };
type VideoProvider = "openai" | "seedance" | "toapis" | "kling" | "plugin";
type KlingTaskType = "text2video" | "image2video" | "omni-video";

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: VideoProvider; model: string; klingTaskType?: KlingTaskType };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

/** Results for scripted (plugin) video models, which run their own create+poll in one shot at task creation. */
const pluginVideoResults = new Map<string, VideoGenerationResult>();

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    const delayMs = task.provider === "toapis" ? 10000 : task.provider === "seedance" || task.provider === "kling" ? 5000 : 2500;
    if (task.provider === "toapis") await delay(5000, options?.signal);
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        if (attempt === 119) throw new Error("视频生成超时，请稍后重试");
        await delay(delayMs, options?.signal);
    }
    throw new Error("视频生成超时，请稍后重试");
}

export function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const provider: VideoProvider = resolveModelScript(config, selectedModel) ? "plugin" : videoProvider(requestConfig);
    const inputs = [`${prompt.length} 字`, references.length ? `${references.length} 张图片` : "", videoReferences.length ? `${videoReferences.length} 个视频` : "", audioReferences.length ? `${audioReferences.length} 段音频` : ""]
        .filter(Boolean)
        .join(" · ");
    return trackApiUsage(
        {
            config,
            model: selectedModel,
            kind: "video",
            operation: "视频任务创建",
            endpoint:
                provider === "toapis"
                    ? "/videos/generations"
                    : provider === "seedance"
                      ? "/contents/generations/tasks"
                      : provider === "kling"
                        ? `/kling/v1/videos/${isKlingOmniModel(selectedModel) ? "omni-video" : references.length ? "image2video" : "text2video"}`
                        : "/videos",
            input: inputs,
        },
        () => createVideoGenerationTaskRequest(config, prompt, references, videoReferences, audioReferences, options),
        (task) => `任务 ${task.id}`,
    );
}

async function createVideoGenerationTaskRequest(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const frameInput = resolveVideoFrameInput(requestConfig.videoFrameMode, references);
    const script = resolveModelScript(config, selectedModel);
    if (script) return createPluginVideoTask(requestConfig, selectedModel, script, prompt, frameInput.references, videoReferences, options);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (isToApisBaseUrl(requestConfig.baseUrl)) {
        return createToApisTask(requestConfig, selectedModel, prompt, frameInput.references, frameInput.mode, videoReferences, audioReferences, options);
    }
    if (isSeedanceVideoConfig(requestConfig)) {
        return createSeedanceTask(requestConfig, selectedModel, prompt, frameInput.references, frameInput.mode, videoReferences, audioReferences, options);
    }
    if (isKlingVideoConfig(requestConfig)) {
        return createKlingTask(requestConfig, selectedModel, prompt, frameInput.references, frameInput.mode, videoReferences, audioReferences, options);
    }
    if (videoReferences.length || audioReferences.length) {
        throw new Error("当前视频接口不支持参考视频或参考音频，请切换到 Seedance 2.0 / 火山 Agent Plan 模型，或移除参考资产");
    }
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, frameInput.references, frameInput.mode, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id);
        return result ? { status: "completed", result } : { status: "failed", error: "插件视频任务已失效，请重新生成" };
    }
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "toapis") return pollToApisTask(requestConfig, task, options);
    if (task.provider === "kling") return pollKlingTask(requestConfig, task, options);
    return task.provider === "seedance" ? pollSeedanceTask(requestConfig, task, options) : pollOpenAIVideoTask(requestConfig, task, options);
}

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            params: {
                seconds: normalizeVideoSeconds(config.videoSeconds),
                size: normalizeVideoSize(config.size),
                resolution: normalizeVideoResolution(config.vquality),
                ratio: config.size,
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
                videoUrls: videoReferences.map((video) => video.url).filter(Boolean),
            },
            signal: options?.signal,
        }),
    );
    const id = nanoid();
    pluginVideoResults.set(id, result);
    return { id, provider: "plugin", model };
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error("模型调用脚本没有返回视频");
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) {
        try {
            return await uploadMediaFile(result.url, "video");
        } catch {
            return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
        }
    }
    throw new Error("视频接口没有返回可播放的视频");
}

function videoProvider(config: AiConfig): VideoProvider {
    if (isToApisBaseUrl(config.baseUrl)) return "toapis";
    if (isSeedanceVideoConfig(config)) return "seedance";
    return isKlingVideoConfig(config) ? "kling" : "openai";
}

function isKlingVideoConfig(config: AiConfig) {
    return modelOptionName(config.model || config.videoModel)
        .toLowerCase()
        .includes("kling");
}

function isKlingOmniModel(model: string) {
    const normalized = modelOptionName(model).toLowerCase();
    return normalized.includes("kling-v3-omni") || normalized.includes("kling-video-v3-omni") || normalized.includes("kling-video-o1");
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], frameMode: VideoFrameMode, options?: RequestOptions): Promise<VideoGenerationTask> {
    const body = new FormData();
    body.append("model", modelOptionName(model));
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    if (normalizeVideoSize(config.size)) body.append("size", normalizeVideoSize(config.size)!);
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("preset", videoFramePreset(frameMode));
    const files = await Promise.all(references.slice(0, 7).map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => body.append("input_reference[]", file));
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config), signal: options?.signal })).data);
        if (!created.id) throw new Error("视频接口没有返回任务 ID");
        return { id: created.id, provider: "openai", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务创建失败"));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = videoResultUrl(video);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        if (video.status === "completed") {
            const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${task.id}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
            await assertVideoBlob(content.data);
            return { status: "completed", result: { blob: content.data } };
        }
        if (video.status === "failed" || video.status === "cancelled") return { status: "failed", error: readApiErrorMessage(video.error?.message) || "视频生成失败" };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务查询失败"));
    }
}

async function createKlingTask(
    config: AiConfig,
    model: string,
    prompt: string,
    references: ReferenceImage[],
    frameMode: VideoFrameMode,
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    if (isKlingOmniModel(model)) {
        return createKlingOmniTask(config, model, prompt, references, frameMode, videoReferences, audioReferences, options);
    }
    if (videoReferences.length || audioReferences.length) {
        throw new Error("可灵官方格式暂不支持当前画布的参考视频或参考音频，请移除后重试");
    }
    const taskType: KlingTaskType = references.length ? "image2video" : "text2video";
    const image = references[0] ? await resolveKlingImage(references[0]) : "";
    const imageTail = frameMode === "first-last-frame" && references[1] ? await resolveKlingImage(references[1]) : "";
    const payload = {
        model_name: modelOptionName(model),
        prompt,
        mode: "std",
        duration: normalizeKlingDuration(config.videoSeconds),
        ...(image ? { image } : {}),
        ...(imageTail ? { image_tail: imageTail } : {}),
    };
    try {
        const created = unwrapKlingTask((await axios.post<ApiEnvelope<KlingTask>>(klingCreateUrl(config, taskType), payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        if (!created.task_id) throw new Error("可灵接口没有返回任务 ID");
        return { id: created.task_id, provider: "kling", model, klingTaskType: taskType };
    } catch (error) {
        throw new Error(readAxiosError(error, "可灵视频任务创建失败"));
    }
}

async function createKlingOmniTask(
    config: AiConfig,
    model: string,
    prompt: string,
    references: ReferenceImage[],
    frameMode: VideoFrameMode,
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    if (videoReferences.length || audioReferences.length) {
        throw new Error("当前可灵 Omni 画布接入暂不支持参考视频或参考音频，请先移除后重试");
    }
    const imageList = await Promise.all(
        references.slice(0, 7).map(async (image, index) => ({
            image_url: await resolveKlingImage(image),
            ...(frameMode === "first-frame" && index === 0
                ? { type: "first_frame" as const }
                : frameMode === "first-last-frame" && index === 0
                  ? { type: "first_frame" as const }
                  : frameMode === "first-last-frame" && index === 1
                    ? { type: "end_frame" as const }
                    : {}),
        })),
    );
    const payload = {
        // The marketplace alias includes "video", while Kling's official V3 name does not.
        model_name: "kling-v3-omni",
        prompt,
        mode: "pro",
        duration: normalizeKlingDuration(config.videoSeconds),
        aspect_ratio: normalizeKlingAspectRatio(config.size),
        ...(imageList.length ? { image_list: imageList } : {}),
    };
    try {
        const created = unwrapKlingTask((await axios.post<ApiEnvelope<KlingTask>>(klingCreateUrl(config, "omni-video"), payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        if (!created.task_id) throw new Error("可灵 Omni 接口没有返回任务 ID");
        return { id: created.task_id, provider: "kling", model, klingTaskType: "omni-video" };
    } catch (error) {
        if (isInvalidKlingV3ModelError(error)) {
            throw new Error("Apilio 当前渠道未开通或未正确配置可灵 V3 Omni（商品页计费表仅到 V2.1），请切换到支持 V3 Omni 的渠道，或改用已开通的可灵模型");
        }
        throw new Error(readAxiosError(error, "可灵 Omni 视频任务创建失败"));
    }
}

function isInvalidKlingV3ModelError(error: unknown) {
    if (!axios.isAxiosError(error)) return false;
    const message = readApiErrorMessage(error.response?.data).toLowerCase();
    return error.response?.status === 400 && message.includes("model_name") && message.includes("invalid");
}

async function pollKlingTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapKlingTask((await axios.get<ApiEnvelope<KlingTask>>(klingQueryUrl(config, task.klingTaskType || "image2video", task.id), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = state.task_result?.videos?.find((video) => isPublicMediaUrl(video.url || ""))?.url;
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        const status = (state.task_status || "").toLowerCase();
        if (["succeed", "succeeded", "success", "completed"].includes(status)) return { status: "failed", error: "可灵任务成功但没有返回视频 URL" };
        if (["failed", "fail", "cancelled", "canceled"].includes(status)) return { status: "failed", error: readApiErrorMessage(state.task_status_msg) || "可灵视频生成失败" };
        return { status: "pending" };
    } catch (error) {
        if (isRetryableVideoPollError(error)) return { status: "pending" };
        throw new Error(readAxiosError(error, "可灵视频任务查询失败"));
    }
}

async function createToApisTask(
    config: AiConfig,
    model: string,
    prompt: string,
    references: ReferenceImage[],
    frameMode: VideoFrameMode,
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    const modelName = modelOptionName(model);
    const kling = isKlingModel(modelName);
    const klingOmni = isToApisKlingOmniModel(modelName);
    const klingTurbo = isToApisKlingTurboModel(modelName);
    if (frameMode !== "reference" && (videoReferences.length || audioReferences.length)) {
        throw new Error("ToAPIs 首帧/首尾帧模式不能同时使用参考视频或参考音频，请切换为全能参考模式或移除其他素材");
    }
    if (audioReferences.length && !references.length && !videoReferences.length) {
        throw new Error("ToAPIs 参考音频不能单独使用，请同时添加参考图或参考视频");
    }
    if (kling && (videoReferences.length || audioReferences.length)) {
        throw new Error("ToAPIs Kling 当前画布接入仅支持参考图片；参考视频或音频请切换到 Kling Omni 专用接口或 Seedance 2.0");
    }
    assertSeedanceVideoReferences(videoReferences);
    assertSeedanceAudioReferences(audioReferences);
    const imageUrls = await Promise.all(
        references.slice(0, SEEDANCE_REFERENCE_LIMITS.images).map(async (image, index) => ({
            url: await resolveToApisImageUrl(config, image, options),
            index,
        })),
    );
    const imageWithRoles = imageUrls.map(({ url, index }) => ({ url, role: videoFrameRole(frameMode, index) }));
    const videoWithRoles = await Promise.all(videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos).map(async (video) => ({ url: await resolveToApisVideoUrl(config, video, options), role: "reference_video" as const })));
    const audioWithRoles = await Promise.all(audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios).map(async (audio) => ({ url: await resolveSeedanceAudioUrl(audio), role: "reference_audio" as const })));
    const payload = kling
        ? {
              model: modelName,
              prompt: klingOmni ? ensureKlingOmniImagePlaceholders(prompt, imageUrls.length) : prompt,
              duration: normalizeToApisKlingDuration(config.videoSeconds),
              aspect_ratio: normalizeSeedanceRatio(config.size),
              ...(klingTurbo
                  ? { resolution: normalizeToApisKlingResolution(config.vquality), watermark: boolConfig(config.videoWatermark, false) }
                  : { mode: normalizeToApisKlingMode(config.vquality), audio: boolConfig(config.videoGenerateAudio, true) }),
              ...(klingOmni
                  ? imageUrls.length
                      ? {
                            metadata: {
                                image_list: imageUrls.map(({ url, index }) => ({
                                    image_url: url,
                                    ...toApisKlingOmniImageType(frameMode, index),
                                })),
                            },
                        }
                      : {}
                  : klingTurbo
                    ? imageUrls.length
                        ? { reference_images: [imageUrls[0].url] }
                        : {}
                    : frameMode === "reference"
                      ? imageUrls.length
                          ? { reference_images: imageUrls.map(({ url }) => url) }
                          : {}
                      : imageWithRoles.length
                        ? { image_with_roles: imageWithRoles }
                        : {}),
          }
        : {
              model: modelName,
              prompt,
              duration: normalizeSeedanceDuration(config.videoSeconds, modelName),
              aspect_ratio: normalizeSeedanceRatio(config.size),
              resolution: normalizeSeedanceResolution(config.vquality, modelName),
              generate_audio: boolConfig(config.videoGenerateAudio, true),
              ...(imageWithRoles.length ? { image_with_roles: imageWithRoles } : {}),
              ...(videoWithRoles.length ? { video_with_roles: videoWithRoles } : {}),
              ...(audioWithRoles.length ? { audio_with_roles: audioWithRoles } : {}),
          };

    try {
        const created = (await axios.post<ToApisTask>(toApisVideoUrl(config), payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data;
        if (!created.id) throw new Error(readApiErrorMessage(created) || "ToAPIs 接口没有返回任务 ID");
        return { id: created.id, provider: "toapis", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "ToAPIs Seedance 任务创建失败"));
    }
}

async function pollToApisTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = (await axios.get<ToApisTask>(toApisVideoUrl(config, task.id), { headers: aiHeaders(config), signal: options?.signal })).data;
        const url = videoResultUrl(state);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        if (state.status === "completed") return { status: "failed", error: "ToAPIs 任务成功但没有返回视频 URL" };
        if (state.status === "failed") return { status: "failed", error: readApiErrorMessage(state.error) || "ToAPIs Seedance 视频生成失败" };
        return { status: "pending" };
    } catch (error) {
        if (isRetryableToApisPollError(error)) return { status: "pending" };
        throw new Error(readAxiosError(error, "ToAPIs Seedance 任务查询失败"));
    }
}

function isRetryableToApisPollError(error: unknown) {
    return isRetryableVideoPollError(error);
}

function isRetryableVideoPollError(error: unknown) {
    if (!axios.isAxiosError(error)) return false;
    const status = error.response?.status;
    if (!status) return true;
    return status === 404 || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function createSeedanceTask(
    config: AiConfig,
    model: string,
    prompt: string,
    references: ReferenceImage[],
    frameMode: VideoFrameMode,
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    if (audioReferences.length && !references.length && !videoReferences.length) {
        throw new Error("Seedance 参考音频不能单独使用，请同时添加参考图或参考视频");
    }
    assertSeedanceVideoReferences(videoReferences);
    assertSeedanceAudioReferences(audioReferences);
    const content = await buildSeedanceContent(config, prompt, references, frameMode, videoReferences, audioReferences);
    if (!content.length) throw new Error("请输入视频提示词，或连接参考图片/视频/音频");
    const payload = {
        model: modelOptionName(model),
        content,
        ratio: normalizeSeedanceRatio(config.size),
        resolution: normalizeSeedanceResolution(config.vquality, modelOptionName(model)),
        duration: normalizeSeedanceDuration(config.videoSeconds, modelOptionName(model)),
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
    };

    try {
        const created = unwrapSeedanceTask((await axios.post<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config), payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        if (!created.id) throw new Error("Seedance 接口没有返回任务 ID");
        return { id: created.id, provider: "seedance", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务创建失败"));
    }
}

async function pollSeedanceTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapSeedanceTask((await axios.get<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config, task.id), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = videoResultUrl(state);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        if (state.status === "succeeded" || state.status === "completed") return { status: "failed", error: "Seedance 任务成功但没有返回视频 URL" };
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") return { status: "failed", error: readApiErrorMessage(state.error?.message) || `Seedance 视频生成${state.status === "expired" ? "超时" : "失败"}` };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务查询失败"));
    }
}

function assertSeedanceVideoReferences(videoReferences: ReferenceVideo[]) {
    const error = seedanceVideoReferenceError(videoReferences);
    if (error) throw new Error(error);
    let total = 0;
    for (const video of videoReferences) {
        if (!video.durationMs) continue;
        if (video.durationMs < 2000 || video.durationMs > 15000) throw new Error("Seedance 参考视频单个时长需要在 2-15 秒之间");
        total += video.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考视频总时长不能超过 15 秒");
}

function assertSeedanceAudioReferences(audioReferences: ReferenceAudio[]) {
    let total = 0;
    for (const audio of audioReferences) {
        if (!audio.durationMs) continue;
        if (audio.durationMs < 2000 || audio.durationMs > 15000) throw new Error("Seedance 参考音频单个时长需要在 2-15 秒之间");
        total += audio.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考音频总时长不能超过 15 秒");
}

function seedanceApiUrl(config: AiConfig, taskId?: string) {
    return buildApiUrl(config.baseUrl, `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}

function toApisVideoUrl(config: AiConfig, taskId?: string) {
    return buildApiUrl(config.baseUrl, `/videos/generations${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}

function klingCreateUrl(config: AiConfig, taskType: KlingTaskType) {
    return `${klingBaseUrl(config.baseUrl)}/v1/videos/${taskType}`;
}

function klingQueryUrl(config: AiConfig, taskType: KlingTaskType, taskId: string) {
    return `${klingBaseUrl(config.baseUrl)}/v1/videos/${taskType}/${encodeURIComponent(taskId)}`;
}

function klingBaseUrl(baseUrl: string) {
    const normalized = baseUrl
        .trim()
        .replace(/\/+$/, "")
        .replace(/\/kling\/v1$/i, "")
        .replace(/\/kling$/i, "")
        .replace(/\/v1$/i, "");
    return `${normalized}/kling`;
}

async function buildSeedanceContent(config: AiConfig, prompt: string, references: ReferenceImage[], frameMode: VideoFrameMode, videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    const content: Array<Record<string, unknown>> = [];
    const text = buildSeedancePromptText(prompt, references, videoReferences, audioReferences);
    if (text) content.push({ type: "text", text });
    for (const [index, image] of references.slice(0, SEEDANCE_REFERENCE_LIMITS.images).entries()) {
        const role = videoFrameRole(frameMode, index);
        content.push({ type: "image_url", image_url: { url: await resolveSeedanceImageUrl(config, image) }, role });
    }
    for (const video of videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos)) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceVideoUrl(video) }, role: "reference_video" });
    }
    for (const audio of audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveSeedanceAudioUrl(audio) }, role: "reference_audio" });
    }
    return content;
}

function videoFrameRole(frameMode: VideoFrameMode, index: number) {
    if (frameMode === "first-frame") return "first_frame" as const;
    if (frameMode === "first-last-frame") return index === 0 ? ("first_frame" as const) : ("last_frame" as const);
    return "reference_image" as const;
}

function resolveVideoFrameInput(value: unknown, references: ReferenceImage[]) {
    const mode = normalizeVideoFrameMode(value);
    const error = videoFrameModeError(mode, references.length);
    if (error) throw new Error(error);
    if (mode === "first-frame") {
        return { mode, references: references.slice(0, 1) };
    }
    if (mode === "first-last-frame") {
        return { mode, references: references.slice(0, 2) };
    }
    return { mode, references };
}

async function resolveSeedanceImageUrl(config: AiConfig, image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("asset://")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error("参考图读取失败，请换一张图片或重新上传");
    return dataUrl;
}

async function resolveKlingImage(image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl)) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error("可灵参考图读取失败，请换一张图片或重新上传");
    const base64 = dataUrl.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
    if (!base64 || base64 === dataUrl) throw new Error("可灵参考图需要公网 URL 或可读取的 Base64 图片");
    return base64;
}

async function resolveToApisImageUrl(config: AiConfig, image: ReferenceImage, options?: RequestOptions) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("asset://")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error("参考图读取失败，请换一张图片或重新上传");
    const file = await dataUrlToFile({ ...image, dataUrl });
    if (file.size > 10 * 1024 * 1024) throw new Error(`${image.name || "参考图"} 超过 ToAPIs 10MB 上传限制，请压缩后重试`);
    const body = new FormData();
    body.append("file", file);
    try {
        const uploaded = (await axios.post<ToApisMediaUploadResponse>(buildApiUrl(config.baseUrl, "/uploads/images"), body, { headers: aiHeaders(config), signal: options?.signal })).data;
        const url = uploaded.data?.url?.trim();
        if (!uploaded.success || !url) throw new Error(uploaded.message || "ToAPIs 图片上传接口没有返回 URL");
        return url;
    } catch (error) {
        throw new Error(readAxiosError(error, "ToAPIs 参考图上传失败"));
    }
}

async function resolveSeedanceVideoUrl(video: ReferenceVideo) {
    if (isPublicMediaUrl(video.url) || video.url.startsWith("asset://")) return video.url;
    let blob: Blob | null = null;
    if (video.storageKey) blob = await getMediaBlob(video.storageKey);
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    if (!blob) throw new Error("参考视频必须是公网 URL、资产 ID，或本地已保存的视频");
    return blobToDataUrl(blob);
}

async function resolveToApisVideoUrl(config: AiConfig, video: ReferenceVideo, options?: RequestOptions) {
    if (isPublicMediaUrl(video.url) || video.url.startsWith("asset://")) return video.url;
    let blob: Blob | null = null;
    if (video.storageKey) blob = await getMediaBlob(video.storageKey);
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    if (!blob) throw new Error("ToAPIs 参考视频读取失败，请重新上传或使用公网 URL / asset:// 素材");
    if (blob.size > SEEDANCE_REFERENCE_LIMITS.videoMaxBytes) throw new Error(`${video.name || "参考视频"} 超过 ToAPIs 50MB 上传限制，请压缩后重试`);
    const mimeType = blob.type || video.type || "video/mp4";
    if (!/^video\/(?:mp4|webm|quicktime)$/i.test(mimeType) && !/\.(?:mp4|webm|mov)$/i.test(video.name || "")) {
        throw new Error("ToAPIs 参考视频仅支持 MP4、WebM 或 MOV 格式");
    }
    const file = blob instanceof File ? blob : new File([blob], video.name || toApisVideoFilename(mimeType), { type: mimeType });
    const body = new FormData();
    body.append("file", file);
    body.append("purpose", "generation");
    try {
        const uploaded = (await axios.post<ToApisMediaUploadResponse>(buildApiUrl(config.baseUrl, "/uploads/videos"), body, { headers: aiHeaders(config), signal: options?.signal })).data;
        const url = uploaded.data?.url?.trim();
        if (!uploaded.success || !url) throw new Error(uploaded.message || "ToAPIs 视频上传接口没有返回 URL");
        return url;
    } catch (error) {
        throw new Error(readAxiosError(error, "ToAPIs 参考视频上传失败"));
    }
}

function toApisVideoFilename(mimeType: string) {
    if (mimeType.includes("webm")) return "reference.webm";
    if (mimeType.includes("quicktime")) return "reference.mov";
    return "reference.mp4";
}

async function resolveSeedanceAudioUrl(audio: ReferenceAudio) {
    if (isPublicMediaUrl(audio.url) || audio.url.startsWith("asset://")) return audio.url;
    let blob: Blob | null = null;
    if (audio.storageKey) blob = await getMediaBlob(audio.storageKey);
    if (!blob && audio.url?.startsWith("blob:")) blob = await (await fetch(audio.url)).blob();
    if (!blob) throw new Error("参考音频必须是公网 URL、资产 ID，或本地已保存的音频");
    return blobToDataUrl(blob);
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error("请先配置视频模型");
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!isAbsoluteHttpUrl(config.baseUrl)) throw new Error("视频渠道 Base URL 无效，请在配置中填写以 http:// 或 https:// 开头的完整地址");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    if (config.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持视频生成，请使用 OpenAI 格式渠道");
}

function isAbsoluteHttpUrl(value: string) {
    try {
        const url = new URL(value.trim());
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeKlingDuration(value: string) {
    const seconds = Number(value) || 5;
    return seconds <= 7 ? "5" : "10";
}

function normalizeToApisKlingResolution(value: string) {
    const resolution = normalizeVideoResolution(value);
    return resolution === "1080p" ? resolution : "720p";
}

function normalizeToApisKlingDuration(value: string) {
    const seconds = Math.floor(Number(value) || 5);
    return Math.max(3, Math.min(15, seconds));
}

function normalizeToApisKlingMode(value: string) {
    return normalizeToApisKlingResolution(value) === "1080p" ? "pro" : "std";
}

function isKlingModel(model: string) {
    return modelOptionName(model).toLowerCase().includes("kling");
}

function isToApisKlingTurboModel(model: string) {
    return modelOptionName(model).toLowerCase() === "kling-3.0-turbo";
}

function isToApisKlingOmniModel(model: string) {
    const normalized = modelOptionName(model).toLowerCase();
    return normalized === "kling-v3-omni" || normalized === "kling-video-v3-omni" || normalized === "kling-video-o1";
}

function toApisKlingOmniImageType(frameMode: VideoFrameMode, index: number) {
    if (frameMode === "first-frame" && index === 0) return { type: "first_frame" as const };
    if (frameMode === "first-last-frame" && index === 0) return { type: "first_frame" as const };
    if (frameMode === "first-last-frame" && index === 1) return { type: "end_frame" as const };
    return {};
}

function ensureKlingOmniImagePlaceholders(prompt: string, count: number) {
    if (!count) return prompt;
    const missing = Array.from({ length: count }, (_, index) => `<<<image_${index + 1}>>>`).filter((token) => !prompt.includes(token));
    return missing.length ? `${prompt.trim()}${prompt.trim() ? "\n" : ""}${missing.join(" ")}` : prompt;
}

function normalizeKlingAspectRatio(value: string) {
    if (["16:9", "9:16", "1:1"].includes(value)) return value;
    return ["2:3", "3:4"].includes(value) ? "9:16" : "16:9";
}

function normalizeVideoSize(value: string) {
    if (value === "auto") return null;
    const size = value || "1280x720";
    if (/^\d+x\d+$/.test(size)) return size;
    return ["9:16", "2:3", "3:4"].includes(size) ? "720x1280" : "1280x720";
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, "接口没有返回视频任务");
}

function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>) {
    return unwrapEnvelope(payload, "Seedance 接口没有返回任务");
}

function unwrapKlingTask(payload: ApiEnvelope<KlingTask>) {
    return unwrapEnvelope(payload, "可灵接口没有返回任务");
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || "请求失败");
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function videoResultUrl(payload: VideoResponse | SeedanceTask | ToApisTask) {
    const directPayload = payload as VideoResponse;
    const generatedPayload = payload as ToApisTask;
    const direct = [directPayload.video_url, directPayload.result_url, directPayload.url, directPayload.content?.video_url, directPayload.content?.url];
    const generated = generatedPayload.result?.data?.map((item) => item.url) || [];
    return [...direct, ...generated].find((url) => typeof url === "string" && (isPublicMediaUrl(url) || /\.mp4(\?|#|$)/i.test(url)));
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
    // error 可能是字符串或含 message 的对象
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
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; message?: string; code?: number | string }>(error)) {
        const responseData = error.response?.data;
        return readApiErrorMessage(responseData) || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(readApiErrorMessage(payload) || "视频下载失败");
    if (payload.error?.message) throw new Error(readApiErrorMessage(payload.error.message) || payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取本地资产失败"));
        reader.readAsDataURL(blob);
    });
}
