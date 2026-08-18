# Integração Ornabird → Invest

Especificação do contrato entre o **Ornabird** (`avicultura-saas`, Next.js,
`ornabird.app`) e o **Invest** (este repositório).

**Direção:** somente leitura, Ornabird → Invest. O Ornabird é a fonte da
verdade operacional. O Invest apenas espelha, para saber quanto cada
investidor tem a receber. Nada é escrito de volta.

---

## 1. Contexto: o que o Invest precisa e por quê

O Invest controla **quais investidores são donos de quais lotes de aves** e
distribui o lucro das vendas entre eles. O lucro do investidor é um
percentual **sobre o valor bruto da venda** (padrão: 10% ovos, 6,4% animal),
configurável globalmente e por lote.

Portanto o Invest **não precisa de custos nem de lucro líquido** — receita
bruta por lote é exatamente o insumo correto.

### O eixo do vínculo

Uma linha do Plantel do Invest ↔ um `FlockGroup` do Ornabird, ligados por
`FlockGroup.id` (cuid estável, sobrevive a backup/restore).

Não usar `Bird.id`: o rastreio ave→venda é incompleto hoje
(`markBirdsSold` pega as N primeiras ativas por anilha sem gravar o
`saleId`, e a venda unitária nem marca as aves). A atribuição precisa ser
**sempre em nível de grupo**.

### Regra de negócio definida pelo dono

> **Os filhotes seguem o lote de origem.** Quando um lote choca, a venda dos
> filhotes gera lucro para o mesmo investidor dono das matrizes.

Isso é o que torna o item 3 abaixo obrigatório.

---

## 2. Autenticação (precisa ser criada)

Hoje o Ornabird tem três esquemas, todos por cookie de navegador. Nenhum
serve para máquina-a-máquina.

**Proposta:** um token de serviço no mesmo padrão que
`/api/cron/archive-cold-leads` já usa.

```
Authorization: Bearer ${INVEST_SYNC_TOKEN}
```

- Nova variável de ambiente `INVEST_SYNC_TOKEN` (mínimo 32 bytes aleatórios)
- Comparação com `safeEqual` — nunca `===` (evita ataque de temporização)
- **Somente leitura.** Estas rotas jamais escrevem
- Escopo de um único tenant: o token identifica o tenant, ou o tenant vem
  numa segunda variável `INVEST_SYNC_TENANT_ID`
- Responder `401` sem corpo descritivo quando o token não confere

Não reaproveitar `WorkerAccessLink`: ele é por funcionário, tem flags de
módulo e é revogável pela interface — semânticas diferentes.

---

## 3. O problema das chocadas (o ponto mais importante)

`createListingsFromHatchedBatch` (`src/lib/vitrine/service.ts:934`) cria um
**`FlockGroup` novo a cada chocada**, com título
`Chocada <Mês>/<Ano> · <grupo pai>`, herdando espécie/raça/variedade/baia,
com `matrixCount = 0`.

E **não existe FK pai→filho entre grupos.** O vínculo só é reconstruível
indiretamente:

```
VitrineListing.flockGroupId = <grupo filho>
  → VitrineListing.sourceIncubatorBatchId
    → IncubatorBatch.flockGroupId = <grupo pai>
```

Sem resolver isso, cada chocada produziria um lote órfão no Invest e a venda
dos filhotes não chegaria ao investidor.

### Solução pedida

**(a) Passar a gravar o vínculo.** Adicionar ao modelo:

```prisma
model FlockGroup {
  // ...
  parentFlockGroupId String?
  parentFlockGroup   FlockGroup?  @relation("FlockGroupHatch", fields: [parentFlockGroupId], references: [id], onDelete: SetNull)
  hatchChildren      FlockGroup[] @relation("FlockGroupHatch")
}
```

Preencher em `createListingsFromHatchedBatch` com o `flockGroupId` do
`IncubatorBatch` que originou a chocada.

**(b) Backfill dos grupos já existentes** pelo caminho indireto acima
(um script único; onde houver mais de um pai possível, deixar nulo e
registrar para conferência manual).

Se (a) não for viável agora, a API abaixo pode resolver o pai em tempo de
consulta pelo mesmo caminho — mas fica mais lento e mais frágil.

---

## 4. Endpoints

### 4.1 Catálogo de lotes — para o Invest oferecer o vínculo

```
GET /api/integrations/invest/groups
Authorization: Bearer <INVEST_SYNC_TOKEN>
```

Resposta `200`:

```jsonc
{
  "groups": [
    {
      "id": "clx123...",              // FlockGroup.id — a chave do vínculo
      "title": "Sedosa Branca A1",
      "species": "Galinha",
      "breed": "Sedosa",
      "variety": "Branca",            // null se não houver
      "bayNumber": 1,
      "matrixCount": 4,
      "reproducerCount": 1,
      "purchaseInvestmentTotal": 3500.00,
      "purchaseDate": "2025-08-01",
      "isHatchGroup": false,          // true = grupo criado por chocada
      "isResale": false,              // true = grupo "Recria ·" (revenda)
      "parentFlockGroupId": null,     // preenchido quando isHatchGroup
      "birdCount": 5,                 // aves ACTIVE, para conferência
      "createdAt": "2025-08-01T..."
    }
  ]
}
```

