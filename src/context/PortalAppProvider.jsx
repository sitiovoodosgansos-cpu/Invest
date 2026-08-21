import React, { useMemo } from 'react';
import { AppContext } from './AppContext';

// Monta o MESMO contexto que as telas já consomem, mas a partir da fatia que
// o servidor devolveu para um investidor — e não do Firestore.
//
// POR QUE ISSO EXISTE
//
// As telas leem tudo pelo useApp(), que no app completo baixa o banco inteiro
// no navegador e filtra na hora. Apontar o link de um investidor para essas
// telas daria uma separação só visual: bastaria abrir o DevTools para ver os
// dados de todos os outros. Aqui o navegador dele nunca recebe dado alheio,
// porque o recorte já veio pronto do servidor.
//
// As telas não sabem em qual dos dois estão. Elas chamam useApp() e recebem a
// mesma forma; muda só o que chega dentro.

// Toda função de escrita cai aqui. O portal é de consulta: não há botão que
// chame nenhuma delas, mas se um dia houver, é melhor falhar alto do que
// gravar em silêncio uma coisa que o investidor não deveria poder gravar.
function somenteLeitura(nome) {
  return () => {
    throw new Error(`O portal do investidor é somente leitura (${nome}).`);
  };
}

const ESCRITAS = [
  'addInvestor', 'updateInvestor', 'deleteInvestor',
  'addBird', 'updateBird', 'deleteBird', 'transferBird',
  'updateProfitRates', 'recalculateAllSaleProfits',
  'addSales', 'clearSales', 'deleteSale', 'updateSale', 'removeDuplicateSales',
  'recoverLegacySales', 'forceReloadSales',
  'addFinancialInvestment', 'deleteFinancialInvestment',
  'addPayment', 'deletePayment',
  'addExpense', 'bulkAddExpenses', 'updateExpense', 'deleteExpense',
  'addCustomExpenseCategory', 'deleteCustomExpenseCategory',
  'addInfirmaryBay', 'updateInfirmaryBay', 'deleteInfirmaryBay',
  'addInfirmaryAdmission', 'updateInfirmaryAdmission', 'deleteInfirmaryAdmission',
  'addTreatment', 'updateTreatment', 'deleteTreatment',
  'addCustomTreatmentType', 'deleteCustomTreatmentType',
  'addNurseryRoom', 'updateNurseryRoom', 'deleteNurseryRoom',
  'addNurseryBatch', 'updateNurseryBatch', 'deleteNurseryBatch',
  'addNurseryEvent', 'updateNurseryEvent', 'deleteNurseryEvent',
  'generateEmployeeToken', 'revokeEmployeeToken',
  'generateInvestorPortalToken', 'revokeInvestorPortalToken',
  'generateInvestorPagesToken', 'revokeInvestorPagesToken',
  'addCustomSpecies', 'deleteCustomSpecies',
  'replaceOrnabirdMirror', 'fetchOrnabirdGroups', 'syncFromOrnabird',
  'forceSync',
];

export function PortalAppProvider({ payload, loading, error, children }) {
  const value = useMemo(() => {
    const dados = payload || {};
    const paginas = dados.paginas || {};
    const taxas = dados.rates || {};

    const escritas = {};
    for (const nome of ESCRITAS) escritas[nome] = somenteLeitura(nome);

    return {
      // Só o próprio investidor aparece na lista: as telas usam `investors`
      // para resolver o nome do dono de cada linha, e no portal esse dono é
      // sempre ele.
      investors: dados.investor ? [dados.investor] : [],
      birds: Array.isArray(dados.birds) ? dados.birds : [],
      sales: Array.isArray(dados.sales) ? dados.sales : [],
      financialInvestments: Array.isArray(dados.financialInvestments) ? dados.financialInvestments : [],
      payments: Array.isArray(dados.payments) ? dados.payments : [],

      // Espelhos, já recortados pelos lotes deste investidor no servidor.
      ornabirdTrays: paginas.ornabirdTrays || [],
      ornabirdEggCollections: paginas.ornabirdEggCollections || [],
      ornabirdIncubatorBatches: paginas.ornabirdIncubatorBatches || [],
      ornabirdVitrineListings: paginas.ornabirdVitrineListings || [],
      ornabirdVitrine: paginas.ornabirdVitrine || [],

      // Listas que as telas do portal não mostram, mas que elas leem ao montar.
      // Vazias de propósito: são dados do criatório, não do investidor.
      expenses: [],
      customExpenseCategories: [],
      customSpecies: [],
      customTreatmentTypes: [],
      infirmaryBays: [],
      infirmaryAdmissions: [],
      treatments: [],
      nurseryRooms: [],
      nurseryBatches: [],
      nurseryEvents: [],
      employeeToken: '',

      eggProfitRate: taxas.eggProfitRate,
      birdProfitRate: taxas.birdProfitRate,

      // As telas que tem cadastro (Plantel, Coleta) leem esta flag para
      // esconder os botoes de escrita. As funcoes ja lancam se chamadas; isto
      // e para o investidor nao ver botao que nao pode usar.
      somenteLeitura: true,

      loading: !!loading,
      firestoreError: error || null,
      saveError: null,

      ...escritas,
    };
  }, [payload, loading, error]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
