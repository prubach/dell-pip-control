import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class DellPipControlPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: _('ddcutil settings'),
            description: _('Configure which monitor ddcutil should target.'),
        });
        page.add(group);

        const row = new Adw.SpinRow({
            title: _('Display number'),
            subtitle: _('The --display N argument passed to ddcutil (see: ddcutil detect)'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 20,
                step_increment: 1,
            }),
        });
        settings.bind('display-number', row, 'value', 0);
        group.add(row);

        window.add(page);
    }
}
