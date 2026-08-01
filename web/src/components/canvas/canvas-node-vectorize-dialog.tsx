import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, InputNumber, Modal, Segmented, Slider, Spin } from "antd";
import { Download, Spline } from "lucide-react";

import { customizeVectorSvg, vectorizeImage, type ImageVectorizeResult, type VectorizerMode } from "@/lib/image-vectorizer";

export type CanvasImageVectorizePayload = {
    svg: string;
    width: number;
    height: number;
};

type CanvasNodeVectorizeDialogProps = {
    dataUrl: string;
    open: boolean;
    onClose: () => void;
    onConfirm: (payload: CanvasImageVectorizePayload) => void;
};

const MODE_OPTIONS = [
    { label: "极速", value: "fast" },
    { label: "标准", value: "standard" },
    { label: "精细", value: "detailed" },
];

export function CanvasNodeVectorizeDialog({ dataUrl, open, onClose, onConfirm }: CanvasNodeVectorizeDialogProps) {
    const [mode, setMode] = useState<VectorizerMode>("standard");
    const [colors, setColors] = useState(16);
    const [removeWhite, setRemoveWhite] = useState(false);
    const [result, setResult] = useState<ImageVectorizeResult | null>(null);
    const [replacements, setReplacements] = useState<Record<string, string>>({});
    const [tracing, setTracing] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!open) return;
        let canceled = false;
        const timer = window.setTimeout(() => {
            setTracing(true);
            setError("");
            void vectorizeImage(dataUrl, { mode, colors })
                .then((next) => {
                    if (canceled) return;
                    setResult(next);
                    setReplacements(Object.fromEntries(next.colors.map((color) => [color, color])));
                })
                .catch((reason: unknown) => {
                    if (!canceled) setError(reason instanceof Error ? reason.message : "矢量化失败");
                })
                .finally(() => {
                    if (!canceled) setTracing(false);
                });
        }, 260);
        return () => {
            canceled = true;
            window.clearTimeout(timer);
        };
    }, [colors, dataUrl, mode, open]);

    const svg = useMemo(() => (result ? customizeVectorSvg(result.svg, replacements, removeWhite) : ""), [removeWhite, replacements, result]);
    const previewUrl = useObjectUrl(svg);
    const svgBytes = svg ? new Blob([svg]).size : 0;

    const downloadSvg = () => {
        if (!svg) return;
        const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "vectorized-image.svg";
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    };

    return (
        <Modal
            title={
                <span className="flex items-center gap-2">
                    <Spline className="size-4" />
                    图片矢量化
                </span>
            }
            open={open}
            width={1040}
            centered
            destroyOnHidden
            onCancel={onClose}
            footer={
                <div className="flex flex-wrap justify-end gap-2">
                    <Button onClick={onClose}>取消</Button>
                    <Button icon={<Download className="size-4" />} disabled={!svg || tracing} onClick={downloadSvg}>
                        下载 SVG
                    </Button>
                    <Button type="primary" icon={<Spline className="size-4" />} disabled={!result || !svg || tracing} onClick={() => result && onConfirm({ svg, width: result.width, height: result.height })}>
                        生成 SVG 节点
                    </Button>
                </div>
            }
        >
            <div className="space-y-5 pt-2">
                <div className="grid min-h-[300px] grid-cols-1 gap-4 lg:grid-cols-2">
                    <Preview title="原图" src={dataUrl} />
                    <Preview title="矢量预览" src={previewUrl} loading={tracing} error={error} />
                </div>

                <div className="grid grid-cols-1 gap-x-8 gap-y-4 border-t border-black/10 pt-5 lg:grid-cols-[280px_minmax(0,1fr)]">
                    <div className="space-y-4">
                        <label className="block space-y-2">
                            <span className="text-sm font-medium text-black/75">转换模式</span>
                            <Segmented block options={MODE_OPTIONS} value={mode} onChange={(value) => setMode(value as VectorizerMode)} />
                        </label>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm font-medium text-black/75">颜色数量</span>
                                <InputNumber min={2} max={32} value={colors} size="small" className="w-20" onChange={(value) => setColors(Number(value || 2))} />
                            </div>
                            <Slider min={2} max={32} value={colors} onChange={setColors} />
                        </div>
                        <Checkbox checked={removeWhite} onChange={(event) => setRemoveWhite(event.target.checked)}>
                            去除白色背景
                        </Checkbox>
                    </div>

                    <div className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-medium text-black/75">颜色编辑</span>
                            {result ? (
                                <span className="text-xs text-black/45">
                                    {result.width} x {result.height} · {result.pathCount} 条路径 · {formatBytes(svgBytes)}
                                </span>
                            ) : null}
                        </div>
                        <div className="flex min-h-10 flex-wrap gap-2">
                            {result?.colors.map((color) => (
                                <label key={color} className="relative size-9 cursor-pointer overflow-hidden rounded-md border border-black/15 shadow-sm" title={`${color} -> ${replacements[color] || color}`} style={{ backgroundColor: replacements[color] || color }}>
                                    <input
                                        className="absolute inset-0 cursor-pointer opacity-0"
                                        type="color"
                                        value={replacements[color] || color}
                                        aria-label={`修改颜色 ${color}`}
                                        onChange={(event) => setReplacements((current) => ({ ...current, [color]: event.target.value.toLowerCase() }))}
                                    />
                                </label>
                            ))}
                            {!result && !tracing ? <span className="text-sm text-black/45">生成预览后可编辑色板</span> : null}
                        </div>
                        {result && (result.tracedWidth !== result.width || result.tracedHeight !== result.height) ? (
                            <p className="text-xs text-black/45">为保证转换流畅，分析尺寸已自动优化为 {result.tracedWidth} x {result.tracedHeight}，SVG 输出尺寸仍保持原图比例。</p>
                        ) : null}
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function Preview({ title, src, loading = false, error = "" }: { title: string; src: string; loading?: boolean; error?: string }) {
    return (
        <section className="flex min-h-[300px] min-w-0 flex-col overflow-hidden rounded-md border border-black/10 bg-[#f3f4f6]">
            <header className="border-b border-black/10 bg-white px-3 py-2 text-sm font-medium text-black/70">{title}</header>
            <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
                {src && !error ? <img src={src} alt={title} className="max-h-[340px] max-w-full object-contain" /> : null}
                {loading ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/85 text-sm text-black/60">
                        <Spin />
                        正在转换…
                    </div>
                ) : null}
                {!loading && error ? <p className="max-w-sm px-5 text-center text-sm text-red-600">{error}</p> : null}
            </div>
        </section>
    );
}

function useObjectUrl(svg: string) {
    const [url, setUrl] = useState("");
    useEffect(() => {
        if (!svg) {
            setUrl("");
            return;
        }
        const next = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
        setUrl(next);
        return () => URL.revokeObjectURL(next);
    }, [svg]);
    return url;
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
