import { useEffect, useState, useCallback } from 'react';
import { api } from '../services/api';
import { Modal } from '../components/Modal';
import { Button, Input, Select } from '../components/ui';
import { useLojaContext } from '../contexts/LojaContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Categoria { id: number; nome: string }
interface Departamento { id: number; nome: string }
interface Loja { id: number; nomeFantasia: string }
interface Cliente { id: number; nome: string }

interface ContaReceber {
  id: number;
  lojaId: number;
  clienteId: number | null;
  vendaId: number | null;
  descricao: string;
  observacoes: string | null;
  valor: number;
  valorRecebido: number;
  vencimento: string;
  status: string;
  numeroParcelas: number;
  pago: boolean;
  dataPago: string | null;
  recorrente: boolean;
  recorrencia: string | null;
  createdAt: string;
  categoriaId: number | null;
  departamentoId: number | null;
  categoria?: Categoria | null;
  departamento?: Departamento | null;
  loja?: { id: number; nomeFantasia: string };
  cliente?: Cliente | null;
}

interface Resumo { totalAberto: number; totalRecebido: number }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(val: number) {
  return val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(dt: string) {
  return new Date(dt).toLocaleDateString('pt-BR');
}

function isVencido(vencimento: string, pago: boolean) {
  if (pago) return false;
  return new Date(vencimento) < new Date();
}

function statusBadge(conta: ContaReceber) {
  if (conta.pago) return <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">Recebido</span>;
  if (isVencido(conta.vencimento, conta.pago)) return <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400">Vencido</span>;
  if (conta.status === 'PARCIAL') return <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400">Parcial</span>;
  return <span className="px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-400">Pendente</span>;
}

const recorrencias = [
  { value: 'SEMANAL', label: 'Semanal (52x)' },
  { value: 'QUINZENAL', label: 'Quinzenal (26x)' },
  { value: 'MENSAL', label: 'Mensal (12x)' },
  { value: 'SEMESTRAL', label: 'Semestral (4x)' },
  { value: 'ANUAL', label: 'Anual (2x)' }
];

const formasPagamento = [
  { value: 'PIX', label: 'PIX' },
  { value: 'DINHEIRO', label: 'Dinheiro' },
  { value: 'CARTAO_DEBITO', label: 'Cartão Débito' },
  { value: 'CARTAO_CREDITO', label: 'Cartão Crédito' },
];

const initialForm = {
  lojaId: '',
  clienteId: '',
  categoriaId: '',
  departamentoId: '',
  descricao: '',
  observacoes: '',
  valor: '',
  vencimento: '',
  numeroParcelas: '1',
  recorrente: false,
  recorrencia: 'MENSAL'
};

// ── Modal Recebimento ─────────────────────────────────────────────────────────

function ModalReceber({ conta, onClose, onSuccess }: { conta: ContaReceber; onClose: () => void; onSuccess: () => void }) {
  const [valor, setValor] = useState(String(Number(conta.valor) - Number(conta.valorRecebido)));
  const [forma, setForma] = useState('PIX');
  const [obs, setObs] = useState('');
  const [saving, setSaving] = useState(false);

  const handleReceber = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.put(`/financeiro/contas-receber/${conta.id}/receber`, {
        valor: Number(valor),
        formaPagamento: forma,
        observacoes: obs || undefined
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Receber: ${conta.descricao}`}>
      <form onSubmit={handleReceber} className="space-y-4">
        <div className="bg-zinc-800/50 rounded p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-gray-400">Valor total</span><span className="text-white font-medium">R$ {fmt(Number(conta.valor))}</span></div>
          <div className="flex justify-between"><span className="text-gray-400">Já recebido</span><span className="text-green-400">R$ {fmt(Number(conta.valorRecebido))}</span></div>
          <div className="flex justify-between"><span className="text-gray-400">Saldo restante</span><span className="text-green-400 font-bold">R$ {fmt(Number(conta.valor) - Number(conta.valorRecebido))}</span></div>
        </div>
        <Input label="Valor a receber *" type="number" step="0.01" value={valor} onChange={e => setValor(e.target.value)} required />
        <Select label="Forma de recebimento *" value={forma} onChange={e => setForma(e.target.value)} options={formasPagamento} />
        <Input label="Observações" value={obs} onChange={e => setObs(e.target.value)} placeholder="Opcional" />
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button variant="success" type="submit" loading={saving}>Confirmar Recebimento</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function ContasReceber() {
  const { selectedLojaId } = useLojaContext();
  const [contas, setContas] = useState<ContaReceber[]>([]);
  const [resumo, setResumo] = useState<Resumo>({ totalAberto: 0, totalRecebido: 0 });
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [departamentos, setDepartamentos] = useState<Departamento[]>([]);
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [recebendoId, setRecebendoId] = useState<number | null>(null);
  const [editando, setEditando] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [filtro, setFiltro] = useState<'todas' | 'pendentes' | 'pagas'>('pendentes');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [mesSelecionado, setMesSelecionado] = useState(() => {
    const h = new Date();
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filtro !== 'todas') params.set('status', filtro === 'pagas' ? 'recebidas' : filtro);
      if (selectedLojaId) params.set('lojaId', String(selectedLojaId));
      const resumoParams = new URLSearchParams();
      if (selectedLojaId) resumoParams.set('lojaId', String(selectedLojaId));
      const [contasData, resumoData] = await Promise.all([
        api.get<ContaReceber[]>(`/financeiro/contas-receber?${params}`),
        api.get<Resumo>(`/financeiro/contas-receber/resumo?${resumoParams}`)
      ]);
      setContas(contasData);
      setResumo(resumoData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filtro, selectedLojaId]);

  useEffect(() => {
    loadData();
    Promise.all([
      api.get<Loja[]>('/lojas'),
      api.get<Categoria[]>('/categorias-financeiras?natureza=RECEITA&ativo=true'),
      api.get<Departamento[]>('/departamentos?ativo=true')
    ]).then(([l, c, d]) => {
      setLojas(l);
      setCategorias(c);
      setDepartamentos(d);
      if (l.length === 1) setForm(f => ({ ...f, lojaId: String(l[0].id) }));
    }).catch(console.error);
    const iv = setInterval(loadData, 30000);
    return () => clearInterval(iv);
  }, [loadData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const dados = {
        lojaId: Number(form.lojaId),
        clienteId: form.clienteId ? Number(form.clienteId) : null,
        categoriaId: form.categoriaId ? Number(form.categoriaId) : null,
        departamentoId: form.departamentoId ? Number(form.departamentoId) : null,
        descricao: form.descricao,
        observacoes: form.observacoes || null,
        valor: Number(form.valor),
        vencimento: form.vencimento,
        numeroParcelas: Number(form.numeroParcelas) || 1,
        recorrente: form.recorrente,
        recorrencia: form.recorrente ? form.recorrencia : null
      };
      if (editando) {
        await api.put(`/financeiro/contas-receber/${editando}`, dados);
      } else {
        await api.post('/financeiro/contas-receber', dados);
      }
      setModalOpen(false);
      setEditando(null);
      setForm({ ...initialForm, lojaId: lojas.length === 1 ? String(lojas[0].id) : '' });
      loadData();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEditar = (conta: ContaReceber) => {
    setEditando(conta.id);
    setForm({
      lojaId: String(conta.lojaId),
      clienteId: conta.clienteId ? String(conta.clienteId) : '',
      categoriaId: conta.categoriaId ? String(conta.categoriaId) : '',
      departamentoId: conta.departamentoId ? String(conta.departamentoId) : '',
      descricao: conta.descricao,
      observacoes: conta.observacoes || '',
      valor: String(conta.valor),
      vencimento: conta.vencimento.split('T')[0],
      numeroParcelas: String(conta.numeroParcelas || 1),
      recorrente: conta.recorrente,
      recorrencia: conta.recorrencia || 'MENSAL'
    });
    setModalOpen(true);
  };

  const handleExcluir = async (id: number) => {
    if (!confirm('Excluir esta conta a receber?')) return;
    try {
      await api.delete(`/financeiro/contas-receber/${id}`);
      loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const contasFiltradas = contas.filter(c => {
    const venc = new Date(c.vencimento);
    const mes = `${venc.getFullYear()}-${String(venc.getMonth() + 1).padStart(2, '0')}`;
    const catOk = !filtroCategoria || String(c.categoriaId) === filtroCategoria;
    return mes === mesSelecionado && catOk;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Contas a Receber</h1>
          <p className="text-gray-400 text-sm mt-1">Controle de recebíveis e pagamentos de clientes</p>
        </div>
        <Button variant="primary" onClick={() => { setEditando(null); setForm({ ...initialForm, lojaId: lojas.length === 1 ? String(lojas[0].id) : '' }); setModalOpen(true); }}>
          + Nova Conta
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="card bg-green-500/5 border border-green-500/20">
          <p className="text-gray-400 text-xs">Total a Receber</p>
          <p className="text-xl font-bold text-green-400">R$ {fmt(resumo.totalAberto)}</p>
        </div>
        <div className="card bg-blue-500/5 border border-blue-500/20">
          <p className="text-gray-400 text-xs">Total Recebido</p>
          <p className="text-xl font-bold text-blue-400">R$ {fmt(resumo.totalRecebido)}</p>
        </div>
        <div className="card bg-zinc-800/50">
          <p className="text-gray-400 text-xs">Neste Mês</p>
          <p className="text-xl font-bold text-white">
            R$ {fmt(contasFiltradas.reduce((acc, c) => acc + Number(c.valor), 0))}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        <Input
          type="month"
          value={mesSelecionado}
          onChange={e => setMesSelecionado(e.target.value)}
        />
        <div className="flex gap-1 bg-zinc-900 rounded-lg p-1">
          {(['pendentes', 'pagas', 'todas'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${filtro === f ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {f === 'pendentes' ? 'Pendentes' : f === 'pagas' ? 'Recebidas' : 'Todas'}
            </button>
          ))}
        </div>
        <select
          value={filtroCategoria}
          onChange={e => setFiltroCategoria(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded px-3 py-2"
        >
          <option value="">Todas as categorias</option>
          {categorias.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </div>

      {/* Tabela */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[750px] text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-zinc-800">
                <th className="pb-3 pr-4 font-medium">Descrição / Cliente</th>
                <th className="pb-3 pr-4 font-medium">Categoria</th>
                <th className="pb-3 pr-4 font-medium">Loja</th>
                <th className="pb-3 pr-4 font-medium">Parcelas</th>
                <th className="pb-3 pr-4 font-medium">Valor</th>
                <th className="pb-3 pr-4 font-medium">Vencimento</th>
                <th className="pb-3 pr-4 font-medium">Status</th>
                <th className="pb-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-12 text-center text-gray-500">Carregando...</td></tr>
              ) : contasFiltradas.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-gray-500">Nenhuma conta encontrada</td></tr>
              ) : (
                contasFiltradas.map(conta => (
                  <tr key={conta.id} className={`border-b border-zinc-800/50 hover:bg-zinc-800/20 ${isVencido(conta.vencimento, conta.pago) ? 'bg-red-500/5' : ''}`}>
                    <td className="py-3 pr-4">
                      <p className="text-white font-medium">{conta.descricao}</p>
                      {conta.cliente && <p className="text-gray-500 text-xs">{conta.cliente.nome}</p>}
                      {conta.vendaId && <p className="text-gray-500 text-xs">Venda #{conta.vendaId}</p>}
                    </td>
                    <td className="py-3 pr-4">
                      {conta.categoria
                        ? <span className="px-2 py-0.5 rounded text-xs bg-zinc-700 text-gray-300">{conta.categoria.nome}</span>
                        : <span className="text-gray-600 text-xs">—</span>}
                    </td>
                    <td className="py-3 pr-4 text-gray-300">{conta.loja?.nomeFantasia || '-'}</td>
                    <td className="py-3 pr-4 text-gray-300 text-center">
                      {conta.numeroParcelas > 1 ? `${conta.numeroParcelas}x` : '1x'}
                    </td>
                    <td className="py-3 pr-4">
                      <p className="font-semibold text-green-400">R$ {fmt(Number(conta.valor))}</p>
                      {Number(conta.valorRecebido) > 0 && !conta.pago && (
                        <p className="text-xs text-green-500">Recebido: R$ {fmt(Number(conta.valorRecebido))}</p>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-gray-300">{fmtDate(conta.vencimento)}</td>
                    <td className="py-3 pr-4">{statusBadge(conta)}</td>
                    <td className="py-3">
                      <div className="flex gap-1">
                        {!conta.pago && !conta.vendaId && (
                          <Button variant="secondary" size="sm" onClick={() => handleEditar(conta)}>Editar</Button>
                        )}
                        {!conta.pago && (
                          <Button variant="success" size="sm" onClick={() => setRecebendoId(conta.id)}>Receber</Button>
                        )}
                        {!conta.pago && !conta.vendaId && (
                          <Button variant="danger" size="sm" onClick={() => handleExcluir(conta.id)}>Del</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Receber */}
      {recebendoId !== null && (() => {
        const conta = contas.find(c => c.id === recebendoId);
        if (!conta) return null;
        return (
          <ModalReceber
            conta={conta}
            onClose={() => setRecebendoId(null)}
            onSuccess={() => { loadData(); setRecebendoId(null); }}
          />
        );
      })()}

      {/* Modal Criar/Editar */}
      <Modal
        isOpen={modalOpen}
        onClose={() => { setModalOpen(false); setEditando(null); }}
        title={editando ? 'Editar Conta a Receber' : 'Nova Conta a Receber'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Loja *"
              value={form.lojaId}
              onChange={e => setForm({ ...form, lojaId: e.target.value })}
              required
              placeholder="Selecione"
              options={lojas.map(l => ({ value: l.id, label: l.nomeFantasia }))}
            />
            <Select
              label="Categoria"
              value={form.categoriaId}
              onChange={e => setForm({ ...form, categoriaId: e.target.value })}
              placeholder="Selecione"
              options={[{ value: '', label: 'Sem categoria' }, ...categorias.map(c => ({ value: c.id, label: c.nome }))]}
            />
          </div>

          <Select
            label="Departamento"
            value={form.departamentoId}
            onChange={e => setForm({ ...form, departamentoId: e.target.value })}
            placeholder="Selecione"
            options={[{ value: '', label: 'Sem departamento' }, ...departamentos.map(d => ({ value: d.id, label: d.nome }))]}
          />

          <Input
            label="Descrição *"
            value={form.descricao}
            onChange={e => setForm({ ...form, descricao: e.target.value })}
            required
            placeholder="Ex: Mensalidade contrato X"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Valor Total *"
              type="number"
              step="0.01"
              value={form.valor}
              onChange={e => setForm({ ...form, valor: e.target.value })}
              required
            />
            <Input
              label="1º Vencimento *"
              type="date"
              value={form.vencimento}
              onChange={e => setForm({ ...form, vencimento: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Nº de Parcelas"
              type="number"
              min="1"
              max="60"
              value={form.numeroParcelas}
              onChange={e => setForm({ ...form, numeroParcelas: e.target.value })}
            />
            <div className="flex items-end pb-1">
              {Number(form.numeroParcelas) > 1 && form.valor && (
                <p className="text-xs text-gray-400">
                  {form.numeroParcelas}x de R$ {fmt(Number(form.valor) / Number(form.numeroParcelas))}
                </p>
              )}
            </div>
          </div>

          <Input
            label="Observações"
            value={form.observacoes}
            onChange={e => setForm({ ...form, observacoes: e.target.value })}
            placeholder="Opcional"
          />

          {!editando && (
            <>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.recorrente}
                    onChange={e => setForm({ ...form, recorrente: e.target.checked })}
                    className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-orange-500"
                  />
                  <span className="text-sm text-gray-300">Conta Recorrente</span>
                </label>
              </div>
              {form.recorrente && (
                <Select
                  label="Frequência"
                  value={form.recorrencia}
                  onChange={e => setForm({ ...form, recorrencia: e.target.value })}
                  options={recorrencias}
                />
              )}
            </>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-800">
            <Button variant="ghost" type="button" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button variant="primary" type="submit" loading={saving}>
              {editando ? 'Salvar' : 'Cadastrar'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
