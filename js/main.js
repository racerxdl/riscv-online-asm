function withModuleDefaults(env) {
  return {
    locateFile: (path) => `js/${path}`,
    ...env,
  };
}

async function callAS(env) {
  const Module = await new Promise((resolve, reject) => {
    require(['./riscv64-linux-gnu-as'], resolve, reject);
  });
  return Module(withModuleDefaults(env));
}
async function callObjdump(env) {
  const Module = await new Promise((resolve, reject) => {
    require(['./riscv64-linux-gnu-objdump'], resolve, reject);
  });
  return Module(withModuleDefaults(env));
}
async function callObjcopy(env) {
  const Module = await new Promise((resolve, reject) => {
    require(['./riscv64-linux-gnu-objcopy'], resolve, reject);
  });
  return Module(withModuleDefaults(env));
}
async function callLd(env) {
  const Module = await new Promise((resolve, reject) => {
    require(['./riscv64-linux-gnu-ld'], resolve, reject);
  });
  return Module(withModuleDefaults(env));
}

const SINGLE_LETTER_EXTENSION_ORDER = "iemafdqlcbkjtpvnh";

function normalizeExtensionTokens(extraText) {
  return extraText
    .split(/[\s,]+/)
    .flatMap((part) => part.split('_'))
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function buildMarch(baseIsa, toggledExtensions, extraText) {
  let march = (baseIsa || "rv64gc").trim().toLowerCase();
  const singleLetter = new Set();
  const longExtensions = [];

  for (const token of [...toggledExtensions, ...normalizeExtensionTokens(extraText || "")]) {
    if (/^[a-z]$/.test(token)) {
      singleLetter.add(token);
      continue;
    }

    if (!longExtensions.includes(token)) {
      longExtensions.push(token);
    }
  }

  for (const ext of SINGLE_LETTER_EXTENSION_ORDER) {
    if (singleLetter.has(ext) && !march.includes(ext)) {
      march += ext;
    }
  }

  if (longExtensions.length > 0) {
    march += `_${longExtensions.join('_')}`;
  }

  return march;
}

function getAssemblerSettings() {
  const baseIsa = document.getElementById("archBase")?.value || "rv64gc";
  const abi = document.getElementById("archAbi")?.value || "lp64d";
  const extraText = document.getElementById("archExtra")?.value || "";
  const customFlags = document.getElementById("archCustomFlags")?.value?.trim() || "";
  const toggledExtensions = [];

  if (document.getElementById("extHypervisor")?.checked) {
    toggledExtensions.push("h");
  }

  if (document.getElementById("extVector")?.checked) {
    toggledExtensions.push("v");
  }

  return {
    march: buildMarch(baseIsa, toggledExtensions, extraText),
    abi,
    customFlags,
  };
}

function updateAssemblerPreview() {
  const preview = document.getElementById("archPreview");
  if (!preview) {
    return;
  }

  const settings = getAssemblerSettings();
  let text = `-march=${settings.march} -mabi=${settings.abi}`;
  if (settings.customFlags) {
    text += ` ${settings.customFlags}`;
  }
  preview.textContent = text;
}

function getAssemblerArgs(sourceFile, outputFile, settings) {
  const args = [
    `-march=${settings.march}`,
    `-mabi=${settings.abi}`,
  ];
  if (settings.customFlags) {
    args.push(...settings.customFlags.split(/\s+/).filter(Boolean));
  }
  args.push(sourceFile, "-o", outputFile);
  return args;
}

async function assemble(code, settings) {
  console.log(`Assembling:\n${code}`);
  const env = { noInitialRun: true };
  let out = "";
  env.print = (data) => { out += data + "\n"; };
  env.printErr = (data) => { out += data + "\n"; };

  const m = await callAS(env);
  m.FS.writeFile("file.s", code);

  try {
    m.callMain(getAssemblerArgs("file.s", "file.o", settings));
  } catch(e) {
    throw out || e;
  }

  console.log(`Assembled:\n${out}`);

  try {
    return m.FS.readFile("file.o");
  } catch(e) {
    throw out || e;
  }
}

async function link(object, ldscript) {
  console.log(`Linking:\n${bufferToHex(object).replace("\n","")} with ${ldscript}`);
  const env = { noInitialRun: true };
  let out = "";
  env.print = (data) => { out += data + "\n"; };
  env.printErr = (data) => { out += data + "\n"; };

  const m = await callLd(env);
  m.FS.writeFile("file.ld", ldscript);
  m.FS.writeFile("data.o", object);

  try {
    m.callMain(["-T", "file.ld", "data.o", "-o", "file.elf"]);
  } catch(e) {
    throw `LD: ${out}`;
  }

  try {
    return m.FS.readFile("file.elf");
  } catch(e) {
    throw `LD: ${out}`;
  }
}

async function dump(elf) {
  const env = { noInitialRun: true };
  let stdout = "";
  env.print = (data) => { stdout += data + "\n"; };

  const m = await callObjdump(env);
  m.FS.writeFile("file.elf", elf);

  try {
    m.callMain(["-D", "file.elf"]);
  } catch(e) {
    return stdout;
  }

  return stdout;
}

async function dump_as_hex(elf) {
  const env = { noInitialRun: true };
  let stdout = "";
  env.print = (data) => { stdout += data + "\n"; };

  const m = await callObjdump(env);
  m.FS.writeFile("file.elf", elf);

  try {
    m.callMain(["-s", "file.elf"]);
  } catch(e) {
    return stdout;
  }

  return stdout;
}

async function getBinaryText(elf) {
  const env = { noInitialRun: true };
  let stdout = "";
  env.print = (data) => { stdout += data + "\n"; };

  const m = await callObjcopy(env);
  m.FS.writeFile("file.elf", elf);

  try {
    m.callMain(["-O", "binary", "file.elf", "file.bin", "--only-section", ".text*"]);
  } catch(e) {}

  return m.FS.readFile("file.bin");
}

async function getBinaryData(elf) {
  const env = { noInitialRun: true };
  let stdout = "";
  env.print = (data) => { stdout += data + "\n"; };

  const m = await callObjcopy(env);
  m.FS.writeFile("file.elf", elf);

  try {
    m.callMain(["-O", "binary", "file.elf", "file.bin", "--only-section", ".data*"]);
  } catch(e) {}

  return m.FS.readFile("file.bin");
}

async function getBinutilsVersion() {
  const env = { noInitialRun: true };
  let stdout = "";
  env.print = (data) => { stdout += data + "\n"; };
  env.printErr = (data) => { stdout += data + "\n"; };

  const m = await callAS(env);

  try {
    m.callMain(["--version"]);
  } catch (e) {
    // Some tool builds exit through exceptions after printing output.
  }

  const firstLine = stdout.trim().split("\n")[0] || "";
  const match = firstLine.match(/(\d+\.\d+(?:\.\d+)?)/);
  return match ? match[1] : firstLine || "Unknown";
}

async function updateBinutilsVersion() {
  const el = document.getElementById("binutilsVersion");
  if (!el) {
    return;
  }

  try {
    el.textContent = await getBinutilsVersion();
  } catch (err) {
    el.textContent = "Unknown";
  }
}

function triggerBuild() {
  const code = window.editor.getValue();
  const ld = window.ldeditor.getValue();

  if (!code.trim()) {
    $("#output").html('<span style="color: red">Assembly code is empty</span>');
    return;
  }

  if (!ld.trim()) {
    $("#output").html('<span style="color: red">Linker script is empty</span>');
    return;
  }

  buildStuff(code, ld, getAssemblerSettings());
}

function selectBinaryBox() {
  if (document.selection) { // IE
      var range = document.body.createTextRange();
      range.moveToElementText(document.getElementById('binaryBox'));
      range.select();
  } else if (window.getSelection) {
      var range = document.createRange();
      range.selectNode(document.getElementById('binaryBox'));
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
  }
}

function bufferToHex(buff) {
  const dataview = new DataView(buff.buffer);
  let hexString = '';
  const hexOcts = (buff.byteLength / 4) >>> 0;
  for (let i = 0; i < hexOcts; i++) {
    const v = dataview.getInt32(i*4, true) >>> 0;
    hexString += v.toString(16).padStart(8, '0') + "\n"
  }
  return hexString;
}

function _arrayBufferToBase64( buffer ) {
    var binary = '';
    var bytes = new Uint8Array( buffer );
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++) {
        binary += String.fromCharCode( bytes[ i ] );
    }
    return window.btoa( binary );
}

