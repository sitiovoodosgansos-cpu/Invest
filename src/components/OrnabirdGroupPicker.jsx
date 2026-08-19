import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, AlertCircle, Pencil } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';

// Seletor do lote do Ornabird para o campo "Vinculo com o Ornabird".
//
// POR QUE ISSO EXISTE
// -------------------
// O campo era texto livre e pedia o id do lote (um cuid tipo "clx123..."), que
// nao aparece em tela nenhuma do Ornabird. Na pratica era impossivel de
// preencher sem abrir o banco — e um id digitado errado nao da erro: o lote
// some do rateio em silencio, e o investidor simplesmente nao recebe.
//
// Aqui a pessoa escolhe pelo NOME do lote e o id vai junto, invisivel.
//
// A lista vem de GET /api/integrations/invest/groups (via /api/ornabird), que
// so responde pra admin. Quando ela nao carrega — sem permissao, integracao
// fora do ar — caimos no campo de texto de antes, para nunca BLOQUEAR o
// cadastro por causa de um campo que e opcional.

function groupLabel(g) {
  const partes = [g.breed, g.variety].filter(Boolean).join(' ');
  const marcas = [];
  if (g.isHatchGroup) marcas.push('chocada');
  if (g.isResale) marcas.push('revenda');

  let label = g.title || '(sem titulo)';
  if (partes) label += ` — ${partes}`;
  if (typeof g.birdCount === 'number') label += ` · ${g.birdCount} ave(s)`;
  if (marcas.length) label += ` [${marcas.join(', ')}]`;
  return label;
}

export default function OrnabirdGroupPicker({ value, onChange }) {
  const { fetchOrnabirdGroups } = useApp();
  const { isAdmin } = useAuth();

  const [groups, setGroups] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // Escape hatch: mesmo com a lista carregada, da pra digitar um id na mao.
  const [manual, setManual] = useState(false);

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      setGroups(await fetchOrnabirdGroups());
    } catch {
      // A mensagem legivel ja foi pro saveError do contexto.
      setFailed(true);
      setGroups(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // Lotes de plantel primeiro; chocada e revenda no fim. Sao os que a pessoa
  // quer na esmagadora maioria das vezes — os filhotes de uma chocada ja sobem
  // pro lote das matrizes sozinhos, entao vincular a chocada direto e raro.
  const ordenados = useMemo(() => {
    if (!groups) return [];
    return [...groups].sort((a, b) => {
      const peso = (g) => (g.isHatchGroup || g.isResale ? 1 : 0);
      if (peso(a) !== peso(b)) return peso(a) - peso(b);
      return (a.title || '').localeCompare(b.title || '');
    });
  }, [groups]);

  // Vinculo apontando pra um lote que a lista nao tem. Precisa virar opcao,
  // senao o select apareceria vazio e a pessoa pensaria que o vinculo sumiu.
  // (O valor em si nunca se perde: so mexemos no form via onChange, e onChange
  // so dispara quando alguem escolhe algo de verdade.)
  const desconhecido = Boolean(value) && !ordenados.some((g) => g.id === value);
  // So e ORFAO depois que a lista carregou. Enquanto carrega, todo vinculo
  // parece desconhecido — acusar "nao encontrado" ali seria alarme falso.
  const orfao = desconhecido && !loading && groups !== null;

  const usarTexto = manual || failed || !isAdmin;

  if (usarTexto) {
    return (
      <div>
        <input
          className="form-input"
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="ID do lote (flock group) no Ornabird"
        />
        {failed && (
          <div
            className="badge badge-orange"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6 }}
          >
            <AlertCircle size={14} />
            Nao foi possivel carregar os lotes do Ornabird — digite o id ou tente de novo.
          </div>
        )}
        {isAdmin && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 6 }}
            onClick={() => {
              setManual(false);
              load();
            }}
          >
            <RefreshCw size={14} />
            Escolher da lista
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          className="form-input"
          style={{ flex: 1 }}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={loading}
        >
          <option value="">
            {loading ? 'Carregando lotes do Ornabird...' : '— Sem vinculo —'}
          </option>
          {desconhecido && (
            <option value={value}>
              {orfao ? `${value} — nao encontrado no Ornabird` : value}
            </option>
          )}
          {ordenados.map((g) => (
            <option key={g.id} value={g.id}>
              {groupLabel(g)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={load}
          disabled={loading}
          title="Recarregar a lista de lotes"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {orfao && (
        <div
          className="badge badge-orange"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6 }}
        >
          <AlertCircle size={14} />
          Este vinculo aponta pra um lote que o Ornabird nao reconhece — nao entra no rateio.
        </div>
      )}

      {!loading && ordenados.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
          Nenhum lote encontrado no Ornabird.
        </div>
      )}

      <button
        type="button"
        className="btn btn-secondary btn-sm"
        style={{ marginTop: 6 }}
        onClick={() => setManual(true)}
      >
        <Pencil size={14} />
        Digitar o id manualmente
      </button>
    </div>
  );
}
