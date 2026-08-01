import { createModelChannel, encodeChannelModel, type ChannelModel, type ModelChannel } from "@/stores/use-config-store";

const MODELSCOPE_BASE_URL = "https://api-inference.modelscope.cn";
const COMFYUI_BASE_URL = "http://127.0.0.1:8188";
const RUNNINGHUB_BASE_URL = "https://www.runninghub.cn";
export const RUNNINGHUB_SEEDVR2_WORKFLOW_ID = "2058824859437850625";

export const RUNNINGHUB_REFERENCE_WORKFLOWS = [
    { id: "2058824859437850625", name: "SeedVR2 高清放大", operation: "superResolution" },
    { id: "2058818588181622785", name: "Flux.2 Klein 细节增强", operation: "image" },
    { id: "2058554058318897153", name: "GPT-Image-2 图片编辑", operation: "image" },
    { id: "2058541134623891458", name: "NanoBanana-2 图片编辑", operation: "image" },
    { id: "2064542485938008065", name: "Flux2-Klein 风格迁移", operation: "image" },
    { id: "2053691179258134529", name: "去水印/去字幕/去模糊 · LTX2.3 iclora insight", operation: "video" },
    { id: "2056549861385924609", name: "图片放大 · 高清修复", operation: "image" },
    { id: "2007596875607707650", name: "SeedVR2 超速 8K 高清放大", operation: "image" },
    { id: "2052211583018913793", name: "图片放大 Image Upscaling", operation: "image" },
] as const;

export const modelscopeImageModels = ["Tongyi-MAI/Z-Image-Turbo", "Qwen/Qwen-Image-2512", "Qwen/Qwen-Image-Edit-2511", "black-forest-labs/FLUX.2-klein-9B"];
export const modelscopeTextModels = ["Qwen/Qwen3-235B-A22B", "Qwen/Qwen3-VL-235B-A22B-Instruct", "MiniMax/MiniMax-M2.7:MiniMax"];

export function createModelScopeChannel(): ModelChannel {
    return createModelChannel({
        id: "modelscope",
        name: "ModelScope 魔塔",
        baseUrl: MODELSCOPE_BASE_URL,
        apiFormat: "openai",
        models: [
            ...modelscopeImageModels.map((name) => ({ name, capability: "image" as const, script: modelScopeImageScript })),
            ...modelscopeTextModels.map((name) => ({ name, capability: "text" as const })),
        ],
    });
}

export function createComfyUIChannel(): ModelChannel {
    return createModelChannel({ id: "comfyui", name: "ComfyUI", baseUrl: COMFYUI_BASE_URL, apiKey: "local-comfyui", apiFormat: "openai", models: [] });
}

export function createRunningHubChannel(): ModelChannel {
    return createModelChannel({
        id: "runninghub",
        name: "RunningHub",
        baseUrl: RUNNINGHUB_BASE_URL,
        apiFormat: "openai",
        models: [
            buildRunningHubWorkflowModel("SeedVR2 高清放大 · 2058824859437850625", RUNNINGHUB_SEEDVR2_WORKFLOW_ID),
            ...RUNNINGHUB_REFERENCE_WORKFLOWS.filter((item) => item.id !== RUNNINGHUB_SEEDVR2_WORKFLOW_ID).map((item) => buildRunningHubReferenceWorkflowModel(item.name, item.id)),
        ],
    });
}

export function isModelScopeChannel(channel: Pick<ModelChannel, "id" | "name" | "baseUrl">) {
    return channel.id === "modelscope" || /modelscope|魔塔/i.test(channel.name) || /api-inference[.]modelscope/i.test(channel.baseUrl);
}

export function isComfyUIChannel(channel: Pick<ModelChannel, "id" | "name" | "baseUrl">) {
    return channel.id === "comfyui" || /comfyui/i.test(channel.name) || /:8188(?:\/|$)/.test(channel.baseUrl);
}

export function isRunningHubChannel(channel: Pick<ModelChannel, "id" | "name" | "baseUrl">) {
    return channel.id === "runninghub" || /runninghub/i.test(channel.name) || /runninghub\.(?:cn|ai)/i.test(channel.baseUrl);
}

export function comfyUIUpscaleModelOptions(channels: ModelChannel[]) {
    return channels.flatMap((channel) =>
        isComfyUIChannel(channel)
            ? channel.models.filter((model) => model.capability === "image" && model.script && /SeedVR2VideoUpscaler/i.test(model.script)).map((model) => encodeChannelModel(channel.id, model.name))
            : [],
    );
}

