import { collectStorageKeys } from "@/lib/canvas/canvas-export";
import { getMediaBlob, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, setImageBlob } from "@/services/image-storage";
import { backendConnection } from "@/services/config-sync";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

type CanvasProjectsResponse = { ok?: boolean; projects?: CanvasProject[]; revision?: string };
type CanvasFilesResponse = { ok?: boolean; files?: { storageKey: string; mimeType: string; bytes: number }[] };
const CANVAS_BACKEND_DIRTY_KEY = "infinite-canvas:canvas_backend_dirty";

type PendingCanvasWrite = { projects: CanvasProject[]; version: number };

let pendingWrite: PendingCanvasWrite | null = null;
let backendWrite: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let latestWriteVersion = 0;
let initializedConnection = "";
const initializations = new Map<string, Promise<CanvasProject[]>>();
const revisions = new Map<string, string>();
const projectListeners = new Set<(projects: CanvasProject[]) => void>();

export function subscribeCanvasSync(listener: (projects: CanvasProject[]) => void) {
    projectListeners.add(listener);
    return () => projectListeners.delete(listener);
}

export async function initializeCanvasSync(localProjects: CanvasProject[], options?: { force?: boolean }) {
    const connection = backendConnection();
    if (!connection) return localProjects;
    return mergeWithBackend(localProjects, connection, Boolean(options?.force), !canvasBackendDirty());
}

