import localforage from "localforage";

import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";
import { uploadCanvasFileToAgent } from "@/services/agent-file-storage";
import { backendConnection } from "@/services/config-sync";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const objectUrls = new Map<string, string>();

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    const storageKey = `image:${nanoid()}`;
    let blob: Blob;
    if (typeof input === "string") {
        try {
            const response = await fetch(input);
            if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);
            blob = await response.blob();
        } catch (error) {
            // 供应商图片常用独立域名，浏览器下载可能被 CORS 拦截；交给本地 Agent 下载，确保跨浏览器可恢复。
            if (!/^https?:\/\//i.test(input)) throw error;
            const meta = await readImageMeta(input);
            if (await persistRemoteImageThroughAgent(storageKey, input)) return { url: input, storageKey, width: meta.width, height: meta.height, bytes: 0, mimeType: meta.mimeType };
            return { url: input, storageKey: "", width: meta.width, height: meta.height, bytes: 0, mimeType: meta.mimeType };
        }
    } else {
        blob = input;
    }
    await store.setItem(storageKey, blob);
    await uploadCanvasFileToAgent(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = await readImageMeta(url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
}

async function persistRemoteImageThroughAgent(storageKey: string, url: string) {
    const connection = backendConnection();
    if (!connection) return false;
    try {
        const response = await fetch(`${connection.url}/api/canvas-files/fetch`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-canvas-agent-token": connection.token },
            body: JSON.stringify({ storageKey, url }),
        });
        return response.ok;
    } catch {
        return false;
    }
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}
