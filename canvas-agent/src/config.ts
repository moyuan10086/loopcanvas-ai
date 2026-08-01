import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_PORT = 17371;
export const CONFIG_DIR = path.join(os.homedir(), ".infinite-canvas");
export const CONFIG_FILE = path.join(CONFIG_DIR, "canvas-agent.json");
export const AI_CONFIG_FILE = path.join(CONFIG_DIR, "ai-config.json");
export const CANVAS_PROJECTS_FILE = path.join(CONFIG_DIR, "canvas-projects.json");
export const CANVAS_FILES_DIR = path.join(CONFIG_DIR, "canvas-files");
export const API_USAGE_FILE = path.join(CONFIG_DIR, "api-usage.json");
export const VERSION = readPackageVersion();
export const AGENT_PROMPT = "你正在帮助用户操作 Infinite Canvas 网站。切换网站页面用 site_navigate，可跳 / (首页)、/canvas (我的画布)、/canvas/:id (指定画布)、/image、/video、/prompts、/assets、/config。需要改动画布时优先使用已配置的 infinite-canvas MCP 工具：先 canvas_get_state 读取当前画布，再根据任务使用 canvas_create_text_node、canvas_generate_text、canvas_generate_image、canvas_generate_video、canvas_generate_audio、canvas_create_generation_flow、canvas_create_config_node、canvas_run_generation、canvas_update_node、canvas_connect_nodes 等通用工具；复杂批量改动再用 canvas_apply_ops，删除连线可用 delete_connections。若当前不在画布页，画布工具会报错，需先用 site_navigate 打开画布。想了解或打开用户已有画布，用 canvas_list_projects 获取画布清单和 id，再用 site_navigate 跳 /canvas/:id 打开。生图工作台可用 workbench_image_get_config 看可选项、workbench_image_generate 填提示词并生成；视频创作台对应 workbench_video_get_config 与 workbench_video_generate；用 prompts_search 分页搜索提示词库；用 assets_list 查看「我的素材」、assets_add 新增文本或图片素材。需要生成内容时直接调用对应生成工具，不要绑定特定业务场景。不要模拟鼠标点击，不要要求用户手动复制 JSON。";

export type SiteWorkspaceConfig = { workspacePath: string; activeThreadId?: string; pinnedThreadIds?: string[] };
export type CanvasAgentConfig = { url: string; token: string; origins?: string[]; workspace?: SiteWorkspaceConfig };

export function loadConfig(create = false): CanvasAgentConfig {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as CanvasAgentConfig;
    } catch {
        const config = { url: `http://127.0.0.1:${Number(process.env.PORT) || DEFAULT_PORT}`, token: crypto.randomBytes(18).toString("hex") };
        if (create) saveConfig(config);
        return config;
    }
}

export function saveConfig(config: CanvasAgentConfig) {
    saveJsonFile(CONFIG_FILE, config);
}

export function loadAiConfig() {
    try {
        return JSON.parse(fs.readFileSync(AI_CONFIG_FILE, "utf8")) as unknown;
    } catch {
        return null;
    }
}

export function saveAiConfig(config: unknown) {
    saveJsonFile(AI_CONFIG_FILE, config);
}

export function loadCanvasProjects() {
    return loadJsonArray(CANVAS_PROJECTS_FILE);
}

export function saveCanvasProjects(projects: unknown[]) {
    saveJsonFile(CANVAS_PROJECTS_FILE, projects);
}

export function canvasProjectsRevision(projects = loadCanvasProjects()) {
    return crypto.createHash("sha256").update(JSON.stringify(projects)).digest("hex").slice(0, 16);
}

export function loadApiUsage() {
    return loadJsonArray(API_USAGE_FILE);
}

export function saveApiUsage(logs: unknown[]) {
    saveJsonFile(API_USAGE_FILE, logs);
}

