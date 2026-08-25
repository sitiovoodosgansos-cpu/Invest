import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { db, auth } from '../firebase';
import {
  doc, collection, onSnapshot, setDoc, getDoc, getDocs, deleteDoc, writeBatch,
} from 'firebase/firestore';
import {
  partitionSaleDuplicates, isEggProduct, normalizeDay, previousDay, resolveRateFor,
  DEFAULT_EGG_PROFIT_RATE, DEFAULT_BIRD_PROFIT_RATE, jsonEstavel, fatiaDeComissao,
} from '../utils/helpers';
import { MULTIPLICADOR_AVE_PADRAO } from '../utils/ordens';
import { PORTAL_API_ENABLED, isPortalRoute } from '../hooks/usePortalData';
import { decidirSnapshot, ACAO } from '../utils/protecaoSnapshot';

// Generate a collision-free, non-enumerable ID for any locally-created entity.
// Prefers the Web Crypto API (128 bits of entropy) and falls back to a
// timestamp + random fragment only on the rare browser that lacks it. Never
// returns a predictable Date.now() value the way the Phase 1 code did.
const newId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Last-resort fallback. Still non-sequential enough to avoid accidental
  // collisions inside a session, though not cryptographically strong.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

// PRIVACY: on a portal route the browser must not subscribe to Firestore at
// all. Filtering in the component is not enough — the whole database would
// still cross the wire and sit in the visitor's memory, which is exactly the
// exposure the /api/portal endpoint exists to close. When this is true every
// listener, migration and write-back below is skipped and the portal gets its
// (already scoped) data from the server instead.
//
// Evaluated once at module load, so the admin app — which loads on a non-portal
// URL — is unaffected. Inert until VITE_PORTAL_API=1.
const PORTAL_MODE = PORTAL_API_ENABLED && isPortalRoute();

// Exportado para o portal do investidor montar o MESMO contexto com uma fatia
// ja filtrada no servidor. Assim as telas nao precisam saber se estao no app
// completo ou no portal — mudam so os dados que chegam.
export const AppContext = createContext();

const STORAGE_KEY = 'sitio_voo_dos_gansos_data';
const BACKUP_KEY = 'sitio_voo_dos_gansos_backup';
const FIRESTORE_DOC = doc(db, 'config', 'appData');
// Sales live in their own collection to escape the 1 MiB per-doc cap that
// used to silently drop writes around the ~1100-sale mark. See firestore.rules
// for the matching security model and the migration comment below.
const SALES_COLLECTION = collection(db, 'sales');
// Ver o comentario extenso onde ela e usada, no listener de /sales.
const ERROS_SEM_VOLTA = new Set([
  'resource-exhausted', 'permission-denied', 'unauthenticated',
]);
// Egg collections also live in their own collection now, for the same
// Read-only mirror of Ornabird (ornabird.app). Bulk-replaced by the sync;
// never edited by hand. Separate collections so they cannot re-create the
// 1 MiB ceiling that already bit sales and egg collections.
const ORNABIRD_TRAYS_COLLECTION = collection(db, 'ornabirdTrays');
const ORNABIRD_VITRINE_COLLECTION = collection(db, 'ornabirdVitrine');
const ORNABIRD_EGGS_COLLECTION = collection(db, 'ornabirdEggCollections');
const ORNABIRD_BATCHES_COLLECTION = collection(db, 'ornabirdIncubatorBatches');
const ORNABIRD_LISTINGS_COLLECTION = collection(db, 'ornabirdVitrineListings');
// Ordens de pagamento diarias. Colecao propria, e nao um campo do appData,
// pela mesma razao das vendas: a lista so cresce, e um array crescendo dentro
// do documento unico ja bateu no teto de 1 MiB duas vezes nesta base.
const PAYMENT_ORDERS_COLLECTION = collection(db, 'paymentOrders');
// Como foi a ultima rodada da rotina das 6h. Sem isto, "hoje ninguem vendeu" e
// "a rotina nem rodou" ficam com a mesma cara na tela.
const ROTINA_DOC = doc(db, 'config', 'rotinaDiaria');
// LocalStorage flag: once set, we know the /sales collection has been
// hydrated from the legacy appData.sales array and the array has been
// cleared. Prevents us from re-migrating on every session.
const SALES_MIGRATION_KEY = 'sitio_voo_dos_gansos_sales_migrated_v1';

// Dev-only logger. Avoids leaking internal sync state to the browser console
// in production, which would help attackers reverse-engineer the app.
const devWarn = (...args) => {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn(...args);
  }
};
const devError = (...args) => {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.error(...args);
  }
};

// NOTE: `sales` lives in its own state slice / Firestore collection now.
// The actual sales data is in the /sales collection (one doc per sale).
// However, `defaultData` still includes `sales: []` because the Firestore
// security rules for /config/appData require a `sales` field to be present
// (it was part of the original schema). Without it, any appData write
// would be rejected by the rules, silently losing other data updates.
// This empty array is never used for rendering — the real sales come from
// the separate `sales` state slice fed by the /sales collection listener.
const defaultData = {
  investors: [],
  birds: [],
  sales: [],
  financialInvestments: [],
  customSpecies: [],
  payments: [],
  expenses: [],
  customExpenseCategories: [],
  infirmaryBays: [],
  infirmaryAdmissions: [],
  treatments: [],
  customTreatmentTypes: [],
  nurseryRooms: [],
  nurseryBatches: [],
  nurseryEvents: [],
  employeeToken: '',
  // Global profit rates applied to new sales. Stored here so every page —
  // including the read-only investor/employee portals — reads them straight
  // from useApp(). Existing sales keep the rate they were registered with.
  eggProfitRate: DEFAULT_EGG_PROFIT_RATE,
  birdProfitRate: DEFAULT_BIRD_PROFIT_RATE,
  // Quantos ovos uma ave vale. Quatro foi o numero acertado com os
  // investidores; fica configuravel porque e um acordo, nao uma lei.
  multiplicadorAve: MULTIPLICADOR_AVE_PADRAO,
};

// Cadastro manual de chocadeiras/chocagens, descontinuado em favor do espelho
// /ornabirdIncubatorBatches. Os arrays sao descartados ao CARREGAR: como o
// documento e regravado inteiro (setDoc sem merge), a proxima gravacao apaga
// os campos do Firestore sozinha.
//
// Descartar na leitura, e nao so parar de ler, importa por causa do guarda
// anti-perda abaixo: se os campos sumissem do Firestore com o app ainda
// carregando-os, o guarda veria menos itens do que tem em memoria e devolveria
// os antigos por cima — ressuscitando o que se quer apagar.
const CAMPOS_LEGADOS = ['incubators', 'incubatorBatches'];

function semCamposLegados(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const limpo = { ...obj };
  for (const chave of CAMPOS_LEGADOS) delete limpo[chave];
  return limpo;
}

// Count total items across all arrays in data. Sales are tracked separately
// now and deliberately NOT counted here — this function is only used to
// guard /config/appData writes.
const countItems = (d) =>
  (d.investors?.length || 0) +
  (d.birds?.length || 0) +
  (d.financialInvestments?.length || 0) +
  (d.customSpecies?.length || 0) +
  (d.payments?.length || 0) +
  (d.expenses?.length || 0) +
  (d.customExpenseCategories?.length || 0) +
  (d.infirmaryBays?.length || 0) +
  (d.infirmaryAdmissions?.length || 0) +
  (d.treatments?.length || 0) +
  (d.customTreatmentTypes?.length || 0) +
  (d.nurseryRooms?.length || 0) +
  (d.nurseryBatches?.length || 0) +
  (d.nurseryEvents?.length || 0);

// Default species (empty breeds - user adds breeds manually via the app)
export const BIRD_SPECIES = [];

