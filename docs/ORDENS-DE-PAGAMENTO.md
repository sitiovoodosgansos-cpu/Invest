# Ordens de pagamento diárias

Todo dia, de madrugada, o Invest sincroniza com o Ornabird, monta uma ordem de
pagamento para cada investidor e manda a lista para o dono. O dono paga, marca
como paga, e cada investidor recebe o comprovante dele.

Este documento explica **por que** o sistema funciona assim. O que ele faz dá
para ver na tela; o motivo de cada decisão, não.

---

## 1. A decisão que define todo o resto

A varredura é por **estado** ("ainda não foi pago"), não por **data** ("vendido
ontem").

O caminho por data parece o óbvio e perde dinheiro em silêncio. No Ornabird,
`soldAt` é **data de negócio e pode ser retroativa** — a especificação da
integração registra isso, e é por isso que o cursor de sincronização usa
`createdAt`. Uma venda lançada hoje com data de anteontem:

- não entraria na ordem de anteontem, que já foi emitida;
- não entraria na ordem de hoje, porque a data não bate.

Ninguém receberia erro. O investidor simplesmente não seria pago, e não haveria
nada na tela indicando isso.

Varrendo por estado, cada venda carrega a marca de qual ordem a pagou. A venda
atrasada entra na primeira rodada depois de ser lançada, com a data real dela
preservada na linha. E a rotina pode rodar duas vezes no mesmo dia sem duplicar
nada.

**Onde fica a marca:** dentro da própria ordem, na lista `items[].saleId`. Não
existe uma coleção separada de "vendas pagas" — a ordem é ao mesmo tempo o
documento que o investidor recebe e a prova de que aquela venda já foi paga. Um
segundo lugar guardando a mesma verdade seria mais uma coisa para sair de
sincronia.

Consequência prática: **cancelar uma ordem devolve as vendas dela para a fila.**
É o único jeito de desfazer uma ordem emitida por engano.

---

## 1b. A trava do primeiro uso

"Tudo que ainda não foi pago" é a regra certa **a partir do dia em que o sistema
assume os pagamentos**. Antes disso ela significa o histórico inteiro do
criatório — centenas de vendas já quitadas à mão ao longo dos meses. A rotina
rodando sozinha nesse estado emitiria uma ordem gigante de dinheiro que já saiu,
e não existe botão de desfazer.

Por isso a emissão automática nasce **parada**. Até ser liberada, a rodada ainda
sincroniza e ainda conta os pendentes — o que o dono precisa para revisar — mas
não emite nada. O estado vive em `/config/ordensConfig.automaticoLiberado`.

A tela mostra a fila de pendentes agrupada por investidor, com duas saídas para
cada seleção:

- **Gerar ordens das selecionadas** — vira pagamento.
- **Já acertadas** — sai da fila **sem** virar pagamento. É como o histórico é
  zerado.

O acerto é gravado como uma ordem de `kind: 'settled'`, e não numa lista
separada de "ignorar". A regra de "já foi pago" continua sendo uma só — a venda
está dentro de alguma ordem — e o documento também registra quando e por quem o
acerto foi declarado, que é o que uma conferência futura vai querer saber.

Um acerto de mil e poucas vendas é quebrado em documentos de até 300 linhas: um
documento só passaria do teto de 1 MiB do Firestore, que recusa a gravação **em
silêncio**.

---

## 2. A cadeia do dia

`vercel.json` dispara `GET /api/cron-diario` às **09:00 UTC = 06:00 de
Brasília**. A Vercel dispara dentro de uma janela, não no segundo exato.

O mesmo `vercel.json` dá **60 segundos de `maxDuration`** a `/api/cron-diario` e
`/api/ordens`. O padrão é curto demais: numa chamada só cabem a busca paginada
no Ornabird, a leitura das cinco coleções espelhadas (mais de mil linhas), a
comparação, as gravações, a leitura das ordens e o e-mail. O botão de
sincronizar do navegador nunca precisou disso porque as gravações aconteciam no
navegador; aqui tudo acontece dentro da função.

1. **Autenticação.** O `CRON_SECRET` no cabeçalho. Sem a variável configurada,
   a rota recusa todo mundo — inclusive a Vercel. Uma configuração esquecida
   não pode virar uma porta aberta na internet.
2. **Sincronização.** Puxa do Ornabird e grava os cinco espelhos, escrevendo só
   as linhas que mudaram.
3. **Ordens.** Varre as vendas ainda não pagas, separa por investidor, aplica a
   taxa e grava uma ordem por investidor.
4. **Aviso.** Manda a lista do dia para `ORDEM_EMAIL_ADMIN`.

**A cadeia para no primeiro erro.** Se a sincronização falhar, nenhuma ordem é
emitida. Emitir seria pior que falhar: com o espelho velho, um investidor que
vendeu hoje receberia um "você não vendeu nada hoje", e o dono não teria motivo
para desconfiar.

Como foi a última rodada fica em `/config/rotinaDiaria`, e a tela mostra. Sem
esse registro, "hoje ninguém vendeu" e "a rotina nem rodou" têm exatamente a
mesma cara: uma lista vazia.

---

## 3. O que é pago

Só o **lucro do investidor**: o percentual acordado sobre o valor bruto de cada
venda (padrão 10% em ovo, 6,4% em animal; cada ave pode ter taxa própria).

Três regras que o código segue e que valem saber:

- **Dono na data da venda**, não o dono de hoje. É o que faz uma transferência
  de titularidade creditar corretamente as vendas antigas sem reescrever
  nenhuma linha guardada.
- **A taxa fica congelada na linha.** Mudar o percentual global depois não
  altera uma ordem já emitida.
- **Cada linha é arredondada antes de somar**, e o total é a soma das linhas
  arredondadas. Assim a conta fecha quando alguém soma as linhas à mão — e essa
  é a primeira coisa que um investidor confere.

Não há valor mínimo: qualquer valor é pago.

---

## 3b. O pagamento abate o saldo do investidor

Até a versão anterior, pagar uma ordem não mexia no saldo de ninguém. O lucro
das vendas do Ornabird não entrava na conta do saldo em canto nenhum — ele só
existia na fila de pendentes —, então o investidor era pago e a tela de Aportes
continuava mostrando o mesmo número de antes.

`saldoOrnabird()` (em `src/utils/ordens.js`) separa o lucro de cada investidor
em quatro estados mutuamente exclusivos:

| Estado | O quê |
|---|---|
| `pendente` | Ainda não entrou em ordem nenhuma — é a fila |
| `emAberto` | Já virou ordem, mas a ordem ainda não foi paga |
| `pago` | Ordem paga |
| `acertado` | Declarado como acertado fora do sistema |

E garante a identidade:

```
credito = pago + acertado + emAberto + pendente
```

Ela vale **por construção**, porque cada parcela vem de um lugar diferente: uma
venda ou está dentro de uma ordem — e aí o valor usado é o **congelado na linha
da ordem**, que foi o que de fato se pagou — ou ainda não está, e aí vale a taxa
de hoje. Usar a taxa de hoje para as duas daria um número diferente do
comprovante que o investidor tem na mão assim que a taxa global mudasse.

O que entra no saldo devido é `emAberto + pendente`. Pagar a ordem move o valor
para `pago` e o saldo cai — que é o efeito inteiro.

**As duas fontes de venda.** A coleção `/sales` (importações de CSV/PDF) e o
espelho `ornabirdVitrine` são independentes e nunca se falaram. Na tela de
Aportes elas aparecem em **colunas separadas**, e não somadas numa só, de
propósito: se a mesma venda existir nas duas, o lucro dela entra duas vezes no
acumulado, e ver os dois números lado a lado é o único jeito de descobrir isso.
A tela avisa quando um investidor tem valor nas duas ao mesmo tempo.

A tela de **Relatórios** e o portal do investidor continuam com a definição
antiga de saldo, sem a parte do Ornabird. Foi decisão de escopo — mexer neles
mudaria o relatório do link já compartilhado.

---

## 3c. Encerrar a participação de um investidor

Encerrar **não é apagar**. Apagar leva junto as aves e o histórico de rateio, e
os relatórios de meses passados passam a mostrar números diferentes dos que o
investidor recebeu na época.

Encerrar grava `encerradoEm` no cadastro e só isso. O efeito:

- não recebe mais o aviso de "nenhuma venda hoje" — seria um convite diário para
  quem acabou de sair;
- some do seletor de investidor ao cadastrar ave nova e ao lançar aporte novo;
- **continua** no seletor de "Registrar Pagamento", porque o acerto final é
  justamente o pagamento que se faz depois da saída;
- **continua recebendo ordem de pagamento** se ainda houver venda dele em
  aberto. Dinheiro devido não deixa de ser devido porque a sociedade acabou.

A tela de Investidores mostra os encerrados numa seção própria, com a data da
saída e quanto ainda falta pagar; a fila de pendentes marca o grupo deles com o
selo "participação encerrada", que é o lembrete de fazer o acerto final.

---

## 3d. A data da ordem

A emissão manual aceita uma data (`referenceDate`), que começa em hoje. Existe
para quando o dinheiro saiu num dia e o lançamento só foi feito no outro: a
ordem tem que dizer o dia do dinheiro, senão o comprovante do investidor briga
com o extrato do banco.

O `createdAt` continua sendo o instante real — é o que uma conferência usa para
saber **quando** o registro foi feito, que não é a data que ele declara.

A data é validada no servidor antes de qualquer coisa, e não só no formato: ela
vira parte do ID do documento (`20260822-<investidor>-1`), e um valor inválido
geraria um ID que nunca colide com nada. A proteção contra emitir a mesma ordem
duas vezes depende justamente do ID repetir, e sairia de cena em silêncio.

---

## 4. Paga primeiro, avisa depois

O investidor só recebe o comprovante depois que o dinheiro saiu. Por isso
"marcar como paga" e "enviar" são **a mesma ação**, não dois botões. Botões
separados criariam o estado "avisei antes de pagar", que é exatamente o que a
regra quer evitar.

O que não é atômico, e não dá para ser: o e-mail sai de um servidor de
terceiros. A ordem é gravada como paga **primeiro** e o envio vem depois, com o
resultado em `sentAt` / `sentError`. Perder o e-mail de uma ordem paga é um
reenvio; perder o registro do pagamento é um pagamento duplicado.

Uma ordem paga cujo e-mail falhou continua selecionável na tela, para reenvio.
Marcar de novo não cobra nada duas vezes: o servidor só grava `paidAt` se a
ordem ainda não estiver paga.

---

## 4b. Quando o Resend não funcionar

Envio automático depende de serviço de terceiro, e serviço de terceiro cai.
Quando cair, o dinheiro já saiu e o investidor está sem o comprovante — então
cada ordem tem quatro botões que **não passam por servidor nenhum**:

| Botão | O que faz |
|---|---|
| **PDF** | Baixa a ordem como documento. Serve de anexo em qualquer canal. |
| **WhatsApp** | Abre o WhatsApp no número do cadastro, com a mensagem pronta. |
| **E-mail** | Abre o programa de e-mail **do dono**, com a mensagem pronta. |
| **Copiar** | Copia o texto, para colar onde for. |

O e-mail daqui sai da conta do dono, não do Resend. É isso que faz disto uma
alternativa de verdade, e não outro caminho para o mesmo ponto de falha.

Ficam **sempre visíveis**, não escondidos atrás de "Ver itens": o dia em que
forem necessários é um dia em que algo já falhou, e aí o caminho manual não
pode estar a um clique de descoberta.

Sem telefone ou e-mail no cadastro, o botão correspondente aparece apagado
dizendo o que falta — em vez de abrir o WhatsApp num número inexistente, que
falharia em silêncio. O PDF nunca depende de cadastro.

**Ordem longa demais para o `mailto:`**: o Windows corta a linha de comando em
2048 caracteres, e um `mailto:` maior chega ao programa de e-mail com o corpo
truncado *no meio* — meia ordem, sem nada indicando que faltou pedaço. Passando
de 1800 caracteres o link manda um resumo, o botão passa a dizer
"E-mail (resumo)", e o detalhamento vai no PDF anexado à mão.

E **"Baixar o dia (PDF)"**, no topo: todas as ordens do dia num arquivo — capa
com a lista e as chaves PIX, depois uma página por ordem. É o que se leva para
o banco, e é a saída quando o e-mail das 6h não chegou.

---

## 5. Os casos que não podem passar em branco

| Situação | O que o sistema faz |
|---|---|
| Venda de lote não vinculado no Plantel | Não entra em ordem nenhuma, mas aparece na tela e no e-mail do dono, com o valor. Ninguém receberá por ela até o vínculo ser feito. |
| Investidor sem venda no dia | Recebe um aviso de zero vendas com o convite para aumentar o plantel. Desligável por investidor no cadastro. |
| Investidor sem e-mail | A ordem é paga do mesmo jeito; a tela diz de quem é e por quê. |
| Segunda rodada no mesmo dia | Quem já tem ordem hoje não recebe aviso de zero vendas — seria uma mensagem falsa contradizendo o comprovante que ele acabou de receber. |
| Resend fora do ar ou não configurado | As ordens são geradas normalmente e ficam na tela. Só o e-mail deixa de sair, e o motivo fica gravado. |

---

## 6. Variáveis de ambiente (projeto `invest` na Vercel)

| Variável | Para quê | Sem ela |
|---|---|---|
| `CRON_SECRET` | Autentica a chamada da Vercel | A rotina não roda (503) |
| `RESEND_API_KEY` | Envio de e-mail | Ordens são geradas, e-mails não saem |
| `ORDEM_EMAIL_FROM` | Remetente, ex.: `Sitio Voo dos Gansos <ordens@dominio.com.br>` | Idem |
| `ORDEM_EMAIL_ADMIN` | Para onde vai a lista da madrugada | A lista não é enviada |

`FIREBASE_SERVICE_ACCOUNT`, `ORNABIRD_API_URL` e `ORNABIRD_API_TOKEN` já
existiam para a sincronização e continuam necessárias.

O domínio precisa estar **verificado no Resend**. Sem verificação o e-mail cai
na caixa de spam do investidor, o que é pior do que não chegar.

---

## 7. Onde as coisas moram

| Arquivo | O quê |
|---|---|
| `src/utils/ordens.js` | A conta, incluindo `saldoOrnabird()`. Sem Firestore, sem rede — dá para testar sozinha |
| `api/_rotina-diaria.js` | A cadeia do dia, usada pelo cron e pelo botão "Rodar agora" |
| `api/cron-diario.js` | A porta que a Vercel bate, e o `CRON_SECRET` |
| `api/ordens.js` | Ações do dono: rodar agora, marcar como paga e enviar |
| `api/_email.js` | Resend e os dois modelos de mensagem |
| `src/utils/ordemEntrega.js` | Entrega manual: texto, PDF, WhatsApp e `mailto:` |
| `src/pages/OrdensPagamento.jsx` | A tela: fila de pendentes, saldo por investidor e as ordens do dia |
| `src/pages/Financial.jsx` | O saldo do investidor, já com a parte do Ornabird |
| `src/pages/Investors.jsx` | Encerrar participação e a seção de arquivados |

`/paymentOrders` é a única coleção destas regras com **leitura fechada** — cada
documento diz quanto um investidor recebeu. E a **escrita é negada para todo
mundo**, inclusive para o administrador logado: quem grava é o servidor, pelo
firebase-admin, que passa por cima das regras. Um segundo caminho pelo navegador
poderia marcar uma ordem como paga sem nunca enviar nada.

---

## 8. Ainda não feito

- **PIX automático.** A chave PIX já é coletada no cadastro e viaja na ordem,
  mas o pagamento é manual. O passo seguinte é a API do banco, com aprovação
  humana antes de cada lote.
- **WhatsApp.** Hoje só e-mail.
- **Índice de vendas pagas.** A rotina lê a coleção `/paymentOrders` inteira a
  cada rodada para saber o que já foi pago. São poucos documentos por dia;
  quando passar da casa dos milhares, vale um índice separado.

---

## 9. Onde conferir o que vai ser pago

A tela **Vendas Ornabird** lista as vendas espelhadas com o investidor de cada
uma já resolvido — é a mesma conta que a ordem de pagamento faz, inclusive a
regra do dono na data da venda. Se um número na ordem parecer estranho, é lá
que se confere linha a linha.

Ela também é a única tela que mostra as vendas **sem lote vinculado**: dinheiro
que não entra em ordem nenhuma e que ninguém vai receber enquanto o vínculo não
for feito no Plantel.
