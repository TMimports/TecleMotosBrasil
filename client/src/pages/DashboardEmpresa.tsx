import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useLojaContext } from '../contexts/LojaContext';
import { api } from '../services/api';

interface DashboardData {
  loja: { id: number; cnpj: string; razaoSocial: string; nomeFantasia?: string; grupo: { nome: string } };
  periodo: { inicio: string; fim: string };
  vendas: { totalValor: number; totalCount: number };
  servicos: { totalValor: number; totalCount: number };
  estoque: { totalMotos: number; totalPecas: number; valorEstoque: number; itens: number };
  financeiro: {
    contasPagar: { total: number; pago: number; count: number };
    contasReceber: { total: number; recebido: number; count: number };
  };
  fiscal: {
    notasEntrada: { total: number; count: number };
    notasSaida: { total: number; count: number };
  };
  ultimasVendas: any[];
  ultimasOS: any[];
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function KPI({ label, value, sub, color = 'text-white' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-zinc-900 rounded-xl p-5">
      <div className="text-zinc-400 text-xs mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-zinc-500 text-xs mt-1">{sub}</div>}
    </div>
  );
}

interface DashboardEmpresaProps {
  lojaId?: number;
}

export function DashboardEmpresa({ lojaId: lojaIdProp }: DashboardEmpresaProps = {}) {
  const { user } = useAuth();
  const { selectedLoja } = useLojaContext();
  const isControlled = lojaIdProp !== undefined;

  const [lojas, setLojas] = useState<any[]>([]);
  const [lojaId, setLojaId] = useState<number | null>(lojaIdProp ?? null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(isControlled);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (isControlled) {
      if (lojaIdProp) {
        setLojaId(lojaIdProp);
        setData(null);
        setErro(null);
        setLoading(true);
        loadDashboard(lojaIdProp);
      }
    } else {
      loadLojas();
    }
  }, [lojaIdProp]);

  useEffect(() => {
    if (!isControlled && lojaId) {
      setErro(null);
      loadDashboard(lojaId);
    }
  }, [lojaId]);

  async function loadLojas() {
    try {
      const res = await api.get<any>('/lojas');
      const list = Array.isArray(res) ? res : res.lojas ?? [];
      setLojas(list);
      if (list.length > 0) {
        const defaultId = user?.lojaId ?? list[0].id;
        setLojaId(defaultId);
      }
    } catch { /* ignore */ }
  }

  async function loadDashboard(id: number) {
    setLoading(true);
    setErro(null);
    try {
      const d = await api.get<DashboardData>(`/dashboard/empresa/${id}`);
      setData(d);
    } catch (err: any) {
      setErro(err?.message || 'Erro ao carregar dados da loja');
    } finally {
      setLoading(false);
    }
  }

  const receitaTotal = data ? data.vendas.totalValor + data.servicos.totalValor : 0;
  const aReceberPendente = data ? data.financeiro.contasReceber.total - data.financeiro.contasReceber.recebido : 0;
  const aPagarPendente = data ? data.financeiro.contasPagar.total - data.financeiro.contasPagar.pago : 0;

  const nomeExibido = data?.loja?.nomeFantasia || data?.loja?.razaoSocial || selectedLoja?.nomeFantasia || `Loja #${lojaId}`;

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      {isControlled ? (
        <div className="flex items-center gap-3">
          <span className="text-2xl">🏪</span>
          <div>
            <h1 className="text-xl font-bold text-white">{nomeExibido}</h1>
            <p className="text-zinc-500 text-xs">Dashboard individual — mês atual</p>
          </div>
          {loading && (
            <div className="ml-auto flex items-center gap-2 text-orange-400 text-sm animate-pulse">
              <div className="w-1.5 h-1.5 rounded-full bg-orange-400" />
              Carregando...
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard por Empresa</h1>
            <p className="text-zinc-400 text-sm mt-1">KPIs consolidados por CNPJ — mês atual</p>
          </div>
          <select
            value={lojaId ?? ''}
            onChange={e => setLojaId(Number(e.target.value))}
            className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-4 py-2 text-sm min-w-[220px]"
          >
            {lojas.map(l => (
              <option key={l.id} value={l.id}>
                {l.nomeFantasia || l.razaoSocial} — {l.cnpj}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Erro */}
      {erro && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 text-center">
          <p className="text-red-400 font-medium">⚠️ {erro}</p>
          <button
            onClick={() => lojaId && loadDashboard(lojaId)}
            className="mt-3 text-sm text-zinc-400 hover:text-white underline"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Skeleton de carregamento */}
      {loading && !data && !erro && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-zinc-900 rounded-xl p-5 h-24 border border-zinc-800" />
          ))}
        </div>
      )}

      {!loading && !data && !erro && !isControlled && (
        <div className="text-zinc-500 text-center py-12">Selecione uma loja</div>
      )}

      {data && !loading && (
        <>
          {/* Info da loja */}
          <div className="bg-zinc-900 rounded-xl p-4 flex flex-wrap gap-4 items-center">
            <div>
              <div className="text-white font-semibold text-lg">{data.loja.nomeFantasia || data.loja.razaoSocial}</div>
              <div className="text-zinc-400 text-sm">CNPJ: {data.loja.cnpj} · Grupo: {data.loja.grupo.nome}</div>
            </div>
            <div className="ml-auto text-zinc-500 text-sm">
              Período: {new Date(data.periodo.inicio).toLocaleDateString('pt-BR')} —{' '}
              {new Date(data.periodo.fim).toLocaleDateString('pt-BR')}
            </div>
          </div>

          {/* KPIs principais */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPI label="Receita do Mês" value={fmt(receitaTotal)} sub={`${data.vendas.totalCount + data.servicos.totalCount} transações`} color="text-green-400" />
            <KPI label="Vendas (motos/peças)" value={fmt(data.vendas.totalValor)} sub={`${data.vendas.totalCount} vendas`} />
            <KPI label="Serviços (OS)" value={fmt(data.servicos.totalValor)} sub={`${data.servicos.totalCount} OS`} />
            <KPI label="A Receber (em aberto)" value={fmt(aReceberPendente)} sub={`${data.financeiro.contasReceber.count} lançamentos`} color="text-yellow-400" />
          </div>

          {/* Estoque */}
          <div>
            <h2 className="text-sm font-semibold text-zinc-400 mb-3 uppercase tracking-wider">Estoque</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPI label="Total Motos" value={String(data.estoque.totalMotos)} sub="unidades" color="text-orange-400" />
              <KPI label="Total Peças" value={String(data.estoque.totalPecas)} sub="itens" />
              <KPI label="Valor em Estoque" value={fmt(data.estoque.valorEstoque)} sub="pelo preço de venda" />
              <KPI label="Itens Cadastrados" value={String(data.estoque.itens)} sub="produtos no estoque" />
            </div>
          </div>

          {/* Financeiro */}
          <div>
            <h2 className="text-sm font-semibold text-zinc-400 mb-3 uppercase tracking-wider">Financeiro</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPI label="Contas a Pagar" value={fmt(data.financeiro.contasPagar.total)} sub={`${data.financeiro.contasPagar.count} lançamentos`} color="text-red-400" />
              <KPI label="A Pagar (pendente)" value={fmt(aPagarPendente)} sub="em aberto" color="text-red-300" />
              <KPI label="Contas a Receber" value={fmt(data.financeiro.contasReceber.total)} sub={`${data.financeiro.contasReceber.count} lançamentos`} color="text-green-400" />
              <KPI label="A Receber (pendente)" value={fmt(aReceberPendente)} sub="em aberto" color="text-yellow-400" />
            </div>
          </div>

          {/* Fiscal */}
          <div>
            <h2 className="text-sm font-semibold text-zinc-400 mb-3 uppercase tracking-wider">Fiscal (Mês)</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-zinc-900 rounded-xl p-5">
                <div className="text-zinc-400 text-xs mb-1">NF Entradas</div>
                <div className="text-2xl font-bold text-green-400">{fmt(data.fiscal.notasEntrada.total)}</div>
                <div className="text-zinc-500 text-xs mt-1">{data.fiscal.notasEntrada.count} notas</div>
              </div>
              <div className="bg-zinc-900 rounded-xl p-5">
                <div className="text-zinc-400 text-xs mb-1">NF Saídas</div>
                <div className="text-2xl font-bold text-orange-400">{fmt(data.fiscal.notasSaida.total)}</div>
                <div className="text-zinc-500 text-xs mt-1">{data.fiscal.notasSaida.count} notas</div>
              </div>
            </div>
          </div>

          {/* Atividade recente */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Últimas vendas */}
            <div className="bg-zinc-900 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-zinc-300 mb-3">Últimas Vendas</h3>
              {data.ultimasVendas.length === 0 ? (
                <div className="text-zinc-500 text-sm text-center py-4">Nenhuma venda</div>
              ) : (
                <div className="space-y-2">
                  {data.ultimasVendas.map(v => (
                    <div key={v.id} className="flex justify-between items-center text-sm">
                      <div>
                        <div className="text-white">{v.cliente?.nome ?? 'Sem cliente'}</div>
                        <div className="text-zinc-500 text-xs">{new Date(v.createdAt).toLocaleDateString('pt-BR')}</div>
                      </div>
                      <div className="text-green-400 font-medium">{fmt(Number(v.valorTotal))}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Últimas OS */}
            <div className="bg-zinc-900 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-zinc-300 mb-3">Últimas Ordens de Serviço</h3>
              {data.ultimasOS.length === 0 ? (
                <div className="text-zinc-500 text-sm text-center py-4">Nenhuma OS</div>
              ) : (
                <div className="space-y-2">
                  {data.ultimasOS.map(os => (
                    <div key={os.id} className="flex justify-between items-center text-sm">
                      <div>
                        <div className="text-white">{os.cliente?.nome ?? 'Sem cliente'}</div>
                        <div className="text-zinc-500 text-xs">{new Date(os.createdAt).toLocaleDateString('pt-BR')} · {os.status}</div>
                      </div>
                      <div className="text-orange-400 font-medium">{fmt(Number(os.valorTotal ?? 0))}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
