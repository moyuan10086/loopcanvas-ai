import { App, Button, Checkbox, Drawer, Input, Modal, Segmented, Select, Space } from "antd";
import { ListPlus, Music2, Trash2, Workflow } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { defaultBaseUrlForApiFormat, guessCapability, normalizeChannelModels, type ApiCallFormat, type ChannelModel, type ModelCapability, type ModelChannel, type RunningHubKeyMode } from "@/stores/use-config-store";
import { miniMaxAudioModelOptions } from "@/lib/audio-generation";
import { buildComfyUIWorkflowModel, buildRunningHubReferenceWorkflowModel, buildRunningHubWorkflowModel, isComfyUIChannel, isModelScopeChannel, isRunningHubChannel, RUNNINGHUB_REFERENCE_WORKFLOWS, RUNNINGHUB_SEEDVR2_WORKFLOW_ID } from "@/lib/channel-presets";
import { fetchRunningHubWorkflowJson } from "@/services/api/runninghub";
import { pricingExchangeRateForChannel } from "@/services/config-sync";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";

const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
    { label: "OpenAI", value: "openai" },
    { label: "Gemini", value: "gemini" },
    { label: "Fal", value: "fal" },
];

const capabilityOptions: Array<{ label: string; value: ModelCapability }> = [
    { label: "生图", value: "image" },
    { label: "视频", value: "video" },
    { label: "文本", value: "text" },
    { label: "音频", value: "audio" },
];

