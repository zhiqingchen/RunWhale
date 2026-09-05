# Third-Party Notices

RunWhale includes and distributes third-party software and assets under their own licenses. The Apache License 2.0 in the repository root applies only to RunWhale's original software code and does not replace these terms or grant trademark rights.

Exact JavaScript dependency versions are recorded in `pnpm-lock.yaml`. Installed package license texts remain authoritative for those packages.

## Icons and Provider Marks

### Lucide and Feather

RunWhale uses icons from `lucide-react-native` 1.34.0, licensed under the ISC License. Some Lucide icons are derived from Feather and are licensed under the MIT License.

Copyright (c) 2026 Lucide Icons and Contributors.

Copyright (c) 2013-present Cole Bemis.

Source: <https://github.com/lucide-icons/lucide>

### Lobe Icons

RunWhale uses provider marks from `@lobehub/icons-rn` 2.12.0, licensed under the MIT License.

Copyright (c) 2023 LobeHub.

Source: <https://github.com/lobehub/lobe-icons>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

OpenAI, DeepSeek, Anthropic, Google, and other names and logos are trademarks of their respective owners. Their inclusion identifies supported providers and does not imply endorsement, sponsorship, or affiliation.

## Native Node Runtime

The native host consumes `@runwhale/node-mobile-runtime` 24.19.0-runwhale.1, a modified Node.js Mobile build licensed under the terms included in that package's `LICENSE` and `NOTICE.md`. The exact source repository, source commit, Node.js base commit, nodejs-mobile upstream commit, platform contract, and artifact version are recorded in `upstreams.lock.json` and the package's `runtime-manifest.json`.

Source: <https://github.com/zhiqingchen/nodejs-mobile>

## Bundled Data and Build-Time Components

### caniuse-lite

`caniuse-lite` 1.0.30001810 is by Ben Briggs and contributors and is licensed under CC-BY-4.0. RunWhale consumes its browser compatibility data through the JavaScript dependency graph without modifying the source dataset.

Source: <https://github.com/browserslist/caniuse-lite>

License: <https://creativecommons.org/licenses/by/4.0/>

### Lightning CSS

`lightningcss` 1.30.1, 1.32.0, and 1.33.0, including their platform packages, are licensed under the Mozilla Public License 2.0. They are build-time dependencies in the installed dependency graph; any covered source files remain available from the upstream project.

Source: <https://github.com/parcel-bundler/lightningcss>

License: <https://www.mozilla.org/MPL/2.0/>

## Distribution

Release packaging must preserve all notices and license texts required by the dependencies actually included in an APK or IPA. The notices above are a focused attribution record and are not a substitute for the complete license files shipped with the dependency graph and the native Node runtime.
