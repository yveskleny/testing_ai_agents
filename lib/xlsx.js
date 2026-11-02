/*
 * Leitor mínimo de .xlsx (primeira aba) sem bibliotecas externas.
 * Usa Zip.read() para abrir o pacote e expressões regulares para o XML.
 * Extrai a matriz de células como strings, pronta para virar tabela.
 *
 * Funciona como script clássico (window/Xlsx) e como módulo CommonJS.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./zip.js'));
  } else {
    root.Xlsx = factory(root.Zip);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Zip) {
  'use strict';

  var decoder = new TextDecoder('utf-8');

  function decodeXml(value) {
    if (!value) return '';
    return value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, hex) {
        return String.fromCodePoint(parseInt(hex, 16));
      })
      .replace(/&#(\d+);/g, function (_, dec) {
        return String.fromCodePoint(parseInt(dec, 10));
      })
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function textFrom(xml) {
    var parts = [];
    var re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    var match;
    while ((match = re.exec(xml))) parts.push(decodeXml(match[1]));
    return parts.join('');
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    var source = String(xml).replace(/<si\s*\/>/g, '<si></si>');
    var strings = [];
    var re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    var match;
    while ((match = re.exec(source))) strings.push(textFrom(match[1]));
    return strings;
  }

  function columnIndex(letters) {
    var index = 0;
    for (var i = 0; i < letters.length; i++) {
      index = index * 26 + (letters.charCodeAt(i) - 64);
    }
    return index - 1;
  }

  function attributes(text) {
    var result = {};
    var re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
    var match;
    while ((match = re.exec(text))) result[match[1]] = decodeXml(match[2]);
    return result;
  }

  function cellValue(tag, body, sharedStrings) {
    var type = tag.t;
    if (type === 'inlineStr') {
      var inline = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body || '');
      return inline ? textFrom(inline[1]) : textFrom(body || '');
    }
    var valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body || '');
    if (!valueMatch) return '';
    var raw = decodeXml(valueMatch[1]);
    if (type === 's') {
      var index = parseInt(raw, 10);
      return Number.isFinite(index) ? sharedStrings[index] || '' : '';
    }
    if (type === 'b') return raw === '1' ? 'VERDADEIRO' : 'FALSO';
    return raw;
  }

  function parseSheet(xml, sharedStrings) {
    var matrix = [];
    var rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
    var rowMatch;
    var autoRow = 0;

    while ((rowMatch = rowRe.exec(xml))) {
      var rowAttrs = attributes(rowMatch[1] || '');
      var rowNumber = rowAttrs.r ? parseInt(rowAttrs.r, 10) : autoRow + 1;
      autoRow = rowNumber;
      var cells = [];

      var cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      var cellMatch;
      var autoColumn = 0;
      while ((cellMatch = cellRe.exec(rowMatch[2] || ''))) {
        var tag = attributes(cellMatch[1] || '');
        var column = tag.r ? columnIndex(/^([A-Z]+)/.exec(tag.r)[1]) : autoColumn;
        autoColumn = column + 1;
        cells[column] = cellValue(tag, cellMatch[2], sharedStrings);
      }

      var width = cells.length;
      var row = new Array(width);
      for (var i = 0; i < width; i++) row[i] = cells[i] == null ? '' : cells[i];
      matrix[rowNumber - 1] = row;
    }

    var height = matrix.length;
    for (var r = 0; r < height; r++) {
      if (!matrix[r]) matrix[r] = [];
    }
    return matrix;
  }

  async function firstSheetPath(zip) {
    var workbook = await zip.get('xl/workbook.xml');
    var rels = await zip.get('xl/_rels/workbook.xml.rels');

    if (workbook) {
      var sheet = /<sheet\b([^>]*?)\/?>/.exec(decoder.decode(workbook));
      if (sheet) {
        var attrs = attributes(sheet[1]);
        var relId = attrs['r:id'];
        if (relId && rels) {
          var relations = decoder.decode(rels);
          var relRe = /<Relationship\b([^>]*?)\/?>/g;
          var relMatch;
          while ((relMatch = relRe.exec(relations))) {
            var rel = attributes(relMatch[1]);
            if (rel.Id === relId && rel.Target) {
              var target = rel.Target.replace(/^\/+/, '');
              if (target.indexOf('xl/') === 0) return target;
              return 'xl/' + target.replace(/^\.\//, '');
            }
          }
        }
      }
    }

    var candidates = zip
      .names()
      .filter(function (name) {
        return /^xl\/worksheets\/sheet\d+\.xml$/.test(name);
      })
      .sort(function (a, b) {
        return parseInt(a.replace(/\D+/g, ''), 10) - parseInt(b.replace(/\D+/g, ''), 10);
      });

    if (!candidates.length) throw new Error('Planilha não encontrada no arquivo .xlsx.');
    return candidates[0];
  }

  /**
   * Lê a primeira aba de um .xlsx.
   * @param {Uint8Array|ArrayBuffer} input
   * @returns {Promise<string[][]>}
   */
  async function read(input) {
    var zip = await Zip.read(input);
    var sheetPath = await firstSheetPath(zip);
    var sheetXml = await zip.get(sheetPath);
    if (!sheetXml) throw new Error('Não foi possível abrir a planilha do arquivo .xlsx.');
    var sharedXml = await zip.get('xl/sharedStrings.xml');

    return parseSheet(
      decoder.decode(sheetXml),
      parseSharedStrings(sharedXml ? decoder.decode(sharedXml) : '')
    );
  }

  return { read: read };
});
