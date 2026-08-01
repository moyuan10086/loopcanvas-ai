import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowRight, ChevronRight, Group, Image as ImageIcon, LoaderCircle, Maximize2, Music2, Pause, Play, Puzzle, RefreshCw, Repeat2, ShoppingBag, Star, Video, Volume2, VolumeX } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes } from "@/lib/image-utils";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasNodeType, type CanvasNodeData, type Position } from "@/types/canvas";
import type { CanvasNodeContext, CanvasPluginHost } from "@/types/canvas-plugin";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const selectionBlue = "#2f80ff";

function nodeAccentColor(type: CanvasNodeData["type"]) {
    if (type === CanvasNodeType.Image) return "#30a46c";
    if (type === CanvasNodeType.Video) return "#8e5ad7";
    if (type === CanvasNodeType.Audio) return "#e68a00";
    if (type === CanvasNodeType.Text) return "#2f80ff";
    if (type === CanvasNodeType.Config) return "#5e5ce6";
    if (type === CanvasNodeType.Loop) return "#e5484d";
    return "#8e8e93";
}

type CanvasNodeProps = {
    data: CanvasNodeData;
    scale: number;
    isSelected: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    isConnecting: boolean;
    editRequestNonce?: number;
    showPanel: boolean;
    showImageInfo: boolean;
    resourceLabel?: CanvasResourceReference;
    loopInputOrders?: Array<{ loopId: string; loopTitle: string; index: number }>;
    mentionReferences?: CanvasResourceReference[];
    pluginHost?: CanvasPluginHost;
    registryVersion?: number;
    renderPanel?: (node: CanvasNodeData) => ReactNode;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    batchCount?: number;
    groupChildCount?: number;
    isGroupDropTarget?: boolean;
    batchExpanded?: boolean;
    batchClosing?: boolean;
    batchOpening?: boolean;
    batchRecovering?: boolean;
    batchMotion?: { x: number; y: number; index: number };
    onMouseDown: (event: React.MouseEvent, nodeId: string) => void;
    onSelectCapture?: (event: React.MouseEvent, nodeId: string) => void;
    onHoverStart: (nodeId: string) => void;
    onHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: React.MouseEvent, nodeId: string, handleType: "source" | "target") => void;
    onResize: (nodeId: string, width: number, height: number, position?: Position) => void;
    onContentChange: (nodeId: string, content: string) => void;
    onTitleChange: (nodeId: string, title: string) => void;
    onToggleBatch?: (nodeId: string) => void;
    onSetBatchPrimary?: (node: CanvasNodeData) => void;
    onRetry?: (node: CanvasNodeData) => void;
    onGenerateImage?: (node: CanvasNodeData) => void;
    onViewImage?: (node: CanvasNodeData) => void;
    onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

type NodeContentRendererProps = {
    node: CanvasNodeData;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    isEditingContent: boolean;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    pluginContext?: CanvasNodeContext | null;
    onContentChange: (nodeId: string, content: string) => void;
    onStopEditing: () => void;
    mentionReferences: CanvasResourceReference[];
    onRetry?: (node: CanvasNodeData) => void;
    onGenerateImage?: (node: CanvasNodeData) => void;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
    groupChildCount: number;
};

