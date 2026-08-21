import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  formatCurrency, formatDate, formatPercent, getInitials,
  buildOrnabirdGroupIndex, resolveMirrorBird, resolveRateFor,
  mapOrnabirdVitrineListings, formatAgeMonths, buildVitrineRows,
  resolveBirdInvestorForDate,
} from '../utils/helpers';
import {
  Store, Search, Link2, AlertCircle, DollarSign, TrendingUp, User, ImageOff,
} from 'lucide-react';
import OrnabirdSync from '../components/OrnabirdSync';

// Espelho somente-leitura da Vitrine do Ornabird.
//
// Duas metades, porque a Vitrine tem dois conteudos:
//
//   1. O CATALOGO (em cima) — clone da tela do Ornabird: um card por raca,
//      com as linhas de anuncio agrupadas do mesmo jeito, preco que sobe com
//      a idade, composicao por sexo e foto. Ver o mesmo anuncio com aparencia
//      diferente em cada sistema faz duvidar de qual esta certo.
//   2. As VENDAS (embaixo) — o que o Invest acrescenta: a venda ja chega
//      vinculada ao lote de origem, entao o dono e resolvido com exatidao, em
//      vez do palpite por texto na descricao (matchSaleToBird), que erra
//      quando duas racas tem nomes parecidos.
//
// Nao ha acoes de vender/editar: a acao acontece no Ornabird, fonte da verdade.

// Chip de rotulo, no mesmo formato dos da tela de la.
function Chip({ fundo, texto, titulo, children }) {
  return (
    <span
      title={titulo}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: fundo, color: texto, borderRadius: 8,
        padding: '4px 8px', fontSize: 12, fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

// Foto quadrada do anuncio. Sem foto (ou se a imagem sumir do Ornabird),
// mostra um espaco neutro em vez de um icone quebrado.
function FotoAnuncio({ url, alt }) {
  const [falhou, setFalhou] = useState(false);
  const lado = 52;
  if (!url || falhou) {
    return (
      <div style={{
        width: lado, height: lado, borderRadius: 10, flexShrink: 0,
        background: 'var(--bg-secondary)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)',
      }}>
        <ImageOff size={18} />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt || 'Foto do anuncio'}
      onError={() => setFalhou(true)}
      style={{ width: lado, height: lado, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }}
    />
  );
}

// Preco formatado como o formatBRL de la: travessao quando nao ha preco.
function preco(v) {
  return v === null || v === undefined ? '—' : formatCurrency(v);
}

// Linha do card. Mescla varias insercoes numa linha so quando o Ornabird
// mesclaria (buildVitrineRows), somando as quantidades.
function LinhaAnuncio({ linha, nomeInvestidor, tituloCard }) {
  const principal = linha.tipo === 'unica' ? linha.listing : linha.listings[0];
  const lista = linha.tipo === 'unica' ? [linha.listing] : linha.listings;
  const disponivel = lista.reduce((s, l) => s + l.availableQuantity, 0);
  const inicial = lista.reduce((s, l) => s + l.initialQuantity, 0);
  const machos = lista.reduce((s, l) => s + l.males, 0);
  const femeas = lista.reduce((s, l) => s + l.females, 0);
  const naoSexado = lista.reduce((s, l) => s + l.unknownSex, 0);
  const foto = lista.find(l => (l.photos || []).length > 0)?.photos?.[0] ?? null;
  const investidor = nomeInvestidor(principal.bird);

  return (
    <li style={{
      border: '1px solid var(--border)', borderRadius: 14,
      background: '#fff', padding: 12, listStyle: 'none',
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minWidth: 0 }}>
        <FotoAnuncio url={foto} alt={principal.flockGroupTitle} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {/* Titulo vem do CARD, nao do anuncio: na revenda o card ja
                limpou o prefixo "Recria ·", e repetir o cru aqui mostraria
                dois nomes diferentes pra mesma ave. */}
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {tituloCard || principal.flockGroupTitle}
              {linha.tipo === 'mesclada' && ` · ${disponivel} aves · ${formatAgeMonths(principal.ageInMonths)}`}
            </span>
            {linha.tipo === 'mesclada' && (
              <span style={{
                background: '#e0f2fe', color: '#075985', borderRadius: 999,
                padding: '1px 6px', fontSize: 9, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.1em',
              }}>
                {lista.length} insercoes
              </span>
            )}
          </div>
          {linha.tipo === 'unica' && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {formatAgeMonths(principal.ageInMonths)}
              {principal.createdAt && ` · inserido em ${formatDate(principal.createdAt)}`}
            </div>
          )}
          {principal.purchaseDate && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4,
              background: '#fffbeb', color: '#92400e', borderRadius: 999,
              padding: '1px 6px', fontSize: 10, fontWeight: 500,
            }}>
              🛒 Recria comprada{principal.vendorName ? ` · ${principal.vendorName}` : ''}
            </div>
          )}
          {principal.lastVaccination && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4,
              background: '#ecfdf5', color: '#065f46', borderRadius: 999,
              padding: '1px 6px', fontSize: 10, fontWeight: 500,
            }}>
              💉 {principal.lastVaccination.vaccineName}
              {principal.lastVaccination.appliedAt && ` · ${formatDate(principal.lastVaccination.appliedAt)}`}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
            ♂ Macho ({machos}) · ♀ Femea ({femeas}) · Nao sexado ({naoSexado})
          </div>
          {investidor ? (
            <div style={{
              fontSize: 11, color: 'var(--text-muted)', marginTop: 2,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <User size={10} /> {investidor}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 600, marginTop: 2 }}>
              sem vinculo no Plantel
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <Chip fundo="var(--bg-secondary)" texto="var(--text)">
          <strong>{disponivel}</strong>
          <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>/{inicial}</span>
        </Chip>
        <Chip fundo="var(--bg-secondary)" texto="var(--text)">{preco(principal.currentPrice)}</Chip>
        {principal.isOverride ? (
          <span style={{ fontSize: 9, fontWeight: 600, color: '#0369a1' }} title="Preco fixado a mao nesse lote">
            proprio
          </span>
        ) : !principal.missingTier && principal.currentPrice !== null ? (
          <span
            title="O preco acompanha a tabela conforme a idade aumenta"
            style={{
              background: '#d1fae5', color: '#047857', borderRadius: 999,
              padding: '1px 6px', fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
            }}
          >
            auto
          </span>
        ) : null}
        {principal.missingTier && (
          <span style={{ fontSize: 9, fontWeight: 600, color: '#d97706' }}>sem tabela</span>
        )}
      </div>
    </li>
  );
}