export function AppProvider({ children }) {
  const [data, setData] = useState(defaultData);
  // Sales live in their own slice backed by the /sales collection. We keep
  // them in a plain array in state so the rest of the app (Sales page,
  // profit distribution, reports, portals) can treat sales like any other
  // list without knowing where they're persisted.
  const [sales, setSales] = useState([]);
  // ESPELHOS SOB DEMANDA.
  //
  // Cada listener destes escuta uma COLECAO INTEIRA, e o Firestore cobra uma
  // leitura por documento toda vez que um listener conecta. So o espelho de
  // vendas do Ornabird ja passa de mil e quinhentos documentos — e ele era lido
  // no Dashboard, no Plantel, na Coleta de Ovos e em todas as outras telas que
  // nao usam venda nenhuma.
  //
  // Agora a tela DECLARA de que precisa (useColecoes) e so isso e assinado.
  //
  // Uma colecao pedida NUNCA e desligada enquanto a aba viver. Desligar ao sair
  // da tela pareceria mais economico e seria o contrario: voltar pra tela
  // reconectaria o listener, e reconectar e o evento que custa. Assinar uma vez
  // e ficar ouvindo custa so o que muda.
  const [colecoesPedidas, setColecoesPedidas] = useState(() => new Set());
  // Quais ja receberam o primeiro snapshot. Sem isto, uma tela nao distingue
  // "ainda carregando" de "nao ha nada" — e em Ordens de Pagamento essa
  // diferenca chega a mostrar o botao de liberar a rotina automatica numa fila
  // que so parece vazia.
  const [colecoesProntas, setColecoesProntas] = useState(() => new Set());

  const pedirColecoes = useCallback((nomes) => {
    setColecoesPedidas(prev => {
      const faltando = (nomes || []).filter(n => n && !prev.has(n));
      // Devolver o mesmo Set quando nada falta e o que impede o ciclo
      // render -> efeito -> setState -> render.
      if (faltando.length === 0) return prev;
      const proximo = new Set(prev);
      for (const n of faltando) proximo.add(n);
      return proximo;
    });
  }, []);

  const marcarPronta = useCallback((nome) => {
    setColecoesProntas(prev => (prev.has(nome) ? prev : new Set(prev).add(nome)));
  }, []);

  // No portal nao ha listener nenhum: a fatia ja vem pronta do servidor. Entao
  // tudo conta como pronto, senao as telas do investidor ficariam carregando
  // para sempre.
  const colecaoPronta = useCallback(
    (nome) => PORTAL_MODE || colecoesProntas.has(nome),
    [colecoesProntas]
  );

  // ESPELHOS QUE MORRERAM CALADOS.
  //
  // Cada um dos sete listeners de espelho tratava erro assim:
  //
  //     }, (error) => marcarFalha('bandejas', error));
  //
  // `devError` some em producao. Do lado de fora nao acontece NADA: a tela nao
  // recebe dado novo e tambem nao recebe aviso. `colecaoPronta` continua false
  // para sempre, entao a tela fica girando "carregando" sem fim — ou, pior,
  // mostrando o numero da ultima vez que deu certo, como se fosse o de hoje.
  //
  // Num app que paga gente por coleta de ovos, numero velho sem aviso e o
  // defeito mais caro que existe: ele e indistinguivel de estar certo. Este
  // projeto ja consertou cinco falhas silenciosas; esta e a mesma familia.
  //
  // NAO SE RELIGA AQUI DE PROPOSITO. Religar sozinho foi exatamente o que
  // torrou 467 mil leituras num dia (ver o listener de /sales). O certo e
  // contar o que houve e deixar a pessoa recarregar.
  const [espelhosComFalha, setEspelhosComFalha] = useState(() => ({}));

  // As duas entram na lista de dependencias dos efeitos de espelho. Isso SO e
  // seguro porque `useCallback([])` as torna estaveis: se elas mudassem a cada
  // render, cada render desligaria e religaria os sete listeners — que e
  // exatamente a tempestade de religacao que torrou 467 mil leituras num dia.
  const marcarFalha = useCallback((nome, error) => {
    devError(`Espelho ${nome}: listener caiu`, error);
    setEspelhosComFalha(prev => (
      prev[nome] === (error?.code || 'erro') ? prev : { ...prev, [nome]: error?.code || 'erro' }
    ));
  }, []);

  // Um snapshot que chega e a prova de que voltou.
  const limparFalha = useCallback((nome) => {
    setEspelhosComFalha(prev => {
      if (!(nome in prev)) return prev;
      const proximo = { ...prev };
      delete proximo[nome];
      return proximo;
    });
  }, []);

  const [ornabirdTrays, setOrnabirdTrays] = useState([]);
  const [ornabirdVitrine, setOrnabirdVitrine] = useState([]);
  const [ornabirdEggCollections, setOrnabirdEggCollections] = useState([]);
  const [ornabirdIncubatorBatches, setOrnabirdIncubatorBatches] = useState([]);
  const [ornabirdVitrineListings, setOrnabirdVitrineListings] = useState([]);
  const [paymentOrders, setPaymentOrders] = useState([]);
  const [rotinaDiaria, setRotinaDiaria] = useState(null);
  const [loading, setLoading] = useState(true);
  const [salesLoading, setSalesLoading] = useState(true);
  const [firestoreError, setFirestoreError] = useState(null);
  // saveError surfaces rejected Firestore writes to the UI. Unlike
  // firestoreError (which is about read/listen failures) this is flipped
  // when setDoc/writeBatch throws, so admins can tell when a save didn't
  // land and redo the action or contact support. It auto-clears on the
  // next successful write.
  const [saveError, setSaveError] = useState(null);
  const lastLocalWriteTime = useRef(0);
  // SO O SERVIDOR arma esta. Ela libera o REPUBLICAR — a republicacao dos dados
  // locais quando um snapshot chega com menos itens do que temos. So faz
  // sentido contra quem pode discordar de nos, e o cache SOMOS nos: se ele
  // armasse, uma exclusao feita no celular seria desfeita pelo computador na
  // manha seguinte.
  const dataLoadedFromFirestore = useRef(false);
  // O CACHE TAMBEM arma esta. Ela libera a GRAVACAO, que e outra pergunta:
  // "ja sei o que existe la, entao posso escrever por cima?". O cache responde
  // isso tao bem quanto o servidor — ele E o que o Firestore nos deu por
  // ultimo.
  //
  // Enquanto as duas perguntas dividiam a mesma flag, o preco do ovo digitado
  // antes do snapshot do servidor chegar era descartado por um `return` mudo:
  // a tela mostrava o valor (o React atualizou) e o banco nunca recebia. Com a
  // cota do Firestore estourada o snapshot do servidor NUNCA chegava, e o dono
  // preencheu o Plantel cinco vezes sem nada ser gravado.
  const dadosCarregados = useRef(false);
  // O OBJETO QUE O SNAPSHOT ENTREGOU — para nao gravar de volta o que acabou
  // de chegar.
  //
  // O DEFEITO
  // ---------
  // O efeito de gravar depende de `data`. Ele dispara quando a IDENTIDADE do
  // objeto muda, e nao tem como saber por que mudou. Mas ela muda por dois
  // motivos bem diferentes:
  //
  //   1. o dono editou alguma coisa   -> tem que gravar;
  //   2. chegou um snapshot do banco  -> NAO tem que gravar, isso ja e o que
  //      esta gravado.
  //
  // O caminho 2 monta `{ ...defaultData, ...dados }` — objeto novo toda vez —,
  // entao toda novidade que chegava virava uma gravacao de volta.
  //
  // POR QUE ISSO NAO PARAVA SOZINHO
  // -------------------------------
  // Com o Invest aberto no computador E no celular (que e como o dono usa), a
  // gravacao de volta de um chega no outro como novidade, e o outro grava de
  // volta tambem. A protecao de JANELA_ESCRITA_MS ignora o que chega ate 10s
  // depois da propria gravacao, o que matava a troca quando a rede era rapida
  // — e so quando era rapida.
  //
  // Medido em medir-dois-aparelhos.mjs, com o AppProvider de verdade:
  //
  //     devolucao em  1s, 5s, 9s  -> 1 gravacao,  a troca morre
  //     devolucao em 12s, 20s     -> nao para mais
  //
  // Passando de 10s a troca fica de pe para sempre. E de madrugada que ela
  // passa: o navegador segura os timers de aba em segundo plano, o celular
  // fica de tela apagada, a conexao ociosa demora. O console do Firebase
  // mostrou 634 mil leituras em 24h com picos as 2h e as 4h da manha.
  //
  // A CORRECAO E POR IDENTIDADE, NAO POR SINALIZADOR
  // ------------------------------------------------
  // Guardar o proprio objeto que veio do snapshot e comparar por `===` e o que
  // torna isto seguro. Um sinalizador booleano ("ignore a proxima") engoliria
  // uma edicao feita no mesmo instante em que um snapshot chega — e perder
  // gravacao em silencio e o defeito que este projeto ja consertou cinco
  // vezes. Comparando identidade nao ha esse risco: se o dono editou, `data`
  // e um objeto DIFERENTE do que o snapshot entregou, e a gravacao acontece.
  const dataDoSnapshot = useRef(null);
  const firestoreItemCount = useRef(0);
  const pendingWriteCount = useRef(0);
  // Track local deletes so onSnapshot won't reject fewer items after intentional deletes
  const localDeleteCount = useRef(0);
  // Keep a ref to latest data for use in event handlers (beforeunload, visibilitychange)
  const dataRef = useRef(data);
  dataRef.current = data;
  const salesRef = useRef(sales);
  salesRef.current = sales;
  const ornabirdTraysRef = useRef(ornabirdTrays);
  ornabirdTraysRef.current = ornabirdTrays;
  const ornabirdVitrineRef = useRef(ornabirdVitrine);
  ornabirdVitrineRef.current = ornabirdVitrine;
  const ornabirdEggsRef = useRef(ornabirdEggCollections);
  ornabirdEggsRef.current = ornabirdEggCollections;
  const ornabirdBatchesRef = useRef(ornabirdIncubatorBatches);
  ornabirdBatchesRef.current = ornabirdIncubatorBatches;
  const ornabirdListingsRef = useRef(ornabirdVitrineListings);
  ornabirdListingsRef.current = ornabirdVitrineListings;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  // Listen to Firestore in real-time
  useEffect(() => {
    // PRIVACY: portals never read the shared document directly.
    if (PORTAL_MODE) { setLoading(false); return; }
    const unsubscribe = onSnapshot(FIRESTORE_DOC, (snapshot) => {
      setFirestoreError(null);
      if (snapshot.exists()) {
        // Com o cache local ligado, o PRIMEIRO snapshot vem da copia local — e
        // ele nunca pode acionar a protecao abaixo. Ver protecaoSnapshot.js.
        const doCache = snapshot.metadata?.fromCache === true;
        const firestoreData = { ...defaultData, ...semCamposLegados(snapshot.data()) };
        const incomingCount = countItems(firestoreData);
        const currentCount = countItems(dataRef.current);

        const acao = decidirSnapshot({
          doCache,
          escritasPendentes: pendingWriteCount.current,
          msDesdeEscrita: Date.now() - lastLocalWriteTime.current,
          jaVeioDoServidor: dataLoadedFromFirestore.current,
          itensLocais: currentCount,
          itensRecebidos: incomingCount,
          apagadosLocais: localDeleteCount.current,
        });

        if (acao === ACAO.IGNORAR) {
          setLoading(false);
          return;
        }

        if (acao === ACAO.REPUBLICAR) {
          const quedaPermitida = localDeleteCount.current;
          localDeleteCount.current = 0;
          devWarn(
            `Blocked: onSnapshot tried to overwrite ${currentCount} items with ${incomingCount} items (allowed drop: ${quedaPermitida}). Pushing local data to Firestore instead.`
          );
          // Push our local data back to Firestore to fix the discrepancy
          const sanitized = JSON.parse(JSON.stringify(dataRef.current));
          lastLocalWriteTime.current = Date.now();
          pendingWriteCount.current += 1;
          setDoc(FIRESTORE_DOC, sanitized)
            .catch(err => devError('Re-push error:', err))
            .finally(() => {
              pendingWriteCount.current = Math.max(0, pendingWriteCount.current - 1);
              lastLocalWriteTime.current = Date.now();
            });
          setLoading(false);
          return;
        }

        localDeleteCount.current = 0;
        firestoreItemCount.current = incomingCount;
        // Chegaram dados — de onde quer que seja. A partir daqui uma edicao do
        // dono pode ser gravada: sabemos o que ha no banco.
        dadosCarregados.current = true;
        // Ja o republicar continua so com snapshot do servidor (ver a
        // declaracao das duas flags).
        if (!doCache) dataLoadedFromFirestore.current = true;
        // Isto veio do banco. Marcar ANTES do setData para o efeito de gravar
        // reconhecer o objeto e nao devolve-lo. Ver dataDoSnapshot.
        dataDoSnapshot.current = firestoreData;
        setData(firestoreData);
      } else {
        // First time: try to migrate from localStorage. Nao existe documento la,
        // entao ja sabemos tudo que ha pra saber — as duas flags valem.
        dataLoadedFromFirestore.current = true;
        dadosCarregados.current = true;
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            const parsed = { ...defaultData, ...semCamposLegados(JSON.parse(stored)) };
            lastLocalWriteTime.current = Date.now();
            setDoc(FIRESTORE_DOC, parsed);
            setData(parsed);
          }
        } catch {
          // ignore
        }
      }
      setLoading(false);
    }, (error) => {
      devError('Firestore error:', error);
      setFirestoreError(error.code || 'Erro de conexao');
      // Fallback to localStorage if Firestore fails
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        setData(stored ? { ...defaultData, ...semCamposLegados(JSON.parse(stored)) } : defaultData);
      } catch {
        setData(defaultData);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Listen to the /sales collection separately. Each sale is its own doc
  // now, so writes are O(1) and we're not bounded by the 1 MiB-per-doc cap.
  //
  // PROTECTION: If the listener errors out, we retry up to 3 times with
  // exponential backoff (2s, 4s, 8s). We also refuse to overwrite a
  // previously-loaded sales array with an empty snapshot — that pattern
  // indicates a transient Firestore glitch, not a real data change.
  // Os erros em que RELIGAR nunca ajuda — e sempre custa.
  //
  // Religar um listener de colecao cobra a colecao INTEIRA. Nestes tres o
  // proximo intento vai falhar igual, entao a unica coisa que a insistencia
  // produz e mais consumo:
  //   * resource-exhausted -> a cota ja acabou; reler e cavar mais fundo;
  //   * permission-denied  -> a regra recusa; ela nao muda porque tentamos;
  //   * unauthenticated    -> a credencial e a mesma na proxima tentativa.
  const salesLoadedOnce = useRef(false);
  const salesRetryCount = useRef(0);
  const salesRetryTimer = useRef(null);
  const salesEstavelTimer = useRef(null);
  const MAX_SALES_RETRIES = 3;
  // Quanto tempo de pe conta como "a conexao voltou de verdade". Abaixo disso,
  // um sucesso e so o intervalo entre duas quedas, e nao merece zerar o teto.
  const JANELA_ESTAVEL_MS = 60000;

  useEffect(() => {
    // PRIVACY: the full /sales collection must never reach a portal browser.
    if (PORTAL_MODE) { setSalesLoading(false); return; }
    let unsubscribe = null;

    const startSalesListener = () => {
      // DESLIGA O ANTERIOR ANTES DE LIGAR OUTRO.
      //
      // Sem esta linha, `unsubscribe` era SOBRESCRITO a cada tentativa e o
      // listener velho ficava vivo para sempre. Na queda seguinte todos os
      // vazados recebiam o erro, e cada um tentava reconectar por conta
      // propria — 12 quedas viravam 29 religacoes, e crescendo.
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }

      unsubscribe = onSnapshot(SALES_COLLECTION, (snapshot) => {
        // O CONTADOR DE TENTATIVAS NAO ZERA MAIS A CADA SUCESSO.
        //
        // Ele zerava, e por isso o teto de 3 nunca valeu: cai, tenta, funciona,
        // zera, cai de novo, tenta... para sempre. Cada religacao RELE A
        // COLECAO INTEIRA, entao a conta e multiplicacao.
        //
        // Agora so zera depois de um tempo bom de pe — uma conexao que
        // sobreviveu a JANELA_ESTAVEL_MS merece credito novo; uma que cai a
        // cada dois segundos, nao.
        if (salesEstavelTimer.current) clearTimeout(salesEstavelTimer.current);
        salesEstavelTimer.current = setTimeout(() => {
          salesRetryCount.current = 0;
        }, JANELA_ESTAVEL_MS);

        const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        // PROTECTION: If we previously loaded 100+ sales and the new
        // snapshot has 0 docs, something is wrong (transient glitch,
        // not a real clearSales). Don't overwrite — keep existing data.
        if (salesLoadedOnce.current && salesRef.current.length > 100 && docs.length === 0) {
          devWarn(
            `Blocked: sales onSnapshot returned 0 docs but we had ${salesRef.current.length}. Keeping existing data.`
          );
          return;
        }

        if (docs.length > 0) salesLoadedOnce.current = true;
        setSales(docs);
        setSalesLoading(false);
      }, (error) => {
        devError('Sales collection listen error:', error);
        setSalesLoading(false);

        // NAO INSISTIR NO QUE NAO SE RESOLVE SOZINHO.
        //
        // Cota estourada, regra recusando, credencial recusada: religar nao
        // conserta nenhum dos tres, e religar CUSTA a colecao inteira. Insistir
        // com a cota estourada e jogar gasolina — foi assim que a cota do dia
        // seguinte era torrada na hora em que nascia.
        if (ERROS_SEM_VOLTA.has(error?.code)) {
          devWarn(`Sales listener parado: ${error.code} nao se resolve tentando de novo.`);
          return;
        }

        // Retry with exponential backoff
        if (salesRetryCount.current < MAX_SALES_RETRIES) {
          const delay = Math.pow(2, salesRetryCount.current + 1) * 1000;
          salesRetryCount.current += 1;
          devWarn(`Retrying sales listener in ${delay}ms (attempt ${salesRetryCount.current}/${MAX_SALES_RETRIES})...`);
          salesRetryTimer.current = setTimeout(() => {
            startSalesListener();
          }, delay);
        } else {
          devWarn('Sales listener: teto de tentativas atingido, parando.');
        }
      });
    };

    startSalesListener();

    return () => {
      if (unsubscribe) unsubscribe();
      if (salesRetryTimer.current) clearTimeout(salesRetryTimer.current);
      // O relogio da estabilidade tambem: sem isto ele sobrevive a desmontagem
      // e zera o contador de um listener que nem existe mais.
      if (salesEstavelTimer.current) clearTimeout(salesEstavelTimer.current);
    };
  }, []);

  // A /eggCollections antiga (cadastro manual) nao e mais lida: o Ornabird
  // virou a fonte da verdade da coleta e o app le /ornabirdEggCollections.
  // Os documentos antigos continuam la ate serem apagados no console — sao
  // ignorados, nao apagados por codigo.

  // Ornabird mirror listeners. Skipped on portal routes like every other
  // subscription — the portal receives its already-scoped slice from the server.
  const quer_bandejas = colecoesPedidas.has('bandejas');
  useEffect(() => {
    if (PORTAL_MODE || !quer_bandejas) return;
    const unsub = onSnapshot(ORNABIRD_TRAYS_COLLECTION, (snap) => {
      setOrnabirdTrays(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      marcarPronta('bandejas');
      limparFalha('bandejas');
    }, (error) => marcarFalha('bandejas', error));
    return () => unsub();
  }, [quer_bandejas, marcarPronta, marcarFalha, limparFalha]);

  const quer_vitrine = colecoesPedidas.has('vitrine');
  useEffect(() => {
    if (PORTAL_MODE || !quer_vitrine) return;
    const unsub = onSnapshot(ORNABIRD_VITRINE_COLLECTION, (snap) => {
      setOrnabirdVitrine(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      marcarPronta('vitrine');
      limparFalha('vitrine');
    }, (error) => marcarFalha('vitrine', error));
    return () => unsub();
  }, [quer_vitrine, marcarPronta, marcarFalha, limparFalha]);

  // Coletas de ovos espelhadas. Coleção SEPARADA da /eggCollections antiga (o
  // cadastro manual que está saindo): misturar as duas faria a sincronização —
  // que apaga o que não veio do Ornabird — engolir o histórico manual sem
  // aviso. Um espelho nunca deve poder destruir dado que não é dele.
  const quer_coletas = colecoesPedidas.has('coletas');
  useEffect(() => {
    if (PORTAL_MODE || !quer_coletas) return;
    const unsub = onSnapshot(ORNABIRD_EGGS_COLLECTION, (snap) => {
      setOrnabirdEggCollections(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      marcarPronta('coletas');
      limparFalha('coletas');
    }, (error) => marcarFalha('coletas', error));
    return () => unsub();
  }, [quer_coletas, marcarPronta, marcarFalha, limparFalha]);

  // Lotes de chocadeira espelhados do Ornabird.
  const quer_chocadeiras = colecoesPedidas.has('chocadeiras');
  useEffect(() => {
    if (PORTAL_MODE || !quer_chocadeiras) return;
    const unsub = onSnapshot(ORNABIRD_BATCHES_COLLECTION, (snap) => {
      setOrnabirdIncubatorBatches(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      marcarPronta('chocadeiras');
      limparFalha('chocadeiras');
    }, (error) => marcarFalha('chocadeiras', error));
    return () => unsub();
  }, [quer_chocadeiras, marcarPronta, marcarFalha, limparFalha]);

  // Catalogo da Vitrine espelhado (os anuncios a venda). Separado de
  // ornabirdVitrine, que guarda as VENDAS — sao duas coisas diferentes.
  const quer_anuncios = colecoesPedidas.has('anuncios');
  useEffect(() => {
    if (PORTAL_MODE || !quer_anuncios) return;
    const unsub = onSnapshot(ORNABIRD_LISTINGS_COLLECTION, (snap) => {
      setOrnabirdVitrineListings(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      marcarPronta('anuncios');
      limparFalha('anuncios');
    }, (error) => marcarFalha('anuncios', error));
    return () => unsub();
  }, [quer_anuncios, marcarPronta, marcarFalha, limparFalha]);

  // Ordens de pagamento, sob demanda.
  const quer_ordens = colecoesPedidas.has('ordens');
  useEffect(() => {
    if (PORTAL_MODE || !quer_ordens) return;
    const unsub = onSnapshot(PAYMENT_ORDERS_COLLECTION, (snap) => {
      setPaymentOrders(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      marcarPronta('ordens');
      limparFalha('ordens');
    }, (error) => marcarFalha('ordens', error));
    return () => unsub();
  }, [quer_ordens, marcarPronta, marcarFalha, limparFalha]);

  // O registro da ultima rodada e UM documento so — uma leitura. Fica sempre
  // ligado: e o que permite avisar que a rotina das 6h falhou sem depender de
  // o dono abrir a tela de Ordens.
  useEffect(() => {
    if (PORTAL_MODE) return;
    const unsub = onSnapshot(ROTINA_DOC, (snap) => {
      setRotinaDiaria(snap.exists() ? snap.data() : null);
    }, (error) => devError('Rotina diaria listen error:', error));
    return () => unsub();
  }, []);

  // One-shot migration: promote legacy appData.sales into /sales/{id}.
  //
  // We wait until the main appData doc has loaded at least once so we know
  // which legacy sales exist. If the migration flag is already set, or the
  // legacy array is empty, we skip. Otherwise we batch the writes (Firestore
  // allows up to 500 ops per batch) and clear the legacy field on success.
  useEffect(() => {
    // Migrations are an admin-only concern; a portal visitor must never write.
    if (PORTAL_MODE) return;
    if (loading) return;
    if (!dataLoadedFromFirestore.current) return;
    if (typeof window === 'undefined') return;
    try {
      if (localStorage.getItem(SALES_MIGRATION_KEY) === 'done') return;
    } catch {
      // If localStorage is blocked we still try the migration; worst case
      // it no-ops because legacy sales is already empty.
    }
    (async () => {
      try {
        const snap = await getDoc(FIRESTORE_DOC);
        if (!snap.exists()) return;
        const legacySales = snap.data().sales;
        if (!Array.isArray(legacySales) || legacySales.length === 0) {
          try { localStorage.setItem(SALES_MIGRATION_KEY, 'done'); } catch { /* noop */ }
          return;
        }
        devWarn(`Migrating ${legacySales.length} legacy sales to /sales collection...`);
        // Chunk into batches of 400 (under Firestore's 500-op limit) to
        // keep individual commits small and recover gracefully mid-migration.
        const CHUNK = 400;
        for (let i = 0; i < legacySales.length; i += CHUNK) {
          const chunk = legacySales.slice(i, i + CHUNK);
          const batch = writeBatch(db);
          for (const sale of chunk) {
            const saleId = sale.id || newId();
            const payload = { ...sale };
            // Ensure required fields for the rules. Legacy rows can miss
            // these if they were half-written; coerce to safe defaults so
            // the create isn't rejected by the shape check.
            payload.itemDescription = String(sale.itemDescription || sale.item || 'Sem descricao');
            payload.totalValue = Number(sale.totalValue) || 0;
            delete payload.id;
            batch.set(doc(db, 'sales', saleId), payload);
          }
          await batch.commit();
        }
        // Verify migration actually worked before clearing legacy data.
        // Read back the /sales collection and only clear appData.sales
        // if the collection has at least as many docs as the legacy array.
        const verifySnap = await getDocs(SALES_COLLECTION);
        if (verifySnap.size >= legacySales.length) {
          await setDoc(FIRESTORE_DOC, { sales: [] }, { merge: true });
          devWarn(`Sales migration verified and legacy cleared (${verifySnap.size} docs in /sales).`);
        } else {
          devWarn(
            `Sales migration partial: ${verifySnap.size} docs in /sales vs ${legacySales.length} legacy. ` +
            'NOT clearing legacy array so recovery remains possible.'
          );
        }
        try { localStorage.setItem(SALES_MIGRATION_KEY, 'done'); } catch { /* noop */ }
      } catch (err) {
        devError('Sales migration failed:', err);
        setSaveError(
          'Nao foi possivel migrar as vendas antigas. Recarregue a pagina e tente novamente.'
        );
      }
    })();
  }, [loading]);

  // A migracao das coletas legadas para /eggCollections saiu junto com o
  // cadastro manual: promover historico antigo para uma colecao que ninguem
  // mais le so gastaria escrita.

  // PROTECTION: Save data before page closes or tab switches
  useEffect(() => {
    // Never mirror the dataset onto a portal visitor's device, and never let
    // an anonymous visitor push a write back to Firestore.
    if (PORTAL_MODE) return;
    const saveToLocalStorage = () => {
      if (loadingRef.current) return;
      const currentData = dataRef.current;
      if (countItems(currentData) === 0) return;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(currentData));
      } catch {
        // ignore storage errors
      }
    };

    // AQUI NAO SE GRAVA NO FIRESTORE. A copia local, sim; o banco, nunca.
    //
    // Ate 08/2026 este handler mandava um setDoc com dataRef.current inteiro
    // "por garantia". A garantia era falsa e o preco era alto:
    //
    //   * FALSA porque ele so chegava a gravar quando pendingWriteCount === 0
    //     e dataLoadedFromFirestore === true — ou seja, exatamente quando o
    //     efeito de salvar ja tinha descarregado toda mudanca. Nunca houve nada
    //     pra ele salvar que ja nao estivesse salvo.
    //
    //   * CARA porque o /config/appData e regravado INTEIRO (setDoc sem merge).
    //     Uma aba aberta desde de manha tem em memoria a versao de manha. Ao
    //     fechar, ela mandava essa versao por cima do que outra aba — ou o
    //     celular — tinha acabado de gravar. O dono via o preco do ovo sumir
    //     "sozinho depois de um tempo", sem erro nenhum na tela.
    //
    // A protecao do onSnapshot nao pegava porque ela compara CONTAGEM de itens
    // (decidirSnapshot). Preencher um campo numa ave nao muda contagem: sao as
    // mesmas N aves antes e depois. Ela enxerga linha apagada e e cega a campo
    // sobrescrito.
    //
    // Coberto por teste-duas-abas.mjs, que abre duas abas de verdade.
    const handleBeforeUnload = () => {
      saveToLocalStorage();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveToLocalStorage();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Periodic auto-save to localStorage every 30 seconds as safety net
    const autoSaveInterval = setInterval(saveToLocalStorage, 30000);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(autoSaveInterval);
    };
  }, []);

  // Save to Firestore when data changes (with protection against empty overwrites)
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (PORTAL_MODE) return;
    if (loading) return;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // ISTO CHEGOU DO BANCO — nao devolve.
    //
    // O `data` atual e, por identidade, o mesmo objeto que o snapshot entregou:
    // ninguem editou nada desde entao. Gravar aqui seria mandar de volta o que
    // ja esta gravado, e era isso que alimentava a troca sem fim entre o
    // computador e o celular. Ver dataDoSnapshot, onde a medicao esta descrita.
    //
    // Este `return` NAO precisa de setSaveError: ao contrario dos dois abaixo,
    // ele nao esta recusando nada do dono. Nao ha alteracao dele aqui — se
    // houvesse, `data` seria outro objeto e a comparacao falharia.
    if (dataDoSnapshot.current !== null && data === dataDoSnapshot.current) {
      return;
    }
    // Nao gravar antes de saber o que ja existe la — do cache ou do servidor,
    // tanto faz. Antes esta linha exigia o snapshot DO SERVIDOR, e era por ela
    // que o Plantel preenchido com a cota estourada nao gravava nada.
    //
    // E se ainda assim nao der pra gravar, o dono precisa SABER. Um `return`
    // mudo aqui e o que deixou o defeito rodar cinco vezes: a tela mostrava o
    // valor salvo e o banco continuava vazio.
    if (!dadosCarregados.current) {
      devWarn('Gravacao adiada: os dados ainda nao carregaram.');
      setSaveError(
        'Ainda carregando os dados — a alteracao NAO foi salva. '
        + 'Espere a tela terminar de abrir e faca de novo.'
      );
      return;
    }

    const newCount = countItems(data);

    // PROTECTION: Block saving empty data if Firestore had data
    // (prevents accidental wipe from race conditions or bugs)
    if (newCount === 0 && firestoreItemCount.current > 0) {
      devWarn('Blocked: tentativa de salvar dados vazios no Firestore (havia', firestoreItemCount.current, 'itens)');
      // Tambem avisa, pelo mesmo motivo do bloqueio acima: gravacao recusada em
      // silencio e indistinguivel de gravacao bem-sucedida, e o dono so descobre
      // dias depois — quando o numero que ele conferiu nao esta mais la.
      setSaveError(
        'A alteracao NAO foi salva: a tela ficaria vazia por cima de '
        + `${firestoreItemCount.current} registro(s) que existem no banco. `
        + 'Recarregue a pagina e tente de novo.'
      );
      return;
    }

    // BACKUP: Save previous version before overwriting
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current) {
        const prev = JSON.parse(current);
        if (countItems(prev) > 0) {
          localStorage.setItem(BACKUP_KEY, JSON.stringify({
            data: prev,
            savedAt: new Date().toISOString(),
          }));
        }
      }
    } catch {
      // ignore backup errors
    }

    // Save to both Firestore and localStorage
    // Sanitize: Firestore rejects undefined values, so strip them via JSON round-trip
    const sanitized = JSON.parse(JSON.stringify(data));
    lastLocalWriteTime.current = Date.now();
    firestoreItemCount.current = newCount;
    pendingWriteCount.current += 1;
    setDoc(FIRESTORE_DOC, sanitized)
      .then(() => {
        // Clear any lingering save error banner once a write lands.
        setSaveError(null);
      })
      .catch(err => {
        devError('Firestore save error:', err);
        // Surface to UI. The most common cause at this scale is the 1 MiB
        // per-doc cap; give the user a hint without dumping the raw code.
        setSaveError(
          err?.code === 'invalid-argument' || /size|bytes|too large/i.test(err?.message || '')
            ? 'Erro ao salvar: o documento principal atingiu o limite do Firestore. Entre em contato com o suporte.'
            : `Erro ao salvar alteracoes: ${err?.code || err?.message || 'erro desconhecido'}`
        );
      })
      .finally(() => {
        pendingWriteCount.current = Math.max(0, pendingWriteCount.current - 1);
        // Update the write time when the write completes so the debounce window
        // starts AFTER the server confirms, not before
        lastLocalWriteTime.current = Date.now();
      });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data, loading]);

  // Helper: setData for delete operations - tracks the count drop so onSnapshot won't reject it
  const setDataWithDelete = (updater) => {
    setData(prev => {
      const next = updater(prev);
      const drop = countItems(prev) - countItems(next);
      if (drop > 0) {
        localDeleteCount.current += drop;
      }
      return next;
    });
  };

  // Investors
  const addInvestor = (investor) => {
    const newInvestor = {
      ...investor,
      id: newId(),
      createdAt: new Date().toISOString(),
    };
    setData(prev => ({ ...prev, investors: [...prev.investors, newInvestor] }));
    return newInvestor;
  };

  const updateInvestor = (id, updates) => {
    setData(prev => ({
      ...prev,
      investors: prev.investors.map(i => i.id === id ? { ...i, ...updates } : i),
    }));
  };

  const deleteInvestor = (id) => {
    setDataWithDelete(prev => ({
      ...prev,
      investors: prev.investors.filter(i => i.id !== id),
      birds: prev.birds.filter(b => b.investorId !== id),
    }));
  };

  // Birds
  const addBird = (bird) => {
    const newBird = {
      ...bird,
      id: newId(),
      createdAt: new Date().toISOString(),
    };
    setData(prev => ({ ...prev, birds: [...prev.birds, newBird] }));
    return newBird;
  };

  const updateBird = (id, updates) => {
    setData(prev => ({
      ...prev,
      birds: prev.birds.map(b => b.id === id ? { ...b, ...updates } : b),
    }));
  };

  const deleteBird = (id) => {
    setDataWithDelete(prev => ({
      ...prev,
      birds: prev.birds.filter(b => b.id !== id),
    }));
  };

  // Hand a bird over to another investor from `transferDate` onward.
  //
  // The outgoing owner's period is closed the day BEFORE the transfer and
  // pushed onto ownershipHistory. Because profit attribution resolves the
  // owner at each sale's date, past sales stay with the previous investor and
  // everything from the transfer date credits the new one — without rewriting
  // a single stored sale.
  const transferBird = (birdId, { toInvestorId, transferDate }) => {
    const day = normalizeDay(transferDate);
    if (!birdId || !toInvestorId || !day) return;
    setData(prev => ({
      ...prev,
      birds: (prev.birds || []).map(b => {
        if (b.id !== birdId) return b;
        const history = Array.isArray(b.ownershipHistory) ? [...b.ownershipHistory] : [];
        if (b.investorId) {
          history.push({
            investorId: b.investorId,
            startDate: b.ownershipStartDate || '',
            endDate: previousDay(day),
          });
        }
        return {
          ...b,
          ownershipHistory: history,
          investorId: toInvestorId,
          ownershipStartDate: day,
          ownershipEndDate: '',
        };
      }),
    }));
  };

  // -----------------------------------------------------------------
  // Sales (Phase 2C: backed by /sales collection, one doc per sale).
  //
  // All writes go straight to Firestore and the /sales onSnapshot listener
  // pushes the change back into local state. We DO NOT mutate local `sales`
  // optimistically because that would double-apply when the snapshot fires
  // (and diverge if the write fails). Every helper returns a promise so
  // callers can disable UI while the batch is in flight.
  //
  // All helpers also refuse to include `undefined` values and stamp
  // metadata (id, importedAt) server-side if missing so we never orphan a
  // row that violates the rules' shape check.
  // -----------------------------------------------------------------
  const sanitizeSalePayload = (sale) => {
    // Strip undefineds (Firestore rejects them) and null-out empty strings
    // so filters don't have to special-case them.
    const raw = JSON.parse(JSON.stringify(sale));
    // Rules require these two fields. Coerce defensively.
    raw.itemDescription = String(raw.itemDescription || raw.item || 'Sem descricao');
    raw.totalValue = Number(raw.totalValue) || 0;
    // Drop id from the payload; it's the doc key, not a field.
    delete raw.id;
    return raw;
  };

  const addSales = async (salesList) => {
    if (!Array.isArray(salesList) || salesList.length === 0) return;
    const now = new Date().toISOString();
    try {
      // Batch in chunks of 400 to stay under Firestore's 500-op batch limit.
      const CHUNK = 400;
      for (let i = 0; i < salesList.length; i += CHUNK) {
        const chunk = salesList.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        for (const sale of chunk) {
          const saleId = newId();
          const payload = sanitizeSalePayload({
            ...sale,
            importedAt: sale.importedAt || now,
          });
          batch.set(doc(db, 'sales', saleId), payload);
        }
        await batch.commit();
      }
      setSaveError(null);
    } catch (err) {
      devError('addSales error:', err);
      setSaveError(`Erro ao salvar vendas: ${err?.code || err?.message || 'erro desconhecido'}`);
      throw err;
    }
  };

  const clearSales = async () => {
    try {
      const current = salesRef.current;
      if (current.length === 0) return;
      const CHUNK = 400;
      for (let i = 0; i < current.length; i += CHUNK) {
        const chunk = current.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        for (const sale of chunk) {
          batch.delete(doc(db, 'sales', sale.id));
        }
        await batch.commit();
      }
      setSaveError(null);
    } catch (err) {
      devError('clearSales error:', err);
      setSaveError(`Erro ao limpar vendas: ${err?.code || err?.message || 'erro desconhecido'}`);
      throw err;
    }
  };

  const deleteSale = async (id) => {
    if (!id) return;
    try {
      await deleteDoc(doc(db, 'sales', id));
      setSaveError(null);
    } catch (err) {
      devError('deleteSale error:', err);
      setSaveError(`Erro ao excluir venda: ${err?.code || err?.message || 'erro desconhecido'}`);
      throw err;
    }
  };

  const updateSale = async (id, updates) => {
    if (!id) return;
    try {
      // Merge against the current local copy so we preserve all existing
      // fields and still satisfy the rules' create/update shape check.
      const current = salesRef.current.find(s => s.id === id);
      const merged = { ...(current || {}), ...updates };
      const payload = sanitizeSalePayload(merged);
      await setDoc(doc(db, 'sales', id), payload);
      setSaveError(null);
    } catch (err) {
      devError('updateSale error:', err);
      setSaveError(`Erro ao atualizar venda: ${err?.code || err?.message || 'erro desconhecido'}`);
      throw err;
    }
  };

  // Remove duplicate sales (same orderNumber + itemDescription + totalValue
  // + quantity). Keeps the oldest occurrence by importedAt and deletes the
  // rest. Returns { removed, kept } counts for the UI to show.
  const removeDuplicateSales = async () => {
    try {
      const { duplicates } = partitionSaleDuplicates(salesRef.current);
      if (duplicates.length === 0) {
        return { removed: 0, kept: salesRef.current.length };
      }
      const CHUNK = 400;
      for (let i = 0; i < duplicates.length; i += CHUNK) {
        const chunk = duplicates.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        for (const sale of chunk) {
          batch.delete(doc(db, 'sales', sale.id));
        }
        await batch.commit();
      }
      setSaveError(null);
      return { removed: duplicates.length, kept: salesRef.current.length - duplicates.length };
    } catch (err) {
      devError('removeDuplicateSales error:', err);
      setSaveError(`Erro ao remover duplicatas: ${err?.code || err?.message || 'erro desconhecido'}`);
      throw err;
    }
  };

  // Force a fresh read of the /sales collection from Firestore (bypassing
  // the onSnapshot cache). Useful when the listener might have errored or
  // returned stale data.
  const forceReloadSales = async () => {
    try {
      const snapshot = await getDocs(SALES_COLLECTION);
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      if (docs.length > 0) {
        salesLoadedOnce.current = true;
        setSales(docs);
      }
      setSalesLoading(false);
      return {
        status: 'ok',
        message: `Recarregadas ${docs.length} vendas da colecao /sales.`,
        count: docs.length,
      };
    } catch (err) {
      devError('forceReloadSales error:', err);
      return {
        status: 'error',
        message: `Erro ao recarregar vendas: ${err?.code || err?.message || 'erro desconhecido'}`,
      };
    }
  };

  // Check and recover legacy sales from appData.sales that may not have
  // been migrated to the /sales collection. Returns status info for the UI.
  // Also checks localStorage backup as fallback if appData.sales is empty.
  const recoverLegacySales = async () => {
    try {
      // Step 1: Force a fresh read from Firestore /sales collection
      // so salesRef.current is up-to-date before comparing.
      await forceReloadSales();

      // Step 2: Check legacy appData.sales array in Firestore.
      const snap = await getDoc(FIRESTORE_DOC);
      let legacySales = [];
      if (snap.exists()) {
        const arr = snap.data().sales;
        if (Array.isArray(arr) && arr.length > 0) {
          legacySales = arr;
        }
      }

      // Step 3: If appData.sales is empty, try localStorage backup.
      if (legacySales.length === 0) {
        try {
          const backupRaw = localStorage.getItem(BACKUP_KEY);
          if (backupRaw) {
            const backup = JSON.parse(backupRaw);
            if (backup.data && Array.isArray(backup.data.sales) && backup.data.sales.length > 0) {
              legacySales = backup.data.sales;
              devWarn(`Found ${legacySales.length} sales in localStorage backup (saved at ${backup.savedAt}).`);
            }
          }
        } catch { /* ignore parse errors */ }
      }
      if (legacySales.length === 0) {
        try {
          const storedRaw = localStorage.getItem(STORAGE_KEY);
          if (storedRaw) {
            const stored = JSON.parse(storedRaw);
            if (Array.isArray(stored.sales) && stored.sales.length > 0) {
              legacySales = stored.sales;
              devWarn(`Found ${legacySales.length} sales in localStorage main storage.`);
            }
          }
        } catch { /* ignore parse errors */ }
      }

      if (legacySales.length === 0) {
        const currentCount = salesRef.current.length;
        return {
          status: 'empty',
          message: currentCount > 0
            ? `Nenhuma venda adicional encontrada. ${currentCount} vendas ja carregadas.`
            : 'Nenhuma venda encontrada em nenhuma fonte (Firestore, appData, localStorage).',
        };
      }

      // Step 4: Compare with current /sales collection and re-migrate missing ones.
      const currentIds = new Set(salesRef.current.map(s => s.id));
      const missing = legacySales.filter(s => !currentIds.has(s.id));
      if (missing.length === 0) {
        return { status: 'ok', message: `Todas as ${legacySales.length} vendas ja existem na colecao /sales. Total atual: ${salesRef.current.length}.` };
      }

      // Re-migrate the missing ones
      const CHUNK = 400;
      let migrated = 0;
      for (let i = 0; i < missing.length; i += CHUNK) {
        const chunk = missing.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        for (const sale of chunk) {
          const saleId = sale.id || newId();
          const payload = { ...sale };
          payload.itemDescription = String(sale.itemDescription || sale.item || 'Sem descricao');
          payload.totalValue = Number(sale.totalValue) || 0;
          delete payload.id;
          batch.set(doc(db, 'sales', saleId), payload);
        }
        await batch.commit();
        migrated += chunk.length;
      }
      setSaveError(null);
      return {
        status: 'recovered',
        message: `Recuperadas ${migrated} vendas de ${legacySales.length} encontradas. Total atual: ${salesRef.current.length + migrated}.`,
        recovered: migrated,
        totalLegacy: legacySales.length,
      };
    } catch (err) {
      devError('recoverLegacySales error:', err);
      const msg = `Erro ao recuperar vendas: ${err?.code || err?.message || 'erro desconhecido'}`;
      setSaveError(msg);
      return { status: 'error', message: msg };
    }
  };

  // -----------------------------------------------------------------
  // Profit rates (global configuration).
  //
  // Editing the rates never rewrites history on its own: each sale stores the
  // profitRate it was registered with, so past distributions stay untouched.
  // recalculateAllSaleProfits() is the explicit, opt-in path that reprices the
  // entire history — the admin is asked which behaviour they want on save.
  // -----------------------------------------------------------------
  const updateProfitRates = ({ eggProfitRate, birdProfitRate, multiplicadorAve }) => {
    const egg = Number(eggProfitRate);
    const bird = Number(birdProfitRate);
    if (!isFinite(egg) || egg < 0 || !isFinite(bird) || bird < 0) return;
    const mult = Number(multiplicadorAve);
    setData(prev => ({
      ...prev,
      eggProfitRate: egg,
      birdProfitRate: bird,
      multiplicadorAve: isFinite(mult) && mult > 0 ? mult : prev.multiplicadorAve,
    }));
  };

  // Reprice every stored sale with the given rates. Irreversible: it
  // overwrites profitRate/profit on all sales, which shifts investor balances.
  const recalculateAllSaleProfits = async ({ eggProfitRate, birdProfitRate }) => {
    const current = salesRef.current;
    if (current.length === 0) return { updated: 0 };
    const eggRate = Number(eggProfitRate);
    const birdRate = Number(birdProfitRate);
    if (!isFinite(eggRate) || !isFinite(birdRate)) return { updated: 0 };
    // Per-animal rate overrides win over the globals when repricing history.
    const birdsNow = dataRef.current.birds || [];
    const globals = { eggProfitRate: eggRate, birdProfitRate: birdRate };
    try {
      const CHUNK = 400;
      let updated = 0;
      for (let i = 0; i < current.length; i += CHUNK) {
        const chunk = current.slice(i, i + CHUNK);
        const b = writeBatch(db);
        for (const sale of chunk) {
          const description = sale.itemDescription || sale.item || '';
          const isEgg = typeof sale.isEgg === 'boolean' ? sale.isEgg : isEggProduct(description);
          const linkedBird = sale.matchedBirdId
            ? birdsNow.find(x => x.id === sale.matchedBirdId)
            : null;
          const rate = resolveRateFor(linkedBird, isEgg, globals);
          const totalValue = Number(sale.totalValue) || 0;
          const payload = sanitizeSalePayload({
            ...sale,
            isEgg,
            profitRate: rate,
            profit: totalValue * rate,
          });
          b.set(doc(db, 'sales', sale.id), payload);
          updated += 1;
        }
        await b.commit();
      }
      setSaveError(null);
      return { updated };
    } catch (err) {
      devError('recalculateAllSaleProfits error:', err);
      setSaveError(`Erro ao recalcular lucros: ${err?.code || err?.message || 'erro desconhecido'}`);
      throw err;
    }
  };

  // -----------------------------------------------------------------
  // Ornabird mirror
  //
  // The sync replaces a whole slice at once rather than diffing: Ornabird is
  // the source of truth, so the local copy is disposable and a full replace
  // can never drift. Rows carry the Ornabird ids so a re-sync is idempotent.
  // -----------------------------------------------------------------
  const MIRROR_KINDS = {
    trays: { collection: 'ornabirdTrays', ref: ornabirdTraysRef },
    vitrine: { collection: 'ornabirdVitrine', ref: ornabirdVitrineRef },
    eggCollections: { collection: 'ornabirdEggCollections', ref: ornabirdEggsRef },
    incubatorBatches: { collection: 'ornabirdIncubatorBatches', ref: ornabirdBatchesRef },
    vitrineListings: { collection: 'ornabirdVitrineListings', ref: ornabirdListingsRef },
  };

  const replaceOrnabirdMirror = async (kind, rows) => {
    // Mapa explícito em vez de ternário: com três tipos, um `kind` novo e não
    // mapeado cairia no "senão" e sobrescreveria a coleção errada em silêncio.
    const alvo = MIRROR_KINDS[kind];
    if (!alvo) throw new Error(`espelho desconhecido: ${kind}`);
    const collectionName = alvo.collection;
    const existing = alvo.ref.current;
    try {
      // Apaga o que sumiu la em cima e grava SO o que mudou.
      //
      // Antes esta funcao regravava todas as linhas a cada sincronizacao. Com
      // ~1.600 vendas espelhadas isso custava ~1.600 gravacoes por clique, e
      // poucas sincronizacoes estouravam a cota diaria do Firestore — foi
      // exatamente o que aconteceu ("RESOURCE_EXHAUSTED: Quota exceeded").
      // O espelho quase nunca muda por inteiro: o normal e uma venda nova e o
      // resto identico. Comparando antes de gravar, uma sincronizacao sem
      // novidade custa zero gravacoes.
      const incomingIds = new Set(rows.map(r => r.id).filter(Boolean));
      const stale = existing.filter(r => !incomingIds.has(r.id));
      const anteriorPorId = new Map(existing.map(r => [r.id, r]));
      const CHUNK = 400;
      for (let i = 0; i < stale.length; i += CHUNK) {
        const b = writeBatch(db);
        stale.slice(i, i + CHUNK).forEach(r => b.delete(doc(db, collectionName, r.id)));
        await b.commit();
      }

      const mudadas = [];
      for (const row of rows) {
        const { id, ...rest } = row;
        if (!id) continue;
        const payload = JSON.parse(JSON.stringify(rest));
        const anterior = anteriorPorId.get(id);
        if (anterior) {
          const { id: _ignorado, ...anteriorSemId } = anterior;
          if (jsonEstavel(anteriorSemId) === jsonEstavel(payload)) continue;
        }
        mudadas.push({ id, payload });
      }

      for (let i = 0; i < mudadas.length; i += CHUNK) {
        const b = writeBatch(db);
        for (const { id, payload } of mudadas.slice(i, i + CHUNK)) {
          b.set(doc(db, collectionName, id), payload);
        }
        await b.commit();
      }
      setSaveError(null);
      return { written: mudadas.length, removed: stale.length, unchanged: rows.length - mudadas.length };
    } catch (err) {
      devError('replaceOrnabirdMirror error:', err);
      setSaveError(`Erro ao sincronizar com o Ornabird: ${err?.code || err?.message || 'erro desconhecido'}`);
      throw err;
    }
  };

  // Every Ornabird call goes through /api/ornabird. The credential is a secret
  // that reads the whole criatório, so it stays server-side — and the CSP pins
  // connect-src to 'self' anyway, so a direct fetch would be blocked.
  const ORNABIRD_ERRORS = {
    unauthorized: 'Sessão expirada. Entre novamente.',
    forbidden: 'Só o administrador pode sincronizar com o Ornabird.',
    not_configured: 'Integração não configurada (falta ORNABIRD_API_URL / ORNABIRD_API_TOKEN).',
    // Cada uma diz o nome exato da variável E em qual projeto da Vercel ela
    // mora — os nomes dos dois lados são espelhados e trocá-los é fácil.
    missing_firebase:
      'Falta a variável FIREBASE_SERVICE_ACCOUNT no projeto "invest" da Vercel.',
    missing_ornabird_url:
      'Falta a variável ORNABIRD_API_URL no projeto "invest" da Vercel (o endereço do Ornabird).',
    missing_ornabird_token:
      'Falta a variável ORNABIRD_API_TOKEN no projeto "invest" da Vercel. Se você acabou de criá-la, refaça o Redeploy: a Vercel congela as variáveis no início do build.',
    // O jeito mais comum de errar isto é trocar os valores de URL e TOKEN
    // entre si — dizer isso na mensagem economiza uma rodada de investigação.
    bad_ornabird_url:
      'O valor de ORNABIRD_API_URL no projeto "invest" não é um endereço válido. Precisa começar com https:// (ex.: https://ornabird.app). Confira se você não trocou os valores de ORNABIRD_API_URL e ORNABIRD_API_TOKEN.',
    ornabird_unreachable:
      'Não foi possível alcançar o Ornabird no endereço de ORNABIRD_API_URL. Confira o endereço, ou o Ornabird pode estar fora do ar.',
    // Tipicamente a página de login da proteção de deploy da Vercel: o
    // endereço responde, mas não é o Ornabird do outro lado.
    ornabird_not_json:
      'O endereço de ORNABIRD_API_URL respondeu, mas não com dados do Ornabird — costuma ser uma página de login no caminho. Se o endereço for um *.vercel.app, troque pelo domínio próprio (https://ornabird.app).',
    ornabird_unauthorized: 'O Ornabird recusou a credencial (segredo diferente nos dois lados).',
    ornabird_subscription: 'A assinatura do Ornabird está irregular.',
    ornabird_error: 'O Ornabird respondeu com erro.',
    server_error: 'Falha aqui no Invest, antes de chegar ao Ornabird.',
    // Resposta sem JSON = a função /api/ornabird nem chegou a rodar (erro de
    // build/dependência). NÃO é culpa do Ornabird — dizer que era custou uma
    // investigação inteira olhando o lado errado.
    proxy_error: 'A função /api/ornabird do Invest não respondeu. Veja os logs do projeto invest na Vercel.',
    // O PROBLEMA E O FIRESTORE, e nao o Ornabird. Estas mensagens existem
    // porque a genérica ("falha antes de chegar ao Ornabird") é verdadeira e
    // inútil: manda procurar defeito no lado errado num dia em que só acabou a
    // cota. Cada uma diz o que fazer, não só o que aconteceu.
    firestore_quota:
      'O Firestore bloqueou o acesso por limite da conta (RESOURCE_EXHAUSTED). Não é problema do Ornabird nem do código. ATENÇÃO: não é só esperar — em 24/08 o bloqueio continuou depois da renovação diária, com zero requisições no meio. Abra o console do Firebase e veja o USO do projeto (leituras E armazenamento) antes de qualquer outra coisa.',
    // NAO manda mexer nas regras: quem faz esta leitura e o firebase-admin, do
    // servidor, e ele IGNORA as regras de seguranca. Um permission-denied aqui e
    // permissao da CONTA DE SERVICO, nunca do firestore.rules.
    firestore_permission:
      'O Firestore recusou o acesso ao servidor. As regras de segurança não têm '
      + 'relação com isto (o servidor passa por cima delas): o que falta é permissão '
      + 'da conta de serviço da variável FIREBASE_SERVICE_ACCOUNT — ela precisa do '
      + 'papel de Cloud Datastore User no projeto certo.',
    firestore_unauthenticated:
      'A credencial do Firestore não foi aceita. Confira a variável FIREBASE_SERVICE_ACCOUNT no projeto "invest" da Vercel.',
    firestore_indisponivel:
      'O Firestore está fora do ar ou inacessível neste momento. Tente de novo em alguns minutos.',
    firestore_timeout:
      'O Firestore demorou demais para responder. Tente de novo.',
  };

  const ornabirdRequest = async (body) => {
    const user = auth.currentUser;
    if (!user) {
      const err = new Error('not signed in');
      err.code = 'unauthorized';
      throw err;
    }
    const idToken = await user.getIdToken();
    const res = await fetch('/api/ornabird', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    });
    // Um corpo que não é JSON significa que a resposta não veio do handler —
    // é a página de erro da Vercel, de uma função que morreu antes de rodar.
    // Cair em 'ornabird_error' aqui aponta o dedo pro sistema errado.
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const code = payload?.error || (payload === null ? 'proxy_error' : 'ornabird_error');
      const err = new Error(code);
      err.code = code;
      throw err;
    }
    return payload ?? {};
  };

  // Catálogo de lotes do Ornabird, pra alimentar o seletor de vínculo do
  // Plantel. Não passa pelo Firestore: é dado de leitura, sempre fresco.
  const fetchOrnabirdGroups = async () => {
    try {
      const payload = await ornabirdRequest({ action: 'groups' });
      setSaveError(null);
      return payload.groups || [];
    } catch (err) {
      devError('fetchOrnabirdGroups error:', err);
      setSaveError(ORNABIRD_ERRORS[err?.code] || 'Erro ao buscar os lotes do Ornabird.');
      throw err;
    }
  };

  // Puxa os lotes VINCULADOS e substitui os espelhos. Só sincroniza o que
  // alguém ligou a uma linha do Plantel — lote sem vínculo não tem dono e não
  // renderia nada no rateio.
  const syncFromOrnabird = async ({ from = null, to = null } = {}) => {
    const groupIds = [
      ...new Set(
        (dataRef.current.birds || []).map(b => b?.ornabirdGroupId).filter(Boolean)
      ),
    ];
    try {
      const payload = await ornabirdRequest({ action: 'sync', groupIds, from, to });
      const escritas = { gravadas: 0, apagadas: 0 };
      const espelhar = async (kind, linhas) => {
        const r = await replaceOrnabirdMirror(kind, linhas || []);
        escritas.gravadas += r.written;
        escritas.apagadas += r.removed;
      };
      await espelhar('trays', payload.trays);
      await espelhar('eggCollections', payload.eggCollections);
      await espelhar('incubatorBatches', payload.incubatorBatches);
      await espelhar('vitrineListings', payload.vitrineListings);
      await espelhar('vitrine', payload.vitrine);
      setSaveError(null);
      return {
        groupIds,
        trays: (payload.trays || []).length,
        eggCollections: (payload.eggCollections || []).length,
        incubatorBatches: (payload.incubatorBatches || []).length,
        vitrineListings: (payload.vitrineListings || []).length,
        vitrine: (payload.vitrine || []).length,
        // Quantas linhas realmente mudaram. Fica visivel porque e o que
        // consome cota do Firestore — um numero alto toda vez seria sinal de
        // que a comparacao parou de funcionar.
        gravadas: escritas.gravadas,
        apagadas: escritas.apagadas,
        // Lote vinculado que o Ornabird não conhece — vínculo digitado errado
        // ou lote apagado lá. Silenciar isso faria o investidor sumir do rateio.
        unknownGroupIds: payload.unknownGroupIds || [],
        warnings: payload.warnings || [],
      };
    } catch (err) {
      devError('syncFromOrnabird error:', err);
      // Erro conhecido da chamada ao Ornabird -> mensagem propria.
      // Qualquer outro veio da GRAVAÇÃO no Firestore (replaceOrnabirdMirror),
      // que já montou um texto com o código real. Cair no texto genérico aqui
      // apagava esse código e escondia a causa — foi o que aconteceu com um
      // 'permission-denied' que passou despercebido.
      const conhecido = ORNABIRD_ERRORS[err?.code];
      if (conhecido) {
        setSaveError(conhecido);
      } else if (err?.code || err?.message) {
        setSaveError(
          `Erro ao gravar os dados sincronizados: ${err.code || err.message}. ` +
            'Se disser "permission-denied", as regras do Firestore precisam liberar ' +
            'ornabirdTrays, ornabirdVitrine, ornabirdEggCollections, ' +
            'ornabirdIncubatorBatches e ornabirdVitrineListings.'
        );
      } else {
        setSaveError('Erro ao sincronizar com o Ornabird.');
      }
      throw err;
    }
  };

  // -----------------------------------------------------------------
  // Ordens de pagamento
  //
  // Tudo que MEXE em ordem passa pelo servidor (/api/ordens), nunca pelo
  // navegador direto. Nao e cerimonia: marcar uma ordem como paga aqui e
  // gravar que um dinheiro saiu, e o envio do comprovante depende de uma
  // credencial (Resend) que nao pode chegar ao navegador. As regras do
  // Firestore proibem a escrita em /paymentOrders pelo cliente justamente
  // para que nao exista um segundo caminho.
  // -----------------------------------------------------------------
  const ORDENS_ERRORS = {
    unauthorized: 'Sessao expirada. Entre novamente.',
    forbidden: 'So o administrador mexe nas ordens de pagamento.',
    sem_ordens: 'Nenhuma ordem selecionada.',
    sem_vendas: 'Nenhuma venda selecionada.',
    data_invalida: 'A data da ordem nao e uma data valida. Use o seletor de data.',
    missing_firebase: 'Falta a variavel FIREBASE_SERVICE_ACCOUNT no projeto "invest" da Vercel.',
    missing_cron_secret: 'Falta a variavel CRON_SECRET no projeto "invest" da Vercel.',
    proxy_error: 'A funcao /api/ordens do Invest nao respondeu. Veja os logs do projeto invest na Vercel.',
    // Os erros do Firestore chegavam aqui como o codigo NUMERICO do gRPC — a
    // tela mostrava "falhou: 8", que nao diz nada a quem le. O servidor agora
    // traduz para estes nomes.
    firestore_quota:
      'O Firebase bloqueou o acesso por limite da conta (RESOURCE_EXHAUSTED). '
      + 'NAO adianta so esperar a virada do dia: em 24/08 o bloqueio continuou '
      + 'depois da renovacao, sem nenhuma requisicao no meio. Abra o console do '
      + 'Firebase e veja o USO do projeto — leituras E armazenamento.',
    // Mesmo motivo do outro firestore_permission acima: quem faz esta chamada e
    // o servidor, com firebase-admin, que nao passa pelo firestore.rules.
    firestore_permission:
      'O Firestore recusou o acesso ao servidor (permission-denied). Nao sao as '
      + 'regras de seguranca — o servidor nao passa por elas. Confira a permissao '
      + 'da conta de servico em FIREBASE_SERVICE_ACCOUNT.',
    firestore_indisponivel:
      'O Firestore esta indisponivel no momento. Tente de novo em instantes.',
    firestore_timeout: 'A operacao demorou demais e foi cancelada. Tente de novo.',
    firestore_unauthenticated: 'A credencial do servidor foi recusada pelo Firebase.',
  };

  const ordensRequest = async (body) => {
    const user = auth.currentUser;
    if (!user) {
      const err = new Error('not signed in');
      err.code = 'unauthorized';
      throw err;
    }
    const idToken = await user.getIdToken();
    const res = await fetch('/api/ordens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const code = payload?.error || (payload === null ? 'proxy_error' : 'server_error');
      const err = new Error(code);
      err.code = code;
      throw err;
    }
    return payload ?? {};
  };

  const explicarErroOrdens = (err) => {
    const code = err?.code || err?.message;
    return (
      ORDENS_ERRORS[code] ||
      // Erros do Ornabird ja tem texto proprio, montado para a sincronizacao.
      ORNABIRD_ERRORS[code] ||
      `Nao foi possivel concluir: ${code || 'erro desconhecido'}`
    );
  };

  // Roda a rotina do dia agora, sem esperar as 6h.
  const rodarRotinaAgora = async () => {
    try {
      const r = await ordensRequest({ action: 'rodar' });
      setSaveError(null);
      return r;
    } catch (err) {
      devError('rodarRotinaAgora error:', err);
      setSaveError(explicarErroOrdens(err));
      throw err;
    }
  };

  // Emite ordens SO das vendas escolhidas na tela.
  //
  // `referenceDate` (YYYY-MM-DD) carimba a ordem com outro dia — pra quando o
  // pagamento aconteceu num dia e o lancamento no outro. Sem ele, vale hoje.
  const gerarOrdensDasVendas = async (saleIds, referenceDate = null) => {
    try {
      const r = await ordensRequest({ action: 'gerar', saleIds, referenceDate });
      setSaveError(null);
      return r;
    } catch (err) {
      devError('gerarOrdensDasVendas error:', err);
      setSaveError(explicarErroOrdens(err));
      throw err;
    }
  };

  // Declara vendas como ja acertadas fora do sistema: elas saem da fila sem
  // virar pagamento. E o que zera o historico no primeiro uso.
  const acertarVendas = async (saleIds, motivo) => {
    try {
      const r = await ordensRequest({ action: 'acertar', saleIds, motivo });
      setSaveError(null);
      return r;
    } catch (err) {
      devError('acertarVendas error:', err);
      setSaveError(explicarErroOrdens(err));
      throw err;
    }
  };

  // Desfaz ordens emitidas por engano: elas saem das listas e as vendas voltam
  // pra fila de pendentes. O documento nao e apagado — fica marcado como
  // cancelado, com quem cancelou e quando (ver cancelarOrdens no servidor).
  const cancelarOrdensDePagamento = async (ids, motivo) => {
    try {
      const r = await ordensRequest({ action: 'cancelar', ids, motivo });
      setSaveError(null);
      return r;
    } catch (err) {
      devError('cancelarOrdensDePagamento error:', err);
      setSaveError(explicarErroOrdens(err));
      throw err;
    }
  };

  // Libera a emissao automatica das 6h.
  const liberarRotinaAutomatica = async () => {
    try {
      const r = await ordensRequest({ action: 'liberar' });
      setSaveError(null);
      return r;
    } catch (err) {
      devError('liberarRotinaAutomatica error:', err);
      setSaveError(explicarErroOrdens(err));
      throw err;
    }
  };

  // Marca as ordens como pagas e manda o comprovante — nesta ordem, sempre.
  const pagarEEnviarOrdens = async (ids) => {
    try {
      const r = await ordensRequest({ action: 'enviar', ids });
      setSaveError(null);
      return r;
    } catch (err) {
      devError('pagarEEnviarOrdens error:', err);
      setSaveError(explicarErroOrdens(err));
      throw err;
    }
  };

  // Custom Species
  const addCustomSpecies = (speciesData) => {
    setData(prev => {
      // Check if species already exists in custom list (case-insensitive)
      const existing = prev.customSpecies.find(s => s.species.toLowerCase() === speciesData.species.toLowerCase());
      if (existing) {
        // Add new breeds to existing custom species
        const newBreeds = speciesData.breeds.filter(b => !existing.breeds.includes(b));
        if (newBreeds.length === 0) return prev;
        return {
          ...prev,
          customSpecies: prev.customSpecies.map(s =>
            s.species.toLowerCase() === speciesData.species.toLowerCase()
              ? { ...s, breeds: [...s.breeds, ...newBreeds] }
              : s
          ),
        };
      }
      // Check if species exists in built-in list (case-insensitive)
      const builtIn = BIRD_SPECIES.find(s => s.species.toLowerCase() === speciesData.species.toLowerCase());
      if (builtIn) {
        // Only store breeds that aren't already in the built-in list
        const newBreeds = speciesData.breeds.filter(b => !builtIn.breeds.includes(b));
        if (newBreeds.length === 0) return prev;
        // Use the built-in species name (correct casing) for consistency
        return { ...prev, customSpecies: [...prev.customSpecies, { species: builtIn.species, breeds: newBreeds }] };
      }
      return { ...prev, customSpecies: [...prev.customSpecies, speciesData] };
    });
  };

  const deleteCustomSpecies = (speciesName) => {
    setDataWithDelete(prev => ({
      ...prev,
      customSpecies: prev.customSpecies.filter(s => s.species !== speciesName),
    }));
  };

  // Financial Investments
  const addFinancialInvestment = (investment) => {
    const newInv = {
      ...investment,
      id: newId(),
      createdAt: new Date().toISOString(),
    };
    setData(prev => ({
      ...prev,
      financialInvestments: [...prev.financialInvestments, newInv],
    }));
    return newInv;
  };

  const deleteFinancialInvestment = (id) => {
    setDataWithDelete(prev => ({
      ...prev,
      financialInvestments: prev.financialInvestments.filter(i => i.id !== id),
    }));
  };

  // Payments (withdrawals / profit sent to investor)
  const addPayment = (payment) => {
    const newPayment = {
      ...payment,
      id: newId(),
      createdAt: new Date().toISOString(),
    };
    setData(prev => ({
      ...prev,
      payments: [...(prev.payments || []), newPayment],
    }));
    return newPayment;
  };

  const deletePayment = (id) => {
    setDataWithDelete(prev => ({
      ...prev,
      payments: (prev.payments || []).filter(p => p.id !== id),
    }));
  };

  // Expenses (operational costs)
  const addExpense = (expense) => {
    const newExpense = {
      ...expense,
      id: newId(),
      createdAt: new Date().toISOString(),
    };
    setData(prev => ({
      ...prev,
      expenses: [...(prev.expenses || []), newExpense],
    }));
    return newExpense;
  };

  const bulkAddExpenses = (expensesArray) => {
    const now = new Date().toISOString();
    const newExpenses = expensesArray.map(expense => ({
      ...expense,
      id: newId(),
      createdAt: now,
    }));
    setData(prev => ({
      ...prev,
      expenses: [...(prev.expenses || []), ...newExpenses],
    }));
    return newExpenses;
  };

  const updateExpense = (id, updates) => {
    setData(prev => ({
      ...prev,
      expenses: (prev.expenses || []).map(e => e.id === id ? { ...e, ...updates } : e),
    }));
  };

  const deleteExpense = (id) => {
    setDataWithDelete(prev => ({
      ...prev,
      expenses: (prev.expenses || []).filter(e => e.id !== id),
    }));
  };

  // Custom Expense Categories
  const addCustomExpenseCategory = (category) => {
    setData(prev => {
      const existing = prev.customExpenseCategories || [];
      if (existing.some(c => c.name.toLowerCase() === category.name.toLowerCase())) return prev;
      return { ...prev, customExpenseCategories: [...existing, { ...category, id: newId() }] };
    });
  };

  const deleteCustomExpenseCategory = (id) => {
    setDataWithDelete(prev => ({
      ...prev,
      customExpenseCategories: (prev.customExpenseCategories || []).filter(c => c.id !== id),
    }));
  };

  // O CRUD manual de coletas saiu com o cadastro antigo: a coleta e
  // registrada no Ornabird e chega aqui pela sincronizacao, em
  // /ornabirdEggCollections. Manter funcoes de escrita para uma colecao que
  // ninguem le so criaria um segundo lugar onde o mesmo ovo pode divergir.

  // O CRUD manual de chocadeiras e chocagens saiu junto: a Chocadeira e
  // registrada no Ornabird e chega aqui pela sincronizacao, em
  // /ornabirdIncubatorBatches. As "maquinas" nao tem mais cadastro proprio —
  // sao deduzidas dos lotes espelhados, que ja trazem id, nome e capacidade.

  // Infirmary Bays
  const addInfirmaryBay = (bay) => {
    const newBay = { ...bay, id: newId(), createdAt: new Date().toISOString() };
    setData(prev => ({ ...prev, infirmaryBays: [...(prev.infirmaryBays || []), newBay] }));
    return newBay;
  };
  const updateInfirmaryBay = (id, updates) => {
    setData(prev => ({ ...prev, infirmaryBays: (prev.infirmaryBays || []).map(b => b.id === id ? { ...b, ...updates } : b) }));
  };
  const deleteInfirmaryBay = (id) => {
    setDataWithDelete(prev => ({
      ...prev,
      infirmaryBays: (prev.infirmaryBays || []).filter(b => b.id !== id),
      infirmaryAdmissions: (prev.infirmaryAdmissions || []).filter(a => a.bayId !== id),
    }));
  };

  // Infirmary Admissions
  const addInfirmaryAdmission = (admission) => {
    const newAdmission = { ...admission, id: newId(), createdAt: new Date().toISOString() };
    setData(prev => ({ ...prev, infirmaryAdmissions: [...(prev.infirmaryAdmissions || []), newAdmission] }));
    return newAdmission;
  };
  const updateInfirmaryAdmission = (id, updates) => {
    setData(prev => ({ ...prev, infirmaryAdmissions: (prev.infirmaryAdmissions || []).map(a => a.id === id ? { ...a, ...updates } : a) }));
  };
  const deleteInfirmaryAdmission = (id) => {
    setDataWithDelete(prev => ({ ...prev, infirmaryAdmissions: (prev.infirmaryAdmissions || []).filter(a => a.id !== id) }));
  };

  // Treatments (per bird house / breed)
  const addTreatment = (treatment) => {
    const newTreatment = { ...treatment, id: newId(), createdAt: new Date().toISOString() };
    setData(prev => ({ ...prev, treatments: [...(prev.treatments || []), newTreatment] }));
    return newTreatment;
  };
  const updateTreatment = (id, updates) => {
    setData(prev => ({ ...prev, treatments: (prev.treatments || []).map(t => t.id === id ? { ...t, ...updates } : t) }));
  };
  const deleteTreatment = (id) => {
    setDataWithDelete(prev => ({ ...prev, treatments: (prev.treatments || []).filter(t => t.id !== id) }));
  };

  // Custom Treatment Types
  const addCustomTreatmentType = (type) => {
    setData(prev => {
      const existing = prev.customTreatmentTypes || [];
      if (existing.some(t => t.name.toLowerCase() === type.name.toLowerCase())) return prev;
      return { ...prev, customTreatmentTypes: [...existing, { ...type, id: newId() }] };
    });
  };
  const deleteCustomTreatmentType = (id) => {
    setDataWithDelete(prev => ({ ...prev, customTreatmentTypes: (prev.customTreatmentTypes || []).filter(t => t.id !== id) }));
  };

  // Nursery Rooms
  const addNurseryRoom = (room) => {
    const newRoom = { ...room, id: newId(), createdAt: new Date().toISOString() };
    setData(prev => ({ ...prev, nurseryRooms: [...(prev.nurseryRooms || []), newRoom] }));
    return newRoom;
  };
  const updateNurseryRoom = (id, updates) => {
    setData(prev => ({ ...prev, nurseryRooms: (prev.nurseryRooms || []).map(r => r.id === id ? { ...r, ...updates } : r) }));
  };
  const deleteNurseryRoom = (id) => {
    setDataWithDelete(prev => ({
      ...prev,
      nurseryRooms: (prev.nurseryRooms || []).filter(r => r.id !== id),
      nurseryBatches: (prev.nurseryBatches || []).filter(b => b.roomId !== id),
      nurseryEvents: (prev.nurseryEvents || []).filter(e => e.roomId !== id),
    }));
  };

  // Nursery Batches (chick groups in rooms)
  const addNurseryBatch = (batch) => {
    const newBatch = { ...batch, id: newId(), createdAt: new Date().toISOString() };
    setData(prev => ({ ...prev, nurseryBatches: [...(prev.nurseryBatches || []), newBatch] }));
    return newBatch;
  };
  const updateNurseryBatch = (id, updates) => {
    setData(prev => ({ ...prev, nurseryBatches: (prev.nurseryBatches || []).map(b => b.id === id ? { ...b, ...updates } : b) }));
  };
  const deleteNurseryBatch = (id) => {
    setDataWithDelete(prev => ({ ...prev, nurseryBatches: (prev.nurseryBatches || []).filter(b => b.id !== id) }));
  };

  // Nursery Events (deaths, medications, vaccinations, bedding changes)
  const addNurseryEvent = (event) => {
    const newEvent = { ...event, id: newId(), createdAt: new Date().toISOString() };
    setData(prev => ({ ...prev, nurseryEvents: [...(prev.nurseryEvents || []), newEvent] }));
    return newEvent;
  };
  const updateNurseryEvent = (id, updates) => {
    setData(prev => ({ ...prev, nurseryEvents: (prev.nurseryEvents || []).map(e => e.id === id ? { ...e, ...updates } : e) }));
  };
  const deleteNurseryEvent = (id) => {
    setDataWithDelete(prev => ({ ...prev, nurseryEvents: (prev.nurseryEvents || []).filter(e => e.id !== id) }));
  };

  // Force save current data to both Firestore and localStorage (can be called by pages)
  const forceSync = () => {
    if (countItems(dataRef.current) === 0) return;
    const sanitized = JSON.parse(JSON.stringify(dataRef.current));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataRef.current));
    lastLocalWriteTime.current = Date.now();
    pendingWriteCount.current += 1;
    setDoc(FIRESTORE_DOC, sanitized)
      .catch(err => devError('Force sync error:', err))
      .finally(() => {
        pendingWriteCount.current = Math.max(0, pendingWriteCount.current - 1);
        lastLocalWriteTime.current = Date.now();
      });
  };

  // -----------------------------------------------------------------
  // Portal share tokens (Phase 2B).
  //
  // We store revocable portal links in a separate /shareTokens collection,
  // where the document ID *is* the token. Tokens are generated with
  // crypto.randomUUID() (128 bits of entropy) — they cannot be enumerated,
  // cannot be guessed from investor.id, and can be revoked by deleting the
  // /shareTokens doc. The admin UI still surfaces a single "current token"
  // per target (investor or employee) by mirroring the token back onto the
  // respective record for display purposes.
  //
  // All four helpers below are async: they write to the separate collection
  // BEFORE updating local state so the mirror never points at a token that
  // doesn't exist in /shareTokens.
  // -----------------------------------------------------------------
  const writeShareToken = async (token, payload) => {
    await setDoc(doc(db, 'shareTokens', token), payload);
  };
  const deleteShareToken = async (token) => {
    if (!token) return;
    try {
      await deleteDoc(doc(db, 'shareTokens', token));
    } catch {
      // Best-effort: the token doc may not exist (legacy token) or the
      // delete may be blocked transiently. Revocation still "works" from
      // the user's perspective because the appData mirror no longer
      // references the old token.
    }
  };

  // Employee Token. One active link at a time (admin UX choice).
  const generateEmployeeToken = async () => {
    const token = newId();
    const oldToken = dataRef.current.employeeToken;
    await writeShareToken(token, {
      type: 'employee',
      createdAt: new Date().toISOString(),
    });
    setData(prev => ({ ...prev, employeeToken: token }));
    // Revoke the previous token after the new one is in place so there's
    // never a window during which no link works.
    if (oldToken && oldToken !== token) {
      await deleteShareToken(oldToken);
    }
    return token;
  };
  const revokeEmployeeToken = async () => {
    const oldToken = dataRef.current.employeeToken;
    setData(prev => ({ ...prev, employeeToken: '' }));
    await deleteShareToken(oldToken);
  };

  // Investor Portal Token. One active link per investor.
  const generateInvestorPortalToken = async (investorId) => {
    const investor = (dataRef.current.investors || []).find(i => i.id === investorId);
    if (!investor) return null;
    const token = newId();
    const oldToken = investor.portalTokenId;
    await writeShareToken(token, {
      type: 'investor',
      investorId,
      createdAt: new Date().toISOString(),
    });
    updateInvestor(investorId, { portalTokenId: token });
    if (oldToken && oldToken !== token) {
      await deleteShareToken(oldToken);
    }
    return token;
  };
  // Link das TELAS do investidor (Plantel, Coleta, Prateleira, Chocadeiras,
  // Vitrine). Guardado num campo proprio e com tipo proprio de token, para
  // conviver com o link de relatorio sem que revogar um derrube o outro.
  const generateInvestorPagesToken = async (investorId) => {
    const investor = (dataRef.current.investors || []).find(i => i.id === investorId);
    if (!investor) return null;
    const token = newId();
    const oldToken = investor.pagesTokenId;
    await writeShareToken(token, {
      type: 'investor_pages',
      investorId,
      createdAt: new Date().toISOString(),
    });
    updateInvestor(investorId, { pagesTokenId: token });
    if (oldToken && oldToken !== token) {
      await deleteShareToken(oldToken);
    }
    return token;
  };
  const revokeInvestorPagesToken = async (investorId) => {
    const investor = (dataRef.current.investors || []).find(i => i.id === investorId);
    if (!investor || !investor.pagesTokenId) return;
    const oldToken = investor.pagesTokenId;
    updateInvestor(investorId, { pagesTokenId: null });
    await deleteShareToken(oldToken);
  };

  const revokeInvestorPortalToken = async (investorId) => {
    const investor = (dataRef.current.investors || []).find(i => i.id === investorId);
    if (!investor || !investor.portalTokenId) return;
    const oldToken = investor.portalTokenId;
    updateInvestor(investorId, { portalTokenId: null });
    await deleteShareToken(oldToken);
  };

  const value = {
    ...data,
    // A configuracao de comissao pronta, pra nenhuma tela ter que lembrar
    // quais campos formam a regra. Antes cada uma montava o objeto na mao, e
    // um campo novo ficava faltando em silencio em quem esquecesse.
    comissaoConfig: fatiaDeComissao(data),
    sales,
    ornabirdTrays,
    ornabirdVitrine,
    ornabirdEggCollections,
    ornabirdIncubatorBatches,
    ornabirdVitrineListings,
    paymentOrders,
    rotinaDiaria,
    replaceOrnabirdMirror,
    fetchOrnabirdGroups,
    syncFromOrnabird,
    rodarRotinaAgora,
    pagarEEnviarOrdens,
    gerarOrdensDasVendas,
    acertarVendas,
    cancelarOrdensDePagamento,
    liberarRotinaAutomatica,
    loading: loading || salesLoading,
    firestoreError,
    saveError,
    addInvestor, updateInvestor, deleteInvestor,
    addBird, updateBird, deleteBird, transferBird,
    updateProfitRates, recalculateAllSaleProfits,
    addSales, clearSales, deleteSale, updateSale, removeDuplicateSales, recoverLegacySales, forceReloadSales,
    addFinancialInvestment, deleteFinancialInvestment,
    addPayment, deletePayment,
    addExpense, bulkAddExpenses, updateExpense, deleteExpense,
    addCustomExpenseCategory, deleteCustomExpenseCategory,
    addInfirmaryBay, updateInfirmaryBay, deleteInfirmaryBay,
    addInfirmaryAdmission, updateInfirmaryAdmission, deleteInfirmaryAdmission,
    addTreatment, updateTreatment, deleteTreatment,
    addCustomTreatmentType, deleteCustomTreatmentType,
    addNurseryRoom, updateNurseryRoom, deleteNurseryRoom,
    addNurseryBatch, updateNurseryBatch, deleteNurseryBatch,
    addNurseryEvent, updateNurseryEvent, deleteNurseryEvent,
    generateEmployeeToken, revokeEmployeeToken,
    generateInvestorPortalToken, revokeInvestorPortalToken,
    generateInvestorPagesToken, revokeInvestorPagesToken,
    addCustomSpecies, deleteCustomSpecies,
    forceSync,
    pedirColecoes, colecaoPronta,
    // Quais espelhos estao com o listener caido, por nome. `{}` = todos de pe.
    espelhosComFalha,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

// A tela declara de quais espelhos precisa.
//
//   useColecoes('vitrine', 'ordens');
//
// Sem esta chamada a colecao NAO e assinada — e o ponto: as ~1.600 vendas do
// Ornabird nao devem ser lidas no Dashboard, no Plantel nem na Coleta de Ovos,
// que nao usam venda nenhuma.
//
// Nomes validos: 'vitrine' (vendas), 'anuncios' (catalogo), 'bandejas',
// 'coletas', 'chocadeiras', 'ordens'.
//
// Uma vez pedida, a colecao fica ouvindo ate a aba fechar. Trocar de tela nao
// desassina: reconectar e justamente o evento que o Firestore cobra.
export function useColecoes(...nomes) {
  const { pedirColecoes } = useApp();
  // A chave de texto e o que evita reassinar a cada render por causa de um
  // array novo com o mesmo conteudo.
  const chave = nomes.filter(Boolean).sort().join(',');
  useEffect(() => {
    if (!chave) return;
    // SEM pedirColecoes nao ha o que pedir, e isso e uma situacao legitima: no
    // portal do investidor os dados ja chegam inteiros do servidor e nao ha
    // assinatura nenhuma pra abrir.
    //
    // O guarda existe porque a falta dele DERRUBOU o portal. Cinco das seis
    // telas de la chamam este hook, e chamar `undefined()` estourava na
    // montagem — o investidor via "Erro ao carregar" no lugar da pagina, sem
    // nada dizendo o motivo. Um provedor que nao faz carregamento sob demanda
    // nao pode custar uma tela em branco.
    if (typeof pedirColecoes !== 'function') return;
    pedirColecoes(chave.split(','));
  }, [chave, pedirColecoes]);
}