export const CanvasNode = React.memo(function CanvasNode({
    data,
    scale,
    isSelected,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    editRequestNonce = 0,
    showPanel,
    showImageInfo,
    resourceLabel,
    loopInputOrders = [],
    mentionReferences = [],
    pluginHost,
    renderPanel,
    renderNodeContent,
    batchCount = 0,
    groupChildCount = 0,
    isGroupDropTarget = false,
    batchExpanded = false,
    batchClosing = false,
    batchOpening = false,
    batchRecovering = false,
    batchMotion,
    onMouseDown,
    onSelectCapture,
    onHoverStart,
    onHoverEnd,
    onConnectStart,
    onResize,
    onContentChange,
    onTitleChange,
    onToggleBatch,
    onSetBatchPrimary,
    onRetry,
    onGenerateImage,
    onViewImage,
    onContextMenu,
}: CanvasNodeProps) {
    const themeName = useThemeStore((state) => state.theme);
    const theme = canvasThemes[themeName];
    const [hovered, setHovered] = useState(false);
    const definition = getNodeDefinition(data.type);
    const pluginContext = useMemo<CanvasNodeContext | null>(() => (pluginHost ? buildNodeContext(pluginHost, data, theme, scale, isSelected) : null), [pluginHost, data, theme, scale, isSelected]);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [panelSize, setPanelSize] = useState<{ width: number; height: number } | null>(null);
    const [titleDraft, setTitleDraft] = useState(data.title || "");
    const hasImageContent = data.type === CanvasNodeType.Image && Boolean(data.metadata?.content);
    const hasVideoContent = data.type === CanvasNodeType.Video && Boolean(data.metadata?.content);
    const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content);
    const isGroup = data.type === CanvasNodeType.Group;
    const isBatchRoot = data.type === CanvasNodeType.Image && Boolean(data.metadata?.isBatchRoot) && batchCount > 1;
    // 支持「交互/移动」开关的节点:移动态(默认)内容不吃指针,拖动整块;交互态内容可操作。
    // forceInteractive(如编辑态)强制可交互;空态(无内容)始终可交互,避免上传/生成按钮点不动。
    const supportsInteractionToggle = Boolean(definition?.interactionToggle);
    const forceInteractive = supportsInteractionToggle ? Boolean(definition?.forceInteractive?.(data)) : false;
    const contentInteractive = !supportsInteractionToggle || forceInteractive || !data.metadata?.content ? true : Boolean(data.metadata?.interactive);
    const isBatchChild = data.type === CanvasNodeType.Image && Boolean(data.metadata?.batchRootId);
    // 透明背景节点(如 SVG):卡片背景/边框透明,直接融入画布;选中/关联态仍显示描边以便定位
    const transparentBg = Boolean(definition?.transparentBackground);
    const isActive = isConnectionTarget || isSelected || isFocusRelated;
    const glassBackground = themeName === "light" ? "rgba(255, 255, 255, 0.75)" : "rgba(29, 29, 31, 0.72)";
    const glassBorder = themeName === "light" ? "rgba(255, 255, 255, 0.88)" : "rgba(255, 255, 255, 0.12)";
    const glassShadow = themeName === "light"
        ? "0 4px 20px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.72)"
        : "0 4px 20px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.08)";
    const elevatedGlassShadow = themeName === "light"
        ? "0 10px 32px rgba(15, 23, 42, 0.09), inset 0 1px 0 rgba(255, 255, 255, 0.82)"
        : "0 12px 36px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.10)";
    const accentColor = nodeAccentColor(data.type);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const panelResizeRef = useRef<{ startX: number; startWidth: number; ratio: number } | null>(null);
    const resizeRef = useRef({
        isResizing: false,
        corner: "bottom-right" as ResizeCorner,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        startWidth: 0,
        startHeight: 0,
        keepRatio: false,
        ratio: 1,
    });

    useEffect(() => {
        setTitleDraft(data.title || "");
    }, [data.title]);

    useEffect(() => {
        if (!isEditingTitle) return;
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
    }, [isEditingTitle]);

    const finishTitleEditing = useCallback(() => {
        const title = titleDraft.trim() || data.title || "未命名节点";
        setTitleDraft(title);
        setIsEditingTitle(false);
        if (title !== data.title) onTitleChange(data.id, title);
    }, [data.id, data.title, onTitleChange, titleDraft]);

    useEffect(() => {
        if (!isEditingTitle) return;
        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && titleInputRef.current?.contains(target)) return;
            finishTitleEditing();
        };
        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [finishTitleEditing, isEditingTitle]);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const handleWheel = (event: WheelEvent) => event.stopPropagation();
        textarea.addEventListener("wheel", handleWheel, { passive: false });
        return () => textarea.removeEventListener("wheel", handleWheel);
    }, [data.type, isEditingContent]);

    useEffect(() => {
        if (!isEditingContent) return;
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    }, [isEditingContent]);


    useEffect(() => {
        if (!editRequestNonce || data.type !== CanvasNodeType.Text) return;
        setIsEditingContent(true);
    }, [data.type, editRequestNonce]);

    useEffect(() => {
        if (!isEditingContent) return;

        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (isEditingContent && textareaRef.current?.contains(target)) return;

            setIsEditingContent(false);
        };

        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [isEditingContent]);

    const handleResizeMove = useCallback(
        (event: MouseEvent) => {
            if (!resizeRef.current.isResizing) return;

            const dx = (event.clientX - resizeRef.current.startX) / scale;
            const dy = (event.clientY - resizeRef.current.startY) / scale;
            const minWidth = data.type === CanvasNodeType.Loop ? 420 : 220;
            const minHeight = data.type === CanvasNodeType.Loop ? 420 : 160;
            const startRight = resizeRef.current.startLeft + resizeRef.current.startWidth;
            const startBottom = resizeRef.current.startTop + resizeRef.current.startHeight;
            const fromLeft = resizeRef.current.corner.includes("left");
            const fromTop = resizeRef.current.corner.includes("top");
            const rawWidth = Math.max(minWidth, resizeRef.current.startWidth + (fromLeft ? -dx : dx));
            const rawHeight = Math.max(minHeight, resizeRef.current.startHeight + (fromTop ? -dy : dy));
            let width = rawWidth;
            let height = rawHeight;
            if (resizeRef.current.keepRatio) {
                const ratio = resizeRef.current.ratio;
                if (Math.abs(dx) >= Math.abs(dy)) {
                    height = width / ratio;
                } else {
                    width = height * ratio;
                }
                if (height < minHeight) {
                    height = minHeight;
                    width = height * ratio;
                }
                if (width < minWidth) {
                    width = minWidth;
                    height = width / ratio;
                }
            }

            onResize(data.id, width, height, {
                x: fromLeft ? startRight - width : resizeRef.current.startLeft,
                y: fromTop ? startBottom - height : resizeRef.current.startTop,
            });
        },
        [data.id, onResize, scale],
    );

    const handleResizeUp = useCallback(() => {
        resizeRef.current.isResizing = false;
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeUp);
    }, [handleResizeMove]);

    const handleResizeMouseDown = (event: React.MouseEvent, corner: ResizeCorner) => {
        event.stopPropagation();
        event.preventDefault();
        resizeRef.current = {
            isResizing: true,
            corner,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: data.position.x,
            startTop: data.position.y,
            startWidth: data.width,
            startHeight: data.height,
            keepRatio: (data.type === CanvasNodeType.Image && !data.metadata?.freeResize) || data.type === CanvasNodeType.Video || Boolean(definition?.keepAspectRatio?.(data)),
            ratio: (data.metadata?.naturalWidth || data.width) / (data.metadata?.naturalHeight || data.height || 1),
        };
        window.addEventListener("mousemove", handleResizeMove);
        window.addEventListener("mouseup", handleResizeUp);
    };

    const handlePanelResizeMove = useCallback((event: PointerEvent) => {
        const current = panelResizeRef.current;
        if (!current) return;
        const delta = (event.clientX - current.startX) / Math.max(scale, 0.01);
        const minimumHeight = 320;
        const minimumWidth = Math.max(320, minimumHeight * current.ratio);
        const width = Math.max(minimumWidth, Math.min(1200, current.startWidth + delta));
        setPanelSize({ width, height: width / current.ratio });
    }, [scale]);

    const handlePanelResizeEnd = useCallback(() => {
        panelResizeRef.current = null;
        window.removeEventListener("pointermove", handlePanelResizeMove);
        window.removeEventListener("pointerup", handlePanelResizeEnd);
    }, [handlePanelResizeMove]);

    const handlePanelResizeStart = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = panelRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return;
        panelResizeRef.current = { startX: event.clientX, startWidth: rect.width / Math.max(scale, 0.01), ratio: rect.width / rect.height };
        window.addEventListener("pointermove", handlePanelResizeMove);
        window.addEventListener("pointerup", handlePanelResizeEnd);
    }, [handlePanelResizeEnd, handlePanelResizeMove, scale]);

    useEffect(() => {
        if (!showPanel) setPanelSize(null);
    }, [data.id, showPanel]);

    useEffect(() => {
        return () => {
            window.removeEventListener("mousemove", handleResizeMove);
            window.removeEventListener("mouseup", handleResizeUp);
            window.removeEventListener("pointermove", handlePanelResizeMove);
            window.removeEventListener("pointerup", handlePanelResizeEnd);
        };
    }, [handlePanelResizeEnd, handlePanelResizeMove, handleResizeMove, handleResizeUp]);

    return (
        <div
            data-node-id={data.id}
            className={`node-element absolute flex select-none flex-col transition-shadow duration-200 ${isGroup ? "z-[5]" : isSelected ? "z-50" : "z-10"}`}
            style={{
                transform: `translate(${data.position.x}px, ${data.position.y}px)`,
                width: data.width,
                height: data.height,
                transition: "box-shadow 200ms ease",
                contain: "layout style",
            }}
            onMouseEnter={() => {
                setHovered(true);
                onHoverStart(data.id);
            }}
            onMouseLeave={() => {
                setHovered(false);
                onHoverEnd(data.id);
            }}
            onMouseDownCapture={(event) => onSelectCapture?.(event, data.id)}
            onContextMenu={(event) => onContextMenu(event, data.id)}
        >
            <div className="absolute left-2 top-[-28px] z-[65] flex h-6 max-w-[calc(100%-16px)] min-w-0 items-center gap-2" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                {!isGroup ? <span className="size-1.5 shrink-0 rounded-full shadow-[0_0_0_3px_rgba(255,255,255,.46)]" style={{ background: accentColor }} /> : null}
                {isEditingTitle ? (
                    <input
                        ref={titleInputRef}
                        value={titleDraft}
                        maxLength={64}
                        className="h-6 min-w-0 max-w-full border-0 border-b border-dashed bg-transparent px-0 text-left text-xs font-medium outline-none"
                        style={{ borderColor: theme.node.muted, color: theme.node.text }}
                        onChange={(event) => setTitleDraft(event.target.value)}
                        onBlur={finishTitleEditing}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") finishTitleEditing();
                            if (event.key === "Escape") {
                                setTitleDraft(data.title || "");
                                setIsEditingTitle(false);
                            }
                        }}
                    />
                ) : (
                    <button
                        type="button"
                        className="block min-w-0 max-w-full truncate border-b border-dashed border-transparent px-0 py-0.5 text-left text-xs font-medium opacity-70 transition hover:border-current hover:opacity-100"
                        style={{ color: theme.node.text }}
                        title="双击修改节点名称"
                        onDoubleClick={(event) => {
                            event.stopPropagation();
                            setIsEditingTitle(true);
                        }}
                    >
                        {data.title || "未命名节点"}
                    </button>
                )}
            </div>

            <div
                className="relative h-full w-full overflow-visible rounded-[16px] border transition-[border-color,box-shadow,background-color] duration-200 ease-out"
                style={{
                    background: isGroup ? `${theme.toolbar.panel}66` : transparentBg ? "transparent" : glassBackground,
                    borderColor: isGroup ? (isGroupDropTarget || isActive ? selectionBlue : theme.node.stroke) : isActive ? selectionBlue : isRelated && !isBatchChild ? theme.node.muted : transparentBg ? "transparent" : glassBorder,
                    borderStyle: isGroup ? "dashed" : "solid",
                    boxShadow: isGroupDropTarget ? `0 0 0 2px ${selectionBlue}66, inset 0 0 0 999px ${selectionBlue}10` : isActive ? `0 0 0 1px ${selectionBlue}55, ${elevatedGlassShadow}` : isRelated && !isBatchChild ? `0 0 0 1px ${theme.node.muted}55, ${elevatedGlassShadow}` : transparentBg || isGroup ? undefined : hovered ? elevatedGlassShadow : glassShadow,
                    backdropFilter: transparentBg || isGroup ? undefined : "blur(20px) saturate(140%)",
                    WebkitBackdropFilter: transparentBg || isGroup ? undefined : "blur(20px) saturate(140%)",
                }}
                onMouseDown={(event) => onMouseDown(event, data.id)}
                onDoubleClick={(event) => {
                    if (isBatchRoot) {
                        event.stopPropagation();
                        onToggleBatch?.(data.id);
                        return;
                    }
                    if (definition?.onDoubleClick && pluginContext) {
                        if (definition.onDoubleClick(pluginContext)) event.stopPropagation();
                        return;
                    }
                    if (data.type === CanvasNodeType.Image && hasImageContent) {
                        event.stopPropagation();
                        onViewImage?.(data);
                        return;
                    }
                    if (data.type !== CanvasNodeType.Text) return;
                    event.stopPropagation();
                    setIsEditingContent(true);
                }}
            >
                <div
                    className={`relative flex h-full w-full items-center justify-center rounded-[inherit] ${isBatchRoot ? "overflow-visible" : "overflow-hidden"}`}
                    style={
                        {
                            background: "transparent",
                            pointerEvents: contentInteractive ? undefined : "none",
                            "--batch-from-x": `${batchMotion?.x || 0}px`,
                            "--batch-from-y": `${batchMotion?.y || 0}px`,
                            "--batch-from-rotate": `${6 + (batchMotion?.index || 0) * 4}deg`,
                            animation: data.metadata?.batchRootId ? (batchClosing ? "canvas-batch-child-out 260ms cubic-bezier(.4,0,.2,1) both" : "canvas-batch-child-in 340ms cubic-bezier(.2,.85,.18,1) both") : undefined,
                            animationDelay: data.metadata?.batchRootId ? `${batchClosing ? 0 : 45 + (batchMotion?.index || 0) * 24}ms` : undefined,
                        } as React.CSSProperties
                    }
                >
                    <NodeContent
                        node={data}
                        theme={theme}
                        isEditingContent={isEditingContent}
                        textareaRef={textareaRef}
                        isBatchRoot={isBatchRoot}
                        batchCount={batchCount}
                        batchExpanded={batchExpanded}
                        batchOpening={batchOpening}
                        batchRecovering={batchRecovering}
                        renderNodeContent={renderNodeContent}
                        pluginContext={pluginContext}
                        mentionReferences={mentionReferences}
                        onContentChange={onContentChange}
                        onStopEditing={() => setIsEditingContent(false)}
                        onRetry={onRetry}
                        onGenerateImage={onGenerateImage}
                        onToggleBatch={() => onToggleBatch?.(data.id)}
                        onSetBatchPrimary={() => onSetBatchPrimary?.(data)}
                        groupChildCount={groupChildCount}
                    />
                </div>

                {showImageInfo && hasImageContent ? <ImageInfoBar node={data} /> : null}
                {resourceLabel ? <ResourceLabelBadge reference={resourceLabel} /> : null}
                {loopInputOrders.length ? <LoopInputOrderBadge orders={loopInputOrders} /> : null}
                {data.type !== CanvasNodeType.Loop && data.metadata?.generationDurationMs != null ? <GenerationDurationBadge durationMs={data.metadata.generationDurationMs} /> : null}

                {!isGroup && !hasImageContent && !hasVideoContent && !hasAudioContent ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: `linear-gradient(to top, ${theme.canvas.background}66, transparent)` }} /> : null}

                <ResizeHandle corner="top-left" visible={isSelected} onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="top-right" visible={isSelected} onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="bottom-left" visible={isSelected} onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="bottom-right" visible={isSelected} onMouseDown={handleResizeMouseDown} />
            </div>

            {data.type === CanvasNodeType.Image && data.metadata?.globalImageId ? <GlobalImageIndexBadge value={data.metadata.globalImageId} /> : null}

            {!isGroup ? <ConnectionHandleDot side="left" visible={hovered || isSelected || isConnecting} onMouseDown={(event) => onConnectStart(event, data.id, "target")} /> : null}
            {!isGroup ? <ConnectionHandleDot side="right" visible={(definition?.hasSourceHandle ?? true) && data.type !== CanvasNodeType.Config && (hovered || isSelected || isConnecting)} onMouseDown={(event) => onConnectStart(event, data.id, "source")} /> : null}

            {showPanel && !isGroup && renderPanel ? (
                <div ref={panelRef} className="absolute left-1/2 top-full z-[70] overflow-auto pt-4 thin-scrollbar" style={{ width: panelSize?.width || 600, minHeight: 320, height: panelSize?.height || undefined, boxSizing: "border-box", transform: "translateX(-50%)" }}>
                    {renderPanel(data)}
                    <button type="button" aria-label="等比例调整面板大小" className="absolute bottom-1 right-1 z-10 size-4 cursor-nwse-resize rounded-sm opacity-40 hover:opacity-80" style={{ background: theme.node.muted }} onPointerDown={handlePanelResizeStart} />
                </div>
            ) : null}
        </div>
    );
});

