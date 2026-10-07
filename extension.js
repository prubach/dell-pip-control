import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {parseDisplays} from './ddcutil.js';
import {
    buildDisplayToggleCommand,
    buildExtendCommand,
    buildMirrorCommand,
    parseXrandrQuery,
} from './xrandr.js';

// Label -> VCP feature/value mapping.
// NOTE: labels are plain strings here (not wrapped in _()) because this module
// is evaluated at import time, before an Extension instance exists; gettext()
// can only be called once the extension context is established (e.g. inside
// enable()/_buildMenu()). Translation is applied when the menu is built.
const MODES = [
    { label: 'Off (Turn off PIP/PBP)', feature: 'e9', value: '0x00' },
    { label: 'Large PIP', feature: 'e9', value: '0x01' },
    { label: 'Small PIP', feature: 'e9', value: '0x21' },
    { label: 'Picture-by-Picture (PBP)', feature: 'e9', value: '0x24' },
];

const INPUTS = [
    { label: 'DisplayPort 1', value: '0x0f' },
    { label: 'DisplayPort 2', value: '0x10' },
    { label: 'HDMI 1', value: '0x11' },
    { label: 'HDMI 2', value: '0x12' },
    { label: 'USB-C', value: '0x1b' },
];

class DellPipButton extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    _init(settings) {
        super._init(0.0, _('Dell PIP/PBP Control'));
        this._settings = settings;
        this._displayItems = [];

