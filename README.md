# Installation

This GNOME Shell extension controls PIP/PBP mode, input sources, and USB routing on supported Dell monitors with `ddcutil`. It also provides xrandr controls to extend or mirror connected displays and turn each display on or off.

The monitor for DDC controls is selected in the extension preferences. Install `ddcutil` for monitor controls and `xrandr` for display-layout controls. On Wayland, extend/mirror/on/off use Mutter's DisplayConfig D-Bus API; on X11 they use xrandr.

**PBP + extend (one click)** switches the selected Dell monitor to Picture-by-Picture, waits for the host to see the new half-width mode, then extends all displays side by side with the Dell as the first (primary) display.


```
rsync -av --progress --exclude=".*" * ~/.local/share/gnome-shell/extensions/dell-pip-control@local/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/dell-pip-control@local/schemas/
```

## Logs

```journalctl -b -o cat /usr/bin/gnome-shell | grep 'dell-pip-control' ```


## Testing

 ```dbus-run-session gnome-shell --devkit --wayland
    gnome-extensions enable dell-pip-control@local
 ```

Yes. On Wayland you can't restart GNOME Shell in place, but there are three ways around that.

1. **Nested dev session (best for the full extension).** GNOME 50 has `--devkit`. It runs a separate shell in a window, and it loads extensions from `~/.local/share/gnome-shell/extensions`, so install there first with the README rsync command.
   ```
   dbus-run-session gnome-shell --devkit --wayland
   ```
   Enable the extension inside it with `gnome-extensions enable dell-pip-control@local`. It needs `mutter-devkit` installed. Mutter D-Bus calls in that session act on the nested virtual monitor, not your real displays.

2. **Test the logic directly with gjs (what I did).** The layout and D-Bus code in `mutter.js` runs standalone with `gjs -m` against your real Mutter, so no shell restart is needed. This is the quickest way to check extend, mirror and the PBP wait. I can write a small script for it, for example one that prints the layouts and applies extend.

3. **Reload on the real session.** This doesn't work, because ES modules are cached for the life of the shell. The workaround is to copy the extension to a new UUID, such as `dell-pip-control-dev@local` with a matching `metadata.json` uuid, and enable that one. Each new UUID loads fresh code, but it still needs a restart to be discovered the first time.

For the PBP flow you need real hardware, so I'd use option 2 for the layout logic and a one-time re-login for the full extension. Want me to write a reusable gjs test script?