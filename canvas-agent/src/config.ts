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
export const AGENT_PROMPT = fs.readFileSync(new URL("../agent-instructions.md", import.meta.url), "utf8");
const initializedWorkspaces = new Set<string>();

export type SiteWorkspaceConfig = { workspacePath: string; activeThreadId?: string; pinnedThreadIds?: string[] };
export type CanvasAgentConfig = { url: string; token: string; origins?: string[]; workspace?: SiteWorkspaceConfig };

/** 读取本地 Canvas Agent 配置，不存在时生成默认配置。 */
export function loadConfig(create = false): CanvasAgentConfig {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as CanvasAgentConfig;
    } catch {
        const config = { url: `http://127.0.0.1:${Number(process.env.PORT) || DEFAULT_PORT}`, token: crypto.randomBytes(18).toString("hex") };
        if (create) saveConfig(config);
        return config;
    }
}

/** 将 Canvas Agent 配置写入用户配置目录。 */
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

/** 确保站点级 Codex 工作空间存在并已初始化。 */
export function ensureSiteWorkspace(config: CanvasAgentConfig) {
    const current = config.workspace;
    if (current?.workspacePath) {
        const workspacePath = resolveWorkspacePath(current.workspacePath);
        initializeWorkspace(workspacePath);
        return { ...current, workspacePath };
    }
    const workspacePath = path.join(CONFIG_DIR, "codex-workspaces", "site");
    config.workspace = { workspacePath };
    initializeWorkspace(workspacePath);
    saveConfig(config);
    return { workspacePath };
}

/** 更新站点级 Codex 工作空间配置。 */
export function updateSiteWorkspace(config: CanvasAgentConfig, patch: Partial<SiteWorkspaceConfig>) {
    const current = ensureSiteWorkspace(config);
    const workspacePath = patch.workspacePath ? resolveWorkspacePath(patch.workspacePath) : current.workspacePath;
    const next = { ...current, ...patch, workspacePath };
    config.workspace = { workspacePath: next.workspacePath, activeThreadId: next.activeThreadId, pinnedThreadIds: next.pinnedThreadIds };
    initializeWorkspace(workspacePath);
    saveConfig(config);
    return config.workspace;
}

/** 创建工作空间目录并写入默认 AGENTS.md。 */
function initializeWorkspace(workspacePath: string) {
    if (initializedWorkspaces.has(workspacePath)) return;
    fs.mkdirSync(workspacePath, { recursive: true });
    const instructionsFile = path.join(workspacePath, "AGENTS.md");
    const current = fs.existsSync(instructionsFile) ? fs.readFileSync(instructionsFile, "utf8") : "";
    if (!current || current.startsWith("# Infinite Canvas Agent")) fs.writeFileSync(instructionsFile, AGENT_PROMPT);
    initializedWorkspaces.add(workspacePath);
}

/** 将用户输入的工作空间路径解析为绝对路径。 */
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
