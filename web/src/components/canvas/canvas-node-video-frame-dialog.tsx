import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "antd";
import { Image as ImageIcon, Pause, Play, Sparkles } from "lucide-react";

type Props = {
    dataUrl: string;
    open: boolean;
    onClose: () => void;
    onConfirm: (image: Blob, timeMs: number) => void;
};

export function CanvasNodeVideoFrameDialog({ dataUrl, open, onClose, onConfirm }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [duration, setDuration] = useState(0);
    const [timeMs, setTimeMs] = useState(0);
    const [previewUrl, setPreviewUrl] = useState("");
    const [capturing, setCapturing] = useState(false);
    const [playing, setPlaying] = useState(false);

    useEffect(() => {
        if (!open) return;
        setDuration(0);
        setTimeMs(0);
        setPreviewUrl("");
        setCapturing(false);
        setPlaying(false);
    }, [dataUrl, open]);

    useEffect(() => {
        return () => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        };
    }, [previewUrl]);

    const capture = async () => {
        const video = videoRef.current;
        if (!video || !video.videoWidth || !video.videoHeight) return;
        setCapturing(true);
        try {
            const targetTime = Math.min(Math.max(timeMs / 1000, 0), duration || video.duration || 0);
            await new Promise<void>((resolve, reject) => {
                if (Math.abs(video.currentTime - targetTime) < 0.01) {
                    resolve();
                    return;
                }
                const done = () => {
                    video.removeEventListener("seeked", done);
                    video.removeEventListener("error", fail);
                    resolve();
                };
                const fail = () => {
                    video.removeEventListener("seeked", done);
                    video.removeEventListener("error", fail);
                    reject(new Error("视频帧定位失败"));
                };
                video.addEventListener("seeked", done, { once: true });
                video.addEventListener("error", fail, { once: true });
                video.currentTime = targetTime;
            });
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("视频帧导出失败"))), "image/png"));
            setPreviewUrl(URL.createObjectURL(blob));
            onConfirm(blob, targetTime * 1000);
        } catch (error) {
            Modal.error({ title: "抽帧失败", content: error instanceof Error ? error.message : "无法读取视频帧" });
        } finally {
            setCapturing(false);
        }
    };

    const togglePlayback = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        } else {
            video.pause();
            setPlaying(false);
        }
    };

    const updateTime = (value: number) => {
        setTimeMs(value);
        const video = videoRef.current;
        if (video && Number.isFinite(value)) video.currentTime = value / 1000;
    };

    return (
        <Modal title="提取视频帧" open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={760} centered destroyOnHidden>
            <div className="space-y-4">
                <div className="relative overflow-hidden rounded-xl bg-black">
                    <video
                        ref={videoRef}
                        src={dataUrl}
                        className="max-h-[52vh] w-full object-contain"
                        crossOrigin="anonymous"
                        controls={false}
                        playsInline
                        preload="metadata"
                        onClick={togglePlayback}
                        onLoadedMetadata={(event) => {
                            setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
                            setTimeMs(0);
                        }}
                        onTimeUpdate={(event) => setTimeMs(event.currentTarget.currentTime * 1000)}
                        onPlay={() => setPlaying(true)}
                        onPause={() => setPlaying(false)}
                        onEnded={() => setPlaying(false)}
                    />
                    <button
                        type="button"
                        className="absolute bottom-3 left-3 grid size-9 place-items-center rounded-full bg-black/65 text-white"
                        onClick={(event) => {
                            event.stopPropagation();
                            togglePlayback();
                        }}
                        aria-label={playing ? "暂停" : "播放"}
                    >
                        {playing ? <Pause className="size-4" /> : <Play className="size-4 fill-current" />}
                    </button>
                </div>
                <div className="flex items-center gap-3">
                    <input
                        className="min-w-0 flex-1 accent-blue-500"
                        type="range"
                        min={0}
                        max={Math.max(duration * 1000, 1)}
                        step={10}
                        value={Math.min(timeMs, Math.max(duration * 1000, 1))}
                        onChange={(event) => updateTime(Number(event.target.value))}
                        disabled={!duration || capturing}
                        aria-label="视频时间"
                    />
                    <span className="w-28 text-right text-sm tabular-nums opacity-70">{(timeMs / 1000).toFixed(2)} / {duration.toFixed(2)} s</span>
                </div>
                {previewUrl ? <img src={previewUrl} alt="视频帧预览" className="max-h-48 w-full rounded-lg border object-contain" /> : null}
                <div className="flex justify-end gap-2">
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" icon={<ImageIcon className="size-4" />} loading={capturing} onClick={() => void capture()}>
                        提取当前帧
                    </Button>
                    <Button disabled={!previewUrl || capturing} icon={<Sparkles className="size-4" />} onClick={onClose}>
                        完成
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
