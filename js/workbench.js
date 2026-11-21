'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const all = (selector) => Array.from(document.querySelectorAll(selector));
  const svgNS = 'http://www.w3.org/2000/svg';
  function icon(name) {
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(svgNS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.append(use);
    return svg;
  }
  function element(tag, value, className) {
    const el = document.createElement(tag);
    if (value !== undefined) el.textContent = value;
    if (className) el.className = className;
    return el;
  }
  const store = {
    read(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
  };
  const draftKey = 'tl-riscv-workspace-v1';
  let draft;
  try {
    draft = JSON.parse(store.read(draftKey));
  } catch {}
  const settingsIds = ['archBase', 'archAbi', 'ext', 'flags', 'hyper', 'vector'];
  if (draft) {
    for (const id of settingsIds) {
      const el = $(id),
        value = draft[id];
      if (el.type === 'checkbox') el.checked = value === true;
      else if (
        typeof value === 'string' &&
        (el.tagName !== 'SELECT' || Array.from(el.options).some((o) => o.value === value))
      )
        el.value = value;
    }
    if (typeof draft.source === 'string') $('sourceCode').value = draft.source;
    if (typeof draft.linker === 'string') $('linkerCode').value = draft.linker;
  }
  CodeMirror.defineMode('lab-riscv', (config) => {
    const gas = CodeMirror.getMode(config, { name: 'gas', architecture: 'riscv' });
    return {
      ...gas,
      token(stream, state) {
        if (!state.tokenize && stream.peek() === '#') {
          stream.skipToEnd();
          return 'comment';
        }
        const style = gas.token(stream, state);
        const prefix = stream.string.slice(0, stream.start);
        if (
          !style &&
          /^\s*(?:[.\w$]+:\s*)?$/.test(prefix) &&
          /^[a-z][a-z0-9.]*$/i.test(stream.current())
        )
          return 'keyword';
        return style;
      },
    };
  });
  const editors = {};
  for (const [file, id, label] of [
    ['main', 'sourceCode', 'Assembly source'],
    ['linker', 'linkerCode', 'Linker script'],
  ]) {
    const ed = CodeMirror.fromTextArea($(id), {
      lineNumbers: true,
      theme: 'lab',
      mode: file === 'main' ? 'lab-riscv' : { name: 'gas', architecture: 'riscv' },
      indentUnit: 4,
      tabSize: 4,
      indentWithTabs: false,
      screenReaderLabel: label,
    });
    ed.getInputField().setAttribute('aria-label', label);
    // Let keyboard users leave either editor with Tab. Indent with Ctrl/Cmd-].
    ed.setOption('extraKeys', {
      Tab: false,
      'Shift-Tab': false,
      Esc: (cm) => cm.getInputField().blur(),
      'Ctrl-Enter': () => triggerBuild(),
      'Cmd-Enter': () => triggerBuild(),
    });
    editors[file] = ed;
  }
  let file = 'main',
    view = 'disasm',
    section = '.text',
    hexSection = 'text';
  let result = null,
    log = '',
    sections = new Map(),
    worker = null,
    busy = false,
    revision = 0,
    builtRevision = -1,
    jobRevision = -1,
    saveTimer,
    toastTimer;
  function save() {
    const state = { source: editors.main.getValue(), linker: editors.linker.getValue() };
    for (const id of settingsIds)
      state[id] = $(id).type === 'checkbox' ? $(id).checked : $(id).value;
    store.write(draftKey, JSON.stringify(state));
  }
  function effectiveFlags() {
    const base = $('archBase').value,
      extra =
        $('ext')
          .value.toLowerCase()
          .match(/[^,\s_]+/g) || [];
    if ($('hyper').checked) extra.push('h');
    if ($('vector').checked) extra.push('v');
    // Keep the base order and put optional standard single-letter extensions in ISA order.
    const order = 'giemafdqlcbkjtpvnh';
    const [, prefix, letters] = base.match(/^(rv\d+)([a-z]+)$/);
    const singles = new Set(letters + extra.filter((x) => x.length === 1).join(''));
    const standard = [...order].filter((c) => singles.delete(c)).join('');
    const long = [...new Set(extra.filter((x) => x.length > 1))];
    const march =
      prefix + standard + [...singles].join('') + (long.length ? '_' + long.join('_') : '');
    return { march, abi: $('archAbi').value, customFlags: $('flags').value.trim() };
  }
  function previewFlags() {
    const { march, abi, customFlags } = effectiveFlags();
    $('flagPreview').textContent = ['-march=' + march, '-mabi=' + abi, customFlags]
      .filter(Boolean)
      .join(' ');
    const advanced = !!(
      $('ext').value.trim() ||
      customFlags ||
      $('hyper').checked ||
      $('vector').checked
    );
    $('options').classList.toggle('has-options', advanced);
    $('options').title = $('flagPreview').textContent;
  }
  function status(label, style, glyph) {
    const node = $('buildStatus');
    node.className = 'tl-badge ' + style;
    node.replaceChildren(icon(glyph), document.createTextNode(label));
  }
  function changed() {
    revision++;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 250);
    if (!busy) {
      status(
        result || log ? 'Rebuild needed' : 'Ready to build',
        result || log ? 'warning' : '',
        'clock',
      );
      updateOutputFooter();
    }
  }
  window.addEventListener('pagehide', save);
  function cursor() {
    const point = editors[file].getCursor();
    $('position').textContent = 'Ln ' + (point.line + 1) + ', Col ' + (point.ch + 1);
  }
  for (const ed of Object.values(editors)) {
    ed.on('change', changed);
    ed.on('cursorActivity', cursor);
  }
  for (const id of settingsIds) {
    const el = $(id);
    el.addEventListener(
      el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input',
      () => {
        if (id === 'archBase') {
          const base = el.value,
            family = base.startsWith('rv32') ? 'ilp32' : 'lp64';
          const previous = $('archAbi').value.replace(/^(ilp32|lp64)/, '');
          $('archAbi').value = family + (base.includes('g') ? previous || 'd' : '');
        }
        previewFlags();
        changed();
      },
    );
  }
  function bindTabs(selector, attr, activate) {
    const tabs = all(selector);
    const select = (value) => {
      tabs.forEach((t) => {
        const active = t.dataset[attr] === value;
        t.setAttribute('aria-selected', String(active));
        t.tabIndex = active ? 0 : -1;
      });
      activate(value);
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(tab.dataset[attr]));
      tab.addEventListener('keydown', (event) => {
        const n = tabs.length;
        const index = { ArrowLeft: (i + n - 1) % n, ArrowRight: (i + 1) % n, Home: 0, End: n - 1 }[
          event.key
        ];
        if (index === undefined) return;
        event.preventDefault();
        tabs[index].focus();
        select(tabs[index].dataset[attr]);
      });
    });
    return select;
  }
  bindTabs('.file-tabs button', 'file', (next) => {
    file = next;
    for (const key of Object.keys(editors)) $('file-' + key).hidden = key !== file;
    editors[file].refresh();
    $('language').textContent = file === 'main' ? 'RISC-V Assembly' : 'GNU linker script';
    cursor();
  });
  const selectView = bindTabs('.result-tabs button', 'view', (next) => {
    view = next;
    $('result-view').setAttribute('aria-labelledby', 'tab-' + next);
    render();
  });
  function expand(toggle) {
    $('panes').classList.toggle('expanded', toggle);
    $('expand').setAttribute('aria-pressed', String(toggle));
    const name = toggle ? 'Restore split view' : 'Expand source editor';
    $('expand').title = name;
    $('expand').setAttribute('aria-label', name);
    $('expand').replaceChildren(icon(toggle ? 'collapse' : 'expand'));
    editors[file].refresh();
  }
  $('expand').onclick = () => expand(!$('panes').classList.contains('expanded'));
  document.addEventListener('keydown', (event) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key === 'Enter' &&
      !document.querySelector('dialog[open]')
    ) {
      event.preventDefault();
      triggerBuild();
    }
    if (
      event.key === 'Escape' &&
      $('panes').classList.contains('expanded') &&
      !document.querySelector('dialog[open]')
    )
      expand(false);
  });
  if (/Mac|iPhone|iPad/.test(navigator.platform)) $('hotkey').textContent = '⌘ ↵';
  function themeButton() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const title = 'Switch to ' + (dark ? 'light' : 'dark') + ' theme';
    $('theme').title = title;
    $('theme').setAttribute('aria-label', title);
    $('theme').replaceChildren(icon(dark ? 'sun' : 'moon'));
  }
  $('theme').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.write('tl-riscv-theme', next);
    themeButton();
  };
  themeButton();
  $('cite').onclick = () => $('citation').showModal();
  $('options').setAttribute('aria-label', 'ISA options');
  $('options').onclick = () => $('settings').showModal();
  for (const button of all('[data-close]')) button.onclick = () => button.closest('dialog').close();
  for (const dialog of all('dialog'))
    dialog.addEventListener('click', (event) => {
      const rect = dialog.getBoundingClientRect();
      if (
        event.target === dialog &&
        (event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom)
      )
        dialog.close();
    });
  function notice(message) {
    const n = $('notice');
    n.textContent = message;
    n.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      n.hidden = true;
    }, 1800);
  }
  async function copy(text) {
    try {
      if (!navigator.clipboard?.writeText) throw Error();
      await navigator.clipboard.writeText(text);
    } catch {
      const area = element('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;left:0;top:0;opacity:0';
      const previous = document.activeElement;
      (document.querySelector('dialog[open]') || document.body).append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      previous?.focus();
      if (!ok) {
        notice('Copy unavailable in this browser');
        return;
      }
    }
    notice('Copied to clipboard');
  }
  $('copyBib').onclick = () => copy($('bib').textContent);
  function parseSections(raw) {
    const parsed = new Map();
    let current = null;
    for (const line of raw.split('\n')) {
      const heading = line.match(/^Disassembly of section (.+):$/);
      if (heading) {
        current = { lines: [], rows: [] };
        parsed.set(heading[1], current);
        continue;
      }
      if (!current) continue;
      current.lines.push(line);
      if (!line.trim()) continue;
      const symbol = line.match(/^\s*([\da-f]+) <(.*)>:$/i);
      const insn = line.match(/^\s*([\da-f]+):\s+([\da-f]+)\s+(.*)$/i);
      if (symbol) current.rows.push({ symbol: symbol[2] });
      else if (insn)
        current.rows.push({
          addr: insn[1].padStart(8, '0'),
          encoding: insn[2],
          asm: insn[3].trim(),
        });
      else current.rows.push({ raw: line.trim() });
    }
    return parsed;
  }
  function sectionPicker(label, items, value, onChange) {
    const pick = element('select', undefined, 'section-select');
    pick.setAttribute('aria-label', label);
    for (const [key, title] of items) pick.add(new Option(title, key));
    pick.value = value;
    pick.onchange = () => {
      onChange(pick.value);
      render();
      $('resultContext').querySelector('select')?.focus();
    };
    const shell = element('span', undefined, 'scope-select');
    shell.append(pick, icon('chevron'));
    return [element('span', label, 'scope-label'), shell];
  }
  function hexWords(bytes) {
    const lines = [];
    for (let i = 0; i < bytes.length; i += 4) {
      // GNU RISC-V objects are little endian. Preserve trailing 8/16/24 bits.
      const word = Array.from(bytes.subarray(i, i + 4))
        .reverse()
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      lines.push(word);
    }
    return lines.join('\n');
  }
  function outputText() {
    if (view === 'console') return log;
    if (!result) return '';
    if (view === 'disasm')
      return section === '*' ? result.disasm : sections.get(section)?.lines.join('\n').trim() || '';
    return hexSection === 'all' ? result.fullHex : hexWords(result[hexSection]);
  }
  function disassembly(data) {
    const table = element('table'),
      head = table.createTHead().insertRow();
    for (const label of ['Address', 'Encoding', 'Instruction']) {
      const th = element('th', label);
      th.scope = 'col';
      head.append(th);
    }
    const tbody = table.createTBody();
    for (const item of data.rows) {
      const tr = tbody.insertRow();
      if (item.symbol !== undefined || item.raw !== undefined) {
        const td = tr.insertCell();
        td.colSpan = 3;
        if (item.symbol !== undefined) {
          tr.className = 'symbol';
          const label = element('span', undefined, 'symbolvalue');
          label.append(icon('branch'), document.createTextNode('<' + item.symbol + '>'));
          td.append(label);
        } else td.textContent = item.raw;
        continue;
      }
      for (const [value, cl] of [
        [item.addr, 'addr'],
        [item.encoding, 'encoding-word'],
      ]) {
        const td = tr.insertCell();
        td.className = cl;
        td.textContent = value;
      }
      const td = tr.insertCell(),
        space = item.asm.search(/\s/);
      td.append(element('span', space < 0 ? item.asm : item.asm.slice(0, space), 'mnemonic'));
      if (space >= 0) td.append(document.createTextNode(' ' + item.asm.slice(space).trim()));
    }
    return table;
  }
  function updateOutputFooter() {
    const stale = builtRevision !== revision,
      available = !busy && result && !stale;
    const hasOutput =
      view === 'console'
        ? log.length > 0
        : result &&
          (view === 'disasm'
            ? section === '*' ? result.disasm.length > 0 : sections.get(section)?.rows.length > 0
            : hexSection === 'all' ? result.fullHex.length > 0 : result[hexSection].length > 0);
    $('copy').disabled = !hasOutput || busy;
    const exportMode = view === 'hex' && hexSection !== 'all' ? hexSection : 'elf';
    $('download').dataset.mode = exportMode;
    $('download').querySelector('span').textContent =
      exportMode === 'elf' ? 'Export ELF' : 'Export .' + exportMode;
    $('download').disabled = !available;
    if (busy) $('outMeta').textContent = 'Building…';
    else if (result)
      $('outMeta').textContent = stale
        ? 'Previous build'
        : '.text ' + result.text.length + ' B  ·  .data ' + result.data.length + ' B';
    else $('outMeta').textContent = log
      ? stale ? 'Previous build diagnostics' : 'Build diagnostics'
      : 'Waiting for build';
  }
  function render() {
    const area = $('result-view'),
      context = $('resultContext');
    area.replaceChildren();
    context.replaceChildren();
    area.scrollTop = 0;
    area.scrollLeft = 0;
    if (view === 'console') {
      context.append(icon('terminal'), element('span', 'Toolchain log'));
      area.append(
        log
          ? element('pre', log)
          : element(
              'p',
              busy ? 'Build in progress…' : 'Build the workspace to see diagnostics.',
              'empty',
            ),
      );
    } else if (!result) {
      context.textContent = 'main.elf';
      area.append(
        element(
          'p',
          busy
            ? 'Building the workspace…'
            : log
              ? 'Open Console for build diagnostics.'
              : 'Build the workspace to inspect the output.',
          'empty',
        ),
      );
    } else if (view === 'disasm') {
      const items = [...sections.keys()].map((s) => [s, s]);
      items.push(['*', 'All sections (raw)']);
      context.append(...sectionPicker('Section', items, section, (v) => (section = v)));
      if (section === '*') area.append(element('pre', result.disasm));
      else area.append(disassembly(sections.get(section)));
    } else {
      context.append(
        ...sectionPicker(
          'Section',
          [
            ['text', '.text'],
            ['data', '.data'],
            ['all', 'All sections (raw)'],
          ],
          hexSection,
          (v) => (hexSection = v),
        ),
      );
      const text = outputText();
      area.append(
        text ? element('pre', text) : element('p', 'This section contains no bytes.', 'empty'),
      );
    }
    updateOutputFooter();
  }
  $('copy').onclick = () => copy(outputText());
  $('download').onclick = () => {
    if (!result || busy || revision !== builtRevision) return;
    const mode = $('download').dataset.mode;
    const blob = new Blob([result[mode]], { type: 'application/octet-stream' }),
      url = URL.createObjectURL(blob);
    const a = element('a');
    a.href = url;
    a.download = mode === 'elf' ? 'main.elf' : mode + '.bin';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const stages = all('#stages li');
  function setStage(name, state, ms) {
    const li = stages.find((el) => el.dataset.stage === name);
    if (!li) return;
    li.className = state;
    const i = li.querySelector('i');
    i.replaceChildren();
    const glyph = { active: 'spinner', done: 'check', failed: 'close' }[state];
    if (glyph) i.append(icon(glyph));
    const details =
      name + ' · ' + (state || 'Queued') + (ms === undefined ? '' : ' · ' + Math.round(ms) + ' ms');
    li.title = details;
    li.setAttribute('aria-label', details);
  }
  function elapsed(ms) {
    return ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(2) + ' s';
  }
  function setBusy(value) {
    busy = value;
    $('build').disabled = value;
    $('build')
      .querySelector('svg')
      .replaceWith(icon(value ? 'spinner' : 'play'));
    $('build').querySelector('span').textContent = value ? 'Building' : 'Build';
  }
  function receive({ data }) {
    if (data.type === 'version') {
      $('version').textContent = data.value;
      return;
    }
    if (data.type === 'stage') {
      setStage(data.name, data.state, data.ms);
      return;
    }
    if (data.type !== 'complete' && data.type !== 'failure') return;
    setBusy(false);
    log = data.log;
    $('elapsed').querySelector('span').textContent = elapsed(data.ms);
    builtRevision = jobRevision;
    if (data.type === 'complete') {
      result = data;
      sections = parseSections(data.disasm);
      if (section !== '*' && !sections.has(section))
        section = sections.has('.text') ? '.text' : sections.keys().next().value || '*';
      if (revision !== builtRevision) status('Rebuild needed', 'warning', 'clock');
      else status('Build successful', 'success', 'checkcircle');
      render();
    } else {
      result = null;
      setStage(data.name, 'failed');
      if (revision !== builtRevision) status('Rebuild needed', 'warning', 'clock');
      else status('Build failed', 'error-state', 'alert');
      selectView('console');
    }
  }
  function runtimeFailure(message) {
    worker?.terminate();
    worker = null;
    setBusy(false);
    result = null;
    builtRevision = jobRevision;
    const active = stages.find((el) => el.className === 'active');
    if (active) setStage(active.dataset.stage, 'failed');
    log = 'The toolchain could not run. ' + message + '\nPress Build to retry.';
    $('elapsed').querySelector('span').textContent = 'Stopped';
    status('Toolchain error', 'error-state', 'alert');
    selectView('console');
  }
  function triggerBuild() {
    if (busy) return;
    save();
    jobRevision = revision;
    result = null;
    log = '';
    setBusy(true);
    status('Building', 'info', 'spinner');
    $('elapsed').querySelector('span').textContent = 'Running';
    for (const li of stages) setStage(li.dataset.stage, '');
    render();
    try {
      if (!worker) {
        worker = new Worker('js/build-worker.js?v=20261120');
        worker.onmessage = receive;
        worker.onerror = (e) => runtimeFailure(e.message || 'Worker unavailable.');
        worker.postMessage({ type: 'version' });
      }
      worker.postMessage({
        type: 'build',
        source: editors.main.getValue(),
        linker: editors.linker.getValue(),
        ...effectiveFlags(),
      });
    } catch (error) {
      runtimeFailure(error.message);
    }
  }
  $('build').onclick = triggerBuild;
  if (location.hostname === 'riscvasm.lucasteske.dev') {
    const script = document.createElement('script');
    script.defer = true;
    script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    script.dataset.cfBeacon = '{"token": "6fdff3f05d2847b58d553381bb1e8115"}';
    document.body.appendChild(script);
  }
  previewFlags();
  render();
  const sample =
    editors.main.getValue() === $('sourceCode').defaultValue &&
    editors.linker.getValue() === $('linkerCode').defaultValue &&
    $('flagPreview').textContent === '-march=rv64gc -mabi=lp64d';
  if (!draft || sample) triggerBuild();
  else status('Ready to build', '', 'clock');
})();
