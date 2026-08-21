import React, { useState } from 'react';
import { RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

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
  const { syncFromOrnabird } = useApp();
  const { isAdmin } = useAuth();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  if (!isAdmin) return null;

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