function NodeContent(props: NodeContentRendererProps) {
    if ((props.node.type === CanvasNodeType.Config || props.node.type === CanvasNodeType.Loop) && props.renderNodeContent) return props.renderNodeContent(props.node);
    if (props.isBatchRoot) return <ImageNodeContent {...props} />;
    if (props.node.metadata?.status === "loading" && props.node.type !== CanvasNodeType.Loop) return <LoadingContent theme={props.theme} />;
    if (props.node.metadata?.status === "error" && props.node.type !== CanvasNodeType.Loop) return <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />;

    const Renderer = nodeContentRenderers[props.node.type as CanvasNodeType];
    if (Renderer) return <Renderer {...props} />;

    // 插件节点:有注册渲染器则渲染,否则展示缺少插件占位
    const definition = getNodeDefinition(props.node.type);
    if (definition?.Content && props.pluginContext) {
        const PluginContent = definition.Content;
        return <PluginContent ctx={props.pluginContext} />;
    }
    return <MissingPluginContent theme={props.theme} type={props.node.type} />;
}

const nodeContentRenderers = {
    [CanvasNodeType.Text]: TextContent,
    [CanvasNodeType.Image]: ImageNodeContent,
    [CanvasNodeType.Config]: EmptyImageContent,
    [CanvasNodeType.Video]: VideoNodeContent,
    [CanvasNodeType.Audio]: AudioNodeContent,
    [CanvasNodeType.Group]: GroupNodeContent,
    [CanvasNodeType.Loop]: LoopNodeContent,
} satisfies Record<CanvasNodeType, (props: NodeContentRendererProps) => ReactNode>;

