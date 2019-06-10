# vscode-cython-annotate

See cython annotation (a.k.a "cython -a") right within vscode!

## Features

This is a very preliminary version as everything is pretty much still WIP.

Usage is straightforward - use the `Cython: annotate` command while in your editor to show the annotations (and update after editing the file).
Use `Cython: Clear annotations` to remove.

## Extension Settings

* `cython-annotate.condaEnv`: Name of conda environment to run cython within
* `cython-annotate.cppPaths`: An array of globs of cpp mode source paths (e.g. `**/module/*.pyx`)

## Roadmap

* Cache results
* Produce/Update annotations automatically
