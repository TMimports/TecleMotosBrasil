import { useEffect, useState, useCallback } from 'react';
import { api } from '../services/api';
import { useLojaContext } from '../contexts/LojaContext';

interface Garantia {
  id: number;
  tipo: string;
  tipoGarantia?: string;
  dataInicio: string;
  dataFim: string;
  ativa: boolean;
  revisaoFeita: boolean;
  unidade?: {
    chassi?: string;
    codigoMotor?: string;
    produto: { nome: string };
    loja?: { nomeFantasia: string };
  } | null;
  cliente?: { id: number; nome: string; telefone?: string; cpfCnpj?: string };
  venda?: {
    id: number;
    createdAt: string;
    itens?: { produto?: { nome: string; tipo: string } }[];
    loja?: { nomeFantasia: string };
  };
}

interface HistoricoVenda {
  id: number;
  createdAt: string;
  valorTotal: number;
  formaPagamento: string;
  loja?: { nomeFantasia: string };
  itens?: { produto?: { nome: string; tipo: string }; servico?: { nome: string } }[];
}

interface ClienteGrupo {
  key: string;
  clienteId: number;
  clienteNome: string;
  telefone: string;
  cpfCnpj: string;
  produto: string;
  chassi: string;
  motor: string;
  vendaId: number;
  dataInicio: string;
  garantias: Garantia[];
}

interface ConfirmarRevisaoState {
  garantiaId: number;
  novoValor: boolean;
  cliente: string;
  produto: string;
  chassi: string;
  motor: string;
}