export function runningHubUpscaleModelOptions(channels: ModelChannel[]) {
    return channels.flatMap((channel) =>
        isRunningHubChannel(channel)
            ? channel.models.filter((model) => model.capability === "image" && !/2053691179258134529|(?:去水印|去字幕|去模糊).*ltx2\.3/i.test(model.name) && model.script && /RUNNINGHUB_(?:WORKFLOW|PROJECT_WORKFLOW)_V1/i.test(model.script)).map((model) => encodeChannelModel(channel.id, model.name))
            : [],
    );
}

export function runningHubDefaultUpscaleModelOption(channels: ModelChannel[]) {
    for (const channel of channels) {
        if (!isRunningHubChannel(channel)) continue;
        const selected = channel.runningHubSuperResolutionModel?.trim();
        if (selected && channel.models.some((model) => model.name === selected && model.capability === "image" && !/2053691179258134529|(?:去水印|去字幕|去模糊).*ltx2\.3/i.test(model.name) && model.script && /RUNNINGHUB_(?:WORKFLOW|PROJECT_WORKFLOW)_V1/i.test(model.script))) return encodeChannelModel(channel.id, selected);
    }
    return "";
}

export function buildRunningHubWorkflowModel(name: string, workflowId: string): ChannelModel {
    const id = workflowId.trim();
    if (!/^\d+$/.test(id)) throw new Error("RunningHub 工作流 ID 应为数字");
    const script = [
        "// RUNNINGHUB_WORKFLOW_V1",
        `const workflowId = ${JSON.stringify(id)};`,
        'const root = String(baseUrl || "https://www.runninghub.cn").replace(/\\/+$/, "").replace(/\\/v1$/i, "");',
        'const apiKeyValue = String(params.useWallet ? params.walletApiKey || "" : apiKey || "").trim();',
        'if (!apiKeyValue) throw new Error("请先填写 RunningHub API Key");',
        'if (!images.length) throw new Error("RunningHub 超分需要一张源图");',
        'const source = await (await fetch(images[0])).blob();',
        'const form = new FormData();',
        'form.append("apiKey", apiKeyValue);',
        'form.append("fileType", "input");',
        'form.append("file", source, "infinite-canvas-source.png");',
        'const uploaded = await request({ method: "post", url: root + "/task/openapi/upload", data: form });',
        'const fileName = uploaded?.data?.fileName || uploaded?.fileName;',
        'if (!fileName) throw new Error(uploaded?.msg || "RunningHub 上传源图失败");',
        'const workflowResponse = await request({ method: "post", url: root + "/api/openapi/getJsonApiFormat", headers: { "Content-Type": "application/json" }, data: { apiKey: apiKeyValue, workflowId } });',
        'const promptJson = workflowResponse?.data?.prompt;',
        'let workflow = typeof promptJson === "string" ? JSON.parse(promptJson) : promptJson;',
        'if (!workflow || typeof workflow !== "object") throw new Error("RunningHub 工作流 JSON 无效");',
        'const entries = Object.entries(workflow);',
        'const imageNode = entries.find(([, node]) => /loadimage/i.test(String(node?.class_type || "")) && node?.inputs && Object.prototype.hasOwnProperty.call(node.inputs, "image"));',
        'const upscaleNode = entries.find(([, node]) => /SeedVR2VideoUpscaler|upscal/i.test(String(node?.class_type || "")) && node?.inputs);',
        'if (!imageNode) throw new Error("工作流中没有找到 LoadImage 节点");',
        'const resolution = Number(params.targetLongEdge || 2048);',
        'const nodeInfoList = [{ nodeId: String(imageNode[0]), fieldName: "image", fieldValue: fileName }];',
        'if (upscaleNode) { const inputs = upscaleNode[1].inputs || {}; if (Object.prototype.hasOwnProperty.call(inputs, "resolution")) nodeInfoList.push({ nodeId: String(upscaleNode[0]), fieldName: "resolution", fieldValue: String(resolution) }); if (Object.prototype.hasOwnProperty.call(inputs, "seed")) nodeInfoList.push({ nodeId: String(upscaleNode[0]), fieldName: "seed", fieldValue: String(Math.floor(Math.random() * 2147483647)) }); }',
        'const submitted = await request({ method: "post", url: root + "/task/openapi/create", headers: { "Content-Type": "application/json" }, data: { apiKey: apiKeyValue, workflowId, addMetadata: true, nodeInfoList } });',
        'const taskId = submitted?.data?.taskId || submitted?.taskId;',
        'if (!taskId) throw new Error(submitted?.msg || "RunningHub 未返回 taskId");',
        'onTask?.({ taskId: String(taskId), workflowId, useWallet: Boolean(params.useWallet) });',
        'const collectUrls = (value, output = []) => { if (typeof value === "string") { const text = value.trim(); if (/^https?:\\/\\//i.test(text)) output.push(text); else if (/^[\\[{]/.test(text)) { try { collectUrls(JSON.parse(text), output); } catch {} } } else if (Array.isArray(value)) value.forEach((item) => collectUrls(item, output)); else if (value && typeof value === "object") Object.values(value).forEach((item) => collectUrls(item, output)); return [...new Set(output)]; };',
        'const result = await poll(() => request({ method: "post", url: root + "/task/openapi/outputs", headers: { "Content-Type": "application/json" }, data: { apiKey: apiKeyValue, taskId } }), (raw) => { let payload = raw; if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch {} } const code = payload?.code; if (code === 805 || code === "805") throw new Error(payload?.msg || "RunningHub 工作流执行失败"); const urls = collectUrls(payload?.data ?? payload); return code === 0 || code === "0" ? (urls.length ? urls : null) : null; }, { intervalMs: 2500, timeoutMs: 1800000 });',
        'if (!result.length) throw new Error("RunningHub 工作流完成但没有图片输出");',
        'return result;',
    ].join("\n");
    return { name: name.trim() || `RunningHub 工作流 ${id}`, capability: "image", script };
}

