# RISC-V Online Assembler

This is a very crude online assembler for RISC-V assembly (all variants that gas supports)

It uses a webassembly compiled version of gnu as, objdump and objcopy to build the assembly.

It has been done REALLY quick (probably less than 2h) for my RISC-V Emulator series (currently only in portuguese at [https://www.youtube.com/playlist?list=PLEP_M2UAh9q6_2Jtvs9fgOVlRgsruii2m](https://www.youtube.com/playlist?list=PLEP_M2UAh9q6_2Jtvs9fgOVlRgsruii2m))

### Compiling binutils

```bash
wget http://ftp.gnu.org/gnu/binutils/binutils-2.31.tar.xz
tar -xf binutils-2.31.tar.xz
rm binutils-2.31.tar.xz
mkdir -p build
mkdir -p bins
mkdir -p web
cd build
source {PATH_TO_EMSDK}/emsdk_env.sh
echo "Module['FS'] = FS;" > post-js.txt
emconfigure ../binutils-2.31/configure --disable-doc --build=x86 --host=wasm32 --target=riscv64-linux-gnu
emmake make -j4 CFLAGS="-DHAVE_PSIGNAL=1 -DELIDE_CODE -D__GNU_LIBRARY__ -O2" LDFLAGS="-s MODULARIZE=1 -s FORCE_FILESYSTEM=1 --post-js $(pwd)/post-js.txt"
emmake make install DESTDIR="$(pwd)/../bins"
cp binutils/objcopy.wasm binutils/objdump.wasm gas/as-new.wasm ld/ld-new.wasm ../web
cd ..
cd bins
cp usr/local/bin/riscv64-linux-gnu-as ../web/riscv64-linux-gnu-as.js
cp usr/local/bin/riscv64-linux-gnu-objcopy ../web/riscv64-linux-gnu-objcopy.js
cp usr/local/bin/riscv64-linux-gnu-objdump ../web/riscv64-linux-gnu-objdump.js
cp usr/local/bin/riscv64-linux-gnu-objdump ../web/riscv64-linux-gnu-objdump.js
cp usr/local/bin/riscv64-linux-gnu-ld ../web/riscv64-linux-gnu-ld.js
```
