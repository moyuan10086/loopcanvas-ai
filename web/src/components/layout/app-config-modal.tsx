import { App, AutoComplete, Button, Form, Input, Modal, Progress, Select, Tabs } from "antd";
import { Boxes, ChevronDown, ChevronRight, CircleAlert, Cloud, CloudUpload, Copy, ExternalLink, Pencil, Plus, RefreshCw, SlidersHorizontal, Trash2, Wifi, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { ChannelEditorDrawer } from "@/components/layout/channel-editor-drawer";
import { syncAppDataToWebdav, type AppSyncDomainKey, type AppSyncProgressEvent } from "@/services/app-sync";
import { pricingExchangeRateForChannel, pricingUrlForChannel, syncConfigToBackend, syncModelPrices } from "@/services/config-sync";
import { testWebdavConnection, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { audioFormatOptionsForModel, audioVoiceOptions, miniMaxAudioVoiceOptions, normalizeAudioFormatForModel, normalizeAudioSpeedForModel, normalizeAudioVoiceForModel } from "@/lib/audio-generation";
import { availableModelsByCapability, createModelChannel, encodeChannelModel, guessCapability, modelOptionLabel, modelOptionName, modelOptionsFromChannels, normalizeModelOptionValue, selectableModelsByCapability, useConfigStore, type AiConfig, type ApiCallFormat, type ConfigTabKey, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { createComfyUIChannel, createModelScopeChannel, createRunningHubChannel } from "@/lib/channel-presets";
import { resolveModelPrice } from "@/lib/model-pricing";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    modelsKey: "imageModels" | "videoModels" | "textModels" | "audioModels";
    defaultLabel: string;
    optionsLabel: string;
};

type WebdavDomainProgress = {
    label: string;
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", modelsKey: "imageModels", defaultLabel: "默认生图模型", optionsLabel: "启用的生图模型" },
    { capability: "video", modelKey: "videoModel", modelsKey: "videoModels", defaultLabel: "默认视频模型", optionsLabel: "启用的视频模型" },
    { capability: "text", modelKey: "textModel", modelsKey: "textModels", defaultLabel: "默认文本模型", optionsLabel: "启用的文本模型" },
    { capability: "audio", modelKey: "audioModel", modelsKey: "audioModels", defaultLabel: "默认音频模型", optionsLabel: "启用的音频模型" },
];

const audioVoiceSuggestions = [...audioVoiceOptions, ...miniMaxAudioVoiceOptions];

const webdavDomainKeys: AppSyncDomainKey[] = ["canvas", "assets", "image-workbench", "video-workbench"];
const webdavDomainLabels: Record<AppSyncDomainKey, string> = {
    canvas: "画布",
    assets: "我的资产",
    "image-workbench": "生图工作台",
    "video-workbench": "视频创作台",
};

function createWebdavDomainProgress(): Record<AppSyncDomainKey, WebdavDomainProgress> {
    return webdavDomainKeys.reduce(
        (progress, key) => ({
            ...progress,
            [key]: { label: webdavDomainLabels[key], stage: "等待同步" },
        }),
        {} as Record<AppSyncDomainKey, WebdavDomainProgress>,
    );
}

export function AppConfigPanel({ showDoneButton = false, initialTab = "channels" }: { showDoneButton?: boolean; initialTab?: ConfigTabKey }) {
    const { message } = App.useApp();
    const [activeTab, setActiveTab] = useState<ConfigTabKey>(initialTab);
    const [editingChannelId, setEditingChannelId] = useState("");
    const [testingWebdav, setTestingWebdav] = useState(false);
    const [syncingWebdav, setSyncingWebdav] = useState(false);
    const [webdavSyncStatus, setWebdavSyncStatus] = useState("");
    const [webdavDomainProgress, setWebdavDomainProgress] = useState(createWebdavDomainProgress);
    const [priceChannelId, setPriceChannelId] = useState("");
    const [priceModelName, setPriceModelName] = useState("");
    const [priceEditModelName, setPriceEditModelName] = useState("");
    const [syncingPriceKey, setSyncingPriceKey] = useState("");
    const [pricePanelExpanded, setPricePanelExpanded] = useState(false);
    const pricingRequestRef = useRef(false);
    const config = useConfigStore((state) => state.config);
    const webdav = useConfigStore((state) => state.webdav);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const updateWebdavConfig = useConfigStore((state) => state.updateWebdavConfig);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const webdavReady = Boolean(webdav.url.trim());
    const editingChannel = config.channels.find((channel) => channel.id === editingChannelId) || null;
    const priceChannel = config.channels.find((channel) => channel.id === priceChannelId) || config.channels[0];
    const priceSourceUrl = priceChannel ? pricingUrlForChannel(priceChannel) : "";
    const priceExchangeRate = priceChannel ? pricingExchangeRateForChannel(priceChannel) : 1;
    const priceUsesNativeRmb = Boolean(priceChannel && /deepkey/i.test(`${priceChannel.name} ${priceChannel.baseUrl} ${priceChannel.pricingUrl || ""}`));
    const priceUsesToApisCatalog = Boolean(priceChannel && isToApisPricingChannel(priceChannel));
    const priceUsesAgentProxy = Boolean(priceChannel && /apimart/i.test(`${priceChannel.name} ${priceChannel.baseUrl} ${priceChannel.pricingUrl || ""}`));
    const priceEditModel = priceChannel?.models.find((model) => model.name === priceEditModelName) || priceChannel?.models[0];
    const priceModelCount = config.channels.reduce((total, channel) => total + channel.models.length, 0);
    const customPriceCount = config.channels.reduce((total, channel) => total + channel.models.filter((model) => Boolean(model.price?.trim())).length, 0);
    useEffect(() => {
        setActiveTab(initialTab);
        setPricePanelExpanded(false);
    }, [initialTab]);
    useEffect(() => {
        if (!config.channels.some((channel) => channel.id === priceChannelId)) setPriceChannelId(config.channels[0]?.id || "");
    }, [config.channels, priceChannelId]);
    useEffect(() => {
        const channel = config.channels.find((item) => item.id === priceChannelId) || config.channels[0];
        if (!channel?.models.some((model) => model.name === priceEditModelName)) setPriceEditModelName(channel?.models[0]?.name || "");
    }, [config.channels, priceChannelId, priceEditModelName]);

    const saveConfig = (nextConfig: AiConfig) => {
        (Object.keys(nextConfig) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, nextConfig[key]));
    };

    const finishConfig = () => {
        const ready = config.channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.length);
        setConfigDialogOpen(false);
        if (!ready) return;
        message.success(shouldPromptContinue ? "配置已保存，请继续刚才的请求" : "配置已保存");
        clearPromptContinue();
    };

    const updateChannels = (channels: ModelChannel[]) => saveConfig(withChannels(config, channels));

    const addChannel = () => {
        const channel = createModelChannel({ name: `渠道 ${config.channels.length + 1}` });
        updateChannels([...config.channels, channel]);
        setEditingChannelId(channel.id);
    };

    const addPresetChannel = (channel: ModelChannel) => {
        const existing = config.channels.find((item) => item.id === channel.id);
        if (existing) {
            setEditingChannelId(existing.id);
            message.info(`${existing.name} 渠道已经存在`);
            return;
        }
        updateChannels([...config.channels, channel]);
        setEditingChannelId(channel.id);
    };

    const deleteChannel = (id: string) => {
        if (config.channels.length <= 1) {
            message.warning("至少保留一个渠道");
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
    };

    const saveChannel = (channel: ModelChannel) => {
        updateChannels(config.channels.map((item) => (item.id === channel.id ? channel : item)));
    };

    const updateModelPrice = (channelId: string, modelName: string, value: string) => {
        const store = useConfigStore.getState();
        store.updateConfig(
            "channels",
            store.config.channels.map((channel) =>
                channel.id !== channelId
                    ? channel
                    : {
                          ...channel,
                          models: channel.models.map((model) => (model.name === modelName ? { ...model, price: value } : model)),
                      },
            ),
        );
    };

    const savePriceModel = (channel: ModelChannel, name: string, price?: string) => {
        const latest = useConfigStore.getState().config;
        const latestChannel = latest.channels.find((item) => item.id === channel.id);
        if (!latestChannel) return null;
        const existing = latestChannel.models.find((model) => model.name === name);
        const capability = existing?.capability || guessCapability(name);
        const models = existing
            ? latestChannel.models.map((model) => (model.name === name && price ? { ...model, price } : model))
            : [...latestChannel.models, { name, capability, ...(price ? { price } : {}) }];
        const nextChannels = latest.channels.map((item) => (item.id === channel.id ? { ...item, models } : item));
        const next = withChannels(latest, nextChannels);
        const group = modelGroups.find((item) => item.capability === capability)!;
        next[group.modelsKey] = uniqueModels([...next[group.modelsKey], encodeChannelModel(channel.id, name)]);
        saveConfig(next);
        setPriceModelName("");
        setPriceEditModelName(name);
        return { existing: Boolean(existing), capability };
    };

    const syncPrices = async () => {
        try {
            const synced = await syncConfigToBackend(config);
            if (!synced) {
                message.warning("未连接本地 Agent，价格已保存到浏览器；连接后再同步到后端");
                return;
            }
            message.success("模型价格已同步到后端");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "模型价格同步失败");
        }
    };

    const fetchAndApplyModelPrices = async (channel: ModelChannel, modelNames: string[], key: string) => {
        if (pricingRequestRef.current) return [];
        const sourceUrl = pricingUrlForChannel(channel);
        if (!sourceUrl) {
            message.warning(`请先在“渠道”页为 ${channel.name} 填写定价来源 URL`);
            return [];
        }
        pricingRequestRef.current = true;
        setSyncingPriceKey(key);
        try {
            const prices = await syncModelPrices(sourceUrl, modelNames, pricingExchangeRateForChannel(channel), channel.pricingProxyUrl);
            if (!prices.length) {
                message.warning({ content: "定价页没有找到完全匹配的模型名，请检查完整模型 ID", key: "model-price-sync" });
                return [];
            }
            const pricesByModel = new Map(prices.map((price) => [price.model.toLowerCase(), price.display]));
            const latest = useConfigStore.getState().config;
            const nextChannels = latest.channels.map((item) =>
                item.id !== channel.id
                    ? item
                    : {
                          ...item,
                          models: item.models.map((model) => {
                              const price = pricesByModel.get(model.name.toLowerCase());
                              return price ? { ...model, price } : model;
                          }),
                    },
            );
            updateConfig("channels", nextChannels);
            message.success({ content: `已抓取并填写 ${prices.length} 个模型价格`, key: "model-price-sync" });
            return prices;
        } catch (error) {
            message.error({ content: error instanceof Error ? error.message : "模型价格抓取失败", key: "model-price-sync" });
            return [];
        } finally {
            pricingRequestRef.current = false;
            setSyncingPriceKey("");
        }
    };

    const addModelAndFetchPrice = async () => {
        if (pricingRequestRef.current) return;
        const name = priceModelName.trim();
        const channel = config.channels.find((item) => item.id === priceChannelId);
        if (!channel || !name) {
            message.warning("请选择渠道并填写完整模型 ID");
            return;
        }
        const sourceUrl = pricingUrlForChannel(channel);
        if (!sourceUrl) {
            message.warning(`请先在“渠道”页为 ${channel.name} 填写定价来源 URL`);
            return;
        }
        pricingRequestRef.current = true;
        setSyncingPriceKey("add");
        try {
            const prices = await syncModelPrices(sourceUrl, [name], pricingExchangeRateForChannel(channel), channel.pricingProxyUrl);
            const scraped = prices.find((price) => price.model.toLowerCase() === name.toLowerCase());
            if (!savePriceModel(channel, name, scraped?.display)) return;
            if (scraped) message.success({ content: `已添加 ${name}，价格 ${scraped.display}`, key: "model-price-sync" });
            else message.warning({ content: `已添加 ${name}，但定价页没有完全匹配的价格，请手动填写`, key: "model-price-sync" });
        } catch (error) {
            message.error({ content: error instanceof Error ? error.message : "模型价格抓取失败", key: "model-price-sync" });
        } finally {
            pricingRequestRef.current = false;
            setSyncingPriceKey("");
        }
    };

    const copyModelId = async (modelName: string) => {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(modelName);
            } else {
                const textarea = document.createElement("textarea");
                try {
                    textarea.value = modelName;
                    textarea.setAttribute("readonly", "");
                    textarea.style.position = "fixed";
                    textarea.style.opacity = "0";
                    document.body.appendChild(textarea);
                    textarea.select();
                    if (!document.execCommand("copy")) throw new Error("copy command failed");
                } finally {
                    textarea.remove();
                }
            }
            message.success({ content: "已复制完整模型 ID", key: "copy-model-id" });
        } catch {
            message.error({ content: "复制失败，请手动选择模型 ID", key: "copy-model-id" });
        }
    };

    const updateCapabilityModels = (group: ModelGroup, models: string[]) => {
        const available = new Set(availableModelsByCapability(config, group.capability));
        const next = uniqueModels(models.map((model) => normalizeModelOptionValue(model, config.channels)).filter((model) => model && available.has(model)));
        updateConfig(group.modelsKey, next);
        if (!next.includes(config[group.modelKey])) updateConfig(group.modelKey, next[0] || "");
    };

    const testWebdav = async () => {
        if (!webdavReady) {
            message.error("请先填写 WebDAV 地址");
            return;
        }
        setTestingWebdav(true);
        try {
            await testWebdavConnection(webdav);
            message.success("WebDAV 连接可用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "WebDAV 连接测试失败");
        } finally {
            setTestingWebdav(false);
        }
    };

    const updateWebdavProgress = (event: AppSyncProgressEvent) => {
        setWebdavSyncStatus(event.stage);
        if (!event.domain) return;
        setWebdavDomainProgress((current) => ({
            ...current,
            [event.domain as AppSyncDomainKey]: {
                label: event.label || webdavDomainLabels[event.domain as AppSyncDomainKey],
                stage: event.stage,
                current: event.current,
                total: event.total,
                status: event.status,
            },
        }));
    };

    const syncWebdav = async () => {
        if (!webdavReady) {
            message.error("请先填写 WebDAV 地址");
            return;
        }
        setSyncingWebdav(true);
        setWebdavDomainProgress(createWebdavDomainProgress());
        setWebdavSyncStatus("准备同步");
        try {
            const result = await syncAppDataToWebdav(webdav, updateWebdavProgress);
            updateWebdavConfig("lastSyncedAt", result.syncedAt);
            message.success(`同步完成：${result.projects} 个画布，${result.assets} 个资产，${result.imageLogs + result.videoLogs} 条记录，本次上传 ${result.uploadedFiles} 个文件 ${formatBytes(result.uploadedBytes)}`);
        } catch (error) {
            setWebdavSyncStatus(error instanceof Error ? error.message : "WebDAV 同步失败");
            message.error(error instanceof Error ? error.message : "WebDAV 同步失败");
        } finally {
            setSyncingWebdav(false);
        }
    };

    return (
        <>
            <Tabs
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as ConfigTabKey)}
                items={[
                    {
                        key: "channels",
                        label: "渠道",
                        children: (
                            <div>
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <CircleAlert className="size-4 shrink-0" />
                                        <span>渠道保存完整模型库；只有在“模型”页启用的模型才会出现在各处下拉框。</span>
                                    </div>
                                    <Button type="link" size="small" className="!h-auto !p-0 !text-xs !font-semibold !text-current" icon={<SlidersHorizontal className="size-3.5" />} onClick={() => setActiveTab("models")}>
                                        管理启用模型
                                    </Button>
                                </div>
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div className="text-xs text-stone-500">每个渠道选择一个协议并维护模型库，为模型指定能力并可自定义调用脚本。</div>
                                    <div className="flex flex-wrap gap-2">
                                        <Button icon={<Boxes className="size-4" />} onClick={() => addPresetChannel(createModelScopeChannel())}>添加 ModelScope</Button>
                                        <Button icon={<Workflow className="size-4" />} onClick={() => addPresetChannel(createComfyUIChannel())}>添加 ComfyUI</Button>
                                        <Button icon={<Workflow className="size-4" />} onClick={() => addPresetChannel(createRunningHubChannel())}>添加 RunningHub</Button>
                                        <Button type="primary" icon={<Plus className="size-4" />} onClick={addChannel}>新增渠道</Button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    {config.channels.map((channel) => (
                                        <div key={channel.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-semibold">{channel.name || "未命名渠道"}</div>
                                                <div className="mt-1 truncate text-xs text-stone-500">
                                                    {apiFormatLabel(channel.apiFormat)} · 模型库 {channel.models.length} · 已启用 {enabledModelCount(config, channel.id)} · {channel.baseUrl || "未填写接口地址"}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 gap-2">
                                                <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditingChannelId(channel.id)}>
                                                    编辑
                                                </Button>
                                                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteChannel(channel.id)} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ),
                    },
                    {
                        key: "models",
                        label: "模型",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-4 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="text-sm font-semibold">启用模型和默认模型</div>
                                    <div className="mt-1 text-xs leading-5 text-stone-500">先从每类模型中勾选实际要使用的模型。未启用的模型仍保留在渠道模型库中，但不会出现在画布和生成页面。</div>
                                </div>
                                <div className="grid gap-4 md:grid-cols-2">
                                    {modelGroups.map((group) => {
                                        const options = availableModelsByCapability(config, group.capability).map((model) => ({ label: modelOptionLabel(config, model), value: model }));
                                        return (
                                            <Form.Item key={group.modelsKey} label={group.optionsLabel} className="mb-0">
                                                <Select
                                                    mode="multiple"
                                                    showSearch={{ autoClearSearchValue: false, optionFilterProp: "label" }}
                                                    allowClear
                                                    maxTagCount="responsive"
                                                    placeholder={options.length ? `搜索并勾选${group.optionsLabel}` : "请先到渠道中添加对应类型的模型"}
                                                    value={config[group.modelsKey]}
                                                    options={options}
                                                    onChange={(models) => updateCapabilityModels(group, models)}
                                                />
                                            </Form.Item>
                                        );
                                    })}
                                </div>
                                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    {modelGroups.map((group) => (
                                        <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-0">
                                            <ModelPicker config={config} value={config[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                        </Form.Item>
                                    ))}
                                </div>
                                <section className="mt-5 min-w-0 overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800">
                                    <div className="flex min-w-0 items-center gap-2 p-3">
                                        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={pricePanelExpanded} onClick={() => setPricePanelExpanded((value) => !value)}>
                                            {pricePanelExpanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                                            <span className="min-w-0">
                                                <span className="block truncate text-sm font-semibold">模型价格管理</span>
                                                <span className="block truncate text-xs text-stone-500">自定义 {customPriceCount} / 模型 {priceModelCount} · 默认折叠</span>
                                            </span>
                                        </button>
                                        {pricePanelExpanded ? (
                                            <Button size="small" icon={<CloudUpload className="size-4" />} onClick={() => void syncPrices()}>
                                                同步到后端
                                            </Button>
                                        ) : null}
                                    </div>
                                    {pricePanelExpanded ? (
                                        <div className="min-w-0 border-t border-stone-200 p-3 dark:border-stone-800">
                                            <div className="mb-3 text-xs leading-5 text-stone-500">价格示例：¥0.08/张、¥1.20/秒，或输入/输出 Token 价格；{priceUsesNativeRmb ? "当前渠道使用人民币原价，不做美元换算。" : `当前渠道换算比例 $1 = ¥${priceExchangeRate}。`}</div>
                                            {priceUsesToApisCatalog ? (
                                                <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                                                    <CircleAlert className="mt-0.5 size-4 shrink-0" />
                                                    <span><strong>ToAPIs 自动读取官方价格目录。</strong> 抓取接口：<code>https://toapis.com/api/pricing</code>；中文官网按 `$1 = ¥7` 显示人民币，留空时使用该换算比例。</span>
                                                </div>
                                            ) : priceUsesAgentProxy ? (
                                                <div className="mb-3 flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-100">
                                                    <CircleAlert className="mt-0.5 size-4 shrink-0" />
                                                    <span><strong>APIMart 由本地 Agent 抓取。</strong> Agent 会优先使用渠道里的“定价抓取代理 URL”，留空时自动读取系统代理；浏览器能访问不代表 Agent 直连可用。</span>
                                                </div>
                                            ) : null}
                                            <div className="mb-3 grid min-w-0 items-end gap-2 rounded-md bg-stone-50 p-2 sm:grid-cols-2 lg:grid-cols-[180px_minmax(0,1fr)_auto_auto] dark:bg-stone-900/50">
                                                <label className="min-w-0">
                                                    <span className="mb-1 block text-[11px] font-medium text-stone-500">渠道</span>
                                                    <Select className="w-full min-w-0" value={priceChannelId || undefined} placeholder="选择渠道" options={config.channels.map((channel) => ({ label: channel.name, value: channel.id }))} onChange={setPriceChannelId} />
                                                </label>
                                                <label className="min-w-0">
                                                    <span className="mb-1 block text-[11px] font-medium text-stone-500">完整模型 ID（不是链接）</span>
                                                    <Input className="min-w-0" value={priceModelName} placeholder="例如 gpt-image-2-count" onChange={(event) => setPriceModelName(event.target.value)} onPressEnter={() => void addModelAndFetchPrice()} />
                                                </label>
                                                <Button type="primary" icon={<RefreshCw className="size-4" />} loading={syncingPriceKey === "add"} onClick={() => void addModelAndFetchPrice()}>添加模型并抓价</Button>
                                                {priceSourceUrl ? <Button icon={<ExternalLink className="size-4" />} href={priceSourceUrl} target="_blank">打开定价来源</Button> : <span />}
                                            </div>
                                            {priceChannel?.models.length ? (
                                                <div className="min-w-0 rounded-md border border-stone-100 p-3 dark:border-stone-800/80">
                                                    <div className="mb-2 text-xs font-medium text-stone-600 dark:text-stone-300">编辑已有模型价格</div>
                                                    <div className="grid min-w-0 items-end gap-2 md:grid-cols-2 xl:grid-cols-[minmax(200px,1fr)_minmax(220px,1fr)_minmax(180px,260px)_auto]">
                                                        <label className="min-w-0">
                                                            <span className="mb-1 block text-[11px] font-medium text-stone-500">选择模型</span>
                                                            <Select
                                                                className="w-full min-w-0"
                                                                showSearch={{ optionFilterProp: "label" }}
                                                                value={priceEditModel?.name}
                                                                placeholder="搜索并选择已有模型"
                                                                options={priceChannel.models.map((model) => ({ label: `${model.name} · ${capabilityLabel(model.capability)}`, value: model.name }))}
                                                                onChange={setPriceEditModelName}
                                                            />
                                                        </label>
                                                        <label className="min-w-0">
                                                            <span className="mb-1 block text-[11px] font-medium text-stone-500">完整模型 ID</span>
                                                            <Input
                                                                className="min-w-0 font-mono"
                                                                value={priceEditModel?.name || ""}
                                                                readOnly
                                                                aria-label="完整模型 ID"
                                                                title={priceEditModel?.name}
                                                                onFocus={(event) => event.currentTarget.select()}
                                                                suffix={
                                                                    <button type="button" className="inline-flex size-6 items-center justify-center rounded text-stone-500 hover:bg-stone-100 hover:text-stone-900 disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-100" aria-label="复制完整模型 ID" title="复制完整模型 ID" disabled={!priceEditModel} onClick={() => priceEditModel && void copyModelId(priceEditModel.name)}>
                                                                        <Copy className="size-4" />
                                                                    </button>
                                                                }
                                                            />
                                                        </label>
                                                        <label className="min-w-0">
                                                            <span className="mb-1 block text-[11px] font-medium text-stone-500">人民币价格</span>
                                                            <Input
                                                                className="min-w-0"
                                                                value={priceEditModel ? priceEditModel.price || builtInModelPrice(priceChannel, priceEditModel.name) : ""}
                                                                placeholder="暂无内置价格，可手动填写"
                                                                allowClear
                                                                aria-label={`${priceChannel.name} ${priceEditModel?.name || "模型"} 自定义价格`}
                                                                onFocus={(event) => {
                                                                    if (priceEditModel && !priceEditModel.price) event.currentTarget.select();
                                                                }}
                                                                onChange={(event) => priceEditModel && updateModelPrice(priceChannel.id, priceEditModel.name, event.target.value)}
                                                            />
                                                        </label>
                                                        {priceEditModel && pricingUrlForChannel(priceChannel) ? (
                                                            <Button icon={<RefreshCw className="size-4" />} aria-label={`抓取 ${priceEditModel.name} 价格`} loading={syncingPriceKey === `${priceChannel.id}:${priceEditModel.name}`} onClick={() => void fetchAndApplyModelPrices(priceChannel, [priceEditModel.name], `${priceChannel.id}:${priceEditModel.name}`)}>抓取价格</Button>
                                                        ) : <span />}
                                                    </div>
                                                    {priceEditModel ? (
                                                        <div className="mt-2 truncate text-[11px] text-stone-500" title={`${priceEditModel.name} · ${priceEditModel.price || builtInModelPrice(priceChannel, priceEditModel.name) || "暂无内置价格"}`}>
                                                            当前模型：{priceEditModel.name} · {priceEditModel.price ? `${priceEditModel.price}（自定义）` : builtInModelPrice(priceChannel, priceEditModel.name) || "暂无内置价格"}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ) : <div className="py-5 text-center text-xs text-stone-500">当前渠道没有模型，请在上方填写完整模型 ID 后添加。</div>}
                                        </div>
                                    ) : null}
                                </section>
                            </Form>
                        ),
                    },
                    {
                        key: "preferences",
                        label: "偏好设置",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <div className="mb-2 text-sm font-semibold">生成偏好</div>
                                <div className="grid gap-4 md:grid-cols-4">
                                    <Form.Item label="画布默认生图张数" extra="新建画布生图和配置节点默认使用，单个节点仍可单独覆盖。" className="mb-4">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={15}
                                            value={config.canvasImageCount}
                                            onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                            onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                        />
                                    </Form.Item>
                                    <Form.Item label="默认音频声音" className="mb-4">
                                        <AutoComplete value={normalizeAudioVoiceForModel(config.audioModel, config.audioVoice)} options={audioVoiceSuggestions} placeholder="可选择或输入 Voice ID" onChange={(value) => updateConfig("audioVoice", value)} />
                                    </Form.Item>
                                    <Form.Item label="默认音频格式" className="mb-4">
                                        <Select value={normalizeAudioFormatForModel(config.audioModel, config.audioFormat)} options={audioFormatOptionsForModel(config.audioModel)} onChange={(value) => updateConfig("audioFormat", value)} />
                                    </Form.Item>
                                    <Form.Item label="默认音频语速" className="mb-4">
                                        <Input
                                            type="number"
                                            min={0.25}
                                            max={4}
                                            step={0.05}
                                            value={config.audioSpeed}
                                            onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                            onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedForModel(config.audioModel, event.target.value))}
                                        />
                                    </Form.Item>
                                    <Form.Item label="MiniMax 音乐类型" className="mb-4">
                                        <Select value={config.audioMusicInstrumental} options={[{ label: "歌曲", value: "false" }, { label: "纯音乐", value: "true" }]} onChange={(value) => updateConfig("audioMusicInstrumental", value)} />
                                    </Form.Item>
                                </div>
                                <div className="grid gap-4 md:grid-cols-2">
                                    <Form.Item label="默认音频指令" className="mb-4">
                                        <Input.TextArea rows={3} value={config.audioInstructions} placeholder="OpenAI TTS 使用，例如：自然、温暖、适合旁白。" onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                                    </Form.Item>
                                    <Form.Item label="MiniMax 默认歌词" extra="留空时由 MiniMax 根据音乐描述自动生成歌词。" className="mb-4">
                                        <Input.TextArea rows={3} value={config.audioMusicLyrics} placeholder="可使用 [Verse]、[Chorus] 等结构标签。" onChange={(event) => updateConfig("audioMusicLyrics", event.target.value)} />
                                    </Form.Item>
                                </div>
                                <Form.Item label="系统提示词" className="mb-0">
                                    <Input.TextArea rows={4} value={config.systemPrompt} placeholder="例如：你是一位擅长电影感写实摄影的视觉导演。" onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                </Form.Item>
                            </Form>
                        ),
                    },
                    {
                        key: "webdav",
                        label: "WebDAV",
                        children: (
                            <Form layout="vertical" requiredMark={false}>
                                <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-sm font-semibold">
                                                <Cloud className="size-4" />
                                                WebDAV 同步
                                            </div>
                                            <div className="mt-1 text-xs text-stone-500">同步画布、我的资产、生成记录和本地媒体文件，不包含 AI API Key；浏览器会直接连接 WebDAV 服务。</div>
                                        </div>
                                        <div className="text-xs text-stone-500">{webdav.lastSyncedAt ? `上次同步 ${formatWebdavTime(webdav.lastSyncedAt)}` : "尚未同步"}</div>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                        <Form.Item label="WebDAV 地址" className="mb-4">
                                            <Input value={webdav.url} placeholder="https://nas.example.com/webdav" onChange={(event) => updateWebdavConfig("url", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="远程目录" extra={`会在该目录下分业务目录保存，每个目录包含 ${WEBDAV_MANIFEST_FILE_NAME} 和 files/`} className="mb-4">
                                            <Input value={webdav.directory} placeholder="infinite-canvas" onChange={(event) => updateWebdavConfig("directory", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="用户名" className="mb-0">
                                            <Input value={webdav.username} autoComplete="username" onChange={(event) => updateWebdavConfig("username", event.target.value)} />
                                        </Form.Item>
                                        <Form.Item label="密码 / 应用密码" className="mb-0">
                                            <Input.Password value={webdav.password} autoComplete="current-password" onChange={(event) => updateWebdavConfig("password", event.target.value)} />
                                        </Form.Item>
                                    </div>
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <Button icon={<Wifi className="size-4" />} disabled={!webdavReady || syncingWebdav} loading={testingWebdav} onClick={() => void testWebdav()}>
                                            测试连接
                                        </Button>
                                        <Button type="primary" icon={<RefreshCw className="size-4" />} disabled={!webdavReady || testingWebdav} loading={syncingWebdav} onClick={() => void syncWebdav()}>
                                            {syncingWebdav ? "同步中" : "立即同步"}
                                        </Button>
                                        {webdavSyncStatus ? <span className="text-xs text-stone-500">{webdavSyncStatus}</span> : null}
                                    </div>
                                    {syncingWebdav || webdavSyncStatus ? <WebdavProgressGrid progress={webdavDomainProgress} /> : null}
                                </section>
                            </Form>
                        ),
                    },
                ]}
            />
            {showDoneButton ? (
                <div className="mt-4 flex justify-end">
                    <Button type="primary" onClick={finishConfig}>
                        完成
                    </Button>
                </div>
            ) : null}
            <ChannelEditorDrawer open={Boolean(editingChannel)} channel={editingChannel} onSave={saveChannel} onClose={() => setEditingChannelId("")} />
        </>
    );
}

export function AppConfigModal() {
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const configTab = useConfigStore((state) => state.configTab);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">配置与用户偏好</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">渠道聚合、模型启用和同步偏好</div>
                </div>
            }
            open={isConfigOpen}
            width={980}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 12 } }}
            footer={null}
        >
            <AppConfigPanel showDoneButton initialTab={configTab} />
        </Modal>
    );
}

function withChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    const models = modelOptionsFromChannels(channels);
    const textModels = keepAvailableModels(config.textModels, channels, "text");
    const legacyGrokImageModels = textModels.filter((value) => {
        const name = modelOptionName(value).toLowerCase();
        return /^grok-imagine(?:-|$)/i.test(name) && !name.includes("video") && channels.some((channel) => channel.models.some((model) => model.name.toLowerCase() === name && model.capability === "image"));
    });
    const next: AiConfig = {
        ...config,
        channels,
        models,
        imageModels: uniqueModels([...keepAvailableModels(config.imageModels, channels, "image"), ...legacyGrokImageModels]),
        videoModels: keepAvailableModels(config.videoModels, channels, "video"),
        textModels: textModels.filter((model) => !legacyGrokImageModels.includes(model)),
        audioModels: keepAvailableModels(config.audioModels, channels, "audio"),
        baseUrl: channels[0]?.baseUrl || config.baseUrl,
        apiKey: channels[0]?.apiKey || config.apiKey,
        apiFormat: channels[0]?.apiFormat || config.apiFormat,
    };
    return {
        ...next,
        imageModel: pickDefaultModel(next, "image", config.imageModel),
        videoModel: pickDefaultModel(next, "video", config.videoModel),
        textModel: pickDefaultModel(next, "text", config.textModel),
        audioModel: pickDefaultModel(next, "audio", config.audioModel),
    };
}