export default function Vitrine() {
  const {
    investors, birds, ornabirdVitrine, ornabirdVitrineListings,
    eggProfitRate, birdProfitRate,
  } = useApp();
  const [search, setSearch] = useState('');
  const [filterInvestor, setFilterInvestor] = useState('');
  const [aba, setAba] = useState('plantel'); // plantel | revenda
  const [buscaCatalogo, setBuscaCatalogo] = useState('');

  const globals = { eggProfitRate, birdProfitRate };
  const sales = Array.isArray(ornabirdVitrine) ? ornabirdVitrine : [];

  const groupIndex = useMemo(() => buildOrnabirdGroupIndex(birds), [birds]);

  const rows = useMemo(() => sales.map(s => {
    const bird = resolveMirrorBird(s, groupIndex);
    // Dono NA DATA DA VENDA, nao o dono de hoje. Esta tela mostrava o dono
    // atual, e a ordem de pagamento usa a data — depois de uma transferencia
    // de titularidade as duas apontariam para investidores diferentes na mesma
    // venda, e a tela e onde a conferencia acontece.
    const investorId = bird ? resolveBirdInvestorForDate(bird, s.date) : null;
    const investor = investorId ? investors.find(i => i.id === investorId) : null;
    const amount = Number(s.amount) || 0;
    // The investor's cut uses the same rules as every other sale: the animal's
    // own rate when it has one, otherwise the global rate.
    const rate = resolveRateFor(bird, !!s.isEgg, globals);
    return { ...s, bird, investor, amount, rate, profit: investor ? amount * rate : 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [sales, groupIndex, investors, eggProfitRate, birdProfitRate]);

  const filtered = useMemo(() => rows.filter(r => {
    const haystack = `${r.description || ''} ${r.customer || ''}`.toLowerCase();
    const matchSearch = !search.trim() || haystack.includes(search.toLowerCase());
    const matchInvestor = !filterInvestor
      || (filterInvestor === '__none__' ? !r.investor : r.investor?.id === filterInvestor);
    return matchSearch && matchInvestor;
  }), [rows, search, filterInvestor]);

  const totals = useMemo(() => filtered.reduce((acc, r) => {
    acc.amount += r.amount;
    acc.profit += r.profit;
    acc.quantity += parseInt(r.quantity, 10) || 0;
    return acc;
  }, { amount: 0, profit: 0, quantity: 0 }), [filtered]);

  // ===== CATALOGO =====
  const anuncios = useMemo(
    () => mapOrnabirdVitrineListings(ornabirdVitrineListings, birds),
    [ornabirdVitrineListings, birds]
  );

  const nomeInvestidor = (bird) => {
    if (!bird?.investorId) return null;
    return investors.find(i => i.id === bird.investorId)?.name ?? null;
  };

  // Contagem de aves disponiveis por aba, como o seletor do Ornabird mostra.
  const contagemAbas = useMemo(() => {
    let plantel = 0, revenda = 0;
    for (const l of anuncios) {
      if (l.status !== 'AVAILABLE' || l.availableQuantity <= 0) continue;
      if (l.isResale) revenda += l.availableQuantity;
      else plantel += l.availableQuantity;
    }
    return { plantel, revenda };
  }, [anuncios]);

  // Cards por raca. O panorama (Disponiveis / Valor estoque) considera a aba
  // inteira; a busca so filtra a grade — mesma divisao do Ornabird.
  const { cards, resumoCatalogo } = useMemo(() => {
    const querRevenda = aba === 'revenda';
    const daAba = anuncios.filter(l => Boolean(l.isResale) === querRevenda);
    const disponiveis = daAba.filter(l => l.status === 'AVAILABLE');

    const resumo = {
      totalAnimais: disponiveis.reduce((s, l) => s + l.availableQuantity, 0),
      valorEstoque: disponiveis.reduce(
        (s, l) => (l.currentPrice === null ? s : s + l.currentPrice * l.availableQuantity), 0),
      semTabela: disponiveis.filter(l => l.missingTier).length,
    };

    const porGrupo = new Map();
    for (const l of daAba) {
      const chave = l.originGroupId || l.id;
      if (!porGrupo.has(chave)) {
        porGrupo.set(chave, {
          chave,
          // Na revenda o grupo e o lote oculto "Recria · …"; a tela de la
          // mostra o titulo limpo pro comprador ver so a raca.
          titulo: querRevenda
            ? String(l.flockGroupTitle || '').replace(/^Recria\s*·\s*/, '')
            : (l.flockGroupTitle || 'Lote'),
          listings: [],
        });
      }
      porGrupo.get(chave).listings.push(l);
    }

    const q = buscaCatalogo.trim().toLowerCase();
    const visiveis = Array.from(porGrupo.values())
      .map(g => ({
        ...g,
        disponivel: g.listings.filter(l => l.status === 'AVAILABLE')
          .reduce((s, l) => s + l.availableQuantity, 0),
        valor: g.listings.filter(l => l.status === 'AVAILABLE')
          .reduce((s, l) => (l.currentPrice === null ? s : s + l.currentPrice * l.availableQuantity), 0),
        linhas: buildVitrineRows(g.listings),
        bird: g.listings[0]?.bird ?? null,
      }))
      // Card sem nenhuma ave disponivel some, como no Ornabird.
      .filter(g => g.disponivel > 0)
      .filter(g => {
        if (!q) return true;
        const l = g.listings[0] || {};
        return [g.titulo, l.speciesName, l.breedName, l.varietyName]
          .filter(Boolean).join(' ').toLowerCase().includes(q);
      })
      .sort((a, b) => a.titulo.localeCompare(b.titulo));

    return { cards: visiveis, resumoCatalogo: resumo };
  }, [anuncios, aba, buscaCatalogo]);

  const unlinked = rows.filter(r => !r.bird).length;
  const uncertain = rows.filter(r => r.matchedBy === 'title').length;

  if (sales.length === 0 && anuncios.length === 0) {
    return (
      <div className="animate-in">
        <div className="page-header">
          <h2>Vitrine</h2>
          <p>Vitrine espelhada do Ornabird</p>
        </div>
        <div className="empty-state">
          <Store size={48} />
          <h3>Nada sincronizado ainda</h3>
          <p style={{ maxWidth: 460, margin: '0 auto' }}>
            Esta pagina espelha o catalogo e as vendas da Vitrine do Ornabird, ja
            vinculados ao lote de origem. Aparecem aqui depois de sincronizar, com os
            lotes do Plantel vinculados.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
            <OrnabirdSync />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in">
      <div className="page-header">
        <h2>Vitrine</h2>
        <p>Catalogo e vendas espelhados do Ornabird — somente leitura</p>
        <OrnabirdSync />
      </div>

      {/* ===== CATALOGO — clone da tela do Ornabird ===== */}
      {anuncios.length > 0 && (
        <>
          <div style={{
            display: 'flex', gap: 4, background: '#fff', padding: 4,
            border: '1px solid var(--border)', borderRadius: 14,
            width: 'fit-content', marginBottom: 12,
          }}>
            {[
              { key: 'plantel', label: '🏪 Plantel', count: contagemAbas.plantel },
              { key: 'revenda', label: '🛒 Revenda', count: contagemAbas.revenda },
            ].map(t => {
              const ativa = aba === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setAba(t.key)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    border: 'none', cursor: 'pointer', borderRadius: 10,
                    padding: '8px 16px', fontSize: 14, fontWeight: 600,
                    background: ativa ? 'var(--primary)' : 'transparent',
                    color: ativa ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  {t.label}
                  {t.count > 0 && (
                    <span style={{
                      borderRadius: 999, padding: '1px 6px', fontSize: 11, fontWeight: 700,
                      background: ativa ? 'rgba(255,255,255,.25)' : 'var(--bg-secondary)',
                      color: ativa ? '#fff' : 'var(--text-muted)',
                    }}>
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: '8px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  Disponiveis
                </div>
                <div style={{ fontSize: 24, fontWeight: 600 }}>{resumoCatalogo.totalAnimais}</div>
              </div>
              <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: '8px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                  Valor estoque
                </div>
                <div style={{ fontSize: 24, fontWeight: 600 }}>{formatCurrency(resumoCatalogo.valorEstoque)}</div>
              </div>
              <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 }}>
                <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  className="form-input"
                  style={{ paddingLeft: 36 }}
                  placeholder="Buscar raca no catalogo..."
                  value={buscaCatalogo}
                  onChange={e => setBuscaCatalogo(e.target.value)}
                />
              </div>
            </div>
          </div>

          {resumoCatalogo.semTabela > 0 && (
            <div style={{
              padding: '10px 14px', marginBottom: 16, borderRadius: 12,
              background: '#fffbeb', border: '1px solid #fde68a',
              color: '#92400e', fontSize: 13,
            }}>
              Existem {resumoCatalogo.semTabela} anuncio(s) sem preco cadastrado para a idade
              atual. A tabela de precos e preenchida no Ornabird.
            </div>
          )}

          {cards.length === 0 ? (
            <div className="card" style={{ padding: 24, marginBottom: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Nenhuma ave disponivel nesta aba.
            </div>
          ) : (
            <div className="tray-grid" style={{ marginBottom: 24 }}>
              {cards.map(card => (
                <div key={card.chave} style={{
                  border: '1px solid var(--border)', borderRadius: 16,
                  background: '#fff', padding: 16,
                  display: 'flex', flexDirection: 'column', gap: 12,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <h3 style={{
                      margin: 0, fontSize: 16, fontWeight: 600, minWidth: 0,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {card.titulo}
                    </h3>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '4px 8px', textAlign: 'right' }}>
                        <div style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Disp.</div>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{card.disponivel}</div>
                      </div>
                      <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '4px 8px', textAlign: 'right' }}>
                        <div style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Valor</div>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{formatCurrency(card.valor)}</div>
                      </div>
                    </div>
                  </div>
                  <ul style={{ display: 'grid', gap: 8, margin: 0, padding: 0 }}>
                    {card.linhas.map((linha, i) => (
                      <LinhaAnuncio
                        key={linha.tipo === 'unica' ? linha.listing.id : linha.chave || i}
                        linha={linha}
                        tituloCard={card.titulo}
                        nomeInvestidor={nomeInvestidor}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ===== VENDAS — o que o Invest acrescenta: o lucro por investidor ===== */}
      <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Vendas espelhadas</h3>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon purple"><Store size={20} /></div>
          <div className="stat-label">Vendas</div>
          <div className="stat-value">{filtered.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon green"><DollarSign size={20} /></div>
          <div className="stat-label">Valor Total</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>{formatCurrency(totals.amount)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon blue"><TrendingUp size={20} /></div>
          <div className="stat-label">Lucro dos Investidores</div>
          <div className="stat-value" style={{ color: 'var(--info)' }}>{formatCurrency(totals.profit)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon" style={{ background: unlinked > 0 ? '#fef3c7' : '#d1fae5', color: unlinked > 0 ? '#d97706' : '#059669' }}>
            <Link2 size={20} />
          </div>
          <div className="stat-label">Sem Vinculo</div>
          <div className="stat-value" style={{ color: unlinked > 0 ? 'var(--warning)' : 'var(--success)' }}>{unlinked}</div>
        </div>
      </div>

      {unlinked > 0 && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px',
          marginBottom: 16, background: '#fef3c7', border: '1px solid #f59e0b',
          borderRadius: 8, color: '#92400e', fontSize: 13,
        }}>
          <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong>{unlinked} venda(s) sem investidor.</strong>
            <div style={{ marginTop: 2 }}>
              Essas vendas nao geram lucro para ninguem enquanto o lote de origem no
              Ornabird nao for vinculado a uma linha do Plantel.
            </div>
          </div>
        </div>
      )}

      <div className="filter-bar">
        <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="form-input"
            style={{ paddingLeft: 36 }}
            placeholder="Buscar anuncio ou cliente..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="form-input"
          style={{ width: 'auto', minWidth: 200 }}
          value={filterInvestor}
          onChange={e => setFilterInvestor(e.target.value)}
        >
          <option value="">Todos os investidores</option>
          {investors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          <option value="__none__">— Sem vinculo —</option>
        </select>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Anuncio</th>
                <th>Investidor</th>
                <th>Tipo</th>
                <th>Qtd</th>
                <th>Valor</th>
                <th>Taxa</th>
                <th>Lucro</th>
                <th>Cliente</th>
              </tr>
            </thead>
            <tbody>
              {[...filtered]
                .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                .map(r => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 13 }}>{formatDate(r.date)}</td>
                    <td style={{ maxWidth: 220 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {r.matchedBy === 'title' && (
                          <span
                            className="badge"
                            style={{ background: '#fef3c7', color: '#d97706', flexShrink: 0, fontSize: 10 }}
                            title="Vinculo deduzido pelo titulo no Ornabird — confira"
                          >
                            ?
                          </span>
                        )}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.description || '-'}
                        </span>
                      </div>
                    </td>
                    <td>
                      {r.investor ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div className="investor-avatar" style={{ width: 22, height: 22, fontSize: 9, borderRadius: 6 }}>
                            {getInitials(r.investor.name)}
                          </div>
                          <span style={{ fontSize: 13 }}>{r.investor.name}</span>
                        </div>
                      ) : (
                        <span className="badge" style={{ background: '#fef3c7', color: '#d97706' }}>Sem vinculo</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${r.isEgg ? 'badge-purple' : 'badge-blue'}`}>
                        {r.isEgg ? 'Ovo' : 'Ave'}
                      </span>
                    </td>
                    <td>{parseInt(r.quantity, 10) || 1}</td>
                    <td style={{ fontWeight: 600 }}>{formatCurrency(r.amount)}</td>
                    <td style={{ fontSize: 13 }}>{formatPercent(r.rate)}</td>
                    <td style={{ color: r.investor ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>
                      {r.investor ? formatCurrency(r.profit) : '-'}
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{r.customer || '-'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          Dados espelhados do Ornabird. O lucro usa a taxa propria do animal quando houver,
          senao a taxa geral.
          {uncertain > 0 && ` ${uncertain} venda(s) marcada(s) com "?" tiveram o lote deduzido pelo titulo no Ornabird — vale conferir.`}
        </div>
      </div>
    </div>
  );
}
