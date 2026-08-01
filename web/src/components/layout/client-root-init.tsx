import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { useConfigStore } from "@/stores/use-config-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const importChannelCredentials = useConfigStore((state) => state.importChannelCredentials);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const result = importChannelCredentials({ baseUrl, apiKey });
        openConfigDialog(false, "channels");
        if (result.status === "created") {
            message.success(`已新增渠道“${result.channelName}”，原有渠道未改动`);
        } else if (result.status === "updated") {
            message.success(`已更新渠道“${result.channelName}”的连接配置`);
        } else if (result.status === "missing-base-url") {
            message.error("导入链接缺少 Base URL，未修改任何渠道");
        } else {
            message.error("导入链接中的 Base URL 无效，未修改任何渠道");
        }
    }, [importChannelCredentials, message, openConfigDialog]);

    return <>{children}</>;
}
