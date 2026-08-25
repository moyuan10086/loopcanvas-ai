import localforage from "localforage";

export type Prompt = {
    id: string;
    title: string;
    coverUrl: string;
    prompt: string;
    tags: string[];
    category: string;
    githubUrl: string;
    preview: string;
    note: string;
    createdAt: string;
    updatedAt: string;
};

export type Prompt = RawPrompt & {
    sourceId: string;
    category: string;
    githubUrl: string;
};

export const ALL_PROMPTS_OPTION = "全部";

export type PromptListResponse = {
    items: Prompt[];
    tags: string[];
    categories: string[];
    total: number;
};

const awesomeGptImageRawBase = "https://raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main";
const awesomeGpt4oImagePromptsBase = "https://raw.githubusercontent.com/ImgEdify/Awesome-GPT4o-Image-Prompts/main";
const youMindGptImage2RawBase = "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main";
const youMindNanoBananaProRawBase = "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts/main";
const davidWuGptImage2RawBase = "https://raw.githubusercontent.com/davidwuw0811-boop/awesome-gpt-image2-prompts/main";
const freestyleflyGptImage2RawBase = "https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main";
const cacheTtlMs = 1000 * 60 * 60;
const promptCacheKey = "third-party-prompts-v5";
const promptCacheStore = localforage.createInstance({ name: "infinite-canvas", storeName: "prompt_cache" });
const loadingSources = new Map<string, Promise<PromptSourceRefreshResult>>();

const categories: PromptCategory[] = [
    { category: "awesome-gpt-image", githubUrl: "https://github.com/ZeroLu/awesome-gpt-image", build: buildAwesomeGptImagePrompts },
    { category: "awesome-gpt4o-image-prompts", githubUrl: "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts", build: buildAwesomeGpt4oImagePrompts },
    { category: "youmind-gpt-image-2", githubUrl: "https://github.com/YouMind-OpenLab/awesome-gpt-image-2", build: () => buildYouMindPrompts(youMindGptImage2RawBase, "youmind-gpt-image-2", "gpt-image-2") },
    { category: "youmind-nano-banana-pro", githubUrl: "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts", build: () => buildYouMindPrompts(youMindNanoBananaProRawBase, "youmind-nano-banana-pro", "nano-banana-pro") },
    { category: "davidwu-gpt-image2-prompts", githubUrl: "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts", build: buildDavidWuGptImage2Prompts },
    { category: "freestylefly-gpt-image-2", githubUrl: "https://github.com/freestylefly/awesome-gpt-image-2", build: buildFreestyleflyGptImage2Prompts },
];

let loadingPrompts: Promise<Prompt[]> | null = null;

export async function fetchPrompts({ keyword = "", tag = [], category = ALL_PROMPTS_OPTION, page = 1, pageSize = 20 }: { keyword?: string; tag?: string[]; category?: string; page?: number; pageSize?: number } = {}) {
    const items = await getPrompts();
    const normalizedKeyword = keyword.trim().toLowerCase();
    const normalizedPage = Math.max(1, page);
    const normalizedPageSize = Math.max(1, Math.min(100, pageSize));
    const withoutTagFilter = filterPrompts(items, { keyword: normalizedKeyword, category, tags: [] });
    const filtered = filterPrompts(items, { keyword: normalizedKeyword, category, tags: tag });

    return {
        items: filtered.slice((normalizedPage - 1) * normalizedPageSize, normalizedPage * normalizedPageSize),
        tags: collectTags(withoutTagFilter),
        categories: categories.map((item) => item.category),
        total: filtered.length,
    };
}

function cacheKey(sourceId: string) {
    return `prompt-source:${sourceId}`;
}

function sourceSignature(source: PromptSource) {
    const value = `${source.name}\n${source.url}\n${source.homepage}`;
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
    return `${value.length}:${hash}`;
}

function withSourceMeta(source: PromptSource, items: RawPrompt[]): Prompt[] {
    return items.map((item) => ({
        ...item,
        description: item.description || "",
        referenceImageUrls: Array.isArray(item.referenceImageUrls) ? item.referenceImageUrls : [],
        sourceId: source.id,
        category: source.name,
        githubUrl: item.sourceUrl || source.homepage,
    }));
}

async function readSourceCache(sourceId: string) {
    return promptCacheStore.getItem<SourceCache>(cacheKey(sourceId));
}

