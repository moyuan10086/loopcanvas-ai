import { execFileSync } from "node:child_process";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const SUPPORTED_PRICING_HOSTS = new Set(["deepkey.top", "apimart.ai", "www.apimart.ai", "toapis.com", "www.toapis.com"]);
const DEFAULT_RMB_PER_USD = 6.7801;
const DEFAULT_TOAPIS_RMB_PER_USD = 7;
const proxyAgents = new Map<string, ProxyAgent>();
let detectedSystemProxy: string | undefined;

export type ScrapedModelPrice = {
    model: string;
    display: string;
    note?: string;
    source: string;
};

type DeepKeyPricingModel = {
    model_name?: string;
    quota_type?: number;
    model_ratio?: number;
    model_price?: number;
    completion_ratio?: number;
    enable_groups?: string[];
    supported_endpoint_types?: string[];
};

type DeepKeyPricingPayload = {
    success?: boolean;
    data?: DeepKeyPricingModel[];
    group_ratio?: Record<string, number>;
};

export async function scrapeModelPrices(sourceUrl: string, modelNames: string[], requestedExchangeRate?: number, requestedProxyUrl?: string): Promise<ScrapedModelPrice[]> {
    const url = pricingUrl(sourceUrl);
    const proxyUrl = resolveProxyUrl(requestedProxyUrl);
    const models = Array.from(new Set(modelNames.map((model) => model.trim()).filter(Boolean)));
    if (!models.length) throw new Error("请先填写完整模型名");
    if (url.hostname === "deepkey.top") return scrapeDeepKey(url, models, proxyUrl);
    if (url.hostname === "apimart.ai" || url.hostname === "www.apimart.ai") return scrapeApiMart(url, models, normalizeExchangeRate(requestedExchangeRate, DEFAULT_RMB_PER_USD), proxyUrl);
    return scrapeToApis(url, models, normalizeExchangeRate(requestedExchangeRate, DEFAULT_TOAPIS_RMB_PER_USD), proxyUrl);
}

function pricingUrl(value: string) {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        throw new Error("定价来源 URL 无效");
    }
    if (url.protocol !== "https:" || !SUPPORTED_PRICING_HOSTS.has(url.hostname.toLowerCase())) throw new Error("仅支持 DeepKey、APIMart 和 ToAPIs 官方 HTTPS 定价页");
    return url;
}

async function scrapeDeepKey(url: URL, modelNames: string[], proxyUrl: string) {
    const endpoint = new URL("/api/pricing", url.origin);
    const response = await fetchPricing(endpoint, proxyUrl);
    const payload = (await response.json()) as DeepKeyPricingPayload;
    const entries = payload.data || [];
    const groupRatios = payload.group_ratio || {};
    return modelNames.flatMap((requested): ScrapedModelPrice[] => {
        const model = entries.find((entry) => entry.model_name?.toLowerCase() === requested.toLowerCase());
        if (!model?.model_name) return [];
        const ratios = (model.enable_groups || []).map((group) => groupRatios[group]).filter((ratio): ratio is number => Number.isFinite(ratio) && ratio > 0);
        if (!ratios.length) return [];
        const minRatio = Math.min(...ratios);
        const maxRatio = Math.max(...ratios);
        if (model.quota_type === 1) {
            const base = Number(model.model_price) || 0;
            const unit = model.supported_endpoint_types?.some((type) => type.includes("image")) ? "张" : "次";
            const display = moneyRange(base * minRatio, base * maxRatio, unit);
            return [{ model: requested, display, note: ratios.length > 1 ? `DeepKey 公开价，按 ${ratios.length} 个可用分组显示范围` : "DeepKey 公开价", source: endpoint.toString() }];
        }
        const baseInput = (Number(model.model_ratio) || 0) * 2;
        const completion = Number(model.completion_ratio) || 1;
        const input = currencyRange(baseInput * minRatio, baseInput * maxRatio);
        const output = currencyRange(baseInput * completion * minRatio, baseInput * completion * maxRatio);
        return [{ model: requested, display: `输入${input} / 输出${output}/百万token`, note: ratios.length > 1 ? `DeepKey 公开价，按 ${ratios.length} 个可用分组显示范围` : "DeepKey 公开价", source: endpoint.toString() }];
    });
}

