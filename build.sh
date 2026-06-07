#!/usr/bin/env bash
set -euo pipefail

BINUTILS_VERSION="2.46.0"
BINUTILS_URL="https://ftp.gnu.org/gnu/binutils/binutils-${BINUTILS_VERSION}.tar.xz"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build"
BINS_DIR="${SCRIPT_DIR}/bins"
OUTPUT_DIR="${SCRIPT_DIR}/js"
DOCKER_IMAGE="emscripten/emsdk:latest"

BINUTILS_CFLAGS="-DHAVE_PSIGNAL=1 -DELIDE_CODE -D__GNU_LIBRARY__ -O2 -Wno-unused-but-set-global"
BINUTILS_LDFLAGS="-s MODULARIZE=1 -s FORCE_FILESYSTEM=1"

JS_GLUE_FILES=(
    riscv64-linux-gnu-as
    riscv64-linux-gnu-objcopy
    riscv64-linux-gnu-objdump
    riscv64-linux-gnu-ld
)

check_prerequisites() {
    if ! command -v emcc &>/dev/null; then
        echo "Error: emcc not found. Source emsdk_env.sh first:" >&2
        echo "  source /path/to/emsdk/emsdk_env.sh" >&2
        exit 1
    fi
}

download_and_extract() {
    local archive="binutils-${BINUTILS_VERSION}.tar.xz"
    if [ -d "${SCRIPT_DIR}/binutils-${BINUTILS_VERSION}" ]; then
        echo "==> Source already extracted, skipping download"
        return
    fi
    echo "==> Downloading binutils ${BINUTILS_VERSION}..."
    wget "${BINUTILS_URL}" -O "${archive}"
    tar -xf "${archive}"
    rm "${archive}"
}

build() {
    mkdir -p "${BUILD_DIR}" "${BINS_DIR}"
    cd "${BUILD_DIR}"

    echo "==> Configuring..."
    emconfigure "../binutils-${BINUTILS_VERSION}/configure" \
        --disable-doc \
        --build=x86 \
        --host=wasm32 \
        --target=riscv64-linux-gnu

    echo "==> Building..."
    cat > assets.js <<'JS'
Module['FS'] = FS;
Module['callMain'] = callMain;
JS
    emmake make -j"$(nproc)" \
        CFLAGS="${BINUTILS_CFLAGS}" \
        LDFLAGS="${BINUTILS_LDFLAGS} --post-js $(pwd)/assets.js"

    echo "==> Installing to staging..."
    emmake make install DESTDIR="${BINS_DIR}"
}

copy_artifacts() {
    echo "==> Copying WASM binaries to ${OUTPUT_DIR}/"
    cp "${BUILD_DIR}/binutils/objcopy.wasm" "${OUTPUT_DIR}/"
    cp "${BUILD_DIR}/binutils/objdump.wasm" "${OUTPUT_DIR}/"
    cp "${BUILD_DIR}/gas/as-new.wasm" "${OUTPUT_DIR}/"
    cp "${BUILD_DIR}/ld/ld-new.wasm" "${OUTPUT_DIR}/"

    echo "==> Copying JS glue to ${OUTPUT_DIR}/"
    for tool in "${JS_GLUE_FILES[@]}"; do
        local src="${BINS_DIR}/usr/local/bin/${tool}"
        if [ -f "${src}.js" ]; then
            cp "${src}.js" "${OUTPUT_DIR}/"
        elif [ -f "${src}" ]; then
            cp "${src}" "${OUTPUT_DIR}/${tool}.js"
        else
            echo "Error: cannot find JS glue for ${tool}" >&2
            exit 1
        fi
    done
}

docker_build() {
    local host_uid host_gid
    host_uid=$(id -u)
    host_gid=$(id -g)

    local js_glue_list
    js_glue_list=$(IFS=,; echo "${JS_GLUE_FILES[*]}")

    echo "==> Building with Docker..."
    docker run --rm -v "${SCRIPT_DIR}:/src" "${DOCKER_IMAGE}" bash -c '
        set -euo pipefail
        BUILD_DIR=/tmp/build
        BINS_DIR=/tmp/bins
        OUTPUT_DIR=/src/js
        VERSION="'"${BINUTILS_VERSION}"'"
        URL="'"${BINUTILS_URL}"'"
        CFLAGS="'"${BINUTILS_CFLAGS}"'"
        LDFLAGS="'"${BINUTILS_LDFLAGS}"'"
        HOST_UID="'"${host_uid}"'"
        HOST_GID="'"${host_gid}"'"
        JS_GLUE="'"${js_glue_list}"'"

        mkdir -p "${BUILD_DIR}" "${BINS_DIR}"
        cd "${BUILD_DIR}"

        echo "==> Downloading binutils ${VERSION}..."
        wget "${URL}" -O "binutils-${VERSION}.tar.xz"
        tar -xf "binutils-${VERSION}.tar.xz"
        rm "binutils-${VERSION}.tar.xz"

        echo "==> Configuring..."
        emconfigure "./binutils-${VERSION}/configure" \
            --disable-doc \
            --build=x86 \
            --host=wasm32 \
            --target=riscv64-linux-gnu

        echo "==> Building..."
        cat > assets.js <<'JS'
Module["FS"] = FS;
Module["callMain"] = callMain;
JS
        emmake make -j"$(nproc)" \
            CFLAGS="${CFLAGS}" \
            LDFLAGS="${LDFLAGS} --post-js $(pwd)/assets.js"

        echo "==> Installing to staging..."
        emmake make install DESTDIR="${BINS_DIR}"

        echo "==> Copying WASM binaries..."
        cp binutils/objcopy.wasm "${OUTPUT_DIR}/"
        cp binutils/objdump.wasm "${OUTPUT_DIR}/"
        cp gas/as-new.wasm "${OUTPUT_DIR}/"
        cp ld/ld-new.wasm "${OUTPUT_DIR}/"

        echo "==> Copying JS glue..."
        IFS=","
        for tool in ${JS_GLUE}; do
            IFS=","  # reset for next loop
            src="${BINS_DIR}/usr/local/bin/${tool}"
            if [ -f "${src}.js" ]; then
                cp "${src}.js" "${OUTPUT_DIR}/"
            elif [ -f "${src}" ]; then
                cp "${src}" "${OUTPUT_DIR}/${tool}.js"
            else
                echo "Error: cannot find JS glue for ${tool}" >&2
                exit 1
            fi
        done

        chown -R "${HOST_UID}:${HOST_GID}" "${OUTPUT_DIR}"
        echo "==> Done. binutils ${VERSION} toolchain built successfully."
    '
}

clean() {
    echo "==> Cleaning build artifacts..."
    rm -rf "${BUILD_DIR}" "${BINS_DIR}" "${SCRIPT_DIR}/binutils-${BINUTILS_VERSION}"
}

usage() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Builds the WASM binutils toolchain and copies artifacts to js/"
    echo ""
    echo "Commands:"
    echo "  (default)      Download, build, and install (native, requires emsdk in PATH)"
    echo "  docker          Download, build, and install via Docker (${DOCKER_IMAGE})"
    echo "  clean           Remove build/ bins/ and extracted source"
}

if [ $# -gt 0 ]; then
    case "$1" in
        docker)  docker_build ;;
        clean)   clean ;;
        *)       usage; exit 1 ;;
    esac
    exit 0
fi

check_prerequisites
download_and_extract
build
copy_artifacts

echo "==> Done. binutils ${BINUTILS_VERSION} toolchain built successfully."