async function refreshSourceRecord(source: PromptSource): Promise<PromptSourceRefreshResult> {
    const previous = await readSourceCache(source.id);
    try {
        const items = withSourceMeta(source, await runPromptSource(source));
        const lastSuccessAt = new Date().toISOString();
        const cache: SourceCache = { sourceId: source.id, items, count: items.length, fetchedAt: Date.now(), lastSuccessAt, lastError: "", signature: sourceSignature(source) };
        await promptCacheStore.setItem(cacheKey(source.id), cache);
        return { sourceId: source.id, sourceName: source.name, count: items.length, lastSuccessAt, lastError: "", success: true };
    } catch (error) {
        const lastError = error instanceof Error ? error.message : String(error);
        const cache: SourceCache = {
            sourceId: source.id,
            items: previous?.items || [],
            count: previous?.items?.length || 0,
            fetchedAt: previous?.fetchedAt || 0,
            lastSuccessAt: previous?.lastSuccessAt || "",
            lastError,
            signature: previous?.signature || sourceSignature(source),
        };
        await promptCacheStore.setItem(cacheKey(source.id), cache);
        return { sourceId: source.id, sourceName: source.name, count: cache.count, lastSuccessAt: cache.lastSuccessAt, lastError, success: false };
    }
}

function getOrStartRefresh(source: PromptSource) {
    const current = loadingSources.get(source.id);
    if (current) return current;
    const loading = refreshSourceRecord(source).finally(() => loadingSources.delete(source.id));
    loadingSources.set(source.id, loading);
    return loading;
}

async function getSourcePrompts(source: PromptSource): Promise<Prompt[]> {
    const cached = await readSourceCache(source.id);
    if (cached) {
        const stale = cached.signature !== sourceSignature(source) || Date.now() - cached.fetchedAt >= cacheTtlMs;
        if (stale) void getOrStartRefresh(source).catch(() => undefined);
        return withSourceMeta(source, cached.items);
    }
    const result = await getOrStartRefresh(source);
    if (!result.success) throw new Error(result.lastError);
    return (await readSourceCache(source.id))?.items || [];
}

async function getAllPrompts(): Promise<Prompt[]> {
    const settled = await Promise.all(
        enabledSources().map(async (source) => {
            try {
                return await getSourcePrompts(source);
            } catch {
                return [];
            }
        }),
    );
    return settled.flat();
}

export async function fetchPrompts({ keyword = "", tag = [], category = ALL_PROMPTS_OPTION, page = 1, pageSize = 20 }: { keyword?: string; tag?: string[]; category?: string; page?: number; pageSize?: number } = {}) {
    const items = await getAllPrompts();
    const normalizedKeyword = keyword.trim().toLowerCase();
    const normalizedPage = Math.max(1, page);
    const normalizedPageSize = Math.max(1, Math.min(100, pageSize));
    const withoutTagFilter = filterPrompts(items, { keyword: normalizedKeyword, category, tags: [] });
    const filtered = filterPrompts(items, { keyword: normalizedKeyword, category, tags: tag });
    const categories = enabledSources().map((source) => source.name);

    return {
        items: filtered.slice((normalizedPage - 1) * normalizedPageSize, normalizedPage * normalizedPageSize),
        tags: collectTags(withoutTagFilter),
        categories,
        total: filtered.length,
    };
}

export async function fetchSourcePrompts(sourceId: string): Promise<Prompt[]> {
    const source = usePromptSourceStore.getState().sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("提示词来源不存在");
    return getSourcePrompts(source);
}

export async function refreshSource(sourceId: string): Promise<PromptSourceRefreshResult> {
    const source = usePromptSourceStore.getState().sources.find((item) => item.id === sourceId);
    if (!source) throw new Error("提示词来源不存在");
    const result = await getOrStartRefresh(source);
    if (!result.success) throw new Error(result.lastError);
    return result;
}

export async function refreshAllSources(): Promise<PromptSourceRefreshSummary> {
    const results = await Promise.all(enabledSources().map(getOrStartRefresh));
    return summarizeRefresh(results);
}

export async function refreshDueSources(maxAgeMs: number): Promise<PromptSourceRefreshSummary> {
    const sources = await Promise.all(
        enabledSources().map(async (source) => {
            const cached = await readSourceCache(source.id);
            const lastSuccess = cached?.lastSuccessAt ? new Date(cached.lastSuccessAt).getTime() : 0;
            return !lastSuccess || Boolean(cached?.lastError) || Date.now() - lastSuccess >= maxAgeMs || cached?.signature !== sourceSignature(source) ? source : null;
        }),
    );
    const results = await Promise.all(sources.filter((source): source is PromptSource => Boolean(source)).map(getOrStartRefresh));
    return summarizeRefresh(results);
}

export async function fetchPromptSourceStatuses(): Promise<Record<string, PromptSourceStatus>> {
    const entries = await Promise.all(
        usePromptSourceStore.getState().sources.map(async (source) => {
            const cache = await readSourceCache(source.id);
            return [source.id, { sourceId: source.id, count: cache?.items?.length || 0, lastSuccessAt: cache?.lastSuccessAt || "", lastError: cache?.lastError || "" }] as const;
        }),
    );
    return Object.fromEntries(entries);
}

