import type { ModelChannel } from "@/stores/use-config-store";

export type ModelPrice = {
    display: string;
    note?: string;
    source?: string;
    verifiedAt: string;
};

type PriceRule = {
    channel: RegExp;
    model: RegExp;
    display: string;
    note?: string;
    source?: string;
};

const VERIFIED_AT = "2026-07-21";

// All display prices are normalized to RMB. Keep specific aliases before family rules.
const PRICE_RULES: PriceRule[] = [
    { channel: /deepkey/i, model: /^gpt-image-2-1k$/i, display: "¥0.048/张", note: "模型价 0.6 × gpt-image 分组 0.08", source: "https://deepkey.top/api/pricing" },
    { channel: /deepkey/i, model: /^gpt-image-2-2k$/i, display: "¥0.064/张", note: "模型价 0.8 × gpt-image 分组 0.08", source: "https://deepkey.top/api/pricing" },
    { channel: /deepkey/i, model: /^gpt-image-2-4k$/i, display: "¥0.080/张", note: "模型价 1 × gpt-image 分组 0.08", source: "https://deepkey.top/api/pricing" },
    { channel: /deepkey/i, model: /^gpt-image-2-count$/i, display: "¥0.080/张", note: "gpt-image 分组；Adobe 路由为 ¥0.120/张", source: "https://deepkey.top/api/pricing" },
    { channel: /deepkey/i, model: /^gemini-3-pro-image-preview$/i, display: "¥0.120/张", note: "模型价 0.6 × gemini-image 分组 0.2", source: "https://deepkey.top/api/pricing" },
    { channel: /deepkey/i, model: /^nano_banana_2$/i, display: "¥0.160/张", note: "模型价 0.8 × gemini-image 分组 0.2", source: "https://deepkey.top/api/pricing" },
    { channel: /deepkey/i, model: /^nano_banana_pro-(?:1K|2K|4K)$/i, display: "¥0.200/张", note: "模型价 1 × gemini-image 分组 0.2", source: "https://deepkey.top/api/pricing" },

    { channel: /toapis/i, model: /^seedance-2-mini$/i, display: "¥0.50/秒", source: "https://toapis.com/dashboard/pricing" },
    { channel: /toapis/i, model: /^seedance-2-fast$/i, display: "¥0.72/秒", source: "https://toapis.com/dashboard/pricing" },
    { channel: /toapis/i, model: /^seedance-2$/i, display: "¥0.90/秒", source: "https://toapis.com/dashboard/pricing" },
    { channel: /toapis/i, model: /^kling-v3(?:-omni)?$/i, display: "¥0.42/秒", source: "https://toapis.com/dashboard/pricing" },
    { channel: /toapis/i, model: /^kling-3[.]0-turbo$/i, display: "¥0.56/秒", source: "https://toapis.com/dashboard/pricing" },
    { channel: /toapis/i, model: /^grok-video-1[.]5-preview$/i, display: "¥0.70/次", source: "https://toapis.com/dashboard/pricing" },
    { channel: /toapis/i, model: /^gpt-image-2$/i, display: "¥0.105/张", source: "https://toapis.com/dashboard/pricing" },
    { channel: /toapis/i, model: /^gpt-image-2-vip$/i, display: "¥0.1183/张", source: "https://toapis.com/dashboard/pricing" },
    { channel: /toapis/i, model: /^gpt-image-2-official$/i, display: "¥0.945/张", source: "https://toapis.com/dashboard/pricing" },
    { channel: /toapis/i, model: /^flux-(?:2-(?:flex|pro)|kontext-(?:max|pro))$/i, display: "价格待核对", note: "ToAPIs 官方价格目录未返回该模型的精确条目", source: "https://toapis.com/api/pricing" },

    { channel: /apimart/i, model: /^grok-imagine-1[.]5-video-apimart$/i, display: "约¥0.0542/秒", note: "原价 $0.008/秒，按 $1=¥6.7801", source: "https://apimart.ai/zh" },
    { channel: /apimart/i, model: /^grok-imagine-1[.]0-video-apimart$/i, display: "价格待核对", note: "APIMart 当前模型页未能稳定访问" },
    { channel: /apimart/i, model: /^kling-v3(?:-omni)?$/i, display: "约¥0.4556–0.6075/秒", note: "720P–1080P", source: "https://apimart.ai/zh" },
    { channel: /apimart/i, model: /^kling-3[.]0-turbo$/i, display: "约¥0.7756–0.9709/秒", note: "720P–1080P", source: "https://apimart.ai/zh" },
    { channel: /apimart/i, model: /^gpt-image-2$/i, display: "约¥0.0576/张", note: "0.085 Credit（约$0.0085）/张，按$1=¥6.7801", source: "https://apimart.ai/zh/model" },
    { channel: /apimart/i, model: /^nano-banana-3-api$/i, display: "约¥0.2034/张", note: "0.3 Credit（约$0.03）/张，按$1=¥6.7801", source: "https://apimart.ai/zh/model" },
    { channel: /apimart/i, model: /^grok-imagine-1[.]5(?:-edit)?-apimart$/i, display: "约¥0.1017/张", note: "0.15 Credit（约$0.015）/张，按$1=¥6.7801", source: "https://apimart.ai/zh/model/grok-image" },
    { channel: /apimart/i, model: /^flux-kontext-(?:max|pro)$/i, display: "官网未列出", note: "APIMart 当前公开图片模型市场未展示该模型", source: "https://apimart.ai/zh/model" },

    { channel: /apilio/i, model: /^qwen-image-edit-plus(?:-|$)/i, display: "¥0.14/次", note: "国产特价 0.7 倍", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^qwen-image-plus-2026-01-09$/i, display: "¥0.14/次", note: "国产特价 0.7 倍", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^qwen-image-edit-max(?:-|$)/i, display: "¥0.35/次", note: "国产特价 0.7 倍", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^qwen-image-max(?:-|$)/i, display: "¥0.35/次", note: "国产特价 0.7 倍", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^qwen-image-edit$/i, display: "¥0.21/次", note: "国产特价 0.7 倍", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^qwen-image$/i, display: "¥0.175/次", note: "国产特价 0.7 倍", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^gemini-3[.]1-flash-image-preview(?:-2k)?$/i, display: "¥0.20/次起", note: "gemini优质；gemini-t3 ¥0.40，origin ¥0.73", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^gemini-3[.]1-flash-image-preview-4k$/i, display: "¥0.274/次起", note: "gemini优质；gemini-t3 ¥0.548，origin ¥1.0001", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^z-image-turbo$/i, display: "¥0.07/次", note: "国产特价 0.7 倍", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^midjourney$/i, display: "价格待核对", note: "公开价格接口未提供固定按张价格", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^grok-4[.]1-image$/i, display: "¥0.10/次", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^grok-4[.]2-image$/i, display: "¥0.12/次", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^gemini-3-pro-image(?:-preview)?(?:-2k)?$/i, display: "¥0.40/次", note: "Gemini 优质分组 2 倍", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^gemini-3-pro-image(?:-preview)?-4k$/i, display: "¥0.55/次", note: "Gemini 优质分组 2 倍", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^grok-imagine-video-1[.]5-preview$/i, display: "¥1.00/次", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^grok-1[.]5-video-6s$/i, display: "¥0.50/次", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^grok-1[.]5-video-(?:10s|15s)$/i, display: "¥0.70/次", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^kling-video-v2-6$/i, display: "¥2.00/次起", note: "国产特价2；有声/10秒按倍率增加", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^kling-video-v3(?:-omni)?$/i, display: "¥0.80/次起", note: "V3 详细档位尚未公开，显示基础价", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^doubao-seedance-2(?:[.-]0)?(?:-|$)/i, display: "¥1.20/秒", source: "https://api.apilio.ai/api/pricing" },
    { channel: /apilio/i, model: /^suno_music$/i, display: "¥0.50/次", source: "https://api.apilio.ai/api/pricing" },

    { channel: /bbww/i, model: /grok.*(?:video|imagine-1[.]5)/i, display: "¥0.24/秒", note: "基础 $0.06/秒 × Sora-custom 4 倍；$1额度=¥1", source: "https://api.bbww.top/" },

    { channel: /minimax/i, model: /^speech-2[.](?:6|8)-turbo$/i, display: "¥2/万字符", source: "https://platform.minimaxi.com/docs/guides/pricing-paygo" },
    { channel: /minimax/i, model: /^speech-2[.](?:6|8)-hd$/i, display: "¥3.5/万字符", source: "https://platform.minimaxi.com/docs/guides/pricing-paygo" },
    { channel: /minimax/i, model: /^music-2[.]6-free$/i, display: "¥0/次", note: "RPM 3", source: "https://platform.minimaxi.com/docs/guides/pricing-paygo" },
    { channel: /minimax/i, model: /^music-2[.]6$/i, display: "¥1/次", note: "RPM 120", source: "https://platform.minimaxi.com/docs/guides/pricing-paygo" },
    { channel: /minimax/i, model: /^minimax-m2(?:[.]1|[.]5|[.]7)?$/i, display: "输入¥2.1 / 输出¥8.4/百万token", source: "https://platform.minimaxi.com/docs/guides/pricing-paygo" },
    { channel: /minimax/i, model: /^minimax-m2(?:[.]1|[.]5|[.]7)?-highspeed$/i, display: "输入¥4.2 / 输出¥16.8/百万token", source: "https://platform.minimaxi.com/docs/guides/pricing-paygo" },
    { channel: /minimax/i, model: /^minimax-m3$/i, display: "输入¥2.1 / 输出¥8.4/百万token", note: "当前限时价，≤512k 上下文", source: "https://platform.minimaxi.com/docs/guides/pricing-paygo" },
];

