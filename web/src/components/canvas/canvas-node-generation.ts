import type { AiTextMessage } from "@/services/api/image";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { buildCanvasResourceReferences, buildNodeMentionReferences, getGenerationResourceNodes } from "@/lib/canvas/canvas-resource-references";

export type NodeGenerationContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

export type NodeGenerationInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio";
    title: string;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
    label?: string;
};

export type NodeGenerationContextOptions = {
    implicitReferences?: boolean;
    loopInputs?: { allNodeIds: string[]; selectedNodeIds: string[] };
    additionalInputs?: NodeGenerationInput[];
    excludedNodeIds?: string[];
};

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string, options?: NodeGenerationContextOptions): NodeGenerationContext {
    const allLoopInputIds = new Set(options?.loopInputs?.allNodeIds || []);
    const selectedLoopInputIds = new Set(options?.loopInputs?.selectedNodeIds || []);
    const excludedNodeIds = new Set(options?.excludedNodeIds || []);
    const inputs = Array.from(
        new Map(
            [...buildNodeGenerationInputs(nodeId, nodes, connections), ...(options?.additionalInputs || [])]
                .filter((input) => !excludedNodeIds.has(input.nodeId) && (!allLoopInputIds.has(input.nodeId) || selectedLoopInputIds.has(input.nodeId)))
                .map((input) => [input.nodeId, input]),
        ).values(),
    );
    const sourceNode = nodes.find((node) => node.id === nodeId);
    const promptWithTokens = replaceVisibleMentionLabels(prompt, inputs);
    const inheritedImplicitReferences = connections.some((connection) => connection.toNodeId === nodeId && nodes.find((node) => node.id === connection.fromNodeId)?.type === CanvasNodeType.Loop && nodes.find((node) => node.id === connection.fromNodeId)?.metadata?.loopImplicitReferences !== false);
    const directImageEdit = sourceNode?.type === CanvasNodeType.Image && Boolean(sourceNode.metadata?.content) && !options?.loopInputs;
    if (promptWithTokens.includes("@[node:") || (sourceNode?.type === CanvasNodeType.Config && Boolean(sourceNode.metadata?.composerContent?.trim()))) {
        return buildComposerGenerationContext(inputs, promptWithTokens, Boolean(options?.implicitReferences) || inheritedImplicitReferences, directImageEdit ? [nodeId] : []);
    }

    const upstreamText = inputs.map((input) => input.text).filter((text): text is string => Boolean(text));
    const hasExplicitAssetReference = promptWithTokens.includes("@[node:");
    const includeReferences = hasExplicitAssetReference || Boolean(options?.implicitReferences) || inheritedImplicitReferences || directImageEdit;
    const includeConnectedReferences = hasExplicitAssetReference || Boolean(options?.implicitReferences) || inheritedImplicitReferences;
    const connectedMediaInputs = inputs.filter((input) => input.nodeId !== nodeId && input.type !== "text");
    const directEditInputs = directImageEdit
        ? inputs.filter((input) => input.nodeId === nodeId || (includeConnectedReferences && connectedMediaInputs.includes(input)))
        : inputs;
    const referenceImages = includeReferences ? directEditInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image)) : [];
    const referenceVideos = includeReferences ? directEditInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video)) : [];
    const referenceAudios = includeReferences ? directEditInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio)) : [];

    return {
        prompt: appendDistinctTextInputs(prompt, upstreamText),
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

function appendDistinctTextInputs(prompt: string, inputs: string[]) {
    const initialPrompt = dedupeAdjacentPromptBlocks(prompt);
    const parts = initialPrompt ? [initialPrompt] : [];
    let combined = normalizeComparableText(initialPrompt);
    inputs.forEach((input) => {
        const text = input.trim();
        const comparable = normalizeComparableText(text);
        if (!comparable || combined.includes(comparable)) return;
        parts.push(text);
        combined = normalizeComparableText(parts.join("\n\n"));
    });
    return parts.join("\n\n");
}

export function dedupeAdjacentPromptBlocks(value: string) {
    const result: string[] = [];
    value
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => {
            if (normalizeComparableText(result[result.length - 1] || "") !== normalizeComparableText(part)) result.push(part);
        });
    return result.join("\n\n");
}

