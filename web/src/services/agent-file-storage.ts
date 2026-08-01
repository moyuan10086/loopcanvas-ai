import { backendConnection } from "@/services/config-sync";

export async function uploadCanvasFileToAgent(storageKey: string, blob: Blob) {
    const connection = backendConnection();
    if (!connection) return false;
    try {
        const response = await fetch(`${connection.url}/api/canvas-files/${encodeURIComponent(storageKey)}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/octet-stream",
                "x-canvas-agent-token": connection.token,
                "x-canvas-file-type": blob.type || "application/octet-stream",
            },
            body: blob,
        });
        return response.ok;
    } catch {
        return false;
    }
}
