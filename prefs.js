import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {parseDisplays} from './ddcutil.js';

export default class DellPipControlPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: _('Monitor'),
            description: _('Choose the connected monitor to control.'),
        });
        page.add(group);

        const model = Gtk.StringList.new([_('Select a monitor')]);
        const row = new Adw.ComboRow({
            title: _('Monitor model'),
            subtitle: _('Loading connected monitors…'),
            model,
        });
        group.add(row);

        row.connect('notify::selected', () => {
            if (row.selected === 0)
                return;

            settings.set_string('selected-model', model.get_string(row.selected));
        });

        window.add(page);

        try {
            const proc = Gio.Subprocess.new(
                ['ddcutil', 'detect'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            proc.communicate_utf8_async(null, null, (source, res) => {
                try {
                    const [, stdout, stderr] = source.communicate_utf8_finish(res);
                    if (source.get_exit_status() !== 0) {
                        row.subtitle = _('Failed to detect monitors: %s').format(stderr.trim());
                        log(`[dell-pip-control] ddcutil detect failed: ${stderr}`);
                        return;
                    }

                    const displays = parseDisplays(stdout);
                    const models = [...new Set(displays.map(display => display.model))];
                    if (models.length === 0) {
                        row.subtitle = _('No connected monitors found.');
                        return;
                    }

                    for (const monitorModel of models)
                        model.append(monitorModel);

                    const selectedModel = settings.get_string('selected-model');
                    const selectedIndex = models.indexOf(selectedModel);
                    row.selected = selectedIndex < 0 ? 0 : selectedIndex + 1;
                    row.subtitle = _('Select the monitor whose PIP/PBP controls should be changed.');
                } catch (e) {
                    row.subtitle = _('Failed to read monitor detection results.');
                    logError(e, '[dell-pip-control] detect communicate failed');
                }
            });
        } catch (e) {
            row.subtitle = _('Could not run ddcutil detect.');
            logError(e, '[dell-pip-control] failed to spawn ddcutil detect');
        }
    }
}
