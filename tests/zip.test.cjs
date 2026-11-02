'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Zip = require('../lib/zip.js');
const { makeZip } = require('./helpers.cjs');

test('crc32 confere com o valor conhecido de "hello"', () => {
  assert.equal(Zip.crc32(new TextEncoder().encode('hello')), 0x3610a686);
});

test('create() gera um ZIP legível por read(), preservando bytes e nomes UTF-8', async () => {
  const pdf = new TextEncoder().encode('%PDF-1.4\nconteúdo');
  const bytes = Zip.create([
    { name: '12345_RA_doc1.pdf', data: pdf },
    { name: 'João_RA_doc2.pdf', data: new Uint8Array([0, 1, 2, 255]) },
  ]);

  const zip = await Zip.read(bytes);
  assert.deepEqual(zip.names().sort(), ['12345_RA_doc1.pdf', 'João_RA_doc2.pdf']);
  assert.deepEqual(await zip.get('12345_RA_doc1.pdf'), pdf);
  assert.deepEqual(Array.from(await zip.get('João_RA_doc2.pdf')), [0, 1, 2, 255]);
});

test('read() descomprime entradas deflate-raw de um ZIP externo', async () => {
  const bytes = makeZip([
    { name: 'a.txt', data: 'linha 1\nlinha 2' },
    { name: 'xml/sheet.xml', data: '<x>ok</x>' },
  ]);

  const zip = await Zip.read(bytes);
  const text = new TextDecoder().decode(await zip.get('a.txt'));
  assert.equal(text, 'linha 1\nlinha 2');
  assert.equal(new TextDecoder().decode(await zip.get('xml/sheet.xml')), '<x>ok</x>');
  assert.equal(await zip.get('nao-existe'), null);
  assert.equal(zip.has('a.txt'), true);
});

test('read() rejeita conteúdo que não é ZIP', async () => {
  await assert.rejects(() => Zip.read(new Uint8Array([1, 2, 3, 4])), /ZIP inválido/);
});

test('create() aceita lotes grandes e recusa acima de 65.535 entradas', async () => {
  const files = Array.from({ length: 120 }, (_, i) => ({
    name: 'arquivo_' + i + '.pdf',
    data: new Uint8Array([1, 2, 3]),
  }));
  const zip = await Zip.read(Zip.create(files));
  assert.equal(zip.names().length, 120);

  assert.throws(() => Zip.create(new Array(65536)), /acima do limite de 65535/);
});
