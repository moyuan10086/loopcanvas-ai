import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { nanoid } from "nanoid";
import { normalizeVideoFrameMode } from "@/lib/video-frame-mode";
import { appendModelPrice } from "@/lib/model-pricing";
import { loadBackendConfig, scheduleBackendConfigSave } from "@/services/config-sync";
import type { VideoFrameMode } from "@/types/media";

export type ApiCallFormat = "openai" | "gemini" | "fal";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type RunningHubKeyMode = "auto" | "rh" | "wallet";

export type ChannelModel = {
    name: string;
    capability: ModelCapability;
    script?: string;
    /** Optional user override, entered as a human-readable RMB price (for example ¥0.08/张). */
    price?: string;
};

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    pricingUrl?: string;
    pricingExchangeRate?: number;
    pricingProxyUrl?: string;
    apiKey: string;
    walletApiKey?: string;
    runningHubKeyMode?: RunningHubKeyMode;
    runningHubSuperResolutionModel?: string;
    apiFormat: ApiCallFormat;
    models: ChannelModel[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    audioMusicLyrics: string;
    audioMusicInstrumental: string;
    videoSeconds: string;
    vquality: string;
    videoFrameMode: VideoFrameMode;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    models: string[];
    imageModels: string[];
    videoModels: string[];
    textModels: string[];
    audioModels: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};
export type ConfigTabKey = "channels" | "models" | "preferences" | "webdav";

export type ChannelCredentialsImportResult = {
    status: "created" | "updated" | "missing-base-url" | "invalid-base-url";
    channelName?: string;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
const LEGACY_CONFIG_STORE_KEY = "infinite-canvas:ai_config";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const FAL_BASE_URL = "https://fal.run";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    channels: [
        {
            id: "default",
            name: "默认渠道",
            baseUrl: OPENAI_BASE_URL,
            apiKey: "",
            apiFormat: "openai",
            models: [
                { name: "gpt-image-2", capability: "image" },
                { name: "grok-imagine-video", capability: "video" },
                { name: "gpt-5.5", capability: "text" },
                { name: "gpt-4o-mini-tts", capability: "audio" },
            ],
        },
    ],
    model: "default::gpt-image-2",
    imageModel: "default::gpt-image-2",
    videoModel: "default::grok-imagine-video",
    textModel: "default::gpt-5.5",
    audioModel: "default::gpt-4o-mini-tts",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    audioMusicLyrics: "",
    audioMusicInstrumental: "false",
    videoSeconds: "6",
    vquality: "720",
    videoFrameMode: "reference",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    models: ["default::gpt-image-2", "default::grok-imagine-video", "default::gpt-5.5", "default::gpt-4o-mini-tts"],
    imageModels: ["default::gpt-image-2"],
    videoModels: ["default::grok-imagine-video"],
    textModels: ["default::gpt-5.5"],
    audioModels: ["default::gpt-4o-mini-tts"],
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    importChannelCredentials: (input: { baseUrl?: string | null; apiKey?: string | null }) => ChannelCredentialsImportResult;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

const VIDEO_KEYWORDS = ["seedance", "video", "sora", "veo", "kling", "wan", "hailuo"];
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "imagine", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

/** Best-effort default capability for a freshly fetched model name; user can override in the channel editor. */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return channel && model ? { channel, model } : null;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findChannelModel(config, value)?.model.capability;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    return modelCapabilityOf(config, value) === capability;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config[modelListKey(capability)];
}

export function availableModelsByCapability(config: AiConfig, capability: ModelCapability) {
    return config.channels.flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)));
}

function modelListKey(capability: ModelCapability) {
    return `${capability}Models` as "imageModels" | "videoModels" | "textModels" | "audioModels";
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.script?.trim() || "";
}

function isAiConfigReady(config: AiConfig, model: string) {
    const channel = resolveModelChannel(config, model);
    return Boolean(model.trim() && channel.baseUrl.trim() && (channel.apiKey.trim() || channel.walletApiKey?.trim()));
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            isConfigOpen: false,
            configTab: "channels",
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => {
                    const config = { ...state.config, [key]: value };
                    scheduleBackendConfigSave(config);
                    return { config };
                }),
            importChannelCredentials: (input) => {
                const currentConfig = get().config;
                const result = upsertChannelCredentials(currentConfig, input);
                if (result.config !== currentConfig) {
                    set({ config: result.config });
                    scheduleBackendConfigSave(result.config);
                }
                return { status: result.status, channelName: result.channelName };
            },
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "channels") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            storage: createJSONStorage(() => createConfigStorage()),
            partialize: (state) => ({ config: state.config, webdav: state.webdav }),
            onRehydrateStorage: () => (state) => {
                const hydratedConfig = state?.config;
                void loadBackendConfig().then((remoteConfig) => {
                    const currentConfig = useConfigStore.getState().config;
                    if (hydratedConfig && currentConfig !== hydratedConfig) {
                        scheduleBackendConfigSave(currentConfig);
                        return;
                    }
                    if (remoteConfig && Array.isArray(remoteConfig.channels) && remoteConfig.channels.length) {
                        useConfigStore.setState({ config: normalizeStoredConfig(remoteConfig) });
                        return;
                    }
                    if (state) scheduleBackendConfigSave(state.config);
                });
            },
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav },
                    config: normalizeStoredConfig(persistedConfig),
                };
            },
        },
    ),
);

