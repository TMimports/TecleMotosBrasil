import { useEffect, useState, useMemo } from 'react';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { CustomSelect } from '../components/CustomSelect';

interface Comissao {
  id: number;
  usuarioId: number;
  vendaId: number | null;
  ordemServicoId: number | null;
  tipo: string;
  valor: number;
  periodo: string;
  pago: boolean;
  dataPago: string | null;
  createdAt: string;
  usuario: { id: number; nome: string; role: string };
  venda?: { id: number };
  ordemServico?: { id: number; numero: string };
}

export function Comissoes() {
  const { user } = useAuth();
  const [comissoes, setComissoes] = useState<Comissao[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState<'todas' | 'pendentes' | 'pagas'>('todas');
  const [filtroMes, setFiltroMes] = useState<string>('');
  const [filtroColaborador, setFiltroColaborador] = useState<string>('');
  const [filtroTipo, setFiltroTipo] = useState<string>('');

  const isAdmin = user?.role === 'ADMIN_GERAL' || user?.role === 'DONO_LOJA' || user?.role === 'GERENTE_LOJA';

  const loadData = () => {
    setLoading(true);
    api.get<Comissao[]>('/financeiro/comissoes')
      .then(setComissoes)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const marcarPago = async (id: number) => {
    try {
      await api.put(`/financeiro/comissoes/${id}/pagar`, {});
      loadData();
    } catch (err) {
      console.error(err);
      alert('Erro ao marcar como pago');
    }
  };

  const colaboradores = useMemo(() => {
    const unique = new Map<number, string>();
    comissoes.forEach(c => {
      if (c.usuario) unique.set(c.usuario.id, c.usuario.nome);
    });
    return Array.from(unique.entries()).map(([id, nome]) => ({ id, nome }));
  }, [comissoes]);

  const mesesDisponiveis = useMemo(() => {
    const meses = new Set<string>();
    comissoes.forEach(c => {
      const data = new Date(c.createdAt);
      const mes = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
      meses.add(mes);
    });
    return Array.from(meses).sort().reverse();
  }, [comissoes]);

  const comissoesFiltradas = useMemo(() => {
    return comissoes.filter(c => {
      if (filtroStatus === 'pendentes' && c.pago) return false;
      if (filtroStatus === 'pagas' && !c.pago) return false;
      
      if (filtroMes) {
        const data = new Date(c.createdAt);
        const mes = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
        if (mes !== filtroMes) return false;
      }
      
      if (filtroColaborador && c.usuarioId !== Number(filtroColaborador)) return false;
      
      if (filtroTipo && c.tipo !== filtroTipo) return false;
      
      return true;
    });
  }, [comissoes, filtroStatus, filtroMes, filtroColaborador, filtroTipo]);

  const totalPendente = comissoesFiltradas.filter(c => !c.pago).reduce((acc, c) => acc + Number(c.valor), 0);
  const totalPago = comissoesFiltradas.filter(c => c.pago).reduce((acc, c) => acc + Number(c.valor), 0);
  const totalGeral = totalPendente + totalPago;

  const limparFiltros = () => {
    setFiltroStatus('todas');
    setFiltroMes('');
    setFiltroColaborador('');
    setFiltroTipo('');
  };

  const formatMes = (mes: string) => {
    const [ano, m] = mes.split('-');
    const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${meses[parseInt(m) - 1]}/${ano}`;
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">Carregando...</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Comissoes</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card">
          <p className="text-gray-400 text-sm">Total Geral</p>
          <p className="text-2xl font-bold text-orange-400">
            R$ {totalGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Total Pendente</p>
          <p className="text-2xl font-bold text-yellow-400">
            R$ {totalPendente.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Total Pago</p>
          <p className="text-2xl font-bold text-green-400">
            R$ {totalPago.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="card">
          <p className="text-gray-400 text-sm">Registros</p>
          <p className="text-2xl font-bold">{comissoesFiltradas.length}</p>
        </div>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[150px]">
            <CustomSelect
              label="Mes"
              value={filtroMes}
              onChange={(val) => setFiltroMes(val)}
              placeholder="Todos os meses"
              options={[
                { value: '', label: 'Todos os meses' },
                ...mesesDisponiveis.map(mes => ({ value: mes, label: formatMes(mes) }))
              ]}
            />
          </div>
          
          <div className="flex-1 min-w-[150px]">
            <CustomSelect
              label="Colaborador"
              value={filtroColaborador}
              onChange={(val) => setFiltroColaborador(val)}
              placeholder="Todos"
              options={[
                { value: '', label: 'Todos' },
                ...colaboradores.map(c => ({ value: String(c.id), label: c.nome }))
              ]}
            />
          </div>
          
          <div className="flex-1 min-w-[150px]">
            <CustomSelect
              label="Tipo"
              value={filtroTipo}
              onChange={(val) => setFiltroTipo(val)}
              placeholder="Todos"
              options={[
                { value: '', label: 'Todos' },
                { value: 'vendedor', label: 'Vendedor' },
                { value: 'tecnico', label: 'Tecnico' }
              ]}
            />
          </div>
          
          <div className="flex-1 min-w-[150px]">
            <CustomSelect
              label="Status"
              value={filtroStatus}
              onChange={(val) => setFiltroStatus(val as any)}
              placeholder="Todas"
              options={[
                { value: 'todas', label: 'Todas' },
                { value: 'pendentes', label: 'Pendentes' },
                { value: 'pagas', label: 'Pagas' }
              ]}
            />
          </div>
          
          <button onClick={limparFiltros} className="btn btn-secondary">
            Limpar Filtros
          </button>
        </div>
      </div>

      {comissoesFiltradas.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          Nenhuma comissao encontrada
        </div>
      ) : (
        <div className="space-y-3">
          {comissoesFiltradas.map(com => (
            <div key={com.id} className="card">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-white">{com.usuario?.nome}</span>
                  <span className={`badge ${com.tipo === 'vendedor' ? 'badge-success' : 'badge-info'}`}>
                    {com.tipo === 'vendedor' ? 'Vendedor' : 'Tecnico'}
                  </span>
                  <span className={`badge ${com.pago ? 'badge-success' : 'badge-warning'}`}>
                    {com.pago ? 'Pago' : 'Pendente'}
                  </span>
                </div>
                {isAdmin && !com.pago && (
                  <button onClick={() => marcarPago(com.id)} className="btn btn-sm btn-success">
                    Pagar
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-gray-500 text-xs">Referencia</p>
                  <p className="text-gray-300">
                    {com.vendaId ? `Venda #${com.vendaId}` : com.ordemServicoId ? `OS #${com.ordemServico?.numero || com.ordemServicoId}` : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Data</p>
                  <p className="text-gray-300">{new Date(com.createdAt).toLocaleDateString('pt-BR')}</p>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <p className="text-gray-500 text-xs">Valor</p>
                  <p className="text-xl font-bold text-green-400">
                    R$ {Number(com.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
