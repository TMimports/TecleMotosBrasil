import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../services/api';
import ExcelJS from 'exceljs';

interface Loja    { id: number; nomeFantasia: string; }
interface Produto { id: number; nome: string; tipo: string; codigo: string; }
interface UnidadeDisp { id: number; chassi: string | null; cor: string | null; ano: number | null; status: string; produto: { id: number; nome: string; }; }

/* ── Linha de chassi (ENTRADA MOTO) ─────────────────────────────── */
interface ChassiRow { chassi: string; cor: string; ano: string; custo: string; }
const emptyRow = (): ChassiRow => ({ chassi: '', cor: '', ano: String(new Date().getFullYear()), custo: '' });

/* ── Item de ENTRADA (multi-item) ───────────────────────────────── */
interface EntradaItem { id: number; produtoId: string; chassis: ChassiRow[]; quantidade: string; }
let nextEntId = 1;
const emptyEntradaItem = (): EntradaItem => ({ id: nextEntId++, produtoId: '', chassis: [emptyRow()], quantidade: '1' });

/* ── Item de SAÍDA (multi-item) ─────────────────────────────────── */
interface SaidaItem { id: number; produtoId: string; chassis: UnidadeDisp[]; chassiSel: string; quantidade: string; }
let nextSaidaId = 1;
const emptySaidaItem = (): SaidaItem => ({ id: nextSaidaId++, produtoId: '', chassis: [], chassiSel: '', quantidade: '1' });

const inp = 'bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-orange-500 w-full';
const sel = inp + ' cursor-pointer';

const MOTIVOS_SAIDA  = ['Perda / Sinistro', 'Roubo / Furto', 'Devolução ao Fornecedor', 'Demonstração', 'Outro'];
const MOTIVOS_AJUSTE = ['Contagem Física', 'Correção de Lançamento', 'Acerto de Inventário', 'Outro'];

type Operacao = 'ENTRADA' | 'SAIDA' | 'AJUSTE';

const OP_CONFIG: Record<Operacao, { label: string; icon: string; activeCls: string; btnCls: string }> = {
  ENTRADA: { label: 'Entrada',  icon: '📦', activeCls: 'bg-green-500 text-white border-green-500',  btnCls: 'bg-green-500 hover:bg-green-600 text-white' },
  SAIDA:   { label: 'Saída',    icon: '📤', activeCls: 'bg-red-500 text-white border-red-500',       btnCls: 'bg-red-500 hover:bg-red-600 text-white' },
  AJUSTE:  { label: 'Ajuste',   icon: '⚙️', activeCls: 'bg-yellow-500 text-white border-yellow-500', btnCls: 'bg-yellow-500 hover:bg-yellow-600 text-white' },
};

