import { type ReactNode } from "react";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { audioFormatOptionsForModel, audioSpeedLabel, audioVoiceOptionsForModel, isMiniMaxMusicModel, isMiniMaxSpeechModel, normalizeAudioFormatForModel, normalizeAudioSpeedForModel, normalizeAudioVoiceForModel } from "@/lib/audio-generation";
import { type CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";

const speedOptions = ["0.75", "1", "1.25", "1.5"];

type AudioSettingKey = "audioVoice" | "audioFormat" | "audioSpeed" | "audioInstructions" | "audioMusicLyrics" | "audioMusicInstrumental";

type AudioSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: AudioSettingKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function AudioSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: AudioSettingsPanelProps) {
    const music = isMiniMaxMusicModel(config.model);
    const miniMaxSpeech = isMiniMaxSpeechModel(config.model);
    const voice = normalizeAudioVoiceForModel(config.model, config.audioVoice);
    const format = normalizeAudioFormatForModel(config.model, config.audioFormat);
    const speed = normalizeAudioSpeedForModel(config.model, config.audioSpeed);
    const instrumental = config.audioMusicInstrumental === "true";
    const formatOptions = audioFormatOptionsForModel(config.model);
    const voiceOptions = audioVoiceOptionsForModel(config.model);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{music ? "音乐设置" : "语音设置"}</div> : null}
                {music ? (
                    <SettingGroup title="音乐类型" color={theme.node.muted}>
                        <div className="grid grid-cols-2 gap-2.5">
                            <OptionPill selected={!instrumental} theme={theme} onClick={() => onConfigChange("audioMusicInstrumental", "false")}>歌曲</OptionPill>
                            <OptionPill selected={instrumental} theme={theme} onClick={() => onConfigChange("audioMusicInstrumental", "true")}>纯音乐</OptionPill>
                        </div>
                    </SettingGroup>
                ) : (
                    <SettingGroup title={miniMaxSpeech ? "MiniMax 音色" : "声音"} color={theme.node.muted}>
                        <div className="grid grid-cols-3 gap-2.5">
                            {voiceOptions.map((item) => (
                                <OptionPill key={item.value} selected={voice === item.value} theme={theme} onClick={() => onConfigChange("audioVoice", item.value)}>
                                    {item.label}
                                </OptionPill>
                            ))}
                        </div>
                        {miniMaxSpeech ? (
                            <input
                                value={voice}
                                placeholder="也可输入系统、复刻或设计音色 ID"
                                className="h-9 w-full rounded-full border bg-transparent px-3 text-sm outline-none"
                                style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                                onChange={(event) => onConfigChange("audioVoice", event.target.value)}
                                onMouseDown={(event) => event.stopPropagation()}
                            />
                        ) : null}
                    </SettingGroup>
                )}
                <SettingGroup title="格式" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {formatOptions.map((item) => (
                            <OptionPill key={item.value} selected={format === item.value} theme={theme} onClick={() => onConfigChange("audioFormat", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                {!music ? (
                    <SettingGroup title="语速" color={theme.node.muted}>
                        <div className="grid grid-cols-4 gap-2.5">
                            {speedOptions.map((value) => (
                                <OptionPill key={value} selected={speed === value} theme={theme} onClick={() => onConfigChange("audioSpeed", value)}>
                                    {audioSpeedLabel(value)}
                                </OptionPill>
                            ))}
                        </div>
                        <input
                            type="number"
                            min={miniMaxSpeech ? 0.5 : 0.25}
                            max={miniMaxSpeech ? 2 : 4}
                            step={0.05}
                            className="h-9 w-full rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                            value={config.audioSpeed || "1"}
                            onChange={(event) => onConfigChange("audioSpeed", event.target.value)}
                            onBlur={(event) => onConfigChange("audioSpeed", normalizeAudioSpeedForModel(config.model, event.target.value))}
                            onMouseDown={(event) => event.stopPropagation()}
                        />
                    </SettingGroup>
                ) : null}
                {music && !instrumental ? (
                    <SettingGroup title="歌词" color={theme.node.muted}>
                        <textarea
                            value={config.audioMusicLyrics || ""}
                            placeholder="可填写 [Verse]、[Chorus] 等结构化歌词；留空时根据音乐描述自动生成歌词。"
                            className="thin-scrollbar h-28 w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-sm leading-5 outline-none"
                            style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                            onChange={(event) => onConfigChange("audioMusicLyrics", event.target.value)}
                            onMouseDown={(event) => event.stopPropagation()}
                        />
                    </SettingGroup>
                ) : !miniMaxSpeech ? (
                    <SettingGroup title="声音指令" color={theme.node.muted}>
                        <textarea
                            value={config.audioInstructions || ""}
                            placeholder="例如：自然、温暖、适合旁白。"
                            className="thin-scrollbar h-20 w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-sm leading-5 outline-none"
                            style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                            onChange={(event) => onConfigChange("audioInstructions", event.target.value)}
                            onMouseDown={(event) => event.stopPropagation()}
                        />
                    </SettingGroup>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}
