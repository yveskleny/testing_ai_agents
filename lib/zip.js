/*
 * Zip minimalista, sem dependências.
 * - create(): grava um ZIP "stored" (sem compressão), suficiente para PDFs.
 * - read(): lê o diretório central e descomprime entradas deflate-raw
 *   usando DecompressionStream (nativo no navegador e no Node 18+).
 *
 * Funciona como script clássico (window/Zip) e como módulo CommonJS.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Zip = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ZIP "simples" (sem ZIP64): limite de 65.535 entradas e 4 GB no total.
  var MAX_ENTRIES = 0xffff;
  var MAX_SIZE = 0xffffffff;

  // Limites de segurança na leitura de pacotes (evitam "zip bombs").
  var MAX_INFLATED_SIZE = 64 * 1024 * 1024; // 64 MiB por entrada
  var MAX_TOTAL_INFLATED = 128 * 1024 * 1024; // 128 MiB por arquivo lido

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  var encoder = new TextEncoder();
  var decoder = new TextDecoder('utf-8');

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    return encoder.encode(String(data));
  }

  function dosDateTime(date) {
    var d = date || new Date();
    var year = Math.min(2107, Math.max(1980, d.getFullYear()));
    var time =
      ((d.getHours() & 31) << 11) |
      ((d.getMinutes() & 63) << 5) |
      ((Math.floor(d.getSeconds() / 2)) & 31);
    var day =
      (((year - 1980) & 127) << 9) |
      (((d.getMonth() + 1) & 15) << 5) |
      (d.getDate() & 31);
    return { time: time, date: day };
  }

  /**
   * Cria um ZIP com os arquivos informados.
   * @param {{name: string, data: Uint8Array|ArrayBuffer|string}[]} files
   * @returns {Uint8Array}
   */
  function create(files) {
    files = Array.isArray(files) ? files : [];
    if (files.length > MAX_ENTRIES) {
      throw new Error(
        'o lote tem ' + files.length + ' arquivos, acima do limite de ' + MAX_ENTRIES +
          ' do ZIP simples. Divida em lotes menores.'
      );
    }

    var locals = [];
    var centrals = [];
    var offset = 0;
    var stamp = dosDateTime(new Date());

    files.forEach(function (file) {
      var nameBytes = encoder.encode(file.name);
      var data = toBytes(file.data);
      var crc = crc32(data);

      var local = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true); // versão necessária
      lv.setUint16(6, 0x0800, true); // nomes em UTF-8
      lv.setUint16(8, 0, true); // método: stored
      lv.setUint16(10, stamp.time, true);
      lv.setUint16(12, stamp.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      locals.push(local, data);

      var central = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); // versão de origem
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, stamp.time, true);
      cv.setUint16(14, stamp.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true); // extra
      cv.setUint16(32, 0, true); // comentário
      cv.setUint16(34, 0, true); // disco
      cv.setUint16(36, 0, true); // atributos internos
      cv.setUint32(38, 0, true); // atributos externos
      cv.setUint32(42, offset, true);
      central.set(nameBytes, 46);
      centrals.push(central);

      offset += local.length + data.length;
    });

    var centralSize = centrals.reduce(function (sum, chunk) {
      return sum + chunk.length;
    }, 0);

    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    var total = offset + centralSize + end.length;
    if (total > MAX_SIZE) {
      throw new Error('o lote passa de 4 GB; divida em lotes menores.');
    }
    var out = new Uint8Array(total);
    var pos = 0;
    locals.concat(centrals, [end]).forEach(function (chunk) {
      out.set(chunk, pos);
      pos += chunk.length;
    });
    return out;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('Seu navegador não suporta leitura de .xlsx (DecompressionStream).');
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    var reader = stream.getReader();
    var chunks = [];
    var total = 0;

    try {
      for (;;) {
        var step = await reader.read();
        if (step.done) break;
        total += step.value.length;
        if (total > MAX_INFLATED_SIZE) {
          throw new Error(
            'O arquivo compactado expande além do limite de segurança de 64 MB. ' +
              'Divida a planilha ou use um arquivo menor.'
          );
        }
        chunks.push(step.value);
      }
    } finally {
      reader.cancel().catch(function () {});
    }

    var out = new Uint8Array(total);
    var pos = 0;
    chunks.forEach(function (chunk) {
      out.set(chunk, pos);
      pos += chunk.length;
    });
    return out;
  }

  /**
   * Lê um ZIP em memória.
   * @param {Uint8Array|ArrayBuffer} input
   * @returns {Promise<{names: () => string[], has: (name: string) => boolean,
   *   get: (name: string) => Promise<Uint8Array|null>}>}
   */
  async function read(input) {
    var data = toBytes(input);
    var view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    var eocd = -1;
    var limit = Math.max(0, data.length - 65557);
    for (var i = data.length - 22; i >= limit; i--) {
      if (
        data[i] === 0x50 &&
        data[i + 1] === 0x4b &&
        data[i + 2] === 0x05 &&
        data[i + 3] === 0x06
      ) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Arquivo ZIP inválido (fim do diretório central não encontrado).');

    var count = view.getUint16(eocd + 10, true);
    var pointer = view.getUint32(eocd + 16, true);
    var entries = new Map();
    var inflatedTotal = 0;

    for (var n = 0; n < count; n++) {
      if (view.getUint32(pointer, true) !== 0x02014b50) {
        throw new Error('Arquivo ZIP inválido (diretório central corrompido).');
      }
      var method = view.getUint16(pointer + 10, true);
      var compressedSize = view.getUint32(pointer + 20, true);
      var nameLength = view.getUint16(pointer + 28, true);
      var extraLength = view.getUint16(pointer + 30, true);
      var commentLength = view.getUint16(pointer + 32, true);
      var localOffset = view.getUint32(pointer + 42, true);
      var name = decoder.decode(data.subarray(pointer + 46, pointer + 46 + nameLength));
      entries.set(name, {
        method: method,
        compressedSize: compressedSize,
        localOffset: localOffset
      });
      pointer += 46 + nameLength + extraLength + commentLength;
    }

    function normalize(name) {
      return String(name).replace(/^\/+/, '');
    }

    return {
      names: function () {
        return Array.from(entries.keys());
      },
      has: function (name) {
        return entries.has(normalize(name));
      },
      get: async function (name) {
        var entry = entries.get(normalize(name));
        if (!entry) return null;
        if (view.getUint32(entry.localOffset, true) !== 0x04034b50) {
          throw new Error('Arquivo ZIP inválido (cabeçalho local corrompido).');
        }
        var nameLength = view.getUint16(entry.localOffset + 26, true);
        var extraLength = view.getUint16(entry.localOffset + 28, true);
        var start = entry.localOffset + 30 + nameLength + extraLength;
        var raw = data.subarray(start, start + entry.compressedSize);
        var output;
        if (entry.method === 0) output = raw;
        else if (entry.method === 8) output = await inflateRaw(raw);
        else throw new Error('Método de compressão não suportado no ZIP: ' + entry.method);

        inflatedTotal += output.length;
        if (inflatedTotal > MAX_TOTAL_INFLATED) {
          throw new Error(
            'O arquivo compactado expande além do limite total de segurança de 128 MB.'
          );
        }
        return output;
      }
    };
  }

  return { crc32: crc32, create: create, read: read };
});
