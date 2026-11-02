'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../lib/core.js');
const Zip = require('../lib/zip.js');

test('makeOutputName segue o padrão <numero_da_guia>_RA_doc<i>.pdf', () => {
  assert.equal(Core.makeOutputName('12345', 1), '12345_RA_doc1.pdf');
  assert.equal(Core.makeOutputName('987654321', 10), '987654321_RA_doc10.pdf');
  assert.equal(Core.makeOutputName('  ABC-77  ', 3), 'ABC-77_RA_doc3.pdf');
});

test('makeOutputName preserva acentos e rejeita índice inválido', () => {
  assert.equal(Core.makeOutputName('Guia São João', 2), 'Guia São João_RA_doc2.pdf');
  assert.throws(() => Core.makeOutputName('123', 0), /índice inválido/);
  assert.throws(() => Core.makeOutputName('123', 1.5), /índice inválido/);
  assert.throws(() => Core.makeOutputName('  ', 1), /guia está vazio/);
});

test('makeOutputNameFor aplica o padrão SulAmérica: 11 zeros + número da guia', () => {
  const name = Core.makeOutputNameFor('sulamerica', {
    index: 1,
    patient: 'Maria Silva',
    guide: '123456789',
  });

  assert.equal(name, '00000000000123456789.pdf');
  assert.equal(Core.SULAMERICA_PREFIX.length, 11);
  assert.throws(
    () => Core.makeOutputNameFor('sulamerica', { index: 1, guide: '  ' }),
    /guia está vazio/
  );
});

test('makeOutputNameFor aplica o padrão AMHP', () => {
  assert.equal(
    Core.makeOutputNameFor('amhp', { index: 2, guide: '1', patient: 'José Souza' }),
    'José Souza.pdf'
  );
  assert.equal(
    Core.makeOutputNameFor('amhp', { index: 3, patient: 'Ana/Paula: Teste' }),
    'Ana Paula Teste.pdf'
  );
  assert.throws(
    () => Core.makeOutputNameFor('amhp', { index: 4, guide: '1', patient: '   ' }),
    /nome do paciente está vazio/
  );
});

test('makeOutputNameFor mantém o padrão Bradesco como default', () => {
  assert.equal(
    Core.makeOutputNameFor(null, { index: 5, guide: '98765', patient: 'Maria' }),
    '98765_RA_doc5.pdf'
  );
  assert.equal(Core.DEFAULT_PATTERN, 'bradesco');
  assert.throws(
    () => Core.makeOutputNameFor('outro', { index: 1, guide: '1', patient: 'Maria' }),
    /padrão de renomeação desconhecido/
  );
});

test('parseTable aceita tabela sem cabeçalho na ordem numero, paciente, guia', () => {
  const result = Core.parseTable([
    ['1', 'Maria Silva', '12345'],
    ['2', 'José Souza', '98765'],
    ['', '', ''],
  ]);

  assert.equal(result.headerDetected, false);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows, [
    { index: 1, patient: 'Maria Silva', guide: '12345', line: 1 },
    { index: 2, patient: 'José Souza', guide: '98765', line: 2 },
  ]);
});

test('parseTable detecta cabeçalho com acentos e nomes alternativos', () => {
  const result = Core.parseTable([
    ['Nº', 'Nome do paciente', 'Número da guia'],
    ['1', 'Maria Silva', '12345'],
  ]);

  assert.equal(result.headerDetected, true);
  assert.deepEqual(result.rows, [
    { index: 1, patient: 'Maria Silva', guide: '12345', line: 2 },
  ]);
});

test('parseTable usa os índices do cabeçalho quando as colunas estão fora de ordem', () => {
  const result = Core.parseTable([
    ['Guia', 'Paciente', 'Item'],
    ['555', 'Ana', '1'],
  ]);

  assert.equal(result.headerDetected, true);
  assert.deepEqual(result.rows, [{ index: 1, patient: 'Ana', guide: '555', line: 2 }]);
});

test('parseTable acusa numeração duplicada, faltante e guia vazia', () => {
  const result = Core.parseTable([
    ['1', 'Maria', '111'],
    ['1', 'João', '222'],
    ['3', 'Ana', ''],
  ]);

  assert.match(result.errors.join('\n'), /Números sequenciais repetidos: 1/);
  assert.match(result.errors.join('\n'), /Números sequenciais faltando: 2/);
  assert.match(result.errors.join('\n'), /Linha 3: o número da guia está vazio/);
});

test('parseTable avisa guias repetidas e nomes de paciente vazios', () => {
  const result = Core.parseTable([
    ['1', 'Maria', '999'],
    ['2', '', '999'],
  ]);

  assert.deepEqual(result.errors, []);
  assert.match(result.warnings.join('\n'), /Número da guia repetido: 999 \(linhas 1 e 2\)/);
  assert.match(result.warnings.join('\n'), /Linha 2: o nome do paciente está vazio/);
});

