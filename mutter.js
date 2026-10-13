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

export async function toggleMutterDisplay(connector) {
    const state = await getMutterState();
    const layout = buildToggledLayout(state, connector);
    if (!layout)
        throw new Error(`Cannot toggle ${connector}: it is the only active display or is unknown`);

    const logicalMonitors = layout.map(l => [
        l.x, l.y, l.scale, l.transform, l.primary,
        l.monitors.map(m => [m.connector, m.modeId, {}]),
    ]);
    const params = new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [
        state.serial, 1, logicalMonitors, {},
    ]);
    await callMutter('ApplyMonitorsConfig', params, null);
}
