import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export function canvasImageGlobalId(nodeId: string) {
    let primary = 0x811c9dc5;
    let secondary = 5381;
    for (let index = 0; index < nodeId.length; index += 1) {
        const code = nodeId.charCodeAt(index);
        primary ^= code;
        primary = Math.imul(primary, 0x01000193);
        secondary = Math.imul(secondary, 33) ^ code;
    }
    const value = `${(primary >>> 0).toString(16).padStart(8, "0")}${(secondary >>> 0).toString(16).padStart(8, "0")}`;
    return `IMG-${value.slice(0, 12).toUpperCase()}`;
}

export function ensureCanvasImageGlobalIds(nodes: CanvasNodeData[]) {
    const used = new Set<string>();
    let changed = false;
    const next = nodes.map((node) => {
        if (node.type !== CanvasNodeType.Image) return node;
        const saved = node.metadata?.globalImageId?.trim();
        let globalImageId = saved && /^IMG-[A-F0-9]{12}(?:-\d+)?$/.test(saved) && !used.has(saved) ? saved : canvasImageGlobalId(node.id);
        let collision = 1;
        while (used.has(globalImageId)) globalImageId = `${canvasImageGlobalId(node.id)}-${collision++}`;
        used.add(globalImageId);
        if (saved === globalImageId) return node;
        changed = true;
        return { ...node, metadata: { ...node.metadata, globalImageId } };
    });
    const imageByNodeId = new Map(next.filter((node) => node.type === CanvasNodeType.Image).map((node) => [node.id, node]));
    const imageByReference = new Map<string, CanvasNodeData>();
    imageByNodeId.forEach((node) => {
        if (node.metadata?.storageKey) imageByReference.set(node.metadata.storageKey, node);
        if (node.metadata?.content && !node.metadata.content.startsWith("blob:")) imageByReference.set(node.metadata.content, node);
    });
    const withReferenceLabels = next.map((node) => {
        const references = node.metadata?.references || [];
        const savedNodeIds = node.metadata?.referenceNodeIds || [];
        const inferredNodeIds = references.map((reference, index) => savedNodeIds[index] || imageByReference.get(reference)?.id);
        const referenceNodeIds = inferredNodeIds.length && inferredNodeIds.every(Boolean) ? (inferredNodeIds as string[]) : savedNodeIds;
        if (!referenceNodeIds?.length) return node;
        const currentLabels = node.metadata?.referenceLabels || [];
        const referenceLabels = referenceNodeIds.map((nodeId, index) => {
            const current = currentLabels[index]?.trim();
            const source = imageByNodeId.get(nodeId);
            const globalImageId = source?.metadata?.globalImageId || canvasImageGlobalId(nodeId);
            if (current?.startsWith(`${globalImageId} ·`) || current === globalImageId) return current;
            if (current?.startsWith("IMG-")) return [globalImageId, current.split(" · ").slice(1).join(" · ")].filter(Boolean).join(" · ");
            return [globalImageId, current || source?.title].filter(Boolean).join(" · ");
        });
        const nodeIdsChanged = referenceNodeIds.length !== savedNodeIds.length || referenceNodeIds.some((nodeId, index) => nodeId !== savedNodeIds[index]);
        if (!nodeIdsChanged && referenceLabels.every((label, index) => label === currentLabels[index])) return node;
        changed = true;
        return { ...node, metadata: { ...node.metadata, referenceNodeIds, referenceLabels } };
    });
    return changed ? withReferenceLabels : nodes;
}
