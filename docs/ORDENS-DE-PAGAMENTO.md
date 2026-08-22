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
| `src/utils/ordens.js` | A conta. Sem Firestore, sem rede — dá para testar sozinha |
| `api/_rotina-diaria.js` | A cadeia do dia, usada pelo cron e pelo botão "Rodar agora" |
| `api/cron-diario.js` | A porta que a Vercel bate, e o `CRON_SECRET` |
| `api/ordens.js` | Ações do dono: rodar agora, marcar como paga e enviar |
| `api/_email.js` | Resend e os dois modelos de mensagem |
| `src/pages/OrdensPagamento.jsx` | A tela |

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
