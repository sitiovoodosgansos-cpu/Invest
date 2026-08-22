// O que fazer com um snapshot do /config/appData.
//
// POR QUE ISTO E UMA FUNCAO SEPARADA
// ----------------------------------
// Esta decisao mexe em dinheiro e em historico: um dos caminhos REESCREVE o
// documento inteiro no Firestore. Enquanto ela vivia solta dentro de um
// useEffect nao dava pra testar nenhum dos casos — e o caso que importa e
// justamente o raro, o de dois dispositivos discordando.
//
// A ARMADILHA QUE O CACHE TROUXE
// ------------------------------
// Com o cache local ligado, o PRIMEIRO snapshot passa a vir do cache, nao do
// servidor. A protecao original dizia "ja carreguei do Firestore, entao um
// snapshot com menos itens e suspeito — republica o meu". Lida com o cache,
// essa frase vira: "o cache carregou, entao o servidor esta errado" — e uma
// exclusao feita no celular seria desfeita pelo computador na manha seguinte,
// sem nada na tela.
//
// Por isso `jaVeioDoServidor` so pode ser ligado por snapshot DO SERVIDOR, e o
// republicar so acontece com snapshot do servidor. Snapshot de cache nunca
// republica nada: ele e a nossa propria copia voltando, nao uma discordancia.

export const ACAO = {
  // Descarta: temos escrita em voo e o snapshot pode ser anterior a ela.
  IGNORAR: 'ignorar',
  // Usa os dados recebidos.
  ACEITAR: 'aceitar',
  // Os dados recebidos perderam itens que ninguem mandou apagar. Republica os
  // locais pra consertar a divergencia.
  REPUBLICAR: 'republicar',
};

// Janela em que um snapshot ainda pode ser anterior a nossa ultima escrita.
// O Firestore confirma a escrita e so depois propaga; um snapshot que chega
// nesse meio tempo traz o estado ANTERIOR e desfaria o que acabou de ser
// salvo na tela.
export const JANELA_ESCRITA_MS = 10000;

export function decidirSnapshot({
  // snapshot.metadata.fromCache — veio da copia local, nao do servidor.
  doCache = false,
  escritasPendentes = 0,
  msDesdeEscrita = Infinity,
  // So vira true depois de um snapshot DO SERVIDOR. E o que arma a protecao.
  jaVeioDoServidor = false,
  itensLocais = 0,
  itensRecebidos = 0,
  // Quantos itens o proprio usuario apagou desde o ultimo snapshot. Uma queda
  // ate esse tamanho e esperada, nao divergencia.
  apagadosLocais = 0,
} = {}) {
  if (escritasPendentes > 0 || msDesdeEscrita < JANELA_ESCRITA_MS) {
    return ACAO.IGNORAR;
  }

  const perdeuItens = itensRecebidos < itensLocais;
  const quedaInesperada = itensLocais - itensRecebidos > apagadosLocais;

  // Republicar so com snapshot do servidor: e o unico que pode discordar de
  // nos. O do cache SOMOS nos.
  if (!doCache && jaVeioDoServidor && perdeuItens && quedaInesperada) {
    return ACAO.REPUBLICAR;
  }

  return ACAO.ACEITAR;
}
