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
    {label: 'Off (Turn off PIP/PBP)', feature: 'e9', value: '0x00'},
    {label: 'Large PIP', feature: 'e9', value: '0x01'},
    {label: 'Small PIP', feature: 'e9', value: '0x21'},
    {label: 'Picture-by-Picture (PBP)', feature: 'e9', value: '0x24'},
];

const INPUTS = [
    {label: 'DisplayPort 1', value: '0x0f'},
    {label: 'DisplayPort 2', value: '0x10'},
    {label: 'HDMI 1', value: '0x11'},
    {label: 'HDMI 2', value: '0x12'},
    {label: 'USB-C', value: '0x1b'},
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

        const detectItem = new PopupMenu.PopupMenuItem(_('Detect displays (ddcutil detect)'));
        detectItem.connect('activate', () => this._runDetect());
        this.menu.addMenuItem(detectItem);
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
                        Main.notifyError(_('Dell PIP/PBP Control'), _('Failed to detect displays.'));
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
                    this._spawn(argv, `setvcp ${feature} ${value} on ${model}`);
                } catch (e) {
                    logError(e, '[dell-pip-control] display detection communicate failed');
                    Main.notifyError(_('Dell PIP/PBP Control'), _('Failed to detect displays.'));
                }
            });
        } catch (e) {
            logError(e, '[dell-pip-control] failed to spawn ddcutil detect');
            Main.notifyError(_('Dell PIP/PBP Control'), _('Failed to run ddcutil detect.'));
        }
    }

    _runDetect() {
        try {
            const proc = Gio.Subprocess.new(
                ['ddcutil', 'detect'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (source, res) => {
                try {
                    const [, stdout, stderr] = source.communicate_utf8_finish(res);
                    log(`[dell-pip-control] ddcutil detect output:\n${stdout || stderr}`);
                    Main.notify(_('Dell PIP/PBP Control'), _('See journalctl (log) for ddcutil detect output.'));
                } catch (e) {
                    logError(e, '[dell-pip-control] detect communicate failed');
                }
            });
        } catch (e) {
            logError(e, '[dell-pip-control] failed to spawn ddcutil detect');
            Main.notifyError(_('Dell PIP/PBP Control'), _('Failed to run ddcutil detect.'));
        }
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
            Main.notifyError(_('Dell PIP/PBP Control'), _('Failed to run ddcutil. Is it installed?'));
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