async function copyResult(id, button) {
  const el = document.getElementById(id);
  if (!el) {
    return;
  }

  const text = el.textContent || '';

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('copy');
      selection.removeAllRanges();
    }

    if (button) {
      const original = button.dataset.label || button.textContent;
      button.dataset.label = original;
      button.textContent = 'Copied';
      button.classList.add('is-copied');
      window.setTimeout(() => {
        button.textContent = original;
        button.classList.remove('is-copied');
      }, 1400);
    }
  } catch (err) {
    console.error('Copy failed', err);
  }
}

async function doAssemble(code, ldscript, settings) {
  const object = await assemble(code, settings);
  const elf = await link(object, ldscript)
  const data = await dump(elf);
  const full_hex = await dump_as_hex(elf);
  const bin = await getBinaryText(elf);
  const bindata = await getBinaryData(elf);

  return {
    elf,
    data,
    bin: _arrayBufferToBase64(bin),
    hex: bufferToHex(bin),
    full_hex,
    bindata: bufferToHex(bindata),
  }
}

async function buildStuff(code, ldscript, settings = getAssemblerSettings()) {
  try {
    $("#building").show();
    const l = await doAssemble(code, ldscript, settings);
    $("#binaryBox").html(l.hex);
    $("#objDumpBox").html(l.data);
    $("#objDumpFullBox").html(l.full_hex);
    $("#binaryDataBox").html(l.bindata);
    $("#output").html('<span style="color: green">OK!</span>');
  } catch(e) {
    $("#output").html(`<span style="color: red">${e}</span>`);
  }
  $("#building").hide();
}

async function main(require) {
  window.require = require;
  window.doAssemble = doAssemble;
  window.buildStuff = buildStuff;
  window.copyResult = copyResult;
  window.updateBinutilsVersion = updateBinutilsVersion;
  window.triggerBuild = triggerBuild;
  window.updateAssemblerPreview = updateAssemblerPreview;

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      triggerBuild();
    }
  });

  ["archBase", "archAbi", "archExtra", "archCustomFlags", "extHypervisor", "extVector"].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', updateAssemblerPreview);
    document.getElementById(id)?.addEventListener('change', updateAssemblerPreview);
  });

  updateAssemblerPreview();

}

define(main)
