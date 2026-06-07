# AGENTS.md

Static site deployed via GitHub Pages at riscvasm.lucasteske.dev. No build step, no tests, no CI.

## Architecture

- `index.html` — single page entrypoint
- `js/main.js` — core logic: assembles RISC-V asm in-browser via WebAssembly-compiled binutils (gas, ld, objcopy, objdump)
- `js/app.js` — RequireJS bootstrap that loads `main.js`
- `js/*.js` (riscv64-linux-gnu-*) — Emscripten-generated JS glue for WASM modules
- `js/*.wasm` — WebAssembly binaries (as-new, ld-new, objcopy, objdump)
- `js/codemirror.js`, `js/gas.js` — CodeMirror editor with GAS syntax mode
- `css/page.css` — custom styles; `css/materialize.min.css`, `css/codemirror.css`, `css/dracula.css` are third-party

## WASM Toolchain Rebuild

The `.wasm` files and JS glue (`riscv64-linux-gnu-*.js`) are compiled from binutils 2.46.0 using Emscripten targeting `wasm32`. Requires `emsdk` in PATH.

```bash
source /path/to/emsdk/emsdk_env.sh
./build.sh          # builds and copies artifacts to js/
./build.sh clean    # removes build/ bins/ and extracted source
```

Do NOT modify `.wasm` files or JS glue without rebuilding via `./build.sh`.

## Conventions

- No framework, no bundler — plain JS loaded via RequireJS (`require.js`)
- jQuery loaded from CDN, not local
- Third-party CSS/JS files (materialize, codemirror, dracula theme) are vendored — do not edit
- `CNAME` controls the GitHub Pages custom domain
- `temp/` is gitignored
