FROM emscripten/emsdk:latest

RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