function normalizeStoredConfig(persistedConfig: Partial<AiConfig>) {
    const config = { ...defaultConfig, ...persistedConfig };
    if (!Array.isArray(persistedConfig.channels)) config.channels = [];
    const channels = normalizeChannels(config);
    const models = modelOptionsFromChannels(channels);
    const imageModels = normalizeEnabledModels(persistedConfig.imageModels, channels, "image");
    const videoModels = normalizeEnabledModels(persistedConfig.videoModels, channels, "video");
    const migratedTextModels = normalizeEnabledModels(persistedConfig.textModels, channels, "text");
    const legacyGrokImageModels = migratedTextModels.filter((value) => isGrokImagineImageModel(value, channels));
    const textModels = migratedTextModels.filter((value) => !legacyGrokImageModels.includes(value));
    const audioModels = normalizeEnabledModels(persistedConfig.audioModels, channels, "audio");
    const enabledImageModels = uniqueModelOptions([...imageModels, ...legacyGrokImageModels]);
    return {
        ...config,
        channelMode: "local" as const,
        apiFormat: normalizeApiFormat(config.apiFormat),
        channels,
        models,
        imageModels: enabledImageModels,
        videoModels,
        textModels,
        audioModels,
        imageModel: normalizeDefaultModel(config.imageModel || config.model, enabledImageModels),
        videoModel: normalizeDefaultModel(config.videoModel, videoModels),
        textModel: normalizeDefaultModel(config.textModel || config.model, textModels),
        audioModel: normalizeDefaultModel(config.audioModel || defaultConfig.audioModel, audioModels),
        audioVoice: config.audioVoice || defaultConfig.audioVoice,
        audioFormat: config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: config.audioInstructions || "",
        audioMusicLyrics: config.audioMusicLyrics || "",
        audioMusicInstrumental: config.audioMusicInstrumental === "true" ? "true" as const : "false" as const,
        videoSeconds: config.videoSeconds || "6",
        vquality: config.vquality || "720",
        videoFrameMode: normalizeVideoFrameMode(config.videoFrameMode),
        videoGenerateAudio: config.videoGenerateAudio || "true",
        videoWatermark: config.videoWatermark || "false",
        canvasImageCount: config.canvasImageCount || "3",
    };
}

function createConfigStorage(): StateStorage {
    return {
        getItem(name) {
            const current = localStorage.getItem(name);
            const legacy = localStorage.getItem(LEGACY_CONFIG_STORE_KEY);
            if (name === CONFIG_STORE_KEY && hasConfiguredChannels(current)) return current;
            if (name === CONFIG_STORE_KEY && hasConfiguredChannels(legacy)) return legacy;
            return current;
        },
        setItem(name, value) {
            localStorage.setItem(name, value);
        },
        removeItem(name) {
            localStorage.removeItem(name);
        },
    };
}

function hasConfiguredChannels(raw: string | null) {
    if (!raw) return false;
    try {
        const parsed = JSON.parse(raw) as { state?: { config?: Partial<AiConfig> }; config?: Partial<AiConfig> };
        const config = parsed.state?.config || parsed.config;
        const channels = Array.isArray(config?.channels) ? config.channels : [];
        return channels.some((channel) => {
            const item = channel as Partial<ModelChannel>;
            return Boolean(item.apiKey?.trim()) || Boolean(item.baseUrl?.trim() && !item.baseUrl.trim().match(/^https:\/\/api\.openai\.com\/?$/i));
        });
    } catch {
        return false;
    }
}

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const capability = normalizeChannelModelCapability(name, typeof item === "string" ? undefined : item.capability);
        const script = typeof item === "string" ? undefined : item.script?.trim() || undefined;
        const price = typeof item === "string" ? undefined : item.price?.trim() || undefined;
        result.push({ name, capability, script, price });
    }
    return result;
}

function normalizeChannelModelCapability(name: string, capability?: ModelCapability): ModelCapability {
    const inferred = guessCapability(name);
    // RunningHub 2053691179258134529 is a video-to-video workflow, even if an older config saved it as image.
    if (/2053691179258134529|(?:去水印|去字幕|去模糊).*ltx2\.3|ltx2\.3.*(?:视频|去水印|去字幕|去模糊)/i.test(name)) return "video";
    // Migrate older Apimart Grok Imagine entries that were inferred as text.
    if (capability === "text" && inferred === "image" && /^grok-imagine(?:-|$)/i.test(name)) return "image";
    return capability || inferred;
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || "新渠道",
        baseUrl: normalizeChannelBaseUrl(channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat)),
        pricingUrl: channel?.pricingUrl?.trim() || "",
        pricingExchangeRate: Number.isFinite(channel?.pricingExchangeRate) && Number(channel?.pricingExchangeRate) > 0 ? Number(channel?.pricingExchangeRate) : undefined,
        pricingProxyUrl: channel?.pricingProxyUrl?.trim() || "",
        apiKey: channel?.apiKey || "",
        walletApiKey: channel?.walletApiKey || "",
        runningHubKeyMode: channel?.runningHubKeyMode === "wallet" || channel?.runningHubKeyMode === "rh" ? channel.runningHubKeyMode : "auto",
        runningHubSuperResolutionModel: channel?.runningHubSuperResolutionModel?.trim() || "",
        apiFormat,
        models: normalizeChannelModels(channel?.models),
    };
}

