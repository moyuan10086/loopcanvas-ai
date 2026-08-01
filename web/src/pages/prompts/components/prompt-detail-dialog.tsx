import { Copy, FolderPlus } from "lucide-react";
import { Button, Modal, Space, Tag } from "antd";

import { PromptImage } from "@/components/prompts/prompt-image";
import { formatPromptDate, type Prompt } from "@/services/api/prompts";

export function PromptDetailDialog({ prompt, onClose, onCopy, onSaveAsset }: { prompt: Prompt | null; onClose: () => void; onCopy: (prompt: string) => void; onSaveAsset?: (prompt: Prompt) => void }) {
    return (
        <>
            <Modal title={prompt?.title} open={Boolean(prompt)} onCancel={onClose} footer={null} width={860}>
                {prompt ? (
                    <>
                        <div className="grid gap-5 md:grid-cols-[300px_minmax(0,1fr)]">
                            <div className="space-y-3">
                                <PromptImage src={prompt.coverUrl} alt={prompt.title} className="aspect-[4/3] w-full rounded-lg object-cover" />
                                {prompt.preview ? <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-100 p-3 text-xs leading-5 text-stone-600 dark:bg-stone-900 dark:text-stone-300">{prompt.preview}</pre> : null}
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap gap-1.5">
                                    {prompt.tags.map((tag) => (
                                        <Tag key={tag} className="m-0">
                                            {tag}
                                        </Tag>
                                    ))}
                                </div>
                                <div className="mt-4 text-xs font-medium text-stone-500 dark:text-stone-400">上游原始提示词</div>
                                <p className="mt-1 whitespace-pre-wrap text-sm leading-7 text-stone-800 dark:text-stone-300">{prompt.prompt}</p>
                                {prompt.note ? (
                                    <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm leading-6 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
                                        <div className="mb-1 text-xs font-medium text-stone-500 dark:text-stone-400">来源说明</div>
                                        <p className="m-0 whitespace-pre-wrap">{prompt.note}</p>
                                    </div>
                                ) : null}
                                <div className="mt-4 text-xs text-stone-500 dark:text-stone-400">
                                    创建：{formatPromptDate(prompt.createdAt)} · 更新：{formatPromptDate(prompt.updatedAt)}
                                </div>
                                <Space wrap className="mt-5">
                                    <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(prompt.prompt)}>
                                        复制提示词
                                    </Button>
                                    {onSaveAsset ? (
                                        <Button icon={<FolderPlus className="size-4" />} onClick={() => onSaveAsset(prompt)}>
                                            加入我的资产
                                        </Button>
                                    ) : null}
                                </Space>
                            </div>
                        </div>
                    </>
                ) : null}
            </Modal>
        </>
    );
}
