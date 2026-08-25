<h1 align="center">LoopCanvas AI</h1>

<p align="center"><a href="README.zh-CN.md">简体中文文档</a></p>

<p align="center">
  <img src="web/public/logo.svg" width="96" alt="LoopCanvas AI logo">
</p>

<p align="center">
  <strong>循环节点驱动的多模型视觉生产工作台</strong>
</p>

<p align="center">
  <a href="https://github.com/moyuan10086/loopcanvas-ai"><img src="https://img.shields.io/github/stars/moyuan10086/loopcanvas-ai?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="https://github.com/moyuan10086/loopcanvas-ai/tags"><img src="https://img.shields.io/github/v/tag/moyuan10086/loopcanvas-ai?style=flat-square&label=version" alt="Version"></a>
  <a href="https://vite.dev/"><img src="https://img.shields.io/badge/Vite-7-646cff?style=flat-square&logo=vite&logoColor=white" alt="Vite"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"></a>
</p>

LoopCanvas AI 把无限画布、多模型生成、循环批处理、参考图编辑、模型成本对比和本地 Agent 整合在同一个工作台中。它既可以用于自由探索视觉方案，也可以搭建换装、商品卖点图、批量超分、逐轮改图和多步骤媒体生产流程。

> [!WARNING]
> 项目仍在快速迭代中，画布、配置和本地存储结构可能变化。当前更适合个人或局域网使用，不建议未经访问控制和安全加固就直接开放到公网。

## 为什么是 LoopCanvas

普通画布解决“把节点连起来”，LoopCanvas 更关注“让一套流程可靠地重复执行”。

循环节点是系统的核心调度器。它可以按轮读取不同素材和提示词，固定复用主体参考图，依次执行右侧处理步骤，并将每轮结果独立排布在画布上。批量任务不需要手工复制节点，也不会把几十个请求一次性全部打到供应商。

## 核心能力

### 无限画布

- 多画布项目、节点拖拽、等比例缩放、连接线、小地图和视口控制。
- 图片、视频、音频、文本、生成配置、循环和分组节点。
- 框选、多选、复制粘贴、撤销重做、导入导出和批量删除。
- 节点显示固定图片索引、生成耗时、状态和可读参考来源。
- 画布项目和节点媒体可保存到本地后端，不再只依赖浏览器缓存。

### 循环节点

- 支持按顺序执行和最多 4 个 worker 的有界并发。
- 支持编号提示词整段粘贴，并按轮一一对应。
- 支持 {{i}}、{{r}}、{{n}} 等循环变量。
- 支持轮换输入图、固定参考图多选和纯文字批量生图。
- 支持图片、视频、音频和文本节点组成的多步骤处理链。
- 单轮失败不会吞掉全部任务，可保留已完成结果并继续后续轮次。
- 支持停止当前循环，避免继续产生请求和费用。
- 结果按“步骤列 × 轮次行”自动布局，减少重叠和错误连线。

### 商品卖点图

- 在循环节点中直接填写编号卖点清单。
- 商品参考图在每轮固定复用。
- 第 N 轮只发送第 N 条卖点，不把整份清单交给模型自行挑选。
- 默认按顺序执行，适合慢速图片编辑渠道。
- 可为同一商品批量生成材质、功能、场景和细节卖点图。

### 多模型与多渠道

系统支持按渠道维护 Base URL、API Key、协议、模型、调用脚本和价格。

- 图片：GPT Image、Grok Imagine、Flux、Nano Banana、Qwen Image Edit 等。
- 视频：Seedance、Kling、Grok Imagine Video 等。
- 音频：MiniMax TTS、Music 等。
- 文本：OpenAI 兼容聊天模型和自定义文本接口。
- 工作流：RunningHub、ComfyUI、ModelScope 等异步或工作流渠道。

已经针对 DeepKey、ToAPIs、Apilio、APIMart、RunningHub、ComfyUI、ModelScope 和 MiniMax 等渠道处理异步提交、上传、轮询、代理、超时、错误透传和结果解析。