Incluir **todos** os grupos, inclusive os de chocada e os `Recria ·` — o
Invest decide o que exibir. Marcar com as flags em vez de filtrar.

### 4.2 Sincronização — os dados de cada lote

```
POST /api/integrations/invest/sync
Authorization: Bearer <INVEST_SYNC_TOKEN>
Content-Type: application/json

{
  "groupIds": ["clx123...", "clx456..."],
  "from": "2026-01-01",
  "to": "2026-08-31",
  "includeDescendants": true
}
```

`includeDescendants: true` → para cada id pedido, o Ornabird percorre a
cadeia de chocadas (`parentFlockGroupId`, recursivo) e **soma os dados dos
descendentes no lote raiz pedido**, porque os filhotes pertencem ao mesmo
investidor. Os ids dos descendentes vêm em `descendantIds` para conferência.

Resposta `200`:

```jsonc
{
  "from": "2026-01-01",
  "to": "2026-08-31",
  "groups": {
    "clx123...": {
      "descendantIds": ["clx789..."],

      "eggCollections": [
        { "id": "...", "date": "2026-03-04", "quantity": 12,
          "flockGroupId": "clx123..." }
      ],

      "trays": [                     // PRATELEIRA
        { "id": "...", "label": "Bandeja 3",
          "speciesLabel": "Galinha", "breedLabel": "Sedosa",
          "varietyLabel": "Branca",
          "eggCount": 30,            // entradas ainda na bandeja
          "discardedCount": 2,
          "status": "OPEN",
          "createdAt": "2026-03-01T..." }
      ],

      "incubatorBatches": [          // CHOCADEIRA
        { "id": "...", "setDate": "2026-03-10", "eggCount": 24,
          "hatchedCount": 18, "status": "HATCHED",
          "hatchDate": "2026-04-01" }
      ],

      "sales": [                     // VITRINE + OVOS
        { "id": "...", "source": "vitrine",
          "date": "2026-05-02",
          "description": "Casal Sedosa Branca",
          "quantity": 2, "unitPrice": 450.00, "amount": 900.00,
          "customer": "Fulano",
          "isEgg": false,
          "originGroupId": "clx789..." }   // qual lote (raiz ou descendente)
      ]
    }
  }
}
```

#### Notas sobre `sales`

- Reaproveitar a lógica de `listRevenueSales`
  (`src/lib/plantel/service.ts:1324`), que já resolve a atribuição:
  ovos por `trayEntry.tray.flockGroupId`, vitrine por
  `listing.flockGroupId ?? listing.sourceIncubatorBatch.flockGroupId`
- `amount` = **valor bruto do item** (`VitrineSale.totalPrice`), não o
  líquido do `FinancialEntry`. O Invest aplica o próprio percentual sobre o
  bruto
- `isEgg` distingue a taxa aplicada (10% vs 6,4%) — derivar de
  `source === "egg"` ou da categoria do lançamento
- `source: "manual"` hoje casa por `FinancialEntry.item === group.title`
  (string). Marcar esses com `"matchedBy": "title"` para o Invest poder
  sinalizar que a atribuição é incerta
- **Não** usar `/api/vitrine/sales` como fonte: ele não devolve
  `listingId`, `flockGroupId` nem `birdId` — só títulos em texto

#### Paginação e limites

Se o período pedido produzir muitos registros, paginar por
`cursor`/`nextCursor` em `sales`. O Invest chama em laço até esgotar.

---

## 5. O que o Invest fará com isso

1. **Vínculo:** cada linha do Plantel ganha `ornabirdGroupId`. A tela oferece
   um seletor alimentado por 4.1
2. **Herança automática:** grupos de chocada nunca precisam ser vinculados à
   mão — entram pelo `includeDescendants`
3. **Coleta de ovos:** espelhada por lote, alimentando os relatórios
4. **Prateleira:** página nova no Invest, mostrando as bandejas por lote
5. **Chocadeira:** lotes de chocagem e taxa de eclosão por investidor
6. **Vendas:** substituem a atribuição atual por **texto** — hoje o Invest
   descobre o dono procurando o nome da raça dentro da descrição da venda
   (`matchSaleToBird`), o que erra quando os nomes se parecem. Com
   `originGroupId` a atribuição passa a ser exata

---

## 6. Segurança

- As rotas `/api/integrations/invest/*` são **somente leitura**
- Nunca devolver dados de outro tenant: filtrar por `tenantId` em toda query,
  como o resto do sistema já faz
- Não devolver dados pessoais de clientes além do nome já exibido na venda
- Responder `no-store` no cabeçalho
- Registrar as chamadas no `AuditLog`, se houver espaço no modelo

---

## 7. Fora de escopo por enquanto

- Escrita do Invest para o Ornabird
- Sincronização de sanidade, CRM, envios e publicidade
- Conceito de investidor dentro do Ornabird — ele continua sem saber que
  investidores existem; o vínculo mora só no Invest
