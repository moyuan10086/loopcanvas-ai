import { App, Button, Input, Modal, Segmented, Slider } from "antd";
import { Check, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { MAX_OUTPAINT_EDGE, outpaintDataUrl, resolveOutpaintSize, type ImageOutpaintMargins } from "@/lib/canvas/canvas-image-data";
import { readImageMeta } from "@/lib/image-utils";

export type CanvasImageOutpaintPayload = {
    prompt: string;
    dataUrl: string;
    maskDataUrl: string;
    width: number;
    height: number;
};

const defaultMargins: ImageOutpaintMargins = { top: 25, right: 25, bottom: 25, left: 25 };
const defaultPrompt = "自然延展原图之外的场景，保持主体、透视、光线、色彩和画面风格连续一致，不要移动、裁剪或重绘原图区域。";
type ResizeHandle = "top" | "right" | "bottom" | "left" | "corner";
type ResizeDrag = { handle: ResizeHandle; startX: number; startY: number; startMargins: ImageOutpaintMargins; width: number; height: number };

function sameMargins(first: ImageOutpaintMargins, second: ImageOutpaintMargins) {
    return first.top === second.top && first.right === second.right && first.bottom === second.bottom && first.left === second.left;
}

function adaptOutpaintMargins(image: { width: number; height: number }, margins: ImageOutpaintMargins): ImageOutpaintMargins {
    const currentSize = resolveOutpaintSize(image.width, image.height, margins);
    if (currentSize.width <= MAX_OUTPAINT_EDGE && currentSize.height <= MAX_OUTPAINT_EDGE) return margins;

    let low = 0;
    let high = 1;
    for (let index = 0; index < 24; index += 1) {
        const factor = (low + high) / 2;
        const candidate = {
            top: margins.top * factor,
            right: margins.right * factor,
            bottom: margins.bottom * factor,
            left: margins.left * factor,
        };
        const size = resolveOutpaintSize(image.width, image.height, candidate);
        if (size.width <= MAX_OUTPAINT_EDGE && size.height <= MAX_OUTPAINT_EDGE) low = factor;
        else high = factor;
    }

    const factor = Math.max(0, Math.min(1, low));
    return {
        top: Math.floor(margins.top * factor * 10) / 10,
        right: Math.floor(margins.right * factor * 10) / 10,
        bottom: Math.floor(margins.bottom * factor * 10) / 10,
        left: Math.floor(margins.left * factor * 10) / 10,
    };
}

function handleLabel(handle: ResizeHandle) {
    if (handle === "corner") return "右下角";
    return { top: "上边", right: "右边", bottom: "下边", left: "左边" }[handle];
}

function handleClass(handle: ResizeHandle) {
    if (handle === "top") return "left-1/2 -top-2 h-2.5 w-8 -translate-x-1/2 cursor-ns-resize";
    if (handle === "right") return "-right-2 top-1/2 h-8 w-2.5 -translate-y-1/2 cursor-ew-resize";
    if (handle === "bottom") return "-bottom-2 left-1/2 h-2.5 w-8 -translate-x-1/2 cursor-ns-resize";
    if (handle === "left") return "-left-2 top-1/2 h-8 w-2.5 -translate-y-1/2 cursor-ew-resize";
    return "-bottom-2 -right-2 size-5 cursor-nwse-resize rounded-full";
}

export function CanvasNodeOutpaintDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (payload: CanvasImageOutpaintPayload) => void }) {
    const { message } = App.useApp();
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [margins, setMargins] = useState<ImageOutpaintMargins>(defaultMargins);
    const [prompt, setPrompt] = useState(defaultPrompt);
    const [submitting, setSubmitting] = useState(false);
    const previewRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<ResizeDrag | null>(null);

    useEffect(() => {
        if (!open) return;
        setMargins(defaultMargins);
        setPrompt(defaultPrompt);
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    useEffect(() => {
        if (!image) return;
        const next = adaptOutpaintMargins(image, margins);
        if (!sameMargins(next, margins)) setMargins(next);
    }, [image, margins]);

    useEffect(() => {
        const stopDrag = () => {
            dragRef.current = null;
        };
        const moveDrag = (event: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag) return;
            const originalWidth = drag.width * 100 / (100 + drag.startMargins.left + drag.startMargins.right);
            const originalHeight = drag.height * 100 / (100 + drag.startMargins.top + drag.startMargins.bottom);
            const dx = ((event.clientX - drag.startX) / Math.max(1, originalWidth)) * 100;
            const dy = ((event.clientY - drag.startY) / Math.max(1, originalHeight)) * 100;
            let growX = 0;
            let growY = 0;
            if (drag.handle === "left") growX = -dx;
            else if (drag.handle === "right") growX = dx;
            else if (drag.handle === "top") growY = -dy;
            else if (drag.handle === "bottom") growY = dy;
            else {
                growX = dx;
                growY = dy;
            }
            const next = {
                top: drag.startMargins.top + growY,
                right: drag.startMargins.right + growX,
                bottom: drag.startMargins.bottom + growY,
                left: drag.startMargins.left + growX,
            };
            setMargins({
                top: Math.min(200, Math.max(0, next.top)),
                right: Math.min(200, Math.max(0, next.right)),
                bottom: Math.min(200, Math.max(0, next.bottom)),
                left: Math.min(200, Math.max(0, next.left)),
            });
        };
        window.addEventListener("pointermove", moveDrag);
        window.addEventListener("pointerup", stopDrag);
        window.addEventListener("pointercancel", stopDrag);
        return () => {
            window.removeEventListener("pointermove", moveDrag);
            window.removeEventListener("pointerup", stopDrag);
            window.removeEventListener("pointercancel", stopDrag);
        };
    }, []);

    const output = useMemo(() => {
        if (!image) return null;
        const { width, height } = resolveOutpaintSize(image.width, image.height, margins);
        return { width, height, ratio: width / Math.max(1, height) };
    }, [image, margins]);
    const invalid = !output || output.width > MAX_OUTPAINT_EDGE || output.height > MAX_OUTPAINT_EDGE || Math.max(output.ratio, 1 / output.ratio) > 3 || Object.values(margins).every((value) => value <= 0);

    const setMargin = (key: keyof ImageOutpaintMargins, value: number) => setMargins((current) => ({ ...current, [key]: Math.min(200, Math.max(0, value || 0)) }));
    const applyPreset = (value: string) => {
        const amount = 35;
        if (value === "all") setMargins({ top: amount, right: amount, bottom: amount, left: amount });
        if (value === "horizontal") setMargins({ top: 0, right: amount, bottom: 0, left: amount });
        if (value === "vertical") setMargins({ top: amount, right: 0, bottom: amount, left: 0 });
        if (value === "left") setMargins({ top: 0, right: 0, bottom: 0, left: amount });
        if (value === "right") setMargins({ top: 0, right: amount, bottom: 0, left: 0 });
        if (value === "top") setMargins({ top: amount, right: 0, bottom: 0, left: 0 });
        if (value === "bottom") setMargins({ top: 0, right: 0, bottom: amount, left: 0 });
    };

    const beginResize = (handle: ResizeHandle, event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = previewRef.current?.getBoundingClientRect();
        if (!rect) return;
        dragRef.current = { handle, startX: event.clientX, startY: event.clientY, startMargins: { ...margins }, width: rect.width, height: rect.height };
    };

    const submit = async () => {
        if (invalid) return;
        setSubmitting(true);
        try {
            const result = await outpaintDataUrl(dataUrl, margins);
            onConfirm({ prompt: prompt.trim() || defaultPrompt, ...result });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "扩图画布创建失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal title="扩图" open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={880} centered destroyOnHidden>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="flex min-h-[360px] items-center justify-center overflow-hidden rounded-lg border bg-[linear-gradient(45deg,#ececec_25%,transparent_25%),linear-gradient(-45deg,#ececec_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#ececec_75%),linear-gradient(-45deg,transparent_75%,#ececec_75%)] bg-[length:18px_18px] bg-[position:0_0,0_9px,9px_-9px,-9px_0] p-5 dark:border-stone-800 dark:bg-stone-950">
                    {image && output ? (
                        <div ref={previewRef} className="relative w-full max-w-[560px] overflow-visible border-2 border-dashed border-red-400 bg-white/70 shadow-sm" style={{ aspectRatio: `${output.width} / ${output.height}` }}>
                            <span className="pointer-events-none absolute left-2 top-2 z-20 rounded-full bg-slate-900/80 px-2 py-1 text-[10px] font-semibold tabular-nums text-white shadow-sm">{output.width} × {output.height}</span>
                            <img
                                src={dataUrl}
                                alt="扩图预览"
                                draggable={false}
                                className="absolute object-fill shadow-[0_0_0_1px_rgba(0,0,0,.2)]"
                                style={{
                                    left: `${(margins.left / (100 + margins.left + margins.right)) * 100}%`,
                                    top: `${(margins.top / (100 + margins.top + margins.bottom)) * 100}%`,
                                    width: `${(100 / (100 + margins.left + margins.right)) * 100}%`,
                                    height: `${(100 / (100 + margins.top + margins.bottom)) * 100}%`,
                                }}
                            />
                            {(["top", "right", "bottom", "left", "corner"] as ResizeHandle[]).map((handle) => (
                                <button
                                    key={handle}
                                    type="button"
                                    aria-label={`拖动${handleLabel(handle)}扩展区域`}
                                    title={`拖动${handleLabel(handle)}扩展区域`}
                                    className={`absolute z-10 rounded-sm border border-slate-400 bg-white shadow-sm transition hover:bg-blue-50 ${handleClass(handle)}`}
                                    onPointerDown={(event) => beginResize(handle, event)}
                                />
                            ))}
                        </div>
                    ) : null}
                </div>

                <div className="space-y-4">
                    <div>
                        <div className="mb-2 text-sm font-medium">快速方向</div>
                        <div className="mb-2 text-xs opacity-55">也可以直接拖动预览边缘或右下角调整扩展范围</div>
                        <Segmented block options={[{ label: "四周", value: "all" }, { label: "左右", value: "horizontal" }, { label: "上下", value: "vertical" }]} onChange={(value) => applyPreset(String(value))} />
                        <div className="mt-2 grid grid-cols-4 gap-2">
                            {[{ label: "上", value: "top" }, { label: "右", value: "right" }, { label: "下", value: "bottom" }, { label: "左", value: "left" }].map((item) => (
                                <Button key={item.value} size="small" onClick={() => applyPreset(item.value)}>{item.label}</Button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-3 rounded-lg border p-3 dark:border-stone-800">
                        {(["top", "right", "bottom", "left"] as const).map((key) => (
                            <div key={key} className="grid grid-cols-[28px_1fr_62px] items-center gap-2">
                                <span className="text-sm">{{ top: "上", right: "右", bottom: "下", left: "左" }[key]}</span>
                                <Slider min={0} max={100} step={5} value={margins[key]} onChange={(value) => setMargin(key, value)} />
                                <Input type="number" min={0} max={200} suffix="%" value={margins[key]} onChange={(event) => setMargin(key, Number(event.target.value))} />
                            </div>
                        ))}
                    </div>

                    <div>
                        <div className="mb-1 text-sm font-medium">扩图要求</div>
                        <Input.TextArea rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述外延区域应补充的内容" />
                    </div>

                    <div className={`rounded-md px-3 py-2 text-xs ${invalid ? "bg-red-50 text-red-600 dark:bg-red-950/30" : "bg-stone-100 text-stone-600 dark:bg-stone-900 dark:text-stone-300"}`}>
                        {image && output ? `原图 ${image.width} × ${image.height} → 扩图 ${output.width} × ${output.height}` : "正在读取图片尺寸"}
                        {output && (output.width > MAX_OUTPAINT_EDGE || output.height > MAX_OUTPAINT_EDGE) ? `，最长边不能超过 ${MAX_OUTPAINT_EDGE}px` : null}
                        {output && Math.max(output.ratio, 1 / output.ratio) > 3 ? "，宽高比不能超过 3:1" : null}
                    </div>

                    <div className="flex justify-end gap-2">
                        <Button icon={<RotateCcw className="size-4" />} onClick={() => setMargins(defaultMargins)}>重置</Button>
                        <Button icon={<X className="size-4" />} onClick={onClose}>取消</Button>
                        <Button type="primary" icon={<Check className="size-4" />} loading={submitting} disabled={invalid} onClick={() => void submit()}>生成扩图</Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
