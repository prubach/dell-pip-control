export function parseDisplays(output) {
    const displays = [];
    const displayPattern = /^Display\s+(\d+)\s*$/gm;
    const starts = [...output.matchAll(displayPattern)];

    for (let i = 0; i < starts.length; i++) {
        const start = starts[i].index;
        const end = starts[i + 1]?.index ?? output.length;
        const section = output.slice(start, end);
        const model = section.match(/^\s*Model:\s*(.+?)\s*$/im)?.[1];

        if (model)
            displays.push({number: Number(starts[i][1]), model});
    }

    return displays;
}
