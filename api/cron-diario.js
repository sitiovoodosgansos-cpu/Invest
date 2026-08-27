// A rodada automatica de todo dia, disparada pela Vercel.
//
// O horario esta em vercel.json: "0 9 * * *" = 09:00 UTC = 06:00 de Brasilia.
// A Vercel dispara dentro de uma janela, nao no segundo exato — pra esta
// rotina tanto faz, mas nao vale prometer "6h em ponto" pra ninguem.
//
// O mesmo vercel.json da 60 segundos de maxDuration a esta funcao. O padrao e
// curto demais: aqui dentro cabem a busca no Ornabird (paginada), a leitura
// das cinco colecoes espelhadas (mais de mil linhas), a comparacao, as
// gravacoes, a leitura das ordens e o e-mail. O botao de sincronizar do
// navegador nunca precisou disso porque as gravacoes aconteciam LA, no
// navegador; aqui tudo acontece dentro da funcao.
//
// SEGURANCA
// ---------
// A rota e publica na internet: qualquer um pode chamar a URL. A unica coisa
// que separa a Vercel de um estranho e o CRON_SECRET, que a Vercel manda no
// cabecalho Authorization quando a variavel existe no projeto.
//
// Sem CRON_SECRET configurado, a rota RECUSA todo mundo — inclusive a propria
// Vercel. Isso e de proposito: a alternativa (abrir quando falta o segredo)
// deixaria a rotina exposta justamente enquanto ninguem percebeu que a
// variavel nao foi criada, e uma configuracao esquecida nao pode virar uma
// porta aberta. Se a rotina nao rodar, o motivo aparece na tela de Ordens.

import { rodarERegistrar } from './_rotina-diaria.js';

// Comparacao de tempo constante: um `===` vaza, pelo tempo de resposta, quantos
// caracteres do inicio conferem, e isso permite adivinhar o segredo caractere
// por caractere. Node tem timingSafeEqual, mas ele exige buffers do mesmo
// tamanho, entao o tamanho e checado antes (o tamanho nao e segredo util).
function segredoConfere(recebido, esperado) {
  if (typeof recebido !== 'string' || typeof esperado !== 'string') return false;
  if (recebido.length !== esperado.length) return false;
  let diferenca = 0;
  for (let i = 0; i < recebido.length; i += 1) {
    diferenca |= recebido.charCodeAt(i) ^ esperado.charCodeAt(i);
  }
  return diferenca === 0;
}

// O QUE A LINHA DO LOG PRECISA CONTAR.
//
// Uma linha por rodada no log da Vercel. E o unico lugar onde da pra ver a
// historia de varios dias — o /config/rotinaDiaria so guarda a ultima.
//
// So que ela vinha contando `ordens`, `aPagar` e `semDono`, e as duas
// primeiras sao ZERO FIXO enquanto a emissao automatica nao for liberada (ver
// o ramo `!liberado` em _rotina-diaria.js). Ou seja: a rodada de 27/08 saiu
// como `{"ordens":0,"aPagar":0,"semDono":0}` — que e exatamente o que sairia
// se a sincronizacao nao tivesse trazido nada. Um log que da a mesma resposta
// pra "funcionou" e pra "nao fez nada" nao serve pra conferir nada.
//
// Agora vai o que VARIA: quanto cada espelho gravou/apagou, quantos resumos de
// portal foram escritos, e quantas vendas estao esperando o dono liberar.
//
// TOTAL DE PROPOSITO: isto roda DEPOIS da rodada ter dado certo. Uma excecao
// aqui dentro cairia no catch e devolveria 500 para uma rodada que funcionou —
// o log passaria a mentir sobre o proprio sucesso. Por isso nada aqui indexa
// sem conferir, e o pior caso e um campo faltando na linha.
export function linhaDoLog(resumo) {
  const r = resumo || {};
  const linha = { referenceDate: r.referenceDate ?? null };

  // Os cinco espelhos somados: e o numero que diz se a sincronizacao das 6h
  // trouxe alguma coisa do Ornabird.
  const espelhos = r.espelhos && typeof r.espelhos === 'object' ? r.espelhos : {};
  const soma = { gravadas: 0, apagadas: 0, inalteradas: 0 };
  for (const e of Object.values(espelhos)) {
    if (!e || typeof e !== 'object') continue;
    soma.gravadas += Number(e.gravadas) || 0;
    soma.apagadas += Number(e.apagadas) || 0;
    soma.inalteradas += Number(e.inalteradas) || 0;
  }
  linha.espelhos = soma;

  // O resumo do portal e o que faz a tela do investidor custar 1 leitura em
  // vez das 1.619 vendas. Se parar de ser gravado, o custo volta calado.
  const res = r.resumos && typeof r.resumos === 'object' ? r.resumos : null;
  if (res) {
    linha.resumos = {
      vendasLidas: Number(res.vendasLidas) || 0,
      gravados: Number(res.gravados) || 0,
      inalterados: Number(res.inalterados) || 0,
      apagados: Number(res.apagados) || 0,
      grandesDemais: Array.isArray(res.grandesDemais)
        ? res.grandesDemais.length
        : (Number(res.grandesDemais) || 0),
    };
  }

  linha.ordens = Number(r.ordens) || 0;
  linha.aPagar = Number(r.aPagar) || 0;
  // So aparecem enquanto a emissao esta travada — e ai sao O numero que
  // importa, porque `ordens` e `aPagar` ficam zerados por regra.
  if (r.aguardandoLiberacao === true) {
    linha.aguardandoLiberacao = true;
    linha.pendentes = Number(r.pendentes) || 0;
    linha.pendentesValor = Number(r.pendentesValor) || 0;
  }
  linha.semDono = Array.isArray(r.semDono) ? r.semDono.length : (Number(r.semDono) || 0);
  linha.avisos = Array.isArray(r.warnings) ? r.warnings.length : 0;
  return linha;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  const esperado = process.env.CRON_SECRET;
  if (!esperado) {
    console.error('[cron-diario] CRON_SECRET nao configurado; rodada recusada');
    return res.status(503).json({ error: 'missing_cron_secret' });
  }

  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ') || !segredoConfere(header.slice(7).trim(), esperado)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const resumo = await rodarERegistrar({ origem: 'cron' });
    console.log('[cron-diario]', JSON.stringify(linhaDoLog(resumo)));
    return res.status(200).json({ ok: true, ...resumo });
  } catch (err) {
    console.error('[cron-diario]', JSON.stringify({
      code: err?.code ?? null,
      message: err?.message ?? null,
    }));
    return res.status(500).json({ error: String(err?.code || 'server_error') });
  }
}
