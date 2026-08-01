import type { VideoFrameMode } from "@/types/media";

export const videoFrameModeOptions: Array<{ value: VideoFrameMode; label: string; description: string }> = [
    { value: "reference", label: "参考图", description: "连接的图片作为内容与风格参考" },
    { value: "first-frame", label: "首帧", description: "第 1 张图片固定为视频首帧" },
    { value: "first-last-frame", label: "首尾帧", description: "前 2 张图片依次作为首帧和尾帧，可一键交换顺序" },
];

export const seedanceVideoFrameModeOptions = videoFrameModeOptions.map((item) => (item.value === "reference" ? { ...item, label: "全能参考", description: "图片、视频和音频可联合控制，最多 9 张图、3 条视频、3 段音频" } : item));

export function normalizeVideoFrameMode(value: unknown): VideoFrameMode {
    return value === "first-frame" || value === "first-last-frame" ? value : "reference";
}

export function videoFrameModeLabel(value: unknown, seedance = false) {
    const mode = normalizeVideoFrameMode(value);
    const options = seedance ? seedanceVideoFrameModeOptions : videoFrameModeOptions;
    return options.find((item) => item.value === mode)?.label || (seedance ? "全能参考" : "参考图");
}

export function videoFrameReferenceLabel(value: unknown, index: number) {
    const mode = normalizeVideoFrameMode(value);
    if (mode === "first-frame" && index === 0) return "首帧";
    if (mode === "first-last-frame") return index === 0 ? "首帧" : index === 1 ? "尾帧" : `图片${index + 1}`;
    return `图片${index + 1}`;
}

export function videoFramePreset(value: unknown) {
    const mode = normalizeVideoFrameMode(value);
    return mode === "first-frame" ? "first_frame" : mode === "first-last-frame" ? "first_last_frame" : "normal";
}

export function videoFrameModeError(value: unknown, imageCount: number) {
    const mode = normalizeVideoFrameMode(value);
    if (mode === "first-frame" && imageCount < 1) return "首帧模式需要至少连接或上传 1 张图片";
    if (mode === "first-last-frame" && imageCount < 2) return "首尾帧模式需要至少连接或上传 2 张图片，前两张依次作为首帧和尾帧";
    return "";
}
