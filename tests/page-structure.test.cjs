'use strict';

/* Checagens estruturais da página: ids usados pelo app.js existem no HTML,
   scripts carregados na ordem certa e arquivos locais presentes. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function idsIn(markup) {
  return new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
}

test('index.html referencia os estilos e as bibliotecas na ordem de dependência', () => {
  assert.match(html, /<link rel="stylesheet" href="styles\.css"/);

  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(scripts, ['lib/zip.js', 'lib/csv.js', 'lib/xlsx.js', 'lib/core.js', 'app.js']);

  for (const file of scripts) {
    assert.ok(fs.existsSync(path.join(root, file)), file + ' não existe');
  }
});

test('todos os getElementById do app.js existem no HTML', () => {
  const ids = idsIn(html);
  const referenced = [...app.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1]);

  assert.ok(referenced.length > 10, 'esperava várias referências de DOM no app.js');
  for (const id of referenced) {
    assert.ok(ids.has(id), 'id ausente no index.html: ' + id);
  }
});

test('a página tem os campos e áreas da interface', () => {
  const ids = idsIn(html);
  for (const id of [
    'pdf-input',
    'pdf-drop',
    'file-list',
    'table-input',
    'table-drop',
    'table-preview',
    'issues',
    'rename-table',
    'pattern-select',
    'numbering-select',
    'generate',
    'toast',
  ]) {
    assert.ok(ids.has(id), 'faltou o elemento #' + id);
  }

  assert.match(html, /accept="application\/pdf,\.pdf" multiple/);
  assert.match(html, /accept="\.csv,text\/csv,\.xlsx/);
  assert.match(html, /href="modelo\.csv"/);
  assert.match(html, /href="modelo\.xlsx"/);
});

function optionsOf(selectId) {
  const block = new RegExp('<select id="' + selectId + '"[\\s\\S]*?</select>').exec(html);
  assert.ok(block, 'select ausente: #' + selectId);
  return [...block[0].matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
}

test('o seletor oferece os três padrões de renomeação', () => {
  assert.deepEqual(optionsOf('pattern-select'), ['bradesco', 'sulamerica', 'amhp']);
  assert.match(html, /00000000000&lt;número_da_guia&gt;\.pdf/);
  assert.match(html, /&lt;nome_do_paciente&gt;\.pdf/);
});

test('o seletor de numeração oferece auto, sequência e coluna', () => {
  assert.deepEqual(optionsOf('numbering-select'), ['auto', 'sequence', 'column']);
});

test('o app.js valida PDFs antes de liberar a geração', () => {
  assert.match(app, /%PDF-/);
  assert.match(app, /não são PDFs válidos/);
  assert.match(app, /function canGenerate/);
});

test('modelo.csv existe com as três colunas esperadas', () => {
  const model = fs.readFileSync(path.join(root, 'modelo.csv'), 'utf8');
  assert.equal(model.split(/\r?\n/)[0], 'numero,paciente,numero_da_guia');
  assert.equal(model.trim().split(/\r?\n/).length, 4);
});

test('a prévia da tabela mostra todas as linhas, sem limite de 12', () => {
  assert.doesNotMatch(app, /PREVIEW_LIMIT/);
  assert.doesNotMatch(app, /Mostrando\s+\d+\s+de/);
  assert.match(app, /rows\.forEach\(function \(row\)/);
});
