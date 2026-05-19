import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../services/api';
import { Modal } from '../components/Modal';
import { useAuth } from '../contexts/AuthContext';
import { CustomSelect } from '../components/CustomSelect';
import { useLojaContext } from '../contexts/LojaContext';
import { buscarCNPJ } from '../services/cnpj';

interface OrdemServicoItem {
  id: number;
  quantidade: number;
  precoUnitario: number;
  produto?: { nome: string };
  servico?: { nome: string };
}

interface OrdemServicoFull {
  id: number;
  numero: string;
  tipo: string;
  status: string;
  valorTotal: number;
  desconto: number;
  motoDescricao?: string;
  observacoes?: string;
  tecnico?: string;
  cliente: { id: number; nome: string; cpfCnpj?: string; telefone?: string; endereco?: string };
  loja: { nomeFantasia: string; cnpj?: string; telefone?: string; endereco?: string };
  itens: OrdemServicoItem[];
  createdAt: string;
}

interface OrdemServico {
  id: number;
  numero: string;
  tipo: string;
  status: string;
  valorTotal: number;
  confirmadaFinanceiro: boolean;
  cliente: { nome: string };
  tecnico?: string;
  createdAt: string;
}

interface Cliente {
  id: number;
  nome: string;
}

interface Servico {
  id: number;
  nome: string;
  preco: number;
  duracao: number | null;
}

interface Produto {
  id: number;
  nome: string;
  preco: number;
  tipo: string;
  estoque: number;
}

interface Loja {
  id: number;
  nomeFantasia: string;
}

interface Usuario {
  id: number;
  nome: string;
  role: string;
}

interface ItemServico {
  servicoId: string;
  quantidade: number;
  preco: number;
}

interface ItemPeca {
  produtoId: string;
  quantidade: number;
  preco: number;
}

interface ConfigDescontos {
  descontoMaxPeca: number;
  descontoMaxServico: number;
  descontoMaxOS: number;
}

