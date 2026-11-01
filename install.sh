#!/bin/bash
rsync -av --progress --exclude=".*" * ~/.local/share/gnome-shell/extensions/dell-pip-control@local/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/dell-pip-control@local/schemas/