// Keep the page responsive while running the project's unmodified GNU binutils modules.
importScripts('require.js?v=20261120');
require.config({ baseUrl: './', urlArgs: 'v=20261120' });
const toolFiles = {
  gas: ['as', 'as-new'],
  ld: ['ld', 'ld-new'],
  objdump: ['objdump', 'objdump'],
  objcopy: ['objcopy', 'objcopy'],
};
const tools = new Map();

async function loadTool(name) {
  if (!tools.has(name)) {
    const [moduleName, binaryName] = toolFiles[name];
    const factory = new Promise((resolve, reject) =>
      require(['riscv64-linux-gnu-' + moduleName], resolve, reject),
    );
    const wasm = fetch(new URL(binaryName + '.wasm', self.location.href)).then((response) => {
      if (!response.ok)
        throw Error('Could not load ' + binaryName + '.wasm (' + response.status + ')');
      return response.arrayBuffer();
    });
    tools.set(
      name,
      Promise.all([factory, wasm]).catch((error) => {
        tools.delete(name);
        throw error;
      }),
    );
  }
  return tools.get(name);
}

async function run(name, args, files = {}, output = null, log = null) {
  const [factory, wasmBinary] = await loadTool(name);
  const stdout = [],
    stderr = [];
  const module = await factory({
    noInitialRun: true,
    wasmBinary,
    thisProgram: name,
    print: (line) => stdout.push(line),
    printErr: (line) => stderr.push(line),
  });
  for (const [path, content] of Object.entries(files)) module.FS.writeFile(path, content);
  if (log) log.push('$ ' + name + ' ' + args.join(' '));
  const code = module.callMain([...args]);
  if (log) {
    if (name !== 'objdump') log.push(...stdout);
    log.push(...stderr);
  }
  if (code !== 0)
    throw Error(stderr.join('\n') || stdout.join('\n') || name + ' exited with status ' + code);
  return output ? module.FS.readFile(output) : stdout.join('\n');
}

async function build({ source, linker, march, abi, customFlags }) {
  const log = [],
    start = performance.now();
  let stage;
  async function phase(name, work) {
    stage = name;
    self.postMessage({ type: 'stage', name, state: 'active' });
    const t = performance.now();
    const result = await work();
    self.postMessage({ type: 'stage', name, state: 'done', ms: performance.now() - t });
    return result;
  }
  try {
    const obj = await phase('gas', async () => {
      if (!source.trim()) throw Error('main.s is empty. Enter some assembly and build again.');
      return run(
        'gas',
        [
          '-march=' + march,
          '-mabi=' + abi,
          ...customFlags.trim().split(/\s+/).filter(Boolean),
          'main.s',
          '-o',
          'main.o',
        ],
        { 'main.s': source },
        'main.o',
        log,
      );
    });
    const elf = await phase('ld', async () => {
      if (!linker.trim()) throw Error('linker.ld is empty. Enter a linker script and build again.');
      const emulation = obj[4] === 1 ? 'elf32lriscv' : 'elf64lriscv';
      return run(
        'ld',
        ['-m', emulation, '-T', 'linker.ld', 'main.o', '-o', 'main.elf'],
        { 'main.o': obj, 'linker.ld': linker },
        'main.elf',
        log,
      );
    });
    const files = { 'main.elf': elf };
    const [disasm, fullHex] = await phase('objdump', async () => [
      await run('objdump', ['-D', 'main.elf'], files, null, log),
      await run('objdump', ['-s', 'main.elf'], files, null, log),
    ]);
    const [text, data] = await phase('objcopy', async () => [
      await run(
        'objcopy',
        ['-O', 'binary', '--only-section', '.text*', 'main.elf', 'text.bin'],
        files,
        'text.bin',
        log,
      ),
      await run(
        'objcopy',
        ['-O', 'binary', '--only-section', '.data*', 'main.elf', 'data.bin'],
        files,
        'data.bin',
        log,
      ),
    ]);
    log.push('Build successful.');
    self.postMessage(
      {
        type: 'complete',
        disasm,
        fullHex,
        elf,
        text,
        data,
        log: log.join('\n'),
        ms: performance.now() - start,
      },
      [elf.buffer, text.buffer, data.buffer],
    );
  } catch (err) {
    const message = err.message || String(err);
    if (!log.join('\n').includes(message)) log.push(message);
    self.postMessage({
      type: 'failure',
      name: stage,
      log: log.join('\n'),
      ms: performance.now() - start,
    });
  }
}

self.onmessage = async ({ data }) => {
  if (data.type === 'version') {
    try {
      const text = await run('gas', ['--version']);
      self.postMessage({
        type: 'version',
        value: text.split('\n')[0].match(/\d+\.\d+(?:\.\d+)?/)?.[0] || '',
      });
    } catch {
      self.postMessage({ type: 'version', value: '' });
    }
  } else if (data.type === 'build') await build(data);
};