test('parseTable rejeita tabela vazia', () => {
  assert.deepEqual(Core.parseTable([]).errors, ['A tabela está vazia.']);
  assert.deepEqual(Core.parseTable([['', '']]).errors, [
    'Nenhuma linha com dados foi encontrada na tabela.',
  ]);
});

test('extractFileNumber lê o primeiro número do nome do arquivo', () => {
  assert.equal(Core.extractFileNumber('1.pdf'), 1);
  assert.equal(Core.extractFileNumber('01.pdf'), 1);
  assert.equal(Core.extractFileNumber('3 - Maria Silva.pdf'), 3);
  assert.equal(Core.extractFileNumber('guia 7 final.pdf'), 7);
  assert.equal(Core.extractFileNumber('10_RA_doc10.pdf'), 10);
  assert.equal(Core.extractFileNumber('/tmp/lote/12.PDF'), 12);
  assert.equal(Core.extractFileNumber('sem numero.pdf'), null);
  assert.equal(Core.extractFileNumber(''), null);
});

test('createArchive gera um único ZIP com os PDFs renomeados e conteúdo intacto', async () => {
  const pdf1 = new TextEncoder().encode('%PDF-1.4\nprimeiro');
  const pdf2 = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);

  const table = Core.parseTable([
    ['1', 'Maria Silva', '12345'],
    ['2', 'José Souza', '98765'],
  ]);
  const plan = Core.buildPlan(
    [
      { name: '1.pdf', number: 1, bytes: pdf1 },
      { name: '2.pdf', number: 2, bytes: pdf2 },
    ],
    table.rows
  );

  assert.deepEqual(plan.errors, []);
  assert.equal(plan.archiveName, 'guias_renomeadas.zip');
  assert.deepEqual(
    plan.entries.map((entry) => entry.outputName),
    ['12345_RA_doc1.pdf', '98765_RA_doc2.pdf']
  );

  const bytes = Core.createArchive(
    plan.entries.map((entry) => ({ outputName: entry.outputName, bytes: entry.file.bytes }))
  );
  const zip = await Zip.read(bytes);

  assert.deepEqual(zip.names().sort(), ['12345_RA_doc1.pdf', '98765_RA_doc2.pdf']);
  assert.deepEqual(await zip.get('12345_RA_doc1.pdf'), pdf1);
  assert.deepEqual(await zip.get('98765_RA_doc2.pdf'), pdf2);
});

test('buildPlan bloqueia quando faltam PDFs e a quantidade diverge', () => {
  const table = Core.parseTable([
    ['1', 'Maria', '111'],
    ['2', 'João', '222'],
    ['3', 'Ana', '333'],
  ]);
  const plan = Core.buildPlan([{ name: '1.pdf', number: 1 }], table.rows);

  const messages = plan.errors.join('\n');
  assert.match(messages, /Faltam PDFs para os números: 2, 3\./);
  assert.match(messages, /Quantidade divergente: 3 linha\(s\) na tabela e 1 PDF\(s\) anexado\(s\)\./);
  assert.equal(plan.entries.length, 1);
});

test('buildPlan bloqueia PDFs sem linha na tabela', () => {
  const table = Core.parseTable([
    ['1', 'Maria', '111'],
    ['2', 'João', '222'],
  ]);
  const plan = Core.buildPlan(
    [
      { name: '1.pdf', number: 1 },
      { name: '2.pdf', number: 2 },
      { name: '4.pdf', number: 4 },
    ],
    table.rows
  );

  assert.match(plan.errors.join('\n'), /PDFs sem linha correspondente na tabela \(números\): 4\./);
});

test('buildPlan bloqueia números de arquivo duplicados ou ausentes', () => {
  const table = Core.parseTable([['1', 'Maria', '111']]);
  const plan = Core.buildPlan(
    [
      { name: '1.pdf', number: 1 },
      { name: '01 - cópia.pdf', number: 1 },
      { name: 'sem numero.pdf', number: null },
    ],
    table.rows
  );

  const messages = plan.errors.join('\n');
  assert.match(messages, /Mais de um arquivo com o número 1: 1\.pdf, 01 - cópia\.pdf\./);
  assert.match(messages, /Não foi possível identificar o número no nome do arquivo "sem numero\.pdf"\./);
});

