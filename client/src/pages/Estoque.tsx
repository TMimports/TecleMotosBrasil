import { useEffect, useState, useMemo, Fragment } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLojaContext } from '../contexts/LojaContext';
import { api } from '../services/api';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { SectionHeader } from '../components/ui/SectionHeader';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Loja { id: number; nomeFantasia: string; razaoSocial: string; cnpj: string; endereco?: string | null; }

interface EmpresaConsolidada {
  lojaId: number; cnpj: string; razaoSocial: string; nomeFantasia: string;
  grupoId: number; grupoNome: string;
  totalMotos: number; totalPecas: number; totalItens: number;
  valorTotalCusto: number; valorTotalVenda: number; alertas: number;
  unidades: number; pedidosPendentes: number;
}
interface ConsolidadoResponse {
  totais: { totalEmpresas: number; totalMotos: number; totalPecas: number; valorTotalCusto: number; valorTotalVenda: number; totalAlertas: number; };
  empresas: EmpresaConsolidada[];
}

interface ItemGerencial {
  id: number; produtoId: number; nome: string; tipo: string; codigo: string;
  quantidade: number; estoqueMinimo: number; estoqueMaximo: number;
  custoMedio: number; precoVenda: number;
  precoVendaLoja: number | null; precoVendaBase: number;
  valorTotalCusto: number; valorTotalPreco: number;
  alerta: boolean; semEstoque: boolean;
}
interface ItemUnitario {
  id: number; produtoId: number; modeloNome: string; chassi: string;
  codigoMotor?: string; cor?: string; ano?: number; status: string; createdAt: string;
}
interface LogEstoque {
  id: number; tipo: string; quantidade: number; quantidadeAnterior: number; quantidadeNova: number;
  createdAt: string; origemId?: number;
  produto?: { nome: string; tipo: string; };
  usuario?: { nome: string; };
}
interface EmpresaDetalhes {
  empresa: { id: number; cnpj: string; razaoSocial: string; nomeFantasia: string; grupoNome: string; };
  totalizadores: {
    totalMotos: number; totalPecas: number; totalItens: number;
    valorTotalCusto: number; valorTotalVenda: number;
    alertasBaixoEstoque: number; semGiro: number; pedidosPendentes: number;
    unidadesTotal: number; unidadesEmEstoque: number; unidadesVendidas: number;
  };
  gerencial: ItemGerencial[];
  unitaria: ItemUnitario[];
  logsRecentes: LogEstoque[];
}