export function TabMovAvulsa({ lojas }: { lojas: Loja[] }) {
  const { user } = useAuth();

  const [operacao, setOperacao]     = useState<Operacao>('ENTRADA');
  const [lojaId, setLojaId]         = useState(String(user?.lojaId || ''));
  const [produtos, setProdutos]     = useState<Produto[]>([]);
  const [motivo, setMotivo]         = useState('');
  const [motivoCustom, setMotivoCustom] = useState('');
  const [observacao, setObservacao] = useState('');
  const [saving, setSaving]         = useState(false);
  const [sucesso, setSucesso]       = useState('');
  const [erro, setErro]             = useState('');

  /* ── ENTRADA multi-item ─────────────────────────────────────────── */
  const [entradaItems, setEntradaItems] = useState<EntradaItem[]>([emptyEntradaItem()]);

  /* ── SAÍDA multi-item ───────────────────────────────────────────── */
  const [saidaItems, setSaidaItems] = useState<SaidaItem[]>([emptySaidaItem()]);
  const loadingChassis = useRef<Record<number, boolean>>({});

  /* ── AJUSTE (single) ────────────────────────────────────────────── */
  const [adjProdutoId, setAdjProdutoId]   = useState('');
  const [adjProdutoSel, setAdjProdutoSel] = useState<Produto | null>(null);
  const [adjChassis, setAdjChassis]       = useState<UnidadeDisp[]>([]);
  const [adjChassiSel, setAdjChassiSel]   = useState('');
  const [adjQtd, setAdjQtd]              = useState('1');

  const isEntrada = operacao === 'ENTRADA';
  const isSaida   = operacao === 'SAIDA';
  const isAjuste  = operacao === 'AJUSTE';

  const fileEntradaRef = useRef<HTMLInputElement>(null);
  const fileSaidaRef   = useRef<HTMLInputElement>(null);
  const [importErroEntrada, setImportErroEntrada] = useState('');
  const [importErroSaida,   setImportErroSaida]   = useState('');

  useEffect(() => {
    api.get<Produto[]>('/produtos?ativo=true')
      .then(lista => setProdutos(lista || []))
      .catch(() => setProdutos([]));
  }, []);

  /* ── Carregar chassis AJUSTE ──────────────────────────────────── */
  useEffect(() => {
    const p = produtos.find(x => String(x.id) === adjProdutoId) || null;
    setAdjProdutoSel(p);
    setAdjChassis([]);
    setAdjChassiSel('');
    if (!p || p.tipo !== 'MOTO' || !lojaId || !adjProdutoId) return;
    api.get<{ unidades: UnidadeDisp[] }>(`/estoque/geral?lojaId=${lojaId}&statusUni=ESTOQUE`)
      .then(d => {
        const prod = Number(adjProdutoId);
        setAdjChassis((d?.unidades || []).filter(u => u.produto.id === prod && u.chassi));
      })
      .catch(() => setAdjChassis([]));
  }, [adjProdutoId, lojaId, produtos]);

  /* ── Carregar chassis SAÍDA por item ─────────────────────────── */
  async function carregarChassisSaida(itemId: number, produtoId: string) {
    if (!lojaId || !produtoId || loadingChassis.current[itemId]) return;
    const prod = produtos.find(p => String(p.id) === produtoId);
    if (!prod || prod.tipo !== 'MOTO') return;
    loadingChassis.current[itemId] = true;
    try {
      const d = await api.get<{ unidades: UnidadeDisp[] }>(`/estoque/geral?lojaId=${lojaId}&statusUni=ESTOQUE`);
      const prodNum = Number(produtoId);
      const disponiveis = (d?.unidades || []).filter(u => u.produto.id === prodNum && u.chassi);
      setSaidaItems(prev => prev.map(si => si.id === itemId ? { ...si, chassis: disponiveis, chassiSel: '' } : si));
    } catch {
      setSaidaItems(prev => prev.map(si => si.id === itemId ? { ...si, chassis: [], chassiSel: '' } : si));
    } finally {
      loadingChassis.current[itemId] = false;
    }
  }

  /* ── Helpers ENTRADA ────────────────────────────────────────────── */
  const addEntradaItem    = () => setEntradaItems(prev => [...prev, emptyEntradaItem()]);
  const removeEntradaItem = (id: number) => setEntradaItems(prev => prev.length > 1 ? prev.filter(ei => ei.id !== id) : prev);
  const updateEntradaItem = (id: number, field: 'produtoId' | 'quantidade', value: string) => {
    setEntradaItems(prev => prev.map(ei => {
      if (ei.id !== id) return ei;
      if (field === 'produtoId') return { ...ei, produtoId: value, chassis: [emptyRow()], quantidade: '1' };
      return { ...ei, [field]: value };
    }));
  };
  const addEntradaChassi    = (id: number) => setEntradaItems(prev => prev.map(ei => ei.id === id ? { ...ei, chassis: [...ei.chassis, emptyRow()] } : ei));
  const removeEntradaChassi = (id: number, idx: number) => setEntradaItems(prev => prev.map(ei => ei.id === id ? { ...ei, chassis: ei.chassis.filter((_, i) => i !== idx) } : ei));
  const updateEntradaChassi = (id: number, idx: number, field: keyof ChassiRow, value: string) =>
    setEntradaItems(prev => prev.map(ei => ei.id === id ? { ...ei, chassis: ei.chassis.map((r, i) => i === idx ? { ...r, [field]: value } : r) } : ei));

  /* ── Helpers SAÍDA ──────────────────────────────────────────────── */
  const addSaidaItem    = () => setSaidaItems(prev => [...prev, emptySaidaItem()]);
  const removeSaidaItem = (id: number) => setSaidaItems(prev => prev.length > 1 ? prev.filter(si => si.id !== id) : prev);
  const updateSaidaItem = (id: number, field: keyof SaidaItem, value: string) => {
    setSaidaItems(prev => prev.map(si => {
      if (si.id !== id) return si;
      if (field === 'produtoId') {
        const updated = { ...si, produtoId: value, chassiSel: '', chassis: [], quantidade: '1' };
        carregarChassisSaida(id, value);
        return updated;
      }
      return { ...si, [field]: value };
    }));
  };

  async function baixarModeloEntrada() {
    const anoAtual = new Date().getFullYear();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Entradas');
    sheet.columns = [{ width: 24 }, { width: 20 }, { width: 10 }, { width: 14 }, { width: 8 }, { width: 12 }];
    [
      ['Chassi', 'Modelo', 'Cor', 'Cód. Motor', 'Ano', 'Custo (R$)'],
      ['9C2JKD...', 'TM13', 'Preto', 'MOT001', anoAtual, '8500,00'],
      ['9C2JKD...', 'TM14', 'Branco', 'MOT002', anoAtual, '9200,00'],
    ].forEach(row => sheet.addRow(row));
    const buf = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = 'modelo_entrada_avulsa.xlsx'; a.click(); URL.revokeObjectURL(url);
  }

  async function baixarModeloSaida() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Saidas');
    sheet.columns = [{ width: 24 }];
    [['Chassi'], ['9C2JKD...'], ['9C2JKD...']].forEach(row => sheet.addRow(row));
    const buf = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = 'modelo_saida_avulsa.xlsx'; a.click(); URL.revokeObjectURL(url);
  }

  function importarPlanilhaEntrada(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportErroEntrada('');
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(evt.target?.result as ArrayBuffer);
        const ws = workbook.worksheets[0];
        const data: any[][] = [];
        ws.eachRow({ includeEmpty: false }, (row) => {
          data.push((row.values as any[]).slice(1).map((v: any) => {
            if (v === null || v === undefined) return '';
            if (typeof v === 'object' && v.text) return v.text;
            if (typeof v === 'object' && v.result !== undefined) return v.result;
            return v;
          }));
        });
        if (data.length < 2) { setImportErroEntrada('Planilha vazia.'); return; }
        const headers = (data[0] as any[]).map((h: any) => String(h).toLowerCase().trim());
        const col = (names: string[]) => names.reduce((found, n) => found >= 0 ? found : headers.findIndex(h => h.includes(n)), -1);
        const iChassi = col(['chassi', 'chassis']);
        const iModelo = col(['modelo', 'model', 'produto', 'product']);
        const iCor    = col(['cor', 'color']);
        const iMotor  = col(['motor', 'cód']);
        const iAno    = col(['ano', 'year']);
        const iCusto  = col(['custo', 'cost', 'valor', 'price']);
        if (iChassi === -1) { setImportErroEntrada('Coluna "Chassi" não encontrada na planilha.'); return; }
        const rows = (data.slice(1) as any[][]).map(row => ({
          chassi:     String(row[iChassi] ?? '').trim(),
          modeloNome: iModelo >= 0 ? String(row[iModelo] ?? '').trim() : '',
          cor:        iCor    >= 0 ? String(row[iCor]    ?? '').trim() : '',
          codigoMotor: iMotor >= 0 ? String(row[iMotor]  ?? '').trim() : '',
          ano:        iAno    >= 0 ? String(row[iAno]    ?? '').trim() : String(new Date().getFullYear()),
          custo:      iCusto  >= 0 ? String(row[iCusto]  ?? '').trim() : '',
        })).filter(r => r.chassi);
        if (rows.length === 0) { setImportErroEntrada('Nenhum chassi encontrado na planilha.'); return; }
        const errosModelo: string[] = [];
        const mapaGrupos: Record<string, EntradaItem> = {};
        for (const row of rows) {
          const search = row.modeloNome.toLowerCase();
          const matchProd = produtos.find(p => {
            const nome = p.nome.toLowerCase();
            const cod  = (p.codigo ?? '').toLowerCase();
            return nome === search || nome.includes(search) || search.includes(nome) || cod === search;
          });
          if (!matchProd && row.modeloNome) {
            if (!errosModelo.includes(row.modeloNome)) errosModelo.push(row.modeloNome);
            continue;
          }
          const key = matchProd ? String(matchProd.id) : '__avulso__';
          if (!mapaGrupos[key]) {
            const ei = emptyEntradaItem();
            ei.produtoId = matchProd ? String(matchProd.id) : '';
            ei.chassis = [];
            mapaGrupos[key] = ei;
          }
          mapaGrupos[key].chassis.push({ chassi: row.chassi, cor: row.cor, ano: row.ano || String(new Date().getFullYear()), custo: row.custo });
        }
        const grupos = Object.values(mapaGrupos);
        if (grupos.length === 0) { setImportErroEntrada('Nenhum modelo reconhecido na planilha.'); return; }
        if (errosModelo.length > 0) setImportErroEntrada(`⚠️ Modelos não reconhecidos: ${errosModelo.join(', ')}. Os demais foram importados.`);
        setEntradaItems(grupos);
      } catch { setImportErroEntrada('Erro ao ler a planilha. Verifique o formato.'); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  async function importarPlanilhaSaida(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportErroSaida('');
    if (!lojaId) { setImportErroSaida('Selecione a loja antes de importar.'); return; }
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(evt.target?.result as ArrayBuffer);
        const ws = workbook.worksheets[0];
        const data: any[][] = [];
        ws.eachRow({ includeEmpty: false }, (row) => {
          data.push((row.values as any[]).slice(1).map((v: any) => {
            if (v === null || v === undefined) return '';
            if (typeof v === 'object' && v.text) return v.text;
            if (typeof v === 'object' && v.result !== undefined) return v.result;
            return v;
          }));
        });
        if (data.length < 2) { setImportErroSaida('Planilha vazia.'); return; }
        const headers = (data[0] as any[]).map((h: any) => String(h).toLowerCase().trim());
        const col = (names: string[]) => names.reduce((found, n) => found >= 0 ? found : headers.findIndex(h => h.includes(n)), -1);
        const iChassi = col(['chassi', 'chassis']);
        if (iChassi === -1) { setImportErroSaida('Coluna "Chassi" não encontrada na planilha.'); return; }
        const chassisList = (data.slice(1) as any[][]).map(row => String(row[iChassi] ?? '').trim()).filter(c => c);
        if (chassisList.length === 0) { setImportErroSaida('Nenhum chassi encontrado.'); return; }
        const d = await api.get<{ unidades: UnidadeDisp[] }>(`/estoque/geral?lojaId=${lojaId}&statusUni=ESTOQUE`);
        const unidades = d?.unidades || [];
        const naoEncontrados: string[] = [];
        const novosSaidaItems: SaidaItem[] = [];
        for (const chassi of chassisList) {
          const unidade = unidades.find(u => u.chassi?.toLowerCase() === chassi.toLowerCase());
          if (!unidade) { naoEncontrados.push(chassi); continue; }
          const item = emptySaidaItem();
          item.produtoId = String(unidade.produto.id);
          item.chassis   = unidades.filter(u => u.produto.id === unidade.produto.id && u.chassi);
          item.chassiSel = chassi;
          novosSaidaItems.push(item);
        }
        if (novosSaidaItems.length === 0) {
          setImportErroSaida(`Nenhum chassi encontrado no estoque desta loja: ${naoEncontrados.join(', ')}`);
          return;
        }
        if (naoEncontrados.length > 0) setImportErroSaida(`⚠️ Não encontrados no estoque: ${naoEncontrados.join(', ')}`);
        setSaidaItems(novosSaidaItems);
      } catch { setImportErroSaida('Erro ao ler a planilha ou ao consultar o estoque.'); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  function reset() {
    setEntradaItems([emptyEntradaItem()]);
    setSaidaItems([emptySaidaItem()]);
    setAdjProdutoId(''); setAdjChassiSel(''); setAdjQtd('1');
    setMotivo(''); setMotivoCustom(''); setObservacao('');
    setErro(''); setSucesso('');
  }

  async function handleSubmit() {
    setErro(''); setSucesso('');
    if (!lojaId) return setErro('Selecione a loja');

    const motivoFinal = motivo === 'Outro' ? motivoCustom.trim() : motivo;
    if ((isSaida || isAjuste) && !motivoFinal) return setErro('Motivo é obrigatório');

    setSaving(true);
    try {
      if (isEntrada) {
        const itensValidos = entradaItems.filter(ei => ei.produtoId);
        if (itensValidos.length === 0) { setErro('Adicione pelo menos um item'); setSaving(false); return; }

        let totalChassis = 0;
        let totalPecas   = 0;

        for (const ei of itensValidos) {
          const prod = produtos.find(p => String(p.id) === ei.produtoId);
          if (prod?.tipo === 'MOTO') {
            const chassisValidos = ei.chassis.filter(c => c.chassi.trim());
            if (chassisValidos.length === 0) { setErro(`Informe ao menos um chassi para "${prod.nome}"`); setSaving(false); return; }
            await api.post('/estoque/entrada-avulsa', {
              produtoId: Number(ei.produtoId),
              lojaId:    Number(lojaId),
              tipo:      'MOTO',
              chassis:   chassisValidos.map(c => ({
                chassi: c.chassi.trim() || undefined,
                cor:    c.cor.trim()    || undefined,
                ano:    c.ano           ? Number(c.ano) : undefined,
                custo:  c.custo         ? Number(c.custo.replace(',', '.')) : undefined,
              })),
              observacao: observacao || undefined,
            });
            totalChassis += chassisValidos.length;
          } else {
            await api.post('/estoque/entrada-avulsa', {
              produtoId:  Number(ei.produtoId),
              lojaId:     Number(lojaId),
              tipo:       'PECA',
              quantidade: Number(ei.quantidade),
              observacao: observacao || undefined,
            });
            totalPecas++;
          }
        }

        const partes: string[] = [];
        if (totalChassis > 0) partes.push(`${totalChassis} chassi(s)`);
        if (totalPecas   > 0) partes.push(`${totalPecas} peça(s)`);
        setSucesso(`✓ Entrada registrada: ${partes.join(' + ')}`);

      } else if (isSaida) {
        const itensValidos = saidaItems.filter(si => si.produtoId);
        if (itensValidos.length === 0) { setErro('Adicione pelo menos um item'); setSaving(false); return; }
        for (const si of itensValidos) {
          const prod = produtos.find(p => String(p.id) === si.produtoId);
          if (prod?.tipo === 'MOTO' && !si.chassiSel.trim()) {
            setErro(`Selecione o chassi da moto "${prod.nome}"`); setSaving(false); return;
          }
        }
        let count = 0;
        for (const si of itensValidos) {
          const prod = produtos.find(p => String(p.id) === si.produtoId);
          await api.post('/estoque/saida-avulsa', {
            produtoId:  Number(si.produtoId),
            lojaId:     Number(lojaId),
            tipo:       prod?.tipo,
            quantidade: prod?.tipo === 'MOTO' ? 1 : Number(si.quantidade),
            chassi:     prod?.tipo === 'MOTO' ? si.chassiSel.trim() : undefined,
            motivo:     motivoFinal,
            observacao: observacao || undefined,
          });
          count++;
        }
        setSucesso(`✓ ${count} item(ns) de saída registrado(s)`);

      } else {
        if (!adjProdutoId) { setErro('Selecione o produto'); setSaving(false); return; }
        if (adjProdutoSel?.tipo === 'MOTO' && !adjChassiSel.trim()) { setErro('Informe o chassi'); setSaving(false); return; }
        await api.post('/estoque/saida-avulsa', {
          produtoId:  Number(adjProdutoId),
          lojaId:     Number(lojaId),
          tipo:       adjProdutoSel?.tipo,
          quantidade: adjProdutoSel?.tipo === 'MOTO' ? 1 : Number(adjQtd),
          chassi:     adjProdutoSel?.tipo === 'MOTO' ? adjChassiSel.trim() : undefined,
          motivo:     `[AJUSTE] ${motivoFinal}`,
          observacao: observacao || undefined,
        });
        setSucesso('✓ Ajuste registrado no histórico');
      }

      reset();
    } catch (e: any) {
      setErro(e?.message || 'Erro ao registrar movimentação');
    } finally {
      setSaving(false);
    }
  }

  const motivosOpts = isAjuste ? MOTIVOS_AJUSTE : MOTIVOS_SAIDA;
  const opConf      = OP_CONFIG[operacao];

  const canSubmit = lojaId && (
    isEntrada ? entradaItems.some(ei => ei.produtoId) :
    isSaida   ? saidaItems.some(si => si.produtoId)   :
    !!adjProdutoId
  );

  return (
    <div className="max-w-2xl space-y-5">

      {/* ── Tipo de operação ─────────────────────────────── */}
      <div>
        <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium mb-2">Tipo de Movimentação</p>
        <div className="flex flex-wrap gap-2 bg-zinc-800/50 border border-zinc-700 rounded-xl p-1.5 w-fit">
          {(Object.entries(OP_CONFIG) as [Operacao, typeof OP_CONFIG[Operacao]][]).map(([op, conf]) => (
            <button
              key={op}
              onClick={() => { setOperacao(op); setMotivo(''); setErro(''); setSucesso(''); }}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors border ${
                operacao === op ? conf.activeCls : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {conf.icon} {conf.label}
            </button>
          ))}
        </div>
        {isAjuste && (
          <p className="text-xs text-yellow-600 mt-2 px-1">
            ⚙️ Ajuste manual — registra no histórico sem gerar movimentação financeira.
          </p>
        )}
      </div>

      {/* ── Loja ─────────────────────────────────────────── */}
      {(isEntrada || isSaida) && (
        <div className="bg-zinc-800/30 border border-zinc-700 rounded-xl p-4">
          <p className="text-xs text-zinc-400 uppercase tracking-wider font-medium mb-3">1 — Loja / Estoque</p>
          <select value={lojaId} onChange={e => setLojaId(e.target.value)} className={sel}>
            <option value="">Selecione a loja...</option>
            {lojas.map(l => <option key={l.id} value={l.id}>[{l.id}] {l.nomeFantasia}</option>)}
          </select>
        </div>
      )}

      {/* ── Loja + Produto (AJUSTE) ───────────────────────── */}
      {isAjuste && (
        <div className="bg-zinc-800/30 border border-zinc-700 rounded-xl p-4 space-y-3">
          <p className="text-xs text-zinc-400 uppercase tracking-wider font-medium">1 — Selecionar Loja e Produto</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Loja / Estoque *</label>
              <select value={lojaId} onChange={e => setLojaId(e.target.value)} className={sel}>
                <option value="">Selecione...</option>
                {lojas.map(l => <option key={l.id} value={l.id}>[{l.id}] {l.nomeFantasia}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Produto / Modelo *</label>
              <select value={adjProdutoId} onChange={e => setAdjProdutoId(e.target.value)} className={sel}>
                <option value="">Selecione...</option>
                {produtos.map(p => <option key={p.id} value={p.id}>{p.nome} ({p.tipo})</option>)}
              </select>
            </div>
          </div>
          {adjProdutoSel && (
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${adjProdutoSel.tipo === 'MOTO' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'}`}>
                {adjProdutoSel.tipo === 'MOTO' ? '🏍 MOTO' : '🔩 PEÇA'}
              </span>
              <span className="text-sm text-white">{adjProdutoSel.nome}</span>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ */}
      {/* ── ENTRADA MULTI-ITEM ────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════ */}
      {isEntrada && (
        <div className="bg-zinc-800/30 border border-zinc-700 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-zinc-400 uppercase tracking-wider font-medium">2 — Itens de Entrada</p>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={baixarModeloEntrada} className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 px-2 py-1 rounded-lg flex items-center gap-1 transition-colors">
                ⬇ Modelo .xlsx
              </button>
              <button onClick={() => fileEntradaRef.current?.click()} className="text-xs text-blue-400 hover:text-blue-300 border border-blue-500/40 hover:border-blue-400 px-2 py-1 rounded-lg flex items-center gap-1 transition-colors">
                📥 Importar planilha
              </button>
              <input ref={fileEntradaRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={importarPlanilhaEntrada} />
              <button onClick={addEntradaItem} className="text-xs text-green-400 hover:text-green-300 border border-green-500/30 hover:border-green-400 px-2.5 py-1 rounded-lg transition-colors">
                + Item
              </button>
            </div>
          </div>

          {importErroEntrada && (
            <p className={`text-xs px-3 py-2 rounded-lg ${importErroEntrada.startsWith('⚠️') ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/10 text-red-400'}`}>{importErroEntrada}</p>
          )}

          <div className="space-y-4">
            {entradaItems.map((ei, idx) => {
              const prod = produtos.find(p => String(p.id) === ei.produtoId);
              const isMoto = prod?.tipo === 'MOTO';
              return (
                <div key={ei.id} className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 space-y-3">
                  {/* Cabeçalho do item */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500 font-medium">Item {idx + 1}</span>
                    {entradaItems.length > 1 && (
                      <button onClick={() => removeEntradaItem(ei.id)} className="text-red-400 hover:text-red-300 text-xs">✕ Remover</button>
                    )}
                  </div>

                  {/* Produto */}
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Produto / Modelo *</label>
                    <select
                      value={ei.produtoId}
                      onChange={e => updateEntradaItem(ei.id, 'produtoId', e.target.value)}
                      className={sel}
                    >
                      <option value="">Selecione...</option>
                      {produtos.map(p => <option key={p.id} value={p.id}>{p.nome} ({p.tipo})</option>)}
                    </select>
                  </div>

                  {/* Badge tipo */}
                  {prod && (
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${isMoto ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'}`}>
                        {isMoto ? '🏍 MOTO' : '🔩 PEÇA'}
                      </span>
                      <span className="text-xs text-zinc-300">{prod.nome}</span>
                    </div>
                  )}

                  {/* MOTO: grade de chassis */}
                  {isMoto && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-zinc-400">Chassis a cadastrar</label>
                        <button
                          onClick={() => addEntradaChassi(ei.id)}
                          className="text-xs text-green-400 hover:text-green-300 px-2 py-0.5 rounded transition-colors"
                        >
                          + Chassi
                        </button>
                      </div>
                      {ei.chassis.map((row, i) => (
                        <div key={i} className="bg-zinc-800 border border-zinc-700 rounded-lg p-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 relative">
                          <div>
                            <label className="text-xs text-zinc-500 mb-0.5 block">Chassi *</label>
                            <input value={row.chassi} onChange={e => updateEntradaChassi(ei.id, i, 'chassi', e.target.value)} className={inp} placeholder="9C2JKD..." />
                          </div>
                          <div>
                            <label className="text-xs text-zinc-500 mb-0.5 block">Cor</label>
                            <input value={row.cor} onChange={e => updateEntradaChassi(ei.id, i, 'cor', e.target.value)} className={inp} placeholder="Preto" />
                          </div>
                          <div>
                            <label className="text-xs text-zinc-500 mb-0.5 block">Ano</label>
                            <input type="number" value={row.ano} onChange={e => updateEntradaChassi(ei.id, i, 'ano', e.target.value)} className={inp} />
                          </div>
                          <div>
                            <label className="text-xs text-zinc-500 mb-0.5 block">Custo (R$)</label>
                            <input value={row.custo} onChange={e => updateEntradaChassi(ei.id, i, 'custo', e.target.value)} className={inp} placeholder="0,00" />
                          </div>
                          {ei.chassis.length > 1 && (
                            <button onClick={() => removeEntradaChassi(ei.id, i)} className="absolute top-1.5 right-2 text-red-400 hover:text-red-300 text-xs">✕</button>
                          )}
                        </div>
                      ))}
                      <p className="text-xs text-zinc-600">{ei.chassis.filter(c => c.chassi.trim()).length} chassi(s) preenchido(s)</p>
                    </div>
                  )}

                  {/* PEÇA: quantidade */}
                  {!isMoto && prod && (
                    <div className="w-32">
                      <label className="block text-xs font-medium text-zinc-400 mb-1">Quantidade *</label>
                      <input
                        type="number" min="1"
                        value={ei.quantidade}
                        onChange={e => updateEntradaItem(ei.id, 'quantidade', e.target.value)}
                        className={inp}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-zinc-600">{entradaItems.filter(ei => ei.produtoId).length} item(ns) preenchido(s)</p>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ */}
      {/* ── SAÍDA MULTI-ITEM ──────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════ */}
      {isSaida && (
        <div className="bg-zinc-800/30 border border-zinc-700 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-zinc-400 uppercase tracking-wider font-medium">2 — Itens de Saída</p>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={baixarModeloSaida} className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 px-2 py-1 rounded-lg flex items-center gap-1 transition-colors">
                ⬇ Modelo .xlsx
              </button>
              <button onClick={() => fileSaidaRef.current?.click()} className="text-xs text-blue-400 hover:text-blue-300 border border-blue-500/40 hover:border-blue-400 px-2 py-1 rounded-lg flex items-center gap-1 transition-colors">
                📥 Importar planilha
              </button>
              <input ref={fileSaidaRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={importarPlanilhaSaida} />
              <button onClick={addSaidaItem} className="text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-400 px-2.5 py-1 rounded-lg transition-colors">
                + Item
              </button>
            </div>
          </div>

          {importErroSaida && (
            <p className={`text-xs px-3 py-2 rounded-lg ${importErroSaida.startsWith('⚠️') ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/10 text-red-400'}`}>{importErroSaida}</p>
          )}

          <div className="space-y-3">
            {saidaItems.map((si, idx) => {
              const prod  = produtos.find(p => String(p.id) === si.produtoId);
              const isMoto = prod?.tipo === 'MOTO';
              return (
                <div key={si.id} className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500 font-medium">Item {idx + 1}</span>
                    {saidaItems.length > 1 && (
                      <button onClick={() => removeSaidaItem(si.id)} className="text-red-400 hover:text-red-300 text-xs">✕ Remover</button>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Produto / Modelo *</label>
                    <select value={si.produtoId} onChange={e => updateSaidaItem(si.id, 'produtoId', e.target.value)} className={sel}>
                      <option value="">Selecione...</option>
                      {produtos.map(p => <option key={p.id} value={p.id}>{p.nome} ({p.tipo})</option>)}
                    </select>
                  </div>

                  {prod && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${isMoto ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'}`}>
                        {isMoto ? '🏍 MOTO' : '🔩 PEÇA'}
                      </span>
                      <span className="text-xs text-zinc-300">{prod.nome}</span>
                    </div>
                  )}

                  {isMoto && si.produtoId && (
                    <div>
                      <label className="block text-xs font-medium text-zinc-400 mb-1">Chassi da moto a retirar *</label>
                      {si.chassis.length > 0 ? (
                        <select value={si.chassiSel} onChange={e => updateSaidaItem(si.id, 'chassiSel', e.target.value)} className={sel}>
                          <option value="">Selecionar chassi disponível...</option>
                          {si.chassis.map(u => (
                            <option key={u.id} value={u.chassi!}>
                              {u.chassi}{u.cor ? ` · ${u.cor}` : ''}{u.ano ? ` (${u.ano})` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={si.chassiSel}
                          onChange={e => updateSaidaItem(si.id, 'chassiSel', e.target.value)}
                          className={inp}
                          placeholder="Informe o chassi..."
                        />
                      )}
                      {si.chassis.length === 0 && lojaId && si.produtoId && (
                        <p className="text-xs text-yellow-600 mt-1">⚠ Nenhuma moto deste modelo em estoque nesta loja</p>
                      )}
                    </div>
                  )}

                  {!isMoto && prod && (
                    <div className="w-32">
                      <label className="block text-xs font-medium text-zinc-400 mb-1">Quantidade *</label>
                      <input
                        type="number" min="1"
                        value={si.quantidade}
                        onChange={e => updateSaidaItem(si.id, 'quantidade', e.target.value)}
                        className={inp}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-zinc-600">{saidaItems.filter(si => si.produtoId).length} item(ns) preenchido(s)</p>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ */}
      {/* ── AJUSTE ───────────────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════ */}
      {isAjuste && adjProdutoSel && (
        <div className="bg-zinc-800/30 border border-zinc-700 rounded-xl p-4 space-y-4">
          <p className="text-xs text-zinc-400 uppercase tracking-wider font-medium">2 — Dados do Ajuste</p>

          {adjProdutoSel.tipo === 'MOTO' && (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Chassi a ajustar *</label>
              {adjChassis.length > 0 ? (
                <select value={adjChassiSel} onChange={e => setAdjChassiSel(e.target.value)} className={sel}>
                  <option value="">Selecionar chassi disponível...</option>
                  {adjChassis.map(u => (
                    <option key={u.id} value={u.chassi!}>
                      {u.chassi}{u.cor ? ` · ${u.cor}` : ''}{u.ano ? ` (${u.ano})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={adjChassiSel} onChange={e => setAdjChassiSel(e.target.value)} className={inp} placeholder="Informe o chassi..." />
              )}
              {adjChassis.length === 0 && lojaId && adjProdutoId && (
                <p className="text-xs text-yellow-600 mt-1">⚠ Nenhuma moto deste modelo em estoque nesta loja</p>
              )}
            </div>
          )}

          {adjProdutoSel.tipo !== 'MOTO' && (
            <div className="w-32">
              <label className="block text-xs font-medium text-zinc-400 mb-1">Quantidade *</label>
              <input type="number" min="1" value={adjQtd} onChange={e => setAdjQtd(e.target.value)} className={inp} />
            </div>
          )}
        </div>
      )}

      {/* ── Motivo + Observação ──────────────────────────── */}
      {(isSaida || isAjuste) && (
        <div className="bg-zinc-800/30 border border-zinc-700 rounded-xl p-4 space-y-3">
          <p className="text-xs text-zinc-400 uppercase tracking-wider font-medium">
            3 — Motivo {isAjuste ? 'do Ajuste' : 'da Saída'} e Observação
          </p>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Motivo *</label>
            <select value={motivo} onChange={e => setMotivo(e.target.value)} className={sel}>
              <option value="">Selecione o motivo...</option>
              {motivosOpts.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {motivo === 'Outro' && (
              <input
                value={motivoCustom}
                onChange={e => setMotivoCustom(e.target.value)}
                className={inp + ' mt-2'}
                placeholder="Descreva o motivo..."
              />
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Observações para auditoria</label>
            <textarea
              value={observacao}
              onChange={e => setObservacao(e.target.value)}
              rows={2}
              className={inp + ' resize-none'}
              placeholder="Informações adicionais — aparecerão no histórico..."
            />
          </div>
        </div>
      )}

      {isEntrada && (
        <div className="bg-zinc-800/30 border border-zinc-700 rounded-xl p-4 space-y-3">
          <p className="text-xs text-zinc-400 uppercase tracking-wider font-medium">3 — Observação</p>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Observações para auditoria</label>
            <textarea
              value={observacao}
              onChange={e => setObservacao(e.target.value)}
              rows={2}
              className={inp + ' resize-none'}
              placeholder="Informações adicionais — aparecerão no histórico..."
            />
          </div>
        </div>
      )}

      {/* ── Mensagens + Botão ────────────────────────────── */}
      {erro    && <p className="text-red-400   text-sm bg-red-500/10   border border-red-500/30   rounded-xl px-4 py-3">{erro}</p>}
      {sucesso && <p className="text-green-400 text-sm bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3">{sucesso}</p>}

      <button
        onClick={handleSubmit}
        disabled={!canSubmit || saving}
        className={`px-6 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${opConf.btnCls}`}
      >
        {saving ? 'Registrando...' : `${opConf.icon} Registrar ${opConf.label}`}
      </button>
    </div>
  );
}