/** Build a general image workflow model from the public reference project's RunningHub presets. */
export function buildRunningHubReferenceWorkflowModel(name: string, workflowId: string): ChannelModel {
    const id = workflowId.trim();
    if (!/^\d+$/.test(id)) throw new Error("RunningHub 工作流 ID 应为数字");
    const script = [
        "// RUNNINGHUB_PROJECT_WORKFLOW_V1",
        `const workflowId = ${JSON.stringify(id)};`,
        'const root = String(baseUrl || "https://www.runninghub.cn").replace(/\\/+$/, "").replace(/\\/v1$/i, "");',
        'const apiKeyValue = String(params.useWallet ? params.walletApiKey || "" : apiKey || "").trim();',
        'if (!apiKeyValue) throw new Error("请先填写 RunningHub API Key");',
        'const upload = async (dataUrl, index) => { const blob = await (await fetch(dataUrl)).blob(); const form = new FormData(); form.append("apiKey", apiKeyValue); form.append("fileType", "input"); form.append("file", blob, "infinite-canvas-reference-" + index + ".png"); const response = await request({ method: "post", url: root + "/task/openapi/upload", data: form }); const fileName = response?.data?.fileName || response?.fileName; if (!fileName) throw new Error(response?.msg || "RunningHub 上传参考图失败"); return fileName; };',
        'const sourceUrls = Array.isArray(params.videoUrls) && params.videoUrls.length ? params.videoUrls : images; const uploaded = []; for (let index = 0; index < sourceUrls.length; index += 1) uploaded.push(await upload(sourceUrls[index], index));',
        'const workflowResponse = await request({ method: "post", url: root + "/api/openapi/getJsonApiFormat", headers: { "Content-Type": "application/json" }, data: { apiKey: apiKeyValue, workflowId } });',
        'const promptJson = workflowResponse?.data?.prompt || workflowResponse?.prompt; let workflow = typeof promptJson === "string" ? JSON.parse(promptJson) : promptJson; if (!workflow || typeof workflow !== "object") throw new Error("RunningHub 工作流 JSON 无效");',
        'const entries = Object.entries(workflow); const mediaNodes = entries.filter(([, node]) => /loadimage|imageinput|imageupload|loadvideo|videoinput|videoupload/i.test(String(node?.class_type || "")) && node?.inputs); const nodeInfoList = [];',
        'for (let index = 0; index < Math.min(uploaded.length, mediaNodes.length); index += 1) { const [nodeId, node] = mediaNodes[index]; const fieldName = Object.keys(node.inputs || {}).find((key) => /^(image|video|image_url|video_url|filename|file)$/i.test(key)) || "image"; nodeInfoList.push({ nodeId: String(nodeId), fieldName, fieldValue: uploaded[index] }); }',
        'const promptNodes = entries.filter(([, node]) => node?.inputs && !/negative/i.test(String(node?._meta?.title || ""))).flatMap(([nodeId, node]) => Object.keys(node.inputs).filter((key) => /^(text|prompt|positive|description|caption)$/i.test(key) && typeof node.inputs[key] === "string").map((fieldName) => ({ nodeId: String(nodeId), fieldName })));',
        'if (prompt && promptNodes.length) { const target = promptNodes.find((item) => /prompt|text|positive/i.test(item.fieldName)) || promptNodes[0]; nodeInfoList.push({ ...target, fieldValue: prompt }); }',
        'const targetLongEdge = Number(params.targetLongEdge || 0); for (const [nodeId, node] of entries) { const inputs = node?.inputs || {}; for (const fieldName of Object.keys(inputs)) { if (/^(seed|noise_seed)$/i.test(fieldName)) nodeInfoList.push({ nodeId: String(nodeId), fieldName, fieldValue: String(Math.floor(Math.random() * 4294967295) + 1) }); if (targetLongEdge && /^(resolution|max_resolution|target_resolution)$/i.test(fieldName)) nodeInfoList.push({ nodeId: String(nodeId), fieldName, fieldValue: String(targetLongEdge) }); } }',
        'const submitted = await request({ method: "post", url: root + "/task/openapi/create", headers: { "Content-Type": "application/json" }, data: { apiKey: apiKeyValue, workflowId, addMetadata: true, nodeInfoList } });',
        'const taskId = submitted?.data?.taskId || submitted?.taskId; if (!taskId) throw new Error(submitted?.msg || "RunningHub 未返回 taskId"); onTask?.({ taskId: String(taskId), workflowId, useWallet: Boolean(params.useWallet) });',
        'const collectUrls = (value, output = []) => { if (typeof value === "string") { const text = value.trim(); if (/^https?:\\/\\//i.test(text)) output.push(text); else if (/^[\\[{]/.test(text)) { try { collectUrls(JSON.parse(text), output); } catch {} } } else if (Array.isArray(value)) value.forEach((item) => collectUrls(item, output)); else if (value && typeof value === "object") Object.values(value).forEach((item) => collectUrls(item, output)); return [...new Set(output)]; };',
        'const result = await poll(() => request({ method: "post", url: root + "/task/openapi/outputs", headers: { "Content-Type": "application/json" }, data: { apiKey: apiKeyValue, taskId } }), (raw) => { let payload = raw; if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch {} } const code = payload?.code; if (code === 805 || code === "805") throw new Error(payload?.msg || "RunningHub 工作流执行失败"); const urls = collectUrls(payload?.data ?? payload); return code === 0 || code === "0" ? (urls.length ? urls : null) : null; }, { intervalMs: 2500, timeoutMs: 1800000 });',
        'if (!result.length) throw new Error("RunningHub 工作流完成但没有媒体输出"); return Array.isArray(params.videoUrls) && params.videoUrls.length ? { url: result[0] } : result;',
    ].join("\n");
    return { name: name.trim() || `RunningHub 工作流 ${id}`, capability: RUNNINGHUB_REFERENCE_WORKFLOWS.find((item) => item.id === id)?.operation === "video" ? "video" : "image", script };
}