        const icon = new St.Icon({
            icon_name: 'video-display-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(icon);

        this._buildMenu();
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._refreshXrandrMenu();
        });
    }

    _buildMenu() {
        this.menu.removeAll();

        const title = new PopupMenu.PopupMenuItem(_('Dell PIP/PBP Mode'), {
            reactive: false,
            style_class: 'popup-menu-item-header',
        });
        title.setSensitive(false);
        this.menu.addMenuItem(title);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        for (const mode of MODES) {
            const item = new PopupMenu.PopupMenuItem(_(mode.label));
            item.connect('activate', () => this._runSetVcp(mode.feature, mode.value));
            this.menu.addMenuItem(item);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const inputTitle = new PopupMenu.PopupMenuItem(_('Input Source'), {
            reactive: false,
            style_class: 'popup-menu-item-header',
        });
        inputTitle.setSensitive(false);
        this.menu.addMenuItem(inputTitle);

        for (const input of INPUTS) {
            const item = new PopupMenu.PopupMenuItem(_(input.label));
            item.connect('activate', () => this._runSetVcp('60', input.value));
            this.menu.addMenuItem(item);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const usbTitle = new PopupMenu.PopupMenuItem(_('USB Control'), {
            reactive: false,
            style_class: 'popup-menu-item-header',
        });
        usbTitle.setSensitive(false);
        this.menu.addMenuItem(usbTitle);

        const switchUsbItem = new PopupMenu.PopupMenuItem(_('Switch USB'));
        switchUsbItem.connect('activate', () => this._runSetVcp('E7', '0xFF00'));
        this.menu.addMenuItem(switchUsbItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const detectDdcItem = new PopupMenu.PopupMenuItem(_('Detect monitors (ddcutil)'));
        detectDdcItem.connect('activate', () => this._runDdcDetect());
        this.menu.addMenuItem(detectDdcItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const displayTitle = new PopupMenu.PopupMenuItem(_('Display Output'), {
            reactive: false,
            style_class: 'popup-menu-item-header',
        });
        displayTitle.setSensitive(false);
        this.menu.addMenuItem(displayTitle);

        const extendItem = new PopupMenu.PopupMenuItem(_('Extend displays'));
        extendItem.connect('activate', () => this._runXrandrLayout(buildExtendCommand, 'extend displays', 1));
        this.menu.addMenuItem(extendItem);

        const mirrorItem = new PopupMenu.PopupMenuItem(_('Mirror displays'));
        mirrorItem.connect('activate', () => this._runXrandrLayout(
            buildMirrorCommand,
            'mirror displays',
            2,
            _('No common resolution is available for mirroring.')
        ));
        this.menu.addMenuItem(mirrorItem);

        const refreshItem = new PopupMenu.PopupMenuItem(_('Refresh displays (xrandr)'));
        refreshItem.connect('activate', () => this._refreshXrandrMenu());
        this.menu.addMenuItem(refreshItem);

        this._displayStatusItem = new PopupMenu.PopupMenuItem(_('Loading displays…'), {
            reactive: false,
        });
        this._displayStatusItem.setSensitive(false);
        this.menu.addMenuItem(this._displayStatusItem);
    }

    _runSetVcp(feature, value) {
        const model = this._settings.get_string('selected-model');
        if (!model) {
            Main.notifyError(_('Dell PIP/PBP Control'), _('Choose a monitor in the extension preferences.'));
            return;
        }

        try {
            const proc = Gio.Subprocess.new(
                ['ddcutil', 'detect'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (source, res) => {
                try {
                    const [, stdout, stderr] = source.communicate_utf8_finish(res);
                    const exitStatus = source.get_exit_status();
                    if (exitStatus !== 0) {
                        logError(new Error(stderr || 'unknown error'),
                            '[dell-pip-control] ddcutil detect failed');
                        Main.notifyError(_('Dell PIP/PBP Control'), _('Failed to detect monitors.'));
                        return;
                    }

                    const matches = parseDisplays(stdout).filter(display => display.model === model);
                    if (matches.length === 0) {
                        Main.notifyError(_('Dell PIP/PBP Control'),
                            _('Selected monitor not found: %s').format(model));
                        return;
                    }
                    if (matches.length > 1) {
                        Main.notifyError(_('Dell PIP/PBP Control'),
                            _('More than one connected monitor is named %s.').format(model));
                        return;
                    }

                    const display = matches[0].number;
                    const argv = ['ddcutil', '-d', String(display), 'setvcp', feature, value];
                    this._spawn(argv, `setvcp ${feature} ${value} on ${model}`, 'ddcutil');
                } catch (e) {
                    logError(e, '[dell-pip-control] ddcutil detection communicate failed');
                    Main.notifyError(_('Dell PIP/PBP Control'), _('Failed to detect monitors.'));
                }
            });
        } catch (e) {
            logError(e, '[dell-pip-control] failed to spawn ddcutil detect');
            Main.notifyError(_('Dell PIP/PBP Control'), _('Failed to run ddcutil detect.'));
        }
    }

    _spawn(argv, description, commandName = 'xrandr', onSuccess = null) {
        try {
            const proc = Gio.Subprocess.new(
                argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (source, res) => {
                try {
                    const [ok, stdout, stderr] = source.communicate_utf8_finish(res);
                    const exitStatus = source.get_exit_status();
                    if (exitStatus !== 0) {
                        logError(new Error(stderr || 'unknown error'),
                            `[dell-pip-control] ${description} failed (exit ${exitStatus})`);
                        Main.notifyError(_('Dell PIP/PBP Control'),
                            _('Command failed: %s').format(description));
                    } else {
                        log(`[dell-pip-control] ${description} succeeded`);
                        onSuccess?.();
                    }
                } catch (e) {
                    logError(e, `[dell-pip-control] ${description} communicate failed`);
                }
            });
        } catch (e) {
            logError(e, `[dell-pip-control] failed to spawn ${argv.join(' ')}`);
            Main.notifyError(_('Dell PIP/PBP Control'),
                _('Failed to run %s. Is it installed?').format(commandName));
        }
    }

    _runDdcDetect() {
        try {
            const proc = Gio.Subprocess.new(
                ['ddcutil', 'detect'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (source, res) => {
                try {
                    const [, stdout, stderr] = source.communicate_utf8_finish(res);
                    log(`[dell-pip-control] ddcutil detect output:\n${stdout || stderr}`);
                    Main.notify(_('Dell PIP/PBP Control'), _('See journalctl (log) for ddcutil output.'));
                } catch (e) {
                    logError(e, '[dell-pip-control] ddcutil detect communicate failed');
                }
            });
        } catch (e) {
            logError(e, '[dell-pip-control] failed to spawn ddcutil detect');
            Main.notifyError(_('Dell PIP/PBP Control'), _('Failed to run ddcutil detect.'));
        }
    }

    _refreshXrandrMenu() {
        try {
            const proc = Gio.Subprocess.new(
                ['xrandr', '--query'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (source, res) => {
                try {
                    const [, stdout, stderr] = source.communicate_utf8_finish(res);
                    if (source.get_exit_status() !== 0) {
                        this._setXrandrStatus(_('Failed to query displays: %s').format(stderr.trim()));
                        logError(new Error(stderr || 'unknown error'), '[dell-pip-control] xrandr query failed');
                        return;
                    }

                    const displays = parseXrandrQuery(stdout);
                    this._clearDisplayItems();
                    if (displays.length === 0) {
                        this._displayStatusItem.label.text = _('No connected displays found.');
                        return;
                    }

                    this._displayStatusItem.label.text = _('Connected displays:');
                    for (const display of displays) {
                        const action = display.active ? _('Turn off') : _('Turn on');
                        const item = new PopupMenu.PopupMenuItem(`${action} ${display.name}`);
                        item.connect('activate', () => {
                            const argv = buildDisplayToggleCommand(display, displays);
                            this._spawn(argv, `${action.toLowerCase()} ${display.name}`,
                                'xrandr', () => this._refreshXrandrMenu());
                        });
                        this._displayItems.push(item);
                        this.menu.addMenuItem(item);
                    }
                } catch (e) {
                    this._setXrandrStatus(_('Failed to read xrandr results.'));
                    logError(e, '[dell-pip-control] xrandr query communicate failed');
                }
            });
        } catch (e) {
            this._setXrandrStatus(_('Could not run xrandr. Is it installed?'));
            logError(e, '[dell-pip-control] failed to spawn xrandr');
        }
    }

    _clearDisplayItems() {
        for (const item of this._displayItems)
            this.menu.removeMenuItem(item);
        this._displayItems = [];
    }

    _setXrandrStatus(text) {
        this._clearDisplayItems();
        this._displayStatusItem.label.text = text;
    }

    _runXrandrLayout(
        buildCommand,
        description,
        minimumDisplays,
        invalidLayoutMessage = _('Could not configure the display layout.')
    ) {
        try {
            const proc = Gio.Subprocess.new(
                ['xrandr', '--query'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (source, res) => {
                try {
                    const [, stdout, stderr] = source.communicate_utf8_finish(res);
                    if (source.get_exit_status() !== 0) {
                        logError(new Error(stderr || 'unknown error'), '[dell-pip-control] xrandr query failed');
                        Main.notifyError(_('Dell PIP/PBP Control'), _('Failed to query displays.'));
                        return;
                    }

                    const displays = parseXrandrQuery(stdout);
                    if (displays.length < minimumDisplays) {
                        const message = minimumDisplays === 1
                            ? _('No connected displays found.')
                            : _('At least two connected displays are required.');
                        Main.notifyError(_('Dell PIP/PBP Control'), message);
                        return;
                    }

                    const argv = buildCommand(displays);
                    if (!argv) {
                        Main.notifyError(_('Dell PIP/PBP Control'), invalidLayoutMessage);
                        return;
                    }

                    this._spawn(argv, description, 'xrandr', () => this._refreshXrandrMenu());
                } catch (e) {
                    logError(e, '[dell-pip-control] xrandr query communicate failed');
                    Main.notifyError(_('Dell PIP/PBP Control'), _('Failed to query displays.'));
                }
            });
        } catch (e) {
            logError(e, '[dell-pip-control] failed to spawn xrandr');
            Main.notifyError(_('Dell PIP/PBP Control'), _('Failed to run xrandr. Is it installed?'));
        }
    }
}

export default class DellPipControlExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new DellPipButton(this._settings);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