export function listCanvasFiles() {
    try {
        return fs
            .readdirSync(CANVAS_FILES_DIR)
            .filter((name) => name.endsWith(".json"))
            .flatMap((name) => {
                try {
                    const metadata = JSON.parse(fs.readFileSync(path.join(CANVAS_FILES_DIR, name), "utf8")) as { storageKey?: unknown; mimeType?: unknown; bytes?: unknown };
                    if (typeof metadata.storageKey !== "string") return [];
                    return [{ storageKey: metadata.storageKey, mimeType: typeof metadata.mimeType === "string" ? metadata.mimeType : "application/octet-stream", bytes: Number(metadata.bytes) || 0 }];
                } catch {
                    return [];
                }
            });
    } catch {
        return [];
    }
}

export function readCanvasFile(storageKey: string) {
    const paths = canvasFilePaths(storageKey);
    const metadata = JSON.parse(fs.readFileSync(paths.metadata, "utf8")) as { mimeType?: unknown };
    return { data: fs.readFileSync(paths.data), mimeType: typeof metadata.mimeType === "string" ? metadata.mimeType : "application/octet-stream" };
}

export function saveCanvasFile(storageKey: string, data: Buffer, mimeType: string) {
    fs.mkdirSync(CANVAS_FILES_DIR, { recursive: true });
    const paths = canvasFilePaths(storageKey);
    const tempFile = `${paths.data}.tmp`;
    fs.writeFileSync(tempFile, data, { mode: 0o600 });
    fs.renameSync(tempFile, paths.data);
    protectFile(paths.data);
    saveJsonFile(paths.metadata, { storageKey, mimeType: mimeType || "application/octet-stream", bytes: data.byteLength });
}

export function ensureSiteWorkspace(config: CanvasAgentConfig) {
    const current = config.workspace;
    if (current?.workspacePath) {
        const workspacePath = resolveWorkspacePath(current.workspacePath);
        fs.mkdirSync(workspacePath, { recursive: true });
        return { ...current, workspacePath };
    }
    const workspacePath = path.join(CONFIG_DIR, "codex-workspaces", "site");
    config.workspace = { workspacePath };
    fs.mkdirSync(workspacePath, { recursive: true });
    saveConfig(config);
    return { workspacePath };
}

export function updateSiteWorkspace(config: CanvasAgentConfig, patch: Partial<SiteWorkspaceConfig>) {
    const current = ensureSiteWorkspace(config);
    const workspacePath = patch.workspacePath ? resolveWorkspacePath(patch.workspacePath) : current.workspacePath;
    const next = { ...current, ...patch, workspacePath };
    config.workspace = { workspacePath: next.workspacePath, activeThreadId: next.activeThreadId, pinnedThreadIds: next.pinnedThreadIds };
    fs.mkdirSync(workspacePath, { recursive: true });
    saveConfig(config);
    return config.workspace;
}

function resolveWorkspacePath(value: string) {
    if (value === "~") return os.homedir();
    if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
    return path.resolve(value);
}

function loadJsonArray(file: string) {
    try {
        const value = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
}

function saveJsonFile(file: string, value: unknown) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    protectDirectory(path.dirname(file));
    const tempFile = `${file}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempFile, file);
    protectFile(file);
}

function protectDirectory(directory: string) {
    try {
        fs.chmodSync(directory, 0o700);
    } catch {
        // Windows does not expose POSIX permissions; the user profile ACL remains the boundary.
    }
}

function protectFile(file: string) {
    try {
        fs.chmodSync(file, 0o600);
    } catch {
        // Windows does not expose POSIX permissions; the user profile ACL remains the boundary.
    }
}

function canvasFilePaths(storageKey: string) {
    const name = Buffer.from(storageKey).toString("base64url");
    return { data: path.join(CANVAS_FILES_DIR, `${name}.bin`), metadata: path.join(CANVAS_FILES_DIR, `${name}.json`) };
}

function readPackageVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
        return pkg.version || "0.0.0";
    } catch {
        return "0.0.0";
    }
}
