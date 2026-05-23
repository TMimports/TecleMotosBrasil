import { useEffect, useState, useRef } from 'react';
import { api } from '../services/api';
import { Modal } from '../components/Modal';
import { useAuth } from '../contexts/AuthContext';
import { useLojaContext } from '../contexts/LojaContext';
import { CustomSelect } from '../components/CustomSelect';
import { buscarCNPJ } from '../services/cnpj';
import { CheckinSaida } from './CheckinSaida';

interface VendaItem {
  id: number;
  quantidade: number;
  precoUnitario: number;
  desconto: number;
  unidadeFisicaId?: number;
  unidadeFisica?: {
    chassi?: string;
    codigoMotor?: string;
    cor?: string;
  };
  produto?: { nome: string };
  servico?: { nome: string };
}

interface VendaFull {
  id: number;
  tipo: string;
  status?: string;
  valorTotal: number;
  valorBruto: number;
  formaPagamento: string;
  parcelas?: number | null;
  pagamentosJson?: string | null;
  confirmadaFinanceiro: boolean;
  observacoes?: string;
  cliente: { id: number; nome: string; cpfCnpj?: string; telefone?: string; email?: string; endereco?: string };
  vendedor: { nome: string };
  loja: { id: number; nomeFantasia: string; cnpj?: string; telefone?: string; endereco?: string };
  itens: VendaItem[];
  createdAt: string;
}

interface Venda {
  id: number;
  tipo: string;
  status?: string;
  cliente: { nome: string };
  vendedor: { nome: string };
  valorTotal: number;
  formaPagamento: string;
  confirmadaFinanceiro: boolean;
  deletedAt: string | null;
  createdAt: string;
}

interface Cliente {
  id: number;
  nome: string;
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

interface ItemProduto {
  produtoId: string;
  quantidade: number;
  preco: number;
  desconto: string;
  descontoValor: string;
  descontoModo: 'pct' | 'valor';
  tipo?: string;
  chassi?: string;
  motor?: string;
  unidadeFisicaId?: number;
  displayName?: string;
}

interface ItemMoto {
  unidadeId: string;
  produtoId: string;
  quantidade: number;
  preco: number;
  desconto: string;
  descontoValor: string;
  descontoModo: 'pct' | 'valor';
  chassi: string;
  motor: string;
  cor: string;
  displayName: string;
  unidadesPorModelo: UnidadeDisponivel[];
  alertaEstoque: boolean;
  carregandoUnidades: boolean;
  chassiSearch: string;
}

interface PagamentoComp {
  tipo: string;
  valor: string;
  parcelas: string;
  obs: string;
}

interface UnidadeDisponivel {
  id: number;
  produtoId: number;
  produtoNome: string;
  preco: number;
  chassi: string;
  codigoMotor: string;
  cor: string;
  ano: number;
  status: string;
  displayName: string;
}

interface ConfigDescontos {
  descontoMaxMoto: number;
  descontoMaxPeca: number;
}

// Taxas da máquina — coluna D "Taxa Adulterada" da planilha
const TAXAS_MAQUINA: Record<number, number> = {
  1:  0.0604,   2:  0.0736,   3:  0.0799,   4:  0.0865,
  5:  0.0931,   6:  0.0999,   7:  0.1097,   8:  0.1168,
  9:  0.1240,   10: 0.1314,   11: 0.1390,   12: 0.1467,
  13: 0.1606,   14: 0.1687,   15: 0.1770,   16: 0.1854,
  17: 0.1941,   18: 0.2030,
};

const TODAS_PARCELAS = Array.from({ length: 18 }, (_, i) => i + 1);

export function Vendas() {
  const { user } = useAuth();
  const { selectedLojaId } = useLojaContext();
  const [vendas, setVendas] = useState<Venda[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [vendaDetalhada, setVendaDetalhada] = useState<VendaFull | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const [configDescontos, setConfigDescontos] = useState<ConfigDescontos>({ descontoMaxMoto: 3.5, descontoMaxPeca: 10 });
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelVendaId, setCancelVendaId] = useState<number | null>(null);
  const [cancelMotivo, setCancelMotivo] = useState('');
  const [showQuickCliente, setShowQuickCliente] = useState(false);
  const [quickCliente, setQuickCliente] = useState({
    nome: '', cpfCnpj: '', telefone: '', email: '',
    cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: ''
  });
  const [quickClienteLoading, setQuickClienteLoading] = useState(false);
  const [quickClienteErro, setQuickClienteErro] = useState('');
  const [quickBuscandoDoc, setQuickBuscandoDoc] = useState(false);
  const [quickBuscandoCep, setQuickBuscandoCep] = useState(false);
  const [buscaVendas, setBuscaVendas] = useState('');
  const [filtroTipoVenda, setFiltroTipoVenda] = useState('');
  const [filtroStatusVenda, setFiltroStatusVenda] = useState('');
  const [formErro, setFormErro] = useState('');
  const [checkinVendaId, setCheckinVendaId] = useState<number | null>(null);

  const [form, setForm] = useState({
    clienteId: '',
    lojaId: '',
    formaPagamento: 'PIX',
    parcelas: '1',
    tipo: 'VENDA',
    observacoes: ''
  });

  const [itensSelecionados, setItensSelecionados] = useState<ItemProduto[]>([]);
  const [motosSelecionadas, setMotosSelecionadas] = useState<ItemMoto[]>([]);
  const [unidadesDisponiveis, setUnidadesDisponiveis] = useState<UnidadeDisponivel[]>([]);
  const [pagamentosCompostos, setPagamentosCompostos] = useState<PagamentoComp[]>([{ tipo: 'PIX', valor: '', parcelas: '1', obs: '' }]);

  const loadProdutosLoja = async (lojaId: string) => {
    if (!lojaId) {
      setProdutos([]);
      setUnidadesDisponiveis([]);
      return;
    }
    try {
      const produtosData = await api.get<Produto[]>(`/vendas/produtos-catalogo/${lojaId}`);
      setProdutos(produtosData.map((p: any) => ({ id: p.id, nome: p.nome, preco: Number(p.preco), tipo: p.tipo, estoque: p.estoque || 0 })));
      try {
        const unidades = await api.get<UnidadeDisponivel[]>(`/unidades/disponiveis/${lojaId}`);
        setUnidadesDisponiveis(unidades);
      } catch {
        setUnidadesDisponiveis([]);
      }
    } catch (err) {
      console.error('Erro ao buscar produtos da loja:', err);
    }
  };

  const loadData = (lojaIdOverride?: number | null) => {
    const filtroLoja = lojaIdOverride !== undefined ? lojaIdOverride : selectedLojaId;
    const vendasUrl = filtroLoja ? `/vendas?lojaId=${filtroLoja}` : '/vendas';
    Promise.all([
      api.get<Venda[]>(vendasUrl),
      api.get<Cliente[]>('/clientes'),
      api.get<Loja[]>('/lojas'),
      api.get<ConfigDescontos>('/configuracoes/public')
    ])
      .then(([vendasData, clientesData, lojasData, configData]) => {
        setVendas(vendasData);
        setClientes(clientesData);
        setLojas(lojasData);
        if (configData) setConfigDescontos(configData);
        const preselLoja = filtroLoja ?? user?.lojaId ?? (lojasData.length === 1 ? lojasData[0].id : null);
        if (preselLoja) {
          const lojaIdStr = String(preselLoja);
          setForm(f => ({ ...f, lojaId: lojaIdStr }));
          loadProdutosLoja(lojaIdStr);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(), 30000);
    return () => clearInterval(interval);
  }, [selectedLojaId]);

  useEffect(() => {
    if (form.lojaId) {
      loadProdutosLoja(form.lojaId);
    }
  }, [form.lojaId]);

  // Recalcula automaticamente o valor da última linha (restante) em COMBINADO
  // sempre que itens/descontos/preços mudam — assim entrada + restante = totalFinal.
  // Para PIX/Débito/Crédito/Financiamento simples não há pagamentosCompostos em uso,
  // o total já é recalculado em cada render via calcularTotal().
  useEffect(() => {
    if (form.formaPagamento !== 'COMBINADO') return;
    if (pagamentosCompostos.length < 2) return;
    const total = Math.round(
      (itensSelecionados.reduce((acc, item) => {
        const sub = Math.round(item.preco * item.quantidade * 100) / 100;
        if (item.descontoModo === 'valor') {
          return acc + Math.round((sub - (parseFloat(item.descontoValor) || 0)) * 100) / 100;
        }
        const pct = parseFloat(item.desconto) || 0;
        return acc + Math.round(sub * (1 - pct / 100) * 100) / 100;
      }, 0)
      + motosSelecionadas.reduce((acc, item) => {
        const sub = Math.round(item.preco * item.quantidade * 100) / 100;
        if (item.descontoModo === 'valor') {
          return acc + Math.round((sub - (parseFloat(item.descontoValor) || 0)) * 100) / 100;
        }
        const pct = parseFloat(item.desconto) || 0;
        return acc + Math.round(sub * (1 - pct / 100) * 100) / 100;
      }, 0)) * 100
    ) / 100;
    const somaOutros = Math.round(
      pagamentosCompostos.slice(0, -1).reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0) * 100
    ) / 100;
    const restante = Math.max(0, Math.round((total - somaOutros) * 100) / 100);
    const ultimoIdx = pagamentosCompostos.length - 1;
    const valorAtual = parseFloat(pagamentosCompostos[ultimoIdx].valor) || 0;
    if (Math.round(valorAtual * 100) !== Math.round(restante * 100)) {
      setPagamentosCompostos(prev => prev.map((p, idx) =>
        idx === ultimoIdx ? { ...p, valor: restante > 0 ? restante.toFixed(2) : '' } : p
      ));
    }
  }, [itensSelecionados, motosSelecionadas, form.formaPagamento]);

  // Papéis com trava de desconto em 15%
  const rolesCap15 = ['VENDEDOR', 'DONO_LOJA'];
  const rolesLivres = ['ADMIN_GERAL', 'ADMIN_FINANCEIRO', 'ADMIN_REDE'];
  const userRole = user?.role || '';
  const maxDescontoRole = rolesLivres.includes(userRole) ? 100 : rolesCap15.includes(userRole) ? 15 : (configDescontos.descontoMaxMoto * 2);

  const adicionarItem = () => {
    setItensSelecionados([...itensSelecionados, { produtoId: '', quantidade: 1, preco: 0, desconto: '0', descontoValor: '0', descontoModo: 'pct', tipo: '', chassi: '', motor: '' }]);
  };

  const removerItem = (index: number) => {
    setItensSelecionados(itensSelecionados.filter((_, i) => i !== index));
  };

  const atualizarItem = (index: number, field: string, value: any) => {
    const novos = [...itensSelecionados];
    if (field === 'produtoId') {
      const produto = produtos.find(p => p.id === parseInt(value));
      if (produto && produto.estoque <= 0 && form.tipo === 'VENDA') return;
      novos[index] = { ...novos[index], produtoId: value, preco: produto?.preco || 0, tipo: produto?.tipo || '', desconto: '0', descontoValor: '0' };
    } else if (field === 'quantidade') {
      const produto = produtos.find(p => p.id === parseInt(novos[index].produtoId));
      if (produto && form.tipo === 'VENDA' && produto.tipo !== 'MOTO') {
        value = Math.min(value, produto.estoque);
      }
      novos[index] = { ...novos[index], [field]: Math.max(1, value) };
    } else if (field === 'desconto') {
      const pct = parseFloat(value) || 0;
      const subtotal = novos[index].preco * novos[index].quantidade;
      novos[index] = { ...novos[index], desconto: value, descontoValor: (subtotal * pct / 100).toFixed(2) };
    } else if (field === 'descontoValor') {
      const subtotal = novos[index].preco * novos[index].quantidade;
      const pct = subtotal > 0 ? (parseFloat(value) || 0) / subtotal * 100 : 0;
      novos[index] = { ...novos[index], descontoValor: value, desconto: pct.toFixed(2) };
    } else if (field === 'descontoModo') {
      novos[index] = { ...novos[index], descontoModo: value as 'pct' | 'valor' };
    } else {
      novos[index] = { ...novos[index], [field]: value };
    }
    setItensSelecionados(novos);
  };

  const adicionarMoto = () => {
    setMotosSelecionadas([...motosSelecionadas, { unidadeId: '', produtoId: '', quantidade: 1, preco: 0, desconto: '0', descontoValor: '0', descontoModo: 'pct', chassi: '', motor: '', cor: '', displayName: '', unidadesPorModelo: [], alertaEstoque: false, carregandoUnidades: false, chassiSearch: '' }]);
  };

  const removerMoto = (index: number) => {
    setMotosSelecionadas(motosSelecionadas.filter((_, i) => i !== index));
  };

  const atualizarMoto = (index: number, field: string, value: any) => {
    const novas = [...motosSelecionadas];
    if (field === 'produtoId') {
      const produto = produtos.find(p => p.id === parseInt(value));
      if (produto) {
        novas[index] = {
          ...novas[index],
          produtoId: value,
          preco: produto.preco,
          desconto: '0',
          descontoValor: '0',
          unidadeId: '',
          chassi: '',
          motor: '',
          cor: '',
          displayName: produto.nome,
          unidadesPorModelo: [],
          alertaEstoque: false,
          carregandoUnidades: true
        };
        setMotosSelecionadas(novas);
        if (form.lojaId && value) {
          api.get<{ estoqueGerencial: number; unidades: UnidadeDisponivel[]; alertaInconsistencia: boolean }>(
            `/estoque/unidades-disponiveis?lojaId=${form.lojaId}&produtoId=${value}`
          ).then(resp => {
            setMotosSelecionadas(prev => {
              const updated = [...prev];
              if (updated[index]?.produtoId === value) {
                updated[index] = {
                  ...updated[index],
                  unidadesPorModelo: resp.unidades,
                  alertaEstoque: resp.alertaInconsistencia,
                  carregandoUnidades: false
                };
              }
              return updated;
            });
          }).catch(() => {
            setMotosSelecionadas(prev => {
              const updated = [...prev];
              if (updated[index]?.produtoId === value) {
                updated[index] = { ...updated[index], carregandoUnidades: false };
              }
              return updated;
            });
          });
        }
        return;
      }
    } else if (field === 'unidadeId') {
      const unidade = novas[index].unidadesPorModelo.find(u => String(u.id) === value);
      if (unidade) {
        novas[index] = {
          ...novas[index],
          unidadeId: value,
          chassi: unidade.chassi || '',
          motor: unidade.codigoMotor || '',
          cor: unidade.cor || ''
        };
      } else {
        novas[index] = { ...novas[index], unidadeId: '', chassi: '', motor: '', cor: '' };
      }
    } else if (field === 'desconto') {
      const pct = parseFloat(value) || 0;
      novas[index] = { ...novas[index], desconto: value, descontoValor: (novas[index].preco * pct / 100).toFixed(2) };
    } else if (field === 'descontoValor') {
      const preco = novas[index].preco;
      const pct = preco > 0 ? (parseFloat(value) || 0) / preco * 100 : 0;
      novas[index] = { ...novas[index], descontoValor: value, desconto: pct.toFixed(2) };
    } else if (field === 'descontoModo') {
      novas[index] = { ...novas[index], descontoModo: value as 'pct' | 'valor' };
    } else if (field === 'chassiSearch') {
      novas[index] = { ...novas[index], chassiSearch: value };
    } else {
      novas[index] = { ...novas[index], [field]: value };
    }
    setMotosSelecionadas(novas);
  };

  const motosSemDadosCompletos = () => {
    return motosSelecionadas.filter(item => item.produtoId && !item.chassi);
  };

  const isCartao = form.formaPagamento === 'CARTAO_DEBITO' || form.formaPagamento === 'CARTAO_CREDITO';
  const isCombinado = form.formaPagamento === 'COMBINADO';
  const isCredito = form.formaPagamento === 'CARTAO_CREDITO' || form.formaPagamento === 'FINANCIAMENTO';

  // Arredondamento seguro para centavos — nunca Math.ceil/floor em valores monetários
  const roundMoney = (v: number): number => Math.round(v * 100) / 100;

  const totalPagamentosCompostos = roundMoney(
    pagamentosCompostos.reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0)
  );

