import { ImageOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

export function PromptImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
    const sources = useMemo(() => imageSources(src), [src]);
    const [index, setIndex] = useState(0);

    useEffect(() => setIndex(0), [src]);

    if (!sources[index]) {
        return (
            <div className={cn("grid aspect-[4/3] w-full place-items-center bg-stone-100 text-stone-300 dark:bg-stone-900 dark:text-stone-700", className)}>
                <ImageOff className="size-7" />
            </div>
        );
    }
    return <img src={sources[index]} alt={alt} className={className} loading="lazy" referrerPolicy="no-referrer" onError={() => setIndex((current) => current + 1)} />;
}

function imageSources(src: string) {
    if (!src) return [];
    const proxy = /^https?:\/\//i.test(src) ? `https://wsrv.nl/?url=${encodeURIComponent(src)}&output=webp` : "";
    return /pbs\.twimg\.com/i.test(src) ? [proxy, src].filter(Boolean) : [src];
}
