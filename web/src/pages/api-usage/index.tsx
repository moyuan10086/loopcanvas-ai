import { useEffect, useMemo, useState } from "react";
import { App, Button, DatePicker, Empty, Input, Select, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { Dayjs } from "dayjs";
import { RefreshCw, Search, Trash2 } from "lucide-react";

import { API_USAGE_UPDATED_EVENT, clearApiUsageLogs, listApiUsageLogs, type ApiUsageKind, type ApiUsageLog, type ApiUsageStatus } from "@/services/api-usage";

const { RangePicker } = DatePicker;

const kindLabels: Record<ApiUsageKind, string> = {
    image: "图片",
    video: "视频",
    audio: "音频",
    text: "文本",
};

export default function ApiUsagePage() {
    const { message, modal } = App.useApp();
    const [logs, setLogs] = useState<ApiUsageLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [keyword, setKeyword] = useState("");
    const [channelId, setChannelId] = useState("all");
    const [kind, setKind] = useState<ApiUsageKind | "all">("all");
    const [status, setStatus] = useState<ApiUsageStatus | "all">("all");
    const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);

    const refresh = async () => {
        setLoading(true);
        try {
            setLogs(await listApiUsageLogs());
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void refresh();
        const onUpdate = (event: Event) => {
            const log = (event as CustomEvent<ApiUsageLog>).detail;
            if (!log) {
                void refresh();
                return;
            }
            setLogs((current) => [log, ...current.filter((item) => item.id !== log.id)]);
        };
        window.addEventListener(API_USAGE_UPDATED_EVENT, onUpdate);
        return () => window.removeEventListener(API_USAGE_UPDATED_EVENT, onUpdate);
    }, []);

    const channels = useMemo(() => {
        const map = new Map<string, string>();
        logs.forEach((log) => map.set(log.channelId, log.channelName));
        return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    }, [logs]);

    const filteredLogs = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        const start = range?.[0]?.startOf("day").valueOf();
        const end = range?.[1]?.endOf("day").valueOf();
        return logs.filter((log) => {
            if (channelId !== "all" && log.channelId !== channelId) return false;
            if (kind !== "all" && log.kind !== kind) return false;
            if (status !== "all" && log.status !== status) return false;
            if (start && log.startedAt < start) return false;
            if (end && log.startedAt > end) return false;
            if (!query) return true;
            return `${log.channelName} ${log.model} ${log.operation} ${log.endpoint} ${log.error || ""}`.toLowerCase().includes(query);
        });
    }, [channelId, kind, keyword, logs, range, status]);

    const summary = useMemo(() => {
        const success = filteredLogs.filter((log) => log.status === "success").length;
        const errors = filteredLogs.length - success;
        const averageDuration = filteredLogs.length ? filteredLogs.reduce((total, log) => total + log.durationMs, 0) / filteredLogs.length : 0;
        return { total: filteredLogs.length, success, errors, averageDuration };
    }, [filteredLogs]);

    const clearLogs = () => {
        modal.confirm({
            title: "清空 API 调用记录？",
            content: "此操作会清空浏览器和本地 Agent 中的统计记录，不影响生成结果和渠道配置。",
            okText: "清空",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                await clearApiUsageLogs();
                setLogs([]);
                message.success("API 调用记录已清空");
            },
        });
    };

    return (
        <main className="h-full overflow-y-auto bg-background">
            <div className="mx-auto flex min-h-full max-w-[1500px] flex-col px-5 py-5 lg:px-7">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">API 调用统计</h1>
                        <p className="mt-1 text-sm text-stone-500">记录生成请求的渠道、模型、耗时和状态，并同步保存到本地 Agent。</p>
                    </div>
                    <div className="flex gap-2">
                        <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void refresh()}>
                            刷新
                        </Button>
                        <Button danger icon={<Trash2 className="size-4" />} disabled={!logs.length} onClick={clearLogs}>
                            清空
                        </Button>
                    </div>
                </div>

                <section className="grid grid-cols-2 divide-x divide-stone-200 border-y border-stone-200 py-3 md:grid-cols-4 dark:divide-stone-800 dark:border-stone-800">
                    <Metric label="调用次数" value={String(summary.total)} />
                    <Metric label="成功率" value={summary.total ? `${Math.round((summary.success / summary.total) * 100)}%` : "-"} />
                    <Metric label="平均耗时" value={formatDuration(summary.averageDuration)} />
                    <Metric label="失败" value={String(summary.errors)} danger={summary.errors > 0} />
                </section>

                <section className="mt-4 flex flex-wrap items-center gap-2 border-b border-stone-200 pb-4 dark:border-stone-800">
                    <Input allowClear prefix={<Search className="size-4 text-stone-400" />} placeholder="搜索渠道、模型、操作或错误" value={keyword} onChange={(event) => setKeyword(event.target.value)} className="w-full sm:w-72" />
                    <RangePicker value={range} onChange={(value) => setRange(value ? [value[0], value[1]] : null)} className="w-full sm:w-auto" />
                    <Select value={channelId} onChange={setChannelId} className="w-40" options={[{ value: "all", label: "全部渠道" }, ...channels]} />
                    <Select
                        value={kind}
                        onChange={setKind}
                        className="w-32"
                        options={[{ value: "all", label: "全部类型" }, ...Object.entries(kindLabels).map(([value, label]) => ({ value, label }))]}
                    />
                    <Select value={status} onChange={setStatus} className="w-32" options={[{ value: "all", label: "全部状态" }, { value: "success", label: "成功" }, { value: "error", label: "失败" }]} />
                </section>

                <section className="mt-4 min-h-0 flex-1">
                    <Table<ApiUsageLog>
                        rowKey="id"
                        loading={loading}
                        dataSource={filteredLogs}
                        columns={columns}
                        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 API 调用记录" /> }}
                        pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: (total) => `共 ${total} 条` }}
                        scroll={{ x: 1180 }}
                        size="middle"
                    />
                </section>
            </div>
        </main>
    );
}