export function Garantias() {
  const { selectedLojaId } = useLojaContext();
  const [garantias, setGarantias] = useState<Garantia[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<'todas' | 'ativas' | 'vencendo' | 'expiradas'>('todas');
  const [buscaGarantia, setBuscaGarantia] = useState('');
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [historicoMap, setHistoricoMap] = useState<Record<number, HistoricoVenda[]>>({});
  const [historicoLoading, setHistoricoLoading] = useState<Record<number, boolean>>({});
  const [confirmarRevisao, setConfirmarRevisao] = useState<ConfirmarRevisaoState | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    const url = selectedLojaId ? `/garantias?lojaId=${selectedLojaId}` : '/garantias';
    api.get<Garantia[]>(url)
      .then(setGarantias)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedLojaId]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  const calcularDiasRestantes = (dataFim: string): number => {
    const fim = new Date(dataFim);
    const hoje = new Date();
    return Math.ceil((fim.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
  };

  // Regra da 1ª revisão: verifica se passou mais de 90+15 dias da data de início sem revisão feita
  const primeiraRevisaoVencida = (grupo: ClienteGrupo): boolean => {
    const inicio = new Date(grupo.dataInicio);
    const prazo = new Date(inicio);
    prazo.setDate(prazo.getDate() + 105); // 90 dias + 15 dias de tolerância
    return new Date() > prazo && !grupo.garantias.some(g => g.revisaoFeita);
  };

  const loadHistoricoCliente = useCallback(async (clienteId: number) => {
    if (historicoMap[clienteId] !== undefined) return;
    setHistoricoLoading(prev => ({ ...prev, [clienteId]: true }));
    try {
      const data = await api.get<HistoricoVenda[]>(`/vendas?clienteId=${clienteId}`);
      setHistoricoMap(prev => ({ ...prev, [clienteId]: data }));
    } catch { /* silencioso */ }
    finally {
      setHistoricoLoading(prev => ({ ...prev, [clienteId]: false }));
    }
  }, [historicoMap]);

  const toggleExpandido = (key: string, clienteId: number) => {
    setExpandidos(prev => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); loadHistoricoCliente(clienteId); }
      return next;
    });
  };

  const iniciarConfirmarRevisao = (g: Garantia, novoValor: boolean, grupo: ClienteGrupo) => {
    setConfirmarRevisao({
      garantiaId: g.id,
      novoValor,
      cliente: grupo.clienteNome,
      produto: grupo.produto,
      chassi: grupo.chassi,
      motor: grupo.motor,
    });
  };

  const confirmarEfetivarRevisao = async () => {
    if (!confirmarRevisao) return;
    try {
      await api.put(`/garantias/${confirmarRevisao.garantiaId}/revisao`, { revisaoFeita: confirmarRevisao.novoValor });
      setConfirmarRevisao(null);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Erro ao atualizar revisão');
    }
  };

  const excluirGarantia = async (id: number) => {
    if (!confirm('Tem certeza que deseja excluir esta garantia?')) return;
    try {
      await api.delete(`/garantias/${id}`);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Erro ao excluir');
    }
  };

  const garantiasAtivas = garantias.filter(g => g.ativa);

  const garantiasFiltradas = garantias.filter(g => {
    if (!g.ativa) return false;
    const dias = calcularDiasRestantes(g.dataFim);
    if (filtro === 'ativas') return dias > 5;
    if (filtro === 'vencendo') return dias > 0 && dias <= 5;
    if (filtro === 'expiradas') return dias <= 0;
    return true;
  });

  // Construir grupos
  const todosGrupos: ClienteGrupo[] = [];
  for (const g of garantiasFiltradas) {
    const key = `${g.cliente?.nome || '-'}_${g.venda?.id || 0}`;
    let grupo = todosGrupos.find(gr => gr.key === key);
    if (!grupo) {
      const chassi = g.unidade?.chassi || '';
      const motor = g.unidade?.codigoMotor || '';
      grupo = {
        key,
        clienteId: g.cliente?.id || 0,
        clienteNome: g.cliente?.nome || '-',
        telefone: g.cliente?.telefone || '-',
        cpfCnpj: g.cliente?.cpfCnpj || '',
        produto: g.unidade?.produto?.nome || g.venda?.itens?.find(i => i.produto?.tipo === 'MOTO')?.produto?.nome || 'Produto',
        chassi,
        motor,
        vendaId: g.venda?.id || 0,
        dataInicio: g.dataInicio,
        garantias: []
      };
      todosGrupos.push(grupo);
    }
    grupo.garantias.push(g);
  }

  // Aplicar busca por texto
  const grupos = buscaGarantia
    ? todosGrupos.filter(gr => {
        const q = buscaGarantia.toLowerCase();
        const qDigits = buscaGarantia.replace(/\D/g, '');
        return (
          gr.clienteNome.toLowerCase().includes(q) ||
          gr.produto.toLowerCase().includes(q) ||
          gr.chassi.toLowerCase().includes(q) ||
          gr.motor.toLowerCase().includes(q) ||
          (gr.cpfCnpj && qDigits && gr.cpfCnpj.replace(/\D/g, '').includes(qDigits)) ||
          gr.garantias.some(g => (g.tipoGarantia || g.tipo || '').toLowerCase().includes(q))
        );
      })
    : todosGrupos;

  const ativas = garantiasAtivas.filter(g => calcularDiasRestantes(g.dataFim) > 5).length;
  const vencendo = garantiasAtivas.filter(g => { const d = calcularDiasRestantes(g.dataFim); return d > 0 && d <= 5; }).length;
  const expiradas = garantiasAtivas.filter(g => calcularDiasRestantes(g.dataFim) <= 0).length;

  const getStatusGrupo = (grupo: ClienteGrupo) => {
    if (grupo.garantias.some(g => calcularDiasRestantes(g.dataFim) <= 0)) return 'expirada';
    if (grupo.garantias.some(g => { const d = calcularDiasRestantes(g.dataFim); return d > 0 && d <= 5; })) return 'vencendo';
    return 'ativa';
  };

  if (loading) return <div className="flex items-center justify-center h-64">Carregando...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Garantias</h1>
      </div>

      {/* Cards de filtro */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {[
          { key: 'todas', label: 'Total', count: garantiasAtivas.length, color: '' },
          { key: 'ativas', label: 'Ativas', count: ativas, color: 'text-green-400' },
          { key: 'vencendo', label: 'Vencendo em 5 dias', count: vencendo, color: 'text-yellow-400' },
          { key: 'expiradas', label: 'Expiradas', count: expiradas, color: 'text-red-400' },
        ].map(f => (
          <div key={f.key}
            className={`card cursor-pointer ${filtro === f.key ? 'ring-2 ring-orange-500' : ''}`}
            onClick={() => setFiltro(f.key as any)}>
            <p className="text-gray-400 text-sm">{f.label}</p>
            <p className={`text-2xl font-bold ${f.color}`}>{f.count}</p>
          </div>
        ))}
      </div>

      {/* Campo de busca */}
      <div className="mb-4">
        <input
          type="text"
          value={buscaGarantia}
          onChange={e => setBuscaGarantia(e.target.value)}
          placeholder="Buscar por cliente, chassi, modelo, motor, CPF/CNPJ ou tipo de garantia..."
          className="w-full bg-[#18181b] border border-[#27272a] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 placeholder-zinc-500"
        />
        {buscaGarantia && (
          <p className="text-xs text-zinc-500 mt-1">{grupos.length} resultado(s) para "{buscaGarantia}"</p>
        )}
      </div>

      {vencendo > 0 && (
        <div className="bg-yellow-500/20 border border-yellow-500 rounded-lg p-4 mb-4">
          <p className="text-yellow-400 font-semibold">
            Atenção! {vencendo} garantia(s) vencem nos próximos 5 dias.
          </p>
        </div>
      )}

      {grupos.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          {buscaGarantia ? `Nenhuma garantia encontrada para "${buscaGarantia}"` : 'Nenhuma garantia encontrada'}
        </div>
      ) : (
        <div className="space-y-3">
          {grupos.map(grupo => {
            const isExpanded = expandidos.has(grupo.key);
            const status = getStatusGrupo(grupo);
            const primeiraVencida = primeiraRevisaoVencida(grupo);

            return (
              <div key={grupo.key} className={`card overflow-hidden ${
                status === 'expirada' ? 'border-red-500/30' :
                status === 'vencendo' ? 'border-yellow-500/30' : ''
              }`}>
                <div className="flex items-center justify-between cursor-pointer select-none"
                  onClick={() => toggleExpandido(grupo.key, grupo.clienteId)}>
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      status === 'expirada' ? 'bg-red-500/20' :
                      status === 'vencendo' ? 'bg-yellow-500/20' : 'bg-orange-500/20'
                    }`}>
                      <span className={`font-bold text-base ${
                        status === 'expirada' ? 'text-red-400' :
                        status === 'vencendo' ? 'text-yellow-400' : 'text-orange-400'
                      }`}>{grupo.clienteNome.charAt(0).toUpperCase()}</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">{grupo.clienteNome}</h3>
                      <p className="text-xs text-gray-400">{grupo.telefone}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right hidden sm:block">
                      <p className="text-white text-sm font-medium">{grupo.produto}</p>
                      {grupo.chassi && <p className="text-xs text-gray-500 font-mono">Chassi: {grupo.chassi}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {primeiraVencida && (
                        <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-semibold hidden sm:inline">
                          1ª revisão não realizada
                        </span>
                      )}
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                        status === 'expirada' ? 'bg-red-500/20 text-red-400' :
                        status === 'vencendo' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-green-500/20 text-green-400'
                      }`}>{grupo.garantias.length} garantia{grupo.garantias.length > 1 ? 's' : ''}</span>
                      <span className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>&#9660;</span>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-zinc-700">

                    {/* Alerta 1ª revisão */}
                    {primeiraVencida && (
                      <div className="mb-3 p-3 bg-red-900/30 border border-red-500/50 rounded-lg text-sm text-red-400">
                        Garantia fora de vigência porque a primeira revisão (90 dias) não foi realizada no prazo.
                        As demais revisões estão suspensas.
                      </div>
                    )}

                    {/* Infos mobile */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4 text-sm sm:hidden">
                      <div><p className="text-gray-500 text-xs">Produto</p><p className="text-white">{grupo.produto}</p></div>
                      {grupo.chassi && <div><p className="text-gray-500 text-xs">Chassi</p><p className="text-white font-mono text-xs">{grupo.chassi}</p></div>}
                      {grupo.motor && <div><p className="text-gray-500 text-xs">Motor</p><p className="text-white font-mono text-xs">{grupo.motor}</p></div>}
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-400 text-xs border-b border-zinc-800">
                            <th className="text-left py-2 px-2">Tipo</th>
                            <th className="text-left py-2 px-2">Status</th>
                            <th className="text-left py-2 px-2">Início</th>
                            <th className="text-left py-2 px-2">Vencimento</th>
                            <th className="text-center py-2 px-2">Dias Rest.</th>
                            <th className="text-center py-2 px-2">Revisão feita</th>
                            <th className="text-right py-2 px-2">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {grupo.garantias.map(garantia => {
                            const dias = calcularDiasRestantes(garantia.dataFim);
                            const isVencendo = dias > 0 && dias <= 5;
                            const isExpirada = dias <= 0;
                            // Bloqueia revisões futuras se primeira revisão obrigatória está pendente e vencida
                            const bloqueada = primeiraVencida && !garantia.revisaoFeita;

                            return (
                              <tr key={garantia.id} className="border-b border-zinc-800/50 last:border-0">
                                <td className="py-2.5 px-2">
                                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                                    garantia.tipo === 'geral' ? 'bg-blue-500/20 text-blue-400' :
                                    garantia.tipo === 'motor' ? 'bg-purple-500/20 text-purple-400' :
                                    garantia.tipo === 'modulo' ? 'bg-cyan-500/20 text-cyan-400' :
                                    'bg-yellow-500/20 text-yellow-400'
                                  }`}>{garantia.tipoGarantia || garantia.tipo}</span>
                                </td>
                                <td className="py-2.5 px-2">
                                  {isExpirada ? <span className="text-red-400 text-xs font-semibold">Expirada</span> :
                                   isVencendo ? <span className="text-yellow-400 text-xs font-semibold">Vencendo</span> :
                                   <span className="text-green-400 text-xs font-semibold">Ativa</span>}
                                </td>
                                <td className="py-2.5 px-2 text-white">{new Date(garantia.dataInicio).toLocaleDateString('pt-BR')}</td>
                                <td className="py-2.5 px-2 text-white">{new Date(garantia.dataFim).toLocaleDateString('pt-BR')}</td>
                                <td className="py-2.5 px-2 text-center">
                                  <span className={`font-bold text-lg ${isExpirada ? 'text-red-400' : isVencendo ? 'text-yellow-400' : 'text-green-400'}`}>
                                    {isExpirada ? '0' : dias}
                                  </span>
                                </td>
                                <td className="py-2.5 px-2 text-center">
                                  <button
                                    onClick={e => { e.stopPropagation(); if (!bloqueada) iniciarConfirmarRevisao(garantia, !garantia.revisaoFeita, grupo); }}
                                    disabled={bloqueada}
                                    title={bloqueada ? 'Revisões suspensas: 1ª revisão não realizada no prazo' : ''}
                                    className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                                      bloqueada ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed' :
                                      garantia.revisaoFeita ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' :
                                      'bg-zinc-700 text-gray-400 hover:bg-zinc-600'
                                    }`}
                                  >
                                    {garantia.revisaoFeita ? 'Sim' : bloqueada ? 'Suspensa' : 'Não'}
                                  </button>
                                </td>
                                <td className="py-2.5 px-2 text-right">
                                  <button
                                    onClick={e => { e.stopPropagation(); excluirGarantia(garantia.id); }}
                                    className="px-3 py-1 rounded text-xs font-semibold bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                                  >Excluir</button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Histórico de compras */}
                    <div className="mt-4 pt-3 border-t border-zinc-700">
                      <h4 className="text-xs font-semibold text-orange-400 mb-2 uppercase tracking-wide">Histórico de Compras</h4>
                      {historicoLoading[grupo.clienteId] ? (
                        <p className="text-xs text-zinc-500">Carregando...</p>
                      ) : (historicoMap[grupo.clienteId] || []).length === 0 ? (
                        <p className="text-xs text-zinc-500">Nenhuma compra encontrada.</p>
                      ) : (
                        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                          {(historicoMap[grupo.clienteId] || []).map(v => {
                            const motos = v.itens?.filter(i => i.produto?.tipo === 'MOTO').map(i => i.produto?.nome).filter(Boolean) || [];
                            const servs = v.itens?.filter(i => i.servico).map(i => i.servico?.nome).filter(Boolean) || [];
                            const desc = [...motos, ...servs].join(', ') || 'Venda';
                            return (
                              <div key={v.id} className={`flex items-center justify-between p-2 rounded-lg text-xs ${v.id === grupo.vendaId ? 'bg-orange-500/10 border border-orange-500/30' : 'bg-zinc-800/40'}`}>
                                <div>
                                  <span className="font-mono text-zinc-400 mr-2">#{v.id}</span>
                                  <span className="text-zinc-200">{desc}</span>
                                  {v.loja && <span className="text-zinc-500 ml-2">· {v.loja.nomeFantasia}</span>}
                                  {v.id === grupo.vendaId && <span className="ml-2 text-orange-400 font-semibold text-[10px]">ESTA VENDA</span>}
                                </div>
                                <div className="text-right">
                                  <span className="text-zinc-300 font-medium">R$ {Number(v.valorTotal).toFixed(2).replace('.', ',')}</span>
                                  <span className="text-zinc-500 ml-2">{new Date(v.createdAt).toLocaleDateString('pt-BR')}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Cronograma de revisões */}
                    <div className="mt-4 pt-3 border-t border-zinc-700">
                      <h4 className="text-xs font-semibold text-gray-400 mb-2">Cronograma de Revisões (a cada 90 dias)</h4>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[90, 180, 270, 360].map((dias, idx) => {
                          const dataRev = new Date(grupo.dataInicio);
                          dataRev.setDate(dataRev.getDate() + dias);
                          const hoje = new Date();
                          const diffMs = dataRev.getTime() - hoje.getTime();
                          const diasFaltam = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                          const realizada = diasFaltam < 0;
                          const proxima = !realizada && diasFaltam <= 30;
                          // 1ª revisão em atraso sem confirmação
                          const isPrimeiraAtrasada = idx === 0 && realizada && !grupo.garantias.some(g => g.revisaoFeita);

                          return (
                            <div key={dias} className={`p-2 rounded-lg text-center ${
                              isPrimeiraAtrasada ? 'bg-red-500/10 border border-red-500/30' :
                              realizada ? 'bg-zinc-800/50' :
                              proxima ? 'bg-yellow-500/10 border border-yellow-500/30' :
                              'bg-zinc-800/30'
                            }`}>
                              <p className="text-xs text-gray-500">{idx + 1}ª Revisão ({dias} dias)</p>
                              <p className="text-sm font-semibold text-white mt-0.5">{dataRev.toLocaleDateString('pt-BR')}</p>
                              {isPrimeiraAtrasada ? (
                                <p className="text-xs text-red-400 font-bold mt-0.5">Não realizada — vencida</p>
                              ) : realizada ? (
                                <p className="text-xs text-gray-500 mt-0.5">Período encerrado</p>
                              ) : (
                                <p className={`text-xs font-bold mt-0.5 ${
                                  diasFaltam <= 7 ? 'text-red-400' :
                                  diasFaltam <= 30 ? 'text-yellow-400' : 'text-green-400'
                                }`}>{diasFaltam} dias restantes</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de confirmação de revisão */}
      {confirmarRevisao && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl w-full max-w-md">
            <div className="p-5 border-b border-[#27272a]">
              <h3 className="font-bold text-white text-lg">
                {confirmarRevisao.novoValor ? 'Efetivar revisão?' : 'Desfazer revisão?'}
              </h3>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <p className="text-zinc-400">Confirme os dados antes de prosseguir:</p>
              <div className="bg-zinc-800/60 rounded-lg p-3 space-y-1.5">
                <div className="flex justify-between"><span className="text-zinc-500">Cliente:</span><span className="text-white font-medium">{confirmarRevisao.cliente}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">Modelo:</span><span className="text-white">{confirmarRevisao.produto}</span></div>
                {confirmarRevisao.chassi && <div className="flex justify-between"><span className="text-zinc-500">Chassi:</span><span className="text-white font-mono text-xs">{confirmarRevisao.chassi}</span></div>}
                {confirmarRevisao.motor && <div className="flex justify-between"><span className="text-zinc-500">Motor:</span><span className="text-white font-mono text-xs">{confirmarRevisao.motor}</span></div>}
                <div className="flex justify-between"><span className="text-zinc-500">Data:</span><span className="text-white">{new Date().toLocaleDateString('pt-BR')}</span></div>
              </div>
              {confirmarRevisao.novoValor && (
                <p className="text-green-400 text-xs">Ao confirmar, a revisão será registrada como realizada.</p>
              )}
            </div>
            <div className="p-5 pt-0 flex gap-3 justify-end">
              <button onClick={() => setConfirmarRevisao(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">Cancelar</button>
              <button onClick={confirmarEfetivarRevisao} className={`px-4 py-2 text-sm rounded-lg font-medium text-white transition-colors ${confirmarRevisao.novoValor ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-500 hover:bg-orange-600'}`}>
                {confirmarRevisao.novoValor ? 'Confirmar Efetivação' : 'Confirmar Desfazer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
