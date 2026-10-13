export function parseDisplays(output) {
    const displays = [];
    const headerPattern = /^(?:Display\s+(\d+)|(Invalid display|Phantom display))\s*$/gm;
    const starts = [...output.matchAll(headerPattern)];

    for (let i = 0; i < starts.length; i++) {
        const start = starts[i].index;
        const end = starts[i + 1]?.index ?? output.length;
        const section = output.slice(start, end);
        const model = section.match(/^\s*Model:\s*(.+?)\s*$/im)?.[1];
        const connector = section.match(/^\s*DRM_connector:\s*(\S+)/im)?.[1] ?? null;

        // Invalid/phantom displays are connected but have no usable DDC/CI display number.
        if (model) {
            displays.push({
                number: starts[i][1] !== undefined ? Number(starts[i][1]) : null,
                model,
                connector,
                supported: starts[i][1] !== undefined,
            });
        }
    }

    return displays;
}
