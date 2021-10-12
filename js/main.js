async function callAS(env) {
  return new Promise((resolve) => {
    require(['./riscv64-linux-gnu-as'], (Module) => {
      resolve(Module(env));
    });
  })
}
async function callObjdump(env) {
  return new Promise((resolve) => {
    require(['./riscv64-linux-gnu-objdump'], (Module) => {
      resolve(Module(env));
    });
  })
}
async function callObjcopy(env) {
  return new Promise((resolve) => {
    require(['./riscv64-linux-gnu-objcopy'], (Module) => {
      resolve(Module(env));
    });
  })
}

async function assemble(code) {
  return new Promise((resolve, reject) => {
    const env = {}
    env.preRun = [(m) => m.FS.writeFile("file.s", code)];
    let out = "";
    env.print = (data) => {
        out += data + "\n";
    }
    env.printErr = (data) => {
      out += data + "\n";
    }
    let error = false;
    env.quit = (code, err)=>{
      if (env.quit && code !== 0) {
        error = true;
      }
      env.quit = null;
    };
    env.postRun = [
      async (m) => {
        if (!error) {
          const data = await m.FS.readFile("file.elf")
          resolve(data)
        } else {
          reject(out);
        }
      }
    ]
    env.arguments = ["file.s", "-o","file.elf"]
    callAS(env)
  })
}

async function dump(elf) {
  return new Promise((resolve) => {
    const env = {}
    env.preRun = [
      (m) => {
        m.FS.writeFile("file.elf", elf)
      }
    ];
    let stdout = "";
    env.print = (data) => {
        stdout += data + "\n";
    }
    env.postRun = [
      async (m) => {
        resolve(stdout)
      }
    ]
    env.arguments = ["-S", "file.elf"]
    callObjdump(env)
  })
}

async function getBinaryText(elf) {
  return new Promise((resolve) => {
    const env = {}
    env.preRun = [
      (m) => {
        m.FS.writeFile("file.elf", elf)
      }
    ];
    env.postRun = [
      async (m) => {
        const data = await m.FS.readFile("file.bin")
        resolve(data)
      }
    ]
    env.arguments = ["-O", "binary", "file.elf", "file.bin", "--only-section", ".text*"]
    callObjcopy(env)
  })
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

async function doAssemble(code) {
  const elf = await assemble(code);
  const data = await dump(elf);
  const bin = await getBinaryText(elf);

  return {
    elf,
    data,
    bin: _arrayBufferToBase64(bin),
    hex: bufferToHex(bin)
  }
}

async function buildStuff() {
  try {
    $("#building").show();
    const code = $("#sourceCodeBox").val();
    const l = await doAssemble(code);
    $("#binaryBox").html(l.hex);
    $("#objDumpBox").html(l.data);
    $("#output").html('<span style="color: green">OK!</span>');
  } catch(e) {
    $("#output").html(`<span style="color: red">${e}</span>`);
  }
  $("#building").hide();
}

async function main(require) {
  window.require = require;
  window.doAssemble = doAssemble;
}

define(main)