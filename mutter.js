import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS_NAME = 'org.gnome.Mutter.DisplayConfig';
const OBJECT_PATH = '/org/gnome/Mutter/DisplayConfig';

function callMutter(method, parameters, replyType) {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(
            BUS_NAME, OBJECT_PATH, BUS_NAME, method, parameters,
            replyType, Gio.DBusCallFlags.NONE, -1, null,
            (source, res) => {
                try {
                    resolve(source.call_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

export async function getMutterState() {
    const reply = await callMutter('GetCurrentState', null, new GLib.VariantType('(ua((ssss)a(siiddada{sv})a{sv})a(iiduba(ssss)a{sv})a{sv})'));
    const [serial, monitors, logicalMonitors] = reply.deepUnpack();

    const parsedMonitors = monitors.map(monitor => {
        const [[connector], modes] = monitor;
        const parsedModes = modes.map(mode => {
            const [id, width, height, , scale, , props] = mode;
            return {
                id,
                width,
                height,
                scale,
                current: !!props['is-current']?.deepUnpack(),
                preferred: !!props['is-preferred']?.deepUnpack(),
            };
        });
        return {connector, modes: parsedModes};
    });

    const parsedLogical = logicalMonitors.map(([x, y, scale, transform, primary, specs]) => ({
        x, y, scale, transform, primary,
        connectors: specs.map(spec => spec[0]),
    }));

    return {serial, monitors: parsedMonitors, logicalMonitors: parsedLogical};
}

export function listMutterDisplays(state) {
    return state.monitors.map(monitor => {
        const logical = state.logicalMonitors.find(l => l.connectors.includes(monitor.connector));
        return {name: monitor.connector, active: !!logical, primary: !!logical?.primary};
    });
}

function monitorModeId(monitor, mode) {
    return {connector: monitor.connector, modeId: mode.id};
}

// Returns the logical monitor list to pass to ApplyMonitorsConfig, or null if invalid.
export function buildToggledLayout(state, connector) {
    const target = state.monitors.find(m => m.connector === connector);
    if (!target)
        return null;

    const toEntry = (logical, monitors) => ({...logical, monitors});
    const layout = [];
    let wasActive = false;

    for (const logical of state.logicalMonitors) {
        const members = logical.connectors
            .filter(name => {
                if (name === connector) {
                    wasActive = true;
                    return false;
                }
                return true;
            })
            .map(name => {
                const monitor = state.monitors.find(m => m.connector === name);
                const mode = monitor.modes.find(m => m.current) ?? monitor.modes[0];
                return monitorModeId(monitor, mode);
            });
        if (members.length > 0)
            layout.push(toEntry(logical, members));
    }

    if (wasActive) {
        if (layout.length === 0)
            return null;
        if (!layout.some(l => l.primary))
            layout[0].primary = true;
        // Mutter requires the layout to start at 0,0
        const minX = Math.min(...layout.map(l => l.x));
        const minY = Math.min(...layout.map(l => l.y));
        for (const l of layout) {
            l.x -= minX;
            l.y -= minY;
        }
        return layout;
    }

    const mode = target.modes.find(m => m.preferred) ?? target.modes[0];
    if (!mode)
        return null;
    const rightEdge = state.logicalMonitors.reduce((max, l) => {
        const monitor = state.monitors.find(m => m.connector === l.connectors[0]);
        const current = monitor?.modes.find(m => m.current);
        const width = current ? Math.round(current.width / l.scale) : 0;
        return Math.max(max, l.x + width);
    }, 0);
    layout.push({
        x: rightEdge, y: 0, scale: mode.scale, transform: 0,
        primary: layout.length === 0,
        monitors: [monitorModeId(target, mode)],
    });
    return layout;
}

async function applyLayout(state, layout) {
    const logicalMonitors = layout.map(l => [
        l.x, l.y, l.scale, l.transform, l.primary,
        l.monitors.map(m => [m.connector, m.modeId, {}]),
    ]);
    const params = new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [
        state.serial, 1, logicalMonitors, {},
    ]);
    await callMutter('ApplyMonitorsConfig', params, null);
}

function orderMonitors(state, firstConnector) {
    const first = state.monitors.find(m => m.connector === firstConnector);
    const primary = state.logicalMonitors.find(l => l.primary);
    const lead = first ?? state.monitors.find(m => m.connector === primary?.connectors[0]) ?? state.monitors[0];
    return lead ? [lead, ...state.monitors.filter(m => m !== lead)] : [];
}

// Side-by-side layout, first monitor leftmost and primary, every monitor at its preferred mode.
export function buildExtendLayout(state, firstConnector = null) {
    const ordered = orderMonitors(state, firstConnector)
        .map(monitor => ({monitor, mode: monitor.modes.find(m => m.preferred) ?? monitor.modes[0]}))
        .filter(entry => entry.mode);
    if (ordered.length === 0)
        return null;

    let x = 0;
    return ordered.map(({monitor, mode}, i) => {
        const entry = {
            x, y: 0, scale: mode.scale, transform: 0, primary: i === 0,
            monitors: [monitorModeId(monitor, mode)],
        };
        x += Math.round(mode.width / mode.scale);
        return entry;
    });
}

// One logical monitor containing all monitors at the best resolution they share.
export function buildMirrorLayout(state, firstConnector = null) {
    const ordered = orderMonitors(state, firstConnector);
    if (ordered.length < 2)
        return null;

    const key = m => `${m.width}x${m.height}`;
    const common = ordered[0].modes
        .filter(mode => ordered.every(mon => mon.modes.some(m => key(m) === key(mode))))
        .sort((a, b) => b.width * b.height - a.width * a.height);
    if (common.length === 0)
        return null;

    const target = key(common[0]);
    return [{
        x: 0, y: 0, scale: common[0].scale, transform: 0, primary: true,
        monitors: ordered.map(mon => monitorModeId(mon, mon.modes.find(m => key(m) === target))),
    }];
}

export async function toggleMutterDisplay(connector) {
    const state = await getMutterState();
    const layout = buildToggledLayout(state, connector);
    if (!layout)
        throw new Error(`Cannot toggle ${connector}: it is the only active display or is unknown`);
    await applyLayout(state, layout);
}

export async function extendMutterDisplays(firstConnector = null) {
    const state = await getMutterState();
    const layout = buildExtendLayout(state, firstConnector);
    if (!layout)
        throw new Error('No displays available to extend');
    await applyLayout(state, layout);
}

export async function mirrorMutterDisplays(firstConnector = null) {
    const state = await getMutterState();
    const layout = buildMirrorLayout(state, firstConnector);
    if (!layout)
        throw new Error('No common resolution is available for mirroring');
    await applyLayout(state, layout);
}

export function preferredModeKey(monitor) {
    const mode = monitor?.modes.find(m => m.preferred) ?? monitor?.modes[0];
    return mode ? `${mode.width}x${mode.height}` : null;
}

export function snapshotPreferredModes(state) {
    return new Map(state.monitors.map(m => [m.connector, preferredModeKey(m)]));
}

// Resolves with the connector whose preferred mode changed (e.g. after PBP is switched), or null on timeout.
export async function waitForModeChange(previous, timeoutMs = 10000) {
    const deadline = GLib.get_monotonic_time() / 1000 + timeoutMs;
    while (GLib.get_monotonic_time() / 1000 < deadline) {
        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        }));
        const state = await getMutterState();
        const changed = state.monitors.find(m => previous.get(m.connector) !== preferredModeKey(m));
        if (changed)
            return changed.connector;
    }
    return null;
}