function keepAvailableModels(current: string[], channels: ModelChannel[], capability: ModelCapability) {
    const available = new Set(channels.flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => `${channel.id}::${model.name}`)));
    return uniqueModels(current).filter((model) => available.has(model));
}

function enabledModelCount(config: AiConfig, channelId: string) {
    const prefix = `${channelId}::`;
    return new Set([...config.imageModels, ...config.videoModels, ...config.textModels, ...config.audioModels].filter((model) => model.startsWith(prefix))).size;
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function pickDefaultModel(config: AiConfig, capability: ModelCapability, current: string) {
    const options = selectableModelsByCapability(config, capability);
    const normalized = normalizeModelOptionValue(current, config.channels);
    return options.includes(normalized) ? normalized : options[0] || "";
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function apiFormatLabel(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return "Gemini";
    if (apiFormat === "fal") return "Fal";
    return "OpenAI";
}

function capabilityLabel(capability: ModelCapability) {
    if (capability === "image") return "生图";
    if (capability === "video") return "视频";
    if (capability === "audio") return "音频";
    return "文本";
}

function builtInModelPrice(channel: ModelChannel, modelName: string) {
    const withoutOverride = {
        ...channel,
        models: channel.models.map((model) => (model.name === modelName ? { ...model, price: undefined } : model)),
    };
    return resolveModelPrice(withoutOverride, modelName)?.display || "";
}

function isToApisPricingChannel(channel: Pick<ModelChannel, "name" | "baseUrl" | "pricingUrl">) {
    return /toapis/i.test(`${channel.name} ${channel.baseUrl} ${channel.pricingUrl || ""}`);
}


function formatWebdavTime(value: string) {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function WebdavProgressGrid({ progress }: { progress: Record<AppSyncDomainKey, WebdavDomainProgress> }) {
    return (
        <div className="mt-3 grid gap-2">
            {webdavDomainKeys.map((key) => {
                const item = progress[key];
                const count = item.total ? `${item.current || 0}/${item.total}` : "";
                return (
                    <div key={key} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                        <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                            <span className="shrink-0 font-medium text-stone-700 dark:text-stone-200">{item.label}</span>
                            <span className="min-w-0 truncate text-right text-stone-500">
                                {item.stage}
                                {count ? ` · ${count}` : ""}
                            </span>
                        </div>
                        <Progress percent={getWebdavProgressPercent(item)} size="small" status={getWebdavProgressStatus(item)} showInfo={false} />
                    </div>
                );
            })}
        </div>
    );
}

function getWebdavProgressPercent(item: WebdavDomainProgress) {
    if (item.status === "success") return 100;
    if (item.total) return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
    if (item.status === "exception") return 100;
    if (item.stage === "等待同步") return 0;
    if (item.stage === "读取远端清单") return 12;
    if (item.stage === "读取本地数据") return 24;
    if (item.stage === "下载缺失媒体") return 36;
    if (item.stage === "写入本地合并结果") return 58;
    if (item.stage === "上传新增媒体") return 66;
    if (item.stage === "媒体已齐全" || item.stage === "媒体无需上传") return 74;
    if (item.stage.startsWith("上传清单")) return 90;
    return item.status === "active" ? 30 : 0;
}

function getWebdavProgressStatus(item: WebdavDomainProgress): "normal" | "active" | "success" | "exception" {
    if (item.status === "success" || item.status === "exception") return item.status;
    return item.status === "active" ? "active" : "normal";
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