function LoopNodeContent({ node, theme }: NodeContentRendererProps) {
    const count = Math.max(1, Math.min(100, Number(node.metadata?.loopCount) || 1));
    const sellingPointMode = node.metadata?.loopTaskMode === "selling-points";
    const mode = node.metadata?.loopMode === "parallel" ? "同时运行" : "按顺序";
    const status = node.metadata?.status === "loading" ? `运行中 · ${node.metadata?.loopRound || 0}/${count}` : node.metadata?.status === "error" ? "运行失败" : "待运行";
    return (
        <div className="flex h-full w-full flex-col gap-3 p-4" style={{ color: theme.node.text }}>
            <div className="flex items-center gap-2">
                <span className="grid size-9 place-items-center rounded-lg" style={{ background: theme.toolbar.activeBg, color: theme.node.activeStroke }}>
                    {sellingPointMode ? <ShoppingBag className="size-5" /> : <Repeat2 className="size-5" />}
                </span>
                <div className="min-w-0">
                    <div className="text-sm font-semibold">{sellingPointMode ? "卖点图循环" : "循环节点"}</div>
                    <div className="text-[11px] opacity-55">{mode} · {sellingPointMode ? `生成 ${count} 张` : `重复 ${count} 次`}</div>
                </div>
                <span className="ml-auto rounded px-2 py-1 text-[10px]" style={{ background: theme.toolbar.activeBg, color: node.metadata?.status === "error" ? "#ef4444" : theme.node.muted }}>{status}</span>
            </div>
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-dashed p-3 text-xs leading-5 opacity-65" style={{ borderColor: theme.node.stroke, background: `${theme.node.fill}55` }}>
                <span>{sellingPointMode ? "商品图" : "附加输入"}</span><ArrowRight className="size-3.5 shrink-0" /><strong className="font-medium">{sellingPointMode ? `${count} 条卖点` : `循环 ${count} 次`}</strong><ArrowRight className="size-3.5 shrink-0" /><span>右侧流程</span>
            </div>
        </div>
    );
}

