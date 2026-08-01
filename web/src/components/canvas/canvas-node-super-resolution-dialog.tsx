import { useEffect, useMemo, useState } from "react";
import { Button, Modal, Segmented } from "antd";
import { Settings2, Sparkles } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import { resolveUpscaleSize } from "@/lib/canvas/canvas-image-data";
import { readImageMeta } from "@/lib/image-utils";
import { resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import type { ImageSuperResolutionParams } from "@/services/api/image";

const targets = [
    { label: "2K", value: 2048 },
    { label: "4K", value: 4096 },
];

type Props = {
    config: AiConfig;
    dataUrl: string;
    defaultModel: string;
    models: string[];
    open: boolean;
    onClose: () => void;
    onConfirm: (params: ImageSuperResolutionParams, model: string) => void;
    onMissingConfig: () => void;
};

export function CanvasNodeSuperResolutionDialog({ config, dataUrl, defaultModel, models, open, onClose, onConfirm, onMissingConfig }: Props) {
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [targetLongEdge, setTargetLongEdge] = useState(2048);
    const [model, setModel] = useState(defaultModel);
    const [useWallet, setUseWallet] = useState(false);
    const selectedChannel = useMemo(() => resolveModelChannel(config, model), [config, model]);
    const hasRhKey = Boolean(selectedChannel.apiKey.trim());
    const hasWalletKey = Boolean(selectedChannel.walletApiKey?.trim());
    const defaultUseWallet = selectedChannel.runningHubKeyMode === "wallet" ? hasWalletKey : selectedChannel.runningHubKeyMode === "rh" ? !hasRhKey && hasWalletKey : !hasRhKey && hasWalletKey;
    const sourceLongEdge = image ? Math.max(image.width, image.height) : 0;
    const outputSize = useMemo(() => (image ? resolveUpscaleSize(image.width, image.height, targetLongEdge) : null), [image, targetLongEdge]);
    const canRun = Boolean(model && outputSize && sourceLongEdge < targetLongEdge);

    useEffect(() => {
        if (!open) return;
        setImage(null);
        setModel(defaultModel);
        setUseWallet(defaultUseWallet);
        void readImageMeta(dataUrl).then((meta) => {
            setImage(meta);
            setTargetLongEdge(Math.max(meta.width, meta.height) < 2048 ? 2048 : 4096);
        });
    }, [dataUrl, defaultModel, defaultUseWallet, open]);

    useEffect(() => {
        if (!hasWalletKey) setUseWallet(false);
    }, [hasWalletKey]);

    return (
        <Modal title={null} open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={860} centered destroyOnHidden>
            <div className="space-y-5">
                <h2 className="text-xl font-semibold">AI 超分</h2>
                <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-4 rounded-lg border px-4 py-3">
                    <span className="font-medium opacity-75">工作流</span>
                    <ModelPicker config={config} models={models} value={model} onChange={setModel} capability="image" fullWidth placeholder="选择 RunningHub 超分工作流" onMissingConfig={onMissingConfig} />
                </div>
                <div className="grid gap-6 md:grid-cols-[minmax(300px,1fr)_360px]">
                    <div className="flex min-h-[340px] flex-col rounded-xl border p-4">
                        <div className="grid flex-1 place-items-center overflow-hidden rounded-lg bg-black/[.035] dark:bg-white/[.035]">
                            <img src={dataUrl} alt="" className="max-h-[320px] max-w-full object-contain" draggable={false} />
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm">
                            <span className="opacity-60">源图</span>
                            <span className="font-semibold tabular-nums">{image ? `${image.width} x ${image.height} px` : "读取中"}</span>
                        </div>
                    </div>
                    <div className="space-y-5 py-2">
                        <div className="space-y-2">
                            <div className="font-medium opacity-75">目标分辨率</div>
                            <Segmented
                                block
                                value={targetLongEdge}
                                options={targets.map((target) => ({ ...target, label: `${target.label} · ${target.value}px`, disabled: Boolean(image && sourceLongEdge >= target.value) }))}
                                onChange={(value) => setTargetLongEdge(Number(value))}
                            />
                        </div>
                        {hasWalletKey ? (
                            <div className="space-y-2">
                                <div className="font-medium opacity-75">扣费方式</div>
                                <Segmented block value={useWallet ? "wallet" : "rh"} options={[{ label: "消费级-会员", value: "rh", disabled: !hasRhKey }, { label: "企业级-共享", value: "wallet", disabled: !hasWalletKey }]} onChange={(value) => setUseWallet(value === "wallet")} />
                            </div>
                        ) : null}
                        <div className="rounded-lg border px-4 py-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="opacity-60">输出尺寸</span>
                                <span className="font-semibold tabular-nums">{outputSize ? `${outputSize.width} x ${outputSize.height} px` : "未知"}</span>
                            </div>
                        </div>
                        {!models.length ? (
                            <Button block icon={<Settings2 className="size-4" />} onClick={onMissingConfig}>
                                配置 RunningHub 工作流
                            </Button>
                        ) : null}
                    </div>
                </div>
                <div className="flex justify-end">
                    <Button
                        type="primary"
                        size="large"
                        icon={<Sparkles className="size-4" />}
                        disabled={!canRun}
                        onClick={() => outputSize && onConfirm({ targetLongEdge, ...outputSize, useWallet }, model)}
                    >
                        开始超分
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
