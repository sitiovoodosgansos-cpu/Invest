// A rodada automatica de todo dia, disparada pela Vercel.
//
// O horario esta em vercel.json: "0 9 * * *" = 09:00 UTC = 06:00 de Brasilia.
// A Vercel dispara dentro de uma janela, nao no segundo exato — pra esta
// rotina tanto faz, mas nao vale prometer "6h em ponto" pra ninguem.
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
    // Uma linha por rodada no log da Vercel. E o unico lugar onde da pra ver a
    // historia de varios dias — o /config/rotinaDiaria so guarda a ultima.
    console.log('[cron-diario]', JSON.stringify({
      referenceDate: resumo.referenceDate,
      ordens: resumo.ordens,
      aPagar: resumo.aPagar,
      semDono: resumo.semDono.length,
    }));
    return res.status(200).json({ ok: true, ...resumo });
  } catch (err) {
    console.error('[cron-diario]', JSON.stringify({
      code: err?.code ?? null,
      message: err?.message ?? null,
    }));
    return res.status(500).json({ error: String(err?.code || 'server_error') });
  }
}