test('buildPlan gera o plano completo quando tudo casa', () => {
  const table = Core.parseTable([
    ['Nº', 'Paciente', 'Guia'],
    ['1', 'Maria', '111'],
    ['2', 'João', '222'],
    ['3', 'Ana', '333'],
  ]);
  const plan = Core.buildPlan(
    [
      { name: '1.pdf', number: 1 },
      { name: '2.pdf', number: 2 },
      { name: '3.pdf', number: 3 },
    ],
    table.rows
  );

  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(
    plan.entries.map((entry) => [entry.index, entry.outputName]),
    [
      [1, '111_RA_doc1.pdf'],
      [2, '222_RA_doc2.pdf'],
      [3, '333_RA_doc3.pdf'],
    ]
  );
});

test('buildPlan avisa guias repetidas sem bloquear a geração', () => {
  const table = Core.parseTable([
    ['1', 'Maria', '999'],
    ['2', 'João', '999'],
  ]);
  const plan = Core.buildPlan(
    [
      { name: '1.pdf', number: 1 },
      { name: '2.pdf', number: 2 },
    ],
    table.rows
  );

  assert.deepEqual(plan.errors, []);
  assert.match(table.warnings.join('\n'), /Número da guia repetido: 999/);
  assert.deepEqual(
    plan.entries.map((entry) => entry.outputName),
    ['999_RA_doc1.pdf', '999_RA_doc2.pdf']
  );
});

test('sanitizeFileName remove caracteres inválidos e espaços nas pontas', () => {
  assert.equal(Core.sanitizeFileName('123/456'), '123 456');
  assert.equal(Core.sanitizeFileName('  guia:1*2?3 "x" <y>|z  '), 'guia 1 2 3 x y z');
  assert.equal(Core.sanitizeFileName('..12345..'), '12345');
  assert.equal(Core.sanitizeFileName('guia\ncom\tcontrole'), 'guia com controle');
  assert.equal(Core.sanitizeFileName('   '), '');
  assert.equal(Core.sanitizeFileName(null), '');
});

test('makeOutputName aplica a sanitização antes de montar o nome final', () => {
  assert.equal(Core.makeOutputName('123/456', 1), '123 456_RA_doc1.pdf');
  assert.equal(Core.makeOutputName('  ..98765..  ', 4), '98765_RA_doc4.pdf');
});

test('sanitizeFileName limita o tamanho do nome', () => {
  assert.equal(Core.sanitizeFileName('9'.repeat(300)).length, 120);
});

test('buildPlan aplica o padrão SulAmérica aos nomes de saída', () => {
  const table = Core.parseTable([
    ['1', 'Maria Silva', '123456789'],
    ['2', 'José Souza', '987654321'],
  ]);
  const plan = Core.buildPlan(
    [
      { name: '1.pdf', number: 1 },
      { name: '2.pdf', number: 2 },
    ],
    table.rows,
    { pattern: 'sulamerica' }
  );

  assert.deepEqual(plan.errors, []);
  assert.deepEqual(
    plan.entries.map((entry) => entry.outputName),
    ['00000000000123456789.pdf', '00000000000987654321.pdf']
  );
});

test('buildPlan numera nomes repetidos no padrão AMHP e avisa para conferir', () => {
  const table = Core.parseTable([
    ['1', 'Maria Silva', '111'],
    ['2', 'Maria Silva', '222'],
  ]);
  const plan = Core.buildPlan(
    [
      { name: '1.pdf', number: 1 },
      { name: '2.pdf', number: 2 },
    ],
    table.rows,
    { pattern: 'amhp' }
  );

  assert.deepEqual(plan.errors, []);
  assert.deepEqual(
    plan.entries.map((entry) => entry.outputName),
    ['Maria Silva (1).pdf', 'Maria Silva (2).pdf']
  );
  assert.match(
    plan.warnings.join('\n'),
    /Nomes de arquivo repetidos no padrão AMHP: "Maria Silva\.pdf" \(números 1, 2\)\. Numeração adicionada: Maria Silva \(1\)\.pdf, Maria Silva \(2\)\.pdf — confira e ajuste esses arquivos\./
  );
});

test('buildPlan numera duplicatas sem colidir com um nome que já termina em (1)', () => {
  const table = Core.parseTable([
    ['1', 'Ana', '555'],
    ['2', 'Ana', '555'],
    ['3', 'Ana (1)', '777'],
  ]);
  const plan = Core.buildPlan(
    [
      { name: '1.pdf', number: 1 },
      { name: '2.pdf', number: 2 },
      { name: '3.pdf', number: 3 },
    ],
    table.rows,
    { pattern: 'amhp' }
  );

  assert.deepEqual(plan.errors, []);
  assert.deepEqual(
    plan.entries.map((entry) => entry.outputName),
    ['Ana (2).pdf', 'Ana (3).pdf', 'Ana (1).pdf']
  );
});

