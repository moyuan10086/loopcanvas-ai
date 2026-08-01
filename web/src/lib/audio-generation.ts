export const audioVoiceOptions = [
    { value: "alloy", label: "Alloy" },
    { value: "ash", label: "Ash" },
    { value: "ballad", label: "Ballad" },
    { value: "coral", label: "Coral" },
    { value: "echo", label: "Echo" },
    { value: "fable", label: "Fable" },
    { value: "nova", label: "Nova" },
    { value: "onyx", label: "Onyx" },
    { value: "sage", label: "Sage" },
    { value: "shimmer", label: "Shimmer" },
    { value: "verse", label: "Verse" },
    { value: "marin", label: "Marin" },
    { value: "cedar", label: "Cedar" },
];

export const miniMaxAudioVoiceOptions = [
    { value: "male-qn-qingse", label: "青涩青年" },
    { value: "male-qn-jingying", label: "精英青年" },
    { value: "female-shaonv", label: "少女" },
    { value: "female-yujie", label: "御姐" },
    { value: "female-chengshu", label: "成熟女声" },
    { value: "female-tianmei", label: "甜美女声" },
];

export const miniMaxAudioModelOptions = ["speech-2.8-hd", "speech-2.8-turbo", "speech-2.6-hd", "speech-2.6-turbo", "music-2.6", "music-2.6-free"];

export const audioFormatOptions = [
    { value: "mp3", label: "MP3" },
    { value: "wav", label: "WAV" },
    { value: "opus", label: "Opus" },
    { value: "aac", label: "AAC" },
    { value: "flac", label: "FLAC" },
    { value: "pcm", label: "PCM" },
];

export const miniMaxMusicFormatOptions = audioFormatOptions.filter((item) => item.value === "mp3" || item.value === "wav");
export const miniMaxSpeechFormatOptions = audioFormatOptions.filter((item) => item.value === "mp3" || item.value === "wav" || item.value === "opus" || item.value === "flac");

export function isMiniMaxSpeechModel(value: string) {
    return audioModelName(value).startsWith("speech-");
}

export function isMiniMaxMusicModel(value: string) {
    const model = audioModelName(value);
    return model === "music-2.6" || model === "music-2.6-free";
}

export function audioVoiceOptionsForModel(model: string) {
    return isMiniMaxSpeechModel(model) ? miniMaxAudioVoiceOptions : audioVoiceOptions;
}

export function audioFormatOptionsForModel(model: string) {
    if (isMiniMaxMusicModel(model)) return miniMaxMusicFormatOptions;
    if (isMiniMaxSpeechModel(model)) return miniMaxSpeechFormatOptions;
    return audioFormatOptions;
}

export function normalizeAudioVoiceValue(value: string) {
    return audioVoiceOptions.some((item) => item.value === value) ? value : "alloy";
}

export function normalizeAudioVoiceForModel(model: string, value: string) {
    if (!isMiniMaxSpeechModel(model)) return normalizeAudioVoiceValue(value);
    const voice = value.trim();
    return voice && !audioVoiceOptions.some((item) => item.value === voice) ? voice : "male-qn-qingse";
}

export function normalizeAudioFormatValue(value: string) {
    return audioFormatOptions.some((item) => item.value === value) ? value : "mp3";
}

export function normalizeAudioFormatForModel(model: string, value: string) {
    const options = audioFormatOptionsForModel(model);
    return options.some((item) => item.value === value) ? value : "mp3";
}

export function normalizeAudioSpeedValue(value: string) {
    const speed = Number(value);
    if (!Number.isFinite(speed)) return "1";
    return String(Math.max(0.25, Math.min(4, Number(speed.toFixed(2)))));
}

export function normalizeAudioSpeedForModel(model: string, value: string) {
    const speed = Number(normalizeAudioSpeedValue(value));
    return String(isMiniMaxSpeechModel(model) ? Math.max(0.5, Math.min(2, speed)) : speed);
}

export function audioVoiceLabel(value: string) {
    const voice = normalizeAudioVoiceValue(value);
    return audioVoiceOptions.find((item) => item.value === voice)?.label || voice;
}

export function audioVoiceLabelForModel(model: string, value: string) {
    const voice = normalizeAudioVoiceForModel(model, value);
    return audioVoiceOptionsForModel(model).find((item) => item.value === voice)?.label || voice;
}

export function audioFormatLabel(value: string) {
    const format = normalizeAudioFormatValue(value);
    return audioFormatOptions.find((item) => item.value === format)?.label || format;
}

export function audioFormatLabelForModel(model: string, value: string) {
    const format = normalizeAudioFormatForModel(model, value);
    return audioFormatOptionsForModel(model).find((item) => item.value === format)?.label || format;
}

export function audioSpeedLabel(value: string) {
    return `${normalizeAudioSpeedValue(value)}x`;
}

export function audioMimeType(format: string) {
    if (format === "wav") return "audio/wav";
    if (format === "opus") return "audio/opus";
    if (format === "aac") return "audio/aac";
    if (format === "flac") return "audio/flac";
    if (format === "pcm") return "audio/pcm";
    return "audio/mpeg";
}

function audioModelName(value: string) {
    const separator = value.lastIndexOf("::");
    return (separator >= 0 ? value.slice(separator + 2) : value).trim().toLowerCase();
}
