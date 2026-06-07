# RISC-V Online Assembler

Online assembler for RISC-V assembly (all variants that gas supports).

It uses a WebAssembly-compiled version of GNU as, objdump and objcopy to build the assembly.

Built for my RISC-V Emulator series (currently only in portuguese at [https://www.youtube.com/playlist?list=PLEP_M2UAh9q6_2Jtvs9fgOVlRgsruii2m](https://www.youtube.com/playlist?list=PLEP_M2UAh9q6_2Jtvs9fgOVlRgsruii2m))

### Building the WASM toolchain

Requires Docker with the [emscripten/emsdk](https://hub.docker.com/r/emscripten/emsdk) image.

```bash
./build.sh docker     # build via Docker (recommended)
./build.sh            # native build (requires emsdk in PATH)
./build.sh clean      # remove build artifacts
```

The script downloads binutils 2.46.0 source, cross-compiles gas, ld, objcopy and objdump to WebAssembly, and copies the resulting `.wasm` and `.js` glue files into `js/`.

### Legacy manual build

For reference, these are the raw steps the script automates:

```bash
wget https://ftp.gnu.org/gnu/binutils/binutils-2.46.0.tar.xz
tar -xf binutils-2.46.0.tar.xz
mkdir -p build bins
cd build
cat > assets.js <<'JS'
Module['FS'] = FS;
Module['callMain'] = callMain;
JS
emconfigure ../binutils-2.46.0/configure --disable-doc --build=x86 --host=wasm32 --target=riscv64-linux-gnu
emmake make -j4 CFLAGS="-DHAVE_PSIGNAL=1 -DELIDE_CODE -D__GNU_LIBRARY__ -O2 -Wno-unused-but-set-global" LDFLAGS="-s MODULARIZE=1 -s FORCE_FILESYSTEM=1 --post-js $(pwd)/assets.js"
emmake make install DESTDIR="$(pwd)/../bins"
cp binutils/objcopy.wasm binutils/objdump.wasm gas/as-new.wasm ld/ld-new.wasm ../js/
cp ../bins/usr/local/bin/riscv64-linux-gnu-as ../js/riscv64-linux-gnu-as.js
cp ../bins/usr/local/bin/riscv64-linux-gnu-objcopy ../js/riscv64-linux-gnu-objcopy.js
cp ../bins/usr/local/bin/riscv64-linux-gnu-objdump ../js/riscv64-linux-gnu-objdump.js
cp ../bins/usr/local/bin/riscv64-linux-gnu-ld ../js/riscv64-linux-gnu-ld.js
```