### 可靠的参考图

- 支持显式 @ 引用、隐式参考开关、固定参考图和轮换素材。
- 直接编辑已有图片时保留当前图片作为主体参考。
- 生成记录保存 referenceNodeIds、referenceLabels、媒体存储键和固定 IMG- 索引。
- 图片删除或重新排序后，固定索引和引用关系仍可追踪。
- 重试会恢复原生成类型和参考资源，避免图片编辑退化为纯文生图。

### 图片与视频工具

- RunningHub AI 超分，支持消费级会员与企业级共享 Key。
- 普通放大、扩图、遮罩编辑、矢量化和局部图片编辑。
- 视频抽帧、首尾帧、参考图模式和自定义播放器。
- 图片视角调整、AI 快捷操作和多步骤图片处理。
- 批量图片组支持单张重试、下载、删除、设为主图和创建独立副本。

### 模型价格与 API 统计

- 模型价格统一显示为人民币。
- 支持渠道充值比例、美元汇率和额度换算。
- 支持定价抓取、自定义覆盖、完整模型 ID 复制和价格待核对状态。
- 画布内显示今日调用量、成功率、平均耗时、失败数和最近请求。
- API 统计不保存完整提示词、上传文件内容或 API Key。

### 本地 Agent

- 通过 MCP 读取和操作当前画布。
- 支持 Codex / Claude Code。
- 支持选择 Agent 模型与推理强度。
- 支持请求批准、自动审查和完全访问等权限档位。
- 保存画布项目、节点媒体、渠道配置、API 统计和对话记录。
- 刷新或更换浏览器后，可从本地后端恢复画布和媒体。

### 提示词库

- 支持多个公开提示词来源。
- 支持分类、标签、关键词搜索、封面预览、复制和插入画布。
- 包含 GPT Image 2、Nano Banana 等相关来源。
- 已加入 Freestylefly GPT Image 2 公开模板。

## 典型工作流

### 同一模特批量换装

1. 把模特图设置为固定参考图。
2. 将多张服装图作为循环输入。
3. 在右侧连接图片编辑步骤。
4. 运行循环后，每轮固定使用模特图，同时依次读取一套服装。

### 同一图片使用不同提示词

1. 连接一张输入图。
2. 在循环节点中粘贴编号提示词清单。
3. 设置生成轮数和串行或并发模式。
4. 每轮复用同一张图片，但使用对应的独立提示词。

### 商品卖点图

1. 选择卖点图模式。
2. 添加商品参考图。
3. 输入防水、轻量、大容量等编号卖点。
4. 每轮只处理一个卖点，并保持商品主体一致。

### 批量 AI 超分

1. 配置 RunningHub 渠道、工作流 ID 和扣费 Key。
2. 在循环流程中连接 AI 超分步骤。
3. 多张输入图按轮依次进入工作流。
4. 排队任务刷新后可以继续恢复轮询。

## 快速开始

### 环境要求

- Node.js 18 或更高版本。
- Bun 或 npm。
- Windows 一键启动脚本需要 PowerShell。
- 本地持久化和 Agent 功能需要运行 Canvas Agent。

### Windows 一键启动

在项目根目录双击：

    start-infinite-canvas.cmd

脚本会检查依赖并启动 Web 与本地 Agent。默认访问地址：

    http://localhost:3000

### 本地开发

    git clone https://github.com/moyuan10086/loopcanvas-ai.git
    cd loopcanvas-ai
    cd web
    bun install
    bun run dev

使用 npm 时，将 Bun 命令替换为对应的 npm 命令即可。

### Docker

    git clone https://github.com/moyuan10086/loopcanvas-ai.git
    cd loopcanvas-ai
    docker compose up -d

启动后访问 http://localhost:3000。生产部署前请根据实际域名、反向代理和访问范围补充安全配置。