type ScriptTarget = { name: string; capability: ModelCapability; value: string };

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [runningHubWorkflowId, setRunningHubWorkflowId] = useState(RUNNINGHUB_SEEDVR2_WORKFLOW_ID);
    const [runningHubWorkflowLoading, setRunningHubWorkflowLoading] = useState(false);
    const [selectedReferenceWorkflowIds, setSelectedReferenceWorkflowIds] = useState<string[]>([]);
    const workflowInputRef = useRef<HTMLInputElement>(null);
    const { message } = App.useApp();

    useEffect(() => {
        if (open && channel) {
            setDraft(channel);
            setSelectedReferenceWorkflowIds(RUNNINGHUB_REFERENCE_WORKFLOWS.filter((item) => channel.models.some((model) => model.name.includes(item.id))).map((item) => item.id));
        }
    }, [open, channel]);

    if (!draft) return null;

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const setModels = (models: ChannelModel[]) => patch({ models });

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim() === defaultBaseUrlForApiFormat(draft.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;
        patch({ apiFormat, baseUrl });
    };

    const applySelection = (names: string[]) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        setModels(names.map((name) => map.get(name) || { name, capability: guessCapability(name) }));
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));
    const addMiniMaxAudioModels = () => {
        const current = new Map(draft.models.map((model) => [model.name, model]));
        for (const name of miniMaxAudioModelOptions) {
            if (!current.has(name)) current.set(name, { name, capability: "audio" });
        }
        setModels(Array.from(current.values()));
    };

    const addRunningHubWorkflow = async () => {
        if (!isRunningHubChannel(draft)) return;
        setRunningHubWorkflowLoading(true);
        try {
            const workflowId = runningHubWorkflowId.trim();
            await fetchRunningHubWorkflowJson(draft, workflowId);
            const model = buildRunningHubWorkflowModel(`SeedVR2 高清放大 · ${workflowId}`, workflowId);
            if (draft.models.some((item) => item.name === model.name)) return;
            patch({ models: [...draft.models, model] });
            message.success(`已验证并添加工作流 ${workflowId}`);
        } catch (error) {
            Modal.error({ title: "RunningHub 工作流添加失败", content: error instanceof Error ? error.message : "请填写有效的工作流 ID" });
        } finally {
            setRunningHubWorkflowLoading(false);
        }
    };

    const syncReferenceRunningHubWorkflows = () => {
        if (!isRunningHubChannel(draft)) return;
        const selected = new Set(selectedReferenceWorkflowIds);
        const referenceIds = new Set(RUNNINGHUB_REFERENCE_WORKFLOWS.map((item) => item.id));
        const preserved = draft.models.filter((model) => !Array.from(referenceIds).some((id) => model.name.includes(id)));
        const imported = RUNNINGHUB_REFERENCE_WORKFLOWS.filter((item) => selected.has(item.id)).map((item) =>
            item.id === RUNNINGHUB_SEEDVR2_WORKFLOW_ID ? buildRunningHubWorkflowModel(`${item.name} · ${item.id}`, item.id) : buildRunningHubReferenceWorkflowModel(item.name, item.id),
        );
        const nextModels = [...preserved, ...imported];
        const availableUpscaleModels = nextModels.filter((model) => model.capability === "image" && !/2053691179258134529|(?:去水印|去字幕|去模糊).*ltx2\.3/i.test(model.name) && model.script && /RUNNINGHUB_(?:WORKFLOW|PROJECT_WORKFLOW)_V1/i.test(model.script));
        const defaultModel = availableUpscaleModels.some((model) => model.name === draft.runningHubSuperResolutionModel) ? draft.runningHubSuperResolutionModel : availableUpscaleModels[0]?.name || "";
        patch({ models: nextModels, runningHubSuperResolutionModel: defaultModel });
        message.success(`已同步 ${imported.length} 个 RunningHub 工作流`);
    };

    const importComfyUIWorkflow = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
            const workflow = JSON.parse(await file.text()) as unknown;
            const baseName = file.name.replace(/[.]json$/i, "").trim() || "ComfyUI 工作流";
            let name = baseName;
            let suffix = 2;
            while (draft.models.some((model) => model.name === name)) name = `${baseName} ${suffix++}`;
            const model = buildComfyUIWorkflowModel(name, workflow);
            patch({
                name: isComfyUIChannel(draft) ? draft.name : "ComfyUI",
                baseUrl: isComfyUIChannel(draft) ? draft.baseUrl : "http://127.0.0.1:8188",
                apiKey: draft.apiKey || "local-comfyui",
                models: [...draft.models, model],
            });
        } catch (error) {
            Modal.error({ title: "工作流导入失败", content: error instanceof Error ? error.message : "请检查 JSON 文件" });
        }
    };

    const save = () => {
        onSave({ ...draft, name: draft.name.trim() || "未命名渠道", pricingUrl: draft.pricingUrl?.trim() || "", models: normalizeChannelModels(draft.models) });
        onClose();
    };

    const upscaleWorkflowModels = draft.models.filter((model) => model.capability === "image" && !/2053691179258134529|(?:去水印|去字幕|去模糊).*ltx2\.3/i.test(model.name) && model.script && /RUNNINGHUB_(?:WORKFLOW|PROJECT_WORKFLOW)_V1/i.test(model.script));

    return (
        <Drawer
            open={open}
            size={640}
            title="编辑渠道"
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" onClick={save}>
                        保存
                    </Button>
                </Space>
            }
        >
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">渠道名称</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">协议</span>
                    <Select className="w-full" value={draft.apiFormat} options={apiFormatOptions} onChange={changeApiFormat} />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">接口地址</span>
                    <Input value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">定价来源 URL</span>
                    <Input value={draft.pricingUrl || ""} onChange={(event) => patch({ pricingUrl: event.target.value })} placeholder="例如 https://deepkey.top/console/modelsquare" />
                    <span className="mt-1 block text-[11px] text-stone-500">支持 DeepKey、APIMart、ToAPIs。ToAPIs 使用官方 `/api/pricing` 自动读取模型目录，不依赖浏览器登录 Cookie。</span>
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">定价抓取代理 URL</span>
                    <Input value={draft.pricingProxyUrl || ""} onChange={(event) => patch({ pricingProxyUrl: event.target.value })} placeholder="留空自动读取系统代理，例如 http://127.0.0.1:7897" />
                    <span className="mt-1 block text-[11px] text-stone-500">仅用于本地 Agent 抓取定价页，不影响模型 API。留空时依次读取 HTTPS_PROXY、HTTP_PROXY 和 Windows 系统代理。</span>
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">美元/额度换算比例</span>
                    <Input
                        type="number"
                        min={0.01}
                        max={100}
                        step={0.01}
                        value={draft.pricingExchangeRate ?? ""}
                        placeholder={`站点默认：$1 = ¥${pricingExchangeRateForChannel({ ...draft, pricingExchangeRate: undefined })}`}
                        addonBefore="$1 = ¥"
                        onChange={(event) => patch({ pricingExchangeRate: event.target.value ? Number(event.target.value) : undefined })}
                    />
                    <span className="mt-1 block text-[11px] text-stone-500">充值额度站可填 1；按真实美元换算的站点可填当前汇率。留空使用站点默认值。</span>
                </label>
                {isComfyUIChannel(draft) ? (
                    <div className="rounded-md bg-stone-100 px-3 py-2 text-xs text-stone-600 md:col-span-2 dark:bg-stone-900 dark:text-stone-300">
                        ComfyUI 使用本地连接，不需要 API Key。请使用 <code>--enable-cors-header *</code> 启动 ComfyUI，并确保上面的地址可从当前浏览器访问。
                    </div>
                ) : (
                    <label className="block md:col-span-2">
                        <span className="mb-1 block text-sm font-medium">{isRunningHubChannel(draft) ? "消费级-会员 API Key" : "API Key"}</span>
                        <Input.Password value={draft.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} placeholder={isModelScopeChannel(draft) ? "ModelScope Access Token" : "sk-..."} />
                    </label>
                )}
                {isRunningHubChannel(draft) ? (
                    <>
                        <label className="block md:col-span-2">
                            <span className="mb-1 block text-sm font-medium">企业级-共享 API Key</span>
                            <Input.Password value={draft.walletApiKey || ""} onChange={(event) => patch({ walletApiKey: event.target.value })} placeholder="可选，用于账户余额扣费" />
                        </label>
                        <label className="block md:col-span-2">
                            <span className="mb-1 block text-sm font-medium">默认扣费方式</span>
                            <Select<RunningHubKeyMode>
                                className="w-full"
                                value={draft.runningHubKeyMode || "auto"}
                                options={[{ label: "自动（优先消费级-会员，无则企业级-共享）", value: "auto" }, { label: "消费级-会员", value: "rh" }, { label: "企业级-共享", value: "wallet" }]}
                                onChange={(value) => patch({ runningHubKeyMode: value })}
                            />
                        </label>
                    </>
                ) : null}
            </div>

            {isModelScopeChannel(draft) ? <div className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">国内默认地址为 https://api-inference.modelscope.cn。图片模型使用异步任务提交与轮询，文本模型使用 OpenAI 兼容接口。</div> : null}

            {isRunningHubChannel(draft) ? (
                <div className="mt-3 grid gap-2 rounded-md bg-blue-50 px-3 py-3 text-xs text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                    <span>RunningHub 工作流 ID（默认 SeedVR2 高清放大）</span>
                    <span className="text-[11px] opacity-75">官方接口支持按 ID 获取工作流 JSON，但没有账号工作流列表接口，因此需要先从 RunningHub 控制台复制工作流 ID。</span>
                    <div className="flex gap-2">
                        <Input value={runningHubWorkflowId} onChange={(event) => setRunningHubWorkflowId(event.target.value)} placeholder={RUNNINGHUB_SEEDVR2_WORKFLOW_ID} />
                        <Button loading={runningHubWorkflowLoading} icon={<Workflow className="size-4" />} onClick={() => void addRunningHubWorkflow()}>验证并添加超分工作流</Button>
                    </div>
                    <div className="rounded-lg border border-blue-200/70 bg-white/60 p-2 dark:border-blue-900/60 dark:bg-blue-950/20">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="font-medium">参考项目工作流</span>
                            <span className="opacity-70">已选 {selectedReferenceWorkflowIds.length} / {RUNNINGHUB_REFERENCE_WORKFLOWS.length}</span>
                        </div>
                        <div className="grid gap-1 sm:grid-cols-2">
                            {RUNNINGHUB_REFERENCE_WORKFLOWS.map((item) => (
                                <Checkbox key={item.id} checked={selectedReferenceWorkflowIds.includes(item.id)} onChange={(event) => setSelectedReferenceWorkflowIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))}>
                                    <span className="text-xs" title={`${item.name} · ${item.id}`}>{item.name}</span>
                                </Checkbox>
                            ))}
                        </div>
                        <Button className="mt-2" block icon={<Workflow className="size-4" />} onClick={syncReferenceRunningHubWorkflows}>同步勾选的工作流</Button>
                        <label className="mt-2 block">
                            <span className="mb-1 block font-medium">AI 超分默认工作流</span>
                            <Select className="w-full" allowClear placeholder="选择默认高清放大工作流" value={draft.runningHubSuperResolutionModel || undefined} options={upscaleWorkflowModels.map((model) => ({ label: model.name, value: model.name }))} onChange={(value) => patch({ runningHubSuperResolutionModel: value || "" })} />
                        </label>
                    </div>
                </div>
            ) : null}

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">渠道模型库</div>
                    <div className="mt-0.5 text-xs text-stone-500">模型库 {draft.models.length} 个；保存后到“模型”页决定哪些模型启用。</div>
                </div>
                <Button type="primary" icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)}>
                    维护模型库
                </Button>
                {isMiniMaxChannel(draft) ? (
                    <Button icon={<Music2 className="size-4" />} onClick={addMiniMaxAudioModels}>
                        添加 TTS / Music
                    </Button>
                ) : null}
                {isComfyUIChannel(draft) ? (
                    <Button icon={<Workflow className="size-4" />} onClick={() => workflowInputRef.current?.click()}>导入 ComfyUI 工作流</Button>
                ) : null}
            </div>

            <input ref={workflowInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void importComfyUIWorkflow(event)} />

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {draft.models.length ? (
                    draft.models.map((model) => (
                        <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                {model.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                                <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                    {model.script ? "脚本已设" : "调用脚本"}
                                </Button>
                                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">点击「维护模型库」拉取或手动增加模型。</div>
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />
        </Drawer>
    );
}

function isMiniMaxChannel(channel: Pick<ModelChannel, "name" | "baseUrl">) {
    if (/minimax/i.test(channel.name)) return true;
    try {
        const hostname = new URL(channel.baseUrl).hostname.toLowerCase();
        return hostname === "api.minimaxi.com" || hostname.endsWith(".minimaxi.com");
    } catch {
        return /minimaxi[.]com/i.test(channel.baseUrl);
    }
}