const DEEPKEY_TEXT_PRICES: Record<string, string> = {
    "gpt-5.4": "输入¥0.50 / 输出¥3.00/百万token",
    "gpt-5.4-mini": "输入¥0.15 / 输出¥0.90/百万token",
    "gpt-5.5": "输入¥1.00 / 输出¥6.00/百万token",
    "gpt-5.6-luna": "输入¥0.20 / 输出¥1.20/百万token",
    "gpt-5.6-sol": "输入¥1.00 / 输出¥6.00/百万token",
    "gpt-5.6-terra": "输入¥0.50 / 输出¥3.00/百万token",
};

export function resolveModelPrice(channel: Pick<ModelChannel, "name" | "baseUrl" | "models">, model: string): ModelPrice | null {
    const channelKey = `${channel.name} ${channel.baseUrl}`;
    const normalizedModel = model.trim();
    const customPrice = channel.models.find((entry) => entry.name === normalizedModel)?.price?.trim();
    if (customPrice) {
        return { display: customPrice, note: "用户自定义人民币价格", verifiedAt: "自定义" };
    }
    if (/deepkey/i.test(channelKey) && DEEPKEY_TEXT_PRICES[normalizedModel.toLowerCase()]) {
        return {
            display: DEEPKEY_TEXT_PRICES[normalizedModel.toLowerCase()],
            note: "DeepKey gpt 分组 0.2 倍",
            source: "https://deepkey.top/api/pricing",
            verifiedAt: VERIFIED_AT,
        };
    }
    const rule = PRICE_RULES.find((item) => item.channel.test(channelKey) && item.model.test(normalizedModel));
    return rule ? { display: rule.display, note: rule.note, source: rule.source, verifiedAt: VERIFIED_AT } : null;
}

export function appendModelPrice(label: string, channel: Pick<ModelChannel, "name" | "baseUrl" | "models">, model: string) {
    const price = resolveModelPrice(channel, model);
    return price ? `${label} · ${price.display}` : label;
}
