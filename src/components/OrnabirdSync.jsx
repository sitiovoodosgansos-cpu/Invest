import React, { useState } from 'react';
import { RefreshCw, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { descreverRotina } from '../utils/sincronizacao';

// Botão de sincronização dos espelhos do Ornabird (Prateleira e Vitrine).
//
// O Ornabird é a fonte da verdade: aqui só puxamos e substituímos a cópia
// local. Só o administrador vê o botão — a chamada é barrada no servidor de
// qualquer forma, mas mostrar um botão que sempre falha seria pior.
//
// O resultado da última sincronização fica visível em vez de sumir num toast:
// um lote vinculado que o Ornabird não conhece significa que aquele investidor
// não vai receber nada no rateio, e isso não pode passar despercebido.
export default function OrnabirdSync({ label = 'Sincronizar com o Ornabird' }) {
  const { syncFromOrnabird, somenteLeitura, rotinaDiaria } = useApp();
  const { isAdmin } = useAuth();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Fora para quem nao e administrador — e tambem dentro de um portal
  // somente-leitura, mesmo que quem esteja olhando seja o administrador. Ali a
  // sincronizacao e bloqueada pelo contexto, entao o botao so daria erro.
  if (!isAdmin || somenteLeitura) return null;

  // A RODADA DAS 6H, ANTES DO BOTAO.
  //
  // Este botao mora em cinco telas e, ate 02/09, nao dizia uma palavra sobre
  // a sincronizacao automatica. O dono clicou nele a meia-noite e pediu "o
  // ideal seria fazer automatica as 6 da manha" — ela ja rodava havia cinco
  // dias. Uma rodada que roda e nao avisa e igual a uma que nao roda: gera o
  // clique manual, que custa duas ou tres vezes mais leituras que a rodada no
  // servidor.
  //
  // `rotinaDiaria` e o /config/rotinaDiaria, que o contexto ja escuta sempre
  // (um documento, uma leitura). Nao custa nada a mais mostrar.
  const rotina = descreverRotina(rotinaDiaria);
  const rotinaCalma = rotina.tom === 'ok' || rotina.tom === 'nunca';

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await syncFromOrnabird());
    } catch {
      // A mensagem legível já foi para o saveError do contexto; aqui só
      // marcamos que esta tentativa falhou.
      setError('Não foi possível sincronizar. Veja a mensagem no topo da página.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Cinza quando esta tudo certo (ou ainda carregando); laranja quando
          parou ou falhou — ai o dado da tela pode estar velho, e isso tem que
          gritar mais que o botao. */}
      <div
        data-rotina={rotina.tom}
        className={rotinaCalma ? undefined : 'badge badge-orange'}
        style={rotinaCalma
          ? { fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'flex-start', gap: 6 }
          : { display: 'flex', alignItems: 'flex-start', gap: 6 }}
      >
        {rotina.tom === 'ok'
          ? <Clock size={13} style={{ flexShrink: 0, marginTop: 2 }} />
          : <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />}
        <span>{rotina.texto}</span>
      </div>

      <button type="button" className="btn btn-secondary btn-sm" onClick={run} disabled={running}>
        <RefreshCw size={16} />
        {running ? 'Sincronizando…' : label}
      </button>

      {error && (
        <div className="badge badge-orange" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {result && !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="badge badge-green" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <CheckCircle2 size={14} />
            {result.groupIds.length} lote(s) · {result.trays} bandeja(s) ·{' '}
            {result.eggCollections} coleta(s) · {result.incubatorBatches} chocagem(ns) ·{' '}
            {result.vitrineListings} anuncio(s) · {result.vitrine} venda(s)
          </div>

          {/* O que de fato foi gravado. A sincronizacao so escreve o que
              mudou, entao repetir o clique sem novidade custa zero. */}
          <div className="badge" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {result.gravadas === 0 && result.apagadas === 0
              ? 'Nada mudou — nenhuma gravacao'
              : `${result.gravadas} linha(s) gravada(s)${result.apagadas ? ` · ${result.apagadas} apagada(s)` : ''}`}
          </div>

          {result.groupIds.length === 0 && (
            <div className="badge badge-orange" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle size={14} />
              Nenhuma linha do Plantel está vinculada a um lote do Ornabird.
            </div>
          )}

          {result.unknownGroupIds?.length > 0 && (
            <div className="badge badge-orange" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle size={14} />
              Lote(s) que o Ornabird não reconhece: {result.unknownGroupIds.join(', ')}. Confira o
              vínculo no Plantel — esses não entram no rateio.
            </div>
          )}

          {result.warnings?.map((w, i) => (
            <div
              key={i}
              className="badge badge-orange"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <AlertCircle size={14} />
              {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
