import { ArrowRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { App, Button, Image, Tag } from "antd";
import { useNavigate } from "react-router-dom";

import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { navigationTools } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";

function Highlighter({ action, color, children }: { action: "highlight" | "underline"; color: string; children: ReactNode }) {
    return (
        <span className="relative inline-block px-1">
            {action === "highlight" ? (
                <span className="absolute inset-x-0 bottom-0 top-1 rounded-sm opacity-20" style={{ backgroundColor: color }} />
            ) : (
                <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full opacity-55" style={{ backgroundColor: color }} />
            )}
            <span className="relative font-medium text-stone-800 dark:text-stone-200">{children}</span>
        </span>
    );
}

export default function IndexPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [primaryTool] = navigationTools;
    const [promptShowcase, setPromptShowcase] = useState<Prompt[]>([]);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);

    useEffect(() => {
        void fetchPrompts({ pageSize: 12 })
            .then((data) => setPromptShowcase(data.items))
            .catch((error) => message.error(error instanceof Error ? error.message : "获取提示词失败"));
    }, [message]);

    return (
        <main className="relative h-full overflow-y-auto bg-background bg-[radial-gradient(rgba(120,113,108,.18)_1px,transparent_1px)] [background-size:24px_24px] text-stone-950 dark:bg-[radial-gradient(rgba(245,245,244,.12)_1px,transparent_1px)] dark:text-stone-100">
            <section className="relative mx-auto max-w-7xl overflow-hidden border-x border-stone-200/60 px-6 dark:border-stone-800/80 sm:px-8">
                <div className="relative flex min-h-[clamp(520px,72vh,680px)] flex-col items-center justify-center pb-8 pt-10 text-center">
                    <div className="mb-6 h-px w-16 bg-stone-300 shadow-[0_0_16px_rgba(120,113,108,.22)] dark:bg-stone-700" />
                    <h1 className="ai-title-aurora max-w-5xl text-balance text-5xl font-semibold tracking-normal sm:text-6xl lg:text-7xl">无限画布</h1>
                    <p className="mt-7 max-w-3xl text-balance text-base leading-8 text-stone-500 dark:text-stone-400 sm:text-lg">
                        在
                        <Highlighter action="underline" color="#FF9800">
                            无限画布
                        </Highlighter>
                        中生成、连接和重组
                        <Highlighter action="highlight" color="#87CEFA">
                            图片、文字与图形
                        </Highlighter>
                        ，让创作从单次生成变成连续推演。
                    </p>
                    <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                        <Button type="primary" size="large" className="!h-11 !rounded-lg !px-5 !shadow-[0_1px_2px_rgba(0,0,0,.12),0_8px_24px_rgba(0,0,0,.08)]" onClick={() => navigate(`/${primaryTool.slug}`)} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            开始使用
                        </Button>
                        <Button size="large" className="!h-11 !rounded-lg !border-stone-300 !bg-white/80 !px-5 !shadow-[0_1px_2px_rgba(0,0,0,.04)] backdrop-blur dark:!border-stone-700 dark:!bg-stone-900/80" onClick={() => navigate("/canvas")}>
                            打开画布
                        </Button>
                    </div>
                </div>

                <section className="relative mx-auto mb-20 max-w-6xl border-t border-stone-200/80 pt-12 dark:border-stone-800">
                    <div className="mb-8 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-start">
                        <div />
                        <div className="max-w-2xl text-center">
                            <h2 className="text-3xl font-semibold tracking-normal text-stone-950 dark:text-stone-100">沉淀每一次好结果</h2>
                            <p className="mt-3 text-base leading-7 text-stone-500 dark:text-stone-400">收藏稳定出图的提示词、参考风格和结果图片，让下一次创作从已有经验开始。</p>
                        </div>
                        <Button type="link" onClick={() => navigate("/prompts")} className="justify-self-center md:justify-self-end" icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            查看提示词库
                        </Button>
                    </div>
                    <div className="grid auto-rows-[210px] gap-4 md:grid-cols-4">
                        {promptShowcase.map((item, index) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                    setPreviewIndex(index);
                                    setPreviewOpen(true);
                                }}
                                className={cn(
                                    "group relative cursor-pointer overflow-hidden rounded-xl border border-stone-200/90 bg-stone-100 text-left shadow-[0_1px_2px_rgba(0,0,0,.04),0_10px_30px_rgba(0,0,0,.035)] transition-[border-color,box-shadow] duration-200 hover:border-stone-300 hover:shadow-[0_2px_4px_rgba(0,0,0,.05),0_16px_40px_rgba(0,0,0,.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500/25 focus-visible:ring-offset-2 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700 dark:focus-visible:ring-stone-400/30 dark:focus-visible:ring-offset-stone-950",
                                    index === 0 && "md:col-span-2 md:row-span-2",
                                    index === 3 && "md:col-span-2",
                                )}
                            >
                                <img src={item.coverUrl} alt={item.title} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent p-4 text-white">
                                    <div className="mb-2 flex flex-wrap gap-1.5">
                                        {item.tags.slice(0, 2).map((tag) => (
                                            <Tag key={tag} variant="filled" className="m-0 bg-white/15 text-[11px] text-white backdrop-blur">
                                                {tag}
                                            </Tag>
                                        ))}
                                    </div>
                                    <h3 className="text-sm font-medium">{item.title}</h3>
                                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/75">{item.prompt}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                </section>
            </section>
            <Image.PreviewGroup
                preview={{
                    open: previewOpen,
                    current: previewIndex,
                    onOpenChange: setPreviewOpen,
                    onChange: setPreviewIndex,
                }}
            >
                <div className="hidden">
                    {promptShowcase.map((item) => (
                        <Image key={item.id} src={item.coverUrl} alt={item.title} />
                    ))}
                </div>
            </Image.PreviewGroup>
        </main>
    );
}