## 渠道配置

在配置中心可以为每个渠道维护：

- 渠道名称、协议类型、Base URL 和 API Key。
- 图片、视频、音频和文本模型。
- 默认模型、完整模型 ID、模型能力和自定义调用脚本。
- 图片尺寸、视频时长、分辨率和音频参数。
- 模型价格、计价单位、充值换算比例和定价来源。

### 价格换算

不同平台页面中的美元可能代表真实美元标价，也可能只是充值额度。配置时应按实际规则处理：

- 人民币价格不重复乘汇率。
- 官网美元价按渠道配置的比例换算。
- 充值额度与美元不等价时，按实际充值比例填写。
- 无法确认的模型保留“价格待核对”，不写虚构价格。

### RunningHub

RunningHub 渠道可以分别填写消费级会员 Key 和企业级共享 Key。固定选择一种扣费方式时不会自动回退到另一把 Key；选择自动时才会按配置顺序选择可用通道。

## Canvas Agent

Canvas Agent 负责本地持久化、媒体落盘、API 统计同步以及 Codex / Claude Code 的画布操作。

    cd canvas-agent
    npm install
    npm run build
    npm start

也可以直接使用 Windows 一键启动脚本。网页连接 Agent 后，画布侧边栏会从本地后端拉取项目，并与浏览器离线缓存合并。

## 数据保存与隐私

- API Key 和 Base URL 默认保存在浏览器本地。
- 连接 Agent 后，画布、节点媒体、渠道配置和 API 统计保存到 ~/.infinite-canvas/。
- IndexedDB 作为离线缓存；“我的素材”仍主要保存在当前浏览器。
- 节点媒体使用 storageKey 保存，避免后端项目长期保留失效的 blob 地址。
- 当前前端会请求用户配置的第三方 AI 接口，请确认渠道、代理和部署环境可信。
- 项目不会在 API 统计中保存完整提示词、上传内容或 API Key。

## 项目结构

    .
    ├─ web/                  React + TypeScript 前端
    │  ├─ src/pages/         画布、配置、图片、视频和统计页面
    │  ├─ src/components/    节点、循环、配置面板和 Agent UI
    │  ├─ src/services/api/  图片、视频、音频、文本及渠道适配
    │  └─ src/stores/        画布、配置和 Agent 状态
    ├─ canvas-agent/         本地 Agent 与持久化服务
    ├─ plugins/              Canvas 与 Codex 插件
    ├─ docs/                 使用文档和项目记录
    └─ start-infinite-canvas.cmd

## 技术栈

- React
- TypeScript
- Vite
- React Router
- Zustand
- Ant Design
- Tailwind CSS
- Node.js Canvas Agent
- IndexedDB / localForage

## 开发约定

- 外部渠道请求集中在 web/src/services/api/。
- 画布状态优先使用现有 store、同步服务和主题系统。
- 非幂等生成请求不能在网络错误后盲目自动重试，避免重复扣费。
- 异步任务需要考虑排队、刷新恢复、停止和部分失败。
- 修改用户可感知功能后，同步更新 CHANGELOG.md 和待测试文档。

## 文档

- [快速开始](docs/content/docs/overview/quick-start.mdx)
- [功能介绍](docs/content/docs/overview/features.mdx)
- [画布节点操作手册](docs/content/docs/canvas/canvas-node-manual.mdx)
- [画布快捷键](docs/content/docs/canvas/canvas-shortcuts.mdx)
- [本地 Canvas Agent](canvas-agent/README.md)
- [项目差异记录](FORK_NOTES.md)
- [项目与简历记录](docs/PROJECT_RECORD.md)
- [待办事项](docs/content/docs/progress/todo.mdx)
- [安全策略](SECURITY.md)

## 社区

LoopCanvas AI 持续吸收公开模型服务、工作流和前端工程社区的实践经验，并欢迎围绕循环节点、多模型接入和视觉生产流程提交改进建议。