interface Transferencia {
  id: number;
  status: 'SOLICITADA' | 'APROVADA' | 'REJEITADA' | 'CONCLUIDA';
  quantidade: number;
  createdAt: string;
  lojaOrigem: { id: number; nomeFantasia: string; };
  lojaDestino: { id: number; nomeFantasia: string; };
  produto: { id: number; nome: string; tipo: string; };
  solicitadoPorUser: { id: number; nome: string; };
  aprovadoPorUser?: { id: number; nome: string; } | null;
  unidadeFisica?: { id: number; chassi: string | null; cor: string | null; ano: number | null; codigoMotor: string | null; } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (s: string) => new Date(s).toLocaleDateString('pt-BR');

const STATUS_UNIDADE: Record<string, string> = {
  ESTOQUE: 'bg-green-500/20 text-green-400',
  VENDIDA: 'bg-zinc-500/20 text-zinc-400',
  RESERVADA: 'bg-yellow-500/20 text-yellow-400',
  TRANSFERIDA: 'bg-blue-500/20 text-blue-400',
};
const STATUS_TRANSFERENCIA: Record<string, { label: string; cls: string }> = {
  SOLICITADA: { label: 'Aguardando', cls: 'bg-yellow-500/20 text-yellow-400' },
  APROVADA:   { label: 'Aprovada',   cls: 'bg-green-500/20 text-green-400' },
  REJEITADA:  { label: 'Rejeitada',  cls: 'bg-red-500/20 text-red-400' },
  CONCLUIDA:  { label: 'Concluída',  cls: 'bg-blue-500/20 text-blue-400' },
};

const LOJA_IMPORTACAO_ID = 4;

// ─── KpiBlock ─────────────────────────────────────────────────────────────────

function KpiBlock({ label, value, sub, color }: { label: string; value: React.ReactNode; sub?: string; color?: string }) {
  return (
    <Card className="p-3 sm:p-4 min-w-0">
      <p className="text-xs text-zinc-400 mb-1 truncate">{label}</p>
      <p className={`text-base sm:text-xl font-bold truncate ${color || 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-0.5 truncate">{sub}</p>}
    </Card>
  );
}

// ─── BuscadorRede ─────────────────────────────────────────────────────────────

interface ResultadoBusca {
  produto: { id: number; nome: string; tipo: string; codigo: string; preco: number; };
  lojas: { lojaId: number; nomeFantasia: string; endereco?: string | null; quantidade: number; }[];
}

function BuscadorRede({ minhaLojaId, lojas, onVerLoja }: {
  minhaLojaId: number | null;
  lojas: Loja[];
  onVerLoja: (lojaId: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<ResultadoBusca[]>([]);
  const [loading, setLoading] = useState(false);
  const [buscou, setBuscou] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [expandedDestinoId, setExpandedDestinoId] = useState<number | ''>('');
  const [expandedQtd, setExpandedQtd] = useState(1);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [expandedErro, setExpandedErro] = useState('');
  const [expandedSucesso, setExpandedSucesso] = useState(false);

  const isAdmin = minhaLojaId === null;

  useEffect(() => {
    if (query.length < 2) { setResultados([]); setBuscou(false); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      setBuscou(false);
      try {
        const r = await api.get<ResultadoBusca[]>(`/estoque/buscar-rede?q=${encodeURIComponent(query)}`);
        const sorted = r.map(item => ({
          ...item,
          lojas: [...item.lojas].sort((a, b) => (LOJA_ORDER[a.lojaId] ?? 99) - (LOJA_ORDER[b.lojaId] ?? 99))
        }));
        setResultados(sorted);
        setBuscou(true);
      } catch {
        setResultados([]);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [query]);

  function toggleExpand(key: string) {
    if (expandedKey === key) {
      setExpandedKey(null);
    } else {
      setExpandedKey(key);
      setExpandedDestinoId('');
      setExpandedQtd(1);
      setExpandedErro('');
      setExpandedSucesso(false);
    }
  }

  async function executarTransfer(produtoId: number, lojaOrigemId: number) {
    const destino = isAdmin ? Number(expandedDestinoId) : minhaLojaId;
    if (!destino) return;
    setExpandedLoading(true);
    setExpandedErro('');
    try {
      await api.post('/transferencias', {
        produtoId,
        lojaOrigemId,
        lojaDestinoId: destino,
        quantidade: expandedQtd,
      });
      setExpandedSucesso(true);
      setTimeout(() => { setExpandedKey(null); setExpandedSucesso(false); }, 1500);
    } catch (e: any) {
      setExpandedErro(e?.message || 'Erro ao solicitar transferência');
    } finally {
      setExpandedLoading(false);
    }
  }

  const TIPO_BADGE: Record<string, string> = {
    MOTO: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    PECA: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    SERVICO: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  };

  return (
    <div className="space-y-4">
      {/* Campo de busca */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-lg select-none">🔍</span>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Busque por nome do produto ou código (ex: Sunra, FR100, bateria...)"
          className="w-full bg-[#18181b] border border-[#27272a] text-white rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-orange-500 placeholder-zinc-500"
          autoFocus
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 text-xs animate-pulse">Buscando...</span>
        )}
      </div>

      {/* Instrução inicial */}
      {!buscou && !loading && (
        <div className="text-center py-10 text-zinc-500">
          <p className="text-3xl mb-3">🔎</p>
          <p className="text-sm">Digite ao menos 2 caracteres para buscar em todas as lojas da rede</p>
          <p className="text-xs mt-1 text-zinc-600">Resultados ordenados da loja mais próxima à mais distante</p>
        </div>
      )}

      {/* Sem resultados */}
      {buscou && resultados.length === 0 && (
        <div className="text-center py-10 text-zinc-500">
          <p className="text-3xl mb-3">📦</p>
          <p className="text-sm">Nenhum produto encontrado com "{query}" em estoque na rede</p>
        </div>
      )}

      {/* Resultados */}
      {resultados.map(item => (
        <Card key={item.produto.id} className="overflow-hidden">
          {/* Header do produto */}
          <div className="px-4 py-3 bg-zinc-900 border-b border-[#27272a] flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white font-semibold text-sm">{item.produto.nome}</span>
                <span className={`text-xs px-2 py-0.5 rounded border font-medium ${TIPO_BADGE[item.produto.tipo] || 'bg-zinc-700 text-zinc-300'}`}>
                  {item.produto.tipo}
                </span>
              </div>
              <p className="text-xs text-zinc-500 font-mono mt-0.5">Cód: {item.produto.codigo}</p>
            </div>
            <p className="text-green-400 font-bold text-sm whitespace-nowrap">
              {Number(item.produto.preco).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </p>
          </div>

          {/* Lojas disponíveis */}
          <div className="divide-y divide-[#27272a]">
            {item.lojas.map((loja, idx) => {
              const isMinhaLoja = loja.lojaId === minhaLojaId;
              const isCentral = loja.lojaId === LOJA_IMPORTACAO_ID;
              const podeSolicitar = isAdmin ? true : (!isMinhaLoja);
              const rowKey = `${item.produto.id}-${loja.lojaId}`;
              const isExpanded = expandedKey === rowKey;
              const destinoNome = isAdmin
                ? lojas.find(l => l.id === Number(expandedDestinoId))?.nomeFantasia || null
                : minhaLojaId ? lojas.find(l => l.id === minhaLojaId)?.nomeFantasia || 'Minha Loja' : null;
              return (
                <div key={loja.lojaId}>
                  <div className="px-3 sm:px-4 py-3 flex items-center gap-2 sm:gap-3">
                    {/* Rank de proximidade */}
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      idx === 0 ? 'bg-orange-500 text-white' : 'bg-zinc-700 text-zinc-300'
                    }`}>
                      {idx + 1}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-white text-sm font-medium">{loja.nomeFantasia}</span>
                        {isMinhaLoja && <span className="text-xs text-green-400">(sua loja)</span>}
                        {isCentral && <span className="text-xs text-purple-400">(central)</span>}
                      </div>
                      {loja.endereco && (
                        <p className="text-xs text-zinc-500 truncate mt-0.5 hidden sm:block">{loja.endereco}</p>
                      )}
                    </div>

                    {/* Quantidade */}
                    <div className="text-center flex-shrink-0">
                      <p className={`text-base font-bold ${loja.quantidade > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {loja.quantidade}
                      </p>
                      <p className="text-xs text-zinc-500 hidden sm:block">em estoque</p>
                    </div>

                    {/* Ações */}
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => onVerLoja(loja.lojaId)}
                        className="text-xs text-zinc-400 hover:text-white border border-[#27272a] hover:border-zinc-500 px-2 py-1.5 sm:px-2.5 rounded-lg transition-colors"
                      >
                        Ver
                      </button>
                      {podeSolicitar && (
                        <button
                          onClick={() => toggleExpand(rowKey)}
                          className={`text-xs px-2 py-1.5 sm:px-2.5 rounded-lg font-medium transition-colors whitespace-nowrap border ${
                            isExpanded
                              ? 'bg-zinc-700 text-zinc-300 border-zinc-600'
                              : 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 border-orange-500/30'
                          }`}
                        >
                          {isExpanded ? '✕ Fechar' : isAdmin ? '↔ Mover' : 'Solicitar'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Painel inline de transferência */}
                  {isExpanded && (
                    <div className="mx-3 sm:mx-4 mb-3 bg-zinc-900 border border-[#27272a] rounded-xl p-4">
                      {expandedSucesso ? (
                        <div className="flex items-center gap-2 text-green-400 font-medium text-sm py-1">
                          <span className="text-lg">✓</span> Solicitação criada com sucesso!
                        </div>
                      ) : (
                        <>
                          {/* Origem → Destino */}
                          <div className="flex items-center gap-2 mb-4 text-sm flex-wrap">
                            <div className="flex-1 min-w-[120px]">
                              <p className="text-xs text-zinc-500 mb-0.5">De</p>
                              <p className="text-orange-400 font-medium">{loja.nomeFantasia}</p>
                              <p className="text-zinc-500 text-xs">{loja.quantidade} em estoque</p>
                            </div>
                            <span className="text-zinc-500 text-xl">→</span>
                            <div className="flex-1 min-w-[120px]">
                              <p className="text-xs text-zinc-500 mb-0.5">Para</p>
                              {isAdmin ? (
                                <select
                                  value={expandedDestinoId}
                                  onChange={e => setExpandedDestinoId(e.target.value ? Number(e.target.value) : '')}
                                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-orange-500"
                                >
                                  <option value="">Selecione a loja...</option>
                                  {lojas
                                    .filter(l => l.id !== loja.lojaId)
                                    .map(l => (
                                      <option key={l.id} value={l.id} className="bg-zinc-800">{l.nomeFantasia}</option>
                                    ))}
                                </select>
                              ) : (
                                <p className="text-green-400 font-medium">{destinoNome || 'Minha Loja'}</p>
                              )}
                            </div>
                          </div>

                          {/* Quantidade */}
                          {item.produto.tipo === 'MOTO' ? (
                            <div className="mb-3">
                              <p className="text-xs text-zinc-400 mb-2">Motos são transferidas por chassi. Selecione a unidade desejada:</p>
                              <button
                                onClick={() => onVerLoja(loja.lojaId)}
                                className="flex items-center gap-2 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                              >
                                📋 Ver Unidades Disponíveis nesta loja
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3 mb-4">
                              <p className="text-xs text-zinc-400">Qtd:</p>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setExpandedQtd(q => Math.max(1, q - 1))}
                                  className="w-7 h-7 rounded-lg bg-zinc-700 text-white font-bold hover:bg-zinc-600 text-sm"
                                >−</button>
                                <span className="text-white font-bold w-8 text-center">{expandedQtd}</span>
                                <button
                                  onClick={() => setExpandedQtd(q => Math.min(loja.quantidade, q + 1))}
                                  className="w-7 h-7 rounded-lg bg-zinc-700 text-white font-bold hover:bg-zinc-600 text-sm"
                                >+</button>
                              </div>
                              <p className="text-xs text-zinc-500">máx. {loja.quantidade}</p>
                            </div>
                          )}

                          {expandedErro && <p className="text-red-400 text-xs mb-3">{expandedErro}</p>}

                          {item.produto.tipo !== 'MOTO' && (
                            <button
                              onClick={() => executarTransfer(item.produto.id, loja.lojaId)}
                              disabled={expandedLoading || (isAdmin && !expandedDestinoId)}
                              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded-lg transition-colors"
                            >
                              {expandedLoading ? 'Enviando...' : isAdmin ? 'Criar Solicitação' : 'Confirmar Solicitação'}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ))}

    </div>
  );
}

// ─── TabGerencial ─────────────────────────────────────────────────────────────

function TabGerencial({ itens, busca, lojas, lojaId, minhaLojaId, onTransferido, onVerUnitaria }: {
  itens: ItemGerencial[];
  busca: string;
  lojas: Loja[];
  lojaId: number;
  minhaLojaId: number | null;
  onTransferido?: () => void;
  onVerUnitaria?: (nome: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedDestinoId, setExpandedDestinoId] = useState<number | ''>('');
  const [expandedQtd, setExpandedQtd] = useState(1);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [expandedErro, setExpandedErro] = useState('');
  const [expandedSucesso, setExpandedSucesso] = useState(false);

  const { user: userTabG } = useAuth();
  const verCustos = ['ADMIN_GERAL', 'ADMIN_FINANCEIRO', 'ADMIN_REDE'].includes(userTabG?.role || '');
  const isAdmin = minhaLojaId === null;
  const podeTransferir = isAdmin || lojaId === minhaLojaId;
  const lojaAtualNome = lojas.find(l => l.id === lojaId)?.nomeFantasia || 'Esta Loja';

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase();
    return q ? itens.filter(i => i.nome.toLowerCase().includes(q) || i.codigo.toLowerCase().includes(q)) : itens;
  }, [itens, busca]);

  function toggleExpand(produtoId: number, maxQtd: number) {
    if (expandedId === produtoId) {
      setExpandedId(null);
    } else {
      setExpandedId(produtoId);
      setExpandedDestinoId('');
      setExpandedQtd(Math.max(1, Math.min(1, maxQtd)));
      setExpandedErro('');
      setExpandedSucesso(false);
    }
  }

  async function executarTransfer(produtoId: number, _tipo: string) {
    if (!expandedDestinoId) return;
    setExpandedLoading(true);
    setExpandedErro('');
    try {
      await api.post('/transferencias', {
        produtoId,
        lojaOrigemId: lojaId,
        lojaDestinoId: Number(expandedDestinoId),
        quantidade: expandedQtd,
      });
      setExpandedSucesso(true);
      setTimeout(() => { setExpandedId(null); setExpandedSucesso(false); onTransferido?.(); }, 1500);
    } catch (e: any) {
      setExpandedErro(e?.message || 'Erro ao criar transferência');
    } finally {
      setExpandedLoading(false);
    }
  }

  const motos = filtrados.filter(i => i.tipo === 'MOTO');
  const pecas = filtrados.filter(i => i.tipo === 'PECA');
  const colSpan = podeTransferir ? 8 : 7;

  function GrupoTipo({ titulo, lista }: { titulo: string; lista: ItemGerencial[] }) {
    if (!lista.length) return null;
    return (
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-zinc-400 mb-3 uppercase tracking-wide">{titulo}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-[#27272a] text-zinc-400 text-xs">
                <th className="text-left p-3 font-medium">Produto</th>
                <th className="text-right p-3 font-medium">Qtd</th>
                {verCustos && <th className="text-right p-3 font-medium hidden md:table-cell">Custo Médio</th>}
                <th className="text-right p-3 font-medium hidden md:table-cell">Preço Venda</th>
                {verCustos && <th className="text-right p-3 font-medium hidden lg:table-cell">Valor (CM)</th>}
                <th className="text-right p-3 font-medium hidden lg:table-cell">Valor (PV)</th>
                <th className="text-left p-3 font-medium">Status</th>
                {podeTransferir && <th className="text-center p-3 font-medium">Ação</th>}
              </tr>
            </thead>
            <tbody>
              {lista.map(it => {
                const isExp = expandedId === it.produtoId;
                return (
                  <Fragment key={it.id}>
                    <tr className={`border-b border-[#27272a] hover:bg-zinc-800/30 transition-colors ${isExp ? 'bg-zinc-800/20' : ''}`}>
                      <td className="p-3">
                        <p className="text-white font-medium">{it.nome}</p>
                        <p className="text-xs text-zinc-500 font-mono">{it.codigo}</p>
                      </td>
                      <td className="p-3 text-right">
                        <span className={`font-bold text-base ${it.semEstoque ? 'text-red-400' : it.alerta ? 'text-yellow-400' : 'text-green-400'}`}>
                          {it.quantidade}
                        </span>
                        <p className="text-xs text-zinc-500">mín {it.estoqueMinimo}</p>
                      </td>
                      {verCustos && <td className="p-3 text-right text-zinc-200 hidden md:table-cell">{fmtBRL(it.custoMedio)}</td>}
                      <td className="p-3 text-right hidden md:table-cell">
                        <span className="text-zinc-200">{fmtBRL(it.precoVenda)}</span>
                      </td>
                      {verCustos && <td className="p-3 text-right font-medium text-zinc-100 hidden lg:table-cell">{fmtBRL(it.valorTotalCusto)}</td>}
                      <td className="p-3 text-right font-medium text-orange-400 hidden lg:table-cell">{fmtBRL(it.valorTotalPreco)}</td>
                      <td className="p-3">
                        {it.semEstoque
                          ? <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded border border-red-500/30">Zerado</span>
                          : it.alerta
                            ? <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded border border-yellow-500/30">Alerta</span>
                            : <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded border border-green-500/30">OK</span>
                        }
                      </td>
                      {podeTransferir && (
                        <td className="p-3 text-center">
                          {it.tipo === 'MOTO' ? (
                            <button
                              onClick={() => onVerUnitaria?.(it.nome)}
                              disabled={it.quantidade === 0}
                              className={`text-xs px-2.5 py-1.5 rounded-lg font-medium border transition-colors whitespace-nowrap ${
                                it.quantidade === 0
                                  ? 'opacity-30 cursor-not-allowed bg-zinc-800 text-zinc-500 border-zinc-700'
                                  : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border-blue-500/30'
                              }`}
                            >
                              📋 Ver Unidades
                            </button>
                          ) : (
                            <button
                              onClick={() => toggleExpand(it.produtoId, it.quantidade)}
                              className={`text-xs px-2.5 py-1.5 rounded-lg font-medium border transition-colors whitespace-nowrap ${
                                isExp
                                  ? 'bg-zinc-700 text-zinc-300 border-zinc-600'
                                  : it.quantidade === 0
                                    ? 'opacity-40 cursor-not-allowed bg-zinc-800 text-zinc-500 border-zinc-700'
                                    : 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 border-orange-500/30'
                              }`}
                              disabled={it.quantidade === 0 && !isExp}
                            >
                              {isExp ? '✕' : '↔'}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>

                    {/* Painel inline de transferência */}
                    {isExp && (
                      <tr key={`exp-${it.id}`} className="border-b border-[#27272a]">
                        <td colSpan={colSpan} className="px-4 py-3 bg-zinc-900/60">
                          {expandedSucesso ? (
                            <div className="flex items-center gap-2 text-green-400 font-medium text-sm py-1">
                              <span className="text-lg">✓</span> Solicitação criada com sucesso!
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-end gap-4">
                              {/* De → Para */}
                              <div className="flex items-center gap-3 flex-wrap">
                                <div>
                                  <p className="text-xs text-zinc-500 mb-0.5">De</p>
                                  <p className="text-orange-400 font-medium text-sm">{lojaAtualNome}</p>
                                  <p className="text-zinc-500 text-xs">{it.quantidade} em estoque</p>
                                </div>
                                <span className="text-zinc-500 text-xl mb-1">→</span>
                                <div>
                                  <p className="text-xs text-zinc-500 mb-0.5">Para</p>
                                  <select
                                    value={expandedDestinoId}
                                    onChange={e => setExpandedDestinoId(e.target.value ? Number(e.target.value) : '')}
                                    className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-orange-500 min-w-[160px]"
                                  >
                                    <option value="">Selecione a loja...</option>
                                    {lojas.filter(l => l.id !== lojaId).map(l => (
                                      <option key={l.id} value={l.id} className="bg-zinc-800">{l.nomeFantasia}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              {/* Quantidade */}
                              <div>
                                <p className="text-xs text-zinc-500 mb-1">Quantidade</p>
                                <div className="flex items-center gap-2">
                                  <button onClick={() => setExpandedQtd(q => Math.max(1, q - 1))} className="w-7 h-7 rounded-lg bg-zinc-700 text-white font-bold hover:bg-zinc-600 text-sm">−</button>
                                  <span className="text-white font-bold w-8 text-center">{expandedQtd}</span>
                                  <button onClick={() => setExpandedQtd(q => Math.min(it.quantidade, q + 1))} className="w-7 h-7 rounded-lg bg-zinc-700 text-white font-bold hover:bg-zinc-600 text-sm">+</button>
                                  <span className="text-zinc-500 text-xs">máx {it.quantidade}</span>
                                </div>
                              </div>

                              {/* Confirmar */}
                              <div className="flex flex-col gap-1">
                                {expandedErro && <p className="text-red-400 text-xs">{expandedErro}</p>}
                                <button
                                  onClick={() => executarTransfer(it.produtoId, it.tipo)}
                                  disabled={expandedLoading || !expandedDestinoId}
                                  className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                                >
                                  {expandedLoading ? 'Enviando...' : 'Confirmar Transferência'}
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <GrupoTipo titulo="Motos & Scooters" lista={motos} />
      <GrupoTipo titulo="Peças & Acessórios" lista={pecas} />
      {filtrados.length === 0 && (
        <div className="text-center py-12 text-zinc-500">Nenhum produto encontrado</div>
      )}
    </div>
  );
}

// ─── TabUnitaria ──────────────────────────────────────────────────────────────

function TabUnitaria({
  itens, busca, lojas, lojaId, minhaLojaId, onTransferido
}: {
  itens: ItemUnitario[];
  busca: string;
  lojas: Loja[];
  lojaId: number;
  minhaLojaId: number | null;
  onTransferido?: () => void;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedDestinoId, setExpandedDestinoId] = useState<number | ''>('');
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [expandedErro, setExpandedErro] = useState('');
  const [expandedSucesso, setExpandedSucesso] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [loteDestino, setLoteDestino] = useState<number | ''>('');
  const [loteLoading, setLoteLoading] = useState(false);
  const [loteErro, setLoteErro] = useState('');
  const [loteSucesso, setLoteSucesso] = useState(false);

  const isAdmin = minhaLojaId === null;
  const isOutraLoja = !isAdmin && lojaId !== minhaLojaId;
  const lojaAtualNome = lojas.find(l => l.id === lojaId)?.nomeFantasia || 'Esta Loja';
  const minhaLojaNome = lojas.find(l => l.id === minhaLojaId)?.nomeFantasia || 'Minha Loja';

  function toggleSelecionado(id: number) {
    setSelecionados(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleTodos(lista: ItemUnitario[]) {
    const disponíveis = lista.filter(u => u.status === 'ESTOQUE');
    const todosIds = disponíveis.map(u => u.id);
    const todosSelecionados = todosIds.every(id => selecionados.has(id));
    setSelecionados(prev => {
      const next = new Set(prev);
      if (todosSelecionados) {
        todosIds.forEach(id => next.delete(id));
      } else {
        todosIds.forEach(id => next.add(id));
      }
      return next;
    });
  }

  async function executarLote(itens: ItemUnitario[]) {
    if (!loteDestino || selecionados.size === 0) return;
    setLoteLoading(true);
    setLoteErro('');
    try {
      const unidadesSelecionadas = itens.filter(u => selecionados.has(u.id));
      await Promise.all(unidadesSelecionadas.map(u =>
        api.post('/transferencias', {
          produtoId: u.produtoId,
          unidadeFisicaId: u.id,
          lojaOrigemId: lojaId,
          lojaDestinoId: Number(loteDestino),
          quantidade: 1,
        })
      ));
      setLoteSucesso(true);
      setSelecionados(new Set());
      setLoteDestino('');
      setTimeout(() => { setLoteSucesso(false); onTransferido?.(); }, 1800);
    } catch (e: any) {
      setLoteErro(e?.message || 'Erro ao solicitar transferências');
    } finally {
      setLoteLoading(false);
    }
  }

  const filtrados = useMemo(() => {
    const q = busca.toLowerCase();
    return q ? itens.filter(i =>
      i.modeloNome.toLowerCase().includes(q) || i.chassi.toLowerCase().includes(q) ||
      (i.cor?.toLowerCase().includes(q)) || (i.codigoMotor?.toLowerCase().includes(q))
    ) : itens;
  }, [itens, busca]);

  // Quando vendo outra loja: mostrar só disponíveis; na própria: mostrar tudo
  const lista = isOutraLoja ? filtrados.filter(u => u.status === 'ESTOQUE') : filtrados;

  function toggleExpand(id: number, destinoFixo?: number) {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      setExpandedDestinoId(destinoFixo ?? '');
      setExpandedErro('');
      setExpandedSucesso(false);
    }
  }

  async function executarTransfer(unidade: ItemUnitario) {
    const destino = isOutraLoja ? minhaLojaId : Number(expandedDestinoId);
    if (!destino) return;
    setExpandedLoading(true);
    setExpandedErro('');
    try {
      await api.post('/transferencias', {
        produtoId: unidade.produtoId,
        unidadeFisicaId: unidade.id,
        lojaOrigemId: lojaId,
        lojaDestinoId: destino,
        quantidade: 1,
      });
      setExpandedSucesso(true);
      setTimeout(() => { setExpandedId(null); setExpandedSucesso(false); onTransferido?.(); }, 1500);
    } catch (e: any) {
      setExpandedErro(e?.message || 'Erro ao solicitar transferência');
    } finally {
      setExpandedLoading(false);
    }
  }

  if (isOutraLoja && lista.length === 0) {
    return <div className="text-center py-12 text-zinc-500">Nenhuma unidade disponível nesta loja</div>;
  }
  if (lista.length === 0) {
    return <div className="text-center py-12 text-zinc-500">Nenhuma unidade encontrada</div>;
  }

  const podeTransferirLote = isAdmin && lojas.filter(l => l.id !== lojaId).length > 0;
  const podeSolicitarLote  = !isOutraLoja && lojas.filter(l => l.id !== lojaId).length > 0;

  return (
    <div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="border-b border-[#27272a] text-zinc-400 text-xs">
            {(podeTransferirLote || podeSolicitarLote) && (
              <th className="p-3 w-10">
                <input
                  type="checkbox"
                  className="accent-orange-500 cursor-pointer"
                  checked={lista.filter(u => u.status === 'ESTOQUE').length > 0 && lista.filter(u => u.status === 'ESTOQUE').every(u => selecionados.has(u.id))}
                  onChange={() => toggleTodos(lista)}
                />
              </th>
            )}
            <th className="text-left p-3 font-medium">Chassi</th>
            <th className="text-left p-3 font-medium">Modelo</th>
            <th className="text-left p-3 font-medium hidden md:table-cell">Cód. Motor</th>
            <th className="text-left p-3 font-medium">Cor</th>
            <th className="text-left p-3 font-medium hidden sm:table-cell">Ano</th>
            <th className="text-left p-3 font-medium">Status</th>
            <th className="text-center p-3 font-medium">Ação</th>
          </tr>
        </thead>
        <tbody>
          {lista.map(u => {
            const isExp = expandedId === u.id;
            const podeAcionar = u.status === 'ESTOQUE';
            return (
              <Fragment key={u.id}>
                <tr className={`border-b border-[#27272a] hover:bg-zinc-800/30 transition-colors ${isExp ? 'bg-zinc-800/20' : ''} ${selecionados.has(u.id) ? 'bg-orange-500/5' : ''}`}>
                  {(podeTransferirLote || podeSolicitarLote) && (
                    <td className="p-3">
                      {podeAcionar && (
                        <input
                          type="checkbox"
                          className="accent-orange-500 cursor-pointer"
                          checked={selecionados.has(u.id)}
                          onChange={() => toggleSelecionado(u.id)}
                          onClick={e => e.stopPropagation()}
                        />
                      )}
                    </td>
                  )}
                  <td className="p-3 font-mono text-zinc-200 text-xs">{u.chassi}</td>
                  <td className="p-3 text-white font-medium">{u.modeloNome}</td>
                  <td className="p-3 font-mono text-zinc-400 text-xs hidden md:table-cell">{u.codigoMotor || '—'}</td>
                  <td className="p-3 text-zinc-300">{u.cor || '—'}</td>
                  <td className="p-3 text-zinc-300 hidden sm:table-cell">{u.ano || '—'}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_UNIDADE[u.status] || 'bg-zinc-700 text-zinc-300'}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <button
                      onClick={() => podeAcionar && toggleExpand(u.id, isOutraLoja ? (minhaLojaId ?? undefined) : undefined)}
                      disabled={!podeAcionar}
                      className={`text-xs px-2.5 py-1.5 rounded-lg font-medium border transition-colors whitespace-nowrap ${
                        !podeAcionar
                          ? 'opacity-30 cursor-not-allowed bg-zinc-800 text-zinc-500 border-zinc-700'
                          : isExp
                            ? 'bg-zinc-700 text-zinc-300 border-zinc-600'
                            : isOutraLoja
                              ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border-blue-500/30'
                              : 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 border-orange-500/30'
                      }`}
                    >
                      {isExp ? '✕' : isOutraLoja ? 'Solicitar' : '↔ Transferir'}
                    </button>
                  </td>
                </tr>

                {/* Painel inline */}
                {isExp && (
                  <tr className="border-b border-[#27272a]">
                    <td colSpan={7} className="px-4 py-3 bg-zinc-900/60">
                      {expandedSucesso ? (
                        <div className="flex items-center gap-2 text-green-400 font-medium text-sm">
                          <span className="text-lg">✓</span>
                          {isOutraLoja ? 'Solicitação enviada! Aguardando aprovação.' : 'Transferência solicitada com sucesso!'}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-end gap-4">
                          {/* Info da unidade */}
                          <div className="bg-zinc-800 rounded-lg px-3 py-2 text-sm">
                            <p className="text-zinc-400 text-xs mb-0.5">Unidade</p>
                            <p className="text-white font-medium">{u.modeloNome}</p>
                            <p className="text-zinc-500 font-mono text-xs">{u.chassi}{u.cor ? ` · ${u.cor}` : ''}</p>
                          </div>

                          {/* De → Para */}
                          <div className="flex items-center gap-3 flex-wrap">
                            <div>
                              <p className="text-xs text-zinc-500 mb-0.5">De</p>
                              <p className="text-orange-400 font-medium text-sm">{lojaAtualNome}</p>
                            </div>
                            <span className="text-zinc-500 text-xl">→</span>
                            <div>
                              <p className="text-xs text-zinc-500 mb-0.5">Para</p>
                              {isOutraLoja ? (
                                <p className="text-green-400 font-medium text-sm">{minhaLojaNome}</p>
                              ) : (
                                <select
                                  value={expandedDestinoId}
                                  onChange={e => setExpandedDestinoId(e.target.value ? Number(e.target.value) : '')}
                                  className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-orange-500 min-w-[160px]"
                                >
                                  <option value="">Selecione a loja...</option>
                                  {lojas.filter(l => l.id !== lojaId).map(l => (
                                    <option key={l.id} value={l.id} className="bg-zinc-800">{l.nomeFantasia}</option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </div>

                          {/* Confirmar */}
                          <div className="flex flex-col gap-1">
                            {expandedErro && <p className="text-red-400 text-xs">{expandedErro}</p>}
                            <button
                              onClick={() => executarTransfer(u)}
                              disabled={expandedLoading || (!isOutraLoja && !expandedDestinoId)}
                              className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                            >
                              {expandedLoading
                                ? 'Enviando...'
                                : isOutraLoja
                                  ? 'Confirmar Solicitação'
                                  : isAdmin ? 'Criar Solicitação' : 'Solicitar Transferência'}
                            </button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>

      {/* ── Barra de ação em lote (admin) ── */}
      {podeTransferirLote && selecionados.size > 0 && (
        <div className={`mt-3 border rounded-xl p-4 transition-all ${selecionados.size > 1 ? 'bg-orange-500/15 border-orange-500/40' : 'bg-zinc-800/60 border-zinc-700'}`}>
          {loteSucesso ? (
            <p className="text-green-400 font-medium text-sm flex items-center gap-2">
              <span>✓</span> {selecionados.size > 1 ? 'Transferências em lote' : 'Transferência'} solicitada com sucesso! O financeiro receberá para aprovação.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold ${selecionados.size > 1 ? 'text-orange-400' : 'text-zinc-300'}`}>
                  {selecionados.size > 1 ? `🔄 ${selecionados.size} unidades selecionadas` : '1 unidade selecionada'}
                </span>
                {selecionados.size > 1 && (
                  <span className="text-xs text-zinc-400">— Transferência em lote</span>
                )}
              </div>
              <select
                value={loteDestino}
                onChange={e => setLoteDestino(e.target.value ? Number(e.target.value) : '')}
                className="bg-zinc-800 border border-zinc-600 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
              >
                <option value="">Loja de destino...</option>
                {lojas.filter(l => l.id !== lojaId).map(l => (
                  <option key={l.id} value={l.id} className="bg-zinc-800">{l.nomeFantasia}</option>
                ))}
              </select>
              <button
                onClick={() => executarLote(lista)}
                disabled={!loteDestino || loteLoading}
                className={`text-sm font-bold px-5 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap ${
                  selecionados.size > 1
                    ? 'bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/20'
                    : 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 border border-orange-500/30'
                }`}
              >
                {loteLoading
                  ? 'Solicitando...'
                  : selecionados.size > 1
                    ? `🔄 Transferir Todas Selecionadas (${selecionados.size})`
                    : '↔ Transferir Selecionada'}
              </button>
              <button
                onClick={() => setSelecionados(new Set())}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Limpar seleção
              </button>
              {loteErro && <p className="text-red-400 text-xs w-full">{loteErro}</p>}
            </div>
          )}
        </div>
      )}

      {/* ── Barra de ação em lote (loja própria) ── */}
      {!podeTransferirLote && podeSolicitarLote && selecionados.size > 0 && (
        <div className={`mt-3 border rounded-xl p-4 transition-all ${selecionados.size > 1 ? 'bg-orange-500/15 border-orange-500/40' : 'bg-zinc-800/60 border-zinc-700'}`}>
          {loteSucesso ? (
            <p className="text-green-400 font-medium text-sm flex items-center gap-2">
              <span>✓</span> Solicitação{selecionados.size > 1 ? 'ões' : ''} enviada{selecionados.size > 1 ? 's' : ''}! Aguardando aprovação do financeiro.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className={`text-sm font-semibold ${selecionados.size > 1 ? 'text-orange-400' : 'text-zinc-300'}`}>
                {selecionados.size > 1 ? `${selecionados.size} unidades selecionadas` : '1 unidade selecionada'}
              </span>
              <select
                value={loteDestino}
                onChange={e => setLoteDestino(e.target.value ? Number(e.target.value) : '')}
                className="bg-zinc-800 border border-zinc-600 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
              >
                <option value="">Loja de destino...</option>
                {lojas.filter(l => l.id !== lojaId).map(l => (
                  <option key={l.id} value={l.id} className="bg-zinc-800">{l.nomeFantasia}</option>
                ))}
              </select>
              <button
                onClick={() => executarLote(lista)}
                disabled={!loteDestino || loteLoading}
                className={`text-sm font-bold px-5 py-2 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap ${
                  selecionados.size > 1
                    ? 'bg-orange-500 hover:bg-orange-600 text-white'
                    : 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 border border-orange-500/30'
                }`}
              >
                {loteLoading
                  ? 'Solicitando...'
                  : selecionados.size > 1
                    ? `Solicitar Transferência das ${selecionados.size} Selecionadas`
                    : 'Solicitar Transferência'}
              </button>
              <button onClick={() => setSelecionados(new Set())} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                Limpar seleção
              </button>
              {loteErro && <p className="text-red-400 text-xs w-full">{loteErro}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── TabMovimentacao ──────────────────────────────────────────────────────────

function TabMovimentacao({ logs }: { logs: LogEstoque[] }) {
  const TIPO_COR: Record<string, string> = {
    ENTRADA: 'text-green-400', SAIDA: 'text-red-400', PEDIDO_COMPRA: 'text-blue-400',
    TRANSFERENCIA: 'text-purple-400', AJUSTE: 'text-yellow-400', VENDA: 'text-orange-400',
    OS: 'text-orange-400', DEVOLUCAO: 'text-teal-400', PERDA: 'text-red-500',
    AVARIA: 'text-red-500', RESERVA: 'text-yellow-500',
  };
  return (
    <div className="overflow-x-auto">
      {logs.length === 0
        ? <div className="text-center py-12 text-zinc-500">Sem movimentações recentes</div>
        : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#27272a] text-zinc-400 text-xs">
                <th className="text-left p-3 font-medium">Data</th>
                <th className="text-left p-3 font-medium">Tipo</th>
                <th className="text-left p-3 font-medium">ID Mov.</th>
                <th className="text-left p-3 font-medium">Produto</th>
                <th className="text-right p-3 font-medium">Qtd</th>
                <th className="text-right p-3 font-medium">Anterior</th>
                <th className="text-right p-3 font-medium">Novo</th>
                <th className="text-left p-3 font-medium">Usuário</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id} className="border-b border-[#27272a] hover:bg-zinc-800/30 transition-colors">
                  <td className="p-3 text-zinc-400 text-xs">{fmtDate(l.createdAt)}</td>
                  <td className="p-3">
                    <span className={`text-xs font-medium ${TIPO_COR[l.tipo] || 'text-zinc-300'}`}>{l.tipo}</span>
                  </td>
                  <td className="p-3 text-zinc-500 text-xs font-mono">
                    {l.origemId ? `#${l.origemId}` : `mov:${l.id}`}
                  </td>
                  <td className="p-3 text-zinc-200">{l.produto?.nome || '—'}</td>
                  <td className={`p-3 text-right font-bold ${l.quantidade > 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {l.quantidade > 0 ? '+' : ''}{l.quantidade}
                  </td>
                  <td className="p-3 text-right text-zinc-400">{l.quantidadeAnterior}</td>
                  <td className="p-3 text-right text-white">{l.quantidadeNova}</td>
                  <td className="p-3 text-zinc-400 text-xs">{l.usuario?.nome || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </div>
  );
}

// ─── ModalEntradaMoto ─────────────────────────────────────────────────────────

interface ProdutoMoto { id: number; nome: string; }

function ModalEntradaMoto({ lojaId, lojas, onClose, onSaved }: {
  lojaId?: number | null;
  lojas?: Loja[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [produtos, setProdutos] = useState<ProdutoMoto[]>([]);
  const [form, setForm] = useState({
    produtoId: '', lojaIdSel: lojaId ? String(lojaId) : '', cor: '', chassi: '', codigoMotor: '',
    ano: String(new Date().getFullYear()), custo: '', precoVenda: '',
  });
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api.get<any[]>('/produtos')
      .then(data => setProdutos(
        data.filter((p: any) => p.tipo === 'MOTO').map((p: any) => ({ id: p.id, nome: p.nome }))
      ))
      .catch(() => setProdutos([]));
  }, []);

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const destinoLojaId = lojaId ?? Number(form.lojaIdSel);
    if (!form.produtoId || !form.chassi.trim() || !destinoLojaId) {
      setErro('Produto, chassi e empresa de destino são obrigatórios');
      return;
    }
    setSaving(true);
    setErro('');
    try {
      await api.post('/estoque/entrada-moto', {
        produtoId: Number(form.produtoId),
        lojaId: destinoLojaId,
        chassi: form.chassi.trim(),
        codigoMotor: form.codigoMotor.trim() || null,
        cor: form.cor.trim() || null,
        ano: form.ano ? Number(form.ano) : new Date().getFullYear(),
        custo: form.custo ? Number(form.custo) : undefined,
        precoVenda: form.precoVenda ? Number(form.precoVenda) : undefined,
      });
      onSaved();
    } catch (e: any) {
      setErro(e?.message || 'Erro ao cadastrar moto');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[#18181b] border border-[#27272a] rounded-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-[#27272a]">
          <h2 className="text-white font-semibold text-base">+ Entrada de Moto</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-lg leading-none">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {!lojaId && lojas && lojas.length > 0 && (
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Empresa / Loja de Destino *</label>
              <Select value={form.lojaIdSel} onChange={e => set('lojaIdSel', e.target.value)} required>
                <option value="">Selecione a empresa...</option>
                {lojas.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.id === LOJA_IMPORTACAO_ID ? `🏭 ${l.nomeFantasia}` : `🏪 ${l.nomeFantasia}`}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Modelo / Produto *</label>
            <Select value={form.produtoId} onChange={e => set('produtoId', e.target.value)} required>
              <option value="">Selecione o modelo...</option>
              {produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Cor</label>
              <Input value={form.cor} onChange={e => set('cor', e.target.value)} placeholder="Ex: Vermelho" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Ano</label>
              <Input type="number" value={form.ano} onChange={e => set('ano', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Chassi *</label>
            <Input
              value={form.chassi}
              onChange={e => set('chassi', e.target.value.toUpperCase())}
              placeholder="Ex: 9C2JC5110SR000001"
              required
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Código do Motor</label>
            <Input
              value={form.codigoMotor}
              onChange={e => set('codigoMotor', e.target.value.toUpperCase())}
              placeholder="Ex: JC51E-1234567"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Custo (R$)</label>
              <Input type="number" step="0.01" min="0" value={form.custo} onChange={e => set('custo', e.target.value)} placeholder="0,00" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Preço Venda (R$)</label>
              <Input type="number" step="0.01" min="0" value={form.precoVenda} onChange={e => set('precoVenda', e.target.value)} placeholder="0,00" />
            </div>
          </div>
          {erro && <p className="text-red-400 text-sm">{erro}</p>}
          <div className="flex gap-3 pt-2">
            <button
              type="button" onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-[#27272a] text-zinc-400 hover:text-white text-sm transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit" disabled={saving}
              className="flex-1 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {saving ? 'Salvando...' : 'Cadastrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── TabSolicitacoes ──────────────────────────────────────────────────────────

function TabSolicitacoes({
  isAprovador, lojaId: _lojaId, refreshKey
}: {
  isAprovador: boolean;
  lojaId: number | null;
  refreshKey: number;
}) {
  const [items, setItems] = useState<Transferencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [acao, setAcao] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get<Transferencia[]>('/transferencias')
      .then(d => setItems(Array.isArray(d) ? d : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  async function aprovar(id: number) {
    setAcao(id);
    try {
      await api.put(`/transferencias/${id}/aprovar`, {});
      setItems(prev => prev.map(t => t.id === id ? { ...t, status: 'APROVADA' } : t));
    } catch {}
    setAcao(null);
  }

  async function rejeitar(id: number) {
    setAcao(id);
    try {
      await api.put(`/transferencias/${id}/rejeitar`, {});
      setItems(prev => prev.map(t => t.id === id ? { ...t, status: 'REJEITADA' } : t));
    } catch {}
    setAcao(null);
  }

  if (loading) return <div className="py-10 text-center text-zinc-400 text-sm">Carregando solicitações...</div>;
  if (!items.length) return <div className="py-10 text-center text-zinc-500 text-sm">Nenhuma solicitação de transferência</div>;

  const pendentes = items.filter(t => t.status === 'SOLICITADA');
  const historico = items.filter(t => t.status !== 'SOLICITADA');

  return (
    <div className="space-y-6">
      {isAprovador && pendentes.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-yellow-400 mb-3 flex items-center gap-2">
            ⏳ Aguardando Aprovação ({pendentes.length})
          </p>
          <div className="space-y-2">
            {pendentes.map(t => (
              <div key={t.id} className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-white font-medium text-sm">{t.produto?.nome}</p>
                    {t.unidadeFisica?.chassi && (
                      <span className="font-mono text-orange-400 text-xs bg-orange-500/10 border border-orange-500/30 px-1.5 py-0.5 rounded">
                        {t.unidadeFisica.chassi}{t.unidadeFisica.cor ? ` · ${t.unidadeFisica.cor}` : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-zinc-400 text-xs mt-0.5">
                    De: <span className="text-orange-400">{t.lojaOrigem?.nomeFantasia}</span>
                    {' → '}
                    Para: <span className="text-green-400">{t.lojaDestino?.nomeFantasia}</span>
                  </p>
                  <p className="text-zinc-500 text-xs mt-0.5">
                    Solicitado por: {t.solicitadoPorUser?.nome} — {fmtDate(t.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => rejeitar(t.id)}
                    disabled={acao === t.id}
                    className="text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                  >
                    Rejeitar
                  </button>
                  <button
                    onClick={() => aprovar(t.id)}
                    disabled={acao === t.id}
                    className="text-xs bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                  >
                    Aprovar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isAprovador && pendentes.length === 0 && historico.length === 0 && (
        <div className="text-center py-8 text-zinc-500 text-sm">Nenhuma solicitação feita ainda</div>
      )}

      {historico.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-zinc-400 mb-3">Histórico</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#27272a] text-zinc-400 text-xs">
                  <th className="text-left p-3">Produto / Chassi</th>
                  <th className="text-left p-3">Origem</th>
                  <th className="text-left p-3">Destino</th>
                  <th className="text-left p-3">Solicitado por</th>
                  <th className="text-left p-3">Data</th>
                  <th className="text-left p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {historico.map(t => {
                  const st = STATUS_TRANSFERENCIA[t.status] || { label: t.status, cls: '' };
                  return (
                    <tr key={t.id} className="border-b border-[#27272a] hover:bg-zinc-800/20">
                      <td className="p-3">
                        <p className="text-white">{t.produto?.nome}</p>
                        {t.unidadeFisica?.chassi && (
                          <p className="font-mono text-orange-400 text-xs">{t.unidadeFisica.chassi}{t.unidadeFisica.cor ? ` · ${t.unidadeFisica.cor}` : ''}</p>
                        )}
                      </td>
                      <td className="p-3 text-zinc-300 text-xs">{t.lojaOrigem?.nomeFantasia}</td>
                      <td className="p-3 text-zinc-300 text-xs">{t.lojaDestino?.nomeFantasia}</td>
                      <td className="p-3 text-zinc-400 text-xs">{t.solicitadoPorUser?.nome}</td>
                      <td className="p-3 text-zinc-400 text-xs">{fmtDate(t.createdAt)}</td>
                      <td className="p-3">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${st.cls}`}>{st.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── View Consolidada (Admin) ─────────────────────────────────────────────────

function ViewConsolidada({ onSelectEmpresa, lojas, canEntrarMoto }: {
  onSelectEmpresa: (lojaId: number) => void;
  lojas: Loja[];
  canEntrarMoto: boolean;
}) {
  const [data, setData] = useState<ConsolidadoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [modalEntrada, setModalEntrada] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    api.get<ConsolidadoResponse>('/estoque/consolidado')
      .then(d => setData(d && d.totais ? d : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const empresas = useMemo(() => {
    if (!data) return [];
    const q = busca.toLowerCase();
    return q ? data.empresas.filter(e =>
      e.razaoSocial.toLowerCase().includes(q) || e.nomeFantasia.toLowerCase().includes(q) || e.cnpj.includes(q)
    ) : data.empresas;
  }, [data, busca]);

  if (loading) return <div className="p-12 text-center text-zinc-400">Carregando visão consolidada...</div>;
  if (!data) return <div className="p-12 text-center text-red-400">Erro ao carregar dados</div>;

  const t = data.totais;

  return (
    <div className="space-y-6">
      {modalEntrada && (
        <ModalEntradaMoto
          lojas={lojas}
          onClose={() => setModalEntrada(false)}
          onSaved={() => { setModalEntrada(false); setRefreshKey(k => k + 1); }}
        />
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 flex-1">
          <KpiBlock label="Empresas" value={t.totalEmpresas} color="text-white" />
          <KpiBlock label="Motos" value={t.totalMotos} color="text-orange-400" />
          <KpiBlock label="Peças" value={t.totalPecas} color="text-blue-400" />
          <KpiBlock label="Custo Total" value={fmtBRL(t.valorTotalCusto)} color="text-zinc-200" />
          <KpiBlock label="Valor Venda" value={fmtBRL(t.valorTotalVenda)} color="text-green-400" />
          <KpiBlock label="Alertas" value={t.totalAlertas} color={t.totalAlertas > 0 ? 'text-yellow-400' : 'text-zinc-400'} />
        </div>
        {canEntrarMoto && (
          <button
            onClick={() => setModalEntrada(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/20 border border-orange-500/40 text-orange-400 hover:bg-orange-500/30 text-sm font-medium transition-colors whitespace-nowrap"
          >
            + Entrada de Moto
          </button>
        )}
      </div>

      <Card className="p-4">
        <Input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por CNPJ, razão social ou nome fantasia..." />
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#27272a] text-zinc-400 text-xs">
                <th className="text-left p-4 font-medium">Empresa</th>
                <th className="text-left p-4 font-medium">CNPJ</th>
                <th className="text-left p-4 font-medium">Grupo</th>
                <th className="text-right p-4 font-medium">Motos</th>
                <th className="text-right p-4 font-medium">Peças</th>
                <th className="text-right p-4 font-medium">Custo Total</th>
                <th className="text-right p-4 font-medium">Valor Venda</th>
                <th className="text-right p-4 font-medium">Alertas</th>
                <th className="text-right p-4 font-medium">Ped. Pend.</th>
                <th className="text-left p-4 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {empresas.map(e => (
                <tr key={e.lojaId} className="border-b border-[#27272a] hover:bg-zinc-800/40 cursor-pointer transition-colors"
                  onClick={() => onSelectEmpresa(e.lojaId)}>
                  <td className="p-4">
                    <p className="text-white font-medium">{e.nomeFantasia}</p>
                    <p className="text-xs text-zinc-500">{e.razaoSocial}</p>
                  </td>
                  <td className="p-4 font-mono text-zinc-400 text-xs">{e.cnpj}</td>
                  <td className="p-4 text-zinc-300 text-xs">{e.grupoNome}</td>
                  <td className="p-4 text-right font-bold text-orange-400">{e.totalMotos}</td>
                  <td className="p-4 text-right font-bold text-blue-400">{e.totalPecas}</td>
                  <td className="p-4 text-right text-zinc-200">{fmtBRL(e.valorTotalCusto)}</td>
                  <td className="p-4 text-right text-green-400">{fmtBRL(e.valorTotalVenda)}</td>
                  <td className="p-4 text-right">
                    {e.alertas > 0
                      ? <span className="text-yellow-400 font-bold">{e.alertas}</span>
                      : <span className="text-zinc-500">—</span>
                    }
                  </td>
                  <td className="p-4 text-right">
                    {e.pedidosPendentes > 0
                      ? <Badge variant="info">{e.pedidosPendentes}</Badge>
                      : <span className="text-zinc-500">—</span>
                    }
                  </td>
                  <td className="p-4 text-right">
                    <button className="text-xs text-orange-400 hover:text-orange-300 font-medium">Ver Detalhe →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── View por Empresa ─────────────────────────────────────────────────────────

type EmpresaTab = 'gerencial' | 'unitaria' | 'movimentacao' | 'solicitacoes';

function ViewEmpresa({
  lojaId, minhaLojaId, isAprovador, onBack, refreshSolicitacoes, onSolicitacaoFeita, lojas, verCustos
}: {
  lojaId: number;
  minhaLojaId: number | null;
  isAprovador: boolean;
  onBack?: () => void;
  refreshSolicitacoes: number;
  onSolicitacaoFeita: () => void;
  lojas: Loja[];
  verCustos: boolean;
}) {
  const { user: userVE } = useAuth();
  const [data, setData] = useState<EmpresaDetalhes | null>(null);
  const [loading, setLoading] = useState(true);
  const [aba, setAba] = useState<EmpresaTab>('gerencial');
  const [busca, setBusca] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [modalEntrada, setModalEntrada] = useState(false);
  const isOutraLoja = minhaLojaId !== null && lojaId !== minhaLojaId;
  const podeEntrarMoto = !isOutraLoja && ['ADMIN_GERAL', 'DONO_LOJA', 'GERENTE_LOJA'].includes(userVE?.role || '');

  useEffect(() => {
    setLoading(true);
    setAba('gerencial');
    setBusca('');
    api.get<EmpresaDetalhes>(`/estoque/empresa/${lojaId}`)
      .then(d => setData(d && d.empresa ? d : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [lojaId, refreshKey]);

  if (loading) return <div className="p-12 text-center text-zinc-400">Carregando estoque da empresa...</div>;
  if (!data) return <div className="p-12 text-center text-red-400">Erro ao carregar dados da empresa</div>;

  const t = data.totalizadores;
  const e = data.empresa;

  const gerencialFiltrado = tipoFiltro
    ? data.gerencial.filter(i => i.tipo === tipoFiltro)
    : data.gerencial;

  const TABS: { id: EmpresaTab; label: string; count?: number; highlight?: boolean }[] = [
    { id: 'gerencial', label: 'Gerencial', count: gerencialFiltrado.length },
    { id: 'unitaria', label: isOutraLoja ? 'Unidades Disponíveis' : 'Unitária (Chassi)', count: data.unitaria.filter(u => isOutraLoja ? u.status === 'ESTOQUE' : true).length },
    { id: 'movimentacao', label: 'Movimentação', count: data.logsRecentes.length },
    { id: 'solicitacoes', label: isAprovador ? 'Solicitações' : 'Minhas Solicitações', highlight: isAprovador },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4 flex-wrap">
        {onBack && (
          <button onClick={onBack} className="mt-1 text-zinc-400 hover:text-white transition-colors text-sm">
            ← Voltar
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-white">{e.nomeFantasia}</h2>
            {lojaId === LOJA_IMPORTACAO_ID && (
              <span className="text-xs bg-purple-500/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-full font-medium">
                🏭 Estoque Central
              </span>
            )}
            {isOutraLoja && lojaId !== LOJA_IMPORTACAO_ID && (
              <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full font-medium">
                📍 Outra Loja
              </span>
            )}
          </div>
          <p className="text-sm text-zinc-400">{e.razaoSocial} — <span className="font-mono">{e.cnpj}</span></p>
          <p className="text-xs text-zinc-500 mt-0.5">Grupo: {e.grupoNome}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {t.alertasBaixoEstoque > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 px-3 py-1.5 rounded-lg text-sm">
              ⚠ {t.alertasBaixoEstoque} alerta{t.alertasBaixoEstoque > 1 ? 's' : ''} de estoque baixo
            </div>
          )}
          {podeEntrarMoto && (
            <button
              onClick={() => setModalEntrada(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/20 border border-orange-500/40 text-orange-400 hover:bg-orange-500/30 text-sm font-medium transition-colors"
            >
              + Entrada de Moto
            </button>
          )}
        </div>
      </div>

      {modalEntrada && (
        <ModalEntradaMoto
          lojaId={lojaId}
          onClose={() => setModalEntrada(false)}
          onSaved={() => { setModalEntrada(false); setRefreshKey(k => k + 1); }}
        />
      )}

      {/* Aviso de outra loja */}
      {isOutraLoja && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4 text-sm">
          <p className="text-orange-400 font-medium mb-1">
            {lojaId === LOJA_IMPORTACAO_ID ? '🏭 Estoque Central (TM Importação)' : '📍 Consultando estoque de outra loja'}
          </p>
          <p className="text-zinc-400">
            Você pode solicitar a transferência de unidades disponíveis para sua loja.
            A solicitação será analisada pelo Financeiro.
          </p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiBlock label="Motos" value={t.totalMotos} color="text-orange-400" />
        <KpiBlock label="Peças" value={t.totalPecas} color="text-blue-400" />
        {verCustos && <KpiBlock label="Custo Total (CM)" value={fmtBRL(t.valorTotalCusto)} color="text-zinc-200" />}
        <KpiBlock label="Valor Venda" value={fmtBRL(t.valorTotalVenda)} color="text-green-400"
          sub={verCustos && t.valorTotalCusto > 0 ? `Margem: ${((t.valorTotalVenda / t.valorTotalCusto - 1) * 100).toFixed(1)}%` : undefined} />
        <KpiBlock label="Unidades" value={t.unidadesTotal}
          sub={`${t.unidadesEmEstoque} em estoque · ${t.unidadesVendidas} vendidas`} />
        <KpiBlock label="Sem Giro" value={t.semGiro} color={t.semGiro > 0 ? 'text-red-400' : 'text-zinc-400'} />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[#27272a] overflow-x-auto">
        {TABS.map(tab => (
          <button key={tab.id}
            onClick={() => { setAba(tab.id); setBusca(''); }}
            className={`pb-3 px-1 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
              aba === tab.id
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}>
            {tab.label}
            {tab.highlight && (
              <span className="ml-1.5 text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">!</span>
            )}
            {tab.count !== undefined && (
              <span className="ml-2 text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Filtros */}
      {aba !== 'movimentacao' && aba !== 'solicitacoes' && (
        <div className="flex gap-3">
          <Input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder={aba === 'unitaria' ? 'Buscar por chassi, modelo, cor...' : 'Buscar produto...'}
            className="flex-1" />
          {aba === 'gerencial' && (
            <Select value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)} className="w-36">
              <option value="">Todos</option>
              <option value="MOTO">Motos</option>
              <option value="PECA">Peças</option>
            </Select>
          )}
        </div>
      )}

      {/* Conteúdo */}
      <Card>
        {aba === 'gerencial' && (
          <TabGerencial
            itens={gerencialFiltrado}
            busca={busca}
            lojas={lojas}
            lojaId={lojaId}
            minhaLojaId={minhaLojaId}
            onTransferido={onSolicitacaoFeita}
            onVerUnitaria={(nome) => { setBusca(nome); setAba('unitaria'); }}
          />
        )}
        {aba === 'unitaria' && (
          <TabUnitaria
            itens={data.unitaria}
            busca={busca}
            lojas={lojas}
            lojaId={lojaId}
            minhaLojaId={minhaLojaId}
            onTransferido={onSolicitacaoFeita}
          />
        )}
        {aba === 'movimentacao' && <TabMovimentacao logs={data.logsRecentes} />}
        {aba === 'solicitacoes' && (
          <TabSolicitacoes
            isAprovador={isAprovador}
            lojaId={lojaId}
            refreshKey={refreshSolicitacoes}
          />
        )}
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

// Ordem de proximidade por bairro para Rio de Janeiro (simplificada)
// Quanto menor o índice, mais central/próximo da TM Importação
const LOJA_ORDER: Record<number, number> = {
  4: 0,   // TM Importação — sempre primeiro
  1: 1,   // Centro
  8: 2,   // Copacabana
  7: 3,   // Botafogo
  6: 4,   // Barra
  2: 5,   // Recreio
  9: 6,   // Vila Isabel
  11: 7,  // Bangu
  5: 8,   // Campo Grande
  12: 9,  // Paciência
  10: 10, // Nilopólis
  3: 11,  // Itaipuaçu
};

export function Estoque() {
  const { user } = useAuth();
  const { selectedLojaId: ctxLojaId } = useLojaContext();
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [lojaId, setLojaId] = useState<number | null>(null);
  const [loadingLojas, setLoadingLojas] = useState(true);
  const [refreshSolicitacoes, setRefreshSolicitacoes] = useState(0);
  const [modoBusca, setModoBusca] = useState(false);
  const [modoTransferencias, setModoTransferencias] = useState(false);

  const role = user?.role || '';
  const isAdmin = ['ADMIN_GERAL', 'ADMIN_FINANCEIRO'].includes(role);
  const isAprovador = ['ADMIN_GERAL', 'ADMIN_FINANCEIRO'].includes(role);
  const verCustosGlobal = ['ADMIN_GERAL', 'ADMIN_FINANCEIRO', 'ADMIN_REDE'].includes(role);
  const minhaLojaId = user?.lojaId ?? null;
  const showConsolidado = isAdmin && lojaId === null && !modoBusca && !modoTransferencias;

  useEffect(() => {
    api.get<Loja[]>('/lojas?todos=true')
      .then(lista => {
        setLojas(lista);
        if (ctxLojaId) {
          setLojaId(ctxLojaId);
        } else if (user?.lojaId) {
          setLojaId(user.lojaId);
        } else if (!isAdmin && lista.length > 0) {
          setLojaId(lista[0].id);
        }
      })
      .catch(() => setLojas([]))
      .finally(() => setLoadingLojas(false));
  }, []);

  useEffect(() => {
    if (ctxLojaId) {
      setLojaId(ctxLojaId);
      setModoBusca(false);
      setModoTransferencias(false);
    } else if (isAdmin && !user?.lojaId) {
      setLojaId(null);
    }
  }, [ctxLojaId]);

  const lojasSorted = useMemo(() => {
    if (!lojas.length) return [];
    // Para não-admin: mostra a loja do usuário primeiro, depois Importação, depois as outras
    if (!isAdmin && minhaLojaId) {
      const minhaLoja = lojas.find(l => l.id === minhaLojaId);
      const importacao = lojas.find(l => l.id === LOJA_IMPORTACAO_ID && l.id !== minhaLojaId);
      const outras = lojas
        .filter(l => l.id !== minhaLojaId && l.id !== LOJA_IMPORTACAO_ID)
        .sort((a, b) => (LOJA_ORDER[a.id] ?? 99) - (LOJA_ORDER[b.id] ?? 99));
      return [
        ...(minhaLoja ? [minhaLoja] : []),
        ...(importacao ? [importacao] : []),
        ...outras,
      ];
    }
    return [...lojas].sort((a, b) => (LOJA_ORDER[a.id] ?? 99) - (LOJA_ORDER[b.id] ?? 99));
  }, [lojas, isAdmin, minhaLojaId]);

  if (loadingLojas) return <div className="p-12 text-center text-zinc-400">Carregando...</div>;

  function handleVerLoja(id: number) {
    setLojaId(id);
    setModoBusca(false);
    setModoTransferencias(false);
  }

  function toggleBusca() {
    setModoBusca(b => !b);
    setModoTransferencias(false);
  }

  function toggleTransferencias() {
    setModoTransferencias(b => !b);
    setModoBusca(false);
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <SectionHeader
          title="Estoque"
          subtitle={
            modoTransferencias
              ? isAprovador ? 'Solicitações de transferência da rede' : 'Minhas solicitações de transferência'
              : modoBusca
                ? 'Buscar produto em toda a rede'
                : showConsolidado
                  ? 'Visão consolidada — todas as empresas'
                  : lojaId === minhaLojaId
                    ? 'Estoque da sua loja'
                    : lojaId === LOJA_IMPORTACAO_ID
                      ? 'Estoque Central — TM Importação'
                      : 'Consultando outra loja'
          }
        />

        <div className="flex items-center gap-2 flex-wrap">
          {/* Botão de Transferências */}
          <button
            onClick={toggleTransferencias}
            title="Ver solicitações de transferência de estoque"
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
              modoTransferencias
                ? 'bg-purple-500 text-white border-purple-500'
                : 'bg-[#18181b] text-zinc-300 border-[#27272a] hover:border-purple-400 hover:text-purple-400'
            }`}
          >
            🔄 <span className="hidden sm:inline">Transferências</span>
          </button>

          {/* Botão de busca cross-rede */}
          <button
            onClick={toggleBusca}
            title="Buscar produto em toda a rede"
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
              modoBusca
                ? 'bg-orange-500 text-white border-orange-500'
                : 'bg-[#18181b] text-zinc-300 border-[#27272a] hover:border-orange-500 hover:text-orange-400'
            }`}
          >
            🔍 <span className="hidden sm:inline">Buscar na Rede</span>
          </button>

          {/* Seletor de empresa (oculto no modo busca e transferências) */}
          {!modoBusca && !modoTransferencias && (
            <div className="min-w-64">
              <Select
                value={lojaId ?? ''}
                onChange={e => setLojaId(e.target.value ? Number(e.target.value) : null)}
              >
                {isAdmin && <option value="">📊 Todas as Empresas (Consolidado)</option>}
                {lojasSorted.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.id === minhaLojaId
                      ? `🏠 ${l.nomeFantasia} (Minha Loja)`
                      : l.id === LOJA_IMPORTACAO_ID
                        ? `🏭 ${l.nomeFantasia} — Estoque Central`
                        : `🏪 ${l.nomeFantasia}`
                    }
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* Conteúdo */}
      {modoTransferencias ? (
        <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 sm:p-6">
          <TabSolicitacoes
            isAprovador={isAprovador}
            lojaId={minhaLojaId}
            refreshKey={refreshSolicitacoes}
          />
        </div>
      ) : modoBusca ? (
        <BuscadorRede
          minhaLojaId={minhaLojaId}
          lojas={lojasSorted}
          onVerLoja={handleVerLoja}
        />
      ) : showConsolidado ? (
        <ViewConsolidada
          onSelectEmpresa={setLojaId}
          lojas={lojasSorted}
          canEntrarMoto={['ADMIN_GERAL', 'DONO_LOJA', 'GERENTE_LOJA'].includes(role)}
        />
      ) : lojaId ? (
        <ViewEmpresa
          lojaId={lojaId}
          minhaLojaId={minhaLojaId}
          isAprovador={isAprovador}
          lojas={lojasSorted}
          onBack={isAdmin ? () => setLojaId(null) : undefined}
          refreshSolicitacoes={refreshSolicitacoes}
          onSolicitacaoFeita={() => setRefreshSolicitacoes(k => k + 1)}
          verCustos={verCustosGlobal}
        />
      ) : (
        <div className="text-center py-12 text-zinc-500">
          <p className="text-4xl mb-3">🏪</p>
          <p className="text-lg font-medium text-zinc-400">Nenhuma empresa disponível</p>
          <p className="text-sm mt-1">Cadastre lojas no sistema para ver o estoque</p>
        </div>
      )}
    </div>
  );
}
