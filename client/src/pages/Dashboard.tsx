import { useEffect, useState, useCallback, useRef } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, RadialBarChart, RadialBar, LabelList,
} from 'recharts';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useLojaContext } from '../contexts/LojaContext';


// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardData {
  vendasMes: { total: number; quantidade: number };
  osMes: { total: number; quantidade: number };
  alertasEstoque: number;
  contasVencer: { hoje: number; em3dias: number; em7dias: number };
  fluxoCaixa: { entradas: number; saidas: number; saldo: number };
}

interface LojaRanking {
  posicao: number;
  lojaId: number;
  lojaNome: string;
  grupoNome: string;
  totalVendas: number;
  quantidadeVendas: number;
  totalOS: number;
  quantidadeOS: number;
  faturamento: number;
  ticketMedio: number;
  produtoMaisVendido: string | null;
  ultimaVenda: string | null;
  qtdMotos?: number;
  tiposMotos?: { nome: string; qtd: number }[];
  qtdSeguros?: number;
}

interface VendedorRankingItem {
  id: number;
  nome: string;
  totalVendas: number;
  qtdVendas: number;
  qtdMotos: number;
  tiposMotos: { nome: string; qtd: number }[];
  qtdSeguros: number;
  posicao?: number;
}

interface RankingData {
  periodo: { inicio: string; fim: string; tipo: string };
  kpis: {
    faturamentoTotal: number;
    totalVendasValor: number;
    totalTransacoes: number;
    ticketMedioGeral: number;
    lojaLider: string | null;
    vendasHoje: number;
    qtdVendasHoje: number;
  };
  ranking: LojaRanking[];
}

interface ProdutoRanking {
  posicao: number;
  produtoId: number | null;
  servicoId?: number | null;
  nome: string;
  tipo: string;
  quantidadeVendida: number;
  faturamento: number;
  participacao: number;
}

interface ProdutosData {
  motos: ProdutoRanking[];
  pecas: ProdutoRanking[];
  servicos: ProdutoRanking[];
  todos: ProdutoRanking[];
}

interface GraficoData {
  movimentacao: { label: string; vendas: number; os: number; total: number; qtdVendas: number; qtdOS: number }[];
  faturamentoPorLoja: { nome: string; faturamento: number; vendas: number; os: number }[];
  agruparPorHora: boolean;
}

interface FaturamentoComparativo {
  hoje: { vendas: number; os: number; total: number; qtd: number };
  mes: { vendas: number; os: number; total: number; qtd: number };
  ano: { vendas: number; os: number; total: number; qtd: number };
}

interface DashboardProps {
  onNavigate?: (page: string) => void;
  lojaId?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCurrencyShort = (v: number) => {
  if (v >= 1_000_000) return `R$\u00A0${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$\u00A0${(v / 1_000).toFixed(0)}k`;
  return fmtCurrency(v);
};
const fmtNum = (v: number) => v.toLocaleString('pt-BR');

type Periodo = 'hoje' | 'ontem' | '7dias' | '30dias' | 'mes' | 'custom';

const PERIODOS: { key: Periodo; label: string }[] = [
  { key: 'hoje', label: 'Hoje' },
  { key: 'ontem', label: 'Ontem' },
  { key: '7dias', label: '7 dias' },
  { key: '30dias', label: '30 dias' },
  { key: 'mes', label: 'Mês atual' },
  { key: 'custom', label: 'Período' },
];

const CHART_COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#14b8a6'];
const MEDAL_ICON = ['🥇', '🥈', '🥉'];
const MEDAL_TEXT = ['text-yellow-400', 'text-zinc-300', 'text-orange-400'];

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-zinc-400 mb-1.5 font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 mb-0.5">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-zinc-300">{p.name === 'vendas' ? 'Vendas' : p.name === 'os' ? 'OS' : p.name}:</span>
          <span className="text-white font-semibold">{fmtCurrency(Number(p.value))}</span>
        </div>
      ))}
      {payload.length > 1 && (
        <div className="border-t border-zinc-700 mt-1.5 pt-1.5">
          <span className="text-zinc-400">Total: </span>
          <span className="text-orange-400 font-bold">{fmtCurrency(payload.reduce((s: number, p: any) => s + Number(p.value), 0))}</span>
        </div>
      )}
    </div>
  );
}

function BarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 shadow-xl text-xs">
      <p className="text-zinc-300 font-semibold mb-1">{label}</p>
      <p className="text-orange-400 font-bold">{fmtCurrency(Number(payload[0]?.value) || 0)}</p>
    </div>
  );
}

// ─── KPI Big Card ─────────────────────────────────────────────────────────────