const columns: TableColumnsType<ApiUsageLog> = [
    { title: "时间", dataIndex: "startedAt", width: 170, render: (value: number) => new Date(value).toLocaleString("zh-CN", { hour12: false }) },
    { title: "渠道", dataIndex: "channelName", width: 130, ellipsis: true },
    { title: "类型", dataIndex: "kind", width: 80, render: (value: ApiUsageKind) => kindLabels[value] },
    { title: "操作", dataIndex: "operation", width: 120, ellipsis: true },
    { title: "模型", dataIndex: "model", width: 210, ellipsis: true },
    { title: "耗时", dataIndex: "durationMs", width: 100, render: (value: number) => formatDuration(value) },
    {
        title: "状态",
        dataIndex: "status",
        width: 90,
        render: (value: ApiUsageStatus) => <Tag color={value === "success" ? "green" : "red"}>{value === "success" ? "成功" : "失败"}</Tag>,
    },
    { title: "输入摘要", dataIndex: "input", width: 180, ellipsis: true },
    { title: "输出摘要", dataIndex: "output", width: 150, ellipsis: true, render: (value?: string) => value || "-" },
    { title: "API", dataIndex: "endpoint", width: 210, ellipsis: true, render: (value: string, row: ApiUsageLog) => <Typography.Text code ellipsis={{ tooltip: `${row.apiHost}${value}` }}>{row.apiHost}{value}</Typography.Text> },
    { title: "错误", dataIndex: "error", width: 220, ellipsis: true, render: (value?: string) => value ? <Typography.Text type="danger" ellipsis={{ tooltip: value }}>{value}</Typography.Text> : "-" },
];

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
    return (
        <div className="px-4 py-1 first:pl-0 md:px-6">
            <div className="text-xs text-stone-500">{label}</div>
            <div className={`mt-1 text-xl font-semibold ${danger ? "text-red-600 dark:text-red-400" : "text-stone-950 dark:text-stone-100"}`}>{value}</div>
        </div>
    );
}

function formatDuration(milliseconds: number) {
    if (!milliseconds) return "-";
    if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
    if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
    return `${(milliseconds / 60_000).toFixed(1)} min`;
}