export function buildComfyUIWorkflowModel(name: string, workflow: unknown): ChannelModel {
    if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) throw new Error("工作流 JSON 格式不正确");
    const nodes = Object.values(workflow as Record<string, unknown>);
    if (!nodes.some((node) => node && typeof node === "object" && "class_type" in node)) throw new Error("请从 ComfyUI 导出 API 格式工作流（节点需要包含 class_type）");
    const graph = JSON.stringify(workflow).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
    const script = [
        `const graph = JSON.parse(JSON.stringify(${graph}));`,
        `const root = String(baseUrl || "").replace(/\\/+$/, "");`,
        `const entries = Object.entries(graph);`,
        `const promptCandidates = entries.filter(([, node]) => node && node.inputs && Object.entries(node.inputs).some(([key, value]) => typeof value === "string" && /^(text|prompt|positive|description)$/i.test(key)));`,
        `const promptEntry = promptCandidates.find(([, node]) => !/negative|负面/i.test(String(node._meta && node._meta.title || ""))) || promptCandidates[0];`,
        `if (promptEntry) { const inputs = promptEntry[1].inputs; const key = Object.keys(inputs).find((item) => /^(text|prompt|positive|description)$/i.test(item) && typeof inputs[item] === "string"); if (key) inputs[key] = prompt; }`,
        `const imageNodes = entries.filter(([, node]) => node && node.inputs && /load.*image|image.*loader/i.test(String(node.class_type || "")));`,
        `for (let index = 0; index < Math.min(images.length, imageNodes.length); index += 1) {`,
        `  const blob = await (await fetch(images[index])).blob();`,
        `  const form = new FormData();`,
        `  const filename = "infinite_canvas_" + Date.now() + "_" + index + ".png";`,
        `  form.append("image", blob, filename);`,
        `  const uploaded = await request({ method: "post", url: root + "/upload/image", data: form });`,
        `  const node = imageNodes[index][1];`,
        `  const key = Object.keys(node.inputs).find((item) => /image|filename|file/i.test(item));`,
        `  if (key) node.inputs[key] = uploaded.name || uploaded.filename || filename;`,
        `}`,
        `const sizeMatch = String(params.size || "").match(/^(\\d+)x(\\d+)$/i);`,
        `const targetLongEdge = Number(params.targetLongEdge || (sizeMatch ? Math.max(Number(sizeMatch[1]), Number(sizeMatch[2])) : 0));`,
        `for (const [, node] of entries) {`,
        `  if (!node || !node.inputs) continue;`,
        `  for (const key of Object.keys(node.inputs)) {`,
        `    if (/^(seed|noise_seed)$/i.test(key) && typeof node.inputs[key] === "number") node.inputs[key] = Math.floor(Math.random() * 2147483647);`,
        `  }`,
        `  if (sizeMatch && typeof node.inputs.width === "number" && typeof node.inputs.height === "number") { node.inputs.width = Number(sizeMatch[1]); node.inputs.height = Number(sizeMatch[2]); }`,
        `  if (targetLongEdge && /upscal|seedvr|supir|aurasr|realesrgan/i.test(String(node.class_type || "")) && typeof node.inputs.resolution === "number") node.inputs.resolution = targetLongEdge;`,
        `  if (targetLongEdge && typeof node.inputs.max_resolution === "number" && node.inputs.max_resolution < targetLongEdge) node.inputs.max_resolution = targetLongEdge;`,
        `}`,
        `const clientId = "infinite-canvas-" + Math.random().toString(36).slice(2);`,
        `const submitted = await request({ method: "post", url: root + "/prompt", headers: { "Content-Type": "application/json" }, data: { prompt: graph, client_id: clientId } });`,
        `const promptId = submitted.prompt_id;`,
        `if (!promptId) throw new Error(submitted.error && submitted.error.message || "ComfyUI 未返回 prompt_id");`,
        `const record = await poll(`,
        `  async () => { const data = await request({ method: "get", url: root + "/history/" + encodeURIComponent(promptId) }); return data[promptId] || null; },`,
        `  (value) => { if (!value) return null; const status = value.status || {}; if (status.status_str === "error" || status.completed === false && status.messages && status.messages.some((item) => String(item).includes("execution_error"))) throw new Error("ComfyUI 工作流执行失败"); return value; },`,
        `  { intervalMs: 1200, timeoutMs: 1800000 },`,
        `);`,
        `const urls = [];`,
        `for (const output of Object.values(record.outputs || {})) {`,
        `  for (const item of output.images || []) {`,
        `    const query = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder || "", type: item.type || "output" });`,
        `    urls.push(root + "/view?" + query.toString());`,
        `  }`,
        `}`,
        `if (!urls.length) throw new Error("ComfyUI 工作流完成，但没有找到图片输出");`,
        `return urls;`,
    ].join("\n");
    return { name: name.trim() || "ComfyUI 工作流", capability: "image", script };
}