function KpiBig({ label, value, sub, accent = false, icon, onClick }: {
  label: string; value: string; sub?: string; accent?: boolean; icon: string; onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`relative bg-zinc-900 border rounded-2xl p-5 flex flex-col gap-2 overflow-hidden transition-all
        ${onClick ? 'cursor-pointer hover:border-zinc-600 active:scale-[0.98]' : ''}
        ${accent ? 'border-orange-500/40' : 'border-zinc-800'}`}
    >
      {accent && <div className="absolute inset-0 bg-orange-500/5 pointer-events-none" />}
      <div className="flex items-center justify-between">
        <span className="text-2xl">{icon}</span>
        {accent && <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />}
      </div>
      <p className={`text-3xl font-black tracking-tight leading-none ${accent ? 'text-orange-400' : 'text-zinc-100'}`}>
        {value}
      </p>
      <p className="text-xs text-zinc-500 uppercase tracking-widest font-medium">{label}</p>
      {sub && <p className="text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionTitle({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-lg">{icon}</span>
      <div>
        <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
        {sub && <p className="text-xs text-zinc-500">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Auto Refresh ─────────────────────────────────────────────────────────────

function LiveBadge({ refreshing, lastUpdated, onRefresh }: {
  refreshing: boolean; lastUpdated: Date | null; onRefresh: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const ago = lastUpdated ? Math.floor((Date.now() - lastUpdated.getTime()) / 1000) : null;
  const agoText = ago === null ? '' : ago < 5 ? 'agora' : ago < 60 ? `${ago}s` : `${Math.floor(ago / 60)}min`;

  return (
    <div className="flex items-center gap-2">
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border
        ${refreshing ? 'bg-orange-500/10 border-orange-500/30 text-orange-400' : 'bg-green-500/10 border-green-500/20 text-green-400'}`}
      >
        <div className={`w-1.5 h-1.5 rounded-full ${refreshing ? 'bg-orange-400 animate-pulse' : 'bg-green-500'}`} />
        {refreshing ? 'Atualizando...' : ago !== null ? `${agoText} atrás` : 'Ao vivo'}
      </div>
      <button
        onClick={onRefresh}
        disabled={refreshing}
        className="px-2.5 py-1 rounded-full text-xs border border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition-all disabled:opacity-50"
      >
        ↻
      </button>
    </div>
  );
}

// ─── Ranking Row ──────────────────────────────────────────────────────────────

function MotosSegurosTag({ qtdMotos = 0, tiposMotos = [], qtdSeguros = 0 }: { qtdMotos?: number; tiposMotos?: { nome: string; qtd: number }[]; qtdSeguros?: number }) {
  if (qtdMotos === 0 && qtdSeguros === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {qtdMotos > 0 && (
        <span className="inline-flex items-center gap-1 bg-orange-500/10 text-orange-400 text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-orange-500/20">
          🏍️ {qtdMotos} moto{qtdMotos !== 1 ? 's' : ''}
          {tiposMotos.length > 0 && <span className="text-orange-300/70">· {tiposMotos[0].nome.split(' ').slice(0, 2).join(' ')}{tiposMotos.length > 1 ? ` +${tiposMotos.length - 1}` : ''}</span>}
        </span>
      )}
      {qtdSeguros > 0 && (
        <span className="inline-flex items-center gap-1 bg-blue-500/10 text-blue-400 text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-blue-500/20">
          🛡️ {qtdSeguros} seguro{qtdSeguros !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

function RankingRow({ loja, maxFat }: { loja: LojaRanking; maxFat: number }) {
  const pct = maxFat > 0 ? (loja.faturamento / maxFat) * 100 : 0;
  const medal = loja.posicao <= 3 ? MEDAL_ICON[loja.posicao - 1] : null;
  const medalColor = loja.posicao <= 3 ? MEDAL_TEXT[loja.posicao - 1] : 'text-zinc-600';

  return (
    <div className="flex items-center gap-3 py-3 border-b border-zinc-800/60 last:border-0 hover:bg-zinc-800/20 px-4 rounded-lg transition-colors group">
      <div className="w-8 text-center flex-shrink-0">
        {medal ? (
          <span className="text-xl">{medal}</span>
        ) : (
          <span className={`text-sm font-bold ${medalColor}`}>{loja.posicao}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-zinc-200 text-sm truncate">{loja.lojaNome}</p>
        <p className="text-xs text-zinc-600 truncate">{loja.grupoNome}</p>
        <MotosSegurosTag qtdMotos={loja.qtdMotos} tiposMotos={loja.tiposMotos} qtdSeguros={loja.qtdSeguros} />
        <div className="mt-1.5 h-1 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${pct}%`,
              background: loja.posicao === 1 ? '#f97316' : loja.posicao === 2 ? '#a1a1aa' : loja.posicao === 3 ? '#b45309' : '#52525b'
            }}
          />
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`font-bold text-base ${loja.posicao === 1 ? 'text-orange-400' : 'text-zinc-200'}`}>
          {fmtCurrencyShort(loja.faturamento)}
        </p>
        <p className="text-xs text-zinc-500">
          {fmtNum(loja.quantidadeVendas + loja.quantidadeOS)} transações
        </p>
      </div>
    </div>
  );
}

// ─── Admin Dashboard ──────────────────────────────────────────────────────────

function AdminDashboard({ onNavigate, lojaId }: DashboardProps) {
  const { user } = useAuth();
  const { selectedLoja } = useLojaContext();
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [customInicio, setCustomInicio] = useState('');
  const [customFim, setCustomFim] = useState('');
  const [rankingData, setRankingData] = useState<RankingData | null>(null);
  const [produtosData, setProdutosData] = useState<ProdutosData | null>(null);
  const [graficoData, setGraficoData] = useState<GraficoData | null>(null);
  const [basicData, setBasicData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [prodTab, setProdTab] = useState<'todos' | 'motos' | 'pecas' | 'servicos'>('todos');
  const [faturamentoComp, setFaturamentoComp] = useState<FaturamentoComparativo | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const navigateTo = (page: string) => {
    if (onNavigate) onNavigate(page);
    else window.dispatchEvent(new CustomEvent('navigate', { detail: page }));
  };

  const buildParams = useCallback(() => {
    let params = `?periodo=${periodo}`;
    if (periodo === 'custom' && customInicio && customFim) {
      params += `&dataInicio=${customInicio}&dataFim=${customFim}`;
    }
    if (lojaId) params += `&lojaId=${lojaId}`;
    return params;
  }, [periodo, customInicio, customFim, lojaId]);

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);

    const params = buildParams();
    const basicSuffix = lojaId ? `?lojaId=${lojaId}` : '';
    try {
      if (lojaId) {
        const [produtos, grafico, basic, comp] = await Promise.all([
          api.get<ProdutosData>(`/dashboard/produtos-mais-vendidos${params}`),
          api.get<GraficoData>(`/dashboard/grafico-vendas${params}`),
          api.get<DashboardData>(`/dashboard${basicSuffix}`),
          api.get<FaturamentoComparativo>(`/dashboard/faturamento-comparativo?lojaId=${lojaId}`),
        ]);
        setProdutosData(produtos);
        setGraficoData(grafico);
        setBasicData(basic);
        setFaturamentoComp(comp);
        setRankingData(null);
      } else {
        const [ranking, produtos, grafico, basic] = await Promise.all([
          api.get<RankingData>(`/dashboard/ranking-lojas${params}`),
          api.get<ProdutosData>(`/dashboard/produtos-mais-vendidos${params}`),
          api.get<GraficoData>(`/dashboard/grafico-vendas${params}`),
          api.get<DashboardData>('/dashboard'),
        ]);
        setRankingData(ranking);
        setProdutosData(produtos);
        setGraficoData(grafico);
        setBasicData(basic);
      }
      setLastUpdated(new Date());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [buildParams, lojaId]);

  useEffect(() => {
    fetchAll();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => fetchAll(true), 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchAll]);

  const handleResetSistema = async () => {
    setResetting(true);
    try {
      await api.post('/sistema/reset', { confirmar: 'RESETAR_SISTEMA' });
      alert('Sistema resetado com sucesso! Voce sera deslogado.');
      localStorage.removeItem('token');
      window.location.reload();
    } catch {
      alert('Erro ao resetar sistema');
    } finally {
      setResetting(false);
      setShowResetModal(false);
    }
  };

  const faturamentoPeriodo = (basicData?.vendasMes?.total || 0) + (basicData?.osMes?.total || 0);
  const transacoesPeriodo = (basicData?.vendasMes?.quantidade || 0) + (basicData?.osMes?.quantidade || 0);
  const kpis = lojaId
    ? {
        vendasHoje: basicData?.vendasMes?.total || 0,
        faturamentoTotal: faturamentoPeriodo,
        totalTransacoes: transacoesPeriodo,
        ticketMedioGeral: transacoesPeriodo > 0 ? faturamentoPeriodo / transacoesPeriodo : 0,
        lojaLider: selectedLoja?.nomeFantasia || '—',
        qtdVendasHoje: basicData?.vendasMes?.quantidade || 0,
      }
    : rankingData?.kpis;
  const ranking = rankingData?.ranking || [];
  const alertasHoje = basicData?.contasVencer?.hoje || 0;
  const maxFat = ranking[0]?.faturamento || 1;

  // Produtos para gráfico horizontal
  const prodItems = produtosData ? produtosData[prodTab].slice(0, 8) : [];
  const maxProdQtd = Math.max(...prodItems.map(p => p.quantidadeVendida), 1);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-zinc-500 text-sm">Carregando dashboard...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">
            {lojaId ? (selectedLoja?.nomeFantasia || 'Dashboard da Loja') : 'Dashboard'}
          </h1>
          <p className="text-sm text-zinc-500">
            {lojaId ? (
              <span className="text-zinc-400">Visão individual da unidade</span>
            ) : (
              <>Bem-vindo, <span className="text-zinc-300">{user?.nome}</span></>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LiveBadge refreshing={refreshing} lastUpdated={lastUpdated} onRefresh={() => fetchAll(true)} />
          {!lojaId && (
            <button
              onClick={() => setShowResetModal(true)}
              className="px-3 py-1 bg-red-900/30 text-red-500 border border-red-900/50 rounded-full text-xs hover:bg-red-900/50 transition-colors"
            >
              Resetar Sistema
            </button>
          )}
        </div>
      </div>

      {/* ── Alerta contas vencer ── */}
      {alertasHoje > 0 && (
        <div
          onClick={() => navigateTo('financeiro')}
          className="bg-red-950/40 border border-red-500/30 rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:border-red-500/50 transition-colors"
        >
          <span className="text-xl">🚨</span>
          <div>
            <p className="font-semibold text-red-400 text-sm">{alertasHoje} conta{alertasHoje > 1 ? 's' : ''} vencendo hoje</p>
            <p className="text-xs text-zinc-500">Clique para acessar o financeiro</p>
          </div>
        </div>
      )}

      {/* ── Filtro de período ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-600 font-medium uppercase tracking-wider mr-1">Período:</span>
        {PERIODOS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriodo(p.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border
              ${periodo === p.key
                ? 'bg-orange-500 text-white border-orange-500'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'}`}
          >
            {p.label}
          </button>
        ))}
        {periodo === 'custom' && (
          <div className="flex items-center gap-2 ml-1">
            <input
              type="date"
              value={customInicio}
              onChange={e => setCustomInicio(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-orange-500"
            />
            <span className="text-zinc-600 text-xs">–</span>
            <input
              type="date"
              value={customFim}
              onChange={e => setCustomFim(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-orange-500"
            />
            <button
              onClick={() => fetchAll()}
              className="px-3 py-1.5 bg-orange-500 text-white rounded-full text-xs hover:bg-orange-600 transition-colors"
            >
              Aplicar
            </button>
          </div>
        )}
      </div>

      {/* ── KPI Cards Grandes ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiBig
          icon="💰"
          label={lojaId ? 'Vendas (período)' : 'Vendas hoje'}
          value={fmtCurrencyShort(kpis?.vendasHoje || 0)}
          sub={`${fmtNum(kpis?.qtdVendasHoje || 0)} venda${(kpis?.qtdVendasHoje || 0) !== 1 ? 's' : ''}`}
          accent
        />
        <KpiBig
          icon="📈"
          label="Faturamento"
          value={fmtCurrencyShort(kpis?.faturamentoTotal || 0)}
          sub="no período"
        />
        <KpiBig
          icon="🔁"
          label="Transações"
          value={fmtNum(kpis?.totalTransacoes || 0)}
          sub="vendas + OS"
        />
        <KpiBig
          icon="🎯"
          label="Ticket médio"
          value={fmtCurrencyShort(kpis?.ticketMedioGeral || 0)}
          sub="por transação"
        />
        <KpiBig
          icon={lojaId ? '🏪' : '🏆'}
          label={lojaId ? 'Loja ativa' : 'Loja líder'}
          value={kpis?.lojaLider || '—'}
          sub={lojaId ? 'unidade selecionada' : 'maior faturamento'}
        />
        <KpiBig
          icon="⚠️"
          label="Alertas"
          value={String(basicData?.alertasEstoque || 0)}
          sub="estoque baixo"
          onClick={() => navigateTo('estoque')}
        />
      </div>

      {/* ── Gráfico de Movimentação ── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
        <SectionTitle icon="📊" title="Movimentação de Vendas" sub={graficoData?.agruparPorHora ? 'Por hora do dia' : 'Por dia do período'} />
        {graficoData && graficoData.movimentacao.length > 0 && graficoData.movimentacao.some(d => d.total > 0) ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={graficoData.movimentacao} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <defs>
                <linearGradient id="gradVendas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradOS" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#71717a' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#71717a' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => fmtCurrencyShort(v)}
                width={60}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="vendas" name="vendas" stroke="#f97316" strokeWidth={2} fill="url(#gradVendas)" dot={(props: any) => props.value > 0 ? <circle key={props.key} cx={props.cx} cy={props.cy} r={3} fill="#f97316" /> : <g key={props.key} />} activeDot={{ r: 5, fill: '#f97316' }}>
                <LabelList dataKey="vendas" position="top" formatter={(v: unknown) => Number(v) > 0 ? fmtCurrencyShort(Number(v)) : ''} style={{ fontSize: 10, fill: '#f97316', fontWeight: 600 }} />
              </Area>
              <Area type="monotone" dataKey="os" name="os" stroke="#3b82f6" strokeWidth={2} fill="url(#gradOS)" dot={(props: any) => props.value > 0 ? <circle key={props.key} cx={props.cx} cy={props.cy} r={3} fill="#3b82f6" /> : <g key={props.key} />} activeDot={{ r: 5, fill: '#3b82f6' }}>
                <LabelList dataKey="os" position="top" formatter={(v: unknown) => Number(v) > 0 ? fmtCurrencyShort(Number(v)) : ''} style={{ fontSize: 10, fill: '#3b82f6', fontWeight: 600 }} />
              </Area>
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[220px] flex items-center justify-center">
            <p className="text-zinc-600 text-sm">Nenhuma venda confirmada neste período</p>
          </div>
        )}
        <div className="flex items-center gap-4 mt-3">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-orange-500 rounded-full" />
            <span className="text-xs text-zinc-500">Vendas</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-blue-500 rounded-full" />
            <span className="text-xs text-zinc-500">OS</span>
          </div>
        </div>
      </div>

      {/* ── Gráficos: Faturamento por Loja + Produtos ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Faturamento por loja / Comparativo diário-mensal-anual */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          {lojaId ? (
            <>
              <SectionTitle icon="📅" title="Faturamento da Loja" sub="diário · mensal · anual" />
              {faturamentoComp ? (() => {
                const compData = [
                  { label: 'Hoje', total: faturamentoComp.hoje.total, vendas: faturamentoComp.hoje.vendas, os: faturamentoComp.hoje.os, qtd: faturamentoComp.hoje.qtd },
                  { label: 'Mês atual', total: faturamentoComp.mes.total, vendas: faturamentoComp.mes.vendas, os: faturamentoComp.mes.os, qtd: faturamentoComp.mes.qtd },
                  { label: 'Ano atual', total: faturamentoComp.ano.total, vendas: faturamentoComp.ano.vendas, os: faturamentoComp.ano.os, qtd: faturamentoComp.ano.qtd },
                ];
                const maxVal = Math.max(...compData.map(d => d.total), 1);
                const colors = ['#f97316', '#3b82f6', '#22c55e'];
                return (
                  <div className="space-y-4 mt-4">
                    {compData.map((item, i) => (
                      <div key={item.label}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-medium text-zinc-400">{item.label}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-zinc-500">{item.qtd} transaç{item.qtd !== 1 ? 'ões' : 'ão'}</span>
                            <span className="text-sm font-bold text-zinc-100">{fmtCurrencyShort(item.total)}</span>
                          </div>
                        </div>
                        <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${(item.total / maxVal) * 100}%`, backgroundColor: colors[i] }}
                          />
                        </div>
                        <div className="flex gap-3 mt-1">
                          <span className="text-xs text-zinc-600">Vendas: <span className="text-zinc-400">{fmtCurrencyShort(item.vendas)}</span></span>
                          <span className="text-xs text-zinc-600">OS: <span className="text-zinc-400">{fmtCurrencyShort(item.os)}</span></span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })() : (
                <div className="h-[220px] flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </>
          ) : (
            <>
              <SectionTitle icon="🏪" title="Faturamento por Loja" sub="no período selecionado" />
              {graficoData && graficoData.faturamentoPorLoja.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={graficoData.faturamentoPorLoja}
                    layout="vertical"
                    margin={{ top: 0, right: 10, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: '#71717a' }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={v => fmtCurrencyShort(v)}
                    />
                    <YAxis
                      type="category"
                      dataKey="nome"
                      tick={{ fontSize: 11, fill: '#a1a1aa' }}
                      tickLine={false}
                      axisLine={false}
                      width={90}
                    />
                    <Tooltip content={<BarTooltip />} cursor={{ fill: '#27272a' }} />
                    <Bar dataKey="faturamento" name="Faturamento" radius={[0, 4, 4, 0]} maxBarSize={22}>
                      {graficoData.faturamentoPorLoja.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? '#f97316' : i === 1 ? '#fb923c' : '#78716c'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center">
                  <p className="text-zinc-600 text-sm">Nenhum dado no período</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Produtos mais vendidos */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <div className="flex items-start justify-between mb-4">
            <SectionTitle icon="📦" title="Produtos com Maior Saída" />
            <div className="flex gap-1 -mt-1">
              {(['todos', 'motos', 'pecas', 'servicos'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setProdTab(t)}
                  className={`px-2 py-1 rounded-full text-xs font-medium transition-all
                    ${prodTab === t ? 'bg-orange-500 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  {t === 'todos' ? 'Todos' : t === 'motos' ? 'Motos' : t === 'pecas' ? 'Peças' : 'OS'}
                </button>
              ))}
            </div>
          </div>

          {prodItems.length === 0 ? (
            <div className="h-[200px] flex items-center justify-center">
              <p className="text-zinc-600 text-sm">Nenhum produto vendido neste período</p>
            </div>
          ) : (
            <div className="space-y-2">
              {prodItems.map((item, i) => {
                const pct = maxProdQtd > 0 ? (item.quantidadeVendida / maxProdQtd) * 100 : 0;
                return (
                  <div key={`${item.tipo}-${item.produtoId || item.servicoId}`} className="flex items-center gap-2">
                    <span className="text-sm w-5 text-center flex-shrink-0">
                      {i < 3 ? MEDAL_ICON[i] : <span className="text-zinc-600 text-xs font-bold">{i + 1}</span>}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="text-xs text-zinc-300 truncate pr-2">{item.nome}</p>
                        <span className="text-xs font-bold text-zinc-200 flex-shrink-0">{fmtNum(item.quantidadeVendida)}x</span>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-zinc-500 flex-shrink-0 w-16 text-right">{fmtCurrencyShort(item.faturamento)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Ranking das Lojas / Resumo Financeiro ── */}
      {lojaId ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <p className="text-xs text-zinc-500 mb-1">Contas vencendo hoje</p>
            <p className="text-2xl font-bold text-red-400">{basicData?.contasVencer?.hoje || 0}</p>
            <p className="text-xs text-zinc-600 mt-1">contas a receber</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <p className="text-xs text-zinc-500 mb-1">Próximos 7 dias</p>
            <p className="text-2xl font-bold text-orange-400">{basicData?.contasVencer?.em7dias || 0}</p>
            <p className="text-xs text-zinc-600 mt-1">contas a vencer</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <p className="text-xs text-zinc-500 mb-1">Saldo de caixa</p>
            <p className={`text-2xl font-bold ${(basicData?.fluxoCaixa?.saldo || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {fmtCurrencyShort(basicData?.fluxoCaixa?.saldo || 0)}
            </p>
            <p className="text-xs text-zinc-600 mt-1">entradas − saídas</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <p className="text-xs text-zinc-500 mb-1">Estoque baixo</p>
            <p className="text-2xl font-bold text-yellow-400">{basicData?.alertasEstoque || 0}</p>
            <p className="text-xs text-zinc-600 mt-1">produtos abaixo mínimo</p>
          </div>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>🏆</span>
              <h2 className="text-sm font-semibold text-zinc-200">Ranking das Lojas</h2>
            </div>
            <span className="text-xs text-zinc-500">{ranking.length} lojas</span>
          </div>
          {ranking.length === 0 ? (
            <div className="py-12 text-center text-zinc-600 text-sm">Nenhuma venda no período</div>
          ) : (
            <div className="px-1 py-2">
              {ranking.map(loja => (
                <RankingRow key={loja.lojaId} loja={loja} maxFat={maxFat} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Reset Modal ── */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-900 border border-red-900/50 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="text-center mb-5">
              <div className="text-4xl mb-3">⚠️</div>
              <h2 className="text-lg font-bold text-red-400 mb-2">Resetar Sistema</h2>
              <p className="text-sm text-zinc-400">Esta ação irá <strong className="text-red-400">apagar todos os dados</strong> e restaurar o sistema ao estado inicial.</p>
              <p className="text-xs text-zinc-500 mt-2">Esta ação é irreversível.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetModal(false)}
                disabled={resetting}
                className="flex-1 px-4 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-sm hover:bg-zinc-700 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleResetSistema}
                disabled={resetting}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl text-sm hover:bg-red-700 transition-colors font-semibold disabled:opacity-50"
              >
                {resetting ? 'Resetando...' : 'Confirmar Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Loading Spinner ──────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-zinc-500 text-sm">Carregando dashboard...</p>
    </div>
  );
}

// ─── Comissão Card ────────────────────────────────────────────────────────────

function ComissaoCard({ total, pagas, pendentes }: { total: number; pagas: number; pendentes: number }) {
  const pct = total > 0 ? Math.round((pagas / total) * 100) : 0;
  const radialData = [
    { name: 'Pago', value: pagas, fill: '#22c55e' },
    { name: 'Pendente', value: pendentes > 0 ? pendentes : 0.001, fill: '#f97316' },
  ];
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
      <SectionTitle icon="💎" title="Comissões do Mês" />
      <div className="flex items-center gap-4">
        <div className="w-[120px] h-[120px] flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart cx="50%" cy="50%" innerRadius="55%" outerRadius="90%" data={radialData} startAngle={90} endAngle={-270}>
              <RadialBar dataKey="value" cornerRadius={4} />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <p className="text-xs text-zinc-500">Total</p>
            <p className="text-xl font-bold text-zinc-100">{fmtCurrencyShort(total)}</p>
          </div>
          <div className="flex gap-4">
            <div>
              <p className="text-xs text-zinc-500 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Pago</p>
              <p className="text-sm font-semibold text-green-400">{fmtCurrencyShort(pagas)}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />Pendente</p>
              <p className="text-sm font-semibold text-orange-400">{fmtCurrencyShort(pendentes)}</p>
            </div>
          </div>
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-zinc-500">{pct}% já recebido</p>
        </div>
      </div>
    </div>
  );
}

// ─── Trend Area Chart ─────────────────────────────────────────────────────────

function TrendChart({ data, label, color = '#f97316' }: {
  data: { label: string; total: number }[];
  label: string;
  color?: string;
}) {
  const hasData = data.some(d => d.total > 0);
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
      <SectionTitle icon="📈" title={label} sub="últimos 30 dias" />
      {hasData ? (
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <defs>
              <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#52525b' }} tickLine={false} axisLine={false} interval={4} />
            <YAxis tick={{ fontSize: 10, fill: '#52525b' }} tickLine={false} axisLine={false} tickFormatter={v => fmtCurrencyShort(v)} width={55} />
            <Tooltip content={({ active, payload, label: lbl }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                  <p className="text-zinc-400 mb-1">{lbl}</p>
                  <p className="font-bold" style={{ color }}>{fmtCurrency(Number(payload[0]?.value) || 0)}</p>
                </div>
              );
            }} />
            <Area type="monotone" dataKey="total" stroke={color} strokeWidth={2} fill="url(#trendGrad)" dot={false} activeDot={{ r: 4, fill: color }} />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[180px] flex items-center justify-center">
          <p className="text-zinc-600 text-sm">Nenhum dado nos últimos 30 dias</p>
        </div>
      )}
    </div>
  );
}

// ─── Dual Trend Chart (Vendas + OS) ──────────────────────────────────────────

function DualTrendChart({ data }: {
  data: { label: string; vendas: number; os: number; total: number }[];
}) {
  const hasData = data.some(d => d.total > 0);
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
      <SectionTitle icon="📊" title="Movimentação da Loja" sub="últimos 30 dias" />
      {hasData ? (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <defs>
                <linearGradient id="dualV" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="dualO" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#52525b' }} tickLine={false} axisLine={false} interval={4} />
              <YAxis tick={{ fontSize: 10, fill: '#52525b' }} tickLine={false} axisLine={false} tickFormatter={v => fmtCurrencyShort(v)} width={55} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="vendas" name="vendas" stroke="#f97316" strokeWidth={2} fill="url(#dualV)" dot={false} activeDot={{ r: 4, fill: '#f97316' }} />
              <Area type="monotone" dataKey="os" name="os" stroke="#3b82f6" strokeWidth={2} fill="url(#dualO)" dot={false} activeDot={{ r: 4, fill: '#3b82f6' }} />
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-orange-500 rounded-full" /><span className="text-xs text-zinc-500">Vendas</span></div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-blue-500 rounded-full" /><span className="text-xs text-zinc-500">OS</span></div>
          </div>
        </>
      ) : (
        <div className="h-[200px] flex items-center justify-center">
          <p className="text-zinc-600 text-sm">Nenhum dado nos últimos 30 dias</p>
        </div>
      )}
    </div>
  );
}

// ─── Atalhos rápidos ──────────────────────────────────────────────────────────

function QuickActions({ actions, onNavigate }: {
  actions: { icon: string; label: string; page: string; desc: string }[];
  onNavigate: (p: string) => void;
}) {
  return (
    <div className={`grid gap-3 grid-cols-${Math.min(actions.length, 3)}`}>
      {actions.map(({ icon, label, page, desc }) => (
        <button
          key={page}
          onClick={() => onNavigate(page)}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-left hover:border-orange-500/40 hover:bg-zinc-800/50 transition-all group"
        >
          <span className="text-2xl block mb-2">{icon}</span>
          <p className="font-semibold text-zinc-200 text-sm group-hover:text-orange-400 transition-colors">{label}</p>
          <p className="text-xs text-zinc-500 mt-0.5">{desc}</p>
        </button>
      ))}
    </div>
  );
}

// ─── Dashboard VENDEDOR ────────────────────────────────────────────────────────

interface VendedorData {
  vendasMes: { total: number; quantidade: number };
  comissoes: { total: number; pagas: number; pendentes: number };
  tendenciaDiaria: { label: string; total: number }[];
  topProdutos: { nome: string; tipo: string; qtd: number; fat: number }[];
  rankingLoja: VendedorRankingItem[];
  ultimasVendas: { id: number; valor: number; cliente: string; data: string }[];
  configuracoes: { comissaoMoto: number; comissaoServico: number };
}

function VendedorDashboard({ onNavigate }: DashboardProps) {
  const { user } = useAuth();
  const [data, setData] = useState<VendedorData | null>(null);
  const [loading, setLoading] = useState(true);
  const navigateTo = (p: string) => { if (onNavigate) onNavigate(p); else window.dispatchEvent(new CustomEvent('navigate', { detail: p })); };

  useEffect(() => {
    api.get<VendedorData>('/dashboard/vendedor').then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;

  const ticketMedio = (data?.vendasMes.quantidade || 0) > 0
    ? (data?.vendasMes.total || 0) / (data?.vendasMes.quantidade || 1)
    : 0;
  const maxFat = Math.max(...(data?.topProdutos.map(p => p.fat) || [1]), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Meu Painel</h1>
        <p className="text-sm text-zinc-500">Olá, <span className="text-orange-400 font-medium">{user?.nome}</span> · Vendedor</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiBig icon="💰" label="Vendas do mês" value={fmtCurrencyShort(data?.vendasMes.total || 0)} sub={`${data?.vendasMes.quantidade || 0} venda${(data?.vendasMes.quantidade || 0) !== 1 ? 's' : ''}`} accent />
        <KpiBig icon="🏷️" label="Ticket médio" value={fmtCurrencyShort(ticketMedio)} sub="por venda" />
        <KpiBig icon="💎" label="Comissão total" value={fmtCurrencyShort(data?.comissoes.total || 0)} sub="no mês" />
        <KpiBig icon="⏳" label="Comissão pendente" value={fmtCurrencyShort(data?.comissoes.pendentes || 0)} sub="a receber" />
      </div>

      {/* Gráfico de tendência */}
      <TrendChart data={data?.tendenciaDiaria || []} label="Minhas Vendas" color="#f97316" />

      {/* Comissões + Top Produtos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ComissaoCard
          total={data?.comissoes.total || 0}
          pagas={data?.comissoes.pagas || 0}
          pendentes={data?.comissoes.pendentes || 0}
        />

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <SectionTitle icon="📦" title="Produtos que Mais Vendi" sub="neste mês" />
          {(data?.topProdutos.length || 0) === 0 ? (
            <div className="h-[140px] flex items-center justify-center">
              <p className="text-zinc-600 text-sm">Nenhum produto vendido este mês</p>
            </div>
          ) : (
            <div className="space-y-3 mt-2">
              {data?.topProdutos.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-sm w-5 text-center flex-shrink-0">
                    {i < 3 ? MEDAL_ICON[i] : <span className="text-zinc-600 text-xs font-bold">{i + 1}</span>}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-xs text-zinc-300 truncate pr-2">{p.nome}</p>
                      <span className="text-xs font-bold text-zinc-200 flex-shrink-0">{p.qtd}x</span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(p.fat / maxFat) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    </div>
                  </div>
                  <span className="text-xs text-zinc-500 flex-shrink-0 w-16 text-right">{fmtCurrencyShort(p.fat)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Ranking da Loja */}
      {(data?.rankingLoja?.length || 0) > 0 && (() => {
        const maxV = Math.max(...(data?.rankingLoja.map(v => v.totalVendas) || [1]), 1);
        return (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>🏆</span>
                <h2 className="text-sm font-semibold text-zinc-200">Ranking da Loja</h2>
              </div>
              <span className="text-xs text-zinc-500">este mês</span>
            </div>
            <div className="px-4 py-3 space-y-3">
              {data?.rankingLoja.map((v, i) => {
                const isMe = v.id === user?.id;
                const pct = maxV > 0 ? (v.totalVendas / maxV) * 100 : 0;
                return (
                  <div key={v.id} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${isMe ? 'bg-orange-500/10 border border-orange-500/30' : 'border border-transparent'}`}>
                    <div className="w-7 text-center flex-shrink-0">
                      {i < 3 ? <span className="text-lg">{MEDAL_ICON[i]}</span> : <span className="text-xs text-zinc-600 font-bold">{i + 1}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className={`text-xs font-semibold truncate ${isMe ? 'text-orange-300' : 'text-zinc-200'}`}>
                          {v.nome}{isMe ? ' (você)' : ''}
                        </p>
                        <p className={`text-xs font-bold flex-shrink-0 ml-2 ${i === 0 ? 'text-orange-400' : 'text-zinc-300'}`}>{fmtCurrencyShort(v.totalVendas)}</p>
                      </div>
                      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-1">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: isMe ? '#f97316' : i === 0 ? '#f97316' : '#52525b' }} />
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-zinc-500">{v.qtdVendas} venda{v.qtdVendas !== 1 ? 's' : ''}</span>
                        {v.qtdMotos > 0 && <span className="text-[10px] text-orange-400/80">🏍️ {v.qtdMotos} moto{v.qtdMotos !== 1 ? 's' : ''}{v.tiposMotos.length > 0 ? ` · ${v.tiposMotos[0].nome.split(' ').slice(0, 2).join(' ')}` : ''}</span>}
                        {v.qtdSeguros > 0 && <span className="text-[10px] text-blue-400/80">🛡️ {v.qtdSeguros}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Últimas vendas + Atalhos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <SectionTitle icon="🧾" title="Últimas Vendas" />
          {(data?.ultimasVendas.length || 0) === 0 ? (
            <p className="text-zinc-600 text-sm py-4 text-center">Nenhuma venda registrada ainda</p>
          ) : (
            <div className="space-y-2">
              {data?.ultimasVendas.map(v => (
                <div key={v.id} className="flex items-center justify-between py-2 border-b border-zinc-800/60 last:border-0">
                  <div>
                    <p className="text-xs font-medium text-zinc-200">{v.cliente}</p>
                    <p className="text-xs text-zinc-500">{new Date(v.data).toLocaleDateString('pt-BR')}</p>
                  </div>
                  <p className="text-sm font-bold text-orange-400">{fmtCurrencyShort(v.valor)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <QuickActions
            onNavigate={navigateTo}
            actions={[
              { icon: '💼', label: 'Nova Venda', page: 'vendas', desc: 'Registrar uma venda' },
              { icon: '👥', label: 'Clientes', page: 'clientes', desc: 'Ver e cadastrar clientes' },
              { icon: '📦', label: 'Estoque', page: 'estoque', desc: 'Consultar disponibilidade' },
            ]}
          />
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <p className="text-xs text-zinc-500 mb-2">Taxas de comissão configuradas</p>
            <div className="flex gap-4">
              <div>
                <p className="text-xs text-zinc-600">Motos</p>
                <p className="text-base font-bold text-orange-400">{data?.configuracoes.comissaoMoto || 0}%</p>
              </div>
              <div>
                <p className="text-xs text-zinc-600">Serviços</p>
                <p className="text-base font-bold text-blue-400">{data?.configuracoes.comissaoServico || 0}%</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard TECNICO ─────────────────────────────────────────────────────────

const STATUS_OS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  ORCAMENTO:   { label: 'Orçamento',   color: '#a855f7', bg: 'bg-purple-500/10 text-purple-400' },
  APROVADA:    { label: 'Aprovada',    color: '#3b82f6', bg: 'bg-blue-500/10 text-blue-400' },
  EM_EXECUCAO: { label: 'Executando',  color: '#f97316', bg: 'bg-orange-500/10 text-orange-400' },
  CONCLUIDA:   { label: 'Concluída',   color: '#22c55e', bg: 'bg-green-500/10 text-green-400' },
  CANCELADA:   { label: 'Cancelada',   color: '#ef4444', bg: 'bg-red-500/10 text-red-400' },
  AGUARDANDO_PECA: { label: 'Aguard. Peça', color: '#eab308', bg: 'bg-yellow-500/10 text-yellow-400' },
};

interface TecnicoData {
  osMes: { total: number; quantidade: number };
  osPorStatus: { status: string; count: number; total: number }[];
  comissoes: { total: number; pagas: number; pendentes: number };
  tendenciaDiaria: { label: string; total: number }[];
  ultimasOS: { id: number; valor: number; status: string; cliente: string; veiculo: string; data: string }[];
}

function TecnicoDashboard({ onNavigate }: DashboardProps) {
  const { user } = useAuth();
  const [data, setData] = useState<TecnicoData | null>(null);
  const [loading, setLoading] = useState(true);
  const navigateTo = (p: string) => { if (onNavigate) onNavigate(p); else window.dispatchEvent(new CustomEvent('navigate', { detail: p })); };

  useEffect(() => {
    api.get<TecnicoData>('/dashboard/tecnico').then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;

  const totalOS = data?.osMes.quantidade || 0;
  const ticketMedio = totalOS > 0 ? (data?.osMes.total || 0) / totalOS : 0;
  const barData = (data?.osPorStatus || []).map(s => ({
    label: STATUS_OS_CONFIG[s.status]?.label || s.status,
    count: s.count,
    fill: STATUS_OS_CONFIG[s.status]?.color || '#71717a',
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Meu Painel</h1>
        <p className="text-sm text-zinc-500">Olá, <span className="text-blue-400 font-medium">{user?.nome}</span> · Técnico</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiBig icon="🔧" label="OS do mês" value={String(totalOS)} sub={`${fmtCurrencyShort(data?.osMes.total || 0)} em serviços`} accent />
        <KpiBig icon="🎯" label="Ticket médio" value={fmtCurrencyShort(ticketMedio)} sub="por OS" />
        <KpiBig icon="💎" label="Comissão total" value={fmtCurrencyShort(data?.comissoes.total || 0)} sub="no mês" />
        <KpiBig icon="⏳" label="Comissão pendente" value={fmtCurrencyShort(data?.comissoes.pendentes || 0)} sub="a receber" />
      </div>

      {/* Gráfico de tendência */}
      <TrendChart data={data?.tendenciaDiaria || []} label="Minhas OS" color="#3b82f6" />

      {/* OS por status + Comissões */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <SectionTitle icon="📋" title="OS por Status" sub="este mês" />
          {barData.length === 0 ? (
            <div className="h-[160px] flex items-center justify-center">
              <p className="text-zinc-600 text-sm">Nenhuma OS este mês</p>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#71717a' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: '#a1a1aa' }} tickLine={false} axisLine={false} width={80} />
                  <Tooltip
                    content={({ active, payload, label: lbl }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs shadow-xl">
                          <p className="text-zinc-300 font-semibold">{lbl}</p>
                          <p className="text-orange-400 font-bold">{payload[0]?.value} OS</p>
                        </div>
                      );
                    }}
                    cursor={{ fill: '#27272a' }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={18}>
                    {barData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-2">
                {barData.map((b, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                    <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: b.fill }} />
                    {b.label}: {b.count}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <ComissaoCard
          total={data?.comissoes.total || 0}
          pagas={data?.comissoes.pagas || 0}
          pendentes={data?.comissoes.pendentes || 0}
        />
      </div>

      {/* Últimas OS + Atalhos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
          <SectionTitle icon="🛠️" title="Últimas OS" />
          {(data?.ultimasOS.length || 0) === 0 ? (
            <p className="text-zinc-600 text-sm py-4 text-center">Nenhuma OS registrada</p>
          ) : (
            <div className="space-y-2">
              {data?.ultimasOS.map(os => {
                const cfg = STATUS_OS_CONFIG[os.status] || { label: os.status, bg: 'bg-zinc-800 text-zinc-400' };
                return (
                  <div key={os.id} className="flex items-center justify-between py-2 border-b border-zinc-800/60 last:border-0 gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-zinc-200 truncate">{os.cliente}</p>
                      <p className="text-xs text-zinc-500 truncate">{os.veiculo} · {new Date(os.data).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-blue-400">{fmtCurrencyShort(os.valor)}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${cfg.bg}`}>{cfg.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <QuickActions
          onNavigate={navigateTo}
          actions={[
            { icon: '🔧', label: 'Minhas OS', page: 'os', desc: 'Visualizar ordens de serviço' },
            { icon: '🛡️', label: 'Garantias', page: 'garantias', desc: 'Atender chamados de garantia' },
            { icon: '📦', label: 'Estoque', page: 'estoque', desc: 'Consultar peças disponíveis' },
          ]}
        />
      </div>
    </div>
  );
}

// ─── Dashboard GERENTE_LOJA ───────────────────────────────────────────────────

interface GerenteData {
  vendasMes: { total: number; quantidade: number };
  osMes: { total: number; quantidade: number };
  estoqueBaixo: number;
  comissoesMes: number;
  faturamentoMes: number;
  tendenciaDiaria: { label: string; vendas: number; os: number; total: number }[];
  rankingVendedores: VendedorRankingItem[];
}

function GerenteDashboard({ onNavigate }: DashboardProps) {
  const { user } = useAuth();
  const [data, setData] = useState<GerenteData | null>(null);
  const [loading, setLoading] = useState(true);
  const navigateTo = (p: string) => { if (onNavigate) onNavigate(p); else window.dispatchEvent(new CustomEvent('navigate', { detail: p })); };

  useEffect(() => {
    api.get<GerenteData>('/dashboard/gerente').then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;

  const totalTransacoes = (data?.vendasMes.quantidade || 0) + (data?.osMes.quantidade || 0);
  const ticketMedio = totalTransacoes > 0 ? (data?.faturamentoMes || 0) / totalTransacoes : 0;
  const maxVend = Math.max(...(data?.rankingVendedores.map(v => v.totalVendas) || [1]), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Painel da Loja</h1>
        <p className="text-sm text-zinc-500">Gerente <span className="text-green-400 font-medium">{user?.nome}</span></p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <KpiBig icon="💰" label="Vendas do mês" value={fmtCurrencyShort(data?.vendasMes.total || 0)} sub={`${data?.vendasMes.quantidade || 0} vendas`} accent />
        <KpiBig icon="🔧" label="OS do mês" value={fmtCurrencyShort(data?.osMes.total || 0)} sub={`${data?.osMes.quantidade || 0} ordens`} />
        <KpiBig icon="📈" label="Faturamento" value={fmtCurrencyShort(data?.faturamentoMes || 0)} sub="vendas + OS" />
        <KpiBig icon="🎯" label="Ticket médio" value={fmtCurrencyShort(ticketMedio)} sub="por transação" />
        <KpiBig icon="⚠️" label="Estoque baixo" value={String(data?.estoqueBaixo || 0)} sub="itens" onClick={() => navigateTo('estoque')} />
      </div>

      {/* Gráfico de tendência dupla */}
      <DualTrendChart data={data?.tendenciaDiaria || []} />

      {/* Ranking vendedores + Atalhos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>🏆</span>
              <h2 className="text-sm font-semibold text-zinc-200">Ranking de Vendedores</h2>
            </div>
            <span className="text-xs text-zinc-500">{data?.rankingVendedores.length || 0} vendedores</span>
          </div>
          {(data?.rankingVendedores.length || 0) === 0 ? (
            <div className="py-10 text-center text-zinc-600 text-sm">Nenhum vendedor ativo nesta loja</div>
          ) : (
            <div className="px-4 py-3 space-y-3">
              {data?.rankingVendedores.map((v, i) => (
                <div key={v.id} className="flex items-center gap-3">
                  <div className="w-7 text-center flex-shrink-0">
                    {i < 3 ? <span className="text-lg">{MEDAL_ICON[i]}</span> : <span className="text-xs text-zinc-600 font-bold">{i + 1}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-zinc-200 truncate">{v.nome}</p>
                      <p className={`text-xs font-bold flex-shrink-0 ml-2 ${i === 0 ? 'text-orange-400' : 'text-zinc-300'}`}>{fmtCurrencyShort(v.totalVendas)}</p>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-1">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${(v.totalVendas / maxVend) * 100}%`, background: i === 0 ? '#f97316' : i === 1 ? '#a1a1aa' : '#52525b' }}
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-zinc-500">{v.qtdVendas} venda{v.qtdVendas !== 1 ? 's' : ''}</span>
                      {(v.qtdMotos || 0) > 0 && <span className="text-[10px] text-orange-400/80">🏍️ {v.qtdMotos}{(v.tiposMotos || []).length > 0 ? ` · ${v.tiposMotos[0].nome.split(' ').slice(0, 2).join(' ')}` : ''}</span>}
                      {(v.qtdSeguros || 0) > 0 && <span className="text-[10px] text-blue-400/80">🛡️ {v.qtdSeguros}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <p className="text-xs text-zinc-500 mb-1">Comissões geradas no mês</p>
            <p className="text-2xl font-bold text-yellow-400">{fmtCurrencyShort(data?.comissoesMes || 0)}</p>
            <p className="text-xs text-zinc-600 mt-1">total da equipe</p>
          </div>
          <QuickActions
            onNavigate={navigateTo}
            actions={[
              { icon: '💼', label: 'Vendas', page: 'vendas', desc: 'Gerenciar vendas da loja' },
              { icon: '🔧', label: 'OS', page: 'os', desc: 'Ordens de serviço' },
              { icon: '📦', label: 'Estoque', page: 'estoque', desc: 'Controle de estoque' },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function Dashboard({ onNavigate }: DashboardProps) {
  const { user } = useAuth();
  const { selectedLojaId } = useLojaContext();

  const role = user?.role || '';

  if (['ADMIN_GERAL', 'ADMIN_REDE', 'ADMIN_FINANCEIRO', 'DONO_LOJA'].includes(role)) {
    return <AdminDashboard onNavigate={onNavigate} lojaId={selectedLojaId || undefined} />;
  }
  if (role === 'VENDEDOR') {
    return <VendedorDashboard onNavigate={onNavigate} />;
  }
  if (role === 'TECNICO') {
    return <TecnicoDashboard onNavigate={onNavigate} />;
  }
  if (role === 'GERENTE_LOJA') {
    return <GerenteDashboard onNavigate={onNavigate} />;
  }
  // fallback
  return <VendedorDashboard onNavigate={onNavigate} />;
}
