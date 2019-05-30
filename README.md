# vscode-cython-annotate

See cython annotation (a.k.a "cython -a") right in vscode!

## Features

This is a very preliminary version as everything is pretty much still WIP.

Currently only color coding is supported.

To show them, use the `Cython: annotate` command while in your editor to show the annotations (and update after editing the file).
Use `Cython: Clear annotations` to remove.

## Extension Settings

* `cython-annotate.condaEnv`: Name of conda path to run cython within

## Roadmap

* Cache results
* Produce/Update annotations automatically

## Release Notes

### 0.0.1

Added the very basic functionality.

### 0.1.0

Added generated c code in a hover message
Added annotation colors in the overview ruler
