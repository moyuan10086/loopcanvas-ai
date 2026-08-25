import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";

const AssetsPage = lazy(() => import("@/pages/assets"));
const ApiUsagePage = lazy(() => import("@/pages/api-usage"));
const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const ConfigPage = lazy(() => import("@/pages/config"));
const HomePage = lazy(() => import("@/pages/home"));
const ImagePage = lazy(() => import("@/pages/image"));
const NotFound = lazy(() => import("@/pages/not-found"));
const PromptsPage = lazy(() => import("@/pages/prompts"));
const VideoPage = lazy(() => import("@/pages/video"));

function RouteFallback() {
    return (
        <div className="grid h-full min-h-0 place-items-center bg-background" role="status" aria-label="页面加载中">
            <span className="size-5 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground/70" />
        </div>
    );
}

function lazyPage(element: ReactNode) {
    return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: lazyPage(<HomePage />) },
            { path: "/image", element: lazyPage(<ImagePage />) },
            { path: "/video", element: lazyPage(<VideoPage />) },
            { path: "/assets", element: lazyPage(<AssetsPage />) },
            { path: "/api-usage", element: lazyPage(<ApiUsagePage />) },
            { path: "/prompts", element: lazyPage(<PromptsPage />) },
            { path: "/canvas", element: lazyPage(<CanvasPage />) },
            { path: "/canvas/:id", element: lazyPage(<CanvasProjectPage />) },
            { path: "/config", element: lazyPage(<ConfigPage />) },
        ],
    },
    { path: "*", element: lazyPage(<NotFound />) },
]);
