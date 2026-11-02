# Renomeador de guias de consulta

Página única que recebe um lote de PDFs numerados de **1** a **n** e uma tabela com
**nº sequencial**, **nome do paciente** e **nº da guia**, e devolve um único ZIP com os
arquivos renomeados no padrão escolhido:

| Padrão | Nome final | Exemplo |
| ------ | ---------- | ------- |
| **Bradesco** (padrão inicial) | `<numero_da_guia>_RA_doc<i>.pdf` | `45678_RA_doc3.pdf` |
| **SulAmérica** | `00000000000<numero_da_guia>.pdf` (11 zeros + guia) | `00000000000456789012.pdf` |
| **AMHP** | `<nome_do_paciente>.pdf` | `Ana Paula.pdf` |

Por exemplo: o PDF `3.pdf` combinado com a linha `3, Ana Paula, 45678` vira
`45678_RA_doc3.pdf` no padrão Bradesco, `0000000000045678.pdf` no padrão SulAmérica e
`Ana Paula.pdf` no padrão AMHP.

O padrão é escolhido no seletor **Padrão de renomeação** da página e vale para todo o lote.

Tudo roda no navegador. Nenhum arquivo é enviado para servidor e o conteúdo dos PDFs
não é alterado — só o nome.

## Como usar

1. Abra o `index.html` no navegador (duplo clique já funciona) ou sirva a pasta com
   `python3 -m http.server` e acesse `http://localhost:8000`.
2. Em **PDFs do lote**, anexe os arquivos. O número usado é o **primeiro número do nome**
   do arquivo (`1.pdf`, `01.pdf`, `3 - Maria Silva.pdf`).
3. Em **Tabela das guias**, anexe um `.csv` ou `.xlsx`. Há dois modelos prontos na
   própria página: **Baixar modelo XLSX** (`modelo.xlsx`, recomendado) e
   **Baixar modelo CSV** (`modelo.csv`).
4. Confira a prévia em **Resultado do lote**: a tabela mostra **todas** as linhas lidas e a
   lista de renomeação mostra **todos** os arquivos, sem limite de quantidade. Se houver
   pendências, elas aparecem em vermelho com o que falta ou sobra.
5. Clique em **Gerar e baixar ZIP** e receba `guias_renomeadas.zip`.

Não existe limite de guias por lote. O único teto é o do formato ZIP sem ZIP64 usado aqui:
**65.535 arquivos** e **4 GB** por lote — acima disso a página avisa e pede para dividir.

## Formato da tabela

A coluna de **número sequencial é opcional**. Quando ela não existe, a página numera
automaticamente **1..n na ordem das linhas** — basta colar os números de guia (e os nomes)
extraídos do relatório:

| paciente     | nº da guia |
| ------------ | ---------- |
| Maria Silva  | 12345      |
| José Souza   | 98765      |
| Ana Paula    | 45678      |

Se a coluna existir, ela é usada como está:

| número | paciente     | nº da guia |
| ------ | ------------ | ---------- |
| 1      | Maria Silva  | 12345      |
| 2      | José Souza   | 98765      |
| 3      | Ana Paula    | 45678      |

- **`modelo.xlsx`** já vem nesse formato sem a coluna de número (`paciente`,
  `numero_da_guia`): é só colar as guias do relatório e anexar.
- **CSV**: separador `,`, `;` ou tab, detectado automaticamente; aceita aspas, BOM e CRLF.
- **XLSX**: lê a primeira aba da planilha. O formato `.xls` antigo não é suportado —
  salve como `.xlsx` ou `.csv`.
- **Cabeçalho opcional**: se a primeira linha tiver nomes reconhecíveis
  (`Nº`/`numero`, `Paciente`/`Nome`, `Guia`/`Número da guia`), ele é detectado e pode até
  estar em outra ordem. Sem cabeçalho, a ordem posicional é usada e a numeração vira
  automática.
- **Só a coluna de guias** também funciona: uma planilha com uma única coluna de números é
  lida como lista de guias e numerada 1..n na ordem.
- O seletor **Numeração** permite forçar o comportamento: _Automática_ (padrão),
  _Sempre 1..n pela ordem das linhas_ (ignora a coluna de número) ou _Exigir coluna de
  número_ (bloqueia se ela não existir).
- Linhas totalmente vazias são ignoradas.

## Regras de validação

A geração é **bloqueada** enquanto houver:

- numeração sequencial repetida ou com buracos (precisa ser exatamente 1..n);
- PDF faltando para algum número, PDF sobrando ou quantidade divergente;
- arquivo sem número no nome;
- nº da guia vazio na tabela;
- arquivo anexado que não começa com a assinatura `%PDF-`;
- tabela ilegível ou vazia.

Avisos (não bloqueiam):

- nº da guia repetido em mais de uma linha — os nomes finais não colidem porque incluem o `i`;
- nome do paciente vazio (no padrão **AMHP** isso bloqueia, porque o nome é o arquivo);
- **nome final repetido** — as ocorrências do grupo recebem sufixo numérico
  (`Maria Silva (1).pdf`, `Maria Silva (2).pdf`, …) para não colidirem, e o aviso serve de
  indicativo de que esses arquivos precisam ser conferidos e ajustados.

Caracteres inválidos para nome de arquivo (`\ / : * ? " < > |`) são removidos do nº da
guia e o nome é limitado a 120 caracteres.

## Requisitos

Navegador moderno (Chrome/Edge 103+, Firefox 113+, Safari 16.4+), necessário para abrir
`.xlsx`. Para apenas CSV, qualquer navegador com JavaScript ativado serve. Não há
instalação, build, servidor ou dependências de terceiros.

## Desenvolvimento

```bash
node --test        # 65 testes: ZIP, XLSX, CSV, núcleo e estrutura da página
```

Estrutura:

```
index.html     página (pt-BR)
styles.css     estilos
app.js         liga os campos ao núcleo
modelo.xlsx    modelo de tabela (sem a coluna de número)
modelo.csv     modelo de tabela (com a coluna de número)
lib/zip.js     ZIP mínimo (escrita stored + leitura deflate-raw)
lib/csv.js     leitor CSV com detecção de separador
lib/xlsx.js    leitor da primeira aba de .xlsx
lib/core.js    tabela, validação, pareamento e nomes de saída
tests/         testes com node --test
```

As bibliotecas são scripts clássicos (funcionam em `file://` e no Node via `require`).
O ZIP de saída é gerado sem compressão — PDFs já vêm comprimidos, então o tamanho final
fica praticamente igual ao dos originais.