async function scrapeApiMart(url: URL, modelNames: string[], exchangeRate: number, proxyUrl: string) {
    const endpoint = new URL(url.pathname.includes("pricing") ? url.pathname : "/zh/pricing", url.origin);
    const response = await fetchPricing(endpoint, proxyUrl);
    const html = (await response.text()).replaceAll('\\"', '"');
    if (!html.includes('"modelsByCategory"')) throw new Error("APIMart 定价页没有返回模型价格数据");
    return modelNames.flatMap((requested) => {
        const aliases = [requested, requested.replace(/-apimart$/i, "")];
        const match = aliases.map((name) => extractApiMartModel(html, name)).find(Boolean);
        if (!match) return [];
        const { block, matchedName } = match;
        const specification = block.match(/"specification":"([^"]+)"/)?.[1] || "";
        const entries = Array.from(block.matchAll(/"size_name":"([^"]+)"[^}]*?"after_discount":([0-9.]+)/g)).map((item) => ({ name: item[1], usd: Number(item[2]) })).filter((item) => Number.isFinite(item.usd));
        if (!entries.length) return [];
        if (/token|chat/i.test(specification)) {
            const input = entries.find((entry) => /input/i.test(entry.name));
            const output = entries.find((entry) => /output/i.test(entry.name));
            if (input && output) return [{ model: requested, display: `输入${rmb(input.usd, exchangeRate)} / 输出${rmb(output.usd, exchangeRate)}/百万token`, note: `APIMart ${matchedName} 公开价，按 $1=¥${exchangeRate}`, source: endpoint.toString() }];
        }
        const preferred = entries.find((entry) => entry.name === "default");
        const values = preferred ? [preferred.usd] : entries.map((entry) => entry.usd);
        const unit = /video/i.test(specification) ? "秒" : /image/i.test(specification) ? "张" : "次";
        return [{ model: requested, display: moneyRange(Math.min(...values) * exchangeRate, Math.max(...values) * exchangeRate, unit, true), note: `APIMart ${matchedName} 公开价，按 $1=¥${exchangeRate}`, source: endpoint.toString() }];
    });
}

async function scrapeToApis(url: URL, modelNames: string[], exchangeRate: number, proxyUrl: string): Promise<ScrapedModelPrice[]> {
    const endpoint = new URL("/api/pricing", url.origin);
    const response = await fetchPricing(endpoint, proxyUrl);
    const payload = (await response.json()) as DeepKeyPricingPayload;
    if (!payload.success && !Array.isArray(payload.data)) throw new Error("ToAPIs 价格接口未返回模型目录，请稍后重试");
    const entries = payload.data || [];
    const groupRatios = payload.group_ratio || {};
    return modelNames.flatMap((requested): ScrapedModelPrice[] => {
        const model = entries.find((entry) => entry.model_name?.toLowerCase() === requested.toLowerCase());
        if (!model?.model_name) return [];
        const ratios = (model.enable_groups || ["default"]).map((group) => groupRatios[group] ?? 1).filter((ratio): ratio is number => Number.isFinite(ratio) && ratio > 0);
        const minRatio = Math.min(...ratios);
        const maxRatio = Math.max(...ratios);
        const source = endpoint.toString();
        if (model.quota_type === 0) {
            const baseInput = Number(model.model_ratio) || 0;
            const completion = Number(model.completion_ratio) || 1;
            return [{ model: requested, display: `输入${currencyRange(baseInput * minRatio * exchangeRate, baseInput * maxRatio * exchangeRate)} / 输出${currencyRange(baseInput * completion * minRatio * exchangeRate, baseInput * completion * maxRatio * exchangeRate)}/百万token`, note: `ToAPIs 公开 /api/pricing，按 $1=¥${exchangeRate}`, source }];
        }
        const base = Number(model.model_price) || Number(model.model_ratio) || 0;
        if (!base) return [];
        const min = base * minRatio * exchangeRate;
        const max = base * maxRatio * exchangeRate;
        const endpointTypes = model.supported_endpoint_types || [];
        const unit = model.quota_type === 2 ? "秒" : endpointTypes.some((type) => /image/i.test(type)) ? "张" : "次";
        return [{ model: requested, display: moneyRange(min, max, unit), note: `ToAPIs 公开 /api/pricing，按 $1=¥${exchangeRate}`, source }];
    });
}