const modelScopeImageScript = `const root = String(baseUrl || "").replace(/\\/+$/, "").replace(/\\/v1$/i, "");
const body = { model, prompt };
if (params.size) body.size = params.size;
if (images.length) body.image_url = images;
const headers = { "Content-Type": "application/json", Authorization: "Bearer " + apiKey, "X-ModelScope-Async-Mode": "true" };
const submitted = await request({ method: "post", url: root + "/v1/images/generations", headers, data: body });
if (Array.isArray(submitted.output_images) && submitted.output_images.length) return submitted.output_images;
if (Array.isArray(submitted.data) && submitted.data.length) return submitted.data.map((item) => item.url || (item.b64_json ? "data:image/png;base64," + item.b64_json : null)).filter(Boolean);
const taskId = submitted.task_id;
if (!taskId) throw new Error(submitted.message || submitted.error && submitted.error.message || "ModelScope 未返回 task_id");
const result = await poll(
  () => request({ method: "get", url: root + "/v1/tasks/" + encodeURIComponent(taskId), headers: { Authorization: "Bearer " + apiKey, "X-ModelScope-Task-Type": "image_generation" } }),
  (data) => {
    const status = String(data.task_status || "").toUpperCase();
    if (status === "SUCCEED") return data.output_images || [];
    if (["FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"].includes(status)) throw new Error(data.error_info || data.message || "ModelScope 任务失败");
    return null;
  },
  { intervalMs: 2000, timeoutMs: 1800000 },
);
if (!result.length) throw new Error("ModelScope 任务成功但没有返回图片");
return result;`;
