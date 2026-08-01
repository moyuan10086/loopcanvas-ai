export type ImageAiShortcutId = "multi-angle-grid" | "cinematic-lighting" | "character-turnaround" | "scene-prediction" | "scene-reconstruction";

export type ImageAiShortcut = {
    id: ImageAiShortcutId;
    title: string;
    description: string;
    prompt: string;
    size?: string;
};

export const imageAiShortcuts: ImageAiShortcut[] = [
    {
        id: "multi-angle-grid",
        title: "多机位九宫格",
        description: "保持同一瞬间与场景，只改变机位和景别，生成 3×3 分镜参考图。",
        size: "1536x1024",
        prompt: "基于参考图生成一张 3×3 多机位电影分镜九宫格。同一主体、姿势、动作、表情、服装、道具、环境、光线、时间和色调必须完全一致，只改变相机位置、镜头焦段、景别、构图和透视。九个画面分别覆盖远景、全景、中远景、中景、中近景、近景、特写、俯拍和仰拍。画面内不要出现文字、编号、边框标题或说明。输出一张完整的 3×3 联系表图片。",
    },
    {
        id: "cinematic-lighting",
        title: "电影级光影校正",
        description: "只调整光线、曝光、色温与电影光学效果，不改变画面内容。",
        prompt: "对参考图进行电影级光影校正。严格保留人物、五官、姿势、服装、道具、环境、构图和所有物体结构，只允许调整光线方向、曝光、阴影层次、色温、反射、体积光、景深、光晕和电影胶片质感。光源必须符合场景物理逻辑，避免平光和过度磨皮，呈现真实、克制、专业的电影摄影效果。",
    },
    {
        id: "character-turnaround",
        title: "角色三视图生成",
        description: "提取角色身份与服装细节，生成正面、侧面、背面的标准设定表。",
        size: "1536x1024",
        prompt: "分析参考图中的角色身份、年龄特征、发型、五官、体型以及服装的材质、剪裁、颜色和配饰，生成一张专业角色三视图设定表。画面必须同时包含同一角色的正面、标准侧面和背面视图，三者身份、比例、发型与服装细节完全一致。使用自然的 T-pose 或 A-pose、中性棚拍光线、纯净浅灰背景、全身构图。丢弃原图背景、原姿势和原光线，不添加文字、标注或多余角色。",
    },
    {
        id: "scene-prediction",
        title: "画面推演 · 3 秒后",
        description: "把参考图视为起始帧，推演符合物理逻辑的 3 秒后画面。",
        prompt: "把参考图视为视频的起始帧，推演同一场景 3 秒后的状态。严格保持人物身份、服装、环境风格、光线方向和色调，仅根据当前动作趋势与物理规律改变姿势、位置和运动结果，可合理加入运动模糊、烟尘、飞溅或物体交互。输出一张连贯可信、具有电影感的 3 秒后关键帧。",
    },
    {
        id: "scene-reconstruction",
        title: "画面回推 · 5 秒前",
        description: "把参考图视为结果帧，反推符合因果关系的 5 秒前画面。",
        prompt: "把参考图视为动作发生后的结果帧，依据当前运动、受力和物体状态，反推同一场景 5 秒前的起因或准备动作。严格保持人物身份、服装、环境风格、光线和色调，只改变姿势、位置与物体完整状态，使前后因果清晰并符合物理逻辑。输出一张连贯可信、具有电影感的 5 秒前关键帧。",
    },
];

export function getImageAiShortcut(id: ImageAiShortcutId) {
    return imageAiShortcuts.find((item) => item.id === id)!;
}