async function mergeWithBackend(localProjects: CanvasProject[], connection: NonNullable<ReturnType<typeof backendConnection>>, force = false, preferRemote = false) {
    const connectionId = backendConnectionId(connection);
    if (!force && initializedConnection === connectionId) return localProjects;
    const existing = initializations.get(connectionId);
    if (existing) return existing;
    const initializationVersion = latestWriteVersion;
    const initialization = (async () => {
        try {
            const response = await fetch(`${connection.url}/api/canvas-projects`, { headers: authHeaders(connection.token) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = (await response.json()) as CanvasProjectsResponse;
            if (!payload.ok || !Array.isArray(payload.projects)) throw new Error("invalid canvas projects response");
            const projects = mergeProjects(localProjects, payload.projects, preferRemote);
            revisions.set(connectionId, payload.revision || "");
            const saved = await saveProjects(projects, connection);
            initializedConnection = connectionId;
            if (pendingWrite || initializationVersion !== latestWriteVersion) return saved;
            try {
                await syncCanvasFiles(saved, connection, true);
                if (!pendingWrite && initializationVersion === latestWriteVersion) setCanvasBackendDirty(false);
            } catch {
                if (!pendingWrite) pendingWrite = { projects: saved, version: ++latestWriteVersion };
            }
            return saved;
        } catch {
            return localProjects;
        } finally {
            initializations.delete(connectionId);
        }
    })();
    initializations.set(connectionId, initialization);
    return initialization;
}

export function scheduleCanvasBackendSave(projects: CanvasProject[]) {
    pendingWrite = { projects, version: ++latestWriteVersion };
    setCanvasBackendDirty(true);
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
    startBackendWrite();
}

export async function flushCanvasBackendSave(projects?: CanvasProject[]) {
    if (projects) {
        pendingWrite = { projects, version: ++latestWriteVersion };
        setCanvasBackendDirty(true);
    }
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
    startBackendWrite();
    await backendWrite;
}

function startBackendWrite() {
    if (backendWrite) return;
    let retry = false;
    backendWrite = (async () => {
        while (pendingWrite) {
            const next = pendingWrite;
            pendingWrite = null;
            const result = await persistProjects(next);
            if (result !== "saved") {
                const queuedAfterPersist = pendingWrite as PendingCanvasWrite | null;
                if (result === "retry" && queuedAfterPersist && queuedAfterPersist.version > next.version) continue;
                if (!queuedAfterPersist) pendingWrite = next;
                retry = result === "retry";
                break;
            }
        }
    })().finally(() => {
        backendWrite = null;
        if (!pendingWrite) return;
        if (!retry) return;
        retryTimer = setTimeout(() => {
            retryTimer = null;
            startBackendWrite();
        }, 2000);
    });
}

async function persistProjects(write: PendingCanvasWrite): Promise<"saved" | "offline" | "retry"> {
    const connection = backendConnection();
    if (!connection) return "offline";
    try {
        const merged = await mergeWithBackend(write.projects, connection);
        const saved = await saveProjects(merged, connection);
        if (write.version !== latestWriteVersion || pendingWrite) return "saved";
        await syncCanvasFiles(saved, connection, false);
        if (write.version === latestWriteVersion && !pendingWrite) {
            projectListeners.forEach((listener) => listener(saved));
            if (write.version === latestWriteVersion && !pendingWrite) setCanvasBackendDirty(false);
        }
        return "saved";
    } catch {
        return "retry";
    }
}

async function saveProjects(projects: CanvasProject[], connection: NonNullable<ReturnType<typeof backendConnection>>, attempt = 0): Promise<CanvasProject[]> {
    const connectionId = backendConnectionId(connection);
    const response = await fetch(`${connection.url}/api/canvas-projects`, {
        method: "PUT",
        headers: { ...authHeaders(connection.token), "Content-Type": "application/json" },
        body: JSON.stringify({ projects, revision: revisions.get(connectionId) || "" }, (_key, value) => (typeof value === "string" && value.startsWith("blob:") ? undefined : value)),
    });
    if (response.status === 409) {
        if (attempt >= 1) throw new Error("canvas projects changed repeatedly");
        const payload = (await response.json()) as CanvasProjectsResponse;
        if (!Array.isArray(payload.projects) || !payload.revision) throw new Error("invalid canvas conflict response");
        const merged = mergeProjects(projects, payload.projects);
        revisions.set(connectionId, payload.revision);
        return saveProjects(merged, connection, attempt + 1);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as CanvasProjectsResponse;
    if (payload.revision) revisions.set(connectionId, payload.revision);
    return projects;
}

async function syncCanvasFiles(projects: CanvasProject[], connection: NonNullable<ReturnType<typeof backendConnection>>, restoreMissing: boolean) {
    const response = await fetch(`${connection.url}/api/canvas-files`, { headers: authHeaders(connection.token) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as CanvasFilesResponse;
    if (!payload.ok || !Array.isArray(payload.files)) throw new Error("invalid canvas files response");
    const remoteFiles = new Map(payload.files.map((item) => [item.storageKey, item]));
    const keys = collectStorageKeys(projects);
    await runWithConcurrency(keys, 3, async (storageKey) => {
        const remote = remoteFiles.get(storageKey);
        if (remote && !restoreMissing) return;
        const localBlob = await readLocalBlob(storageKey);
        if (localBlob && !remote) return uploadFile(storageKey, localBlob, connection);
        if (!localBlob && remote) return downloadFile(storageKey, remote.mimeType, connection);
    });
}

async function readLocalBlob(storageKey: string) {
    return storageKey.startsWith("image:") ? getImageBlob(storageKey) : getMediaBlob(storageKey);
}

async function uploadFile(storageKey: string, blob: Blob, connection: NonNullable<ReturnType<typeof backendConnection>>) {
    const response = await fetch(`${connection.url}/api/canvas-files/${encodeURIComponent(storageKey)}`, {
        method: "PUT",
        headers: { ...authHeaders(connection.token), "Content-Type": "application/octet-stream", "x-canvas-file-type": blob.type || "application/octet-stream" },
        body: blob,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

async function downloadFile(storageKey: string, mimeType: string, connection: NonNullable<ReturnType<typeof backendConnection>>) {
    const response = await fetch(`${connection.url}/api/canvas-files/${encodeURIComponent(storageKey)}`, { headers: authHeaders(connection.token) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const typedBlob = blob.type || !mimeType ? blob : blob.slice(0, blob.size, mimeType);
    await (storageKey.startsWith("image:") ? setImageBlob(storageKey, typedBlob) : setMediaBlob(storageKey, typedBlob));
}

function mergeProjects(localProjects: CanvasProject[], remoteProjects: CanvasProject[], preferRemote = false) {
    if (preferRemote && remoteProjects.length) return [...remoteProjects].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    const projects = new Map(remoteProjects.map((project) => [project.id, project]));
    localProjects.forEach((project) => {
        const remote = projects.get(project.id);
        if (!remote) {
            projects.set(project.id, project);
            return;
        }
        const localIsNewer = Date.parse(project.updatedAt) >= Date.parse(remote.updatedAt);
        projects.set(project.id, preserveCompletedMedia(localIsNewer ? project : remote, localIsNewer ? remote : project));
    });
    return [...projects.values()].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

function preserveCompletedMedia(preferred: CanvasProject, fallback: CanvasProject): CanvasProject {
    const fallbackNodes = new Map(fallback.nodes.map((node) => [node.id, node]));
    let changed = false;
    const nodes = preferred.nodes.map((node) => {
        const previous = fallbackNodes.get(node.id);
        if (node.metadata?.storageKey || !previous?.metadata?.storageKey || previous.metadata.status !== "success") return node;
        if (!node.metadata?.generationStartedAt && node.metadata?.status !== "loading") return node;
        changed = true;
        return {
            ...node,
            width: previous.width,
            height: previous.height,
            metadata: {
                ...node.metadata,
                content: previous.metadata.content,
                storageKey: previous.metadata.storageKey,
                status: previous.metadata.status,
                naturalWidth: previous.metadata.naturalWidth,
                naturalHeight: previous.metadata.naturalHeight,
                bytes: previous.metadata.bytes,
                mimeType: previous.metadata.mimeType,
                durationMs: previous.metadata.durationMs,
                generationStartedAt: undefined,
                generationDurationMs: previous.metadata.generationDurationMs,
                errorDetails: undefined,
                primaryImageId: previous.metadata.primaryImageId,
            },
        };
    });
    return changed ? { ...preferred, nodes } : preferred;
}

function canvasBackendDirty() {
    return typeof window !== "undefined" && window.localStorage.getItem(CANVAS_BACKEND_DIRTY_KEY) === "1";
}

function setCanvasBackendDirty(dirty: boolean) {
    if (typeof window === "undefined") return;
    if (dirty) window.localStorage.setItem(CANVAS_BACKEND_DIRTY_KEY, "1");
    else window.localStorage.removeItem(CANVAS_BACKEND_DIRTY_KEY);
}

function authHeaders(token: string) {
    return { "x-canvas-agent-token": token };
}

function backendConnectionId(connection: NonNullable<ReturnType<typeof backendConnection>>) {
    return `${connection.url}|${connection.token.slice(-8)}`;
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<unknown>) {
    let nextIndex = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (nextIndex < items.length) await worker(items[nextIndex++]);
        }),
    );
}
