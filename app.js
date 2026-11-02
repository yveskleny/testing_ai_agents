/* Interface do renomeador de guias: liga os campos de arquivo ao núcleo. */
(function () {
  'use strict';

  var Core = window.GuiaCore;
  var NUMBERING_HINTS = {
    auto: 'Sem coluna de número, a ordem das linhas define o 1..n.',
    sequence: 'A coluna de número é ignorada: vale a ordem das linhas.',
    column: 'A tabela precisa ter uma coluna de número (1..n).'
  };
  var PATTERN_HINTS = {
    bradesco: 'Ex.: 123456789_RA_doc1.pdf',
    sulamerica: 'Ex.: 00000000000123456789.pdf',
    amhp: 'Ex.: Maria Silva.pdf'
  };

  // Limite de segurança: não lê uma tabela maior que isto para a memória.
  var MAX_TABLE_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

  var state = {
    pdfs: [],
    table: null,
    tableFile: null,
    tableError: '',
    pattern: 'bradesco',
    numbering: 'auto',
    tableMatrix: null,
    plan: null,
    issues: [],
    warnings: [],
    busy: false,
    batch: 0
  };

  var els = {};
  var toastTimer = null;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    els.pdfInput = document.getElementById('pdf-input');
    els.pdfDrop = document.getElementById('pdf-drop');
    els.pdfsBadge = document.getElementById('pdfs-badge');
    els.pdfsSummary = document.getElementById('pdfs-summary');
    els.clearPdfs = document.getElementById('clear-pdfs');
    els.fileList = document.getElementById('file-list');

    els.tableInput = document.getElementById('table-input');
    els.tableDrop = document.getElementById('table-drop');
    els.tableBadge = document.getElementById('table-badge');
    els.tableSummary = document.getElementById('table-summary');
    els.tablePreview = document.getElementById('table-preview');

    els.resultBadge = document.getElementById('result-badge');
    els.patternSelect = document.getElementById('pattern-select');
    els.patternHint = document.getElementById('pattern-hint');
    els.numberingSelect = document.getElementById('numbering-select');
    els.numberingHint = document.getElementById('numbering-hint');
    els.stats = document.getElementById('stats');
    els.statRows = document.getElementById('stat-rows');
    els.statFiles = document.getElementById('stat-files');
    els.statReady = document.getElementById('stat-ready');
    els.issues = document.getElementById('issues');
    els.renameTable = document.getElementById('rename-table');
    els.renameBody = document.getElementById('rename-body');
    els.renameEmpty = document.getElementById('rename-empty');
    els.generate = document.getElementById('generate');
    els.actionsHint = document.getElementById('actions-hint');
    els.toast = document.getElementById('toast');

    wireDropzone(els.pdfDrop, els.pdfInput, handlePdfFiles);
    wireDropzone(els.tableDrop, els.tableInput, handleTableFiles);

    els.clearPdfs.addEventListener('click', function () {
      state.pdfs = [];
      recompute();
    });

    els.generate.addEventListener('click', generate);

    if (els.patternSelect) {
      els.patternSelect.value = state.pattern;
      els.patternSelect.addEventListener('change', function () {
        state.pattern = els.patternSelect.value;
        updatePatternHint();
        recompute();
      });
    }
    updatePatternHint();

    if (els.numberingSelect) {
      els.numberingSelect.value = state.numbering;
      els.numberingSelect.addEventListener('change', function () {
        state.numbering = els.numberingSelect.value;
        updateNumberingHint();
        applyTable();
        recompute();
      });
    }
    updateNumberingHint();

    // Impede que um arquivo solto fora das áreas abra no navegador.
    window.addEventListener('dragover', function (event) {
      event.preventDefault();
    });
    window.addEventListener('drop', function (event) {
      event.preventDefault();
    });

    recompute();
  }

  function wireDropzone(zone, input, handler) {
    ['dragenter', 'dragover'].forEach(function (type) {
      zone.addEventListener(type, function (event) {
        event.preventDefault();
        zone.classList.add('dragging');
      });
    });
    ['dragleave', 'dragend'].forEach(function (type) {
      zone.addEventListener(type, function () {
        zone.classList.remove('dragging');
      });
    });
    zone.addEventListener('drop', function (event) {
      event.preventDefault();
      zone.classList.remove('dragging');
      if (event.dataTransfer && event.dataTransfer.files.length) {
        handler(event.dataTransfer.files);
      }
    });
    zone.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        input.click();
      }
    });
    input.addEventListener('change', function () {
      if (input.files && input.files.length) handler(input.files);
      input.value = '';
    });
  }

  async function handlePdfFiles(fileList) {
    var files = Array.prototype.slice.call(fileList);
    if (!files.length) return;
    var batch = ++state.batch;
    state.busy = true;
    render();

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var duplicated = state.pdfs.some(function (item) {
        return item.name === file.name && item.size === file.size;
      });
      if (duplicated) continue;

      var isPdf = await looksLikePdf(file);
      if (batch !== state.batch) return;
      state.pdfs.push({
        file: file,
        name: file.name,
        size: file.size,
        number: Core.extractFileNumber(file.name),
        isPdf: isPdf
      });
      render();
    }

    state.pdfs.sort(function (a, b) {
      var left = a.number == null ? Infinity : a.number;
      var right = b.number == null ? Infinity : b.number;
      return left - right || a.name.localeCompare(b.name);
    });
    state.busy = false;
    recompute();
  }

  async function looksLikePdf(file) {
    try {
      var head = new Uint8Array(await readBlob(file.slice(0, 1024), 'buffer'));
      return new TextDecoder('latin1').decode(head).indexOf('%PDF-') !== -1;
    } catch (error) {
      return false;
    }
  }

  /* Lê um Blob/File como texto ou bytes, com fallback para FileReader. */
  function readBlob(blob, mode) {
    if (mode === 'text' && typeof blob.text === 'function') return blob.text();
    if (mode === 'buffer' && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(reader.error || new Error('falha ao ler o arquivo'));
      };
      if (mode === 'text') reader.readAsText(blob);
      else reader.readAsArrayBuffer(blob);
    });
  }

  async function handleTableFiles(fileList) {
    var file = fileList[0];
    if (!file) return;
    state.busy = true;
    state.tableError = '';
    render();

    try {
      state.tableMatrix = await readTableFile(file);
      applyTable();
      state.tableFile = { name: file.name, size: file.size };
    } catch (error) {
      state.tableMatrix = null;
      state.table = null;
      state.tableFile = { name: file.name, size: file.size };
      state.tableError = 'Não foi possível ler "' + file.name + '": ' + error.message;
    }

    state.busy = false;
    recompute();
  }

  async function readTableFile(file) {
    var name = file.name.toLowerCase();

    if (file.size > MAX_TABLE_FILE_BYTES) {
      throw new Error(
        'o arquivo tem ' + (file.size / 1048576).toFixed(1) +
          ' MB, acima do limite de segurança de 25 MB. Divida a tabela em partes.'
      );
    }

    if (/\.xls$/.test(name)) {
      throw new Error('o formato .xls antigo não é suportado. Salve como .xlsx ou .csv.');
    }
    if (/\.xlsx?$/.test(name)) {
      return window.Xlsx.read(await readBlob(file, 'buffer'));
    }
    if (/\.csv$/.test(name) || /\.txt$/.test(name)) {
      return window.Csv.parse(await readBlob(file, 'text'));
    }

    var head = new Uint8Array(await readBlob(file.slice(0, 4), 'buffer'));
    if (head[0] === 0x50 && head[1] === 0x4b) {
      return window.Xlsx.read(await readBlob(file, 'buffer'));
    }
    return window.Csv.parse(await readBlob(file, 'text'));
  }

  function recompute() {
    var hasInput = state.pdfs.length > 0 || state.table !== null || state.tableFile !== null;

    if (!hasInput) {
      state.plan = { entries: [], errors: [], warnings: [], archiveName: Core.ARCHIVE_NAME };
      state.issues = [];
      state.warnings = [];
      render();
      return;
    }

    var rows = state.table ? state.table.rows : [];
    var files = state.pdfs.map(function (item) {
      return { name: item.name, number: item.number, ref: item };
    });

    var plan = Core.buildPlan(files, rows, { pattern: state.pattern });
    var invalid = state.pdfs.filter(function (item) {
      return !item.isPdf;
    });
    if (invalid.length) {
      plan.errors.unshift(
        'Estes arquivos não são PDFs válidos: ' +
          invalid
            .map(function (item) {
              return item.name;
            })
            .join(', ') +
          '.'
      );
    }

    var issues = [];
    if (state.table) issues = issues.concat(state.table.errors);
    if (state.tableError) issues.push(state.tableError);
    issues = unique(issues.concat(plan.errors));

    state.plan = plan;
    state.issues = issues;
    state.warnings = unique(
      (state.table ? state.table.warnings : []).concat(plan.warnings)
    );
    render();
  }

  function unique(list) {
    var seen = {};
    return list.filter(function (item) {
      if (Object.prototype.hasOwnProperty.call(seen, item)) return false;
      seen[item] = true;
      return true;
    });
  }

  function updatePatternHint() {
    if (!els.patternHint) return;
    els.patternHint.textContent = PATTERN_HINTS[state.pattern] || '';
  }

  function updateNumberingHint() {
    if (!els.numberingHint) return;
    els.numberingHint.textContent = NUMBERING_HINTS[state.numbering] || '';
  }

  /* Reaplica a leitura da tabela quando o modo de numeração muda. */
  function applyTable() {
    if (!state.tableMatrix) return;
    state.table = Core.parseTable(state.tableMatrix, { numbering: state.numbering });
  }

  function canGenerate() {
    return (
      !state.busy &&
      state.plan !== null &&
      state.plan.errors.length === 0 &&
      state.plan.entries.length > 0 &&
      state.pdfs.length === state.plan.entries.length &&
      state.pdfs.every(function (item) {
        return item.isPdf;
      })
    );
  }

  function render() {
    renderFiles();
    renderTable();
    renderStats();
    renderIssues();
    renderRename();
    renderButton();
  }

  function renderFiles() {
    var count = state.pdfs.length;
    els.pdfsBadge.textContent = count === 1 ? '1 arquivo' : count + ' arquivos';
    els.pdfsBadge.className = 'badge' + (count ? ' ok' : '');
    els.clearPdfs.hidden = count === 0;
    els.pdfsSummary.textContent = count
      ? state.busy
        ? 'Lendo arquivos…'
        : count + ' PDF(s) anexado(s).'
      : 'Nenhum PDF anexado ainda.';

    els.fileList.textContent = '';
    var entries = state.plan ? state.plan.entries : [];

    state.pdfs.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'file-item' + (item.isPdf ? '' : ' invalid');

      var number = document.createElement('span');
      number.className = 'file-num';
      number.textContent = item.number == null ? '?' : String(item.number);
      li.appendChild(number);

      var name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = item.name;
      name.title = item.name;
      li.appendChild(name);

      var output = document.createElement('span');
      output.className = 'file-out';
      var entry = entries.find(function (candidate) {
        return candidate.index === item.number;
      });
      if (!item.isPdf) {
        output.textContent = 'não é um PDF válido';
      } else if (entry) {
        output.textContent = '→ ';
        var strong = document.createElement('strong');
        strong.textContent = entry.outputName;
        output.appendChild(strong);
      } else {
        output.textContent = 'sem par na tabela';
      }
      li.appendChild(output);

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn';
      remove.textContent = '✕';
      remove.title = 'Remover ' + item.name;
      remove.setAttribute('aria-label', 'Remover ' + item.name);
      remove.addEventListener('click', function () {
        var position = state.pdfs.indexOf(item);
        if (position !== -1) state.pdfs.splice(position, 1);
        recompute();
      });
      li.appendChild(remove);

      els.fileList.appendChild(li);
    });
  }

  function renderTable() {
    var count = state.table ? state.table.rows.length : 0;
    els.tableBadge.textContent = state.table ? count + ' linha(s)' : 'sem tabela';
    els.tableBadge.className = 'badge' + (state.table && !state.table.errors.length ? ' ok' : '');

    if (state.tableError) {
      els.tableSummary.textContent = state.tableFile ? state.tableFile.name : 'Erro na tabela';
    } else if (state.tableFile) {
      els.tableSummary.textContent =
        state.tableFile.name + (state.table ? ' • ' + count + ' linha(s)' : '');
    } else {
      els.tableSummary.textContent = 'Nenhuma tabela anexada ainda.';
    }

    els.tablePreview.textContent = '';

    if (!state.table) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'A prévia da tabela aparece aqui.';
      els.tablePreview.appendChild(empty);
      return;
    }

    var rows = state.table.rows;
    if (!rows.length) {
      var noRows = document.createElement('p');
      noRows.className = 'empty';
      noRows.textContent = 'Nenhuma linha com dados foi encontrada.';
      els.tablePreview.appendChild(noRows);
      return;
    }

    var table = document.createElement('table');
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    ['Nº', 'Paciente', 'Nº da guia'].forEach(function (label) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      [String(row.index), row.patient || '—', row.guide || '—'].forEach(function (value) {
        var td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    if (state.table.autoNumber) {
      var note = document.createElement('p');
      note.className = 'table-note';
      note.textContent =
        state.numbering === 'sequence'
          ? 'Numeração forçada 1..' + rows.length + ' pela ordem das linhas.'
          : 'Sem coluna de número: sequência 1..' + rows.length + ' gerada pela ordem das linhas.';
      els.tablePreview.appendChild(note);
    }

    els.tablePreview.appendChild(table);
  }

  function renderStats() {
    var rows = state.table ? state.table.rows.length : 0;
    var entries = state.plan ? state.plan.entries.length : 0;

    if (!state.pdfs.length && !state.table) {
      els.stats.hidden = true;
      return;
    }

    els.stats.hidden = false;
    els.statRows.textContent = String(rows);
    els.statFiles.textContent = String(state.pdfs.length);
    els.statReady.textContent = String(entries);
  }

  function renderIssues() {
    els.issues.textContent = '';

    state.issues.forEach(function (message) {
      els.issues.appendChild(issueNode('error', message));
    });
    state.warnings.forEach(function (message) {
      els.issues.appendChild(issueNode('warning', message));
    });

    if (canGenerate()) {
      els.issues.appendChild(
        issueNode('success', 'Tudo certo: ' + state.plan.entries.length + ' guia(s) prontas para renomear.')
      );
    }
  }

  function issueNode(kind, message) {
    var box = document.createElement('div');
    box.className = 'issue ' + kind;
    var icon = document.createElement('span');
    icon.className = 'issue-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = kind === 'error' ? '!' : kind === 'warning' ? '⚠' : '✓';
    box.appendChild(icon);
    var text = document.createElement('span');
    text.textContent = message;
    box.appendChild(text);
    return box;
  }

  function renderRename() {
    var entries = state.plan ? state.plan.entries : [];
    els.renameBody.textContent = '';

    if (!entries.length) {
      els.renameTable.hidden = true;
      els.renameEmpty.hidden = false;
      return;
    }

    els.renameTable.hidden = false;
    els.renameEmpty.hidden = true;

    entries.forEach(function (entry) {
      var tr = document.createElement('tr');
      if (!entry.guide) tr.className = 'problem';

      [String(entry.index), entry.patient || '—', entry.guide || '—', entry.file.name].forEach(
        function (value) {
          var td = document.createElement('td');
          td.textContent = value;
          td.title = value;
          tr.appendChild(td);
        }
      );

      var output = document.createElement('td');
      output.className = 'name';
      output.textContent = entry.outputName;
      tr.appendChild(output);

      els.renameBody.appendChild(tr);
    });
  }

  function renderButton() {
    var ready = canGenerate();
    els.generate.disabled = !ready;
    els.generate.textContent = state.busy
      ? 'Processando…'
      : ready
        ? 'Gerar e baixar ZIP (' + state.plan.entries.length + ')'
        : 'Gerar e baixar ZIP';

    if (els.resultBadge) {
      els.resultBadge.className = 'badge' + (state.issues.length ? ' error' : ready ? ' ok' : '');
      els.resultBadge.textContent = state.issues.length
        ? 'há pendências'
        : ready
          ? 'pronto'
          : 'aguardando';
    }

    if (state.pdfs.length && !state.table) {
      els.actionsHint.textContent = 'Anexe a tabela das guias para parear os PDFs.';
    } else if (state.table && !state.pdfs.length) {
      els.actionsHint.textContent = 'Anexe os PDFs numerados de 1 a n.';
    } else if (ready) {
      els.actionsHint.textContent =
        'Os ' + state.plan.entries.length + ' PDFs serão empacotados em ' + Core.ARCHIVE_NAME + '.';
    } else {
      els.actionsHint.textContent =
        'A geração é liberada quando todos os PDFs de 1 a n estiverem pareados com a tabela.';
    }
  }

  async function generate() {
    if (!canGenerate()) return;

    state.busy = true;
    render();

    try {
      var entries = [];
      for (var i = 0; i < state.plan.entries.length; i++) {
        var entry = state.plan.entries[i];
        var bytes = new Uint8Array(await readBlob(entry.file.ref.file, 'buffer'));
        entries.push({ outputName: entry.outputName, bytes: bytes });
      }

      var archive = Core.createArchive(entries);
      download(archive, state.plan.archiveName);
      showToast(entries.length + ' guia(s) renomeada(s). ZIP baixado.');
    } catch (error) {
      state.issues = state.issues.concat('Não foi possível gerar o ZIP: ' + error.message);
    } finally {
      state.busy = false;
      render();
    }
  }

  function download(bytes, fileName) {
    var blob = new Blob([bytes], { type: 'application/zip' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2000);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.hidden = true;
    }, 5000);
  }
})();
