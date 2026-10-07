import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {parseDisplays} from './ddcutil.js';

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

const DISPLAY_OUTPUTS = [
    { label: 'Extend Display', feature: 'e8', value: '0x00' },
    { label: 'Mirror Displays', feature: 'e8', value: '0x01' },
    { label: 'Clone Display', feature: 'e8', value: '0x02' },
];

class DellPipButton extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    _init(settings) {
        super._init(0.0, _('Dell PIP/PBP Control'));
        this._settings = settings;

        const icon = new St.Icon({
            icon_name: 'video-display-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(icon);

        this._buildMenu();
    }

    _buildMenu() {
        this.menu.removeAll();

        const title = new PopupMenu.PopupMenuItem(_('Dell PIP/PBP Mode'), {
            reactive: false,
            style_class: 'popup-menu-item-header',
        });
        title.setSensitive(false);
        this.menu.addMenuItem(title);
        this.menu.addMenuBar();
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

        // New section for Display Output
        const displayTitle = new PopupMenu.PopupMenuItem(_('Display Output'), {
            reactive: false,
            style_class: 'popup-menu-item-header',
        });
        displayTitle.setSensitive(false);
        this.menu.addMenuItem(displayTitle);

        for (const output of DISPLAY_OUTPUTS) {
            const item = new PopupMenu.PopupMenuItem(_(output.label));
            item.connect('activate', () => this._runSetXrandr(output.feature, output.value));
            this.menu.addMenuItem(item);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const detectItem = new PopupMenu.PopupMenuItem(_('Detect displays (xrandr)'));
        detectItem.connect('activate', () => this._runDetect());
        this.menu.addMenuItem(detectItem);
    }

    _runSetXrandr(feature, value) {
        const model = this._settings.get_string('selected-model');
        if (!model) {
            Main.notifyError(_('Dell PIP/PBP Control'), _('Choose a monitor in the extension preferences.'));
            return;
        }

        try {
            const proc = Gio.Subprocess.new(
                ['xrandr', '--listmonitors'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (source, res) => {
                try {
                    const [, stdout, stderr] = source.communicate_utf8_finish(res);
                    const exitStatus = source.get_exit_status();
                    if (exitStatus !== 0) {
                        logError(new Error(stderr || 'unknown error'),
                            '[dell-pip-control] xrandr detect failed');
                        Main.notifyError(_('Dell PIP/PBP Control'), _('Failed to detect displays.'));
                        return;
                    }

                    const monitors = this._parseXrandrOutput(stdout);
                    if (monitors.length === 0) {
                        Main.notifyError(_('Dell PIP/PBP Control'),
                            _('No displays detected. Ensure xrandr is installed and monitors are connected.'));
                        return;
                    }

                    if (monitors.length > 1) {
                        Main.notifyError(_('Dell PIP/PBP Control'),
                            _('Multiple displays detected. Choose one in the extension preferences.'));
                        return;
                    }

                    const display = monitors[0].name;
                    const command = this._buildXrandrCommand(display, feature, value);
                    this._spawn(command, `setxrandr ${feature} ${value} on ${model}`);
                } catch (e) {
                    logError(e, '[dell-pip-control] display detection communicate failed');
                    Main.notifyError(_('Dell PIP/PBP Control'), _('Failed to detect displays.'));
                }
            });
        } catch (e) {
            logError(e, '[dell-pip-control] failed to spawn xrandr');
            Main.notifyError(_('Dell PIP/PBP Control'), _('Failed to run xrandr. Is it installed?'));
        }
    }

    _parseXrandrOutput(output) {
        const lines = output.split('\n');
        const monitors = [];
        let currentMonitor = null;

        for (const line of lines) {
            if (line.startsWith('  ')) {
                if (currentMonitor) {
                    monitors.push(currentMonitor);
                }
                const name = line.trim().split(' ')[0];
                currentMonitor = { name };
            } else if (line.startsWith('Monitors:')) {
                // Skip header
            } else {
                if (currentMonitor) {
                    currentMonitor.resolution = line.trim();
                }
            }
        }

        if (currentMonitor) {
            monitors.push(currentMonitor);
        }

        return monitors;
    }

    _buildXrandrCommand(display, feature, value) {
        const command = [];
        const [monitor] = display.split(' ');
        const [width, height] = display.split(' ').pop().split('x');

        // Set resolution
        command.push(`--output ${monitor} --mode ${width}x${height}`);

        // Set display mode
        switch (feature) {
            case 'e8':
                switch (value) {
                    case '0x00': command.push('--output ${monitor} --mode ${width}x${height}'); break;
                    case '0x01': command.push('--output ${monitor} --mode ${width}x${height}'); break;
                    case '0x02': command.push('--output ${monitor} --mode ${width}x${height}'); break;
                }
                break;
            default:
                break;
        }

        return ['xrandr', ...command];
    }

    _spawn(argv, description) {
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
                    }
                } catch (e) {
                    logError(e, `[dell-pip-control] ${description} communicate failed`);
                }
            });
        } catch (e) {
            logError(e, `[dell-pip-control] failed to spawn ${argv.join(' ')}`);
            Main.notifyError(_('Dell PIP/PBP Control'), _('Failed to run xrandr. Is it installed?'));
        }
    }

    _runDetect() {
        try {
            const proc = Gio.Subprocess.new(
                ['xrandr', '--listmonitors'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (source, res) => {
                try {
                    const [, stdout, stderr] = source.communicate_utf8_finish(res);
                    log(`[dell-pip-control] xrandr detect output:\n${stdout || stderr}`);
                    Main.notify(_('Dell PIP/PBP Control'), _('See journalctl (log) for xrandr output.'));
                } catch (e) {
                    logError(e, '[dell-pip-control] detect communicate failed');
                }
            });
        } catch (e) {
            logError(e, '[dell-pip-control] failed to spawn xrandr');
            Main.notifyError(_('Dell PIP/PBP Control'), _('Failed to run xrandr. Is it installed?'));
        }
    }

    _toggleDisplayMode() {
        // Logic to cycle through display modes
        // You can implement this based on current mode
        // For simplicity, assume it toggles between Extend, Mirror, Clone
        const modes = ['Extend', 'Mirror', 'Clone'];
        const currentMode = this._settings.get_string('current-mode');
        const index = modes.indexOf(currentMode);
        const nextIndex = (index + 1) % modes.length;
        const nextMode = modes[nextIndex];
        this._settings.set_string('current-mode', nextMode);
        this._runSetXrandr('e8', nextMode);
    }
}

export default class DellPipControlExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new DellPipButton(this._settings);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // Register keyboard shortcut SUPER+D
        const shortcut = new Main.WMKeybinding(
            'dell-pip-control-toggle', // Unique ID
            'SUPER+D', // Keybinding
            () => this._toggleDisplayMode(), // Callback
            'Toggle Display Output' // Description
        );
        Main.keybindingManager.addKeybinding(
            'dell-pip-control-toggle',
            () => this._toggleDisplayMode(),
            'dell-pip-control-toggle',
            Main.WMKeybindingMode.NORMAL
        );
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
