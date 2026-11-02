'use strict';

/* Garante que as bibliotecas funcionam como scripts clássicos (window.X),
   condição para abrir o index.html direto via file:// sem servidor. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const LIBS = ['zip.js', 'csv.js', 'xlsx.js'];

function browserContext() {
  const context = vm.createContext({
    TextEncoder,
    TextDecoder,
    Blob,
    Response,
    DecompressionStream,
    console,
  });
  vm.runInContext('globalThis.window = globalThis;', context);
  return context;
}

test('as bibliotecas não usam import/export (módulos ES não carregam em file://)', () => {
  for (const file of LIBS) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', file), 'utf8');
    assert.doesNotMatch(source, /^\s*(import|export)\s/m, file + ' contém sintaxe de módulo ES');
  }
});

test('cada biblioteca se registra no escopo global do navegador', () => {
  const context = browserContext();
  for (const file of LIBS) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'lib', file), 'utf8'), context, {
      filename: file,
    });
  }
  assert.equal(typeof context.Zip.create, 'function');
  assert.equal(typeof context.Zip.read, 'function');
  assert.equal(typeof context.Csv.parse, 'function');
  assert.equal(typeof context.Xlsx.read, 'function');
});

test('o ZIP criado no "navegador" é lido de volta no mesmo escopo', async () => {
  const context = browserContext();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'lib', 'zip.js'), 'utf8'), context, {
    filename: 'zip.js',
  });
  const bytes = context.Zip.create([{ name: '1.pdf', data: '%PDF-1.4 ok' }]);
  const zip = await context.Zip.read(bytes);
  assert.equal(new TextDecoder().decode(await zip.get('1.pdf')), '%PDF-1.4 ok');
});
