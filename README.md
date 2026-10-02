# Installation

This is a Gnome Extension that allows you to control the Dell PIP (Picture-in-Picture) feature and Input Sources on supported Dell monitors.


```
rsync -av --progress --exclude=".*" * ~/.local/share/gnome-shell/extensions/dell-pip-control@local/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/dell-pip-control@local/schemas/
```

## Logs

```journalctl -b -o cat /usr/bin/gnome-shell | grep 'dell-pip-control' ```