function GroupNodeContent({ node, theme, groupChildCount }: NodeContentRendererProps) {
    return (
        <div className="pointer-events-none flex h-full w-full flex-col p-4">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: theme.node.text }}>
                <span className="grid size-8 place-items-center rounded-xl" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
                    <Group className="size-4" />
                </span>
                <span>组</span>
                <span className="ml-auto rounded-full px-2 py-1 text-[11px] font-medium" style={{ background: theme.node.fill, color: theme.node.muted }}>
                    {groupChildCount} 个节点
                </span>
            </div>
            <div className="mt-3 flex-1 rounded-2xl border border-dashed" style={{ borderColor: theme.node.stroke, background: `${theme.node.fill}55` }} />
        </div>
    );
}

function LoadingContent({ theme }: Pick<NodeContentRendererProps, "theme">) {
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.activeStroke }}>
            <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />
            <span className="text-[10px] tracking-[0.2em]">生成中</span>
        </div>
    );
}

function ErrorContent({ node, theme, onRetry }: Pick<NodeContentRendererProps, "node" | "theme" | "onRetry">) {
    return (
        <div className="flex max-w-[260px] flex-col items-center gap-3 px-5 text-center">
            <div className="text-xs leading-5 text-red-300">{node.metadata?.errorDetails || "生成失败"}</div>
            <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    onRetry?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <RefreshCw className="size-3.5" />
                重试
            </button>
        </div>
    );
}

function MissingPluginContent({ theme, type }: Pick<NodeContentRendererProps, "theme"> & { type: string }) {
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.placeholder }}>
            <Puzzle className="size-7 opacity-40" />
            <span className="text-sm">缺少插件</span>
            <span className="text-[11px] opacity-70">节点类型 “{type}” 的插件未安装或未启用</span>
        </div>
    );
}

