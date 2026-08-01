import { useEffect, useMemo, useState } from "react";
import { Button, Empty, Spin } from "antd";
import { ArrowUpRight, CircleCheck, CircleX } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { canvasThemes } from "@/lib/canvas-theme";
import { API_USAGE_UPDATED_EVENT, listApiUsageLogs, type ApiUsageLog } from "@/services/api-usage";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasApiUsagePanel({ left }: { left: number | string }) {
    const navigate = useNavigate();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [logs, setLogs] = useState<ApiUsageLog[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        void listApiUsageLogs()
            .then((items) => {
                if (active) setLogs(items);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        const onUpdate = (event: Event) => {
            const log = (event as CustomEvent<ApiUsageLog>).detail;
            if (!log) {
                void listApiUsageLogs().then((items) => active && setLogs(items));
                return;
            }
            setLogs((current) => [log, ...current.filter((item) => item.id !== log.id)]);
        };
        window.addEventListener(API_USAGE_UPDATED_EVENT, onUpdate);
        return () => {
            active = false;
            window.removeEventListener(API_USAGE_UPDATED_EVENT, onUpdate);
        };
    }, []);

    const today = useMemo(() => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        return logs.filter((log) => log.startedAt >= start.getTime());
    }, [logs]);
    const summary = useMemo(() => {
        const success = today.filter((log) => log.status === "success").length;
        const errors = today.length - success;
        const average = today.length ? today.reduce((total, log) => total + log.durationMs, 0) / today.length : 0;
        return { total: today.length, successRate: today.length ? `${Math.round((success / today.length) * 100)}%` : "-", average, errors };
    }, [today]);

    return (
        <div
            className="thin-scrollbar pointer-events-auto absolute bottom-[72px] z-30 max-h-[420px] w-[min(336px,calc(100vw-32px))] -translate-x-1/2 overflow-y-auto rounded-lg border p-3 shadow-xl backdrop-blur"
            style={{ left: typeof left === "number" ? `clamp(168px, ${left}px, calc(100% - 168px))` : left, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
        >
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="text-sm font-medium">API 统计</div>
                    <div className="mt-0.5 text-[10px] opacity-45">今天的生成请求</div>
                </div>
                <Button size="small" type="text" icon={<ArrowUpRight className="size-3.5" />} onClick={() => navigate("/api-usage")}>全部记录</Button>
            </div>

            <div className="mt-3 grid grid-cols-4 divide-x" style={{ borderColor: theme.toolbar.border }}>
                <UsageMetric label="调用" value={String(summary.total)} />
                <UsageMetric label="成功率" value={summary.successRate} />
                <UsageMetric label="平均" value={formatDuration(summary.average)} />
                <UsageMetric label="失败" value={String(summary.errors)} danger={summary.errors > 0} />
            </div>

            <div className="mt-3 border-t pt-2.5" style={{ borderColor: theme.toolbar.border }}>
                <div className="mb-1.5 text-[10px] font-medium opacity-45">最近调用</div>
                {loading ? (
                    <div className="grid h-24 place-items-center"><Spin size="small" /></div>
                ) : logs.length ? (
                    <div className="space-y-0.5">
                        {logs.slice(0, 5).map((log) => (
                            <div key={log.id} className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-1.5" style={{ background: theme.toolbar.itemHover }}>
                                {log.status === "success" ? <CircleCheck className="size-3.5 text-emerald-500" /> : <CircleX className="size-3.5 text-red-500" />}
                                <div className="min-w-0">
                                    <div className="truncate text-[11px] font-medium" title={`${log.channelName} · ${log.model}`}>{log.operation} · {log.channelName}</div>
                                    <div className="truncate text-[10px] opacity-45" title={log.model}>{log.model}</div>
                                </div>
                                <div className="text-right text-[10px] tabular-nums opacity-55">
                                    <div>{formatDuration(log.durationMs)}</div>
                                    <div>{formatTime(log.startedAt)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无调用记录" className="!my-4 [&_.ant-empty-description]:!text-xs" />
                )}
            </div>
        </div>
    );
}

function UsageMetric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
    return (
        <div className="min-w-0 px-2 first:pl-0 last:pr-0">
            <div className="truncate text-[10px] opacity-45">{label}</div>
            <div className={`mt-0.5 truncate text-sm font-semibold tabular-nums ${danger ? "text-red-500" : ""}`}>{value}</div>
        </div>
    );
}

function formatDuration(milliseconds: number) {
    if (!milliseconds) return "-";
    if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
    if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
    return `${(milliseconds / 60_000).toFixed(1)}m`;
}

function formatTime(value: number) {
    return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}