export function OrdensServico() {
  const { user } = useAuth();
  const { selectedLojaId } = useLojaContext();
  const [ordens, setOrdens] = useState<OrdemServico[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [tecnicos, setTecnicos] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [osDetalhada, setOsDetalhada] = useState<OrdemServicoFull | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const [configDescontos, setConfigDescontos] = useState<ConfigDescontos>({ descontoMaxPeca: 10, descontoMaxServico: 10, descontoMaxOS: 10 });
  
  const [form, setForm] = useState({
    clienteId: '',
    lojaId: '',
    tecnicoId: '',
    motoModelo: '',
    motoDescricao: '',
    motoChassi: '',
    motoMotor: '',
    observacoes: '',
    tipo: 'OS',
    desconto: '0',
    descontoServico: '0',
    garantiaId: '',
  });
  const [formErro, setFormErro] = useState('');

  // ── Garantias para Acionamento ───────────────────────────────────────────
  const [garantias, setGarantias] = useState<any[]>([]);
  const [garantiaBusca, setGarantiaBusca] = useState('');
  const [garantiasLoading, setGarantiasLoading] = useState(false);

  // ── Laudo ────────────────────────────────────────────────────────────────
  const [laudoOsId, setLaudoOsId] = useState<number | null>(null);
  const [laudoForm, setLaudoForm] = useState({ parecerTecnico: '', parecerAdmin: '', responsavelTecnico: '', responsavelAdmin: '', statusLaudo: 'EM_ANALISE' });
  const [laudoSaving, setLaudoSaving] = useState(false);

  // ── + Novo Cliente na OS ─────────────────────────────────────────────────
  const [showQuickClienteOS, setShowQuickClienteOS] = useState(false);
  const [quickClienteOS, setQuickClienteOS] = useState({
    nome: '', cpfCnpj: '', telefone: '', email: '',
    cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: ''
  });
  const [quickClienteOSLoading, setQuickClienteOSLoading] = useState(false);
  const [quickClienteOSErro, setQuickClienteOSErro] = useState('');
  const [osQuickBuscandoDoc, setOsQuickBuscandoDoc] = useState(false);
  const [osQuickBuscandoCep, setOsQuickBuscandoCep] = useState(false);

  const [servicosSelecionados, setServicosSelecionados] = useState<ItemServico[]>([]);
  const [pecasSelecionadas, setPecasSelecionadas] = useState<ItemPeca[]>([]);

  const loadProdutosLoja = async (lojaId: string) => {
    if (!lojaId) {
      setProdutos([]);
      return;
    }
    try {
      const data = await api.get<Produto[]>(`/vendas/produtos-catalogo/${lojaId}`);
      setProdutos(data.filter(p => p.tipo === 'PECA').map((p: any) => ({ id: p.id, nome: p.nome, preco: Number(p.preco), tipo: p.tipo, estoque: p.estoque || 0 })));
    } catch (err) {
      console.error('Erro ao buscar produtos da loja:', err);
    }
  };

  const loadData = useCallback(() => {
    const osUrl = selectedLojaId ? `/os?lojaId=${selectedLojaId}` : '/os';
    Promise.all([
      api.get<OrdemServico[]>(osUrl),
      api.get<Cliente[]>('/clientes'),
      api.get<Servico[]>('/servicos'),
      api.get<Loja[]>('/lojas'),
      api.get<Usuario[]>('/usuarios'),
      api.get<ConfigDescontos>('/configuracoes/public')
    ])
      .then(([ordensData, clientesData, servicosData, lojasData, usuariosData, configData]) => {
        setOrdens(ordensData);
        setClientes(clientesData);
        setServicos(servicosData);
        setLojas(lojasData);
        setTecnicos(usuariosData.filter(u => u.role === 'TECNICO'));
        if (configData) setConfigDescontos(configData);
        const preselLoja = user?.lojaId ?? (lojasData.length === 1 ? lojasData[0].id : null);
        if (preselLoja) {
          const lojaIdStr = String(preselLoja);
          setForm(f => ({ ...f, lojaId: lojaIdStr }));
          loadProdutosLoja(lojaIdStr);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedLojaId]);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  const carregarGarantias = async () => {
    if (garantias.length > 0) return;
    setGarantiasLoading(true);
    try {
      const data = await api.get<any[]>('/garantias');
      setGarantias(data);
    } catch { /* silencioso */ }
    finally { setGarantiasLoading(false); }
  };

  const salvarLaudo = async () => {
    if (!laudoOsId) return;
    setLaudoSaving(true);
    try {
      await api.put(`/os/${laudoOsId}/laudo`, laudoForm);
      setLaudoOsId(null);
      setLaudoForm({ parecerTecnico: '', parecerAdmin: '', responsavelTecnico: '', responsavelAdmin: '', statusLaudo: 'EM_ANALISE' });
      loadData();
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar laudo');
    } finally { setLaudoSaving(false); }
  };

  const osQuickBuscarCep = async (cep: string) => {
    const cepLimpo = cep.replace(/\D/g, '');
    if (cepLimpo.length !== 8) return;
    setOsQuickBuscandoCep(true);
    try {
      const data = await api.get<{ cep: string; logradouro: string; bairro: string; cidade: string; estado: string }>(
        `/clientes/buscar-cep/${cepLimpo}`
      );
      setQuickClienteOS(p => ({ ...p, cep: data.cep, logradouro: data.logradouro || '', bairro: data.bairro || '', cidade: data.cidade || '', estado: data.estado || '' }));
    } catch { /* CEP não encontrado */ }
    finally { setOsQuickBuscandoCep(false); }
  };

  const osQuickHandleDocumentoBlur = async (valor: string) => {
    const doc = valor.replace(/\D/g, '');
    if (doc.length < 11) return;
    setOsQuickBuscandoDoc(true);
    setQuickClienteOSErro('');
    try {
      const encontrado = await api.get<{ id: number; nome: string }>(`/clientes/por-documento/${doc}`).catch(() => null);
      if (encontrado) {
        setQuickClienteOSErro(`${doc.length === 11 ? 'CPF' : 'CNPJ'} já cadastrado para: ${encontrado.nome}. Não é possível duplicar.`);
        return;
      }
      if (doc.length === 14) {
        const cnpjData = await buscarCNPJ(doc);
        if (cnpjData) {
          setQuickClienteOS(p => ({
            ...p,
            nome: p.nome || cnpjData.razaoSocial,
            telefone: p.telefone || cnpjData.telefone,
            email: p.email || cnpjData.email,
            cep: p.cep || cnpjData.cep.replace(/\D/g, ''),
            bairro: p.bairro || cnpjData.bairro,
            cidade: p.cidade || cnpjData.cidade,
            estado: p.estado || cnpjData.uf
          }));
          if (cnpjData.cep) await osQuickBuscarCep(cnpjData.cep);
        }
      }
    } finally { setOsQuickBuscandoDoc(false); }
  };

  const criarClienteRapidoOS = async () => {
    setQuickClienteOSErro('');
    if (!quickClienteOS.nome.trim()) { setQuickClienteOSErro('Nome é obrigatório.'); return; }
    if (!quickClienteOS.cpfCnpj.trim()) { setQuickClienteOSErro('CPF/CNPJ é obrigatório.'); return; }
    const doc = quickClienteOS.cpfCnpj.replace(/\D/g, '');
    if (doc.length !== 11 && doc.length !== 14) { setQuickClienteOSErro('CPF deve ter 11 dígitos ou CNPJ 14 dígitos.'); return; }
    setQuickClienteOSLoading(true);
    try {
      const novo = await api.post<{ id: number; nome: string }>('/clientes', { ...quickClienteOS, nome: quickClienteOS.nome.trim() });
      setClientes(prev => [...prev, novo]);
      setForm(f => ({ ...f, clienteId: String(novo.id) }));
      setShowQuickClienteOS(false);
      setQuickClienteOS({ nome: '', cpfCnpj: '', telefone: '', email: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '' });
      setQuickClienteOSErro('');
    } catch (e: any) {
      setQuickClienteOSErro(e.message || 'Erro ao criar cliente');
    } finally { setQuickClienteOSLoading(false); }
  };

  const adicionarServico = () => {
    setServicosSelecionados([...servicosSelecionados, { servicoId: '', quantidade: 1, preco: 0 }]);
  };

  const removerServico = (index: number) => {
    setServicosSelecionados(servicosSelecionados.filter((_, i) => i !== index));
  };

  const atualizarServico = (index: number, field: string, value: any) => {
    const novos = [...servicosSelecionados];
    if (field === 'servicoId') {
      const servico = servicos.find(s => s.id === parseInt(value));
      novos[index] = { ...novos[index], servicoId: value, preco: servico?.preco || 0 };
    } else {
      novos[index] = { ...novos[index], [field]: value };
    }
    setServicosSelecionados(novos);
  };

  const adicionarPeca = () => {
    setPecasSelecionadas([...pecasSelecionadas, { produtoId: '', quantidade: 1, preco: 0 }]);
  };

  const removerPeca = (index: number) => {
    setPecasSelecionadas(pecasSelecionadas.filter((_, i) => i !== index));
  };

  const atualizarPeca = (index: number, field: string, value: any) => {
    const novas = [...pecasSelecionadas];
    if (field === 'produtoId') {
      const produto = produtos.find(p => p.id === parseInt(value));
      novas[index] = { ...novas[index], produtoId: value, preco: produto?.preco || 0 };
    } else {
      novas[index] = { ...novas[index], [field]: value };
    }
    setPecasSelecionadas(novas);
  };

  const calcularTotal = () => {
    const totalServicos = servicosSelecionados.reduce((acc, s) => acc + (s.preco * s.quantidade), 0);
    const totalPecas = pecasSelecionadas.reduce((acc, p) => acc + (p.preco * p.quantidade), 0);
    const descontoServicos = totalServicos * Number(form.descontoServico) / 100;
    const descontoPecas = totalPecas * Number(form.desconto) / 100;
    return totalServicos - descontoServicos + totalPecas - descontoPecas;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErro('');

    if (!form.clienteId) {
      setFormErro('Selecione um cliente antes de continuar.');
      return;
    }

    if (!form.lojaId) {
      setFormErro('Selecione uma loja antes de continuar.');
      return;
    }

    if (servicosSelecionados.length === 0 && pecasSelecionadas.length === 0) {
      setFormErro('Adicione pelo menos um serviço ou peça.');
      return;
    }

    setSaving(true);
    try {
      const itens: any[] = [];

      servicosSelecionados.forEach(s => {
        if (s.servicoId) {
          itens.push({
            servicoId: parseInt(s.servicoId),
            quantidade: s.quantidade,
            precoUnitario: s.preco,
            desconto: Number(form.descontoServico) || 0
          });
        }
      });

      pecasSelecionadas.forEach(p => {
        if (p.produtoId) {
          itens.push({
            produtoId: parseInt(p.produtoId),
            quantidade: p.quantidade,
            precoUnitario: p.preco,
            desconto: Number(form.desconto) || 0
          });
        }
      });

      const tecnicoSelecionado = tecnicos.find(t => t.id === parseInt(form.tecnicoId));

      // Combina os campos da moto + garantiaId em JSON estruturado
      const motoInfo = JSON.stringify({
        modelo: form.motoModelo.trim(),
        descricao: form.motoDescricao.trim(),
        chassi: form.motoChassi.trim(),
        motor: form.motoMotor.trim(),
        ...(form.tipo === 'ACIONAMENTO_GARANTIA' && form.garantiaId ? { garantiaId: Number(form.garantiaId) } : {})
      });

      const novaOs = await api.post<OrdemServicoFull>('/os', {
        clienteId: parseInt(form.clienteId),
        lojaId: parseInt(form.lojaId),
        tecnico: tecnicoSelecionado?.nome || form.tecnicoId || null,
        motoDescricao: motoInfo,
        observacoes: form.observacoes,
        tipo: form.tipo,
        desconto: Number(form.desconto) || 0,
        descontoServico: Number(form.descontoServico) || 0,
        itens
      });

      setModalOpen(false);
      setFormErro('');
      setForm({ clienteId: '', lojaId: lojas.length === 1 ? String(lojas[0].id) : '', tecnicoId: '', motoModelo: '', motoDescricao: '', motoChassi: '', motoMotor: '', observacoes: '', tipo: 'OS', desconto: '0', descontoServico: '0', garantiaId: '' });
      setGarantiaBusca('');
      setServicosSelecionados([]);
      setPecasSelecionadas([]);
      loadData();

      const osCompleta = await api.get<OrdemServicoFull>(`/os/${novaOs.id}`);
      setOsDetalhada(osCompleta);
      setViewModalOpen(true);
    } catch (err: any) {
      setFormErro(err.message || 'Erro ao salvar OS. Verifique os dados e tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const abrirVisualizacao = async (id: number) => {
    try {
      const os = await api.get<OrdemServicoFull>(`/os/${id}`);
      setOsDetalhada(os);
      setViewModalOpen(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handlePrint = () => {
    if (!printRef.current) return;
    
    const printContent = printRef.current.innerHTML;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${osDetalhada?.tipo === 'ORCAMENTO' ? 'Orcamento' : 'Ordem de Servico'} #${osDetalhada?.numero || osDetalhada?.id}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, sans-serif; padding: 20px; color: #333; }
            .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
            .header h1 { font-size: 24px; margin-bottom: 5px; }
            .header p { font-size: 12px; color: #666; }
            .info-section { display: flex; justify-content: space-between; margin-bottom: 20px; }
            .info-box { width: 48%; }
            .info-box h3 { font-size: 14px; border-bottom: 1px solid #ccc; padding-bottom: 5px; margin-bottom: 10px; }
            .info-box p { font-size: 12px; margin-bottom: 5px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th, td { border: 1px solid #ccc; padding: 8px; text-align: left; font-size: 12px; }
            th { background: #f5f5f5; }
            .total { text-align: right; font-size: 16px; font-weight: bold; }
            .obs { margin-top: 20px; padding: 10px; background: #f9f9f9; border: 1px solid #ccc; font-size: 12px; }
            .footer { margin-top: 40px; text-align: center; font-size: 10px; color: #666; }
            .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; }
            .badge-orcamento { background: #fef3c7; color: #92400e; }
            .badge-os { background: #dbeafe; color: #1e40af; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          ${printContent}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const statusLabels: Record<string, string> = {
    ORCAMENTO: 'Orcamento',
    EM_EXECUCAO: 'Em Execucao',
    EXECUTADA: 'Executada',
    ABERTA: 'Aberta',
    CONCLUIDA: 'Concluida'
  };

  const statusColors: Record<string, string> = {
    ORCAMENTO: 'badge-warning',
    EM_EXECUCAO: 'badge-primary',
    EXECUTADA: 'badge-success',
    ABERTA: 'badge-primary',
    CONCLUIDA: 'badge-success'
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">Carregando...</div>;
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold">Ordens de Servico</h1>
        <button onClick={() => setModalOpen(true)} className="btn btn-primary">+ Nova OS</button>
      </div>

      {ordens.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          Nenhuma OS encontrada
        </div>
      ) : (
        <div className="space-y-3">
          {ordens.map(os => {
            const tipoLabel = os.tipo === 'ORCAMENTO' ? 'Orçamento' :
                              os.tipo === 'ACIONAMENTO_GARANTIA' ? 'Garantia' : 'OS';
            const tipoBadge = os.tipo === 'ORCAMENTO' ? 'badge-warning' :
                              os.tipo === 'ACIONAMENTO_GARANTIA' ? 'bg-purple-500/20 text-purple-400' : 'badge-primary';
            return (
            <div key={os.id} className="card">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-gray-500">#{os.numero || os.id}</span>
                  <span className={`badge ${tipoBadge}`}>{tipoLabel}</span>
                  <span className={`badge ${statusColors[os.status] || 'badge-primary'}`}>
                    {statusLabels[os.status] || os.status}
                  </span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {os.tipo === 'ORCAMENTO' && os.status === 'ORCAMENTO' && (
                    <>
                      <button
                        onClick={() => {
                          setLaudoOsId(os.id);
                          setLaudoForm({ parecerTecnico: '', parecerAdmin: '', responsavelTecnico: '', responsavelAdmin: '', statusLaudo: 'EM_ANALISE' });
                        }}
                        className="btn btn-sm btn-secondary"
                      >
                        Laudo
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm('Converter este orçamento em OS? O estoque será baixado.')) return;
                          try { await api.put(`/os/${os.id}/converter-os`, {}); loadData(); }
                          catch (err: any) { alert(err.message); }
                        }}
                        className="btn btn-sm btn-success"
                      >
                        Converter em OS
                      </button>
                    </>
                  )}
                  {os.status === 'EM_EXECUCAO' && !os.confirmadaFinanceiro && (
                    <button
                      onClick={async () => {
                        if (!confirm('Finalizar esta OS? Sera gerada comissao do tecnico e conta a receber.')) return;
                        try {
                          await api.put(`/os/${os.id}/confirmar`, {});
                          loadData();
                          alert('OS finalizada com sucesso!');
                        } catch (err: any) {
                          alert(err.message || 'Erro ao finalizar OS');
                        }
                      }}
                      className="btn btn-sm btn-success"
                    >
                      Finalizar
                    </button>
                  )}
                  <button onClick={() => abrirVisualizacao(os.id)} className="btn btn-sm btn-secondary">
                    Ver
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-gray-500 text-xs">Cliente</p>
                  <p className="text-white">{os.cliente?.nome}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Tecnico</p>
                  <p className="text-gray-300">{os.tecnico || '-'}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Data / Hora</p>
                  <p className="text-gray-300">{new Date(os.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-zinc-700 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 text-sm">Valor Total</span>
                  {os.confirmadaFinanceiro ? (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 font-semibold">Pago</span>
                  ) : os.tipo === 'ORCAMENTO' ? (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-700 text-gray-400 font-semibold">Orçamento</span>
                  ) : os.tipo === 'ACIONAMENTO_GARANTIA' ? (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-semibold">Garantia</span>
                  ) : (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-semibold">Pendente</span>
                  )}
                </div>
                <span className={`text-xl font-bold ${os.confirmadaFinanceiro ? 'text-green-400' : 'text-gray-300'}`}>
                  R$ {Number(os.valorTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); setFormErro(''); }} title="Nova Ordem de Servico">
        <form onSubmit={handleSubmit} className="space-y-4">

          {formErro && (
            <div className="p-3 bg-red-900/30 border border-red-500/50 rounded-lg text-sm text-red-400">
              {formErro}
            </div>
          )}

          <div>
            <label className="label">Tipo *</label>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="tipo" value="OS" checked={form.tipo === 'OS'}
                  onChange={(e) => setForm({ ...form, tipo: e.target.value, garantiaId: '' })} className="accent-orange-500" />
                <span>Ordem de Serviço</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="tipo" value="ORCAMENTO" checked={form.tipo === 'ORCAMENTO'}
                  onChange={(e) => setForm({ ...form, tipo: e.target.value, garantiaId: '' })} className="accent-orange-500" />
                <span>Orçamento</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="tipo" value="ACIONAMENTO_GARANTIA" checked={form.tipo === 'ACIONAMENTO_GARANTIA'}
                  onChange={(e) => { setForm({ ...form, tipo: e.target.value }); carregarGarantias(); }} className="accent-orange-500" />
                <span className="text-purple-400 font-medium">Acionamento de Garantia</span>
              </label>
            </div>
          </div>

          {/* ── Campo de garantia vinculada ───────────────────────────── */}
          {form.tipo === 'ACIONAMENTO_GARANTIA' && (
            <div className="border border-purple-500/30 rounded-lg p-3 space-y-2 bg-purple-500/5">
              <p className="text-xs font-medium text-purple-400">Garantia Vinculada</p>
              <input
                type="text"
                value={garantiaBusca}
                onChange={e => setGarantiaBusca(e.target.value)}
                placeholder="Buscar por cliente, chassi, modelo ou motor..."
                className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-purple-500/50"
              />
              {garantiasLoading && <p className="text-xs text-zinc-500 animate-pulse">Carregando garantias...</p>}
              {garantiaBusca && !garantiasLoading && (() => {
                const q = garantiaBusca.toLowerCase();
                const encontradas = garantias.filter(g =>
                  (g.cliente?.nome || '').toLowerCase().includes(q) ||
                  (g.unidade?.chassi || '').toLowerCase().includes(q) ||
                  (g.unidade?.produto?.nome || '').toLowerCase().includes(q) ||
                  (g.unidade?.codigoMotor || '').toLowerCase().includes(q)
                );
                return encontradas.length === 0 ? (
                  <p className="text-xs text-zinc-500">Nenhuma garantia encontrada.</p>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {encontradas.map((g: any) => (
                      <button key={g.id} type="button"
                        onClick={() => { setForm(f => ({ ...f, garantiaId: String(g.id) })); setGarantiaBusca(`${g.cliente?.nome || ''} — ${g.unidade?.produto?.nome || ''} (${g.unidade?.chassi || 'sem chassi'})`); }}
                        className={`w-full text-left p-2 rounded-lg text-xs transition-colors ${form.garantiaId === String(g.id) ? 'bg-purple-500/20 border border-purple-500/50' : 'bg-zinc-800 hover:bg-zinc-700'}`}
                      >
                        <span className="font-medium text-white">{g.cliente?.nome || '-'}</span>
                        <span className="text-zinc-400 ml-2">· {g.unidade?.produto?.nome || 'Produto'}</span>
                        {g.unidade?.chassi && <span className="text-zinc-500 ml-2 font-mono">· Chassi: {g.unidade.chassi}</span>}
                        <span className={`ml-2 text-[10px] font-bold ${new Date(g.dataFim) > new Date() ? 'text-green-400' : 'text-red-400'}`}>
                          {new Date(g.dataFim) > new Date() ? 'Ativa' : 'Expirada'}
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })()}
              {form.garantiaId && (
                <p className="text-xs text-purple-400">✓ Garantia #{form.garantiaId} vinculada</p>
              )}
            </div>
          )}

          {lojas.length > 1 && !user?.lojaId && (
            <CustomSelect
              label="Loja"
              required
              value={form.lojaId}
              onChange={(val) => { setForm({ ...form, lojaId: val }); loadProdutosLoja(val); }}
              options={lojas.map(l => ({ value: String(l.id), label: l.nomeFantasia }))}
            />
          )}

          {/* ── Cliente com + Novo Cliente ─────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-zinc-400">Cliente *</label>
              <button type="button" onClick={() => { setShowQuickClienteOS(true); setQuickClienteOSErro(''); }}
                className="text-xs text-orange-400 hover:text-orange-300 font-medium">
                + Novo Cliente
              </button>
            </div>
            <CustomSelect
              value={form.clienteId}
              onChange={(val) => { setForm({ ...form, clienteId: val }); setFormErro(''); }}
              options={clientes.map(c => ({ value: String(c.id), label: c.nome }))}
            />
          </div>

          {/* ── Dados da Moto/Veículo ──────────────────────────────────── */}
          <div className="border border-zinc-700/60 rounded-lg p-3 space-y-3">
            <p className="text-xs font-medium text-zinc-400">Moto / Veículo (identificação)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Modelo</label>
                <input type="text" value={form.motoModelo}
                  onChange={e => setForm({ ...form, motoModelo: e.target.value })}
                  className="input" placeholder="Ex: Honda Biz 125" />
              </div>
              <div>
                <label className="label">Descrição / Identificação</label>
                <input type="text" value={form.motoDescricao}
                  onChange={e => setForm({ ...form, motoDescricao: e.target.value })}
                  className="input" placeholder="Ex: Placa ABC-1234, ano 2022" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Chassi</label>
                <input type="text" value={form.motoChassi}
                  onChange={e => setForm({ ...form, motoChassi: e.target.value })}
                  className="input font-mono" placeholder="Ex: 9C2JC1110KR000000" />
              </div>
              <div>
                <label className="label">Código do Motor</label>
                <input type="text" value={form.motoMotor}
                  onChange={e => setForm({ ...form, motoMotor: e.target.value })}
                  className="input font-mono" placeholder="Ex: JC110E-0000000" />
              </div>
            </div>
            <p className="text-xs text-zinc-600">Apenas para identificação — não reserva estoque.</p>
          </div>

          <CustomSelect
            label="Tecnico"
            value={form.tecnicoId}
            onChange={(val) => setForm({ ...form, tecnicoId: val })}
            options={tecnicos.map(t => ({ value: String(t.id), label: t.nome }))}
          />

          <div className="border-t border-zinc-700 pt-4">
            <div className="flex justify-between items-center mb-2">
              <label className="label mb-0">Servicos</label>
              <button type="button" onClick={adicionarServico} className="btn btn-sm btn-secondary">
                + Adicionar Servico
              </button>
            </div>
            {servicosSelecionados.length === 0 ? (
              <p className="text-gray-500 text-sm">Nenhum servico adicionado</p>
            ) : (
              <div className="space-y-2">
                {servicosSelecionados.map((item, index) => (
                  <div key={index} className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <CustomSelect
                      value={item.servicoId}
                      onChange={(val) => atualizarServico(index, 'servicoId', val)}
                      className="flex-1"
                      options={servicos.map(s => ({ value: String(s.id), label: `${s.nome}${s.duracao ? ` (${s.duracao}min)` : ''} - R$ ${Number(s.preco).toFixed(2)}` }))}
                    />
                    <div className="flex gap-2 items-center">
                      <input
                        type="number"
                        min="1"
                        value={item.quantidade}
                        onChange={(e) => atualizarServico(index, 'quantidade', parseInt(e.target.value))}
                        className="input w-20"
                      />
                      <span className="text-green-400 w-24 text-right">
                        R$ {(item.preco * item.quantidade).toFixed(2)}
                      </span>
                      <button type="button" onClick={() => removerServico(index)} className="text-red-500 hover:text-red-400">
                        X
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-zinc-700 pt-4">
            <div className="flex justify-between items-center mb-2">
              <label className="label mb-0">Pecas</label>
              <button type="button" onClick={adicionarPeca} className="btn btn-sm btn-secondary">
                + Adicionar Peca
              </button>
            </div>
            {pecasSelecionadas.length === 0 ? (
              <p className="text-gray-500 text-sm">Nenhuma peca adicionada</p>
            ) : (
              <div className="space-y-2">
                {pecasSelecionadas.map((item, index) => (
                  <div key={index} className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <CustomSelect
                      value={item.produtoId}
                      onChange={(val) => atualizarPeca(index, 'produtoId', val)}
                      className="flex-1"
                      options={produtos.map(p => {
                        const statusTag = p.estoque <= 0 ? ' [Sem estoque]' : p.estoque <= 3 ? ` [Baixo: ${p.estoque}]` : ` [${p.estoque} un]`;
                        return { value: String(p.id), label: `${p.nome}${statusTag} - R$ ${Number(p.preco).toFixed(2)}` };
                      })}
                    />
                    <div className="flex gap-2 items-center">
                      <input
                        type="number"
                        min="1"
                        value={item.quantidade}
                        onChange={(e) => atualizarPeca(index, 'quantidade', parseInt(e.target.value))}
                        className="input w-20"
                      />
                      <span className="text-green-400 w-24 text-right">
                        R$ {(item.preco * item.quantidade).toFixed(2)}
                      </span>
                      <button type="button" onClick={() => removerPeca(index)} className="text-red-500 hover:text-red-400">
                        X
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Desconto em Servicos (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={form.descontoServico}
                onChange={(e) => setForm({ ...form, descontoServico: e.target.value })}
                className="input"
                placeholder={`Max: ${configDescontos.descontoMaxServico}%`}
              />
              <p className="text-xs text-gray-500 mt-1">
                Max {configDescontos.descontoMaxServico}% (Gerentes: dobro)
              </p>
            </div>
            <div>
              <label className="label">Desconto em Pecas (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={form.desconto}
                onChange={(e) => setForm({ ...form, desconto: e.target.value })}
                className="input"
                placeholder={`Max: ${configDescontos.descontoMaxPeca}%`}
              />
              <p className="text-xs text-gray-500 mt-1">
                Max {configDescontos.descontoMaxPeca}% (Gerentes: dobro)
              </p>
            </div>
          </div>

          <div>
            <label className="label">Observacoes</label>
            <textarea
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              className="input"
              rows={3}
            />
          </div>

          <div className="border-t border-zinc-700 pt-4 space-y-3">
            <h4 className="text-sm font-medium text-gray-400">Resumo de Precos</h4>

            {servicosSelecionados.filter(s => s.servicoId).length > 0 && (
              <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
                <p className="text-xs text-blue-400 font-medium">Servicos (Mao de Obra)</p>
                {servicosSelecionados.filter(s => s.servicoId).map((item, idx) => {
                  const serv = servicos.find(s => s.id === parseInt(item.servicoId));
                  const subtotal = item.preco * item.quantidade;
                  const descontoValor = subtotal * Number(form.descontoServico) / 100;
                  return (
                    <div key={idx} className="text-xs border-b border-zinc-700/30 pb-1 last:border-0">
                      <div className="flex justify-between text-gray-300">
                        <span>{serv?.nome || 'Servico'}{serv?.duracao ? ` (${serv.duracao}min)` : ''} (x{item.quantidade})</span>
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-gray-500">Original:</span>
                        <span className="text-gray-400">R$ {subtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                      </div>
                      {Number(form.descontoServico) > 0 && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Desconto ({form.descontoServico}%):</span>
                            <span className="text-red-400">- R$ {descontoValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                          </div>
                          <div className="flex justify-between font-medium">
                            <span className="text-gray-500">Final:</span>
                            <span className="text-green-400">R$ {(subtotal - descontoValor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {pecasSelecionadas.filter(p => p.produtoId).length > 0 && (
              <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
                <p className="text-xs text-orange-400 font-medium">Pecas</p>
                {pecasSelecionadas.filter(p => p.produtoId).map((item, idx) => {
                  const peca = produtos.find(p => p.id === parseInt(item.produtoId));
                  const subtotal = item.preco * item.quantidade;
                  const descontoValor = subtotal * Number(form.desconto) / 100;
                  return (
                    <div key={idx} className="text-xs border-b border-zinc-700/30 pb-1 last:border-0">
                      <div className="flex justify-between text-gray-300">
                        <span>{peca?.nome || 'Peca'} (x{item.quantidade})</span>
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-gray-500">Original:</span>
                        <span className="text-gray-400">R$ {subtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                      </div>
                      {Number(form.desconto) > 0 && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Desconto ({form.desconto}%):</span>
                            <span className="text-red-400">- R$ {descontoValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                          </div>
                          <div className="flex justify-between font-medium">
                            <span className="text-gray-500">Final:</span>
                            <span className="text-green-400">R$ {(subtotal - descontoValor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-2 pt-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">Servicos (Bruto):</span>
                <span className="text-white">
                  R$ {servicosSelecionados.reduce((acc, item) => acc + (item.preco * item.quantidade), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
              {Number(form.descontoServico) > 0 && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-400">Desconto Servicos ({form.descontoServico}%):</span>
                  <span className="text-red-400">
                    - R$ {(servicosSelecionados.reduce((acc, item) => acc + (item.preco * item.quantidade), 0) * Number(form.descontoServico) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">Pecas (Bruto):</span>
                <span className="text-white">
                  R$ {pecasSelecionadas.reduce((acc, item) => acc + (item.preco * item.quantidade), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
              {Number(form.desconto) > 0 && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-400">Desconto Pecas ({form.desconto}%):</span>
                  <span className="text-red-400">
                    - R$ {(pecasSelecionadas.reduce((acc, item) => acc + (item.preco * item.quantidade), 0) * Number(form.desconto) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center text-lg font-bold border-t border-zinc-700 pt-2">
                <span>Total a Pagar:</span>
                <span className="text-green-400">
                  R$ {calcularTotal().toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setModalOpen(false)} className="btn btn-secondary">
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Salvando...' : form.tipo === 'ORCAMENTO' ? 'Gerar Orcamento' : 'Criar OS'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Modal + Novo Cliente na OS ──────────────────────────────────── */}
      {showQuickClienteOS && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) { setShowQuickClienteOS(false); setQuickClienteOSErro(''); } }}>
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-[#27272a] flex items-center justify-between sticky top-0 bg-[#18181b] z-10">
              <h3 className="font-bold text-white">Novo Cliente</h3>
              <button onClick={() => { setShowQuickClienteOS(false); setQuickClienteOSErro(''); }}
                className="text-zinc-400 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="p-5 space-y-3">
              {quickClienteOSErro && (
                <div className="p-3 bg-red-900/30 border border-red-500/50 rounded-lg text-sm text-red-400">{quickClienteOSErro}</div>
              )}
              <div>
                <label className="text-xs text-zinc-400 block mb-1">CPF / CNPJ *</label>
                <div className="relative">
                  <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                    value={quickClienteOS.cpfCnpj}
                    onChange={e => { setQuickClienteOS(p => ({ ...p, cpfCnpj: e.target.value })); setQuickClienteOSErro(''); }}
                    onBlur={e => osQuickHandleDocumentoBlur(e.target.value)}
                    placeholder="000.000.000-00 ou 00.000.000/0000-00" />
                  {osQuickBuscandoDoc && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-orange-400 animate-pulse">buscando...</span>}
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Nome *</label>
                <input autoFocus type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                  value={quickClienteOS.nome} onChange={e => setQuickClienteOS(p => ({ ...p, nome: e.target.value }))} placeholder="Nome completo" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Telefone</label>
                  <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                    value={quickClienteOS.telefone} onChange={e => setQuickClienteOS(p => ({ ...p, telefone: e.target.value }))} placeholder="(00) 00000-0000" />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Email</label>
                  <input type="email" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                    value={quickClienteOS.email} onChange={e => setQuickClienteOS(p => ({ ...p, email: e.target.value }))} />
                </div>
              </div>
              <div className="border-t border-zinc-700 pt-3">
                <p className="text-xs text-zinc-500 mb-2">Endereço (opcional)</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">CEP</label>
                    <div className="relative">
                      <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                        value={quickClienteOS.cep}
                        onChange={e => setQuickClienteOS(p => ({ ...p, cep: e.target.value }))}
                        onBlur={e => osQuickBuscarCep(e.target.value)} placeholder="00000-000" maxLength={9} />
                      {osQuickBuscandoCep && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-orange-400 animate-pulse">...</span>}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-zinc-400 block mb-1">Logradouro</label>
                    <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                      value={quickClienteOS.logradouro} onChange={e => setQuickClienteOS(p => ({ ...p, logradouro: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-2">
                  <div><label className="text-xs text-zinc-400 block mb-1">Nº</label>
                    <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                      value={quickClienteOS.numero} onChange={e => setQuickClienteOS(p => ({ ...p, numero: e.target.value }))} /></div>
                  <div><label className="text-xs text-zinc-400 block mb-1">Compl.</label>
                    <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                      value={quickClienteOS.complemento} onChange={e => setQuickClienteOS(p => ({ ...p, complemento: e.target.value }))} /></div>
                  <div className="col-span-2"><label className="text-xs text-zinc-400 block mb-1">Bairro</label>
                    <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                      value={quickClienteOS.bairro} onChange={e => setQuickClienteOS(p => ({ ...p, bairro: e.target.value }))} /></div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div className="col-span-2"><label className="text-xs text-zinc-400 block mb-1">Cidade</label>
                    <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                      value={quickClienteOS.cidade} onChange={e => setQuickClienteOS(p => ({ ...p, cidade: e.target.value }))} /></div>
                  <div><label className="text-xs text-zinc-400 block mb-1">UF</label>
                    <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                      value={quickClienteOS.estado} onChange={e => setQuickClienteOS(p => ({ ...p, estado: e.target.value }))} maxLength={2} /></div>
                </div>
              </div>
            </div>
            <div className="p-5 pt-0 flex gap-3 justify-end">
              <button onClick={() => { setShowQuickClienteOS(false); setQuickClienteOSErro(''); }}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">Cancelar</button>
              <button onClick={criarClienteRapidoOS} disabled={quickClienteOSLoading || osQuickBuscandoDoc}
                className="px-4 py-2 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-lg disabled:opacity-50 font-medium transition-colors">
                {quickClienteOSLoading ? 'Salvando...' : 'Salvar Cliente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de Laudo Técnico/Administrativo ──────────────────── */}
      {laudoOsId && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4">
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-[#27272a] flex items-center justify-between">
              <h3 className="font-bold text-white">Laudo Técnico / Administrativo</h3>
              <button onClick={() => setLaudoOsId(null)} className="text-zinc-400 hover:text-white text-xl">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Responsável Técnico</label>
                  <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                    value={laudoForm.responsavelTecnico} onChange={e => setLaudoForm(p => ({ ...p, responsavelTecnico: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Responsável Administrativo</label>
                  <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                    value={laudoForm.responsavelAdmin} onChange={e => setLaudoForm(p => ({ ...p, responsavelAdmin: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Parecer Técnico</label>
                <textarea className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500/50 resize-none"
                  rows={3} value={laudoForm.parecerTecnico} onChange={e => setLaudoForm(p => ({ ...p, parecerTecnico: e.target.value }))} placeholder="Descreva o parecer técnico..." />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Parecer Administrativo</label>
                <textarea className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500/50 resize-none"
                  rows={3} value={laudoForm.parecerAdmin} onChange={e => setLaudoForm(p => ({ ...p, parecerAdmin: e.target.value }))} placeholder="Decisão administrativa..." />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Status do Laudo</label>
                <select className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                  value={laudoForm.statusLaudo} onChange={e => setLaudoForm(p => ({ ...p, statusLaudo: e.target.value }))}>
                  <option value="EM_ANALISE">Em Análise</option>
                  <option value="APROVADO_OS_NORMAL">Aprovado — Gerar OS Normal</option>
                  <option value="APROVADO_GARANTIA">Aprovado — Gerar Acionamento de Garantia</option>
                  <option value="REPROVADO">Reprovado</option>
                </select>
              </div>
              {(laudoForm.statusLaudo === 'APROVADO_OS_NORMAL' || laudoForm.statusLaudo === 'APROVADO_GARANTIA') && (
                <div className={`p-3 rounded-lg text-xs ${laudoForm.statusLaudo === 'APROVADO_GARANTIA' ? 'bg-purple-500/10 border border-purple-500/30 text-purple-400' : 'bg-green-500/10 border border-green-500/30 text-green-400'}`}>
                  {laudoForm.statusLaudo === 'APROVADO_GARANTIA'
                    ? 'Após salvar, converta o orçamento e altere o tipo para Acionamento de Garantia.'
                    : 'Após salvar, use o botão "Converter em OS" na listagem.'}
                </div>
              )}
            </div>
            <div className="p-5 pt-0 flex gap-3 justify-end">
              <button onClick={() => setLaudoOsId(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancelar</button>
              <button onClick={salvarLaudo} disabled={laudoSaving}
                className="px-4 py-2 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-lg disabled:opacity-50 font-medium">
                {laudoSaving ? 'Salvando...' : 'Salvar Laudo'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal isOpen={viewModalOpen} onClose={() => setViewModalOpen(false)} title={osDetalhada?.tipo === 'ORCAMENTO' ? 'Orcamento' : osDetalhada?.tipo === 'ACIONAMENTO_GARANTIA' ? 'Acionamento de Garantia' : 'Ordem de Servico'}>
        <div className="space-y-4">
          <div ref={printRef}>
            <div className="header text-center mb-4 pb-4 border-b border-zinc-700">
              <h1 className="text-xl font-bold">
                {osDetalhada?.tipo === 'ORCAMENTO' ? 'ORCAMENTO' : 'ORDEM DE SERVICO'}
              </h1>
              <p className="text-gray-400">#{osDetalhada?.numero || osDetalhada?.id}</p>
              <p className="text-sm text-gray-500">{osDetalhada?.loja?.nomeFantasia}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="info-box">
                <h3 className="font-semibold text-sm mb-2 text-gray-400">Cliente</h3>
                <p className="text-white">{osDetalhada?.cliente?.nome}</p>
                {osDetalhada?.cliente?.cpfCnpj && <p className="text-sm text-gray-400">CPF/CNPJ: {osDetalhada.cliente.cpfCnpj}</p>}
                {osDetalhada?.cliente?.telefone && <p className="text-sm text-gray-400">Tel: {osDetalhada.cliente.telefone}</p>}
              </div>
              <div className="info-box">
                <h3 className="font-semibold text-sm mb-2 text-gray-400">Informacoes</h3>
                <p className="text-sm text-gray-400">Data: {osDetalhada?.createdAt ? new Date(osDetalhada.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</p>
                {osDetalhada?.tecnico && <p className="text-sm text-gray-400">Tecnico: {osDetalhada.tecnico}</p>}
                {osDetalhada?.motoDescricao && (() => {
                  try {
                    const m = JSON.parse(osDetalhada.motoDescricao);
                    return (
                      <div className="text-sm text-gray-400 space-y-0.5">
                        {m.modelo && <p>Modelo: <span className="text-gray-300">{m.modelo}</span></p>}
                        {m.descricao && <p>Descrição: <span className="text-gray-300">{m.descricao}</span></p>}
                        {m.chassi && <p>Chassi: <span className="text-gray-300 font-mono">{m.chassi}</span></p>}
                        {m.motor && <p>Motor: <span className="text-gray-300 font-mono">{m.motor}</span></p>}
                      </div>
                    );
                  } catch {
                    return <p className="text-sm text-gray-400">Veiculo: {osDetalhada.motoDescricao}</p>;
                  }
                })()}
              </div>
            </div>

            <div className="overflow-x-auto mb-4">
            <table className="w-full min-w-[380px]">
              <thead>
                <tr className="border-b border-zinc-700">
                  <th className="text-left p-2 text-gray-400 text-sm">Item</th>
                  <th className="text-center p-2 text-gray-400 text-sm">Qtd</th>
                  <th className="text-right p-2 text-gray-400 text-sm">Valor Unit.</th>
                  <th className="text-right p-2 text-gray-400 text-sm">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {osDetalhada?.itens?.map((item, i) => (
                  <tr key={i} className="border-b border-zinc-800">
                    <td className="p-2">{item.servico?.nome || item.produto?.nome}</td>
                    <td className="p-2 text-center">{item.quantidade}</td>
                    <td className="p-2 text-right">R$ {Number(item.precoUnitario).toFixed(2)}</td>
                    <td className="p-2 text-right">R$ {(Number(item.precoUnitario) * item.quantidade).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            <div className="text-right text-lg font-bold border-t border-zinc-700 pt-4">
              <span className="text-gray-400">Total: </span>
              <span className="text-green-400">R$ {Number(osDetalhada?.valorTotal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>

            {osDetalhada?.observacoes && (
              <div className="mt-4 p-3 bg-zinc-800 rounded text-sm">
                <strong className="text-gray-400">Observacoes:</strong>
                <p className="mt-1">{osDetalhada.observacoes}</p>
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end border-t border-zinc-700 pt-4">
            <button onClick={() => setViewModalOpen(false)} className="btn btn-secondary">
              Fechar
            </button>
            <button onClick={handlePrint} className="btn btn-primary">
              Imprimir
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