function TextContent({ node, theme, isEditingContent, textareaRef, mentionReferences, onContentChange, onStopEditing, onGenerateImage }: NodeContentRendererProps) {
    const fontSize = node.metadata?.fontSize || 14;
    const textStyle = { fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.65)}px`, color: theme.node.text, boxSizing: "border-box" } as React.CSSProperties;

    return (
        <div className="flex h-full w-full flex-col overflow-hidden pt-8">
            <button
                type="button"
                className="absolute right-3 top-3 z-20 inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium opacity-85 backdrop-blur-md transition hover:scale-[1.02] hover:opacity-100"
                style={{ background: `${theme.toolbar.panel}dd`, borderColor: theme.node.stroke, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    onGenerateImage?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title="用文本生图"
                aria-label="用文本生图"
            >
                <ImageIcon className="size-3.5" />
                生图
            </button>
            {isEditingContent ? (
                <CanvasResourceMentionTextarea
                    ref={textareaRef}
                    className="thin-scrollbar block h-full w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent pl-4 pr-14 pt-0 pb-4 m-0 font-mono outline-none select-text appearance-none"
                    style={textStyle}
                    value={node.metadata?.content || ""}
                    references={mentionReferences}
                    highlightLabels={false}
                    onChange={(value) => onContentChange(node.id, value)}
                    onBlur={onStopEditing}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") onStopEditing();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                />
            ) : (
                <div
                    className="thin-scrollbar block h-full w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent pl-4 pr-14 pt-0 pb-4 font-mono"
                    style={textStyle}
                    onWheel={(event) => event.stopPropagation()}
                >
                    {node.metadata?.content || <span style={{ color: theme.node.placeholder }}>双击编辑文字</span>}
                </div>
            )}
        </div>
    );
}

function ResourceLabelBadge({ reference }: { reference: CanvasResourceReference }) {
    return (
        <span className={`pointer-events-none absolute right-2 top-2 z-30 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${reference.active ? "bg-[#2f80ff] text-white shadow-sm" : "bg-black/35 text-white/75"}`}>
            {reference.label}
        </span>
    );
}

function GlobalImageIndexBadge({ value }: { value: string }) {
    return (
        <span className="pointer-events-none absolute left-1 top-full z-[60] mt-1 rounded-md border border-white/15 bg-black/15 px-1.5 py-0.5 font-mono text-[9px] font-medium text-white/75 shadow-sm backdrop-blur-md backdrop-saturate-150">
            {value}
        </span>
    );
}

function LoopInputOrderBadge({ orders }: { orders: Array<{ loopId: string; loopTitle: string; index: number }> }) {
    const primary = orders[0];
    const title = orders.map((order) => `${order.loopTitle}：第 ${order.index} 个输入`).join("\n");
    return (
        <span
            className="pointer-events-none absolute bottom-2 left-2 z-30 inline-flex h-6 items-center gap-1 rounded-md border border-white/20 bg-black/65 px-2 text-[10px] font-semibold tabular-nums text-white shadow-sm backdrop-blur-sm"
            title={title}
        >
            <Repeat2 className="size-3" />
            循环 {primary.index}
            {orders.length > 1 ? <span className="opacity-60">+{orders.length - 1}</span> : null}
        </span>
    );
}

function ImageNodeContent(props: NodeContentRendererProps) {
    if (!props.node.metadata?.content && props.isBatchRoot) {
        const content =
            props.node.metadata?.status === "loading" ? (
                <LoadingContent theme={props.theme} />
            ) : props.node.metadata?.status === "error" ? (
                <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />
            ) : (
                <EmptyImageContent {...props} isBatchRoot={false} />
            );
        return (
            <BatchFrame batchCount={props.batchCount} batchExpanded={props.batchExpanded} batchOpening={props.batchOpening} batchRecovering={props.batchRecovering} onToggleBatch={props.onToggleBatch}>
                {content}
            </BatchFrame>
        );
    }
    if (!props.node.metadata?.content) return <EmptyImageContent {...props} />;

    return (
        <ImageContent
            node={props.node}
            isBatchRoot={props.isBatchRoot}
            batchCount={props.batchCount}
            batchExpanded={props.batchExpanded}
            batchOpening={props.batchOpening}
            batchRecovering={props.batchRecovering}
            onToggleBatch={props.onToggleBatch}
            onSetBatchPrimary={props.onSetBatchPrimary}
        />
    );
}

function EmptyImageContent({ theme, isBatchRoot, batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch }: NodeContentRendererProps) {
    const content = (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
            <div className="flex size-14 items-center justify-center rounded-2xl" style={{ background: theme.toolbar.activeBg }}>
                <ImageIcon className="size-6 opacity-30" />
            </div>
            <span className="text-[10px] tracking-[0.18em] opacity-50">空图片节点</span>
        </div>
    );
    if (isBatchRoot)
        return (
            <BatchFrame batchCount={batchCount} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} onToggleBatch={onToggleBatch}>
                {content}
            </BatchFrame>
        );
    return content;
}

function VideoNodeContent({ node, theme }: NodeContentRendererProps) {
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
                <Video className="size-7 opacity-35" />
                <span className="text-sm">空视频节点</span>
            </div>
        );
    return <CanvasVideoPlayer src={node.metadata.content} title={node.title} />;
}

function CanvasVideoPlayer({ src, title }: { src: string; title: string }) {
    const playerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(false);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        setDuration(0);
        setCurrentTime(0);
        setPlaying(false);
        setReady(false);
    }, [src]);

    const togglePlayback = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            if (video.ended) video.currentTime = 0;
            void video.play();
        } else {
            video.pause();
        }
    };
    const toggleMute = () => {
        const video = videoRef.current;
        if (!video) return;
        video.muted = !video.muted;
        setMuted(video.muted);
    };
    const openFullscreen = () => {
        const player = playerRef.current;
        if (player?.requestFullscreen) void player.requestFullscreen();
    };
    const stopPointer = (event: React.SyntheticEvent) => event.stopPropagation();

    return (
        <div
            ref={playerRef}
            className="group/video relative h-full w-full overflow-hidden rounded-[inherit] bg-[#080808]"
            data-canvas-no-zoom
            onDoubleClick={(event) => {
                event.stopPropagation();
                openFullscreen();
            }}
        >
            <video
                ref={videoRef}
                src={src}
                title={title}
                className="block h-full w-full object-contain"
                controls={false}
                playsInline
                preload="metadata"
                onClick={(event) => {
                    event.stopPropagation();
                    togglePlayback();
                }}
                onLoadedMetadata={(event) => {
                    setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
                    setCurrentTime(event.currentTarget.currentTime || 0);
                    setReady(true);
                }}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onVolumeChange={(event) => setMuted(event.currentTarget.muted || event.currentTarget.volume === 0)}
            />

            {!ready ? (
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-white/70">
                    <LoaderCircle className="size-6 animate-spin" />
                </div>
            ) : null}

            <button
                type="button"
                aria-label={playing ? "暂停视频" : "播放视频"}
                className={`absolute left-1/2 top-1/2 z-10 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white shadow-[0_8px_24px_rgba(0,0,0,.22)] backdrop-blur-sm transition duration-200 hover:scale-105 hover:bg-black/70 ${playing ? "opacity-0 group-hover/video:opacity-100" : "opacity-100"}`}
                onMouseDown={stopPointer}
                onPointerDown={stopPointer}
                onClick={(event) => {
                    event.stopPropagation();
                    togglePlayback();
                }}
            >
                {playing ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
            </button>

            <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2.5 pt-8 text-white opacity-0 transition-opacity duration-200 group-hover/video:opacity-100 focus-within:opacity-100">
                <div className="flex h-7 items-center gap-1.5 text-[11px] tabular-nums">
                    <button type="button" aria-label={playing ? "暂停视频" : "播放视频"} className="grid size-7 place-items-center rounded-full transition hover:bg-white/15" onMouseDown={stopPointer} onPointerDown={stopPointer} onClick={(event) => { event.stopPropagation(); togglePlayback(); }}>
                        {playing ? <Pause className="size-3.5 fill-current" /> : <Play className="ml-0.5 size-3.5 fill-current" />}
                    </button>
                    <span className="min-w-0 opacity-90">{formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}</span>
                    <span className="flex-1" />
                    <button type="button" aria-label={muted ? "取消静音" : "静音"} className="grid size-7 place-items-center rounded-full transition hover:bg-white/15" onMouseDown={stopPointer} onPointerDown={stopPointer} onClick={(event) => { event.stopPropagation(); toggleMute(); }}>
                        {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                    </button>
                    <button type="button" aria-label="全屏播放" className="grid size-7 place-items-center rounded-full transition hover:bg-white/15" onMouseDown={stopPointer} onPointerDown={stopPointer} onClick={(event) => { event.stopPropagation(); openFullscreen(); }}>
                        <Maximize2 className="size-3.5" />
                    </button>
                </div>
            </div>
        </div>
    );
}

function GenerationDurationBadge({ durationMs }: { durationMs: number }) {
    return (
        <span
            className="pointer-events-none absolute left-2 top-2 z-20 max-w-[55%] truncate rounded-md border border-emerald-200/30 bg-emerald-600/75 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white shadow-sm backdrop-blur-sm"
            title={`本次生成耗时 ${formatGenerationDuration(durationMs)}`}
        >
            耗时 {formatGenerationDuration(durationMs)}
        </span>
    );
}

function formatGenerationDuration(durationMs: number) {
    if (durationMs < 1000) return `${Math.round(durationMs)} 毫秒`;
    if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} 秒`;
    const minutes = Math.floor(durationMs / 60_000);
    const seconds = Math.round((durationMs % 60_000) / 1000);
    return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
}

function formatPlaybackTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const value = Math.floor(seconds);
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

function AudioNodeContent({ node, theme }: NodeContentRendererProps) {
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: theme.node.placeholder }}>
                <Music2 className="size-7 opacity-35" />
                <span className="text-sm">空音频节点</span>
            </div>
        );
    return (
        <div className="flex h-full w-full flex-col justify-center gap-3 px-4" style={{ color: theme.node.text }}>
            <div className="flex min-w-0 items-center gap-2 text-sm opacity-70">
                <Music2 className="size-4 shrink-0" />
                <span className="truncate">音频</span>
            </div>
            <audio src={node.metadata.content} controls className="w-full" data-canvas-no-zoom />
        </div>
    );
}

function ImageContent({
    node,
    isBatchRoot,
    batchCount,
    batchExpanded,
    batchOpening,
    batchRecovering,
    onToggleBatch,
    onSetBatchPrimary,
}: {
    node: CanvasNodeData;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isBatchChild = Boolean(node.metadata?.batchRootId);

    return (
        <BatchFrame batchCount={isBatchRoot ? batchCount : 0} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} onToggleBatch={onToggleBatch}>
            <div className="h-full w-full overflow-hidden rounded-[inherit]">
                <img
                    src={node.metadata!.content!}
                    alt={node.title}
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                    className={`pointer-events-none block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`}
                />
            </div>
            {isBatchRoot ? (
                <button
                    type="button"
                    className="absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1 rounded-full border px-2.5 text-xs font-semibold shadow-[0_6px_18px_rgba(15,23,42,.10)] backdrop-blur-md transition hover:scale-[1.02]"
                    style={{ background: `${theme.toolbar.panel}d9`, borderColor: `${theme.toolbar.border}cc`, color: theme.node.text }}
                    aria-label={batchExpanded ? "图片组已展开" : "图片组已收起"}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleBatch?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <span className="leading-none text-[#2f80ff]">{batchCount}</span>
                    <ChevronRight className={`size-3.5 opacity-55 transition-transform ${batchExpanded ? "rotate-90" : ""}`} />
                </button>
            ) : null}
            {isBatchChild ? (
                <button
                    type="button"
                    className="absolute right-3 top-3 z-30 flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium opacity-0 shadow-[0_8px_20px_rgba(68,64,60,.13)] backdrop-blur-md transition group-hover/batch:opacity-100 hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onSetBatchPrimary?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <Star className="size-3.5 text-[#2f80ff]" />
                    设为主图
                </button>
            ) : null}
        </BatchFrame>
    );
}

function ImageInfoBar({ node }: { node: CanvasNodeData }) {
    const width = Math.round(node.metadata?.naturalWidth || node.width);
    const height = Math.round(node.metadata?.naturalHeight || node.height);
    const size = formatBytes(node.metadata?.bytes || 0);
    return (
        <div className="pointer-events-none absolute bottom-3 right-3 z-40 max-w-[calc(100%-24px)]">
            <span className="max-w-full truncate rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium leading-none text-white backdrop-blur-sm">
                {width} x {height}
                {size ? ` · ${size}` : ""}
            </span>
        </div>
    );
}

function BatchFrame({ batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch, children }: { batchCount: number; batchExpanded: boolean; batchOpening: boolean; batchRecovering: boolean; onToggleBatch?: () => void; children: ReactNode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isBatchRoot = batchCount > 1;
    return (
        <div
            className="group/batch relative h-full w-full overflow-visible"
            onDoubleClick={
                isBatchRoot
                    ? (event) => {
                          event.stopPropagation();
                          onToggleBatch?.();
                      }
                    : undefined
            }
        >
            {isBatchRoot ? (
                <div className="pointer-events-none absolute inset-0 overflow-visible">
                    {Array.from({ length: Math.min(batchCount - 1, 5) }).map((_, index) => (
                        <div
                            key={index}
                            className="absolute rounded-[inherit] border shadow-[0_14px_34px_rgba(68,64,60,.16)] transition-all duration-300 group-hover/batch:translate-x-2"
                            style={{
                                inset: 0,
                                background: `linear-gradient(135deg, ${theme.node.panel}, ${theme.node.fill})`,
                                borderColor: theme.node.stroke,
                                opacity: batchExpanded && !batchOpening ? 0.34 : 1,
                                transform:
                                    batchOpening || batchRecovering ? `translate(${54 + index * 22}px, ${20 + index * 12}px) rotate(${8 + index * 5}deg) scale(.98)` : `translate(${34 + index * 18}px, ${14 + index * 10}px) rotate(${6 + index * 4}deg)`,
                                zIndex: -index - 1,
                            }}
                        />
                    ))}
                </div>
            ) : null}
            {children}
        </div>
    );
}
function ResizeHandle({ corner, visible, onMouseDown }: { corner: ResizeCorner; visible: boolean; onMouseDown: (event: React.MouseEvent, corner: ResizeCorner) => void }) {
    const positionClass = {
        "top-left": "-left-[14px] -top-[14px] cursor-nwse-resize",
        "top-right": "-right-[14px] -top-[14px] cursor-nesw-resize",
        "bottom-left": "-bottom-[14px] -left-[14px] cursor-nesw-resize",
        "bottom-right": "-bottom-[14px] -right-[14px] cursor-nwse-resize",
    }[corner];

    return (
        <div className={`absolute z-50 grid size-7 place-items-center ${positionClass}`} onMouseDown={(event) => onMouseDown(event, corner)}>
            <span className={`size-2 rounded-full border border-[#2f80ff] bg-white shadow-[0_1px_4px_rgba(47,128,255,.22)] transition-opacity duration-150 ${visible ? "opacity-100" : "opacity-0"}`} />
        </div>
    );
}

function ConnectionHandleDot({ side, visible, onMouseDown }: { side: "left" | "right"; visible: boolean; onMouseDown: (event: React.MouseEvent) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div
            className={`group/handle absolute top-1/2 z-30 flex size-12 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 ${
                side === "left" ? "-left-6" : "-right-6"
            } ${visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
            onMouseDown={onMouseDown}
        >
            <div className="grid size-4 place-items-center rounded-full border shadow-[0_2px_8px_rgba(15,23,42,.12)] backdrop-blur-md transition-transform duration-150 group-hover/handle:scale-110" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}>
                <span className="size-1.5 rounded-full bg-[#8e8e93] transition-colors group-hover/handle:bg-[#2f80ff]" />
            </div>
        </div>
    );
}
