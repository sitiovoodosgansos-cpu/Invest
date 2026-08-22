import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  // `formatDate` e usada duas vezes em LinhaAnuncio — data de insercao e data
  // da vacina. Ela saiu desta lista junto com a tabela de vendas, quando a
  // pagina foi dividida, mas as duas linhas do card ficaram. O resultado foi
  // uma pagina que so caia quando um anuncio trazia `createdAt`: nenhum erro
  // de build, nenhum aviso, e a tela inteira em branco no primeiro anuncio
  // desses que chegou do Ornabird.
  formatCurrency, formatDate, formatAgeMonths, buildVitrineRows,
  mapOrnabirdVitrineListings,
} from '../utils/helpers';
import { Store, Search, User, ImageOff } from 'lucide-react';
import OrnabirdSync from '../components/OrnabirdSync';

// O CATALOGO da Vitrine do Ornabird, espelhado — clone da tela de la: um card
// por raca, com as linhas de anuncio agrupadas do mesmo jeito, preco que sobe
// com a idade, composicao por sexo e foto. Ver o mesmo anuncio com aparencia
// diferente em cada sistema faz duvidar de qual esta certo.
//
// As VENDAS ficavam embaixo desta tela e agora tem pagina propria (Vendas
// Ornabird). Sao perguntas diferentes: aqui e "o que eu tenho pra vender", la
// e "o que ja vendi e de quem e o dinheiro" — e empilhadas, a segunda ficava a
// uma rolagem inteira de distancia num dia com muitos anuncios.
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
  const { investors, birds, ornabirdVitrineListings } = useApp();
  const [aba, setAba] = useState('plantel'); // plantel | revenda
  const [buscaCatalogo, setBuscaCatalogo] = useState('');

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

  if (anuncios.length === 0) {
    return (
      <div className="animate-in">
        <div className="page-header">
          <h2>Vitrine</h2>
          <p>Catalogo espelhado do Ornabird</p>
        </div>
        <div className="empty-state">
          <Store size={48} />
          <h3>Nada sincronizado ainda</h3>
          <p style={{ maxWidth: 460, margin: '0 auto' }}>
            Esta pagina espelha o catalogo da Vitrine do Ornabird, ja vinculado ao lote
            de origem. Os anuncios aparecem aqui depois de sincronizar, com os lotes do
            Plantel vinculados. As vendas ficam na pagina Vendas Ornabird.
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
        <p>Catalogo espelhado do Ornabird — somente leitura</p>
        <OrnabirdSync />
      </div>

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
  </div>
  );
}
