# Installation

This GNOME Shell extension controls PIP/PBP mode, input sources, and USB routing on supported Dell monitors with `ddcutil`. It also provides xrandr controls to extend or mirror connected displays and turn each display on or off.

The monitor for DDC controls is selected in the extension preferences. Install `ddcutil` for monitor controls and `xrandr` for display-layout controls. xrandr configuration is primarily supported in X11 sessions; under Wayland, its available controls may be limited by the Xwayland compatibility layer.


```
rsync -av --progress --exclude=".*" * ~/.local/share/gnome-shell/extensions/dell-pip-control@local/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/dell-pip-control@local/schemas/
```

## Logs

```journalctl -b -o cat /usr/bin/gnome-shell | grep 'dell-pip-control' ```
