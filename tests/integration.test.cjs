'use strict';

/* Integração ponta a ponta: CSV/XLSX -> tabela -> plano -> ZIP renomeado. */

const test = require('node:test');
const assert = require('node:assert/strict');
const Csv = require('../lib/csv.js');
const Xlsx = require('../lib/xlsx.js');
const Zip = require('../lib/zip.js');
const Core = require('../lib/core.js');
const { buildXlsx } = require('./helpers.cjs');

const PDF_1 = new TextEncoder().encode('%PDF-1.4\nconteúdo do primeiro');
const PDF_2 = new TextEncoder().encode('%PDF-1.4\nconteúdo do segundo');

const FILES = [
  { name: '1.pdf', number: 1, bytes: PDF_1 },
  { name: '2.pdf', number: 2, bytes: PDF_2 },
];

async function run(table, files, options) {
  const plan = Core.buildPlan(files, table.rows, options);
  assert.deepEqual(plan.errors, []);
  const archive = Core.createArchive(
    plan.entries.map((entry) => ({ outputName: entry.outputName, bytes: entry.file.bytes }))
  );
  return { plan, zip: await Zip.read(archive) };
}

test('fluxo completo com CSV (cabeçalho, ponto e vírgula) gera os nomes esperados', async () => {
  const matrix = Csv.parse(
    'numero;paciente;guia\n' +
      '1;Maria Silva;12345\n' +
      '2;José Souza;98765\n'
  );
  const { plan, zip } = await run(Core.parseTable(matrix), FILES);

  assert.equal(plan.archiveName, 'guias_renomeadas.zip');
  assert.deepEqual(zip.names().sort(), ['12345_RA_doc1.pdf', '98765_RA_doc2.pdf']);
  assert.deepEqual(await zip.get('12345_RA_doc1.pdf'), PDF_1);
  assert.deepEqual(await zip.get('98765_RA_doc2.pdf'), PDF_2);
});

test('fluxo completo com XLSX reaproveita o mesmo núcleo', async () => {
  const matrix = await Xlsx.read(
    buildXlsx({
      rowsXml:
        '<row r="1"><c r="A1" t="inlineStr"><is><t>1</t></is></c>' +
        '<c r="B1" t="inlineStr"><is><t>Maria</t></is></c>' +
        '<c r="C1"><v>555</v></c></row>' +
        '<row r="2"><c r="A2"><v>2</v></c>' +
        '<c r="B2" t="inlineStr"><is><t>João</t></is></c>' +
        '<c r="C2"><v>777</v></c></row>',
    })
  );
  const { zip } = await run(Core.parseTable(matrix), FILES);

  assert.deepEqual(zip.names().sort(), ['555_RA_doc1.pdf', '777_RA_doc2.pdf']);
});

test('lote incompleto é bloqueado antes de gerar qualquer arquivo', () => {
  const table = Core.parseTable([
    ['1', 'Maria', '12345'],
    ['2', 'José', '98765'],
  ]);
  const plan = Core.buildPlan([FILES[0]], table.rows);

  assert.ok(plan.errors.length > 0);
  assert.match(plan.errors.join('\n'), /Faltam PDFs para os números: 2\./);
});

test('fluxo SulAmérica prefixa 11 zeros ao número da guia', async () => {
  const matrix = Csv.parse('numero,paciente,guia\n1,Maria Silva,123456789\n2,José Souza,987654321\n');
  const { zip } = await run(Core.parseTable(matrix), FILES, { pattern: 'sulamerica' });

  assert.deepEqual(zip.names().sort(), [
    '00000000000123456789.pdf',
    '00000000000987654321.pdf',
  ]);
  assert.deepEqual(await zip.get('00000000000123456789.pdf'), PDF_1);
});

test('fluxo nome do paciente usa o nome sanitizado', async () => {
  const matrix = Csv.parse('numero,paciente,guia\n1,Maria Silva,111\n2,José Souza,222\n');
  const { zip } = await run(Core.parseTable(matrix), FILES, { pattern: 'amhp' });

  assert.deepEqual(zip.names().sort(), ['José Souza.pdf', 'Maria Silva.pdf']);
});

test('modelo.xlsx não tem coluna de número e é numerado automaticamente 1..n', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, '..', 'modelo.xlsx')));
  const table = Core.parseTable(await Xlsx.read(bytes));

  assert.deepEqual(table.errors, []);
  assert.equal(table.headerDetected, true);
  assert.equal(table.autoNumber, true);
  assert.deepEqual(
    table.rows.map((row) => [row.index, row.patient, row.guide]),
    [
      [1, 'Maria Silva', '154144257'],
      [2, 'José Souza', '216946945'],
      [3, 'Ana Paula Ferreira', '890634758'],
    ]
  );
});

test('planilha só com números de guia vira lote numerado 1..n', async () => {
  const matrix = await Xlsx.read(
    buildXlsx({
      rowsXml:
        '<row r="1"><c r="A1"><v>154144257</v></c></row>' +
        '<row r="2"><c r="A2"><v>216946945</v></c></row>',
    })
  );
  const table = Core.parseTable(matrix);

  assert.deepEqual(table.errors, []);
  assert.deepEqual(table.rows.map((row) => [row.index, row.guide]), [
    [1, '154144257'],
    [2, '216946945'],
  ]);
});
