import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, ReactNode, SyntheticEvent } from "react";
import { Button, Input, InputNumber, Segmented, Select, Switch, Tooltip } from "antd";
import { ArrowRight, Check, ClipboardPaste, Hash, Image as ImageIcon, ListOrdered, Pin, Plus, Repeat2, ShoppingBag, Sparkles, Square, TextCursorInput, Trash2, Upload, Workflow, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { parseNumberedLoopPrompts } from "@/lib/canvas/canvas-loop-prompts";
import { useThemeStore } from "@/stores/use-theme-store";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

type Props = {
    node: CanvasNodeData;
    inputs?: NodeGenerationInput[];
    steps?: CanvasNodeData[];
    fixedReferenceCandidates?: CanvasNodeData[];
    isRunning: boolean;
    embedded?: boolean;
    onChange: (patch: Partial<CanvasNodeMetadata>) => void;
    onUploadFixedReference?: (files: File[]) => void;
    onRun: () => void;
    onStop: () => void;
};

const DEFAULT_PROMPT = "";

type LoopTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

function ToggleSetting({ icon, title, description, checked, disabled = false, theme, onChange }: { icon: ReactNode; title: string; description: string; checked: boolean; disabled?: boolean; theme: LoopTheme; onChange: (checked: boolean) => void }) {
    return (
        <label
            className={`flex min-w-0 items-center gap-2.5 rounded-md border px-2.5 py-2 transition-colors ${disabled ? "cursor-default opacity-50" : "cursor-pointer"}`}
            style={{ borderColor: checked ? `${theme.node.activeStroke}55` : theme.toolbar.border, background: checked ? theme.toolbar.activeBg : theme.node.fill }}
        >
            <span className="grid size-7 shrink-0 place-items-center rounded" style={{ background: theme.toolbar.panel, color: checked ? theme.node.activeStroke : theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium leading-4">{title}</span>
                <span className="block truncate text-[10px] opacity-50" title={description}>{description}</span>
            </span>
            <Switch size="small" checked={checked} disabled={disabled} onChange={onChange} />
        </label>
    );
}

function displayLoopTokens(value: string) {
    return value
        .replaceAll("《素材序号》", "{{i}}")
        .replaceAll("《输入序号》", "{{i}}")
        .replaceAll("《计数》", "{{i}}")
        .replaceAll("《当前轮次》", "{{r}}")
        .replaceAll("《总轮数》", "{{n}}")
        .replaceAll("《总数》", "{{n}}")
        .replaceAll("《进度》", "{{r}}/{{n}}");
}

function loopPromptValues(node: CanvasNodeData) {
    if (node.metadata?.loopPrompts?.length) return node.metadata.loopPrompts.map(displayLoopTokens);
    const legacy = node.metadata?.loopPrompt?.trim();
    return legacy ? [displayLoopTokens(legacy)] : [DEFAULT_PROMPT];
}

function highlightedPromptParts(value: string) {
    return value.split(/(@固定图|\{\{[irn]\}\})/g).filter(Boolean);
}

function isPromptParameter(value: string) {
    return value === "@固定图" || /^\{\{[irn]\}\}$/.test(value);
}

function parseBulkLoopPrompts(value: string) {
    const numbered = parseNumberedLoopPrompts(value);
    if (numbered.length) return numbered;
    return value
        .replace(/\r\n?/g, "\n")
        .split(/\n\s*\n|\n/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function loopTargetPrompt(node: CanvasNodeData) {
    if (node.type === "config") return node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
    return node.metadata?.prompt ?? (node.type === "text" ? node.metadata?.content ?? "" : "");
}

export function CanvasLoopNodePanel({ node, inputs = [], steps = [], fixedReferenceCandidates = [], isRunning, embedded = false, onChange, onUploadFixedReference, onRun, onStop }: Props) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const promptParameterColor = colorTheme === "dark" ? "#7dd3fc" : "#0369a1";
    const surface = colorTheme === "dark" ? "#211f1c" : "#fffefa";
    const softSurface = colorTheme === "dark" ? "rgba(255,255,255,.035)" : "rgba(41,37,36,.035)";
    const raisedSurface = colorTheme === "dark" ? "#292622" : "#ffffff";
    const panelShadow = colorTheme === "dark"
        ? "0 14px 36px rgba(0,0,0,.24)"
        : "0 14px 38px rgba(54,48,40,.075), 0 2px 8px rgba(54,48,40,.04)";
    const [activePromptIndex, setActivePromptIndex] = useState(0);
    const [bulkPromptInput, setBulkPromptInput] = useState("");
    const [showBulkPromptInput, setShowBulkPromptInput] = useState(false);
    const promptSelectionRef = useRef({ index: 0, start: 0, end: 0 });
    const fixedReferenceUploadRef = useRef<HTMLInputElement>(null);
    const count = Math.max(1, Math.min(100, Number(node.metadata?.loopCount) || 1));
    const start = Math.max(1, Math.min(9999, Number(node.metadata?.loopStart) || 1));
    const batchSize = Math.max(1, Math.min(100, Number(node.metadata?.loopImageBatchSize) || 1));
    const mode = node.metadata?.loopMode === "parallel" ? "parallel" : "serial";
    const taskMode = node.metadata?.loopTaskMode === "selling-points" ? "selling-points" : "standard";
    const sellingPointMode = taskMode === "selling-points";
    const imageInput = node.metadata?.loopImageInput !== false;
    const promptEnabled = node.metadata?.loopPromptEnabled !== false;
    const useTargetPrompts = node.metadata?.loopUseTargetPrompts !== false;
    const fixedReferenceNodeIds = node.metadata?.loopFixedReferenceNodeIds?.length
        ? Array.from(new Set(node.metadata.loopFixedReferenceNodeIds))
        : node.metadata?.loopFixedReferenceNodeId ? [node.metadata.loopFixedReferenceNodeId] : [];
    const fixedReferences = fixedReferenceNodeIds
        .map((id) => fixedReferenceCandidates.find((candidate) => candidate.id === id))
        .filter((candidate): candidate is CanvasNodeData => Boolean(candidate));
    const prompts = loopPromptValues(node);
    const images = inputs.filter((input) => input.type === "image" && input.image && !fixedReferenceNodeIds.includes(input.nodeId));
    const texts = inputs.filter((input) => input.type === "text" && input.text);
    const sellingPointStep = steps
        .map((step) => ({ step, items: parseNumberedLoopPrompts(loopTargetPrompt(step)) }))
        .find((candidate) => candidate.items.length >= 2);
    const sellingPointText = texts
        .map((input) => ({ input, items: parseNumberedLoopPrompts(input.text || "") }))
        .find((candidate) => candidate.items.length >= 2);
    const localSellingPointPrompt = node.metadata?.loopSellingPointPrompt || "";
    const localSellingPointItems = parseNumberedLoopPrompts(localSellingPointPrompt).slice(0, 100);
    const externalSellingPointItems = (sellingPointStep?.items || sellingPointText?.items || []).slice(0, 100);
    const hasLocalSellingPointPrompt = Boolean(localSellingPointPrompt.trim());
    const sellingPointItems = hasLocalSellingPointPrompt ? localSellingPointItems : externalSellingPointItems;
    const sellingPointSource = hasLocalSellingPointPrompt
        ? "循环节点内填写"
        : sellingPointStep
            ? `自动识别：右侧「${sellingPointStep.step.title || "生成模板"}」`
            : sellingPointText ? `自动识别：上游「${sellingPointText.input.title || "文本"}」` : "";
    const productReferenceCount = (sellingPointMode || imageInput ? images.length : 0) + fixedReferences.length;
    const hasInputSequence = images.length > 0 || texts.length > 0;
    const inputCount = Math.max(images.length, texts.length);
    const directImageGeneration = steps.length === 0;
    const sellingPointReady = sellingPointItems.length >= count && productReferenceCount > 0;
    const canRun = sellingPointMode
        ? sellingPointReady
        : !directImageGeneration || (promptEnabled && (texts.length > 0 || prompts.some((prompt) => prompt.trim())));
    const showStartInput = !sellingPointMode && inputCount > 1;

    useEffect(() => {
        if (!sellingPointMode || node.metadata?.loopSellingPointConcurrencyVersion === 1) return;
        onChange({ loopMode: "serial", loopSellingPointConcurrencyVersion: 1 });
    }, [node.metadata?.loopSellingPointConcurrencyVersion, onChange, sellingPointMode]);

    const updatePrompts = (next: string[]) => {
        const normalized = next.length ? next : [""];
        onChange({
            loopPrompts: normalized,
            loopPrompt: normalized.filter(Boolean).join("\n"),
            ...(normalized.length !== prompts.length ? { loopCount: normalized.length } : {}),
        });
    };
    const applyBulkPrompts = (value = bulkPromptInput) => {
        const parsed = parseBulkLoopPrompts(value).slice(0, 100);
        if (!parsed.length) return;
        onChange({ loopPrompts: parsed, loopPrompt: parsed.join("\n"), loopCount: parsed.length });
        setBulkPromptInput("");
        setShowBulkPromptInput(false);
        setActivePromptIndex(0);
        promptSelectionRef.current = { index: 0, start: 0, end: 0 };
    };
    const updateSellingPointPrompt = (value: string) => {
        const items = parseNumberedLoopPrompts(value).slice(0, 100);
        onChange({
            loopSellingPointPrompt: value,
            ...(items.length >= 2 ? { loopCount: items.length } : {}),
        });
    };
    const importExternalSellingPoints = () => {
        if (!externalSellingPointItems.length) return;
        const value = externalSellingPointItems.map((item, index) => `${index + 1}. ${item}`).join("\n");
        onChange({
            loopSellingPointPrompt: value,
            loopCount: externalSellingPointItems.length,
        });
    };
    const handlePromptPaste = (index: number, event: ClipboardEvent<HTMLTextAreaElement>) => {
        const parsed = parseNumberedLoopPrompts(event.clipboardData.getData("text"));
        if (parsed.length < 2) return;
        event.preventDefault();
        const next = [...prompts.slice(0, index), ...parsed, ...prompts.slice(index + 1)].slice(0, 100);
        onChange({ loopPrompts: next, loopPrompt: next.filter(Boolean).join("\n"), loopCount: next.length });
    };
    const insertToken = (token: string) => {
        const index = Math.min(promptSelectionRef.current.index ?? activePromptIndex, prompts.length - 1);
        const value = prompts[index] || "";
        const start = Math.min(value.length, promptSelectionRef.current.start);
        const end = Math.min(value.length, Math.max(start, promptSelectionRef.current.end));
        updatePrompts(prompts.map((item, itemIndex) => (itemIndex === index ? `${value.slice(0, start)}${token}${value.slice(end)}` : item)));
        window.requestAnimationFrame(() => {
            const caret = start + token.length;
            const textarea = document.querySelector<HTMLTextAreaElement>(`textarea[data-loop-prompt-index="${index}"]`);
            if (!textarea) return;
            textarea.focus();
            textarea.setSelectionRange(caret, caret);
            promptSelectionRef.current = { index, start: caret, end: caret };
        });
    };
    const rememberPromptSelection = (index: number, event: SyntheticEvent<HTMLTextAreaElement>) => {
        const target = event.currentTarget;
        setActivePromptIndex(index);
        promptSelectionRef.current = { index, start: target.selectionStart, end: target.selectionEnd };
    };
    const preservePromptSelection = (event: SyntheticEvent) => event.preventDefault();
    const stopControlPointer = (event: SyntheticEvent) => {
        const target = event.target as HTMLElement;
        if (target.closest("button,input,textarea,.ant-segmented,.ant-select,.ant-select-dropdown,.ant-switch")) event.stopPropagation();
    };
    const changeTaskMode = (value: string | number) => {
        const nextMode = value === "selling-points" ? "selling-points" : "standard";
        if (nextMode === "selling-points") {
            onChange({
                loopTaskMode: nextMode,
                loopImageInput: true,
                loopUseTargetPrompts: true,
                loopMode: "serial",
                loopSellingPointConcurrencyVersion: 1,
                ...(sellingPointItems.length ? { loopCount: sellingPointItems.length } : {}),
            });
            return;
        }
        onChange({ loopTaskMode: nextMode });
    };

    return (
        <div
            className={`${embedded ? "h-full" : "max-h-[72vh] rounded-[18px] border"} flex min-h-0 flex-col overflow-hidden text-xs`}
            style={{ color: theme.node.text, background: embedded ? "transparent" : surface, borderColor: theme.toolbar.border, boxShadow: embedded ? undefined : panelShadow }}
            onMouseDown={stopControlPointer}
            onPointerDown={stopControlPointer}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-3.5 pb-5 thin-scrollbar">
            <section className="space-y-2.5 rounded-[14px] border p-3" style={{ borderColor: theme.toolbar.border, background: raisedSurface, boxShadow: "0 1px 2px rgba(0,0,0,.025)" }}>
                <div className="flex items-center gap-2 pb-0.5">
                    <span className="grid size-5 place-items-center rounded-md text-[9px] font-semibold tabular-nums" style={{ color: theme.node.muted, background: softSurface }}>01</span>
                    <span className="text-[13px] font-semibold tracking-[-0.01em]">生成规则</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <div className="text-[12px] font-medium">任务类型</div>
                        <div className="text-[10px] opacity-45">{sellingPointMode ? "按编号卖点逐张生成，商品图保持一致" : "按自定义指令重复整条流程"}</div>
                    </div>
                    <Segmented
                        size="small"
                        className="shrink-0 !rounded-lg !p-0.5 [&_.ant-segmented-item]:!min-h-7 [&_.ant-segmented-item]:!rounded-md [&_.ant-segmented-item-label]:!px-2.5 [&_.ant-segmented-item-label]:!leading-7"
                        value={taskMode}
                        options={[
                            { label: "通用循环", value: "standard" },
                            { label: <span className="inline-flex items-center gap-1"><ShoppingBag className="size-3" />卖点图</span>, value: "selling-points" },
                        ]}
                        onChange={changeTaskMode}
                    />
                </div>
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <div className="text-[12px] font-medium">运行方式</div>
                        <div className="text-[10px] opacity-45">{sellingPointMode ? `按顺序更稳定；共生成 ${count} 张` : directImageGeneration ? `根据文字生成 ${count} 张图片` : `整条处理流程重复 ${count} 次`}</div>
                    </div>
                    <Segmented
                        size="small"
                        className="shrink-0 !rounded-lg !p-0.5 [&_.ant-segmented-item]:!min-h-7 [&_.ant-segmented-item]:!rounded-md [&_.ant-segmented-item-label]:!px-2.5 [&_.ant-segmented-item-label]:!leading-7"
                        value={mode}
                        options={[
                            { label: "按顺序", value: "serial" },
                            { label: "同时运行", value: "parallel" },
                        ]}
                        onChange={(value) => onChange({
                            loopMode: value as "serial" | "parallel",
                            ...(sellingPointMode ? { loopSellingPointConcurrencyVersion: 1 } : {}),
                        })}
                    />
                </div>

                <div className="rounded-[10px] border p-2.5" style={{ borderColor: theme.toolbar.border, background: softSurface }}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 font-medium"><Workflow className="size-3.5 opacity-60" />处理步骤</span>
                        {steps.length ? <span className="text-[10px] opacity-45">右侧 · {steps.length} 步</span> : null}
                    </div>
                    {steps.length ? (
                        <div className="flex min-w-0 items-center gap-1 overflow-x-auto pb-0.5 thin-scrollbar">
                            {steps.map((step, index) => (
                                <div key={step.id} className="flex min-w-0 shrink-0 items-center gap-1">
                                    {index ? <ArrowRight className="size-3 shrink-0 opacity-30" /> : null}
                                    <span className="flex max-w-[150px] items-center gap-1.5 truncate rounded px-2 py-1 text-[11px]" style={{ background: theme.toolbar.itemHover }} title={step.title}>
                                        <span className="opacity-40">{index + 1}</span>
                                        <span className="truncate">{step.title || `步骤 ${index + 1}`}</span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-[11px] leading-4">
                            <ImageIcon className="size-3.5 shrink-0 opacity-60" />
                            <span><strong className="font-medium">直接生图</strong><br /><span className="opacity-50">使用当前默认图片模型，每轮生成 1 张</span></span>
                        </div>
                    )}
                </div>
            </section>

            <section className="space-y-2.5">
                <div className="flex items-center gap-2 px-0.5">
                    <span className="grid size-5 place-items-center rounded-md text-[9px] font-semibold tabular-nums" style={{ color: theme.node.muted, background: softSurface }}>02</span>
                    <div>
                        <div className="text-[13px] font-semibold tracking-[-0.01em]">循环内容</div>
                        <div className="text-[10px] opacity-45">{sellingPointMode ? "每条卖点对应一张图，商品主体保持一致" : "设置每轮使用的指令和参考素材"}</div>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                    {sellingPointMode ? (
                        <div className="col-span-2 space-y-2.5 rounded-[14px] border p-3" style={{ borderColor: sellingPointItems.length ? `${theme.node.activeStroke}42` : theme.toolbar.border, background: raisedSurface, boxShadow: "0 1px 2px rgba(0,0,0,.025)" }}>
                            <div className="flex items-center gap-2">
                                <span className="grid size-8 place-items-center rounded-[9px]" style={{ background: softSurface, color: theme.node.activeStroke }}><Sparkles className="size-4" /></span>
                                <div className="min-w-0 flex-1">
                                    <div className="text-[12px] font-semibold">卖点清单</div>
                                    <div className="truncate text-[10px] opacity-50">{sellingPointSource || "直接在下方填写，每条卖点生成一张图"}</div>
                                </div>
                                <span className="rounded-full border px-2 py-1 text-[10px] font-medium tabular-nums" style={{ borderColor: theme.toolbar.border, background: softSurface, color: sellingPointItems.length ? theme.node.activeStroke : theme.node.muted }}>
                                    {sellingPointItems.length ? `${sellingPointItems.length} 条` : "未识别"}
                                </span>
                            </div>
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-medium opacity-70">直接填写（推荐）</span>
                                    {!hasLocalSellingPointPrompt && externalSellingPointItems.length ? (
                                        <Button size="small" type="link" className="!h-6 !px-1" onClick={importExternalSellingPoints}>
                                            导入已识别清单
                                        </Button>
                                    ) : null}
                                </div>
                                <Input.TextArea
                                    value={localSellingPointPrompt}
                                    className="!rounded-[10px] !px-3 !py-2.5 !text-[12px] !leading-5"
                                    autoSize={{ minRows: 3, maxRows: 7 }}
                                    placeholder={"1. 主视觉白底图\n2. 防水材质特写\n3. 鞋底防滑展示"}
                                    onChange={(event) => updateSellingPointPrompt(event.target.value)}
                                />
                                <div className="text-[10px] opacity-50">每条另起一行，以 1.、2.、3. 开头；填写后自动同步生成张数</div>
                                {hasLocalSellingPointPrompt && localSellingPointItems.length < 2 ? (
                                    <div className="rounded-md border px-2 py-1.5 text-[10px] leading-4" style={{ borderColor: "#f59e0b66", color: "#b45309", background: "#f59e0b0d" }}>
                                        至少填写 2 条，并让每条以编号开头、单独占一行。
                                    </div>
                                ) : null}
                            </div>
                            {!hasLocalSellingPointPrompt && sellingPointItems.length ? (
                                <>
                                    <div className="space-y-1">
                                        {sellingPointItems.slice(0, 3).map((item, index) => (
                                            <div key={`${index}-${item}`} className="grid grid-cols-[20px_minmax(0,1fr)] gap-1.5 rounded px-2 py-1.5" style={{ background: theme.toolbar.itemHover }}>
                                                <span className="grid size-5 place-items-center rounded text-[10px] tabular-nums" style={{ background: theme.toolbar.panel }}>{index + 1}</span>
                                                <span className="line-clamp-2 leading-5 opacity-75">{item}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="flex items-center justify-between gap-2 text-[10px]">
                                        <span className="opacity-50">第 N 轮只发送第 N 条，不把整份清单交给模型猜</span>
                                        {count !== sellingPointItems.length ? (
                                            <Button size="small" type="link" className="!h-6 !px-1" onClick={() => onChange({ loopCount: sellingPointItems.length })}>同步为 {sellingPointItems.length} 张</Button>
                                        ) : null}
                                    </div>
                                </>
                            ) : sellingPointItems.length ? (
                                <div className="flex items-center justify-between gap-2 text-[10px]">
                                    <span className="opacity-50">第 N 轮只发送第 N 条，不把整份清单交给模型猜</span>
                                    {count !== sellingPointItems.length ? (
                                        <Button size="small" type="link" className="!h-6 !px-1" onClick={() => onChange({ loopCount: sellingPointItems.length })}>同步为 {sellingPointItems.length} 张</Button>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <>
                            <ToggleSetting
                                icon={<ImageIcon className="size-3.5" />}
                                title="附加输入（可选）"
                                description="使用左侧连接的额外素材"
                                checked={imageInput}
                                theme={theme}
                                onChange={(checked) => onChange({ loopImageInput: checked })}
                            />
                            <ToggleSetting
                                icon={<Workflow className="size-3.5" />}
                                title="沿用每步指令"
                                description={steps.length ? "保留右侧节点原提示词" : "连接右侧处理节点后可用"}
                                checked={useTargetPrompts}
                                disabled={directImageGeneration}
                                theme={theme}
                                onChange={(checked) => onChange({ loopUseTargetPrompts: checked })}
                            />
                        </>
                    )}
                    {!sellingPointMode ? <div className="col-span-2">
                        <ToggleSetting
                            icon={<TextCursorInput className="size-3.5" />}
                            title="每轮指令"
                            description="每轮可不同，也可粘贴编号列表"
                            checked={promptEnabled}
                            theme={theme}
                            onChange={(checked) => onChange({ loopPromptEnabled: checked })}
                        />
                    </div> : null}
                    <div className="col-span-2 space-y-2.5 rounded-[14px] border p-3" style={{ borderColor: theme.toolbar.border, background: raisedSurface, boxShadow: "0 1px 2px rgba(0,0,0,.025)" }}>
                        <div className="flex items-center gap-2">
                            <span className="grid size-8 place-items-center rounded-[9px]" style={{ background: softSurface }}><Pin className="size-4 opacity-65" /></span>
                            <div className="min-w-0 flex-1">
                                <div className="text-[12px] font-semibold">{sellingPointMode ? "商品参考素材" : "固定参考图"}</div>
                                <div className="text-[10px] opacity-45">{sellingPointMode ? "每轮全部复用，确保商品外观一致" : "可选，多张图片会在每轮固定复用"}</div>
                            </div>
                            <span className="rounded-full border px-2 py-1 text-[10px] tabular-nums" style={{ borderColor: theme.toolbar.border, background: softSurface }}>
                                {productReferenceCount} 张
                            </span>
                        </div>
                        <input
                            ref={fixedReferenceUploadRef}
                            hidden
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(event) => {
                                const files = Array.from(event.target.files || []);
                                event.target.value = "";
                                if (files.length) onUploadFixedReference?.(files);
                            }}
                        />
                        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
                            <Button size="small" className="!h-8 !rounded-lg" icon={<Upload className="size-3.5" />} onClick={() => fixedReferenceUploadRef.current?.click()}>
                                上传图片
                            </Button>
                            <Select
                                mode="multiple"
                                allowClear
                                showSearch
                                className="min-w-0 [&_.ant-select-selector]:!min-h-8 [&_.ant-select-selector]:!rounded-lg"
                                placeholder="或从画布选择"
                                value={fixedReferenceNodeIds}
                                maxTagCount={1}
                                maxTagPlaceholder={(omitted) => `+${omitted.length}`}
                                optionFilterProp="label"
                                options={fixedReferenceCandidates.map((candidate) => ({
                                    value: candidate.id,
                                    label: `${candidate.metadata?.globalImageId || "图片"} · ${candidate.title || "未命名图片"}`,
                                }))}
                                onChange={(values) => onChange({ loopFixedReferenceNodeIds: values, loopFixedReferenceNodeId: undefined })}
                            />
                        </div>
                        {sellingPointMode && images.length ? (
                            <div className="rounded-[10px] border p-2.5" style={{ borderColor: theme.toolbar.border, background: softSurface }}>
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-medium opacity-65">左侧已连接</span>
                                    <span className="text-[10px] opacity-45">{images.length} 张 · 每轮全部使用</span>
                                </div>
                                <div className="flex min-w-0 gap-2 overflow-x-auto pb-0.5 thin-scrollbar">
                                    {images.map((input) => (
                                        <div key={input.nodeId} className="group relative shrink-0">
                                            <img src={input.image?.dataUrl} alt={input.title} title={input.title} className="size-12 rounded-lg border object-cover" style={{ borderColor: theme.node.stroke }} />
                                            <span className="pointer-events-none absolute inset-x-1 bottom-1 truncate rounded bg-black/55 px-1 py-0.5 text-center text-[8px] text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
                                                {input.title || "商品图"}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                        {fixedReferences.length ? (
                            <div className="space-y-1.5">
                                <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 thin-scrollbar">
                                    {fixedReferences.map((reference) => (
                                        <div key={reference.id} className="group relative shrink-0" title={reference.title || "固定参考图"}>
                                            <img src={reference.metadata?.content} alt={reference.title} className="size-12 rounded-lg border object-cover" style={{ borderColor: theme.node.stroke }} />
                                            <button
                                                type="button"
                                                aria-label={`移除固定参考图 ${reference.title || "未命名图片"}`}
                                                className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full border bg-black/70 text-white opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                                style={{ borderColor: colorTheme === "dark" ? "rgba(255,255,255,.2)" : "rgba(255,255,255,.85)" }}
                                                onClick={() => onChange({ loopFixedReferenceNodeIds: fixedReferenceNodeIds.filter((id) => id !== reference.id), loopFixedReferenceNodeId: undefined })}
                                            >
                                                <X className="size-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <div className="px-0.5 text-[10px] opacity-50">
                                    {sellingPointMode ? `另有 ${fixedReferences.length} 张固定商品图，每轮全部使用` : `每轮固定使用这 ${fixedReferences.length} 张图，@固定图 代表全部`}
                                </div>
                            </div>
                        ) : !images.length || !sellingPointMode ? <div className="text-[10px] opacity-45">{sellingPointMode ? "可上传商品多视角，或从画布多选；连接到左侧的商品图也会自动使用" : "可上传多张，或从画布多选；不选则不启用"}</div> : null}
                    </div>
                </div>
            </section>

            {imageInput && !sellingPointMode ? (
                <section className="space-y-1.5 rounded-[14px] border p-3" style={{ borderColor: theme.toolbar.border, background: raisedSurface, boxShadow: "0 1px 2px rgba(0,0,0,.025)" }}>
                    <div className="flex items-center gap-2">
                        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1 thin-scrollbar">
                            {images.length ? images.map((input) => <img key={input.nodeId} src={input.image?.dataUrl} alt={input.title} title={input.title} className="size-9 shrink-0 rounded border object-cover" style={{ borderColor: theme.node.stroke }} />) : <span className="py-1.5 opacity-50">{sellingPointMode ? "左侧还没有连接商品图" : hasInputSequence ? "附加输入中没有图片" : directImageGeneration ? "没有附加素材，将直接根据文字生成图片" : "没有附加素材，将直接重跑右侧流程"}</span>}
                        </div>
                        {images.length && !sellingPointMode ? <label className="flex shrink-0 items-center gap-1.5">
                            <span className="opacity-55">每轮</span>
                            <InputNumber size="small" min={1} max={100} value={batchSize} onChange={(value) => onChange({ loopImageBatchSize: Math.max(1, Math.min(100, Number(value) || 1)) })} className="!w-14" />
                            <span className="opacity-55">张</span>
                        </label> : null}
                    </div>
                    {images.length ? <div className="opacity-50">{sellingPointMode ? `这 ${images.length} 张商品图会在每轮全部复用` : images.length === 1 ? "这张图会在每一轮重复使用" : `已识别 ${images.length} 张附加素材，每轮依次取用`}</div> : null}
                </section>
            ) : null}

            {promptEnabled && !sellingPointMode ? (
                <section className="space-y-2 rounded-md border p-2.5" style={{ borderColor: theme.toolbar.border, background: theme.node.fill }}>
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <div className="font-medium">每轮指令</div>
                            <div className="text-[10px] opacity-45">第 1 条用于第 1 轮，一一对应</div>
                        </div>
                        <div className="flex items-center gap-0.5">
                            <Tooltip title="粘贴编号列表并自动拆分">
                                <Button
                                    aria-label="批量粘贴循环指令"
                                    size="small"
                                    type={showBulkPromptInput ? "default" : "text"}
                                    icon={<ClipboardPaste className="size-3.5" />}
                                    onClick={() => setShowBulkPromptInput((visible) => !visible)}
                                />
                            </Tooltip>
                            <Tooltip title="新增一轮指令">
                                <Button aria-label="新增循环指令" size="small" type="text" icon={<Plus className="size-4" />} onClick={() => updatePrompts([...prompts, ""])} />
                            </Tooltip>
                        </div>
                    </div>
                    {showBulkPromptInput ? (
                        <div className="space-y-2 rounded-md border p-2" style={{ borderColor: `${theme.node.activeStroke}55`, background: theme.toolbar.activeBg }}>
                            <Input.TextArea
                                autoFocus
                                value={bulkPromptInput}
                                autoSize={{ minRows: 3, maxRows: 7 }}
                                placeholder={"1. 背景换成夜晚\n2. 主角换成男生\n3. 改成电影光影"}
                                onChange={(event) => setBulkPromptInput(event.target.value)}
                                onPaste={(event) => {
                                    const pasted = event.clipboardData.getData("text");
                                    const parsed = parseNumberedLoopPrompts(pasted);
                                    if (parsed.length < 2) return;
                                    event.preventDefault();
                                    applyBulkPrompts(pasted);
                                }}
                            />
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] opacity-50">支持 1.、1)、1、或每行一条</span>
                                <div className="flex gap-1">
                                    <Button size="small" type="text" icon={<X className="size-3.5" />} onClick={() => { setBulkPromptInput(""); setShowBulkPromptInput(false); }}>取消</Button>
                                    <Button size="small" type="primary" disabled={!bulkPromptInput.trim()} icon={<Check className="size-3.5" />} onClick={() => applyBulkPrompts()}>应用</Button>
                                </div>
                            </div>
                        </div>
                    ) : null}
                    {texts.length ? (
                            <div className="space-y-1 border-l-2 pl-2" style={{ borderColor: theme.node.activeStroke }}>
                            <div className="opacity-50">上游提示词 · {texts.length} 条 · 每轮取 1 条</div>
                            <div className="line-clamp-2 leading-5 opacity-75">{texts[(start - 1) % texts.length]?.text}</div>
                        </div>
                    ) : null}
                    <div className="space-y-2">
                        {prompts.map((value, index) => (
                            <div key={index} className="grid grid-cols-[20px_1fr_28px] items-start gap-1.5">
                                <span className="grid h-7 place-items-center rounded text-[11px] tabular-nums opacity-55" style={{ background: theme.toolbar.itemHover }}>{index + 1}</span>
                                <div className="relative min-w-0">
                                    <div
                                        aria-hidden
                                        className="pointer-events-none absolute inset-px z-[1] overflow-hidden whitespace-pre-wrap break-words px-[11px] py-[6px] text-sm leading-[22px]"
                                        style={{ color: theme.node.text }}
                                    >
                                        {value ? highlightedPromptParts(value).map((part, partIndex) => (
                                            <span
                                                key={`${partIndex}-${part}`}
                                                style={isPromptParameter(part) ? { color: promptParameterColor, background: `${promptParameterColor}18`, borderRadius: 3, boxShadow: `inset 0 -1px 0 ${promptParameterColor}66` } : undefined}
                                            >
                                                {part}
                                            </span>
                                        )) : <span className="opacity-35">第 {index + 1} 轮要做什么</span>}
                                    </div>
                                    <Input.TextArea
                                        data-loop-prompt-index={index}
                                        value={value}
                                        autoSize={{ minRows: 1, maxRows: 3 }}
                                        style={{ color: "transparent", caretColor: theme.node.text, WebkitTextFillColor: "transparent" }}
                                        onPaste={(event) => handlePromptPaste(index, event)}
                                        onFocus={(event) => rememberPromptSelection(index, event)}
                                        onSelect={(event) => rememberPromptSelection(index, event)}
                                        onKeyUp={(event) => rememberPromptSelection(index, event)}
                                        onScroll={(event) => {
                                            const overlay = event.currentTarget.previousElementSibling as HTMLElement | null;
                                            if (!overlay) return;
                                            overlay.scrollTop = event.currentTarget.scrollTop;
                                            overlay.scrollLeft = event.currentTarget.scrollLeft;
                                        }}
                                        onChange={(event) => {
                                            rememberPromptSelection(index, event);
                                            updatePrompts(prompts.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)));
                                        }}
                                    />
                                </div>
                                <Tooltip title="删除提示词">
                                    <Button aria-label="删除提示词" size="small" type="text" disabled={prompts.length <= 1} icon={<Trash2 className="size-3.5" />} onClick={() => updatePrompts(prompts.filter((_, itemIndex) => itemIndex !== index))} />
                                </Tooltip>
                            </div>
                        ))}
                    </div>
                    <div className={`grid ${fixedReferences.length ? "grid-cols-4" : "grid-cols-3"} items-center gap-1.5`}>
                        {fixedReferences.length ? (
                            <Tooltip title="在当前光标位置引用全部固定参考图">
                                <Button size="small" className="!h-9 !px-1" onMouseDown={preservePromptSelection} onClick={() => insertToken("@固定图")}>
                                    <span className="flex items-center gap-1"><Pin className="size-3" /><strong className="text-[10px]" style={{ color: promptParameterColor }}>@固定图</strong></span>
                                </Button>
                            </Tooltip>
                        ) : null}
                        <Tooltip title={`第一轮从第 ${start} 个素材开始`}>
                            <Button size="small" className="!h-9 !px-1" onMouseDown={preservePromptSelection} onClick={() => insertToken("{{i}}")}>
                                <span className="flex items-center gap-1.5"><Hash className="size-3" /><strong className="font-mono text-[11px]" style={{ color: promptParameterColor }}>{"{{i}}"}</strong><span className="text-[10px] opacity-55">素材</span></span>
                            </Button>
                        </Tooltip>
                        <Tooltip title="每轮依次替换为 1、2、3……">
                            <Button size="small" className="!h-9 !px-1" onMouseDown={preservePromptSelection} onClick={() => insertToken("{{r}}")}>
                                <span className="flex items-center gap-1.5"><Repeat2 className="size-3" /><strong className="font-mono text-[11px]" style={{ color: promptParameterColor }}>{"{{r}}"}</strong><span className="text-[10px] opacity-55">轮次</span></span>
                            </Button>
                        </Tooltip>
                        <Tooltip title={`本次一共执行 ${count} 轮`}>
                            <Button size="small" className="!h-9 !px-1" onMouseDown={preservePromptSelection} onClick={() => insertToken("{{n}}")}>
                                <span className="flex items-center gap-1.5"><ListOrdered className="size-3" /><strong className="font-mono text-[11px]" style={{ color: promptParameterColor }}>{"{{n}}"}</strong><span className="text-[10px] opacity-55">总数</span></span>
                            </Button>
                        </Tooltip>
                    </div>
                </section>
            ) : null}

                {node.metadata?.status === "error" && node.metadata.errorDetails ? <div className="whitespace-pre-line rounded-md border border-red-300/60 bg-red-500/5 px-2.5 py-2 text-[11px] leading-4 text-red-500">{node.metadata.errorDetails}</div> : null}
            </div>

            <div
                className={`${showStartInput ? "grid-cols-[minmax(0,.85fr)_minmax(0,.85fr)_minmax(128px,1.3fr)]" : "grid-cols-[minmax(0,1fr)_minmax(156px,1.5fr)]"} z-10 grid min-h-[64px] shrink-0 items-end gap-2.5 border-t px-3.5 py-3`}
                style={{ borderColor: theme.toolbar.border, background: surface, boxShadow: "0 -8px 24px rgba(41,37,36,.045)" }}
            >
                {showStartInput ? <label className="space-y-1">
                    <span className="block truncate opacity-50">从第几个素材开始</span>
                    <InputNumber size="small" min={1} max={9999} value={start} onChange={(value) => onChange({ loopStart: Math.max(1, Math.min(9999, Number(value) || 1)) })} className="!h-9 !w-full !rounded-[9px]" />
                </label> : null}
                <label className="space-y-1">
                    <span className="block truncate opacity-50">{sellingPointMode ? "卖点图张数" : directImageGeneration ? "生成张数" : "重复几次"}</span>
                    <InputNumber size="small" min={1} max={100} value={count} onChange={(value) => onChange({ loopCount: Math.max(1, Math.min(100, Number(value) || 1)) })} className="!h-9 !w-full !rounded-[9px]" />
                </label>
                {isRunning ? (
                    <Button danger className="!h-9 !rounded-[9px] !font-medium" icon={<Square className="size-3.5" />} onClick={onStop}>停止 · {node.metadata?.loopRound || 0}/{count}</Button>
                ) : (
                    <Tooltip title={sellingPointMode ? (!productReferenceCount ? "请连接商品参考图" : sellingPointItems.length < count ? `只识别到 ${sellingPointItems.length} 条卖点，请减少张数或补充清单` : `逐条生成 ${count} 张卖点图`) : steps.length ? `执行 ${count} 轮，共 ${steps.length} 个处理步骤` : canRun ? `使用当前默认图片模型并发生成 ${count} 张` : "请填写每轮指令或连接文本输入"}>
                        <Button className="!h-9 !rounded-[9px] !font-semibold" type="primary" disabled={!canRun} icon={sellingPointMode ? <ShoppingBag className="size-3.5" /> : directImageGeneration ? <ImageIcon className="size-3.5" /> : <Workflow className="size-3.5" />} onClick={onRun}>
                            {sellingPointMode ? `生成 ${count} 张卖点图` : directImageGeneration ? `生成 ${count} 张` : `运行 ${count} 轮`}
                        </Button>
                    </Tooltip>
                )}
            </div>
        </div>
    );
}