export function upsertChannelCredentials(
    config: AiConfig,
    input: { baseUrl?: string | null; apiKey?: string | null },
): ChannelCredentialsImportResult & { config: AiConfig } {
    const rawBaseUrl = input.baseUrl?.trim() || "";
    if (!rawBaseUrl) return { status: "missing-base-url", config };
    if (!isHttpBaseUrl(rawBaseUrl)) return { status: "invalid-base-url", config };

    const baseUrl = normalizeChannelBaseUrl(rawBaseUrl);
    const apiKey = input.apiKey?.trim() || "";
    const matchingIndex = config.channels.findIndex((channel) => normalizedBaseUrlKey(channel.baseUrl) === normalizedBaseUrlKey(baseUrl));

    if (matchingIndex >= 0) {
        const existing = config.channels[matchingIndex];
        if (existing.baseUrl === baseUrl && (!apiKey || existing.apiKey === apiKey)) {
            return { status: "updated", channelName: existing.name, config };
        }
        const updated = {
            ...existing,
            baseUrl,
            ...(apiKey ? { apiKey } : {}),
        };
        const channels = config.channels.map((channel, index) => (index === matchingIndex ? updated : channel));
        return {
            status: "updated",
            channelName: existing.name,
            config: { ...config, channels },
        };
    }

    const channel = createModelChannel({
        name: importedChannelName(baseUrl),
        baseUrl,
        apiKey,
        apiFormat: "openai",
        models: [],
    });
    return {
        status: "created",
        channelName: channel.name,
        config: { ...config, channels: [...config.channels, channel] },
    };
}

function isHttpBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
    } catch {
        return false;
    }
}

function normalizedBaseUrlKey(baseUrl: string) {
    const normalized = normalizeChannelBaseUrl(baseUrl);
    try {
        const url = new URL(normalized);
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return normalized;
    }
}

function importedChannelName(baseUrl: string) {
    try {
        const hostname = new URL(baseUrl).hostname;
        if (/chatgpt2api/i.test(hostname)) return "chatgpt2api";
        return hostname.replace(/^(?:www|api)\./i, "") || "导入渠道";
    } catch {
        return "导入渠道";
    }
}

function normalizeChannelBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        if (/^(?:www[.])?apimart[.]ai$/i.test(url.hostname)) url.hostname = "api.apimart.ai";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    const label = channel ? `${decoded.model}（${channel.name}）` : decoded.model;
    return channel ? appendModelPrice(label, channel, decoded.model) : label;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.some((item) => item.name === decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.some((entry) => entry.name === model)) || channels[0];
    return channel && channel.models.some((item) => item.name === model) ? encodeChannelModel(channel.id, model) : model;
}

function normalizeEnabledModels(models: string[] | undefined, channels: ModelChannel[], capability: ModelCapability) {
    const available = new Set(channels.flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name))));
    if (!Array.isArray(models)) return Array.from(available);
    return uniqueModelOptions(models)
        .map((model) => normalizeModelOptionValue(model, channels))
        .filter((model) => model && available.has(model));
}

function isGrokImagineImageModel(value: string, channels: ModelChannel[]) {
    const name = modelOptionName(value).toLowerCase();
    if (!/^grok-imagine(?:-|$)/i.test(name) || name.includes("video")) return false;
    const decoded = decodeChannelModel(value);
    const channel = decoded ? channels.find((item) => item.id === decoded.channelId) : channels.find((item) => item.models.some((model) => model.name.toLowerCase() === name));
    return Boolean(channel?.models.some((model) => model.name.toLowerCase() === name && model.capability === "image"));
}

function normalizeDefaultModel(value: string | undefined, enabledModels: string[]) {
    const model = (value || "").trim();
    return enabledModels.includes(model) ? model : enabledModels[0] || "";
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.some((item) => item.name === model));
    return matched || config.channels[0] || createModelChannel({ id: "default", name: "默认渠道", baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })) });
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        walletApiKey: channel.walletApiKey || "",
        apiFormat: channel.apiFormat,
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? "默认渠道" : `渠道 ${index + 1}`),
            models: normalizeChannelModels(channel.models),
        }),
    );
    if (!channels.length) {
        channels.push(
            createModelChannel({
                id: "default",
                name: "默认渠道",
                baseUrl: config.baseUrl || defaultConfig.baseUrl,
                apiKey: config.apiKey || "",
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                models: normalizeChannelModels([config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel].map(modelOptionName)),
            }),
        );
    }
    return channels;
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return GEMINI_BASE_URL;
    if (apiFormat === "fal") return FAL_BASE_URL;
    return OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" || apiFormat === "fal" ? apiFormat : "openai";
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
