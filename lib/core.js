/*
 * Núcleo do renomeador de guias.
 * - PATTERNS: padrões de nomeação (Bradesco, SulAmérica, nome do paciente)
 * - sanitizeFileName / makeOutputName: padrão <numero_da_guia>_RA_doc<i>.pdf
 * - makeOutputNameFor: aplica o padrão escolhido à linha da tabela
 * - parseTable: tabela (CSV/XLSX) -> linhas { index, patient, guide }
 * - extractFileNumber: "3 - Maria.pdf" -> 3
 * - buildPlan: pareia PDFs e linhas, valida o lote e monta o plano
 * - createArchive: ZIP único com os PDFs renomeados, conteúdo inalterado
 *
 * Script clássico (window.GuiaCore) e módulo CommonJS.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./zip.js'));
  } else {
    root.GuiaCore = factory(root.Zip);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Zip) {
  'use strict';

  var ARCHIVE_NAME = 'guias_renomeadas.zip';
  var INVALID_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
  var SULAMERICA_PREFIX = '00000000000'; // 11 zeros antes do número da guia
  var DEFAULT_PATTERN = 'bradesco';

  // Limites de segurança da tabela (protegem a memória e o DOM).
  var MAX_TABLE_ROWS = 100000;
  var MAX_TABLE_COLUMNS = 1000;

  // Número sequencial: aceita "01", "Nº 01", "Guia 02", "Item 03", "Seq. 04".
  var SEQUENCE_RE = /^(?:n[º°o]?\.?\s*|n[uú]m(?:ero)?\s*|seq(?:uencial)?\.?\s*|guia\s*|item\s*)?0*(\d+)/i;

  var PATTERNS = {
    bradesco: {
      id: 'bradesco',
      label: 'Bradesco',
      template: '<numero_da_guia>_RA_doc<i>.pdf'
    },
    sulamerica: {
      id: 'sulamerica',
      label: 'SulAmérica',
      template: SULAMERICA_PREFIX + '<numero_da_guia>.pdf'
    },
    amhp: {
      id: 'amhp',
      label: 'AMHP',
      template: '<nome_do_paciente>.pdf'
    }
  };

  var ROLE_HEADERS = {
    number: [
      'numero',
      'num',
      'no',
      'n',
      'item',
      'seq',
      'sequencial',
      'ordem',
      'ord',
      '#'
    ],
    patient: [
      'paciente',
      'nome',
      'nome do paciente',
      'nome paciente',
      'nome completo',
      'cliente',
      'beneficiario'
    ],
    guide: [
      'guia',
      'numero da guia',
      'numero guia',
      'num guia',
      'n guia',
      'numero da guia de consulta',
      'guia de consulta',
      'guia consulta'
    ]
  };

  function sanitizeFileName(value) {
    var name = String(value == null ? '' : value)
      .normalize('NFC')
      .replace(INVALID_FILENAME_CHARS, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[.\s]+/, '')
      .replace(/[.\s]+$/, '');
    if (name.length > 120) {
      name = name.slice(0, 120).replace(/[.\s]+$/, '');
    }
    return name;
  }

  function makeOutputName(guide, index) {
    var i = Number(index);
    if (!Number.isInteger(i) || i < 1) {
      throw new Error('índice inválido para renomear: ' + index);
    }
    var base = sanitizeFileName(guide);
    if (!base) {
      throw new Error('o número da guia está vazio');
    }
    return base + '_RA_doc' + i + '.pdf';
  }

  /**
   * Monta o nome de saída conforme o padrão escolhido.
   * @param {string} patternId bradesco | sulamerica | paciente
   * @param {{index: number, patient?: string, guide?: string}} row
   */
  function makeOutputNameFor(patternId, row) {
    var id = String(patternId == null || patternId === '' ? DEFAULT_PATTERN : patternId);
    if (!PATTERNS[id]) {
      throw new Error('padrão de renomeação desconhecido: ' + id);
    }

    var line = row || {};
    var i = Number(line.index);
    if (!Number.isInteger(i) || i < 1) {
      throw new Error('índice inválido para renomear: ' + line.index);
    }

    if (id === 'bradesco') {
      return makeOutputName(line.guide, i);
    }

    if (id === 'sulamerica') {
      var guide = sanitizeFileName(line.guide);
      if (!guide) {
        throw new Error('o número da guia está vazio');
      }
      return SULAMERICA_PREFIX + guide + '.pdf';
    }

    var patient = sanitizeFileName(line.patient);
    if (!patient) {
      throw new Error('o nome do paciente está vazio');
    }
    return patient + '.pdf';
  }

  function normalizeKey(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9#]+/g, ' ')
      .trim();
  }

  function buildHeaderMap(cells) {
    var map = {};
    var roles = Object.keys(ROLE_HEADERS);
    cells.forEach(function (cell, column) {
      var key = normalizeKey(cell);
      if (!key) return;
      roles.forEach(function (role) {
        if (map[role] === undefined && ROLE_HEADERS[role].indexOf(key) !== -1) {
          map[role] = column;
        }
      });
    });
    return map;
  }

  function looksLikeHeader(cells) {
    var map = buildHeaderMap(cells || []);
    var matched = Object.keys(map).length;
    if (matched >= 2) return true;
    if (matched === 1) {
      var first = String((cells || [])[0] == null ? '' : cells[0]).trim();
      return first !== '' && !/^\d/.test(first);
    }
    return false;
  }

  function assignColumns(map) {
    var used = {};
    function take(role, fallback) {
      var column = map[role];
      if (column === undefined || used[column]) {
        column = fallback;
        while (used[column]) column++;
      }
      used[column] = true;
      return column;
    }
    return {
      number: take('number', 0),
      patient: take('patient', 1),
      guide: take('guide', 2)
    };
  }

  function cellText(value) {
    return String(value == null ? '' : value).trim();
  }

  /*
   * Lê a coluna de número sequencial aceitando zeros à esquerda ("01", "02")
   * e rótulos comuns de scanner ("Nº 01", "Guia 02", "Item 03").
   * Retorna null quando não há número válido.
   */
  function parseSequenceNumber(value) {
    var text = cellText(value);
    if (!text) return null;
    var match = SEQUENCE_RE.exec(text);
    if (!match) return null;
    var number = parseInt(match[1], 10);
    return Number.isFinite(number) ? number : null;
  }

  function isIntegerCell(value) {
    return parseSequenceNumber(value) !== null;
  }

  function rowWidth(rows) {
    var width = 0;
    (rows || []).forEach(function (row) {
      if (row && row.length > width) width = row.length;
    });
    return width;
  }

  function firstNonEmptyRow(rows) {
    for (var i = 0; i < (rows || []).length; i++) {
      var row = rows[i] || [];
      var filled = row.some(function (cell) {
        return cellText(cell) !== '';
      });
      if (filled) return row;
    }
    return null;
  }

  /**
   * Descobre quais colunas usar e se a numeração sequencial vem da tabela
   * ou é gerada automaticamente (1..n na ordem das linhas).
   * @param {string[][]} rows matriz completa (com o cabeçalho, se houver)
   * @param {boolean} headerDetected
   * @param {string} numbering auto | sequence | column
   */
  function detectLayout(rows, headerDetected, numbering) {
    var mode = numbering === 'sequence' || numbering === 'column' ? numbering : 'auto';
    var data = headerDetected ? rows.slice(1) : rows;
    var width = rowWidth(data);
    var map = headerDetected ? buildHeaderMap(rows[0]) : {};

    if (headerDetected) {
      var hasNumber = map.number !== undefined;

      if (mode === 'column' && !hasNumber) {
        return { autoNumber: false, missingNumberColumn: true, columns: assignColumns(map) };
      }
      if (mode !== 'sequence' && hasNumber) {
        return { autoNumber: false, columns: assignColumns(map) };
      }

      // Sem coluna de número: usa as colunas do cabeçalho e numera 1..n.
      var patient = map.patient;
      var guide = map.guide;
      if (guide === undefined && patient === undefined) {
        if (width <= 1) {
          guide = 0;
        } else {
          patient = 0;
          guide = 1;
        }
      } else if (guide === undefined) {
        guide = patient === 0 ? 1 : 0;
      } else if (patient === undefined) {
        patient = guide === 0 ? 1 : 0;
      }
      return { autoNumber: true, columns: { number: -1, patient: patient, guide: guide } };
    }

    // Sem cabeçalho: a posição das colunas sugere o formato.
    if (mode === 'sequence') {
      if (width <= 1) return { autoNumber: true, columns: { number: -1, patient: -1, guide: 0 } };
      if (width === 2) return { autoNumber: true, columns: { number: -1, patient: 0, guide: 1 } };
      return { autoNumber: true, columns: { number: -1, patient: 1, guide: 2 } };
    }
    if (mode === 'column') {
      return { autoNumber: false, columns: { number: 0, patient: 1, guide: 2 } };
    }

    var first = firstNonEmptyRow(data);
    var firstCell = first ? first[0] : '';
    var secondCell = first ? first[1] : '';

    if (width <= 1) {
      return { autoNumber: true, columns: { number: -1, patient: -1, guide: 0 } };
    }
    if (width === 2) {
      if (isIntegerCell(firstCell) && isIntegerCell(secondCell)) {
        return { autoNumber: false, columns: { number: 0, patient: -1, guide: 1 } };
      }
      if (isIntegerCell(firstCell)) {
        return { autoNumber: true, columns: { number: -1, patient: 1, guide: 0 } };
      }
      return { autoNumber: true, columns: { number: -1, patient: 0, guide: 1 } };
    }
    if (isIntegerCell(firstCell)) {
      return { autoNumber: false, columns: { number: 0, patient: 1, guide: 2 } };
    }
    return { autoNumber: true, columns: { number: -1, patient: 0, guide: 1 } };
  }

  /**
   * Converte a matriz da tabela em linhas normalizadas.
   * Cabeçalho é opcional e detectado por nomes conhecidos. Quando não existe
   * coluna de número, a sequência 1..n é gerada na ordem das linhas.
   * @param {string[][]} matrix
   * @param {{numbering?: 'auto'|'sequence'|'column'}} [options]
   */
  function parseTable(matrix, options) {
    var numbering = (options && options.numbering) || 'auto';
    var result = {
      rows: [],
      errors: [],
      warnings: [],
      headerDetected: false,
      numbering: 'column',
      autoNumber: false,
      columns: null
    };

    if (!Array.isArray(matrix) || matrix.length === 0) {
      result.errors.push('A tabela está vazia.');
      return result;
    }

    if (matrix.length > MAX_TABLE_ROWS) {
      result.errors.push(
        'A tabela tem mais de ' + MAX_TABLE_ROWS.toLocaleString('pt-BR') +
          ' linhas, acima do limite de segurança. Divida o lote em partes.'
      );
      return result;
    }
    if (rowWidth(matrix) > MAX_TABLE_COLUMNS) {
      result.errors.push(
        'A tabela passa de ' + MAX_TABLE_COLUMNS +
          ' colunas, acima do limite de segurança.'
      );
      return result;
    }

    var rows = matrix.map(function (row) {
      return Array.isArray(row) ? row : [];
    });
    var headerDetected = looksLikeHeader(rows[0]);
    var layout = detectLayout(rows, headerDetected, numbering);
    var columns = layout.columns;
    var lineOffset = 1;

    result.headerDetected = headerDetected;
    result.autoNumber = layout.autoNumber;
    result.numbering = layout.autoNumber ? 'sequence' : 'column';
    result.columns = columns;

    if (layout.missingNumberColumn) {
      result.errors.push(
        'A tabela não tem coluna de número sequencial. Use a numeração automática ou inclua a coluna.'
      );
      return result;
    }

    if (headerDetected) {
      rows = rows.slice(1);
      lineOffset = 2;
    }

    var parsed = [];
    rows.forEach(function (cells, offsetIndex) {
      var line = offsetIndex + lineOffset;
      var values = cells.map(cellText);
      var blank = values.every(function (value) {
        return value === '';
      });
      if (blank) return;

      var guide = columns.guide >= 0 ? values[columns.guide] || '' : '';
      var patient = columns.patient >= 0 ? values[columns.patient] || '' : '';
      var index;

      if (layout.autoNumber) {
        index = parsed.length + 1;
      } else {
        var rawNumber = values[columns.number] || '';
        var parsedNumber = parseSequenceNumber(rawNumber);
        if (parsedNumber === null) {
          result.errors.push(
            'Linha ' + line + ': o número sequencial deve ser um inteiro (valor: "' + rawNumber + '").'
          );
          return;
        }
        index = parsedNumber;
        if (index < 1) {
          result.errors.push('Linha ' + line + ': o número sequencial deve ser maior que zero.');
          return;
        }
      }

      if (!guide) {
        result.errors.push('Linha ' + line + ': o número da guia está vazio.');
      }
      if (!patient) {
        result.warnings.push('Linha ' + line + ': o nome do paciente está vazio.');
      }

      parsed.push({ index: index, patient: patient, guide: guide, line: line });
    });

    if (!parsed.length && !result.errors.length) {
      result.errors.push('Nenhuma linha com dados foi encontrada na tabela.');
    }

    var seen = {};
    var duplicates = [];
    parsed.forEach(function (row) {
      if (seen[row.index] && duplicates.indexOf(row.index) === -1) duplicates.push(row.index);
      seen[row.index] = true;
    });
    duplicates.sort(function (a, b) {
      return a - b;
    });
    if (duplicates.length) {
      result.errors.push('Números sequenciais repetidos: ' + duplicates.join(', ') + '.');
    }

    var max = parsed.reduce(function (top, row) {
      return Math.max(top, row.index);
    }, 0);
    var missing = [];
    for (var n = 1; n <= max; n++) {
      if (!seen[n]) missing.push(n);
    }
    if (missing.length) {
      result.errors.push('Números sequenciais faltando: ' + missing.join(', ') + '.');
    }

    var byGuide = {};
    parsed.forEach(function (row) {
      if (!row.guide) return;
      if (!byGuide[row.guide]) byGuide[row.guide] = [];
      byGuide[row.guide].push(row.line);
    });
    Object.keys(byGuide).forEach(function (guide) {
      if (byGuide[guide].length > 1) {
        result.warnings.push(
          'Número da guia repetido: ' + guide + ' (linhas ' + byGuide[guide].join(' e ') + ').'
        );
      }
    });

    parsed.sort(function (a, b) {
      return a.index - b.index;
    });

    result.rows = parsed;
    result.columns = columns;
    return result;
  }

  function extractFileNumber(fileName) {
    var base = String(fileName == null ? '' : fileName)
      .split(/[\\/]/)
      .pop()
      .replace(/\.[^.]+$/, '');
    var match = /(\d+)/.exec(base);
    if (!match) return null;
    return parseInt(match[1], 10);
  }

  /**
   * Pareia PDFs (numerados 1..n) com as linhas da tabela e valida o lote.
   * @param {{name: string, number?: number|null}[]} files
   * @param {{index: number, patient: string, guide: string}[]} rows
   */
  function buildPlan(files, rows, options) {
    var errors = [];
    var warnings = [];
    var entries = [];
    var pattern = String((options && options.pattern) || DEFAULT_PATTERN);

    files = Array.isArray(files) ? files : [];
    rows = Array.isArray(rows) ? rows : [];

    if (!PATTERNS[pattern]) {
      errors.push('Padrão de renomeação desconhecido: "' + pattern + '".');
      return { entries: entries, errors: errors, warnings: warnings, archiveName: ARCHIVE_NAME };
    }

    var byNumber = new Map();
    files.forEach(function (file) {
      var number = file.number === undefined ? extractFileNumber(file.name) : file.number;
      if (number === null || number === undefined) {
        errors.push('Não foi possível identificar o número no nome do arquivo "' + file.name + '".');
        return;
      }
      if (!byNumber.has(number)) byNumber.set(number, []);
      byNumber.get(number).push(file);
    });

    byNumber.forEach(function (group, number) {
      if (group.length > 1) {
        errors.push(
          'Mais de um arquivo com o número ' + number + ': ' +
            group.map(function (file) {
              return file.name;
            }).join(', ') + '.'
        );
      }
    });

    if (!rows.length) {
      errors.push('Anexe uma tabela com as guias.');
      return { entries: entries, errors: errors, warnings: warnings, archiveName: ARCHIVE_NAME };
    }

    var expected = rows.map(function (row) {
      return row.index;
    });

    var missing = expected
      .filter(function (number) {
        return !byNumber.has(number);
      })
      .sort(function (a, b) {
        return a - b;
      });
    if (missing.length) {
      errors.push('Faltam PDFs para os números: ' + missing.join(', ') + '.');
    }

    var extra = Array.from(byNumber.keys())
      .filter(function (number) {
        return expected.indexOf(number) === -1;
      })
      .sort(function (a, b) {
        return a - b;
      });
    if (extra.length) {
      errors.push('Há PDFs sem linha correspondente na tabela (números): ' + extra.join(', ') + '.');
    }

    if (files.length !== rows.length) {
      errors.push(
        'Quantidade divergente: ' + rows.length + ' linha(s) na tabela e ' +
          files.length + ' PDF(s) anexado(s).'
      );
    }

    rows.forEach(function (row) {
      if (!row.guide && pattern !== 'amhp') return;
      var group = byNumber.get(row.index);
      if (!group || group.length !== 1) return;

      var outputName;
      try {
        outputName = makeOutputNameFor(pattern, row);
      } catch (err) {
        errors.push('Linha ' + row.line + ': ' + err.message + '.');
        return;
      }

      entries.push({
        file: group[0],
        index: row.index,
        patient: row.patient,
        guide: row.guide,
        outputName: outputName
      });
    });

    var byName = {};
    var order = [];
    entries.forEach(function (entry) {
      var key = entry.outputName.toLowerCase();
      if (!byName[key]) {
        byName[key] = { name: entry.outputName, entries: [] };
        order.push(key);
      }
      byName[key].entries.push(entry);
    });

    // Nomes que só aparecem uma vez ficam reservados; as repetições recebem
    // sufixo (1), (2)... para não colidir nem com o nome original nem entre si.
    var used = {};
    order.forEach(function (key) {
      if (byName[key].entries.length === 1) used[key] = true;
    });

    order.forEach(function (key) {
      var group = byName[key];
      if (group.entries.length < 2) return;

      group.entries.sort(function (a, b) {
        return a.index - b.index;
      });
      var base = group.name.replace(/\.pdf$/i, '');
      var indexes = [];
      var generated = [];

      group.entries.forEach(function (entry) {
        indexes.push(entry.index);
        var n = 1;
        var candidate = base + ' (' + n + ').pdf';
        while (used[candidate.toLowerCase()]) {
          n++;
          candidate = base + ' (' + n + ').pdf';
        }
        used[candidate.toLowerCase()] = true;
        entry.outputName = candidate;
        generated.push(candidate);
      });

      warnings.push(
        'Nomes de arquivo repetidos no padrão ' + PATTERNS[pattern].label + ': "' +
          group.name + '" (números ' + indexes.join(', ') + '). Numeração adicionada: ' +
          generated.join(', ') + ' — confira e ajuste esses arquivos.'
      );
    });

    return { entries: entries, errors: errors, warnings: warnings, archiveName: ARCHIVE_NAME };
  }

  /**
   * Monta o ZIP único com os PDFs renomeados, sem alterar o conteúdo.
   * @param {{outputName: string, bytes: Uint8Array}[]} entries
   */
  function createArchive(entries) {
    return Zip.create(
      entries.map(function (entry) {
        return { name: entry.outputName, data: entry.bytes };
      })
    );
  }

  return {
    ARCHIVE_NAME: ARCHIVE_NAME,
    PATTERNS: PATTERNS,
    DEFAULT_PATTERN: DEFAULT_PATTERN,
    SULAMERICA_PREFIX: SULAMERICA_PREFIX,
    sanitizeFileName: sanitizeFileName,
    makeOutputName: makeOutputName,
    makeOutputNameFor: makeOutputNameFor,
    parseTable: parseTable,
    extractFileNumber: extractFileNumber,
    buildPlan: buildPlan,
    createArchive: createArchive
  };
});
