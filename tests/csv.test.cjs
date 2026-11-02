'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Csv = require('../lib/csv.js');
const Core = require('../lib/core.js');

test('parse() detecta vírgula, ponto e vírgula e tab', () => {
  assert.deepEqual(Csv.parse('1,Maria,12345\n2,João,98765\n'), [
    ['1', 'Maria', '12345'],
    ['2', 'João', '98765'],
  ]);
  assert.deepEqual(Csv.parse('1;Maria;12345\n2;João;98765'), [
    ['1', 'Maria', '12345'],
    ['2', 'João', '98765'],
  ]);
  assert.deepEqual(Csv.parse('1\tMaria\t12345\n'), [['1', 'Maria', '12345']]);
  assert.equal(Csv.detectDelimiter('a;b;c'), ';');
  assert.equal(Csv.detectDelimiter('a,b,c'), ',');
  assert.equal(Csv.detectDelimiter('a\tb\tc'), '\t');
});

test('parse() respeita aspas, separador dentro do campo, aspas escapadas e quebra de linha', () => {
  const matrix = Csv.parse(
    'numero,nome,guia\n' +
      '1,"Silva, Maria",12345\n' +
      '2,"João ""Dito"" Souza",98765\n' +
      '3,"Ana\nPaula",11111\n'
  );

  assert.deepEqual(matrix, [
    ['numero', 'nome', 'guia'],
    ['1', 'Silva, Maria', '12345'],
    ['2', 'João "Dito" Souza', '98765'],
    ['3', 'Ana\nPaula', '11111'],
  ]);
});

test('parse() remove BOM e normaliza CRLF', () => {
  const matrix = Csv.parse('\uFEFF1;Maria;12345\r\n2;João;98765\r\n');
  assert.deepEqual(matrix, [
    ['1', 'Maria', '12345'],
    ['2', 'João', '98765'],
  ]);
  assert.equal(Csv.parse('')[0], undefined);
});

test('CSV completo alimenta parseTable e gera o plano', () => {
  const matrix = Csv.parse(
    'numero;paciente;guia\n' +
      '1;Maria Silva;12345\n' +
      '2;José Souza;98765\n'
  );
  const table = Core.parseTable(matrix);
  const plan = Core.buildPlan(
    [
      { name: '1.pdf', number: 1 },
      { name: '2.pdf', number: 2 },
    ],
    table.rows
  );

  assert.equal(table.headerDetected, true);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(
    plan.entries.map((entry) => entry.outputName),
    ['12345_RA_doc1.pdf', '98765_RA_doc2.pdf']
  );
});