async function fetchPricing(url: URL, proxyUrl: string) {
    try {
        const response = await undiciFetch(url, {
            redirect: "follow",
            signal: AbortSignal.timeout(20_000),
            headers: { Accept: "application/json,text/html;q=0.9", "User-Agent": "InfiniteCanvas/0.8 model-price-sync" },
            dispatcher: proxyUrl ? proxyAgent(proxyUrl) : undefined,
        });
        if (!response.ok) throw new Error(`定价页请求失败：HTTP ${response.status}`);
        return response;
    } catch (error) {
        if (error instanceof Error && error.message.startsWith("定价页请求失败")) throw error;
        const proxyState = proxyUrl ? `已使用代理 ${safeProxyLabel(proxyUrl)}` : "未检测到系统、环境或渠道代理";
        throw new Error(`本地 Agent 无法访问 ${url.hostname}（${proxyState}）。请检查代理是否运行，或点击“打开定价来源”后手动填写价格`);
    }
}

function proxyAgent(proxyUrl: string) {
    const existing = proxyAgents.get(proxyUrl);
    if (existing) return existing;
    const agent = new ProxyAgent(proxyUrl);
    proxyAgents.set(proxyUrl, agent);
    return agent;
}

function resolveProxyUrl(requested?: string) {
    const configured = requested?.trim() || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || detectWindowsProxy();
    if (!configured) return "";
    const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(configured) ? configured : `http://${configured}`;
    let url: URL;
    try {
        url = new URL(normalized);
    } catch {
        throw new Error("定价抓取代理 URL 无效，请填写 http://127.0.0.1:端口");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("定价抓取代理仅支持 HTTP 或 HTTPS URL");
    return url.toString();
}

function detectWindowsProxy() {
    if (detectedSystemProxy !== undefined) return detectedSystemProxy;
    detectedSystemProxy = "";
    if (process.platform !== "win32") return detectedSystemProxy;
    try {
        const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
        const enabled = execFileSync("reg.exe", ["query", key, "/v", "ProxyEnable"], { encoding: "utf8", windowsHide: true });
        if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(enabled)) return detectedSystemProxy;
        const output = execFileSync("reg.exe", ["query", key, "/v", "ProxyServer"], { encoding: "utf8", windowsHide: true });
        const value = output.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim() || "";
        const entries = Object.fromEntries(value.split(";").map((item) => item.split("=", 2).map((part) => part.trim())).filter((parts) => parts.length === 2));
        detectedSystemProxy = entries.https || entries.http || value;
    } catch {
        detectedSystemProxy = "";
    }
    return detectedSystemProxy;
}

function safeProxyLabel(proxyUrl: string) {
    try {
        const url = new URL(proxyUrl);
        return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`;
    } catch {
        return "已配置代理";
    }
}

function extractApiMartModel(html: string, name: string) {
    const marker = `"id":"${name.replace(/["\\]/g, "")}"`;
    const start = html.indexOf(marker);
    if (start < 0) return null;
    const next = html.indexOf('},{"id":"', start + marker.length);
    return { block: html.slice(start, next < 0 ? start + 80_000 : next), matchedName: name };
}

function moneyRange(min: number, max: number, unit: string, approximate = false) {
    const prefix = approximate ? "约" : "";
    return Math.abs(max - min) < 0.0000001 ? `${prefix}${rmbValue(min)}/${unit}` : `${prefix}${rmbValue(min)}–${rmbValue(max)}/${unit}`;
}

function currencyRange(min: number, max: number) {
    return Math.abs(max - min) < 0.0000001 ? rmbValue(min) : `${rmbValue(min)}–${rmbValue(max)}`;
}

function rmb(usd: number, exchangeRate: number) {
    return rmbValue(usd * exchangeRate);
}

function rmbValue(value: number) {
    const precision = value < 0.01 ? 4 : value < 1 ? 3 : 2;
    return `¥${value.toFixed(precision).replace(/0+$/, "").replace(/[.]$/, "")}`;
}

function normalizeExchangeRate(value: number | undefined, fallback: number) {
    return Number.isFinite(value) && Number(value) >= 0.01 && Number(value) <= 100 ? Number(value) : fallback;
}