test('buildPlan bloqueia paciente vazio no padrão AMHP', () => {
  const table = Core.parseTable([
    ['1', '', '111'],
    ['2', 'João', '222'],
  ]);
  const plan = Core.buildPlan(
    [
      { name: '1.pdf', number: 1 },
      { name: '2.pdf', number: 2 },
    ],
    table.rows,
    { pattern: 'amhp' }
  );

  assert.match(plan.errors.join('\n'), /Linha 1: o nome do paciente está vazio\./);
});

test('buildPlan acusa padrão de renomeação desconhecido', () => {
  const table = Core.parseTable([['1', 'Maria', '111']]);
  const plan = Core.buildPlan(
    [{ name: '1.pdf', number: 1 }],
    table.rows,
    { pattern: 'inexistente' }
  );

  assert.match(plan.errors.join('\n'), /Padrão de renomeação desconhecido: "inexistente"\./);
  assert.equal(plan.entries.length, 0);
});

test('buildPlan não limita a quantidade de guias do lote', () => {
  const total = 120;
  const matrix = Array.from({ length: total }, (_, i) => [
    String(i + 1),
    'Paciente ' + (i + 1),
    String(100000000 + i),
  ]);
  const table = Core.parseTable(matrix);
  const files = Array.from({ length: total }, (_, i) => ({ name: i + 1 + '.pdf', number: i + 1 }));
  const plan = Core.buildPlan(files, table.rows, { pattern: 'sulamerica' });

  assert.deepEqual(plan.errors, []);
  assert.equal(plan.entries.length, total);
  assert.equal(plan.entries[total - 1].outputName, '00000000000100000119.pdf');
});

test('parseTable numera automaticamente quando o cabeçalho não tem coluna de número', () => {
  const result = Core.parseTable([
    ['paciente', 'numero_da_guia'],
    ['Maria Silva', '123456789'],
    ['José Souza', '987654321'],
  ]);

  assert.deepEqual(result.errors, []);
  assert.equal(result.headerDetected, true);
  assert.equal(result.autoNumber, true);
  assert.equal(result.numbering, 'sequence');
  assert.deepEqual(
    result.rows.map((row) => [row.index, row.patient, row.guide]),
    [
      [1, 'Maria Silva', '123456789'],
      [2, 'José Souza', '987654321'],
    ]
  );
});

test('parseTable aceita tabela sem cabeçalho com paciente e guia (numeração automática)', () => {
  const result = Core.parseTable([
    ['Maria Silva', '123456789'],
    ['José Souza', '987654321'],
  ]);

  assert.deepEqual(result.errors, []);
  assert.equal(result.autoNumber, true);
  assert.deepEqual(
    result.rows.map((row) => [row.index, row.patient, row.guide]),
    [
      [1, 'Maria Silva', '123456789'],
      [2, 'José Souza', '987654321'],
    ]
  );
});

test('parseTable aceita guia na primeira coluna sem cabeçalho', () => {
  const result = Core.parseTable([
    ['123456789', 'Maria Silva'],
    ['987654321', 'José Souza'],
  ]);

  assert.deepEqual(result.errors, []);
  assert.equal(result.autoNumber, true);
  assert.deepEqual(
    result.rows.map((row) => [row.index, row.patient, row.guide]),
    [
      [1, 'Maria Silva', '123456789'],
      [2, 'José Souza', '987654321'],
    ]
  );
});

test('parseTable aceita uma única coluna só com números de guia', () => {
  const result = Core.parseTable([['123456789'], ['987654321'], ['111222333']]);

  assert.deepEqual(result.errors, []);
  assert.equal(result.autoNumber, true);
  assert.deepEqual(
    result.rows.map((row) => [row.index, row.guide]),
    [
      [1, '123456789'],
      [2, '987654321'],
      [3, '111222333'],
    ]
  );
});

test('parseTable mantém a coluna de número quando ela existe', () => {
  const result = Core.parseTable([
    ['numero', 'paciente', 'guia'],
    ['7', 'Maria', '123'],
    ['8', 'José', '456'],
  ]);

  assert.equal(result.autoNumber, false);
  assert.deepEqual(result.rows.map((row) => row.index), [7, 8]);
});

test('parseTable força a sequência 1..n com numbering sequence', () => {
  const result = Core.parseTable(
    [['numero', 'paciente', 'guia'], ['7', 'Maria', '123'], ['8', 'José', '456']],
    { numbering: 'sequence' }
  );

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows.map((row) => row.index), [1, 2]);
});

test('parseTable exige a coluna de número com numbering column', () => {
  const result = Core.parseTable(
    [['paciente', 'guia'], ['Maria', '123']],
    { numbering: 'column' }
  );

  assert.equal(result.rows.length, 0);
  assert.match(result.errors.join('\n'), /não tem coluna de número sequencial/);
});
