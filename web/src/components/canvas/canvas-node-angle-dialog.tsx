import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Modal, Slider, Switch } from "antd";
import { PersonStanding, RotateCcw, WandSparkles } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import type { AiConfig } from "@/stores/use-config-store";

export type CanvasImageAngleParams = {
    rotation: number;
    tilt: number;
    zoom: number;
    wideAngle: boolean;
};

const defaultParams: CanvasImageAngleParams = {
    rotation: 0,
    tilt: 0,
    zoom: 0,
    wideAngle: false,
};

const hiddenSliderTooltip = { open: false } as const;

type CanvasNodeAngleDialogProps = {
    config: AiConfig;
    dataUrl: string;
    defaultModel: string;
    models: string[];
    open: boolean;
    onClose: () => void;
    onConfirm: (params: CanvasImageAngleParams, model: string) => void;
    onMissingConfig?: () => void;
};

export function CanvasNodeAngleDialog({ config, dataUrl, defaultModel, models, open, onClose, onConfirm, onMissingConfig }: CanvasNodeAngleDialogProps) {
    const [params, setParams] = useState(defaultParams);
    const [model, setModel] = useState(defaultModel);
    const draggingRef = useRef({ active: false, lastX: 0, lastY: 0 });

    useEffect(() => {
        if (!open) return;
        draggingRef.current = { active: false, lastX: 0, lastY: 0 };
        setParams(defaultParams);
        setModel(defaultModel);
    }, [dataUrl, defaultModel, open]);

    const update = <Key extends keyof CanvasImageAngleParams>(key: Key, value: CanvasImageAngleParams[Key]) => setParams((current) => (current[key] === value ? current : { ...current, [key]: value }));
    const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        draggingRef.current = { active: true, lastX: event.clientX, lastY: event.clientY };
    };
    const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
        const dragging = draggingRef.current;
        if (!dragging.active) return;
        event.preventDefault();
        const dx = event.clientX - dragging.lastX;
        const dy = event.clientY - dragging.lastY;
        draggingRef.current = { active: true, lastX: event.clientX, lastY: event.clientY };
        setParams((current) => {
            const rotation = clamp(Math.round(current.rotation + dx * 0.5), -180, 180);
            const tilt = clamp(Math.round(current.tilt - dy * 0.45), -45, 45);
            return rotation === current.rotation && tilt === current.tilt ? current : { ...current, rotation, tilt };
        });
    };
    const stopDrag = () => {
        draggingRef.current.active = false;
    };

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={900} centered destroyOnHidden>
            <div className="space-y-5">
                <div>
                    <h2 className="text-xl font-semibold">视角调整</h2>
                    <p className="mt-1 text-sm opacity-60">拖动 3D 立方体调整人物旋转与倾斜，结果会基于原图重新生成，而不是简单拉伸图片</p>
                </div>
                <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-4 rounded-lg border px-4 py-3">
                    <span className="font-medium opacity-75">生成模型</span>
                    <ModelPicker config={config} models={models} value={model} onChange={setModel} capability="image" fullWidth placeholder="选择图片编辑模型" onMissingConfig={onMissingConfig} />
                </div>
                <div className="grid gap-6 md:grid-cols-[minmax(300px,1fr)_380px]">
                    <div className="flex min-h-[340px] flex-col rounded-xl border p-4">
                        <div className="relative grid flex-1 place-items-center overflow-hidden rounded-xl bg-black/[.035] select-none dark:bg-white/[.035]">
                            <div
                                className="relative grid size-[250px] touch-none cursor-grab place-items-center overflow-hidden rounded-2xl border border-black/10 bg-background/70 shadow-inner active:cursor-grabbing dark:border-white/10"
                                onPointerDown={startDrag}
                                onPointerMove={moveDrag}
                                onPointerUp={stopDrag}
                                onPointerCancel={stopDrag}
                            >
                                <OrientationCube params={params} />
                            </div>
                            <div className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-xs opacity-55">拖动立方体调整人物视角</div>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-xs opacity-55">左右控制旋转，上下控制倾斜</span>
                            <Button type="text" icon={<RotateCcw className="size-4" />} onClick={() => setParams(defaultParams)}>
                                重置
                            </Button>
                        </div>
                    </div>
                    <div className="space-y-6 py-2">
                        <AngleSlider label="旋转" value={params.rotation} min={-180} max={180} step={1} suffix="°" onChange={(value) => update("rotation", value)} />
                        <AngleSlider label="倾斜" value={params.tilt} min={-45} max={45} step={1} suffix="°" onChange={(value) => update("tilt", value)} />
                        <AngleSlider label="推进" value={params.zoom} min={0} max={10} step={0.1} onChange={(value) => update("zoom", value)} />
                        <div className="grid grid-cols-[88px_1fr_72px] items-center gap-4">
                            <span className="font-medium opacity-75">广角镜头</span>
                            <Switch checked={params.wideAngle} onChange={(checked) => update("wideAngle", checked)} />
                            <span className="text-right text-sm font-semibold">{params.wideAngle ? "开启" : "关闭"}</span>
                        </div>
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button type="primary" size="large" icon={<WandSparkles className="size-4" />} disabled={!model} onClick={() => onConfirm(params, model)}>
                        生成新视角
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function AngleSlider({ label, value, min, max, step, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void }) {
    return (
        <div className="grid grid-cols-[88px_1fr_72px] items-center gap-4">
            <span className="font-medium opacity-75">{label}</span>
            <Slider min={min} max={max} step={step} value={value} tooltip={hiddenSliderTooltip} onChange={onChange} />
            <span className="whitespace-nowrap text-right font-semibold">
                {Number.isInteger(value) ? value : value.toFixed(1)}
                {suffix}
            </span>
        </div>
    );
}

function OrientationCube({ params }: { params: CanvasImageAngleParams }) {
    const half = 54;
    const scale = 1 + params.zoom * 0.1;
    const faceClass = "absolute inset-0 grid place-items-center rounded-xl border border-black/15 bg-muted/95 text-sm font-semibold text-foreground shadow-inner [backface-visibility:hidden] dark:border-white/15";
    return (
        <div className="pointer-events-none relative size-[108px]" style={{ perspective: 520 }}>
            <div
                className="relative size-full transition-transform duration-75"
                style={{ transformStyle: "preserve-3d", transform: `rotateX(${-18 - params.tilt * 0.75}deg) rotateY(${32 - params.rotation}deg) scale3d(${scale}, ${scale}, ${scale})` }}
            >
                <div className={faceClass} style={{ transform: `translateZ(${half}px)` }}>
                    <PersonStanding className="size-9 opacity-75" />
                </div>
                <div className={faceClass} style={{ transform: `rotateY(180deg) translateZ(${half}px)` }}>
                    后
                </div>
                <div className={faceClass} style={{ transform: `rotateY(90deg) translateZ(${half}px)` }}>
                    右
                </div>
                <div className={faceClass} style={{ transform: `rotateY(-90deg) translateZ(${half}px)` }}>
                    左
                </div>
                <div className={faceClass} style={{ transform: `rotateX(90deg) translateZ(${half}px)` }}>
                    上
                </div>
                <div className={faceClass} style={{ transform: `rotateX(-90deg) translateZ(${half}px)` }}>
                    下
                </div>
            </div>
        </div>
    );
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
