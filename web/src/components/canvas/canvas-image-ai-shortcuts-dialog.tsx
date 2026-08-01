import { Camera, Drama, Grid2x2, History, Lightbulb, WandSparkles } from "lucide-react";
import { Modal } from "antd";

import { imageAiShortcuts, type ImageAiShortcutId } from "./canvas-image-ai-shortcuts";

const cameraAngleShortcut = {
    id: "camera-angle",
    title: "视角调整",
    description: "拖动控制旋转与倾斜，并精调镜头推进和广角效果，重新生成同一主体的新视角。",
} as const;

const shortcutIcons = {
    "camera-angle": Camera,
    "multi-angle-grid": Grid2x2,
    "cinematic-lighting": Lightbulb,
    "character-turnaround": Drama,
    "scene-prediction": Camera,
    "scene-reconstruction": History,
} as const;

export function CanvasImageAiShortcutsDialog({ open, onClose, onOpenAngle, onSelect }: { open: boolean; onClose: () => void; onOpenAngle: () => void; onSelect: (id: ImageAiShortcutId) => void }) {
    return (
        <Modal title="AI 快捷功能" open={open} footer={null} width={560} onCancel={onClose}>
            <div className="grid gap-2 pt-1">
                {[cameraAngleShortcut, ...imageAiShortcuts].map((item) => {
                    const Icon = shortcutIcons[item.id] || WandSparkles;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-3 text-left transition hover:bg-muted/60"
                            onClick={() => (item.id === "camera-angle" ? onOpenAngle() : onSelect(item.id))}
                        >
                            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
                                <Icon className="size-5" />
                            </span>
                            <span className="min-w-0">
                                <span className="block text-sm font-semibold">{item.title}</span>
                                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.description}</span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </Modal>
    );
}
