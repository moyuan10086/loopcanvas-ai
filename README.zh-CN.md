<h1 align="center">LoopCanvas AI 中文文档</h1>

<p align="center">
  <a href="https://github.com/moyuan10086/loopcanvas-ai">🌐 GitHub 仓库</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/moyuan10086/loopcanvas-ai/releases">📦 Releases</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/moyuan10086/loopcanvas-ai/issues">🐛 问题反馈</a>
  &nbsp;·&nbsp;
  <a href="docs/">📚 项目文档</a>
</p>

<p align="center">
  <img src="web/public/logo.svg" width="96" alt="LoopCanvas AI logo">
</p>

<p align="center">
  <strong>循环节点驱动的多模型视觉生产工作台</strong>
</p>

LoopCanvas AI 将无限画布、多模型生成、循环批处理、参考图编辑、模型成本对比和本地 Agent 放在一个工作台中。它适合自由探索视觉方案，也适合搭建换装、商品卖点图、批量超分、逐轮改图和多步骤媒体流程。

## ✨ 特性

### 无限画布

- 图片、视频、音频、文本、生成配置、循环和分组节点。
- 节点拖拽、等比例缩放、连接线、小地图、框选、多选和撤销重做。
- 图片节点显示固定索引、生成耗时、状态和参考来源。
- 画布项目和节点媒体可以保存到本地 Canvas Agent。

### 循环节点

- 支持串行执行和最多 4 个 worker 的有界并发。
- 支持编号提示词整段粘贴和逐轮变量：{{i}}、{{r}}、{{n}}。
- 支持轮换输入图、固定参考图多选和纯文字批量生成。
- 支持图片、视频、音频和文本节点组成多步骤处理链。
- 支持停止、失败汇总、已完成结果保留和后续轮次继续执行。
- 结果按步骤和轮次自动布局，减少节点重叠和错误连线。

### 商品卖点图

- 商品参考图每轮固定复用。
- 第 N 轮只发送第 N 条卖点，不让模型自行挑选整份清单。
- 默认按顺序执行，适合慢速图片编辑渠道。
- 可批量生成材质、功能、场景和细节卖点图。

### 多模型渠道

支持图片、视频、音频和纯文本模型，并适配 DeepKey、ToAPIs、Apilio、APIMart、RunningHub、ComfyUI、ModelScope 和 MiniMax 等渠道。

- 图片：GPT Image、Grok Imagine、Flux、Nano Banana、Qwen Image Edit。
- 视频：Seedance、Kling、Grok Imagine Video。
- 音频：MiniMax TTS、Music。
- 工作流：RunningHub、ComfyUI、ModelScope。

渠道适配包含上传、异步提交、任务轮询、代理、超时、错误透传和结果解析。

### 参考图与视觉工具

- 支持显式 @ 引用、隐式参考开关、固定参考图和轮换素材。
- 直接编辑已有图片时保留主体图片作为主参考。
- 保存 referenceNodeIds、referenceLabels、媒体存储键和 IMG- 固定索引。
- 支持 RunningHub AI 超分、扩图、遮罩编辑、矢量化、视频抽帧、首尾帧、视角调整和 AI 快捷操作。
- 批量图片组支持单张重试、下载、删除、设为主图和创建独立副本。

### 成本、统计和 Agent

- 模型价格统一显示为人民币，支持汇率、充值比例、自定义覆盖和价格抓取。
- 支持复制完整模型 ID，并明确显示价格待核对状态。
- API 统计显示调用量、成功率、平均耗时、失败数和最近请求。
- 本地 Agent 支持 Codex / Claude Code、模型选择、推理强度和权限审批。
- Agent 可保存画布、节点媒体、渠道配置、API 统计和对话记录。

### 提示词库

- 支持公开来源、分类、标签、关键词搜索、封面预览、复制和插入画布。
- 包含 GPT Image 2、Nano Banana 和 Freestylefly GPT Image 2 公开模板。

## 🧭 典型流程

### 模特换装

1. 将模特图设置为固定参考图。
2. 将多张服装图作为循环输入。
3. 在右侧连接图片编辑步骤。
4. 运行循环，逐轮使用一套服装，同时固定保留模特主体。

### 同图多提示词

1. 连接一张输入图。
2. 粘贴编号提示词清单。
3. 设置生成轮数和串行或并发模式。
4. 每轮复用同一张图，但使用对应提示词。

### 商品卖点图

1. 选择卖点图模式。
2. 添加商品参考图。
3. 输入编号卖点。
4. 每轮只处理一个卖点，保持商品主体一致。

## 📦 安装

### Windows

在项目根目录双击：

    start-infinite-canvas.cmd

默认地址：

    http://localhost:3000

### 本地开发

    git clone https://github.com/moyuan10086/loopcanvas-ai.git
    cd loopcanvas-ai
    cd web
    bun install
    bun run dev

### Docker

    git clone https://github.com/moyuan10086/loopcanvas-ai.git
    cd loopcanvas-ai
    docker compose up -d

首次打开后，在配置中心填写自己的 Base URL 和 API Key。

## 💾 数据与隐私

- API Key 和 Base URL 默认保存在浏览器本地。
- 连接 Canvas Agent 后，画布、节点媒体、渠道配置和 API 统计保存到 ~/.infinite-canvas/。
- IndexedDB 作为离线缓存，“我的素材”仍主要保存在浏览器。
- API 统计不保存完整提示词、上传内容或 API Key。
- 前端会直接请求用户配置的第三方 AI 接口，请确认渠道和部署环境可信。

## 📚 文档

- [完整项目说明](README.md)
- [功能介绍](docs/content/docs/overview/features.mdx)
- [快速开始](docs/content/docs/overview/quick-start.mdx)
- [画布节点操作手册](docs/content/docs/canvas/canvas-node-manual.mdx)
- [本地 Canvas Agent](canvas-agent/README.md)
- [项目记录](docs/PROJECT_RECORD.md)
- [待办事项](docs/content/docs/progress/todo.mdx)

## 🤝 社区

欢迎围绕循环节点、多模型接入和视觉生产流程提交 Issue、改进建议或 Pull Request。