function normalizeComparableText(value: string) {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildComposerGenerationContext(inputs: NodeGenerationInput[], prompt: string, implicitReferences: boolean, preservedNodeIds: string[] = []): NodeGenerationContext {
    const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));
    const selectedInputs = preservedNodeIds.map((nodeId) => inputByNodeId.get(nodeId)).filter((input): input is NodeGenerationInput => Boolean(input));
    const selectedNodeIds = new Set(selectedInputs.map((input) => input.nodeId));
    const counts = { image: 0, video: 0, audio: 0, text: 0 };
    selectedInputs.forEach((input) => { counts[input.type] += 1; });
    let hasToken = false;
    let lastIndex = 0;
    let nextPrompt = "";

    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        if (match.index === undefined) continue;
        hasToken = true;
        nextPrompt += prompt.slice(lastIndex, match.index);
        const input = inputByNodeId.get(match[1]);
        if (input) {
            if (!selectedNodeIds.has(input.nodeId)) {
                selectedNodeIds.add(input.nodeId);
                selectedInputs.push(input);
                counts[input.type] += 1;
            }
            if (input.type === "text") nextPrompt += input.text || "";
            else if (input.label === "@固定图") nextPrompt += "固定参考图";
        }
        lastIndex = match.index + match[0].length;
    }

    nextPrompt += prompt.slice(lastIndex);
    nextPrompt = normalizeComposerPrompt(nextPrompt);
    if (implicitReferences) {
        inputs.forEach((input) => {
            if (selectedNodeIds.has(input.nodeId)) return;
            selectedNodeIds.add(input.nodeId);
            selectedInputs.push(input);
            counts[input.type] += 1;
        });
    }

    if (!hasToken) {
        const implicitInputs = implicitReferences ? selectedInputs : selectedInputs.filter((input) => preservedNodeIds.includes(input.nodeId));
        return {
            prompt,
            referenceImages: implicitInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image)),
            referenceVideos: implicitInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video)),
            referenceAudios: implicitInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio)),
            textCount: 0,
            imageCount: 0,
            videoCount: 0,
            audioCount: 0,
        };
    }

    const referenceImages = selectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = selectedInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = selectedInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));
    return {
        prompt: nextPrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: counts.text,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

function normalizeComposerPrompt(value: string) {
    return value.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    const targetNode = nodes.find((node) => node.id === nodeId);
    const labelsByNodeId = new Map((targetNode ? buildNodeMentionReferences(targetNode, nodes, connections) : []).map((reference) => [reference.nodeId, reference.label]));
    const canvasReferencesByNodeId = new Map(buildCanvasResourceReferences(nodes, connections).map((reference) => [reference.nodeId, reference]));
    const resourceNodes = getGenerationResourceNodes(nodeId, nodes, connections);
    if (targetNode && [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio].includes(targetNode.type as CanvasNodeType) && !resourceNodes.some((node) => node.id === targetNode.id)) resourceNodes.push(targetNode);
    return resourceNodes.flatMap((node): NodeGenerationInput[] => {
        const label = labelsByNodeId.get(node.id);
        const image = readReferenceImage(node, canvasReferencesByNodeId.get(node.id));
        if (image) return [{ nodeId: node.id, type: "image" as const, title: node.title, image, label }];
        const video = readReferenceVideo(node);
        if (video) return [{ nodeId: node.id, type: "video" as const, title: node.title, video, label }];
        const audio = readReferenceAudio(node);
        if (audio) return [{ nodeId: node.id, type: "audio" as const, title: node.title, audio, label }];
        const text = readNodeTextInput(node);
        if (text) return [{ nodeId: node.id, type: "text" as const, title: node.title, text, label }];
        return [];
    });
}

function replaceVisibleMentionLabels(prompt: string, inputs: NodeGenerationInput[]) {
    const references = inputs
        .filter((input): input is NodeGenerationInput & { label: string } => Boolean(input.label && prompt.includes(input.label)))
        .sort((left, right) => right.label.length - left.label.length);
    return references.reduce((value, input) => value.replace(new RegExp(escapeRegExp(input.label), "g"), `@[node:${input.nodeId}]`), prompt);
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildNodeResponseMessages(context: NodeGenerationContext): AiTextMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } }))],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    return { ...context, referenceImages: await Promise.all(context.referenceImages.map(async (image) => ({ ...image, dataUrl: await imageToDataUrl(image) }))) };
}

function readNodeTextInput(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return node.metadata?.prompt || "";
}

function readReferenceImage(node: CanvasNodeData, reference?: ReturnType<typeof buildCanvasResourceReferences>[number]): ReferenceImage | null {
    if (node.type !== CanvasNodeType.Image || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: node.metadata.mimeType || "image/png",
        dataUrl: node.metadata.content,
        storageKey: node.metadata.storageKey,
        canvasLabel: reference?.label,
        canvasTitle: node.title || reference?.title,
        globalImageId: node.metadata.globalImageId,
    };
}

function readReferenceVideo(node: CanvasNodeData): ReferenceVideo | null {
    if (node.type !== CanvasNodeType.Video || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp4`,
        type: node.metadata.mimeType || "video/mp4",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        bytes: node.metadata.bytes,
        width: node.metadata.naturalWidth,
        height: node.metadata.naturalHeight,
        durationMs: node.metadata.durationMs,
    };
}

function readReferenceAudio(node: CanvasNodeData): ReferenceAudio | null {
    if (node.type !== CanvasNodeType.Audio || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp3`,
        type: node.metadata.mimeType || "audio/mpeg",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        durationMs: node.metadata.durationMs,
    };
}