function summarizeRefresh(results: PromptSourceRefreshResult[]): PromptSourceRefreshSummary {
    return {
        results,
        total: results.reduce((total, item) => total + item.count, 0),
        successCount: results.filter((item) => item.success).length,
        failureCount: results.filter((item) => !item.success).length,
    };
}

function filterPrompts(items: Prompt[], options: { keyword: string; category: string; tags: string[] }) {
    return items.filter((item) => {
        if (isActiveOption(options.category) && item.category !== options.category) return false;
        if (options.tags.length && !options.tags.some((tag) => item.tags.includes(tag))) return false;
        if (!options.keyword) return true;
        return [item.title, item.prompt, item.description, item.category, ...item.tags].join(" ").toLowerCase().includes(options.keyword);
    });
}

async function buildAwesomeGptImagePrompts() {
    const markdown = await fetchText(awesomeGptImageRawBase, "README.zh-CN.md");
    const items: Omit<Prompt, "category" | "githubUrl">[] = [];
    for (const section of splitBeforeHeading(markdown, "## ")) {
        const tags = tagsFromHeading(firstMatch(section, /^##\s+(.+)$/m));
        for (const block of splitBeforeHeading(section, "### ")) {
            const title = firstMatch(block, /^###\s+(.+)$/m).replace(/\[([^\]]+)]\([^)]+\)/g, "$1").trim();
            const prompt = firstMatch(block, /\*\*提示词:\*\*\s*\r?\n\s*```[\w-]*\r?\n(.*?)\r?\n```/s).trim();
            if (!title || !prompt) continue;
            const images = extractMarkdownImages(awesomeGptImageRawBase, block);
            items.push(defaultPrompt(`awesome-gpt-image-${leftPad(items.length + 1)}`, title, prompt, images[0] || "", tags, markdownPreview(images), extractPromptNote(block)));
        }
    }
    return items;
}

async function buildAwesomeGpt4oImagePrompts() {
    const markdown = await fetchText(awesomeGpt4oImagePromptsBase, "README.zh-CN.md");
    const items: Omit<Prompt, "category" | "githubUrl">[] = [];
    for (const block of splitBeforeHeading(markdown, "### ")) {
        const title = firstMatch(block, /^###\s+(.+)$/m).trim();
        const prompt = firstMatch(block, /- \*\*提示词文本：\*\*\s*`(.*?)`/s).trim();
        if (!title || !prompt) continue;
        const images = extractMarkdownImages(awesomeGpt4oImagePromptsBase, block);
        items.push(defaultPrompt(`awesome-gpt4o-image-prompts-${leftPad(items.length + 1)}`, title, prompt, images[0] || "", ["gpt4o"], markdownPreview(images), extractPromptNote(block)));
    }
    return items;
}

async function buildYouMindPrompts(baseUrl: string, idPrefix: string, modelTag: string) {
    const markdown = await fetchText(baseUrl, "README_zh.md");
    const items: Omit<Prompt, "category" | "githubUrl">[] = [];
    for (const block of splitBeforeHeading(markdown, "### ")) {
        const title = firstMatch(block, /^###\s+No\.\s*\d+:\s*(.+)$/m).trim();
        const prompt = firstMatch(block, /#### .*?提示词\s*\r?\n\s*```[\w-]*\r?\n(.*?)\r?\n```/s).trim();
        if (!title || !prompt) continue;
        const images = extractMarkdownImages(baseUrl, block);
        items.push(defaultPrompt(`${idPrefix}-${leftPad(items.length + 1)}`, title, prompt, images[0] || "", youMindTags(title, modelTag), markdownPreview(images), extractPromptNote(block)));
    }
    return items;
}

async function buildDavidWuGptImage2Prompts() {
    const data = await fetchJson<Array<{ id?: number; title_en?: string; title_cn?: string; category?: string; category_cn?: string; prompt?: string; note?: string; author?: string; source?: string; needs_ref?: boolean; image?: string }>>(davidWuGptImage2RawBase, "prompts.json");
    return data
        .map((item, index) => {
            const title = (item.title_cn || item.title_en || "").trim();
            const prompt = (item.prompt || "").trim();
            if (!title || !prompt) return null;
            const image = absoluteImage(davidWuGptImage2RawBase, item.image || "");
            const preview = [item.title_en, item.note, image ? `![](${image})` : ""].filter(Boolean).join("\n\n");
            return defaultPrompt(`davidwu-gpt-image2-prompts-${leftPad(item.id || index + 1)}`, title, prompt, image, davidWuTags(item), preview, item.note || "");
        })
        .filter((item): item is Omit<Prompt, "category" | "githubUrl"> => Boolean(item));
}

async function buildFreestyleflyGptImage2Prompts() {
    const markdown = await fetchText(freestyleflyGptImage2RawBase, "docs/templates.md");
    const items: Omit<Prompt, "category" | "githubUrl">[] = [];
    for (const block of splitBeforeHeading(markdown, "### ")) {
        const title = firstMatch(block, /^###\s+(.+)$/m).replace(/^[^\p{L}\p{N}]+/u, "").trim();
        if (!title || /提示词模板与防坑指南/i.test(title)) continue;
        const prompt = firstMatch(block, /\*\*(?:常规模板|模板)\*\*[\s\S]*?```(?:text|json)?\r?\n([\s\S]*?)\r?\n```/i).trim() || firstMatch(block, /```(?:text|json)?\r?\n([\s\S]*?)\r?\n```/i).trim();
        if (!prompt) continue;
        const tags = ["gpt-image-2", "freestylefly", ...splitTags(title, /[与和、/]/)].filter(Boolean);
        items.push(defaultPrompt(`freestylefly-gpt-image-2-${leftPad(items.length + 1)}`, title, prompt, "", tags, "", extractFreestyleflyNote(block)));
    }
    return items;
}

function defaultPrompt(id: string, title: string, prompt: string, coverUrl: string, tags: string[], preview: string, note = ""): Omit<Prompt, "category" | "githubUrl"> {
    return { id, title, coverUrl, prompt, tags, preview, note, createdAt: "", updatedAt: "" };
}

async function fetchText(baseUrl: string, file: string) {
    const response = await fetch(`${baseUrl}/${file}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${file} 拉取失败`);
    return response.text();
}

async function fetchJson<T>(baseUrl: string, file: string) {
    return JSON.parse(await fetchText(baseUrl, file)) as T;
}

function splitBeforeHeading(markdown: string, prefix: string) {
    const blocks: string[] = [];
    let current: string[] = [];
    for (const line of markdown.split("\n")) {
        if (line.startsWith(prefix) && current.length) {
            blocks.push(current.join("\n"));
            current = [];
        }
        current.push(line);
    }
    blocks.push(current.join("\n"));
    return blocks;
}

function firstMatch(value: string, pattern: RegExp) {
    return pattern.exec(value)?.[1] || "";
}

function extractMarkdownImages(baseUrl: string, markdown: string) {
    return Array.from(markdown.matchAll(/!\[[^\]]*]\(([^)]+)\)|<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi), (match) => absoluteImage(baseUrl, match[1] || match[2])).filter(isPromptImage);
}

function isPromptImage(url: string) {
    return Boolean(url) && !/(?:img\.shields\.io|awesome\.re\/badge|api\.star-history\.com|campaigns\/.*\/og-|prompts-cover|readme-header|prompt-library-screenshot)/i.test(url);
}

function absoluteImage(baseUrl: string, image: string) {
    if (!image) return "";
    if (/^https?:\/\//i.test(image)) return image;
    return `${baseUrl}/${image.replace(/^\.?\//, "")}`;
}

function tagsFromCategory(category: string) {
    return splitTags(category.replace(/\s+Cases$/i, ""), /\s*(?:&|and)\s*/);
}

function tagsFromHeading(heading: string) {
    return splitTags(heading.replace(/[^\p{L}\p{N}/&、与 ]/gu, ""), /\s*(?:\/|&|、|与)\s*/);
}

function youMindTags(title: string, modelTag: string) {
    const [, prefix] = title.match(/^(.+?) - /) || [];
    return [modelTag, ...tagsFromHeading(prefix || "")];
}

function davidWuTags(item: { category_cn?: string; category?: string; author?: string; source?: string; needs_ref?: boolean }) {
    const tags = splitTags([item.category_cn, item.category, item.author, item.source].filter(Boolean).join("/"), /\//);
    if (item.needs_ref) tags.push("需要参考图");
    return tags;
}

function splitTags(value: string, pattern: RegExp) {
    return value
        .split(pattern)
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);
}

function markdownPreview(images: string[]) {
    return images.filter(Boolean).map((image) => `![](${image})`).join("\n\n");
}

function extractPromptNote(markdown: string) {
    return firstMatch(markdown, /^\*\*(?:Comment|说明):\*\*\s*(.+)$/m).trim();
}

function extractFreestyleflyNote(markdown: string) {
    return firstMatch(markdown, /^\*\*(?:避坑指南|防坑指南)\*\*[\s\S]*?(?:\r?\n[-*]\s+(.+))?/m).trim();
}

function collectTags(items: Prompt[]) {
    return Array.from(new Set(items.flatMap((item) => item.tags).filter(Boolean)));
}

function isActiveOption(value: string) {
    return value && value !== ALL_PROMPTS_OPTION && value !== "all";
}

export function formatPromptDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