  // Total real que o cliente paga (entrada + financiado já com taxa da máquina)
  const totalComEncargos = roundMoney(
    pagamentosCompostos.reduce((acc, p) => {
      const val = roundMoney(parseFloat(p.valor) || 0);
      const n = parseInt(p.parcelas) || 1;
      const tipoCredito = p.tipo === 'CARTAO_CREDITO' || p.tipo === 'FINANCIAMENTO';
      const taxa = tipoCredito ? (TAXAS_MAQUINA[n] ?? 0) : 0;
      return roundMoney(acc + roundMoney(val * (1 + taxa)));
    }, 0)
  );

  const addPagamento = () => setPagamentosCompostos(prev => [...prev, { tipo: 'CARTAO_CREDITO', valor: '', parcelas: '1', obs: '' }]);
  const removePagamento = (i: number) => setPagamentosCompostos(prev => prev.filter((_, idx) => idx !== i));
  const updatePagamento = (i: number, field: keyof PagamentoComp, val: string) =>
    setPagamentosCompostos(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: val } : p));

  // Ao digitar o valor da entrada, auto-preenche o restante na última linha de crédito
  const updateEntrada = (valor: string) => {
    if (pagamentosCompostos.length >= 2) {
      const total = calcularTotal();
      const entrada = roundMoney(parseFloat(valor) || 0);
      const restante = roundMoney(Math.max(0, total - entrada));
      setPagamentosCompostos(prev => prev.map((p, idx) =>
        idx === 0 ? { ...p, valor } :
        idx === prev.length - 1 ? { ...p, valor: restante > 0 ? restante.toFixed(2) : '' } :
        p
      ));
    } else {
      updatePagamento(0, 'valor', valor);
    }
  };

  // Ativa modo combinado com atalho entrada (PIX/Dinheiro) + crédito
  const ativarCombinado = (tipoEntrada: string) => {
    const total = calcularTotal();
    setForm(f => ({ ...f, formaPagamento: 'COMBINADO' }));
    setPagamentosCompostos([
      { tipo: tipoEntrada, valor: '', parcelas: '1', obs: '' },
      { tipo: 'CARTAO_CREDITO', valor: total > 0 ? total.toFixed(2) : '', parcelas: '1', obs: '' },
    ]);
  };

  const precisaParcelas = (tipo: string) => tipo === 'CARTAO_CREDITO' || tipo === 'FINANCIAMENTO';

  // Subtotal de um item respeitando o modo de desconto (valor ou %)
  // Se descontoModo === 'valor': usa descontoValor diretamente (sem conversão % → valor)
  // Se descontoModo === 'pct': calcula a partir do percentual
  const itemFinal = (preco: number, qtd: number, desconto: string, descontoValor: string, descontoModo: 'pct' | 'valor'): number => {
    const sub = roundMoney(preco * qtd);
    if (isCartao) return sub;
    if (descontoModo === 'valor') {
      const dv = roundMoney(parseFloat(descontoValor) || 0);
      return roundMoney(sub - dv);
    }
    const pct = parseFloat(desconto) || 0;
    return roundMoney(sub * (1 - pct / 100));
  };

  const calcularTotal = (): number => {
    const totalPecas = itensSelecionados.reduce((acc, item) =>
      roundMoney(acc + itemFinal(item.preco, item.quantidade, item.desconto, item.descontoValor, item.descontoModo)), 0);
    const totalMotos = motosSelecionadas.reduce((acc, item) =>
      roundMoney(acc + itemFinal(item.preco, item.quantidade, item.desconto, item.descontoValor, item.descontoModo)), 0);
    return roundMoney(totalPecas + totalMotos);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErro('');

    if (!form.lojaId) {
      setFormErro('⚠️ Selecione uma loja antes de continuar.');
      return;
    }

    if (itensSelecionados.length === 0 && motosSelecionadas.length === 0) {
      setFormErro('⚠️ Adicione pelo menos um produto ou moto à venda.');
      return;
    }

    const motosIncompletas = motosSemDadosCompletos();
    if (motosIncompletas.length > 0) {
      setFormErro(`🏍️ Selecione a unidade física (chassi) para ${motosIncompletas.length} moto(s) usando o dropdown de unidades.`);
      return;
    }

    const motosSerUnidade = motosSelecionadas.filter(item => {
      if (!item.produtoId) return false;
      const temUnidade = unidadesDisponiveis.some(u => u.produtoId === parseInt(item.produtoId));
      return temUnidade && !item.unidadeId;
    });
    if (motosSerUnidade.length > 0) {
      setFormErro(`🏍️ Selecione a unidade física para ${motosSerUnidade.length} moto(s). Escolha o chassi no dropdown.`);
      return;
    }

    // Validação de desconto — pct > 100%, valor e limite de perfil
    for (const m of motosSelecionadas) {
      const pct = parseFloat(m.desconto) || 0;
      if (m.descontoModo === 'pct' && pct > 100) {
        setFormErro('⚠️ Desconto em % não pode ultrapassar 100%.');
        return;
      }
      if (pct > maxDescontoRole) {
        setFormErro(`⚠️ Desconto máximo permitido para este perfil: ${maxDescontoRole}%. Moto "${m.displayName || ''}" está acima do limite.`);
        return;
      }
    }
    for (const i of itensSelecionados) {
      const pct = parseFloat(i.desconto) || 0;
      if (i.descontoModo === 'pct' && pct > 100) {
        setFormErro('⚠️ Desconto em % não pode ultrapassar 100%.');
        return;
      }
      if (pct > maxDescontoRole) {
        setFormErro(`⚠️ Desconto máximo permitido para este perfil: ${maxDescontoRole}%. Uma peça está acima do limite.`);
        return;
      }
    }

    // Validação pagamento combinado — comparar valores arredondados em centavos
    const totalFinal = calcularTotal();
    if (isCombinado) {
      const totalPag = roundMoney(
        pagamentosCompostos.reduce((acc, p) => acc + roundMoney(parseFloat(p.valor) || 0), 0)
      );
      if (Math.round(totalPag * 100) !== Math.round(totalFinal * 100)) {
        setFormErro(`⚠️ Soma dos pagamentos (R$ ${totalPag.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) ≠ total da venda (R$ ${totalFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}). Corrija os valores.`);
        return;
      }
    }

    // ── Calcular o valor final que o cliente irá pagar (com encargos) ──────
    let valorParaSalvar: number;
    if (isCombinado) {
      // Para COMBINADO: soma de cada método já com sua taxa individual
      valorParaSalvar = totalComEncargos;
    } else if (isCredito) {
      // Para Cartão Crédito / Financiamento: aplica a taxa da máquina
      const nParcelas = parseInt(form.parcelas) || 1;
      const taxa = TAXAS_MAQUINA[nParcelas] ?? 0;
      const comTaxa = totalFinal * (1 + taxa);
      valorParaSalvar = parseFloat(comTaxa.toFixed(2));
    } else {
      // PIX, Dinheiro, Débito: sem encargo
      valorParaSalvar = totalFinal;
    }

    setSaving(true);
    try {
      const itensPecas = itensSelecionados
        .filter(item => item.produtoId)
        .map(item => ({
          produtoId: parseInt(item.produtoId),
          quantidade: item.quantidade,
          precoUnitario: item.preco,
          desconto: isCartao ? 0 : (parseFloat(item.desconto) || 0),
          chassi: null,
          motor: null,
          unidadeFisicaId: null
        }));

      const itensMotos = motosSelecionadas
        .filter(item => item.produtoId)
        .map(item => ({
          produtoId: parseInt(item.produtoId),
          quantidade: 1,
          precoUnitario: item.preco,
          desconto: isCartao ? 0 : (parseFloat(item.desconto) || 0),
          chassi: item.chassi || null,
          motor: item.motor || null,
          unidadeFisicaId: item.unidadeId ? parseInt(item.unidadeId) : null
        }));

      const itens = [...itensMotos, ...itensPecas];

      const novaVenda = await api.post<VendaFull>('/vendas', {
        clienteId: parseInt(form.clienteId),
        lojaId: parseInt(form.lojaId),
        itens,
        formaPagamento: form.formaPagamento,
        parcelas: isCombinado ? undefined : (parseInt(form.parcelas) || 1),
        tipo: form.tipo,
        observacoes: form.observacoes,
        pagamentosCompostos: isCombinado ? pagamentosCompostos : undefined,
        valorTotalManual: valorParaSalvar
      });

      const tipoRegistrado = form.tipo;

      setModalOpen(false);
      setForm({
        clienteId: '',
        lojaId: lojas.length === 1 ? String(lojas[0].id) : '',
        formaPagamento: 'PIX',
        parcelas: '1',
        tipo: 'VENDA',
        observacoes: ''
      });
      setItensSelecionados([]);
      setMotosSelecionadas([]);
      setPagamentosCompostos([{ tipo: 'PIX', valor: '', parcelas: '1', obs: '' }]);
      setFormErro('');
      loadData();

      if (tipoRegistrado === 'VENDA') {
        // Venda efetiva → abrir check-in para assinatura e conferência
        setCheckinVendaId(novaVenda.id);
      } else {
        // Orçamento → abrir comprovante normalmente
        const vendaCompleta = await api.get<VendaFull>(`/vendas/${novaVenda.id}`);
        setVendaDetalhada(vendaCompleta);
        setViewModalOpen(true);
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const abrirVisualizacao = async (id: number) => {
    try {
      const venda = await api.get<VendaFull>(`/vendas/${id}`);
      setVendaDetalhada(venda);
      setViewModalOpen(true);
    } catch (err) {
      console.error(err);
    }
  };

  const abrirCancelamento = (id: number) => {
    setCancelVendaId(id);
    setCancelMotivo('');
    setCancelModalOpen(true);
  };

  const confirmarCancelamento = async () => {
    if (!cancelVendaId || !cancelMotivo.trim()) return;
    try {
      await api.put(`/vendas/${cancelVendaId}/cancelar`, { motivo: cancelMotivo });
      setCancelModalOpen(false);
      setCancelVendaId(null);
      setCancelMotivo('');
      loadData();
      alert('Venda cancelada com sucesso! Estoque restaurado.');
    } catch (err: any) {
      alert(err.message || 'Erro ao cancelar venda');
    }
  };

  const converterParaVenda = async (id: number) => {
    if (!window.confirm('Deseja concluir este orçamento como venda?')) return;
    try {
      await api.put(`/vendas/${id}/converter-venda`, {});
      loadData();
      alert('Orçamento convertido em venda com sucesso!');
    } catch (err) {
      console.error(err);
      alert('Erro ao converter orçamento');
    }
  };

  const handlePrint = () => {
    if (!printRef.current) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    // ── Logo e identidade da marca ──────────────────────────────────────────
    const nomeFantasia = (vendaDetalhada?.loja?.nomeFantasia || '').toLowerCase();
    const isTMImports = vendaDetalhada?.loja?.id === 4
      || nomeFantasia.includes('tm import')
      || nomeFantasia.includes('importa');
    const logoUrl   = `${window.location.origin}/${isTMImports ? 'logo-tm.png' : 'logo.png'}`;
    const brandName = isTMImports ? 'TM Imports' : 'Tecle Motos';
    const brandSub  = isTMImports ? 'Tecnologia em Mobilidade Elétrica' : 'Motopeças e Scooters Elétricas';

    // ── Tipo de documento ───────────────────────────────────────────────────
    const isOrcamento = vendaDetalhada?.tipo === 'ORCAMENTO';

    // ── Valores ─────────────────────────────────────────────────────────────
    const valorBrutoNum  = Number(vendaDetalhada?.valorBruto || 0);
    const valorTotalNum  = Number(vendaDetalhada?.valorTotal || 0);
    // Soma dos itens após desconto (sem encargos da máquina)
    const somaItens = (vendaDetalhada?.itens || []).reduce((acc: number, it: any) => {
      const desc = Number(it.desconto || 0);
      return acc + Number(it.precoUnitario) * it.quantidade * (1 - desc / 100);
    }, 0);
    const encargosNum = valorTotalNum > somaItens + 0.01 ? valorTotalNum - somaItens : 0;
    const descontoNum = somaItens > valorTotalNum ? somaItens - valorTotalNum : 0;

    // ── Parcelas ─────────────────────────────────────────────────────────────
    const parcelas     = vendaDetalhada?.parcelas || 1;
    const valorParcela = parcelas > 1 ? valorTotalNum / parcelas : 0;

    // ── Pagamentos compostos (COMBINADO) ────────────────────────────────────
    let pagamentosCompostos: {tipo:string; valor:number; parcelas:number; obs:string}[] = [];
    if (vendaDetalhada?.formaPagamento === 'COMBINADO' && vendaDetalhada?.pagamentosJson) {
      try { pagamentosCompostos = JSON.parse(vendaDetalhada.pagamentosJson); } catch (_) {}
    }
    const TAXAS: Record<number,number> = {
      1:0.0604,2:0.0736,3:0.0799,4:0.0865,5:0.0931,6:0.0999,
      7:0.1097,8:0.1168,9:0.1240,10:0.1314,11:0.1390,12:0.1467,
      13:0.1606,14:0.1687,15:0.1770,16:0.1854,17:0.1941,18:0.2030
    };
    const precisaEncargo = (t: string) => t === 'CARTAO_CREDITO' || t === 'CARTAO' || t === 'CARTAO_DEBITO';
    const labelPag = (t: string) => ({
      PIX:'PIX', DINHEIRO:'Dinheiro', CARTAO:'Cartão', CARTAO_DEBITO:'Cartão Débito',
      CARTAO_CREDITO:'Cartão Crédito', FINANCIAMENTO:'Financiamento',
      BOLETO:'Boleto', COMBINADO:'Combinado'
    }[t] || t);

    // ── HTML das linhas de pagamento ─────────────────────────────────────────
    const buildPagamentoHtml = (): string => {
      const fp = vendaDetalhada?.formaPagamento || '';
      if (fp === 'COMBINADO' && pagamentosCompostos.length) {
        return pagamentosCompostos.map(p => {
          const v  = Number(p.valor) || 0;
          const n  = Number(p.parcelas) || 1;
          const tx = precisaEncargo(p.tipo) ? (TAXAS[n] ?? 0) : 0;
          const total = v * (1 + tx);
          const porParcela = total / n;
          const parcelaStr = n > 1
            ? `${n}x de <strong>R$ ${porParcela.toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong> = R$ ${total.toLocaleString('pt-BR',{minimumFractionDigits:2})}`
            : `<strong>R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong> à vista`;
          return `<div class="pag-row"><span class="pag-label">${labelPag(p.tipo)}</span><span>${parcelaStr}</span></div>`;
        }).join('');
      }
      if ((fp === 'CARTAO_CREDITO' || fp === 'FINANCIAMENTO') && parcelas > 1) {
        return `<div class="pag-row"><span class="pag-label">${labelPag(fp)}</span><span>${parcelas}x de <strong>R$ ${valorParcela.toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></span></div>`;
      }
      return `<div class="pag-row"><span class="pag-label">${labelPag(fp)}</span><span><strong>R$ ${valorTotalNum.toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong> à vista</span></div>`;
    };

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${isOrcamento ? 'Orçamento' : 'Comprovante de Venda'} #${vendaDetalhada?.id}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, sans-serif; color: #1a1a1a; background: #fff; }

            /* ── Listra de topo ── */
            .brand-stripe { display: flex; height: 20px; width: 100%; }
            .stripe-black  { background: #0a0a0a; flex: 2; }
            .stripe-orange { background: #f97316; flex: 5; }
            .stripe-white  { background: #f0f0f0; flex: 1; }

            /* ── Cabeçalho com logo ── */
            .brand-header {
              background: #111111;
              display: flex; align-items: center; justify-content: space-between;
              padding: 16px 32px;
            }
            .brand-header img { height: 60px; object-fit: contain; }
            .brand-header-right { text-align: right; }
            .doc-type  { font-size: 10px; font-weight: 700; letter-spacing: 2px; color: #f97316; text-transform: uppercase; }
            .doc-num   { font-size: 22px; font-weight: 800; color: #fff; line-height: 1.1; }
            .doc-meta  { font-size: 11px; color: #9ca3af; margin-top: 2px; }
            .loja-name { font-size: 12px; color: #d1d5db; margin-top: 3px; }
            .orange-line { height: 3px; background: #f97316; }

            /* ── Corpo ── */
            .body-wrap { padding: 22px 32px; }

            /* ── Info grid ── */
            .info-grid { display: flex; gap: 24px; margin-bottom: 18px; }
            .info-box  { flex: 1; }
            .info-box-label {
              font-size: 9px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;
              color: #f97316; border-bottom: 1px solid #f97316; padding-bottom: 3px; margin-bottom: 7px;
            }
            .info-box p { font-size: 12px; margin-bottom: 2px; color: #222; }
            .info-box .val { font-weight: 600; }

            /* ── Tabela de itens ── */
            table { width: 100%; border-collapse: collapse; margin-bottom: 4px; font-size: 12px; }
            thead tr { background: #111; color: #fff; }
            th { padding: 7px 10px; font-size: 11px; font-weight: 600; text-align: left; }
            th:nth-child(2),td:nth-child(2) { text-align: center; }
            th:nth-child(3),td:nth-child(3),th:nth-child(4),td:nth-child(4),th:nth-child(5),td:nth-child(5) { text-align: right; }
            tbody tr:nth-child(even) { background: #f8f8f8; }
            td { padding: 7px 10px; border-bottom: 1px solid #eee; }

            /* ── Totais ── */
            .totals-wrap { display: flex; flex-direction: column; align-items: flex-end; margin: 10px 0 18px; }
            .totals-row  { display: flex; justify-content: space-between; width: 260px; font-size: 12px; padding: 2px 0; color: #555; }
            .totals-row.enc { color: #b45309; }
            .totals-row.disc { color: #dc2626; }
            .totals-final {
              display: flex; justify-content: space-between; width: 260px;
              font-size: 17px; font-weight: 800;
              border-top: 2px solid #f97316; padding-top: 7px; margin-top: 5px;
            }
            .totals-final .amount { color: #16a34a; }

            /* ── Pagamento detalhado ── */
            .pag-section { margin: 14px 0; padding: 12px 14px; background: #fffbf5; border-left: 3px solid #f97316; }
            .pag-title { font-size: 9px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #f97316; margin-bottom: 8px; }
            .pag-row { display: flex; justify-content: space-between; font-size: 12px; padding: 3px 0; border-bottom: 1px solid #fde68a; }
            .pag-row:last-child { border-bottom: none; }
            .pag-label { color: #555; }

            /* ── Parcela destaque ── */
            .parcela-box {
              text-align: center; background: #111; color: #fff;
              border-radius: 6px; padding: 10px 20px; margin: 14px 0;
              display: inline-block;
            }
            .parcela-box .n  { font-size: 28px; font-weight: 900; color: #f97316; line-height:1; }
            .parcela-box .de { font-size: 11px; color: #9ca3af; }
            .parcela-box .v  { font-size: 20px; font-weight: 800; }

            /* ── Garantias / Obs ── */
            .info-block {
              margin-top: 14px; padding: 11px 14px;
              background: #f9f9f9; border-left: 3px solid #f97316; font-size: 11px; color: #333;
            }
            .info-block strong { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: #f97316; }

            /* ── Rodapé ── */
            .doc-footer {
              margin-top: 28px; padding-top: 12px; border-top: 1px solid #e5e5e5;
              text-align: center; font-size: 10px; color: #aaa;
            }

            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .parcela-box { display: inline-block !important; }
            }
          </style>
        </head>
        <body>

          <!-- Listra de topo -->
          <div class="brand-stripe">
            <div class="stripe-black"></div>
            <div class="stripe-orange"></div>
            <div class="stripe-white"></div>
          </div>

          <!-- Cabeçalho com logo dinâmica -->
          <div class="brand-header">
            <img src="${logoUrl}" alt="${brandName}" />
            <div class="brand-header-right">
              <div class="doc-type">${isOrcamento ? 'Orçamento' : 'Comprovante de Venda'}</div>
              <div class="doc-num">#${vendaDetalhada?.id?.toString().padStart(5, '0')}</div>
              <div class="doc-meta">${vendaDetalhada?.createdAt ? new Date(vendaDetalhada.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : ''}</div>
              <div class="loja-name">${vendaDetalhada?.loja?.nomeFantasia || ''}</div>
            </div>
          </div>
          <div class="orange-line"></div>

          <div class="body-wrap">

            <!-- Cliente + Dados da venda -->
            <div class="info-grid">
              <div class="info-box">
                <div class="info-box-label">Cliente</div>
                <p class="val">${vendaDetalhada?.cliente?.nome || '-'}</p>
                ${vendaDetalhada?.cliente?.cpfCnpj ? `<p>CPF/CNPJ: ${vendaDetalhada.cliente.cpfCnpj}</p>` : ''}
                ${vendaDetalhada?.cliente?.telefone ? `<p>Tel: ${vendaDetalhada.cliente.telefone}</p>` : ''}
                ${vendaDetalhada?.cliente?.email ? `<p>${vendaDetalhada.cliente.email}</p>` : ''}
              </div>
              <div class="info-box">
                <div class="info-box-label">Dados da Venda</div>
                <p>Vendedor: <span class="val">${vendaDetalhada?.vendedor?.nome || '-'}</span></p>
                <p>Loja: <span class="val">${vendaDetalhada?.loja?.nomeFantasia || '-'}</span></p>
                <p>CNPJ: <span class="val">${vendaDetalhada?.loja?.cnpj || '-'}</span></p>
              </div>
            </div>

            <!-- Tabela de itens -->
            <table>
              <thead>
                <tr>
                  <th>Produto / Serviço</th>
                  <th>Qtd</th>
                  <th>Preço Un.</th>
                  <th>Desc.</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${(vendaDetalhada?.itens || []).map((item: any) => {
                  const desc  = Number(item.desconto || 0);
                  const bruto = Number(item.precoUnitario) * item.quantidade;
                  const final = bruto * (1 - desc / 100);
                  const nome  = item.produto?.nome || item.servico?.nome || '-';
                  const uf = item.unidadeFisica;
                  const detalhesUnidade = uf ? `<div style="font-size:10px;color:#888;margin-top:3px;font-family:monospace">` +
                    `${uf.chassi ? 'Chassi: ' + uf.chassi : 'Chassi: Não informado'}` +
                    `${uf.codigoMotor ? ' · Motor: ' + uf.codigoMotor : ''}` +
                    `${uf.cor ? ' · Cor: ' + uf.cor : ''}` +
                    `</div>` : '';
                  return `<tr>
                    <td>${nome}${detalhesUnidade}</td>
                    <td>${item.quantidade}</td>
                    <td>R$ ${Number(item.precoUnitario).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                    <td style="color:${desc>0?'#ca8a04':'#bbb'}">${desc>0?desc+'%':'-'}</td>
                    <td style="font-weight:600">R$ ${final.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>

            <!-- Bloco de totais -->
            <div class="totals-wrap">
              ${valorBrutoNum > 0 && Math.abs(valorBrutoNum - somaItens) > 0.01 ? `<div class="totals-row"><span>Valor dos produtos:</span><span>R$ ${valorBrutoNum.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>` : ''}
              ${descontoNum > 0.01 ? `<div class="totals-row disc"><span>Desconto aplicado:</span><span>- R$ ${descontoNum.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>` : ''}
              ${encargosNum > 0.01 ? `<div class="totals-row enc"><span>Encargos da máquina:</span><span>+ R$ ${encargosNum.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></div>` : ''}
              <div class="totals-final">
                <span>TOTAL A PAGAR</span>
                <span class="amount">R$ ${valorTotalNum.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span>
              </div>
            </div>

            <!-- Detalhamento de pagamento -->
            <div class="pag-section">
              <div class="pag-title">Condições de Pagamento</div>
              ${buildPagamentoHtml()}
            </div>

            <!-- Destaque visual das parcelas (somente se parcelado simples) -->
            ${parcelas > 1 && vendaDetalhada?.formaPagamento !== 'COMBINADO' ? `
              <div style="text-align:center; margin: 16px 0;">
                <div class="parcela-box">
                  <div class="n">${parcelas}x</div>
                  <div class="de">de</div>
                  <div class="v">R$ ${valorParcela.toLocaleString('pt-BR',{minimumFractionDigits:2})}</div>
                </div>
              </div>
            ` : ''}

            <!-- Garantias -->
            ${(vendaDetalhada?.itens||[]).some((i: any) => i.unidadeFisicaId) && vendaDetalhada?.tipo === 'VENDA' ? `
              <div class="info-block">
                <strong>Garantias Inclusas</strong>
                <p style="margin-top:6px">• Garantia Geral: 3 meses &nbsp;|&nbsp; • Motor: 12 meses &nbsp;|&nbsp; • Módulo: 12 meses &nbsp;|&nbsp; • Bateria: 12 meses</p>
                <p style="margin-top:4px;color:#888;font-size:10px">* A garantia requer revisões a cada 3 meses. A primeira revisão é gratuita.</p>
              </div>
            ` : ''}

            <!-- Observações -->
            ${vendaDetalhada?.observacoes ? `
              <div class="info-block" style="margin-top:10px">
                <strong>Observações</strong>
                <p style="margin-top:5px">${vendaDetalhada.observacoes}</p>
              </div>
            ` : ''}

            <!-- Rodapé -->
            <div class="doc-footer">
              ${brandName} &nbsp;·&nbsp; ${brandSub}<br>
              Documento gerado em ${new Date().toLocaleString('pt-BR')}
            </div>

          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  // VERSÃO PROVISÓRIA — sem persistência em banco (Fase 5 do plano de integração Check-in)
  const handleLaudoSaida = (venda: VendaFull) => {
    const nomeFantasia = (venda.loja?.nomeFantasia || '').toLowerCase();
    const isTMImports = venda.loja?.id === 4
      || nomeFantasia.includes('tm import')
      || nomeFantasia.includes('importa');
    const logoUrl   = `${window.location.origin}/${isTMImports ? 'logo-tm.png' : 'logo.png'}`;
    const brandName = isTMImports ? 'TM Imports' : 'Tecle Motos';

    const numeroSerie = `LDS-${venda.id.toString().padStart(6, '0')}`;
    const dataVenda   = venda.createdAt
      ? new Date(venda.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '-';
    const dataHoraGeracao = new Date().toLocaleString('pt-BR');

    // Monta dados das motos vendidas
    const motosHtml = (venda.itens || [])
      .filter(it => it.unidadeFisica)
      .map(it => {
        const uf = it.unidadeFisica!;
        const nome = it.produto?.nome || '-';
        return `
          <tr>
            <td>${nome}</td>
            <td>${uf.chassi || '<span style="color:#b91c1c">Não informado</span>'}</td>
            <td>${uf.codigoMotor || '-'}</td>
            <td>${uf.cor || '-'}</td>
          </tr>`;
      }).join('');

    const temMoto = motosHtml.length > 0;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Laudo de Saída ${numeroSerie}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; color: #1a1a1a; background: #fff; font-size: 13px; }

    /* ── Topo ── */
    .stripe { display:flex; height:18px; width:100%; }
    .stripe-black  { background:#0a0a0a; flex:2; }
    .stripe-orange { background:#f97316; flex:5; }
    .stripe-white  { background:#f0f0f0; flex:1; }
    .brand-header {
      background:#111; display:flex; align-items:center;
      justify-content:space-between; padding:14px 30px;
    }
    .brand-header img { height:52px; object-fit:contain; }
    .brand-right { text-align:right; }
    .doc-label  { font-size:9px; font-weight:700; letter-spacing:2px; color:#f97316; text-transform:uppercase; }
    .doc-num    { font-size:20px; font-weight:900; color:#fff; line-height:1.1; }
    .doc-meta   { font-size:10px; color:#9ca3af; margin-top:2px; }
    .doc-loja   { font-size:11px; color:#d1d5db; margin-top:2px; }
    .orange-bar { height:3px; background:#f97316; }

    /* ── Corpo ── */
    .body { padding:20px 30px; }
    .provisorio-aviso {
      background:#fef3c7; border:1px solid #f59e0b; border-radius:6px;
      padding:7px 12px; font-size:10px; color:#92400e; margin-bottom:14px;
    }

    /* ── Seções ── */
    .section { margin-bottom:18px; }
    .section-title {
      font-size:9px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase;
      color:#f97316; border-bottom:1.5px solid #f97316; padding-bottom:3px; margin-bottom:10px;
    }

    /* ── Grid de info ── */
    .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-bottom:18px; }
    .info-col p { font-size:12px; margin-bottom:3px; }
    .info-col .lbl { color:#777; display:inline-block; min-width:90px; }
    .info-col .val { font-weight:600; color:#111; }

    /* ── Tabela de motos ── */
    table { width:100%; border-collapse:collapse; font-size:12px; }
    thead tr { background:#111; color:#fff; }
    th { padding:7px 10px; font-size:11px; font-weight:600; text-align:left; }
    tbody tr:nth-child(even) { background:#f8f8f8; }
    td { padding:7px 10px; border-bottom:1px solid #eee; }

    /* ── Checklist ── */
    .checklist { display:grid; grid-template-columns:1fr 1fr; gap:0; }
    .check-item {
      display:flex; align-items:flex-start; gap:8px;
      padding:7px 10px; border-bottom:1px solid #f0f0f0;
      font-size:12px;
    }
    .check-item:nth-child(odd) { border-right:1px solid #f0f0f0; }
    .check-box {
      width:15px; height:15px; border:1.5px solid #aaa;
      border-radius:3px; flex-shrink:0; margin-top:1px;
    }
    .check-label { flex:1; color:#222; line-height:1.3; }
    .obs-area {
      margin-top:10px; border:1px solid #ddd; border-radius:6px;
      padding:10px 12px; min-height:52px; background:#fafafa;
      font-size:11px; color:#999;
    }

    /* ── Assinaturas ── */
    .assin-grid { display:grid; grid-template-columns:1fr 1fr; gap:30px; margin-top:6px; }
    .assin-box { text-align:center; }
    .assin-line {
      border-bottom:1.5px solid #333; height:56px; margin-bottom:6px;
      background: repeating-linear-gradient(
        transparent, transparent 55px, #eee 55px, #eee 56px
      );
    }
    .assin-label { font-size:11px; color:#555; }
    .assin-nome  { font-size:10px; color:#888; margin-top:2px; }
    .assin-data  { font-size:10px; color:#999; margin-top:10px; }

    /* ── Rodapé ── */
    .footer {
      margin-top:24px; padding-top:10px; border-top:1px solid #e5e5e5;
      text-align:center; font-size:10px; color:#aaa;
    }

    @media print {
      body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    }
  </style>
</head>
<body>

  <div class="stripe">
    <div class="stripe-black"></div>
    <div class="stripe-orange"></div>
    <div class="stripe-white"></div>
  </div>

  <div class="brand-header">
    <img src="${logoUrl}" alt="${brandName}" />
    <div class="brand-right">
      <div class="doc-label">Laudo de Saída</div>
      <div class="doc-num">${numeroSerie}</div>
      <div class="doc-meta">Venda #${venda.id.toString().padStart(5, '0')} &nbsp;·&nbsp; ${dataVenda}</div>
      <div class="doc-loja">${venda.loja?.nomeFantasia || ''}</div>
    </div>
  </div>
  <div class="orange-bar"></div>

  <div class="body">

    <div class="provisorio-aviso">
      ⚠ Versão provisória — documento para impressão manual. Assinatura digital e persistência serão implementadas em fase futura.
    </div>

    <!-- Dados da venda + cliente -->
    <div class="info-grid">
      <div class="info-col">
        <div class="section-title">Dados da Venda</div>
        <p><span class="lbl">Nº da Venda:</span> <span class="val">#${venda.id.toString().padStart(5, '0')}</span></p>
        <p><span class="lbl">Laudo:</span> <span class="val">${numeroSerie}</span></p>
        <p><span class="lbl">Data:</span> <span class="val">${dataVenda}</span></p>
        <p><span class="lbl">Loja:</span> <span class="val">${venda.loja?.nomeFantasia || '-'}</span></p>
        <p><span class="lbl">Vendedor:</span> <span class="val">${venda.vendedor?.nome || '-'}</span></p>
      </div>
      <div class="info-col">
        <div class="section-title">Dados do Cliente</div>
        <p><span class="lbl">Nome:</span> <span class="val">${venda.cliente?.nome || '-'}</span></p>
        ${venda.cliente?.cpfCnpj ? `<p><span class="lbl">CPF/CNPJ:</span> <span class="val">${venda.cliente.cpfCnpj}</span></p>` : ''}
        ${venda.cliente?.telefone ? `<p><span class="lbl">Telefone:</span> <span class="val">${venda.cliente.telefone}</span></p>` : ''}
        ${venda.cliente?.email ? `<p><span class="lbl">E-mail:</span> <span class="val">${venda.cliente.email}</span></p>` : ''}
      </div>
    </div>

    <!-- Dados da moto -->
    ${temMoto ? `
    <div class="section">
      <div class="section-title">Dados da Moto Entregue</div>
      <table>
        <thead>
          <tr>
            <th>Modelo</th>
            <th>Chassi</th>
            <th>Cód. Motor</th>
            <th>Cor</th>
          </tr>
        </thead>
        <tbody>
          ${motosHtml}
        </tbody>
      </table>
    </div>
    ` : ''}

    <!-- Checklist de entrega -->
    <div class="section">
      <div class="section-title">Checklist de Entrega</div>
      <div class="checklist">
        <div class="check-item"><div class="check-box"></div><div class="check-label">Manual de uso entregue</div></div>
        <div class="check-item"><div class="check-box"></div><div class="check-label">Carregador entregue</div></div>
        <div class="check-item"><div class="check-box"></div><div class="check-label">Chaves entregues</div></div>
        <div class="check-item"><div class="check-box"></div><div class="check-label">Recibo de venda entregue</div></div>
        <div class="check-item"><div class="check-box"></div><div class="check-label">Orientação de uso realizada</div></div>
        <div class="check-item"><div class="check-box"></div><div class="check-label">Orientação de carregamento realizada</div></div>
        <div class="check-item"><div class="check-box"></div><div class="check-label">Orientação de garantia realizada</div></div>
        <div class="check-item"><div class="check-box"></div><div class="check-label">Estado visual da moto conferido</div></div>
        <div class="check-item"><div class="check-box"></div><div class="check-label">Chassi conferido</div></div>
        <div class="check-item"><div class="check-box"></div><div class="check-label">Motor conferido</div></div>
        <div class="check-item" style="grid-column:1/-1"><div class="check-box"></div><div class="check-label">Cliente ciente das condições de garantia</div></div>
      </div>
      <div class="obs-area">Observações: __________________________________________________________________________________________________________</div>
    </div>

    <!-- Assinaturas -->
    <div class="section">
      <div class="section-title">Assinaturas</div>
      <div class="assin-grid">
        <div class="assin-box">
          <div class="assin-line"></div>
          <div class="assin-label">Assinatura do Cliente</div>
          <div class="assin-nome">${venda.cliente?.nome || ''}</div>
          <div class="assin-data">Data / Hora: _____ / _____ / _________ &nbsp; ____:____</div>
        </div>
        <div class="assin-box">
          <div class="assin-line"></div>
          <div class="assin-label">Assinatura do Vendedor</div>
          <div class="assin-nome">${venda.vendedor?.nome || ''}</div>
          <div class="assin-data">Data / Hora: _____ / _____ / _________ &nbsp; ____:____</div>
        </div>
      </div>
    </div>

    <div class="footer">
      ${brandName} &nbsp;·&nbsp; Laudo gerado em ${dataHoraGeracao}<br>
      Este documento é válido somente com as assinaturas das partes.
    </div>

  </div>
</body>
</html>`);

    printWindow.document.close();
    printWindow.print();
  };

  const abrirLaudoSaida = async (id: number) => {
    try {
      const venda = await api.get<VendaFull>(`/vendas/${id}`);
      handleLaudoSaida(venda);
    } catch (err) {
      console.error('Erro ao carregar venda para laudo:', err);
      alert('Erro ao carregar dados da venda');
    }
  };

  const pagamentoLabels: Record<string, string> = {
    PIX: 'PIX',
    DINHEIRO: 'Dinheiro',
    CARTAO: 'Cartão',
    CARTAO_DEBITO: 'Cartão Débito',
    CARTAO_CREDITO: 'Cartão Crédito',
    FINANCIAMENTO: 'Financiamento',
    BOLETO: 'Boleto',
    COMBINADO: 'Pagamento Combinado'
  };

  const quickBuscarCep = async (cep: string) => {
    const cepLimpo = cep.replace(/\D/g, '');
    if (cepLimpo.length !== 8) return;
    setQuickBuscandoCep(true);
    try {
      const data = await api.get<{ cep: string; logradouro: string; bairro: string; cidade: string; estado: string }>(
        `/clientes/buscar-cep/${cepLimpo}`
      );
      setQuickCliente(p => ({
        ...p,
        cep: data.cep,
        logradouro: data.logradouro || '',
        bairro: data.bairro || '',
        cidade: data.cidade || '',
        estado: data.estado || ''
      }));
    } catch { /* CEP não encontrado */ }
    finally { setQuickBuscandoCep(false); }
  };

  const quickHandleDocumentoBlur = async (valor: string) => {
    const doc = valor.replace(/\D/g, '');
    if (doc.length < 11) return;
    setQuickBuscandoDoc(true);
    setQuickClienteErro('');
    try {
      const encontrado = await api.get<{ id: number; nome: string; telefone?: string; email?: string }>(`/clientes/por-documento/${doc}`).catch(() => null);
      if (encontrado) {
        // Auto-seleciona o cliente existente e fecha o modal
        if (!clientes.find(c => c.id === encontrado.id)) {
          setClientes(prev => [...prev, encontrado]);
        }
        setForm(f => ({ ...f, clienteId: String(encontrado.id) }));
        setShowQuickCliente(false);
        setQuickCliente({ nome: '', cpfCnpj: '', telefone: '', email: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '' });
        setQuickClienteErro('');
        alert(`Cliente já cadastrado: ${encontrado.nome}. Selecionado automaticamente.`);
        return;
      }
      if (doc.length === 14) {
        const cnpjData = await buscarCNPJ(doc);
        if (cnpjData) {
          setQuickCliente(p => ({
            ...p,
            nome: p.nome || cnpjData.razaoSocial,
            telefone: p.telefone || cnpjData.telefone,
            email: p.email || cnpjData.email,
            cep: p.cep || cnpjData.cep.replace(/\D/g, ''),
            bairro: p.bairro || cnpjData.bairro,
            cidade: p.cidade || cnpjData.cidade,
            estado: p.estado || cnpjData.uf
          }));
          if (cnpjData.cep) await quickBuscarCep(cnpjData.cep);
        }
      }
    } finally {
      setQuickBuscandoDoc(false);
    }
  };

  const criarClienteRapido = async () => {
    setQuickClienteErro('');
    if (!quickCliente.nome.trim()) { setQuickClienteErro('Nome é obrigatório.'); return; }
    if (!quickCliente.cpfCnpj.trim()) { setQuickClienteErro('CPF/CNPJ é obrigatório.'); return; }
    const doc = quickCliente.cpfCnpj.replace(/\D/g, '');
    if (doc.length !== 11 && doc.length !== 14) { setQuickClienteErro('CPF deve ter 11 dígitos ou CNPJ 14 dígitos.'); return; }
    if (!quickCliente.email.trim() && !quickCliente.telefone.trim()) {
      setQuickClienteErro('Informe pelo menos email ou telefone para envio dos documentos da venda.');
      return;
    }

    setQuickClienteLoading(true);
    try {
      const novo = await api.post<{ id: number; nome: string }>('/clientes', {
        ...quickCliente,
        nome: quickCliente.nome.trim(),
      });
      setClientes(prev => [...prev, novo]);
      setForm(f => ({ ...f, clienteId: String(novo.id) }));
      setShowQuickCliente(false);
      setQuickCliente({ nome: '', cpfCnpj: '', telefone: '', email: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '' });
      setQuickClienteErro('');
    } catch (e: any) {
      setQuickClienteErro(e.message || 'Erro ao criar cliente');
    } finally {
      setQuickClienteLoading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">Carregando...</div>;
  }

  // ── Tela de Check-in substitui a listagem quando ativa ──────────────────────
  if (checkinVendaId !== null) {
    return (
      <CheckinSaida
        vendaId={checkinVendaId}
        onConcluir={() => { setCheckinVendaId(null); loadData(); }}
        onCancelar={() => setCheckinVendaId(null)}
      />
    );
  }

  const vendasFiltradas = vendas.filter(v => {
    if (filtroTipoVenda && v.tipo !== filtroTipoVenda) return false;
    if (filtroStatusVenda === 'confirmada' && !v.confirmadaFinanceiro) return false;
    if (filtroStatusVenda === 'pendente' && v.confirmadaFinanceiro) return false;
    if (filtroStatusVenda === 'cancelada' && !v.deletedAt) return false;
    if (buscaVendas) {
      const q = buscaVendas.toLowerCase();
      return String(v.id).includes(q) ||
        (v.cliente?.nome || '').toLowerCase().includes(q) ||
        (v.vendedor?.nome || '').toLowerCase().includes(q) ||
        (v.formaPagamento || '').toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold">Vendas</h1>
        <button onClick={() => setModalOpen(true)} className="btn btn-primary">+ Nova Venda</button>
      </div>

      {/* Filtros de busca */}
      <div className="flex gap-2 flex-wrap mb-4">
        <input
          value={buscaVendas}
          onChange={e => setBuscaVendas(e.target.value)}
          placeholder="🔍 Buscar cliente, vendedor, ID..."
          className="flex-1 min-w-40 bg-[#18181b] border border-[#27272a] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 placeholder-zinc-500"
        />
        <select
          value={filtroTipoVenda}
          onChange={e => setFiltroTipoVenda(e.target.value)}
          className="bg-[#18181b] border border-[#27272a] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
        >
          <option value="">Todos os tipos</option>
          <option value="VENDA">Venda</option>
          <option value="ORCAMENTO">Orçamento</option>
        </select>
        <select
          value={filtroStatusVenda}
          onChange={e => setFiltroStatusVenda(e.target.value)}
          className="bg-[#18181b] border border-[#27272a] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
        >
          <option value="">Todos os status</option>
          <option value="confirmada">Confirmada</option>
          <option value="pendente">Pendente</option>
          <option value="cancelada">Cancelada</option>
        </select>
        {(buscaVendas || filtroTipoVenda || filtroStatusVenda) && (
          <button
            onClick={() => { setBuscaVendas(''); setFiltroTipoVenda(''); setFiltroStatusVenda(''); }}
            className="text-xs text-zinc-500 hover:text-zinc-300 px-2 transition-colors"
          >✕ Limpar</button>
        )}
      </div>
      {(buscaVendas || filtroTipoVenda || filtroStatusVenda) && (
        <p className="text-xs text-zinc-500 mb-3">{vendasFiltradas.length} de {vendas.length} vendas</p>
      )}

      {vendasFiltradas.length === 0 ? (
        <div className="card p-8 text-center text-gray-500">
          {vendas.length === 0 ? 'Nenhuma venda encontrada' : 'Nenhuma venda corresponde ao filtro'}
        </div>
      ) : (
        <div className="space-y-3">
          {vendasFiltradas.map(venda => (
            <div key={venda.id} className="card">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-gray-500">#{venda.id}</span>
                  <span className={`badge ${venda.tipo === 'ORCAMENTO' ? 'badge-warning' : 'badge-success'}`}>
                    {venda.tipo === 'ORCAMENTO' ? 'Orçamento' : 'Venda'}
                  </span>
                  {venda.status === 'PENDENTE_CHECKIN' ? (
                    <span className="badge" style={{ background: '#f97316', color: '#fff', fontSize: '10px' }}>
                      Check-in Pendente
                    </span>
                  ) : (
                    <span className={`badge ${venda.confirmadaFinanceiro ? 'badge-success' : 'badge-warning'}`}>
                      {venda.confirmadaFinanceiro ? 'Confirmada' : 'Pendente'}
                    </span>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => abrirVisualizacao(venda.id)} className="btn btn-sm btn-secondary">
                    Ver
                  </button>
                  {venda.tipo === 'VENDA' && !venda.deletedAt && venda.status === 'PENDENTE_CHECKIN' && (
                    <button
                      onClick={() => setCheckinVendaId(venda.id)}
                      className="btn btn-sm btn-primary"
                    >
                      Continuar Check-in
                    </button>
                  )}
                  {venda.tipo === 'VENDA' && !venda.deletedAt && venda.status === 'FINALIZADA' && (
                    <button
                      onClick={() => abrirLaudoSaida(venda.id)}
                      className="btn btn-sm"
                      style={{ background: '#1d4ed8', color: '#fff' }}
                      title="Imprimir Laudo de Saída"
                    >
                      Laudo de Saída
                    </button>
                  )}
                  {venda.tipo === 'ORCAMENTO' && !venda.confirmadaFinanceiro && (
                    <button onClick={() => converterParaVenda(venda.id)} className="btn btn-sm btn-success">
                      Concluir
                    </button>
                  )}
                  {!venda.deletedAt && (user?.role === 'ADMIN_GERAL' || user?.role === 'GERENTE_LOJA' || user?.role === 'DONO_LOJA') && (
                    <button onClick={() => abrirCancelamento(venda.id)} className="btn btn-sm btn-danger">
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-gray-500 text-xs">Cliente</p>
                  <p className="text-white">{venda.cliente?.nome}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Vendedor</p>
                  <p className="text-gray-300">{venda.vendedor?.nome}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Pagamento</p>
                  <p className="text-gray-300">{pagamentoLabels[venda.formaPagamento] || venda.formaPagamento}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Data</p>
                  <p className="text-gray-300">{new Date(venda.createdAt).toLocaleDateString('pt-BR')}</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-zinc-700 flex justify-between items-center">
                <span className="text-gray-500 text-sm">Valor Total</span>
                <span className="text-xl font-bold text-green-400">
                  R$ {Number(venda.valorTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Nova Venda">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Tipo *</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="tipo"
                  value="VENDA"
                  checked={form.tipo === 'VENDA'}
                  onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                  className="accent-orange-500"
                />
                <span>Venda Efetiva</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="tipo"
                  value="ORCAMENTO"
                  checked={form.tipo === 'ORCAMENTO'}
                  onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                  className="accent-orange-500"
                />
                <span>Orcamento</span>
              </label>
            </div>
          </div>

          {lojas.length > 1 && !user?.lojaId && (
            <CustomSelect
              label="Loja"
              required
              value={form.lojaId}
              onChange={(val) => {
                setForm({ ...form, lojaId: val });
                setItensSelecionados([]);
                setMotosSelecionadas([]);
              }}
              options={lojas.map(l => ({ value: String(l.id), label: l.nomeFantasia }))}
            />
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-zinc-400">Cliente *</label>
              <button type="button" onClick={() => setShowQuickCliente(true)} className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-0.5 font-medium">
                + Novo Cliente
              </button>
            </div>
            <CustomSelect
              value={form.clienteId}
              onChange={(val) => setForm({ ...form, clienteId: val })}
              options={clientes.map(c => ({ value: String(c.id), label: c.nome }))}
              required
            />
          </div>

          <div className="border-t border-zinc-700 pt-4">
            <div className="flex justify-between items-center mb-2">
              <label className="label mb-0">Motos</label>
              <button type="button" onClick={adicionarMoto} className="btn btn-sm btn-secondary" disabled={produtos.filter(p => p.tipo === 'MOTO').length === 0}>
                + Adicionar Moto
              </button>
            </div>
            {produtos.filter(p => p.tipo === 'MOTO').length === 0 && form.lojaId ? (
              <p className="text-gray-500 text-sm">Nenhuma moto disponivel nesta loja</p>
            ) : motosSelecionadas.length === 0 ? (
              <p className="text-gray-500 text-sm">Nenhuma moto adicionada</p>
            ) : (
              <div className="space-y-3">
                {motosSelecionadas.map((item, index) => (
                  <div key={index} className="p-3 bg-zinc-800 rounded-lg">
                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      <CustomSelect
                        value={item.produtoId}
                        onChange={(val) => atualizarMoto(index, 'produtoId', val)}
                        className="flex-1"
                        placeholder="Selecione uma moto..."
                        options={produtos.filter(p => p.tipo === 'MOTO').map(p => {
                          const statusTag = p.estoque <= 0 ? ' [Sem estoque]' : ` [${p.estoque} un]`;
                          return {
                            value: String(p.id),
                            label: `${p.nome}${statusTag} - R$ ${Number(p.preco).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                            disabled: p.estoque <= 0 && form.tipo === 'VENDA'
                          };
                        })}
                      />
                      <div className="flex gap-3 items-end flex-wrap">
                        {!isCartao && (
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-zinc-500">Desconto</span>
                              <div className="flex rounded overflow-hidden border border-zinc-700">
                                <button type="button"
                                  onClick={() => atualizarMoto(index, 'descontoModo', 'pct')}
                                  className={`px-2.5 py-0.5 text-xs font-medium transition-colors ${item.descontoModo === 'pct' ? 'bg-orange-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                                  %
                                </button>
                                <button type="button"
                                  onClick={() => atualizarMoto(index, 'descontoModo', 'valor')}
                                  className={`px-2.5 py-0.5 text-xs font-medium transition-colors ${item.descontoModo === 'valor' ? 'bg-orange-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                                  R$
                                </button>
                              </div>
                            </div>
                            {item.descontoModo === 'pct' ? (
                              <div className={`flex items-center w-24 bg-zinc-800 border rounded-lg focus-within:ring-1 focus-within:ring-orange-500/50 transition-colors ${parseFloat(item.desconto) > maxDescontoRole || parseFloat(item.desconto) > 100 ? 'border-red-500' : 'border-zinc-700 focus-within:border-orange-500'}`}>
                                <input
                                  type="number" step="0.1" min="0" max="100"
                                  value={item.desconto}
                                  onChange={(e) => atualizarMoto(index, 'desconto', e.target.value)}
                                  className={`flex-1 min-w-0 bg-transparent py-2.5 pl-3 pr-1 text-sm outline-none border-none focus:ring-0 ${parseFloat(item.desconto) > maxDescontoRole || parseFloat(item.desconto) > 100 ? 'text-red-400' : 'text-yellow-400'}`}
                                  placeholder="0"
                                />
                                <span className="pr-2 text-gray-500 text-xs shrink-0 select-none">%</span>
                              </div>
                            ) : (
                              <div className={`flex items-center w-28 bg-zinc-800 border rounded-lg focus-within:ring-1 focus-within:ring-orange-500/50 transition-colors ${item.preco > 0 && (parseFloat(item.descontoValor) / item.preco * 100) > maxDescontoRole ? 'border-red-500' : 'border-zinc-700 focus-within:border-orange-500'}`}>
                                <span className="pl-2 pr-0.5 text-gray-500 text-xs shrink-0 select-none whitespace-nowrap">-R$</span>
                                <input
                                  type="number" step="0.01" min="0"
                                  value={item.descontoValor}
                                  onChange={(e) => atualizarMoto(index, 'descontoValor', e.target.value)}
                                  className="flex-1 min-w-0 bg-transparent py-2.5 pr-2 text-sm text-yellow-400 outline-none border-none focus:ring-0"
                                  placeholder="0,00"
                                />
                              </div>
                            )}
                          </div>
                        )}
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs text-zinc-500">Preço</span>
                          <div className="flex items-center gap-1 bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-2 py-1.5">
                            <span className="text-gray-500 text-xs">R$</span>
                            <span className="text-green-400 text-sm font-medium">{Number(item.preco).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                        <button type="button" onClick={() => removerMoto(index)} className="text-red-500 hover:text-red-400 font-bold mb-1">✕</button>
                      </div>
                    </div>
                    {item.produtoId && (
                      <div className="mt-2 rounded-lg border border-zinc-700/70 overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/60">
                          <span className="text-xs text-zinc-500">Base da venda</span>
                          <span className="text-sm font-medium text-zinc-300">
                            R$ {roundMoney(Number(item.preco)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="flex items-center justify-between px-3 py-2 bg-zinc-950/80">
                          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Valor Final</span>
                          <span className={`text-2xl font-black ${(item.descontoModo === 'valor' ? (parseFloat(item.descontoValor) || 0) > 0 : parseFloat(item.desconto) > 0) && !isCartao ? 'text-green-400' : 'text-orange-400'}`}>
                            R$ {itemFinal(item.preco, item.quantidade, item.desconto, item.descontoValor, item.descontoModo).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    )}
                    {item.produtoId && !isCartao && (
                      <div className="mt-1 ml-1">
                        {item.descontoModo === 'pct' && parseFloat(item.desconto) > 100 ? (
                          <p className="text-xs text-red-400 font-medium">⚠ Desconto não pode ultrapassar 100%.</p>
                        ) : parseFloat(item.desconto) > maxDescontoRole ? (
                          <p className="text-xs text-red-400 font-medium">⚠ O desconto máximo permitido para este perfil é de {maxDescontoRole}%.</p>
                        ) : item.descontoModo === 'valor' && item.preco > 0 && (parseFloat(item.descontoValor) || 0) > item.preco * 0.10 ? (
                          <p className="text-xs text-yellow-400">⚠ Desconto em valor ultrapassou 10% do preço base.</p>
                        ) : (
                          <p className="text-xs text-gray-500">Desconto máx. para este perfil: {maxDescontoRole}%</p>
                        )}
                      </div>
                    )}
                    {item.produtoId && (
                      <>
                        {item.carregandoUnidades && (
                          <div className="mt-3 text-xs text-zinc-400 animate-pulse">Buscando unidades disponíveis...</div>
                        )}
                        {!item.carregandoUnidades && item.alertaEstoque && (
                          <div className="mt-2 p-2 bg-yellow-900/30 border border-yellow-600/40 rounded-lg text-xs text-yellow-400">
                            ⚠ Estoque gerencial maior que chassis cadastrados. Regularize o estoque antes de vender.
                          </div>
                        )}
                        {!item.carregandoUnidades && item.unidadesPorModelo.length > 0 && (
                          <div className="mt-3">
                            <label className="text-xs text-gray-400 mb-1 block">Unidade física (chassi) *</label>
                            <input
                              type="text"
                              value={item.chassiSearch}
                              onChange={(e) => atualizarMoto(index, 'chassiSearch', e.target.value)}
                              placeholder="Filtrar por chassi, motor ou cor..."
                              className="w-full mb-1.5 bg-zinc-900 border border-zinc-700 text-white rounded-lg px-3 h-9 text-sm outline-none focus:border-orange-500/50 font-mono placeholder:font-sans placeholder:text-zinc-500"
                            />
                            <CustomSelect
                              value={item.unidadeId}
                              onChange={(val) => atualizarMoto(index, 'unidadeId', val)}
                              placeholder="Selecione o chassi..."
                              options={item.unidadesPorModelo
                                .filter(u => {
                                  if (!item.chassiSearch) return true;
                                  const q = item.chassiSearch.toLowerCase();
                                  return (u.chassi || '').toLowerCase().includes(q) ||
                                         (u.codigoMotor || '').toLowerCase().includes(q) ||
                                         (u.cor || '').toLowerCase().includes(q);
                                })
                                .map(u => ({
                                  value: String(u.id),
                                  label: `Chassi: ${u.chassi || 'N/A'} | Motor: ${u.codigoMotor || 'N/A'} | Cor: ${u.cor || 'N/A'}`
                                }))}
                            />
                          </div>
                        )}
                        {item.unidadeId ? (
                          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <div>
                              <label className="text-xs text-gray-400">Chassi</label>
                              <div className="input bg-zinc-900/60 text-green-400 font-mono text-sm flex items-center gap-1">
                                <span className="text-green-500 shrink-0">✓</span>
                                {item.chassi || '—'}
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-gray-400">Motor</label>
                              {item.motor ? (
                                <div className="input bg-zinc-900/60 text-green-400 font-mono text-sm flex items-center gap-1">
                                  <span className="text-green-500 shrink-0">✓</span>
                                  {item.motor}
                                </div>
                              ) : (
                                <div className="mt-1 p-2 bg-yellow-900/30 border border-yellow-600/40 rounded-lg text-xs text-yellow-400">
                                  ⚠ Motor não cadastrado para esta unidade.
                                </div>
                              )}
                            </div>
                            <div>
                              <label className="text-xs text-gray-400">Cor</label>
                              <div className="input bg-zinc-900/60 text-green-400 font-mono text-sm flex items-center gap-1">
                                <span className="text-green-500 shrink-0">✓</span>
                                {item.cor || '—'}
                              </div>
                            </div>
                          </div>
                        ) : !item.carregandoUnidades && item.unidadesPorModelo.length === 0 ? (
                          <div className="mt-3 p-3 bg-red-900/20 border border-red-600/40 rounded-lg text-sm text-red-400">
                            ⚠ Nenhuma unidade disponível para este modelo nesta loja. Cadastre o chassi no Estoque antes de vender.
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-zinc-700 pt-4">
            <div className="flex justify-between items-center mb-2">
              <label className="label mb-0">Pecas / Acessorios</label>
              <button type="button" onClick={adicionarItem} className="btn btn-sm btn-secondary">
                + Adicionar Peca
              </button>
            </div>
            {itensSelecionados.length === 0 ? (
              <p className="text-gray-500 text-sm">Nenhuma peca adicionada</p>
            ) : (
              <div className="space-y-2">
                {itensSelecionados.map((item, index) => {
                  const produtoAtual = produtos.find(p => p.id === parseInt(item.produtoId));
                  const maxQtd = produtoAtual && form.tipo === 'VENDA' ? produtoAtual.estoque : 9999;
                  return (
                  <div key={index} className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <CustomSelect
                      value={item.produtoId}
                      onChange={(val) => atualizarItem(index, 'produtoId', val)}
                      className="flex-1"
                      placeholder="Selecione uma peca..."
                      options={produtos.filter(p => p.tipo !== 'MOTO').map(p => {
                        const statusTag = p.estoque <= 0 ? ' [Sem estoque]' : p.estoque <= 3 ? ` [Baixo: ${p.estoque}]` : ` [${p.estoque} un]`;
                        return {
                          value: String(p.id),
                          label: `${p.nome}${statusTag} - R$ ${Number(p.preco).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                          disabled: p.estoque <= 0 && form.tipo === 'VENDA'
                        };
                      })}
                    />
                    <div className="flex gap-3 items-end flex-wrap">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs text-zinc-500">Qtd.</span>
                        <input
                          type="number" min="1" max={maxQtd}
                          value={item.quantidade}
                          onChange={(e) => atualizarItem(index, 'quantidade', parseInt(e.target.value) || 1)}
                          className="input w-16"
                        />
                      </div>
                      {!isCartao && (
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-zinc-500">Desconto</span>
                            <div className="flex rounded overflow-hidden border border-zinc-700">
                              <button type="button"
                                onClick={() => atualizarItem(index, 'descontoModo', 'pct')}
                                className={`px-2.5 py-0.5 text-xs font-medium transition-colors ${item.descontoModo === 'pct' ? 'bg-orange-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                                %
                              </button>
                              <button type="button"
                                onClick={() => atualizarItem(index, 'descontoModo', 'valor')}
                                className={`px-2.5 py-0.5 text-xs font-medium transition-colors ${item.descontoModo === 'valor' ? 'bg-orange-500 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                                R$
                              </button>
                            </div>
                          </div>
                          {item.descontoModo === 'pct' ? (
                            <div className={`flex items-center w-24 bg-zinc-800 border rounded-lg focus-within:ring-1 focus-within:ring-orange-500/50 transition-colors ${parseFloat(item.desconto) > maxDescontoRole || parseFloat(item.desconto) > 100 ? 'border-red-500' : 'border-zinc-700 focus-within:border-orange-500'}`}>
                              <input
                                type="number" step="0.1" min="0" max="100"
                                value={item.desconto}
                                onChange={(e) => atualizarItem(index, 'desconto', e.target.value)}
                                className={`flex-1 min-w-0 bg-transparent py-2.5 pl-3 pr-1 text-sm outline-none border-none focus:ring-0 ${parseFloat(item.desconto) > maxDescontoRole || parseFloat(item.desconto) > 100 ? 'text-red-400' : 'text-yellow-400'}`}
                                placeholder="0"
                              />
                              <span className="pr-2 text-gray-500 text-xs shrink-0 select-none">%</span>
                            </div>
                          ) : (
                            <div className={`flex items-center w-28 bg-zinc-800 border rounded-lg focus-within:ring-1 focus-within:ring-orange-500/50 transition-colors ${item.preco > 0 && item.quantidade > 0 && (parseFloat(item.descontoValor) / (item.preco * item.quantidade) * 100) > maxDescontoRole ? 'border-red-500' : 'border-zinc-700 focus-within:border-orange-500'}`}>
                              <span className="pl-2 pr-0.5 text-gray-500 text-xs shrink-0 select-none whitespace-nowrap">-R$</span>
                              <input
                                type="number" step="0.01" min="0"
                                value={item.descontoValor}
                                onChange={(e) => atualizarItem(index, 'descontoValor', e.target.value)}
                                className="flex-1 min-w-0 bg-transparent py-2.5 pr-2 text-sm text-yellow-400 outline-none border-none focus:ring-0"
                                placeholder="0,00"
                              />
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs text-zinc-500">Preço</span>
                        <div className="flex items-center w-28 bg-zinc-800 border border-zinc-700 rounded-lg focus-within:border-orange-500 focus-within:ring-1 focus-within:ring-orange-500/50 transition-colors">
                          <span className="pl-2 pr-0.5 text-gray-500 text-xs shrink-0 select-none">R$</span>
                          <input
                            type="number" step="0.01" min="0"
                            value={item.preco}
                            onChange={(e) => atualizarItem(index, 'preco', parseFloat(e.target.value) || 0)}
                            className="flex-1 min-w-0 bg-transparent py-2.5 pr-2 text-sm text-green-400 outline-none border-none focus:ring-0"
                          />
                        </div>
                      </div>
                      <button type="button" onClick={() => removerItem(index)} className="text-red-500 hover:text-red-400 font-bold mb-1">✕</button>
                    </div>
                    {item.produtoId && !isCartao && (
                      <div className="mt-1">
                        {item.descontoModo === 'pct' && parseFloat(item.desconto) > 100 ? (
                          <p className="text-xs text-red-400 font-medium">⚠ Desconto não pode ultrapassar 100%.</p>
                        ) : parseFloat(item.desconto) > maxDescontoRole ? (
                          <p className="text-xs text-red-400 font-medium">⚠ O desconto máximo permitido para este perfil é de {maxDescontoRole}%.</p>
                        ) : item.descontoModo === 'valor' && item.preco > 0 && (parseFloat(item.descontoValor) || 0) > item.preco * item.quantidade * 0.10 ? (
                          <p className="text-xs text-yellow-400">⚠ Desconto em valor ultrapassou 10% do subtotal.</p>
                        ) : (
                          <p className="text-xs text-gray-500">Desconto máx. para este perfil: {maxDescontoRole}%</p>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── PAGAMENTO ─────────────────────────────────────────── */}
          <div className="space-y-3">
            <div>
              <CustomSelect
                label="Forma de Pagamento"
                required
                value={form.formaPagamento}
                onChange={(val) => {
                  setForm(f => ({ ...f, formaPagamento: val, parcelas: '1' }));
                  if (val === 'COMBINADO') {
                    const total = calcularTotal();
                    setPagamentosCompostos([
                      { tipo: 'PIX', valor: '', parcelas: '1', obs: '' },
                      { tipo: 'CARTAO_CREDITO', valor: total > 0 ? total.toFixed(2) : '', parcelas: '1', obs: '' },
                    ]);
                  } else {
                    setPagamentosCompostos([{ tipo: 'PIX', valor: '', parcelas: '1', obs: '' }]);
                  }
                }}
                options={[
                  { value: 'PIX', label: '💰 PIX' },
                  { value: 'DINHEIRO', label: '💵 Dinheiro' },
                  { value: 'CARTAO_DEBITO', label: '💳 Cartão Débito' },
                  { value: 'CARTAO_CREDITO', label: '💳 Cartão Crédito' },
                  { value: 'FINANCIAMENTO', label: '🏦 Financiamento' },
                  { value: 'COMBINADO', label: '🔀 Combinado (entrada + parcelamento)' }
                ]}
              />
            </div>

            {/* Aviso cartão sem desconto */}
            {isCartao && !isCombinado && (
              <div className="p-3 bg-blue-900/30 border border-blue-500/50 rounded-lg flex items-start gap-2">
                <span className="text-blue-400">ℹ</span>
                <p className="text-sm text-blue-300">Vendas no cartão não possuem desconto. O valor será cobrado integralmente.</p>
              </div>
            )}

            {/* Parcelas para crédito/financiamento simples */}
            {isCredito && !isCombinado && (
              <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-4 space-y-3">
                <p className="text-xs text-zinc-400 uppercase tracking-wide font-medium">💳 Parcelamento</p>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-32">
                    <label className="block text-xs text-zinc-400 mb-1">Nº de Parcelas</label>
                    <select
                      value={form.parcelas}
                      onChange={e => setForm(f => ({ ...f, parcelas: e.target.value }))}
                      className="w-full bg-zinc-900 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
                    >
                      {TODAS_PARCELAS.map(n => (
                        <option key={n} value={n}>{n}x</option>
                      ))}
                    </select>
                  </div>
                  {calcularTotal() > 0 && (() => {
                    const n = parseInt(form.parcelas) || 1;
                    const base = calcularTotal();
                    const taxa = TAXAS_MAQUINA[n] ?? 0;
                    const totalComTaxa = base * (1 + taxa);
                    const parcela = totalComTaxa / n;
                    return (
                      <div className="text-right">
                        <p className="text-xs text-zinc-500">Valor por parcela</p>
                        <p className="text-lg font-bold text-orange-400">
                          R$ {parcela.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        <p className="text-xs text-zinc-500">
                          Taxa: {(taxa * 100).toFixed(2)}% · Total: R$ {totalComTaxa.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    );
                  })()}
                </div>
                {/* Atalho: adicionar entrada */}
                <button
                  type="button"
                  onClick={() => ativarCombinado('PIX')}
                  className="text-xs text-orange-400 hover:text-orange-300 border border-orange-500/30 hover:border-orange-400/50 px-3 py-1.5 rounded-lg transition-colors"
                >
                  + Adicionar entrada (PIX/Dinheiro) antes do crédito
                </button>
              </div>
            )}

            {/* Atalho para pagamento simples (PIX/Dinheiro): adicionar crédito */}
            {(form.formaPagamento === 'PIX' || form.formaPagamento === 'DINHEIRO') && (
              <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={() => ativarCombinado(form.formaPagamento)}
                  className="text-xs text-zinc-400 hover:text-orange-300 border border-zinc-700 hover:border-orange-500/40 px-3 py-1.5 rounded-lg transition-colors">
                  🔀 Dividir: entrada + parcelar restante no crédito
                </button>
              </div>
            )}

            {/* COMBINADO — UI principal redesenhada */}
            {isCombinado && (
              <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl overflow-hidden">
                {/* Header com total */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 bg-zinc-800">
                  <p className="text-sm font-semibold text-orange-400">🔀 Pagamento Combinado</p>
                  <div className="text-right">
                    <p className="text-xs text-zinc-500">Base da venda</p>
                    <p className="text-xs text-zinc-400">R$ {calcularTotal().toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">Total a pagar (c/ encargos)</p>
                    <p className="text-sm font-bold text-orange-300">R$ {totalComEncargos.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  {pagamentosCompostos.map((pag, i) => {
                    const valorPag = parseFloat(pag.valor) || 0;
                    const nParcelas = parseInt(pag.parcelas) || 1;
                    // Taxa da máquina aplicada ao valor parcelado
                    const taxaMaq = precisaParcelas(pag.tipo) ? (TAXAS_MAQUINA[nParcelas] ?? 0) : 0;
                    const valorComTaxa = valorPag * (1 + taxaMaq);
                    const valorParc = precisaParcelas(pag.tipo) && valorPag > 0
                      ? valorComTaxa / nParcelas
                      : null;
                    // Acumulado antes deste item
                    const acumuladoAntes = pagamentosCompostos.slice(0, i).reduce((s, p) => s + (parseFloat(p.valor) || 0), 0);
                    const restanteParaEste = Math.max(0, calcularTotal() - acumuladoAntes);

                    return (
                      <div key={i} className={`rounded-lg border p-3 space-y-2 ${i === 0 ? 'border-blue-500/40 bg-blue-500/5' : 'border-zinc-700 bg-zinc-900/40'}`}>
                        {/* Label da linha */}
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${i === 0 ? 'bg-blue-500/20 text-blue-300' : 'bg-zinc-700 text-zinc-400'}`}>
                            {i === 0 ? '💰 Entrada' : `💳 Pagamento ${i + 1}`}
                          </span>
                          {i === 0 && pagamentosCompostos.length === 2 && restanteParaEste > 0 && (
                            <span className="text-xs text-zinc-500">Restante: R$ {restanteParaEste.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          )}
                          {pagamentosCompostos.length > 1 && (
                            <button type="button" onClick={() => removePagamento(i)} className="text-red-400 hover:text-red-300 text-xs ml-auto pl-2">✕</button>
                          )}
                        </div>

                        {/* Campos */}
                        <div className="flex gap-2 flex-wrap items-end">
                          {/* Tipo */}
                          <div className="flex-1 min-w-32">
                            <label className="block text-xs text-zinc-400 mb-1">Forma</label>
                            <select
                              value={pag.tipo}
                              onChange={(e) => updatePagamento(i, 'tipo', e.target.value)}
                              className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-2 py-1.5 text-sm focus:border-orange-500 focus:outline-none"
                            >
                              <option value="PIX">PIX</option>
                              <option value="DINHEIRO">Dinheiro</option>
                              <option value="CARTAO_DEBITO">Cartão Débito</option>
                              <option value="CARTAO_CREDITO">Cartão Crédito</option>
                              <option value="FINANCIAMENTO">Financiamento</option>
                            </select>
                          </div>

                          {/* Valor */}
                          <div className="w-36">
                            <label className="block text-xs text-zinc-400 mb-1">Valor (R$)</label>
                            <div className="flex items-center bg-zinc-800 border border-zinc-700 rounded-lg focus-within:border-orange-500 focus-within:ring-1 focus-within:ring-orange-500/50 transition-colors">
                              <span className="pl-2 pr-0.5 text-zinc-500 text-xs shrink-0 select-none">R$</span>
                              <input
                                type="number" step="0.01" min="0"
                                value={pag.valor}
                                onChange={(e) => i === 0 ? updateEntrada(e.target.value) : updatePagamento(i, 'valor', e.target.value)}
                                className="flex-1 min-w-0 bg-transparent py-1.5 pr-2 text-sm text-white outline-none border-none focus:ring-0"
                                placeholder="0,00"
                              />
                            </div>
                          </div>

                          {/* Parcelas (só crédito/financiamento) */}
                          {precisaParcelas(pag.tipo) && (
                            <div className="w-24">
                              <label className="block text-xs text-zinc-400 mb-1">Parcelas</label>
                              <select
                                value={pag.parcelas}
                                onChange={(e) => updatePagamento(i, 'parcelas', e.target.value)}
                                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-2 py-1.5 text-sm focus:border-orange-500 focus:outline-none"
                              >
                                {TODAS_PARCELAS.map(n => (
                                  <option key={n} value={n}>{n}x</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>

                        {/* Simulação taxa da máquina (crédito/financiamento) */}
                        {precisaParcelas(pag.tipo) && valorPag > 0 && (
                          <div className="rounded-lg bg-orange-950/30 border border-orange-500/20 px-3 py-2 space-y-1">
                            <div className="flex items-center justify-between text-xs text-zinc-400">
                              <span>Valor financiado</span>
                              <span className="font-medium text-white">R$ {valorPag.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs text-zinc-400">
                              <span>Taxa da máquina ({nParcelas}x)</span>
                              <span className="text-yellow-400">+{(taxaMaq * 100).toFixed(2)}%</span>
                            </div>
                            <div className="flex items-center justify-between text-xs text-zinc-400">
                              <span>Total com encargos</span>
                              <span className="font-medium text-white">R$ {valorComTaxa.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                            <div className="border-t border-orange-500/20 pt-1 flex items-center justify-between">
                              <span className="text-xs font-semibold text-orange-300">{nParcelas}x de</span>
                              <span className="text-base font-bold text-orange-400">R$ {valorParc!.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Botão adicionar método */}
                  <button type="button" onClick={addPagamento}
                    className="w-full py-2 text-xs text-zinc-400 hover:text-orange-400 border border-dashed border-zinc-700 hover:border-orange-500/40 rounded-lg transition-colors">
                    + Adicionar outra forma de pagamento
                  </button>

                  {/* Resumo do total */}
                  <div className="space-y-1.5">
                    {/* Alerta só quando há diferença não distribuída */}
                    {Math.abs(totalPagamentosCompostos - calcularTotal()) >= 0.01 && (
                      <div className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/30">
                        <span>⚠ Valor não distribuído</span>
                        <span>faltam R$ {Math.abs(totalPagamentosCompostos - calcularTotal()).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    {/* Total real com encargos */}
                    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/30">
                      <span className="text-xs font-semibold text-orange-300">💳 Total a pagar pelo cliente</span>
                      <span className="text-sm font-bold text-orange-400">
                        R$ {totalComEncargos.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="label">Observacoes</label>
            <textarea
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              className="input"
              rows={2}
            />
          </div>

          <div className="border-t border-zinc-700 pt-4 space-y-3">
            <h4 className="text-sm font-medium text-gray-400">Resumo de Precos</h4>
            
            {(motosSelecionadas.filter(m => m.produtoId).length > 0 || itensSelecionados.filter(i => i.produtoId).length > 0) && (
              <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
                {motosSelecionadas.filter(m => m.produtoId).map((item, idx) => {
                  const subtotal = roundMoney(item.preco * item.quantidade);
                  const finalItem = itemFinal(item.preco, item.quantidade, item.desconto, item.descontoValor, item.descontoModo);
                  const descontoValor = item.descontoModo === 'valor'
                    ? roundMoney(parseFloat(item.descontoValor) || 0)
                    : roundMoney(subtotal - finalItem);
                  const temDesconto = !isCartao && descontoValor > 0;
                  const pctDigitado = parseFloat(item.desconto) || 0;
                  return (
                    <div key={`m-${idx}`} className="text-xs border-b border-zinc-700/50 pb-2 last:border-0">
                      <div className="flex justify-between text-gray-300">
                        <span>{item.displayName || 'Moto'}</span>
                        <span className="text-gray-400">R$ {subtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      {temDesconto && (
                        <div className="flex justify-between mt-1">
                          <span className="text-gray-500">
                            {item.descontoModo === 'pct' ? `Desconto (${pctDigitado}%):` : 'Desconto:'}
                          </span>
                          <span className="text-red-400">- R$ {descontoValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      {temDesconto && (
                        <div className="flex justify-between font-medium">
                          <span className="text-gray-500">Final:</span>
                          <span className="text-green-400">R$ {finalItem.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
                {itensSelecionados.filter(i => i.produtoId).map((item, idx) => {
                  const produto = produtos.find(p => p.id === parseInt(item.produtoId));
                  const nomeExibicao = produto?.nome || 'Peca';
                  const subtotal = roundMoney(item.preco * item.quantidade);
                  const finalItem = itemFinal(item.preco, item.quantidade, item.desconto, item.descontoValor, item.descontoModo);
                  const descontoValor = item.descontoModo === 'valor'
                    ? roundMoney(parseFloat(item.descontoValor) || 0)
                    : roundMoney(subtotal - finalItem);
                  const temDesconto = !isCartao && descontoValor > 0;
                  const pctDigitado = parseFloat(item.desconto) || 0;
                  return (
                    <div key={`p-${idx}`} className="text-xs border-b border-zinc-700/50 pb-2 last:border-0">
                      <div className="flex justify-between text-gray-300">
                        <span>{nomeExibicao} (x{item.quantidade})</span>
                        <span className="text-gray-400">R$ {subtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      {temDesconto && (
                        <div className="flex justify-between mt-1">
                          <span className="text-gray-500">
                            {item.descontoModo === 'pct' ? `Desconto (${pctDigitado}%):` : 'Desconto:'}
                          </span>
                          <span className="text-red-400">- R$ {descontoValor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      {temDesconto && (
                        <div className="flex justify-between font-medium">
                          <span className="text-gray-500">Final:</span>
                          <span className="text-green-400">R$ {finalItem.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="space-y-2 pt-2">
              <div className="flex justify-between items-center text-lg font-bold border-t border-zinc-700 pt-2">
                <span>Total a Pagar:</span>
                <span className="text-green-400">
                  R$ {(isCombinado ? totalComEncargos : calcularTotal()).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              {isCombinado && totalComEncargos > calcularTotal() && (
                <div className="flex justify-between text-xs text-zinc-500">
                  <span>Base do produto:</span>
                  <span>R$ {calcularTotal().toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              )}
            </div>
          </div>

          {formErro && (
            <div className="p-3 bg-red-500/15 border border-red-500/30 rounded-lg text-red-400 text-sm font-medium">
              {formErro}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setModalOpen(false); setFormErro(''); }} className="btn btn-secondary">
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving
                ? 'Salvando...'
                : form.tipo === 'ORCAMENTO'
                  ? 'Gerar Orçamento'
                  : 'Avançar para Check-in'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={viewModalOpen} onClose={() => setViewModalOpen(false)} title={vendaDetalhada?.tipo === 'ORCAMENTO' ? 'Orçamento' : 'Comprovante de Venda'}>
        <div className="space-y-4">
          <div ref={printRef}>
            {/* ── Logo dinâmica baseada na loja ── */}
            {(() => {
              const nf = (vendaDetalhada?.loja?.nomeFantasia || '').toLowerCase();
              const isTM = vendaDetalhada?.loja?.id === 4
                || nf.includes('tm import') || nf.includes('importa');
              const logo = isTM ? '/logo-tm.png' : '/logo.png';
              const brand = isTM ? 'TM Imports' : 'Tecle Motos';

              // Cálculos de valor
              const somaIt = (vendaDetalhada?.itens || []).reduce((acc: number, it: any) => {
                const d = Number(it.desconto || 0);
                return acc + Number(it.precoUnitario) * it.quantidade * (1 - d / 100);
              }, 0);
              const vTotal = Number(vendaDetalhada?.valorTotal || 0);
              const encargos = vTotal > somaIt + 0.01 ? vTotal - somaIt : 0;
              const desconto  = somaIt > vTotal + 0.01  ? somaIt - vTotal  : 0;

              // Parcelas
              const nParcelas = vendaDetalhada?.parcelas || 1;
              const vParcela  = nParcelas > 1 ? vTotal / nParcelas : 0;

              // Pagamentos compostos
              let pagsComp: {tipo:string; valor:number; parcelas:number}[] = [];
              if (vendaDetalhada?.formaPagamento === 'COMBINADO' && vendaDetalhada?.pagamentosJson) {
                try { pagsComp = JSON.parse(vendaDetalhada.pagamentosJson); } catch (_) {}
              }
              const TAXAS_M: Record<number,number> = {
                1:0.0604,2:0.0736,3:0.0799,4:0.0865,5:0.0931,6:0.0999,
                7:0.1097,8:0.1168,9:0.1240,10:0.1314,11:0.1390,12:0.1467,
                13:0.1606,14:0.1687,15:0.1770,16:0.1854,17:0.1941,18:0.2030
              };
              const labelFP = (t: string) => ({
                PIX:'PIX', DINHEIRO:'Dinheiro', CARTAO:'Cartão', CARTAO_DEBITO:'Cartão Débito',
                CARTAO_CREDITO:'Cartão Crédito', FINANCIAMENTO:'Financiamento',
                BOLETO:'Boleto', COMBINADO:'Combinado'
              }[t] || t);

              return (
                <>
                  {/* Listra + cabeçalho dark */}
                  <div className="-mx-4 -mt-2 mb-5">
                    <div className="flex h-[16px]">
                      <div className="flex-[2] bg-black" />
                      <div className="flex-[5] bg-orange-500" />
                      <div className="flex-[1] bg-zinc-200" />
                    </div>
                    <div className="bg-[#111111] flex items-center justify-between px-6 py-3">
                      <img src={logo} alt={brand} className="h-12 object-contain" />
                      <div className="text-right">
                        <p className="text-[10px] font-bold tracking-[2px] text-orange-500 uppercase">
                          {vendaDetalhada?.tipo === 'ORCAMENTO' ? 'Orçamento' : 'Comprovante de Venda'}
                        </p>
                        <p className="text-2xl font-black text-white leading-tight">
                          #{vendaDetalhada?.id?.toString().padStart(5, '0')}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {vendaDetalhada?.createdAt
                            ? new Date(vendaDetalhada.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
                            : ''}
                        </p>
                        <p className="text-[12px] text-gray-300 mt-1">{vendaDetalhada?.loja?.nomeFantasia}</p>
                      </div>
                    </div>
                    <div className="h-[3px] bg-orange-500" />
                  </div>

                  {/* Cliente + Dados */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                    <div>
                      <h3 className="text-[10px] font-bold tracking-widest text-orange-500 uppercase border-b border-orange-500/40 pb-1 mb-2">Cliente</h3>
                      <p className="font-semibold text-white">{vendaDetalhada?.cliente?.nome}</p>
                      {vendaDetalhada?.cliente?.cpfCnpj && <p className="text-sm text-gray-400">CPF/CNPJ: {vendaDetalhada.cliente.cpfCnpj}</p>}
                      {vendaDetalhada?.cliente?.telefone && <p className="text-sm text-gray-400">Tel: {vendaDetalhada.cliente.telefone}</p>}
                    </div>
                    <div>
                      <h3 className="text-[10px] font-bold tracking-widest text-orange-500 uppercase border-b border-orange-500/40 pb-1 mb-2">Informações</h3>
                      <p className="text-sm text-gray-400">Vendedor: <span className="text-white">{vendaDetalhada?.vendedor?.nome}</span></p>
                      <p className="text-sm text-gray-400">Loja: <span className="text-white">{vendaDetalhada?.loja?.nomeFantasia || '-'}</span></p>
                      <p className="text-sm text-gray-400">Data: <span className="text-white">{vendaDetalhada?.createdAt ? new Date(vendaDetalhada.createdAt).toLocaleDateString('pt-BR') : '-'}</span></p>
                    </div>
                  </div>

                  {/* Tabela de itens */}
                  <div className="overflow-x-auto -mx-1">
                    <table className="w-full min-w-[400px] mb-2 text-sm">
                      <thead>
                        <tr className="bg-zinc-900 border-b border-zinc-700">
                          <th className="text-left p-2 text-gray-400">Produto</th>
                          <th className="text-center p-2 text-gray-400">Qtd</th>
                          <th className="text-right p-2 text-gray-400">Preço Un.</th>
                          <th className="text-right p-2 text-gray-400">Desc.</th>
                          <th className="text-right p-2 text-gray-400">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vendaDetalhada?.itens?.map((item, i) => {
                          const desc = Number(item.desconto || 0);
                          const bruto = Number(item.precoUnitario) * item.quantidade;
                          const final = bruto * (1 - desc / 100);
                          const uf = item.unidadeFisica;
                          return (
                            <tr key={i} className="border-b border-zinc-800">
                              <td className="p-2">
                                <span>{item.produto?.nome || item.servico?.nome || '-'}</span>
                                {uf && (
                                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5 space-y-0">
                                    <span>Chassi: {uf.chassi || 'Não informado'}</span>
                                    {uf.codigoMotor && <span> · Motor: {uf.codigoMotor}</span>}
                                    {uf.cor && <span> · Cor: {uf.cor}</span>}
                                  </div>
                                )}
                              </td>
                              <td className="p-2 text-center">{item.quantidade}</td>
                              <td className="p-2 text-right">R$ {Number(item.precoUnitario).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="p-2 text-right">
                                {desc > 0 ? <span className="text-yellow-400 font-semibold">{desc}%</span> : <span className="text-gray-600">-</span>}
                              </td>
                              <td className="p-2 text-right font-semibold">R$ {final.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Totais */}
                  <div className="flex flex-col items-end border-t border-zinc-700 pt-3 gap-1">
                    {desconto > 0.01 && (
                      <div className="flex justify-between w-56 text-sm">
                        <span className="text-gray-400">Desconto:</span>
                        <span className="text-red-400">- R$ {desconto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    {encargos > 0.01 && (
                      <div className="flex justify-between w-56 text-sm">
                        <span className="text-gray-400">Encargos da máquina:</span>
                        <span className="text-yellow-500">+ R$ {encargos.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    <div className="flex justify-between w-56 text-lg font-bold border-t-2 border-orange-500 pt-2 mt-1">
                      <span className="text-gray-300">Total a Pagar:</span>
                      <span className="text-green-400">R$ {vTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    {/* Destaque parcelas */}
                    {nParcelas > 1 && vendaDetalhada?.formaPagamento !== 'COMBINADO' && (
                      <div className="flex justify-between w-56 text-sm text-gray-400 mt-0.5">
                        <span>{nParcelas}x de:</span>
                        <span className="text-orange-400 font-bold">R$ {vParcela.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    )}
                  </div>

                  {/* Condições de pagamento */}
                  <div className="mt-3 p-3 bg-zinc-900 border-l-4 border-orange-500 rounded-r text-sm">
                    <p className="text-[10px] font-bold tracking-widest text-orange-500 uppercase mb-2">Condições de Pagamento</p>
                    {vendaDetalhada?.formaPagamento === 'COMBINADO' && pagsComp.length > 0 ? (
                      <div className="space-y-1.5">
                        {pagsComp.map((p, pi) => {
                          const v  = Number(p.valor) || 0;
                          const n  = Number(p.parcelas) || 1;
                          const tx = (p.tipo === 'CARTAO_CREDITO' || p.tipo === 'CARTAO') ? (TAXAS_M[n] ?? 0) : 0;
                          const total = v * (1 + tx);
                          const porParcela = total / n;
                          return (
                            <div key={pi} className="flex justify-between border-b border-zinc-800 pb-1 last:border-0">
                              <span className="text-gray-400">{labelFP(p.tipo)}</span>
                              <span className="text-white">
                                {n > 1
                                  ? <>{n}x de <span className="text-orange-400 font-bold">R$ {porParcela.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> = R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
                                  : <span className="font-semibold">R$ {v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} à vista</span>
                                }
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex justify-between">
                        <span className="text-gray-400">{labelFP(vendaDetalhada?.formaPagamento || '')}</span>
                        <span className="text-white font-semibold">
                          {nParcelas > 1
                            ? <>{nParcelas}x de <span className="text-orange-400">R$ {vParcela.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></>
                            : <>R$ {vTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} à vista</>
                          }
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Garantias */}
                  {vendaDetalhada?.itens?.some((it: any) => it.unidadeFisicaId) && vendaDetalhada?.tipo === 'VENDA' && (
                    <div className="mt-3 p-3 bg-zinc-900 border-l-4 border-orange-500 rounded-r text-sm">
                      <p className="text-[10px] font-bold tracking-widest text-orange-500 uppercase mb-2">Garantias Inclusas</p>
                      <div className="space-y-0.5 text-gray-300">
                        <p>• Garantia Geral: 3 meses</p>
                        <p>• Motor: 12 meses &nbsp;|&nbsp; • Módulo: 12 meses &nbsp;|&nbsp; • Bateria: 12 meses</p>
                      </div>
                      <p className="mt-1.5 text-xs text-gray-500">* A garantia requer revisões a cada 3 meses. A primeira revisão é gratuita.</p>
                    </div>
                  )}

                  {/* Observações */}
                  {vendaDetalhada?.observacoes && (
                    <div className="mt-3 p-3 bg-zinc-900 border-l-4 border-orange-500 rounded-r text-sm">
                      <p className="text-[10px] font-bold tracking-widest text-orange-500 uppercase mb-1">Observações</p>
                      <p className="text-gray-300">{vendaDetalhada.observacoes}</p>
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* Documentos da venda (pós check-in) */}
          {vendaDetalhada?.tipo === 'VENDA' && vendaDetalhada?.status === 'FINALIZADA' && (
            <div className="mt-3 p-3 bg-zinc-900 border border-zinc-700 rounded-lg">
              <p className="text-[10px] font-bold tracking-widest text-orange-500 uppercase mb-2">Documentos</p>
              <div className="flex gap-2 flex-wrap">
                <button onClick={handlePrint} className="text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg">
                  Recibo
                </button>
                <button
                  onClick={() => handleLaudoSaida(vendaDetalhada)}
                  className="text-xs px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded-lg"
                >
                  Laudo de Saída
                </button>
                <button
                  onClick={async () => {
                    try {
                      await api.post(`/checkin/${vendaDetalhada.id}/reenviar`, {});
                      alert('Documentos reenviados com sucesso!');
                    } catch (e: any) { alert(e.message || 'Erro ao reenviar'); }
                  }}
                  className="text-xs px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg border border-zinc-700"
                >
                  Reenviar
                </button>
              </div>
            </div>
          )}

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

      <Modal isOpen={cancelModalOpen} onClose={() => setCancelModalOpen(false)} title="Cancelar Venda">
        <div className="space-y-4">
          <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg">
            <p className="text-red-400 text-sm font-medium">Atenção: Esta ação irá:</p>
            <ul className="text-red-300 text-xs mt-2 space-y-1 list-disc list-inside">
              <li>Restaurar o estoque dos produtos</li>
              <li>Remover contas a receber vinculadas</li>
              <li>Cancelar comissões do vendedor</li>
              <li>Desativar garantias geradas</li>
              <li>Remover entrada do caixa</li>
            </ul>
          </div>
          <div>
            <label className="label">Motivo do cancelamento / estorno *</label>
            <textarea
              value={cancelMotivo}
              onChange={e => setCancelMotivo(e.target.value)}
              className="input w-full h-24 resize-none"
              placeholder="Ex: Cliente desistiu da compra, erro no pedido, etc."
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setCancelModalOpen(false)} className="btn btn-secondary">
              Voltar
            </button>
            <button
              onClick={confirmarCancelamento}
              disabled={cancelMotivo.trim().length < 3}
              className="btn btn-danger"
            >
              Confirmar Cancelamento
            </button>
          </div>
        </div>
      </Modal>

      {showQuickCliente && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) { setShowQuickCliente(false); setQuickClienteErro(''); } }}>
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-[#27272a] flex items-center justify-between sticky top-0 bg-[#18181b] z-10">
              <h3 className="font-bold text-white">Novo Cliente</h3>
              <button onClick={() => { setShowQuickCliente(false); setQuickClienteErro(''); }} className="text-zinc-400 hover:text-white text-xl leading-none">×</button>
            </div>
            <div className="p-5 space-y-3">
              {quickClienteErro && (
                <div className="p-3 bg-red-900/30 border border-red-500/50 rounded-lg text-sm text-red-400">{quickClienteErro}</div>
              )}

              {/* CPF/CNPJ primeiro — dispara auto-fill */}
              <div>
                <label className="text-xs text-zinc-400 block mb-1">CPF / CNPJ *</label>
                <div className="relative">
                  <input
                    type="text"
                    className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                    value={quickCliente.cpfCnpj}
                    onChange={e => { setQuickCliente(p => ({ ...p, cpfCnpj: e.target.value })); setQuickClienteErro(''); }}
                    onBlur={e => quickHandleDocumentoBlur(e.target.value)}
                    placeholder="000.000.000-00 ou 00.000.000/0000-00"
                  />
                  {quickBuscandoDoc && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-orange-400 animate-pulse">buscando...</span>}
                </div>
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1">Nome *</label>
                <input
                  autoFocus
                  type="text"
                  className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                  value={quickCliente.nome}
                  onChange={e => setQuickCliente(p => ({ ...p, nome: e.target.value }))}
                  placeholder="Nome completo"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Telefone</label>
                  <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                    value={quickCliente.telefone} onChange={e => setQuickCliente(p => ({ ...p, telefone: e.target.value }))} placeholder="(00) 00000-0000" />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Email</label>
                  <input type="email" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                    value={quickCliente.email} onChange={e => setQuickCliente(p => ({ ...p, email: e.target.value }))} placeholder="email@exemplo.com" />
                </div>
              </div>

              {/* Endereço */}
              <div className="border-t border-zinc-700 pt-3">
                <p className="text-xs text-zinc-500 mb-2">Endereço (opcional)</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-1">
                    <label className="text-xs text-zinc-400 block mb-1">CEP</label>
                    <div className="relative">
                      <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                        value={quickCliente.cep} onChange={e => setQuickCliente(p => ({ ...p, cep: e.target.value }))}
                        onBlur={e => quickBuscarCep(e.target.value)} placeholder="00000-000" maxLength={9} />
                      {quickBuscandoCep && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-orange-400 animate-pulse">...</span>}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-zinc-400 block mb-1">Logradouro</label>
                    <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                      value={quickCliente.logradouro} onChange={e => setQuickCliente(p => ({ ...p, logradouro: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-2">
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">Número</label>
                    <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                      value={quickCliente.numero} onChange={e => setQuickCliente(p => ({ ...p, numero: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">Compl.</label>
                    <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                      value={quickCliente.complemento} onChange={e => setQuickCliente(p => ({ ...p, complemento: e.target.value }))} />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-zinc-400 block mb-1">Bairro</label>
                    <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                      value={quickCliente.bairro} onChange={e => setQuickCliente(p => ({ ...p, bairro: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div className="col-span-2">
                    <label className="text-xs text-zinc-400 block mb-1">Cidade</label>
                    <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                      value={quickCliente.cidade} onChange={e => setQuickCliente(p => ({ ...p, cidade: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">Estado</label>
                    <input type="text" className="w-full bg-[#09090b] border border-[#27272a] text-white rounded-lg px-3 h-10 text-sm outline-none focus:border-orange-500/50"
                      value={quickCliente.estado} onChange={e => setQuickCliente(p => ({ ...p, estado: e.target.value }))} maxLength={2} placeholder="UF" />
                  </div>
                </div>
              </div>
            </div>
            <div className="p-5 pt-0 flex gap-3 justify-end">
              <button onClick={() => { setShowQuickCliente(false); setQuickClienteErro(''); }} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">Cancelar</button>
              <button
                onClick={criarClienteRapido}
                disabled={quickClienteLoading || quickBuscandoDoc}
                className="px-4 py-2 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-lg disabled:opacity-50 font-medium transition-colors"
              >
                {quickClienteLoading ? 'Salvando...' : 'Salvar Cliente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
