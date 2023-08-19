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
async function callLd(env) {
  return new Promise((resolve) => {
    require(['./riscv64-linux-gnu-ld'], (Module) => {
      resolve(Module(env));
    });
  })
}

async function assemble(code) {
  console.log(`Assembling:\n${code}`);
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
        console.log(`Assembled:\n${out}`);
        if (!error) {
          const data = await m.FS.readFile("file.o")
          resolve(data)
        } else {
          reject(out);
        }
      }
    ]
    env.arguments = ["file.s", "-o","file.o"]
    callAS(env)
  })
}

async function link(object, ldscript) {
  console.log(`Linking:\n${bufferToHex(object).replace("\n","")} with ${ldscript}`);
  return new Promise((resolve, reject) => {
    const env = {}
    env.preRun = [
       (m) => {
        m.FS.writeFile("file.ld", ldscript)
      },
      (m) => {
        m.FS.writeFile("data.o", object)
      }
    ];
    let error = false;
    env.quit = (code, err)=>{
      if (env.quit && code !== 0) {
        error = true;
      }
      env.quit = null;
    };
    let out = "";
    env.print = (data) => {
        out += data + "\n";
    }
    env.printErr = (data) => {
      out += data + "\n";
    }
    env.postRun = [
      async (m) => {
        if (!error) {
          const data = await m.FS.readFile("file.elf")
          resolve(data)
        } else {
          reject(`LD: ${out}`);
        }
      }
    ]
    env.arguments = ["-T", "file.ld", "data.o", "-o", "file.elf"]
    callLd(env)
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
    env.arguments = ["-D", "file.elf"]
    callObjdump(env)
  })
}

async function dump_as_hex(elf) {
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
    env.arguments = ["-s", "file.elf"]
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

async function getBinaryData(elf) {
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
    env.arguments = ["-O", "binary", "file.elf", "file.bin", "--only-section", ".data*"]
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

async function doAssemble(code, ldscript) {
  const object = await assemble(code);
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

async function buildStuff(code, ldscript) {
  try {
    $("#building").show();
    const l = await doAssemble(code, ldscript);
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
}

define(main)