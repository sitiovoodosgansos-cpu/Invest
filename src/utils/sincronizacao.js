// COMO CONTAR, NA TELA, O QUE A RODADA DAS 6H FEZ.
//
// O dono clicou em "Sincronizar com o Ornabird" a meia-noite e disse que "o
// ideal seria fazer automatica as 6 da manha". A rodada automatica JA rodava
// todo dia havia cinco dias, trazendo 20, 114, 1, 0 e 224 registros — mas o
// botao ficava em cinco telas sem dizer uma palavra sobre ela. A unica mencao
// era um texto cinza de 12px na tela de Ordens de Pagamento.
//
// Uma sincronizacao que roda e nao avisa e igual a uma que nao roda: a pessoa
// clica no botao por via das duvidas, e o clique manual custa duas ou tres
// vezes mais leituras do que a rodada no servidor.
//
// Este modulo e puro de proposito: recebe o documento /config/rotinaDiaria e o
// relogio, devolve texto. Assim da pra testar hoje/ontem/parada/falhou em Node,
// sem navegador e sem relogio de verdade.

// Com extensao de proposito: o Vite aceita dos dois jeitos, mas o Node puro —
// onde a suite deste modulo roda — so resolve import relativo com extensao.
import { diaBrasilia } from './ordens.js';

// Depois de quantas horas sem rodar a rodada conta como PARADA.
//
// Ela roda por volta das 6h. Se a ultima foi ontem as 6h e agora passa das 8h
// de hoje (26h), a de hoje ja deveria ter acontecido — e nao aconteceu. Duas
// horas de folga cobrem a janela em que a Vercel dispara o cron.
export const HORAS_ATE_CONSIDERAR_PARADA = 26;

// Soma o que os cinco espelhos gravaram/apagaram. Tolera qualquer entrada:
// isto roda no meio de uma renderizacao e um throw derrubaria a tela inteira.
export function somarEspelhos(espelhos) {
  const soma = { gravadas: 0, apagadas: 0, inalteradas: 0 };
  if (!espelhos || typeof espelhos !== 'object') return soma;
  for (const e of Object.values(espelhos)) {
    if (!e || typeof e !== 'object') continue;
    soma.gravadas += Number(e.gravadas) || 0;
    soma.apagadas += Number(e.apagadas) || 0;
    soma.inalteradas += Number(e.inalteradas) || 0;
  }
  return soma;
}

function horaBrasilia(d) {
  return d.toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });
}

function diaMesBrasilia(d) {
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo',
  });
}

// "hoje as 06:01", "ontem as 06:01" ou "29/08 as 06:01". `comEm` poe o "em"
// so na forma com data: "em 29/08 as 06:01" — "em hoje" nao existe.
function quando(rodada, agora, { comEm = false } = {}) {
  const hora = horaBrasilia(rodada);
  const dia = diaBrasilia(rodada);
  if (dia === diaBrasilia(agora)) return `hoje às ${hora}`;
  if (dia === diaBrasilia(new Date(agora.getTime() - 24 * 60 * 60 * 1000))) {
    return `ontem às ${hora}`;
  }
  return `${comEm ? 'em ' : ''}${diaMesBrasilia(rodada)} às ${hora}`;
}

const A_AUTOMATICA = 'A sincronização automática roda todo dia por volta das 6h.';

// Devolve { tom, texto }.
//
//   tom 'nunca'  — nunca rodou (ou o registro esta ilegivel)
//   tom 'erro'   — a ultima rodada falhou
//   tom 'aviso'  — rodou, mas ha mais de HORAS_ATE_CONSIDERAR_PARADA horas
//   tom 'ok'     — rodou, e diz o que trouxe
//
// NUNCA lanca. Qualquer coisa que nao seja um registro legivel vira 'nunca':
// e melhor a tela dizer "ainda nao rodou" do que cair.
export function descreverRotina(rotina, agora = new Date()) {
  const r = rotina && typeof rotina === 'object' ? rotina : null;
  const rodada = r ? new Date(r.lastRunAt) : new Date(NaN);
  const agoraD = agora instanceof Date ? agora : new Date(agora);

  if (!r || Number.isNaN(rodada.getTime()) || Number.isNaN(agoraD.getTime())) {
    return {
      tom: 'nunca',
      texto: 'A sincronização automática (todo dia por volta das 6h) ainda não rodou nenhuma vez.',
    };
  }

  if (r.ok === false) {
    const motivo = r.error ? `: ${String(r.error)}` : '';
    return {
      tom: 'erro',
      texto: `A sincronização automática ${quando(rodada, agoraD, { comEm: true })} `
        + `falhou${motivo}. Os dados abaixo podem estar desatualizados.`,
    };
  }

  const horasAtras = (agoraD.getTime() - rodada.getTime()) / (60 * 60 * 1000);
  if (horasAtras > HORAS_ATE_CONSIDERAR_PARADA) {
    return {
      tom: 'aviso',
      texto: `A sincronização automática não roda desde ${quando(rodada, agoraD)}. `
        + 'Os dados abaixo podem estar desatualizados.',
    };
  }

  const { gravadas, apagadas } = somarEspelhos(r.resumo?.espelhos);
  const novidade = gravadas === 0 && apagadas === 0
    ? 'nada mudou no Ornabird'
    : `${gravadas} registro(s) novo(s)${apagadas ? `, ${apagadas} removido(s)` : ''}`;

  // "Rodar agora" na tela de Ordens grava origem 'manual'. Ai a linha nao
  // pode dizer "automaticamente" — mas continua lembrando que a automatica
  // existe, que e o ponto da linha inteira.
  if (r.origem === 'manual') {
    return {
      tom: 'ok',
      texto: `Última rodada ${quando(rodada, agoraD, { comEm: true })} (manual) · ${novidade}. `
        + A_AUTOMATICA,
    };
  }
  return {
    tom: 'ok',
    texto: `Sincronizado automaticamente ${quando(rodada, agoraD, { comEm: true })} · ${novidade}. `
      + A_AUTOMATICA,
  };
}
