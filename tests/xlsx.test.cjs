'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Xlsx = require('../lib/xlsx.js');
const { buildXlsx } = require('./helpers.cjs');

const sharedStrings =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">' +
  '<si><t>Paciente</t></si>' +
  '<si><t>Guia</t></si>' +
  '<si><r><t>Maria</t></r><r><t xml:space="preserve"> Silva</t></r></si>' +
  '</sst>';

const rowsXml =
  '<row r="1" spans="1:3">' +
  '<c r="A1" t="inlineStr"><is><t>numero</t></is></c>' +
  '<c r="B1" t="s"><v>0</v></c>' +
  '<c r="C1" t="s"><v>1</v></c>' +
  '</row>' +
  '<row r="2">' +
  '<c r="A2"><v>1</v></c>' +
  '<c r="B2" t="s"><v>2</v></c>' +
  '<c r="C2" t="inlineStr"><is><t>12345</t></is></c>' +
  '</row>' +
  '<row r="3">' +
  '<c r="A3"><v>2</v></c>' +
  '<c r="B3" t="inlineStr"><is><t>Jos&#233; &amp; Ana</t></is></c>' +
  '<c r="C3"><v>98765</v></c>' +
  '</row>';

test('read() devolve a matriz da primeira aba com tipos e entidades resolvidos', async () => {
  const matrix = await Xlsx.read(buildXlsx({ rowsXml, sharedXml: sharedStrings }));
  assert.deepEqual(matrix, [
    ['numero', 'Paciente', 'Guia'],
    ['1', 'Maria Silva', '12345'],
    ['2', 'José & Ana', '98765'],
  ]);
});

test('read() encontra sheet1.xml quando workbook.xml não está presente', async () => {
  const matrix = await Xlsx.read(
    buildXlsx({ rowsXml: '<row r="1"><c r="A1"><v>7</v></c></row>', includeWorkbook: false })
  );
  assert.deepEqual(matrix, [['7']]);
});

test('read() preenche lacunas de colunas e linhas', async () => {
  const matrix = await Xlsx.read(
    buildXlsx({ rowsXml: '<row r="1"><c r="C1" t="inlineStr"><is><t>x</t></is></c></row>' })
  );
  assert.deepEqual(matrix, [['', '', 'x']]);
});

test('read() funciona sem atributos de referência (r) em linhas e células', async () => {
  const matrix = await Xlsx.read(
    buildXlsx({
      rowsXml:
        '<row><c t="inlineStr"><is><t>1</t></is></c><c t="b"><v>1</v></c></row>' +
        '<row><c t="inlineStr"><is><t>2</t></is></c><c><v>98765</v></c></row>',
    })
  );
  assert.deepEqual(matrix, [
    ['1', 'VERDADEIRO'],
    ['2', '98765'],
  ]);
});
