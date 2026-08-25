// O AVISO DE QUE UMA TELA PAROU DE RECEBER DADOS NOVOS.
//
// POR QUE ISTO EXISTE
// -------------------
// Os sete listeners de espelho tratavam erro assim:
//
//     }, (error) => devError('Ornabird trays listen error:', error));
//
// `devError` some em producao. Do lado de fora nao acontecia NADA: a tela
// parava de receber dado novo e nao dizia nada, entao o numero de ontem
// continuava ali parecendo o de hoje.
//
// Num app que paga gente por coleta de ovos, numero velho sem aviso e o defeito
// mais caro que existe — ele e indistinguivel de estar certo. Este projeto ja
// consertou cinco falhas silenciosas; esta e da mesma familia.
//
// POR QUE E UM COMPONENTE SEPARADO
// --------------------------------
// Para poder ser testado. Enquanto o JSX vivia solto dentro do Layout do
// App.jsx, o unico jeito de testar era reescrever o mesmo markup no teste — e
// um teste que exercita a propria copia nao prova nada sobre o que roda em
// producao.

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext';

// O nome que o dono ve no menu, nao o nome interno da colecao. Ele nunca leu
// "anuncios" em lugar nenhum da tela; ele leu "Vitrine".
const NOME_DA_TELA = {
  bandejas: 'Prateleira',
  vitrine: 'Vendas',
  coletas: 'Coleta de Ovos',
  chocadeiras: 'Chocadeiras',
  anuncios: 'Vitrine',
  ordens: 'Ordens de Pagamento',
};

export default function AvisoEspelhosCaidos() {
  const { espelhosComFalha } = useApp();
  const caidos = Object.keys(espelhosComFalha || {});
  if (caidos.length === 0) return null;

  return (
    <div
      role="alert"
      data-testid="aviso-espelhos"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '12px 16px', marginBottom: 16,
        background: '#fff3cd', border: '1px solid #ffc107',
        borderRadius: 8, color: '#856404', fontSize: 13,
      }}
    >
      <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1 }}>
        <strong>
          {caidos.length === 1
            ? 'Uma tela parou de receber dados novos.'
            : `${caidos.length} telas pararam de receber dados novos.`}
        </strong>
        {/* Dizer QUAIS. Sem isso o dono nao sabe de qual numero desconfiar, e
            passa a desconfiar de todos — que e pior do que nao avisar. */}
        <div style={{ marginTop: 2 }}>
          {caidos.map(n => NOME_DA_TELA[n] || n).join(', ')}
          {' — o que esta na tela pode estar desatualizado. '}
          Recarregue a pagina; se continuar, avise o administrador.
        </div>
      </div>
    </div>
  );
}
