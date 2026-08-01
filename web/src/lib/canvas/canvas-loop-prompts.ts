export function parseNumberedLoopPrompts(value: string) {
    const normalized = value.replace(/\r\n?/g, "\n").trim();
    if (!normalized) return [];
    const matches = Array.from(normalized.matchAll(/(?:^|\n)\s*(?:\d+\s*[.、．)]|[-*•])\s*/g));
    if (matches.length < 2) return [];
    return matches
        .map((match, index) => {
            const start = (match.index || 0) + match[0].length;
            const end = index + 1 < matches.length ? matches[index + 1].index : normalized.length;
            return normalized.slice(start, end).trim();
        })
        .filter(Boolean);
}
