import ImageTracer from "imagetracerjs";

export type VectorizerMode = "fast" | "standard" | "detailed";

export type ImageVectorizeOptions = {
    mode: VectorizerMode;
    colors: number;
};

export type ImageVectorizeResult = {
    svg: string;
    width: number;
    height: number;
    tracedWidth: number;
    tracedHeight: number;
    colors: string[];
    pathCount: number;
};

const MAX_TRACE_EDGE = 1600;
const MAX_TRACE_PIXELS = 1_800_000;

const TRACE_PRESETS = {
    fast: { ltres: 2, qtres: 2, pathomit: 16, colorquantcycles: 2, roundcoords: 0, blurradius: 1 },
    standard: { ltres: 1, qtres: 1, pathomit: 8, colorquantcycles: 3, roundcoords: 1, blurradius: 0 },
    detailed: { ltres: 0.5, qtres: 0.5, pathomit: 2, colorquantcycles: 4, roundcoords: 2, blurradius: 0 },
} satisfies Record<VectorizerMode, Record<string, number>>;

export async function vectorizeImage(source: string, options: ImageVectorizeOptions): Promise<ImageVectorizeResult> {
    const image = await loadImage(source);
    const scale = Math.min(1, MAX_TRACE_EDGE / Math.max(image.naturalWidth, image.naturalHeight), Math.sqrt(MAX_TRACE_PIXELS / (image.naturalWidth * image.naturalHeight)));
    const tracedWidth = Math.max(1, Math.round(image.naturalWidth * scale));
    const tracedHeight = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = tracedWidth;
    canvas.height = tracedHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前浏览器无法读取图片像素");
    context.drawImage(image, 0, 0, tracedWidth, tracedHeight);

    await yieldToBrowser();
    const imageData = context.getImageData(0, 0, tracedWidth, tracedHeight);
    const tracedSvg = ImageTracer.imagedataToSVG(imageData, {
        ...TRACE_PRESETS[options.mode],
        colorsampling: 2,
        numberofcolors: Math.max(2, Math.min(32, Math.round(options.colors))),
        mincolorratio: 0.02,
        linefilter: true,
        viewbox: true,
        scale: 1,
    });
    const svg = normalizeSvgSize(tracedSvg, image.naturalWidth, image.naturalHeight, tracedWidth, tracedHeight);

    return {
        svg,
        width: image.naturalWidth,
        height: image.naturalHeight,
        tracedWidth,
        tracedHeight,
        colors: extractVectorColors(svg),
        pathCount: (svg.match(/<path\b/gi) || []).length,
    };
}

export function extractVectorColors(svg: string) {
    const document = parseSvg(svg);
    const colors = new Set<string>();
    document.querySelectorAll("[fill], [stroke]").forEach((element) => {
        [element.getAttribute("fill"), element.getAttribute("stroke")].forEach((value) => {
            const color = value ? cssColorToHex(value) : null;
            if (color) colors.add(color);
        });
    });
    return [...colors];
}

export function customizeVectorSvg(svg: string, replacements: Record<string, string>, removeWhite: boolean) {
    const document = parseSvg(svg);
    document.querySelectorAll("script, foreignObject").forEach((element) => element.remove());
    document.querySelectorAll("*").forEach((element) => {
        [...element.attributes].forEach((attribute) => {
            if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name);
        });
    });

    document.querySelectorAll("[fill], [stroke]").forEach((element) => {
        const fill = element.getAttribute("fill");
        const fillHex = fill ? cssColorToHex(fill) : null;
        if (removeWhite && element.localName === "path" && fillHex && isNearWhite(fillHex)) {
            element.remove();
            return;
        }
        (["fill", "stroke"] as const).forEach((attribute) => {
            const value = element.getAttribute(attribute);
            const hex = value ? cssColorToHex(value) : null;
            const replacement = hex ? replacements[hex] : null;
            if (replacement) element.setAttribute(attribute, replacement);
        });
    });

    return new XMLSerializer().serializeToString(document.documentElement);
}

function normalizeSvgSize(svg: string, width: number, height: number, tracedWidth: number, tracedHeight: number) {
    const document = parseSvg(svg);
    const root = document.documentElement;
    root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    root.setAttribute("width", String(width));
    root.setAttribute("height", String(height));
    root.setAttribute("viewBox", `0 0 ${tracedWidth} ${tracedHeight}`);
    root.setAttribute("preserveAspectRatio", "xMidYMid meet");
    return new XMLSerializer().serializeToString(root);
}

function parseSvg(svg: string) {
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") throw new Error("SVG 数据无效");
    return document;
}

function cssColorToHex(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "none" || normalized === "transparent") return null;
    const shortHex = normalized.match(/^#([0-9a-f]{3})$/i)?.[1];
    if (shortHex) return `#${[...shortHex].map((part) => part + part).join("")}`;
    const hex = normalized.match(/^#([0-9a-f]{6})$/i)?.[1];
    if (hex) return `#${hex}`;
    const rgb = normalized.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
    if (!rgb) return null;
    return `#${rgb.slice(1, 4).map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))).toString(16).padStart(2, "0")).join("")}`;
}

function isNearWhite(hex: string) {
    const red = Number.parseInt(hex.slice(1, 3), 16);
    const green = Number.parseInt(hex.slice(3, 5), 16);
    const blue = Number.parseInt(hex.slice(5, 7), 16);
    return red >= 245 && green >= 245 && blue >= 245;
}

function loadImage(source: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("图片加载失败，请确认图片仍然可用"));
        image.src = source;
    });
}

function yieldToBrowser() {
    return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}
