/*
 * Leitor CSV mínimo (RFC 4180) com detecção de separador (; , tab), aspas
 * escapadas, quebras de linha dentro de aspas e remoção de BOM.
 *
 * Script clássico (window.Csv) e módulo CommonJS.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Csv = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CANDIDATES = [';', ',', '\t'];

  function stripBom(text) {
    return String(text).charCodeAt(0) === 0xfeff ? String(text).slice(1) : String(text);
  }

  function countOutsideQuotes(text, delimiter) {
    var count = 0;
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '"') {
        if (inQuotes && text[i + 1] === '"') i++;
        else inQuotes = !inQuotes;
      } else if (!inQuotes && ch === delimiter) {
        count++;
      }
    }
    return count;
  }

  function detectDelimiter(text) {
    var source = stripBom(text);
    var best = ',';
    var bestCount = 0;
    CANDIDATES.forEach(function (candidate) {
      var count = countOutsideQuotes(source, candidate);
      if (count > bestCount) {
        best = candidate;
        bestCount = count;
      }
    });
    return best;
  }

  /**
   * Converte o texto CSV em uma matriz de strings.
   * @param {string} text
   * @returns {string[][]}
   */
  function parse(text) {
    var source = stripBom(text == null ? '' : text)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
    var delimiter = detectDelimiter(source);

    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;

    for (var i = 0; i < source.length; i++) {
      var ch = source[i];

      if (inQuotes) {
        if (ch === '"') {
          if (source[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
        continue;
      }

      if (ch === '"' && field === '') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }

    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }

    return rows;
  }

  return { parse: parse, detectDelimiter: detectDelimiter, stripBom: stripBom };
});
