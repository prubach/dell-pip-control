export function parseXrandrQuery(output) {
    const displays = [];
    let currentDisplay = null;

    for (const line of output.split('\n')) {
        const match = line.match(/^(\S+)\s+(connected|disconnected)\b(.*)$/);
        if (match) {
            currentDisplay = null;
            const [, name, status, details] = match;
            if (status !== 'connected')
                continue;

            const geometryMatch = details.match(/\b(\d+)x(\d+)([+-]\d+)([+-]\d+)\b/);
            const geometry = geometryMatch
                ? {
                    width: Number(geometryMatch[1]),
                    height: Number(geometryMatch[2]),
                    x: Number(geometryMatch[3]),
                    y: Number(geometryMatch[4]),
                }
                : null;
            currentDisplay = {
                name,
                primary: /\bprimary\b/.test(details),
                active: geometry !== null,
                geometry,
                modes: [],
            };
            displays.push(currentDisplay);
            continue;
        }

        const modeMatch = currentDisplay && line.match(/^\s+(\d+x\d+)\s+(.+)$/);
        if (modeMatch) {
            currentDisplay.modes.push({
                resolution: modeMatch[1],
                preferred: modeMatch[2].includes('+'),
            });
        }
    }

    return displays;
}

export function buildDisplayToggleCommand(display, displays) {
    if (display.active)
        return ['xrandr', '--output', display.name, '--off'];

    const activeDisplays = displays
        .filter(candidate => candidate.active && candidate.name !== display.name)
        .sort((a, b) =>
            (b.geometry.x + b.geometry.width) - (a.geometry.x + a.geometry.width));
    const anchor = activeDisplays[0];
    const command = ['xrandr', '--output', display.name, '--auto'];
    if (anchor)
        command.push('--right-of', anchor.name);

    return command;
}

export function buildExtendCommand(displays) {
    const connected = displays.filter(display => display.name);
    if (connected.length === 0)
        return null;

    const primary = connected.find(display => display.primary) ?? connected[0];
    const ordered = [primary, ...connected.filter(display => display !== primary)];
    const command = ['xrandr'];

    for (let i = 0; i < ordered.length; i++) {
        command.push('--output', ordered[i].name, '--auto');
        if (i > 0)
            command.push('--right-of', ordered[i - 1].name);
    }

    return command;
}

export function buildMirrorCommand(displays) {
    const connected = displays.filter(display => display.name && display.modes.length > 0);
    if (connected.length < 2)
        return null;

    const primary = connected.find(display => display.primary) ?? connected[0];
    const commonModes = primary.modes
        .filter(mode => connected.every(display =>
            display.modes.some(candidate => candidate.resolution === mode.resolution)))
        .sort((a, b) => Number(b.preferred) - Number(a.preferred));
    if (commonModes.length === 0)
        return null;

    const resolution = commonModes[0].resolution;
    const command = ['xrandr', '--output', primary.name, '--mode', resolution];
    for (const display of connected) {
        if (display !== primary)
            command.push('--output', display.name, '--mode', resolution, '--same-as', primary.name);
    }

    return command;
}
