import { useEffect, useState, useMemo, useRef, Fragment } from 'react';
import ExcelJS from 'exceljs';
import { useAuth } from '../contexts/AuthContext';
import { useLojaContext } from '../contexts/LojaContext';
import { api } from '../services/api';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { SectionHeader } from '../components/ui/SectionHeader';
import { TabEstoqueGeral } from './estoque/TabEstoqueGeral';
import { TabMovEstoque }   from './estoque/TabMovEstoque';
import { TabMovAvulsa }    from './estoque/TabMovAvulsa';
import { TabHistorico }    from './estoque/TabHistorico';

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

// ─── ModalCadastroChassi ───────────────────────────────────────────────────────

interface ProdutoMoto { id: number; nome: string; codigo: string; }
interface FornecedorBasico { id: number; razaoSocial: string; nomeFantasia?: string | null; }

interface ChassiRow { chassi: string; cor: string; codigoMotor: string; ano: string; }

const emptyRow = (): ChassiRow => ({ chassi: '', cor: '', codigoMotor: '', ano: String(new Date().getFullYear()) });

function ModalCadastroChassi({
  lojaId, lojas, isAdmin, onClose, onSucesso
}: {
  lojaId: number; lojas: Loja[]; isAdmin: boolean;
  onClose: () => void; onSucesso: () => void;
}) {
  const [produtos, setProdutos] = useState<ProdutoMoto[]>([]);
  const [fornecedores, setFornecedores] = useState<FornecedorBasico[]>([]);
  const [produtoId, setProdutoId] = useState('');
  const [lojaIdSel, setLojaIdSel] = useState(String(lojaId));
  const [custo, setCusto] = useState('');
  const [fornecedorId, setFornecedorId] = useState('');
  const [notaFiscalEntrada, setNotaFiscalEntrada] = useState('');
  const [modo, setModo] = useState<'unitario' | 'lote'>('unitario');
  const [rows, setRows] = useState<ChassiRow[]>([emptyRow()]);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState<{ criados: number; erros: number; detalhesErros: string[] } | null>(null);
  const [importErro, setImportErro] = useState('');
  const fileImportRef = useRef<HTMLInputElement>(null);
  const [slots, setSlots] = useState<{ estoqueQtd: number; chassisCadastrados: number; slotsDisponiveis: number } | null>(null);
  const [multiModeloGrupos, setMultiModeloGrupos] = useState<{ produto: ProdutoMoto; rows: ChassiRow[] }[] | null>(null);
  const [multiModeloErros, setMultiModeloErros] = useState<string[]>([]);

  const inp = 'w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 placeholder-zinc-500';
  const lbl = 'block text-xs text-zinc-400 mb-1';

  async function baixarModeloChassi() {
    const nomeProduto = produtos.find(p => String(p.id) === produtoId)?.nome || 'Produto';
    const anoAtual = new Date().getFullYear();
    const sheetData = [
      ['Chassi', 'Modelo', 'Cor', 'Cód. Motor', 'Ano'],
      ['(obrigatório)', nomeProduto, '(opcional)', '(opcional)', '(opcional)'],
      ['9C2HAXXXXXXXXXXXXX', nomeProduto, 'Preto', 'MOT001', anoAtual],
      ['9C2HAXXXXXXXXXXXXY', nomeProduto, 'Branco', 'MOT002', anoAtual],
      ['9C2HAXXXXXXXXXXXXXZ', nomeProduto, 'Azul', 'MOT003', anoAtual],
    ];
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Chassis');
    sheet.columns = [{ width: 24 }, { width: 30 }, { width: 12 }, { width: 14 }, { width: 8 }];
    sheetData.forEach(row => sheet.addRow(row));
    const buf = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'modelo_cadastro_chassis.xlsx';
    a.click(); URL.revokeObjectURL(url);
  }

  function importarPlanilha(e: React.ChangeEvent<HTMLInputElement>) {
    setImportErro('');
    setMultiModeloGrupos(null);
    setMultiModeloErros([]);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(ev.target!.result as ArrayBuffer);
        const ws = workbook.worksheets[0];
        const raw: any[][] = [];
        ws.eachRow({ includeEmpty: false }, (row) => {
          raw.push((row.values as any[]).slice(1).map((v: any) => {
            if (v === null || v === undefined) return '';
            if (typeof v === 'object' && v.text) return v.text;
            if (typeof v === 'object' && v.result !== undefined) return v.result;
            return v;
          }));
        });
        if (raw.length < 2) { setImportErro('Planilha vazia ou sem dados.'); return; }

        // Detecta índices pelas colunas do cabeçalho
        const header = raw[0].map((h: any) => String(h).toLowerCase().trim());
        const col = (terms: string[]) => header.findIndex((h: string) => terms.some(t => h.includes(t)));
        const iChassi  = col(['chassi', 'chassis', 'chasi']);
        const iCor     = col(['cor', 'color', 'colour']);
        const iMotor   = col(['motor', 'cód', 'cod', 'codigo', 'engine']);
        const iAno     = col(['ano', 'year', 'anio']);
        const iModelo  = col(['modelo', 'model', 'produto', 'product']);

        if (iChassi === -1) { setImportErro('Coluna "Chassi" não encontrada na planilha.'); return; }

        const anoDefault = String(new Date().getFullYear());
        const todasRows = raw.slice(1)
          .filter((row: any[]) => String(row[iChassi] ?? '').trim())
          .map((row: any[]) => ({
            chassi:       String(row[iChassi] ?? '').trim(),
            cor:          iCor   >= 0 ? String(row[iCor]   ?? '').trim() : '',
            codigoMotor:  iMotor >= 0 ? String(row[iMotor] ?? '').trim() : '',
            ano:          iAno   >= 0 && row[iAno] ? String(Math.round(Number(row[iAno]))) : anoDefault,
            modeloNome:   iModelo >= 0 ? String(row[iModelo] ?? '').trim() : '',
          }));

        if (todasRows.length === 0) { setImportErro('Nenhuma linha com chassi encontrada.'); return; }

        // ── Modo MULTI-MODELO: planilha tem coluna Modelo e nenhum produto selecionado ──
        const temColunaModelo = iModelo >= 0 && todasRows.some(r => r.modeloNome);
        if (temColunaModelo && !produtoId) {
          const errosModelo: string[] = [];
          const mapaGrupos: Record<string, { produto: ProdutoMoto; rows: ChassiRow[] }> = {};

          for (const row of todasRows) {
            const nomeModelo = row.modeloNome;
            if (!nomeModelo) { errosModelo.push(`Chassi ${row.chassi}: sem modelo definido — ignorado`); continue; }

            if (!mapaGrupos[nomeModelo]) {
              const produtoEncontrado = produtos.find(p =>
                p.nome.toLowerCase().includes(nomeModelo.toLowerCase()) ||
                nomeModelo.toLowerCase().includes(p.nome.toLowerCase()) ||
                p.codigo.toLowerCase() === nomeModelo.toLowerCase()
              );
              if (!produtoEncontrado) {
                errosModelo.push(`Modelo "${nomeModelo}" não encontrado no sistema — chassis ignorados`);
                continue;
              }
              mapaGrupos[nomeModelo] = { produto: produtoEncontrado, rows: [] };
            }

            const { modeloNome: _m, ...rowSemModelo } = row;
            mapaGrupos[nomeModelo].rows.push(rowSemModelo as ChassiRow);
          }

          const grupos = Object.values(mapaGrupos);
          if (grupos.length === 0) { setImportErro('Nenhum modelo reconhecido na planilha.'); return; }

          // ── Validação de slots por modelo ──
          const errosSlots: string[] = [];
          for (const g of grupos) {
            try {
              const slotsData = await api.get<any>(`/unidades/slots?produtoId=${g.produto.id}&lojaId=${lojaIdSel}`);
              if (g.rows.length > slotsData.slotsDisponiveis) {
                const extra = g.rows.length - slotsData.slotsDisponiveis;
                errosSlots.push(
                  `Operação não carregada! O Item ${g.produto.nome} tem mais Chassi importados que slots. ${extra}(${g.rows.length} vs ${slotsData.slotsDisponiveis}) Chassi${extra !== 1 ? 's' : ''} a mais!`
                );
              }
            } catch { /* ignora erro de slots — valida no submit */ }
          }
          if (errosSlots.length > 0) {
            setImportErro(errosSlots.join('\n'));
            return;
          }

          setMultiModeloGrupos(grupos);
          setMultiModeloErros(errosModelo);
          return;
        }

        // ── Modo SINGLE: comportamento original ──
        const novasRows: ChassiRow[] = todasRows.map(({ modeloNome: _m, ...r }) => r as ChassiRow);

        // Respeita o limite de slots disponíveis
        if (slots !== null && novasRows.length > slots.slotsDisponiveis) {
          const cortadas = novasRows.slice(0, slots.slotsDisponiveis);
          setImportErro(
            `⚠️ Planilha tinha ${novasRows.length} chassis, mas só há ${slots.slotsDisponiveis} slot(s) disponível(is) no estoque. ` +
            `Foram importados apenas os primeiros ${slots.slotsDisponiveis}.`
          );
          setRows(cortadas.length > 0 ? cortadas : [emptyRow()]);
          return;
        }
        setRows(novasRows);
      } catch {
        setImportErro('Erro ao ler a planilha. Verifique o formato do arquivo.');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }

  useEffect(() => {
    api.get<any>('/produtos?tipo=MOTO&limit=200')
      .then(d => {
        const dataAny: any = d;
        const listaProdutos = Array.isArray(dataAny) ? dataAny : dataAny?.produtos ?? [];
        setProdutos(listaProdutos.filter((p: any) => p.tipo === 'MOTO'));
      })
      .catch(() => setProdutos([]));
    api.get<any>(`/fornecedores?lojaId=${lojaIdSel}&limit=200`)
      .then(d => {
        const raw: any = d;
        setFornecedores(Array.isArray(raw) ? raw : raw?.fornecedores ?? []);
      })
      .catch(() => setFornecedores([]));
  }, [lojaIdSel]);

  // Busca slots disponíveis ao selecionar produto + loja
  useEffect(() => {
    if (!produtoId || !lojaIdSel) { setSlots(null); return; }
    api.get<any>(`/unidades/slots?produtoId=${produtoId}&lojaId=${lojaIdSel}`)
      .then(d => setSlots(d as any))
      .catch(() => setSlots(null));
  }, [produtoId, lojaIdSel]);

  function updateRow(i: number, field: keyof ChassiRow, val: string) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // ── Modo MULTI-MODELO: submete um lote por grupo ──
    if (multiModeloGrupos !== null) {
      setSaving(true); setErro('');
      let totalCriados = 0, totalErros = 0, todosDetalhes: string[] = [];
      try {
        for (const grupo of multiModeloGrupos) {
          const itens = grupo.rows.filter(r => r.chassi.trim()).map(r => ({
            chassi: r.chassi.trim(),
            cor: r.cor.trim() || null,
            codigoMotor: r.codigoMotor.trim() || null,
            ano: Number(r.ano) || new Date().getFullYear(),
          }));
          if (itens.length === 0) continue;
          const res = await api.post<{ criados: number; erros: number; detalhesErros: string[] }>(
            '/unidades/manual/lote',
            {
              produtoId: grupo.produto.id,
              lojaId: Number(lojaIdSel),
              itens,
              fornecedorId: fornecedorId ? Number(fornecedorId) : null,
              notaFiscalEntrada: notaFiscalEntrada.trim() || null,
            }
          );
          totalCriados += res.criados;
          totalErros += res.erros;
          todosDetalhes.push(...(res.detalhesErros || []));
        }
        setResultado({ criados: totalCriados, erros: totalErros, detalhesErros: todosDetalhes });
      } catch (e: any) { setErro(e.message || 'Erro ao cadastrar'); }
      finally { setSaving(false); }
      return;
    }

    if (!produtoId) { setErro('Selecione um produto'); return; }

    // Valida contra slots disponíveis
    if (slots !== null) {
      if (slots.slotsDisponiveis === 0) {
        setErro(`Todos os ${slots.estoqueQtd} chassis já estão registrados para este produto nesta loja.`);
        return;
      }
      if (modo === 'lote') {
        const qtdValidas = rows.filter(r => r.chassi.trim()).length;
        if (qtdValidas > slots.slotsDisponiveis) {
          setErro(`Você tentou cadastrar ${qtdValidas} chassis, mas só há ${slots.slotsDisponiveis} vaga(s) disponível(is) no estoque (${slots.estoqueQtd} no estoque − ${slots.chassisCadastrados} já cadastrados).`);
          return;
        }
      }
    }

    setSaving(true); setErro('');
    try {
      if (modo === 'unitario') {
        const row = rows[0];
        if (!row.chassi.trim()) { setErro('Chassi obrigatório'); setSaving(false); return; }
        await api.post('/unidades/manual', {
          produtoId: Number(produtoId),
          lojaId: Number(lojaIdSel),
          chassi: row.chassi.trim(),
          cor: row.cor.trim() || null,
          codigoMotor: row.codigoMotor.trim() || null,
          ano: Number(row.ano) || new Date().getFullYear(),
          custo: custo ? Number(custo.replace(',', '.')) : undefined,
          fornecedorId: fornecedorId ? Number(fornecedorId) : null,
          notaFiscalEntrada: notaFiscalEntrada.trim() || null,
        });
        setResultado({ criados: 1, erros: 0, detalhesErros: [] });
      } else {
        const itens = rows.filter(r => r.chassi.trim()).map(r => ({
          chassi: r.chassi.trim(),
          cor: r.cor.trim() || null,
          codigoMotor: r.codigoMotor.trim() || null,
          ano: Number(r.ano) || new Date().getFullYear(),
        }));
        if (itens.length === 0) { setErro('Adicione pelo menos um chassi'); setSaving(false); return; }
        const res = await api.post<{ criados: number; erros: number; detalhesErros: string[] }>(
          '/unidades/manual/lote',
          {
            produtoId: Number(produtoId),
            lojaId: Number(lojaIdSel),
            itens,
            fornecedorId: fornecedorId ? Number(fornecedorId) : null,
            notaFiscalEntrada: notaFiscalEntrada.trim() || null,
          }
        );
        setResultado(res);
      }
    } catch (e: any) { setErro(e.message || 'Erro ao cadastrar'); }
    finally { setSaving(false); }
  }

  if (resultado) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
          <div className="text-center">
            <p className="text-4xl mb-3">{resultado.erros === 0 ? '✅' : '⚠️'}</p>
            <h3 className="text-lg font-bold text-white mb-2">
              {resultado.criados} chassi(s) cadastrado(s)
              {resultado.erros > 0 && ` · ${resultado.erros} erro(s)`}
            </h3>
            {resultado.detalhesErros.length > 0 && (
              <ul className="text-xs text-red-400 mt-2 text-left space-y-1">
                {resultado.detalhesErros.map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            )}
            <div className="flex gap-3 mt-5 justify-center">
              <button onClick={onSucesso} className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2 rounded-lg text-sm font-medium">
                Concluir
              </button>
              {resultado.erros > 0 && (
                <button onClick={() => setResultado(null)} className="bg-zinc-700 hover:bg-zinc-600 text-white px-4 py-2 rounded-lg text-sm">
                  Cadastrar mais
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="text-lg font-bold text-white">🏍️ Cadastrar Chassi</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Modo */}
          <div className="flex gap-2">
            {(['unitario', 'lote'] as const).map(m => (
              <button key={m} type="button" onClick={() => { setModo(m); setRows([emptyRow()]); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${modo === m ? 'bg-orange-500 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}>
                {m === 'unitario' ? '1️⃣ Unitário' : '📋 Lote (vários)'}
              </button>
            ))}
          </div>

          {/* Produto + Loja */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className={lbl}>Modelo / Produto *</label>
              <select value={produtoId} onChange={e => setProdutoId(e.target.value)} required className={inp}>
                <option value="">Selecione o modelo...</option>
                {produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
            {isAdmin && (
              <div className="sm:col-span-2">
                <label className={lbl}>Loja *</label>
                <select value={lojaIdSel} onChange={e => setLojaIdSel(e.target.value)} className={inp}>
                  {lojas.map(l => <option key={l.id} value={l.id}>{l.nomeFantasia}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Indicador de slots */}
          {slots !== null && produtoId && (
            <div className={`rounded-lg px-4 py-3 flex items-center gap-3 text-sm border ${
              slots.slotsDisponiveis === 0
                ? 'bg-red-500/10 border-red-500/30 text-red-300'
                : slots.slotsDisponiveis <= 3
                ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300'
                : 'bg-green-500/10 border-green-500/30 text-green-300'
            }`}>
              <span className="text-xl">
                {slots.slotsDisponiveis === 0 ? '🔴' : slots.slotsDisponiveis <= 3 ? '🟡' : '🟢'}
              </span>
              <div className="flex-1">
                <p className="font-medium">
                  {slots.slotsDisponiveis === 0
                    ? 'Nenhum slot disponível'
                    : `${slots.slotsDisponiveis} slot(s) disponível(is)`}
                </p>
                <p className="text-xs opacity-70 mt-0.5">
                  {slots.estoqueQtd} no estoque · {slots.chassisCadastrados} chassi(s) já cadastrado(s)
                </p>
              </div>
            </div>
          )}

          {/* Origem / Fornecedor */}
          <div className="border border-zinc-800 rounded-lg p-4 space-y-3">
            <p className="text-xs text-zinc-400 uppercase tracking-wide font-medium">📦 Origem do Produto</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className={lbl}>Fornecedor</label>
                <select value={fornecedorId} onChange={e => setFornecedorId(e.target.value)} className={inp}>
                  <option value="">Selecione o fornecedor...</option>
                  {fornecedores.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.nomeFantasia ? `${f.nomeFantasia} (${f.razaoSocial})` : f.razaoSocial}
                    </option>
                  ))}
                </select>
                {fornecedores.length === 0 && (
                  <p className="text-xs text-zinc-500 mt-1">Nenhum fornecedor cadastrado nesta loja</p>
                )}
              </div>
              <div>
                <label className={lbl}>Nota Fiscal de Entrada</label>
                <input value={notaFiscalEntrada} onChange={e => setNotaFiscalEntrada(e.target.value)}
                  placeholder="Ex: NF-e 001234" className={inp} />
              </div>
              {modo === 'unitario' && (
                <div>
                  <label className={lbl}>Custo de Aquisição (R$)</label>
                  <input value={custo} onChange={e => setCusto(e.target.value)} placeholder="0,00" className={inp} />
                </div>
              )}
            </div>
          </div>

          {/* Linhas de chassi */}
          <div className="border-t border-zinc-800 pt-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <p className="text-xs text-zinc-400 uppercase tracking-wide">
                {modo === 'unitario' ? 'Dados do Chassi' : `${rows.length} chassi(s)`}
              </p>
              {modo === 'lote' && (
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Baixar modelo */}
                  <button type="button" onClick={baixarModeloChassi}
                    className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 px-2 py-1 rounded-lg flex items-center gap-1 transition-colors">
                    ⬇ Modelo .xlsx
                  </button>
                  {/* Importar planilha */}
                  <button type="button" onClick={() => fileImportRef.current?.click()}
                    className="text-xs text-blue-400 hover:text-blue-300 border border-blue-500/40 hover:border-blue-400 px-2 py-1 rounded-lg flex items-center gap-1 transition-colors">
                    📥 Importar planilha
                  </button>
                  <input ref={fileImportRef} type="file" accept=".xlsx,.xls,.csv"
                    className="hidden" onChange={importarPlanilha} />
                  {/* Adicionar linha manual */}
                  <button type="button"
                    onClick={() => setRows(p => [...p, emptyRow()])}
                    disabled={slots !== null && rows.length >= slots.slotsDisponiveis}
                    className="text-xs text-orange-400 hover:text-orange-300 font-medium disabled:opacity-30 disabled:cursor-not-allowed">
                    + Linha
                  </button>
                </div>
              )}
            </div>
            {importErro && (
              <p className="text-xs text-red-400 mb-2 bg-red-500/10 px-3 py-2 rounded-lg">{importErro}</p>
            )}

            {/* ── Preview Multi-Modelo ── */}
            {multiModeloGrupos !== null ? (
              <div className="border border-blue-500/30 bg-blue-500/5 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-blue-300">📋 Importação Multi-Modelo detectada</p>
                  <button type="button" onClick={() => { setMultiModeloGrupos(null); setMultiModeloErros([]); }}
                    className="text-xs text-zinc-400 hover:text-white transition-colors">✕ Limpar</button>
                </div>
                {multiModeloErros.length > 0 && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                    <p className="text-xs text-yellow-300 font-medium mb-1">⚠️ Modelos não reconhecidos na planilha:</p>
                    <ul className="text-xs text-yellow-300 space-y-0.5">
                      {multiModeloErros.map((e, i) => <li key={i}>• {e}</li>)}
                    </ul>
                  </div>
                )}
                <div className="space-y-2">
                  {multiModeloGrupos.map((g, i) => (
                    <div key={i} className="flex items-center justify-between bg-zinc-800 rounded-lg px-3 py-2">
                      <span className="text-sm text-white">{g.produto.nome}</span>
                      <span className="text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded-full">
                        {g.rows.length} chassi(s)
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-zinc-500">
                  Total: {multiModeloGrupos.reduce((acc, g) => acc + g.rows.length, 0)} chassis em {multiModeloGrupos.length} modelo(s)
                </p>
              </div>
            ) : (
              <>
            {modo === 'lote' && rows.length > 1 && (
              <p className="text-xs text-zinc-500 mb-2">
                {rows.filter(r => r.chassi.trim()).length} chassi(s) com dados preenchidos
              </p>
            )}

            <div className="space-y-3">
              {rows.map((row, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-start">
                  <div className="col-span-2">
                    <label className={lbl}>Chassi {modo === 'unitario' ? '*' : ''}</label>
                    <input value={row.chassi} onChange={e => updateRow(i, 'chassi', e.target.value)}
                      placeholder="9C2HBxxxxx..." className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Cor</label>
                    <input value={row.cor} onChange={e => updateRow(i, 'cor', e.target.value)}
                      placeholder="Preto" className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Ano</label>
                    <input value={row.ano} onChange={e => updateRow(i, 'ano', e.target.value)}
                      type="number" min="2000" max="2030" className={inp} />
                  </div>
                  <div className="col-span-2 sm:col-span-3">
                    <label className={lbl}>Cód. Motor</label>
                    <input value={row.codigoMotor} onChange={e => updateRow(i, 'codigoMotor', e.target.value)}
                      placeholder="Código do motor" className={inp} />
                  </div>
                  {modo === 'lote' && rows.length > 1 && (
                    <div className="flex items-end pb-0.5">
                      <button type="button" onClick={() => setRows(p => p.filter((_, idx) => idx !== i))}
                        className="w-full py-2 text-red-400 hover:text-red-300 bg-red-500/10 rounded-lg text-xs">
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
              </>
            )}
          </div>

          {erro && <p className="text-red-400 text-sm">{erro}</p>}

          <div className="flex gap-2 justify-end pt-2 border-t border-zinc-800">
            <button type="button" onClick={onClose} className="bg-zinc-700 hover:bg-zinc-600 text-white px-4 py-2 rounded-lg text-sm">
              Cancelar
            </button>
            <button type="submit"
              disabled={saving || (multiModeloGrupos === null && slots !== null && slots.slotsDisponiveis === 0)}
              className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium">
              {saving
                ? 'Salvando...'
                : multiModeloGrupos !== null
                  ? `Cadastrar ${multiModeloGrupos.reduce((a, g) => a + g.rows.length, 0)} Chassi(s) em ${multiModeloGrupos.length} Modelo(s)`
                  : modo === 'unitario'
                    ? 'Cadastrar Chassi'
                    : `Cadastrar ${rows.filter(r => r.chassi.trim()).length} Chassi(s)`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

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

function TabGerencial({ itens, busca, lojas, lojaId, minhaLojaId, onTransferido, onVerUnitaria, onRefresh }: {
  itens: ItemGerencial[];
  busca: string;
  lojas: Loja[];
  lojaId: number;
  minhaLojaId: number | null;
  onTransferido?: () => void;
  onVerUnitaria?: (nome: string) => void;
  onRefresh?: () => void;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedDestinoId, setExpandedDestinoId] = useState<number | ''>('');
  const [expandedQtd, setExpandedQtd] = useState(1);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [expandedErro, setExpandedErro] = useState('');
  const [expandedSucesso, setExpandedSucesso] = useState(false);

  // Edit/Delete state
  const [editandoItem, setEditandoItem] = useState<ItemGerencial | null>(null);
  const [editForm, setEditForm] = useState({ precoVenda: '', estoqueMinimo: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editErro, setEditErro] = useState('');
  const [deletandoEstoqueId, setDeletandoEstoqueId] = useState<number | null>(null);

  const { user: userTabG } = useAuth();
  const verCustos = ['ADMIN_GERAL', 'ADMIN_FINANCEIRO', 'ADMIN_REDE'].includes(userTabG?.role || '');
  const isAdmin = minhaLojaId === null;
  const podeTransferir = isAdmin || lojaId === minhaLojaId;
  const podeEditarEstoque = userTabG?.role === 'ADMIN_GERAL';

  function abrirEditarItem(it: ItemGerencial) {
    setEditandoItem(it);
    setEditForm({ precoVenda: String(it.precoVenda || ''), estoqueMinimo: String(it.estoqueMinimo || 0) });
    setEditErro('');
  }

  async function salvarEdicaoItem() {
    if (!editandoItem) return;
    setEditSaving(true); setEditErro('');
    try {
      await api.put(`/estoque/${editandoItem.id}`, {
        precoVenda: editForm.precoVenda ? Number(editForm.precoVenda) : null,
        estoqueMinimo: Number(editForm.estoqueMinimo || 0),
      });
      setEditandoItem(null);
      onRefresh?.();
    } catch (e: any) {
      setEditErro(e.message || 'Erro ao salvar');
    } finally {
      setEditSaving(false);
    }
  }

  async function removerDoEstoque(it: ItemGerencial) {
    const msg = it.quantidade > 0
      ? `Não é possível remover "${it.nome}" pois há ${it.quantidade} unidade(s) em estoque. Zere o estoque antes.`
      : `Remover "${it.nome}" do estoque desta loja?\nEsta ação não exclui o produto do catálogo, apenas remove o registro desta loja.`;
    if (!confirm(msg)) return;
    if (it.quantidade > 0) return;
    setDeletandoEstoqueId(it.id);
    try {
      await api.delete(`/estoque/${it.id}`);
      onRefresh?.();
    } catch (e: any) {
      alert(e.message || 'Erro ao remover do estoque');
    } finally {
      setDeletandoEstoqueId(null);
    }
  }
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
  const colSpan = verCustos ? 9 : 7;

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
                <th className="text-right p-3 font-medium">Ações</th>
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
                      <td className="p-3">
                        <div className="flex items-center gap-1 justify-end">
                          {podeEditarEstoque && (
                            <>
                              <button
                                onClick={() => abrirEditarItem(it)}
                                title="Editar preço e estoque mínimo"
                                className="text-xs px-2 py-1.5 rounded-lg font-medium border transition-colors bg-zinc-700/50 text-zinc-300 hover:bg-zinc-700 border-zinc-600"
                              >✏️</button>
                              <button
                                onClick={() => removerDoEstoque(it)}
                                disabled={deletandoEstoqueId === it.id}
                                title={it.quantidade > 0 ? 'Zere o estoque antes de remover' : 'Remover do estoque desta loja'}
                                className={`text-xs px-2 py-1.5 rounded-lg font-medium border transition-colors ${
                                  it.quantidade > 0
                                    ? 'opacity-30 cursor-not-allowed bg-zinc-800 text-zinc-500 border-zinc-700'
                                    : 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border-red-500/20'
                                } disabled:opacity-40`}
                              >{deletandoEstoqueId === it.id ? '...' : '🗑️'}</button>
                            </>
                          )}
                          {podeTransferir && (
                            it.tipo === 'MOTO' ? (
                              <button
                                onClick={() => onVerUnitaria?.(it.nome)}
                                disabled={it.quantidade === 0}
                                className={`text-xs px-2.5 py-1.5 rounded-lg font-medium border transition-colors whitespace-nowrap ${
                                  it.quantidade === 0
                                    ? 'opacity-30 cursor-not-allowed bg-zinc-800 text-zinc-500 border-zinc-700'
                                    : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border-blue-500/30'
                                }`}
                              >📋</button>
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
                            )
                          )}
                        </div>
                      </td>
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

      {/* ── Modal de edição de produto no estoque ── */}
      {editandoItem && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold text-lg">✏️ Editar Produto</h3>
              <button onClick={() => setEditandoItem(null)} className="text-zinc-400 hover:text-white text-xl leading-none">✕</button>
            </div>
            <p className="text-zinc-300 font-medium mb-1">{editandoItem.nome}</p>
            <p className="text-zinc-500 text-xs font-mono mb-4">{editandoItem.codigo}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Preço de Venda (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editForm.precoVenda}
                  onChange={e => setEditForm(f => ({ ...f, precoVenda: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                  placeholder="0,00"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Estoque Mínimo</label>
                <input
                  type="number"
                  min="0"
                  value={editForm.estoqueMinimo}
                  onChange={e => setEditForm(f => ({ ...f, estoqueMinimo: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>
            {editErro && <p className="text-red-400 text-sm mt-3">{editErro}</p>}
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setEditandoItem(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-zinc-600 text-zinc-300 text-sm hover:bg-zinc-800 transition-colors"
              >Cancelar</button>
              <button
                onClick={salvarEdicaoItem}
                disabled={editSaving}
                className="flex-1 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors disabled:opacity-50"
              >{editSaving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TabUnitaria ──────────────────────────────────────────────────────────────

function TabUnitaria({
  itens, busca, lojas, lojaId, minhaLojaId, onTransferido, onRefresh
}: {
  itens: ItemUnitario[];
  busca: string;
  lojas: Loja[];
  lojaId: number;
  minhaLojaId: number | null;
  onTransferido?: () => void;
  onRefresh?: () => void;
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

  // Edit/Delete state
  const [editandoUnidade, setEditandoUnidade] = useState<ItemUnitario | null>(null);
  const [editForm, setEditForm] = useState({ chassi: '', cor: '', codigoMotor: '', ano: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editErro, setEditErro] = useState('');
  const [deletandoId, setDeletandoId] = useState<number | null>(null);

  const { user: userTabU } = useAuth();
  const podeEditarExcluir = userTabU?.role === 'ADMIN_GERAL';

  function abrirEditar(u: ItemUnitario) {
    setEditandoUnidade(u);
    setEditForm({ chassi: u.chassi || '', cor: u.cor || '', codigoMotor: u.codigoMotor || '', ano: String(u.ano || '') });
    setEditErro('');
  }

  async function salvarEdicao() {
    if (!editandoUnidade) return;
    setEditSaving(true); setEditErro('');
    try {
      await api.put(`/unidades/${editandoUnidade.id}`, {
        chassi: editForm.chassi.trim(),
        cor: editForm.cor.trim(),
        codigoMotor: editForm.codigoMotor.trim(),
        ano: editForm.ano ? Number(editForm.ano) : undefined,
      });
      setEditandoUnidade(null);
      onRefresh?.();
    } catch (e: any) {
      setEditErro(e.message || 'Erro ao salvar');
    } finally {
      setEditSaving(false);
    }
  }

  async function excluirUnidade(id: number) {
    setDeletandoId(id);
    try {
      await api.delete(`/unidades/${id}`);
      onRefresh?.();
    } catch (e: any) {
      alert(e.message || 'Erro ao excluir chassi');
    } finally {
      setDeletandoId(null);
    }
  }

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
                  <td className="p-3">
                    <div className="flex items-center gap-1 justify-end">
                      {podeEditarExcluir && u.status === 'ESTOQUE' && (
                        <>
                          <button
                            onClick={() => abrirEditar(u)}
                            title="Editar chassi"
                            className="text-xs px-2 py-1.5 rounded-lg font-medium border transition-colors bg-zinc-700/50 text-zinc-300 hover:bg-zinc-700 border-zinc-600"
                          >✏️</button>
                          <button
                            onClick={() => {
                              if (confirm(`Excluir chassi ${u.chassi || 'sem chassi'} de ${u.modeloNome}?\nEsta ação reduzirá o estoque em 1 unidade.`))
                                excluirUnidade(u.id);
                            }}
                            disabled={deletandoId === u.id}
                            title="Excluir chassi"
                            className="text-xs px-2 py-1.5 rounded-lg font-medium border transition-colors bg-red-500/10 text-red-400 hover:bg-red-500/20 border-red-500/20 disabled:opacity-40"
                          >{deletandoId === u.id ? '...' : '🗑️'}</button>
                        </>
                      )}
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
                        {isExp ? '✕' : isOutraLoja ? 'Solicitar' : '↔'}
                      </button>
                    </div>
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

      {/* ── Modal de edição de chassi ── */}
      {editandoUnidade && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#18181b] border border-[#27272a] rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold text-lg">✏️ Editar Chassi</h3>
              <button onClick={() => setEditandoUnidade(null)} className="text-zinc-400 hover:text-white text-xl leading-none">✕</button>
            </div>
            <p className="text-zinc-400 text-sm mb-4">{editandoUnidade.modeloNome}</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Chassi</label>
                <input
                  value={editForm.chassi}
                  onChange={e => setEditForm(f => ({ ...f, chassi: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 font-mono"
                  placeholder="Número do chassi"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Cor</label>
                <input
                  value={editForm.cor}
                  onChange={e => setEditForm(f => ({ ...f, cor: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                  placeholder="Ex: Branco Pérola"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Código do Motor</label>
                <input
                  value={editForm.codigoMotor}
                  onChange={e => setEditForm(f => ({ ...f, codigoMotor: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 font-mono"
                  placeholder="Código do motor"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Ano</label>
                <input
                  type="number"
                  value={editForm.ano}
                  onChange={e => setEditForm(f => ({ ...f, ano: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
                  placeholder="2024"
                  min="2000" max="2030"
                />
              </div>
            </div>
            {editErro && <p className="text-red-400 text-sm mt-3">{editErro}</p>}
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setEditandoUnidade(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-zinc-600 text-zinc-300 text-sm hover:bg-zinc-800 transition-colors"
              >Cancelar</button>
              <button
                onClick={salvarEdicao}
                disabled={editSaving}
                className="flex-1 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors disabled:opacity-50"
              >{editSaving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TabMovimentacao ──────────────────────────────────────────────────────────

const TIPO_MOV_LABEL: Record<string, string> = {
  ENTRADA: '📦 Entrada', SAIDA: '📤 Saída', PEDIDO_COMPRA: '🛒 Pedido Compra',
  TRANSFERENCIA: '🔄 Transferência', AJUSTE: '⚙️ Ajuste', VENDA: '🛍️ Venda',
  OS: '🔧 Ordem Serviço', DEVOLUCAO: '↩️ Devolução', PERDA: '❌ Perda',
  AVARIA: '💥 Avaria', RESERVA: '🔒 Reserva', ENTRADA_AVULSA: '📥 Entrada Avulsa',
  IMPORTACAO_ESTOQUE: '📊 Importação', AJUSTE_MANUAL: '✏️ Ajuste Manual',
};
const TIPO_MOV_COR: Record<string, string> = {
  ENTRADA: 'bg-green-500/15 text-green-400 border-green-500/30',
  ENTRADA_AVULSA: 'bg-green-500/15 text-green-400 border-green-500/30',
  IMPORTACAO_ESTOQUE: 'bg-green-500/15 text-green-400 border-green-500/30',
  SAIDA: 'bg-red-500/15 text-red-400 border-red-500/30',
  PEDIDO_COMPRA: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  TRANSFERENCIA: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  AJUSTE: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  AJUSTE_MANUAL: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  VENDA: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  OS: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  DEVOLUCAO: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  PERDA: 'bg-red-700/15 text-red-500 border-red-700/30',
  AVARIA: 'bg-red-700/15 text-red-500 border-red-700/30',
  RESERVA: 'bg-yellow-600/15 text-yellow-500 border-yellow-600/30',
};

function TabMovimentacao({ logs }: { logs: LogEstoque[] }) {
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroBusca, setFiltroBusca] = useState('');

  const tiposPresentes = useMemo(() => [...new Set(logs.map(l => l.tipo))].sort(), [logs]);

  const filtrados = useMemo(() => {
    return logs.filter(l => {
      if (filtroTipo && l.tipo !== filtroTipo) return false;
      if (filtroBusca) {
        const q = filtroBusca.toLowerCase();
        return (l.produto?.nome || '').toLowerCase().includes(q) ||
               (l.usuario?.nome || '').toLowerCase().includes(q) ||
               String(l.origemId || '').includes(q);
      }
      return true;
    });
  }, [logs, filtroTipo, filtroBusca]);

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="flex gap-2 flex-wrap">
        <input
          value={filtroBusca}
          onChange={e => setFiltroBusca(e.target.value)}
          placeholder="🔍 Buscar produto, usuário..."
          className="flex-1 min-w-40 bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500 placeholder-zinc-500"
        />
        <select
          value={filtroTipo}
          onChange={e => setFiltroTipo(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
        >
          <option value="">Todos os tipos</option>
          {tiposPresentes.map(t => (
            <option key={t} value={t}>{TIPO_MOV_LABEL[t] || t}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto">
        {filtrados.length === 0
          ? <div className="text-center py-12 text-zinc-500">Sem movimentações</div>
          : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#27272a] text-zinc-400 text-xs">
                  <th className="text-left p-3 font-medium">Data</th>
                  <th className="text-left p-3 font-medium">Tipo</th>
                  <th className="text-left p-3 font-medium">Ref.</th>
                  <th className="text-left p-3 font-medium">Produto</th>
                  <th className="text-right p-3 font-medium">Qtd</th>
                  <th className="text-right p-3 font-medium">Anterior</th>
                  <th className="text-right p-3 font-medium">Novo</th>
                  <th className="text-left p-3 font-medium">Usuário</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map(l => (
                  <tr key={l.id} className="border-b border-[#27272a] hover:bg-zinc-800/30 transition-colors">
                    <td className="p-3 text-zinc-400 text-xs whitespace-nowrap">{fmtDate(l.createdAt)}</td>
                    <td className="p-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded border ${TIPO_MOV_COR[l.tipo] || 'bg-zinc-700/50 text-zinc-300 border-zinc-600'}`}>
                        {TIPO_MOV_LABEL[l.tipo] || l.tipo}
                      </span>
                    </td>
                    <td className="p-3 text-zinc-500 text-xs font-mono">
                      {l.origemId ? `#${l.origemId}` : `—`}
                    </td>
                    <td className="p-3 text-zinc-200">{l.produto?.nome || '—'}</td>
                    <td className={`p-3 text-right font-bold ${l.quantidade > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {l.quantidade > 0 ? '+' : ''}{l.quantidade}
                    </td>
                    <td className="p-3 text-right text-zinc-400">{l.quantidadeAnterior}</td>
                    <td className="p-3 text-right text-white font-medium">{l.quantidadeNova}</td>
                    <td className="p-3 text-zinc-400 text-xs">{l.usuario?.nome || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
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

function ViewConsolidada({ onSelectEmpresa }: { onSelectEmpresa: (lojaId: number) => void; }) {
  const [data, setData] = useState<ConsolidadoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    api.get<ConsolidadoResponse>('/estoque/consolidado')
      .then(d => setData(d && d.totais ? d : null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiBlock label="Empresas" value={t.totalEmpresas} color="text-white" />
        <KpiBlock label="Motos" value={t.totalMotos} color="text-orange-400" />
        <KpiBlock label="Peças" value={t.totalPecas} color="text-blue-400" />
        <KpiBlock label="Custo Total" value={fmtBRL(t.valorTotalCusto)} color="text-zinc-200" />
        <KpiBlock label="Valor Venda" value={fmtBRL(t.valorTotalVenda)} color="text-green-400" />
        <KpiBlock label="Alertas" value={t.totalAlertas} color={t.totalAlertas > 0 ? 'text-yellow-400' : 'text-zinc-400'} />
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

// ─── Modal Entrada Avulsa ─────────────────────────────────────────────────────

interface ProdutoSimples { id: number; nome: string; tipo: string; codigo: string; }
interface EntradaChassiRow { chassi: string; cor: string; ano: string; custo: string; }

function ModalEntradaAvulsa({
  lojaId, lojas, isAdmin, onClose, onSucesso,
}: {
  lojaId: number; lojas: Loja[]; isAdmin: boolean;
  onClose: () => void; onSucesso: () => void;
}) {
  const inp  = 'w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 placeholder-zinc-500';
  const lbl  = 'block text-xs text-zinc-400 mb-1';

  const [produtos, setProdutos]     = useState<ProdutoSimples[]>([]);
  const [produtoId, setProdutoId]   = useState('');
  const [lojaDestino, setLojaDestino] = useState(String(lojaId));
  const [quantidade, setQuantidade] = useState('1');
  const [custo, setCusto]           = useState('');
  const [fornecedor, setFornecedor] = useState('');
  const [nfEntrada, setNfEntrada]   = useState('');
  const [observacao, setObservacao] = useState('');
  const [chassis, setChassis]       = useState<EntradaChassiRow[]>([{ chassi: '', cor: '', ano: String(new Date().getFullYear()), custo: '' }]);
  const [saving, setSaving]         = useState(false);
  const [erro, setErro]             = useState('');
  const [resultado, setResultado]   = useState<any>(null);

  useEffect(() => {
    api.get<ProdutoSimples[]>('/produtos').then(d => setProdutos(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const produtoSel = produtos.find(p => String(p.id) === produtoId);
  const isMoto = produtoSel?.tipo === 'MOTO';

  const addChassi = () => setChassis(prev => [...prev, { chassi: '', cor: '', ano: String(new Date().getFullYear()), custo: '' }]);
  const removeChassi = (i: number) => setChassis(prev => prev.filter((_, idx) => idx !== i));
  const updateChassi = (i: number, field: keyof EntradaChassiRow, val: string) =>
    setChassis(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));

  const handleSubmit = async () => {
    if (!produtoId) { setErro('Selecione um produto'); return; }
    if (!lojaDestino) { setErro('Selecione a loja de destino'); return; }
    if (isMoto && chassis.filter(r => r.chassi.trim()).length === 0) { setErro('Informe ao menos um chassi'); return; }
    if (!isMoto && (!quantidade || Number(quantidade) < 1)) { setErro('Informe uma quantidade válida'); return; }

    setSaving(true); setErro('');
    try {
      const body: any = {
        produtoId: Number(produtoId),
        lojaId: Number(lojaDestino),
        tipo: isMoto ? 'MOTO' : 'PECA',
        custo: custo ? Number(custo.replace(',', '.')) : undefined,
        notaFiscalEntrada: nfEntrada || undefined,
        observacao: observacao || undefined,
      };
      if (isMoto) {
        body.chassis = chassis.filter(r => r.chassi.trim()).map(r => ({
          chassi: r.chassi.trim(), cor: r.cor.trim() || undefined,
          ano: r.ano ? Number(r.ano) : undefined,
          custo: r.custo ? Number(r.custo.replace(',', '.')) : undefined,
        }));
      } else {
        body.quantidade = Number(quantidade);
      }

      const res: any = await api.post('/estoque/entrada-avulsa', body);
      setResultado(res);
    } catch (e: any) {
      setErro(e.message || 'Erro ao registrar entrada');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 sticky top-0 bg-zinc-900 z-10">
          <h2 className="text-lg font-bold text-white">📦 Entrada Avulsa de Estoque</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-xl">×</button>
        </div>

        {resultado ? (
          <div className="p-6 space-y-4">
            <div className="bg-green-900/30 border border-green-700/40 rounded-xl p-4 text-center">
              <p className="text-green-400 font-semibold text-lg mb-1">✓ Entrada registrada com sucesso!</p>
              {isMoto && <p className="text-zinc-300 text-sm">{resultado.criados} chassi(s) cadastrado(s)</p>}
              {!isMoto && <p className="text-zinc-300 text-sm">{resultado.quantidade} unidade(s) adicionada(s) ao estoque</p>}
              {resultado.erros?.length > 0 && (
                <div className="mt-3 text-left">
                  <p className="text-yellow-400 text-xs font-medium mb-1">Avisos:</p>
                  {resultado.erros.map((e: string, i: number) => <p key={i} className="text-red-400 text-xs">{e}</p>)}
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={onSucesso} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-lg font-medium text-sm">Fechar e Atualizar</button>
              <button onClick={() => setResultado(null)} className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white py-2.5 rounded-lg text-sm">Nova Entrada</button>
            </div>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={lbl}>Produto *</label>
                <select value={produtoId} onChange={e => setProdutoId(e.target.value)} className={inp}>
                  <option value="">Selecione o produto</option>
                  {['MOTO', 'PECA'].map(t => (
                    <optgroup key={t} label={t === 'MOTO' ? '🏍️ Motos' : '🔧 Peças'}>
                      {produtos.filter(p => p.tipo === t).map(p => <option key={p.id} value={p.id}>{p.nome} ({p.codigo})</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              {isAdmin ? (
                <div>
                  <label className={lbl}>Loja de Destino *</label>
                  <select value={lojaDestino} onChange={e => setLojaDestino(e.target.value)} className={inp}>
                    {lojas.map(l => <option key={l.id} value={l.id}>{l.nomeFantasia}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label className={lbl}>Loja de Destino</label>
                  <input readOnly value={lojas.find(l => l.id === lojaId)?.nomeFantasia ?? ''} className={inp + ' opacity-60 cursor-not-allowed'} />
                </div>
              )}
            </div>

            {produtoSel && (
              <div className="bg-zinc-800/50 rounded-lg px-4 py-2 text-xs text-zinc-400 flex gap-4">
                <span>Tipo: <span className={isMoto ? 'text-orange-400' : 'text-blue-400'}>{isMoto ? '🏍️ Moto' : '🔧 Peça'}</span></span>
                <span>Código: <span className="text-zinc-300 font-mono">{produtoSel.codigo}</span></span>
              </div>
            )}

            {produtoSel && !isMoto && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={lbl}>Quantidade *</label>
                  <input type="number" min="1" value={quantidade} onChange={e => setQuantidade(e.target.value)} className={inp} placeholder="1" />
                </div>
                <div>
                  <label className={lbl}>Custo Unitário (R$)</label>
                  <input type="text" value={custo} onChange={e => setCusto(e.target.value)} className={inp} placeholder="0,00" />
                </div>
              </div>
            )}

            {produtoSel && isMoto && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-zinc-300">Chassis a cadastrar</label>
                  <button onClick={addChassi} className="text-xs text-orange-400 hover:text-orange-300 border border-orange-500/30 px-2 py-1 rounded">+ Adicionar Chassi</button>
                </div>
                {chassis.map((row, i) => (
                  <div key={i} className="bg-zinc-800/50 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 relative">
                    <div>
                      <label className={lbl}>Chassi</label>
                      <input value={row.chassi} onChange={e => updateChassi(i, 'chassi', e.target.value)} className={inp} placeholder="9C2..." />
                    </div>
                    <div>
                      <label className={lbl}>Cor</label>
                      <input value={row.cor} onChange={e => updateChassi(i, 'cor', e.target.value)} className={inp} placeholder="Preto" />
                    </div>
                    <div>
                      <label className={lbl}>Ano</label>
                      <input type="number" value={row.ano} onChange={e => updateChassi(i, 'ano', e.target.value)} className={inp} placeholder="2024" />
                    </div>
                    <div>
                      <label className={lbl}>Custo (R$)</label>
                      <input value={row.custo} onChange={e => updateChassi(i, 'custo', e.target.value)} className={inp} placeholder="0,00" />
                    </div>
                    {chassis.length > 1 && (
                      <button onClick={() => removeChassi(i)} className="absolute top-2 right-2 text-red-400 hover:text-red-300 text-xs">✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={lbl}>Nota Fiscal de Entrada</label>
                <input value={nfEntrada} onChange={e => setNfEntrada(e.target.value)} className={inp} placeholder="NFe 12345..." />
              </div>
              <div>
                <label className={lbl}>Fornecedor (opcional)</label>
                <input value={fornecedor} onChange={e => setFornecedor(e.target.value)} className={inp} placeholder="Nome do fornecedor" />
              </div>
            </div>
            <div>
              <label className={lbl}>Observações</label>
              <textarea value={observacao} onChange={e => setObservacao(e.target.value)} rows={2} className={inp + ' resize-none'} placeholder="Motivo da entrada avulsa..." />
            </div>

            {erro && <p className="text-red-400 text-sm">{erro}</p>}

            <div className="flex gap-3 pt-2">
              <button onClick={onClose} className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white py-2.5 rounded-lg text-sm">Cancelar</button>
              <button onClick={handleSubmit} disabled={saving || !produtoId}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium text-sm">
                {saving ? 'Salvando...' : '✓ Registrar Entrada'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modal Importação de Estoque via Planilha ──────────────────────────────────

function ModalImportacaoEstoque({ onClose, onSucesso }: { onClose: () => void; onSucesso: () => void; }) {
  const [arquivo, setArquivo]   = useState<File | null>(null);
  const [loading, setLoading]   = useState(false);
  const [resultado, setResultado] = useState<any>(null);
  const [erro, setErro]         = useState('');

  const handleUpload = async () => {
    if (!arquivo) { setErro('Selecione um arquivo'); return; }
    setLoading(true); setErro('');
    try {
      const formData = new FormData();
      formData.append('arquivo', arquivo);
      const res = await fetch('/api/importacao/estoque', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Erro ao importar'); }
      setResultado(await res.json());
    } catch (e: any) {
      setErro(e.message || 'Erro ao importar planilha');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-zinc-800">
          <h2 className="text-lg font-bold text-white">📊 Importar Planilha de Estoque</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-4">
          {!resultado ? (
            <>
              <div className="bg-zinc-800/50 rounded-lg p-4 text-xs text-zinc-400 space-y-1">
                <p className="font-medium text-zinc-300 mb-2">Formato esperado (colunas no cabeçalho):</p>
                <p>• <span className="text-orange-400">Modelo</span> — nome do produto/modelo (obrigatório)</p>
                <p>• <span className="text-orange-400">Estoque</span> — nome da loja/unidade de destino (obrigatório)</p>
                <p>• Cor, CIF/Custo, Chassi, Quantidade (opcionais)</p>
                <p className="mt-2 text-zinc-500">Exemplos de nomes de loja: "TM Recreio", "TM Campo Grande", "TM Importação"</p>
                <p className="text-zinc-500">Valores monetários: R$ 7.000,00 | 7000 | 7.000,00</p>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Arquivo (.xlsx, .xls, .csv)</label>
                <input type="file" accept=".xlsx,.xls,.csv"
                  onChange={e => { setArquivo(e.target.files?.[0] ?? null); setErro(''); }}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-orange-500 file:text-white cursor-pointer" />
              </div>
              {erro && <p className="text-red-400 text-sm">{erro}</p>}
              <div className="flex gap-3">
                <button onClick={onClose} className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white py-2.5 rounded-lg text-sm">Cancelar</button>
                <button onClick={handleUpload} disabled={loading || !arquivo}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium text-sm">
                  {loading ? 'Importando...' : '📥 Importar'}
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className={`rounded-xl p-4 ${resultado.erros > 0 ? 'bg-yellow-900/20 border border-yellow-700/30' : 'bg-green-900/20 border border-green-700/30'}`}>
                <p className={`font-semibold mb-3 ${resultado.erros > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {resultado.erros > 0 ? '⚠ Importação concluída com avisos' : '✓ Importação concluída!'}
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-zinc-800/50 rounded p-2"><p className="text-zinc-400 text-xs">Total de linhas</p><p className="text-white font-bold">{resultado.totalLinhas}</p></div>
                  <div className="bg-zinc-800/50 rounded p-2"><p className="text-zinc-400 text-xs">Entradas lançadas</p><p className="text-green-400 font-bold">{resultado.entradasLancadas}</p></div>
                  <div className="bg-zinc-800/50 rounded p-2"><p className="text-zinc-400 text-xs">Produtos criados</p><p className="text-orange-400 font-bold">{resultado.produtosCriados}</p></div>
                  <div className="bg-zinc-800/50 rounded p-2"><p className="text-zinc-400 text-xs">Erros</p><p className="text-red-400 font-bold">{resultado.erros}</p></div>
                </div>
                {resultado.detalhesErros?.length > 0 && (
                  <div className="mt-3 max-h-32 overflow-y-auto space-y-1">
                    {resultado.detalhesErros.map((e: string, i: number) => <p key={i} className="text-red-400 text-xs">{e}</p>)}
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={onSucesso} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-lg font-medium text-sm">Fechar e Atualizar</button>
                <button onClick={() => setResultado(null)} className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white py-2.5 rounded-lg text-sm">Nova Importação</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tab de Importação Central (exclusivo TM Importação) ──────────────────────

interface ImportSection {
  key: string;
  title: string;
  icon: string;
  desc: string;
  endpoint: string;
  modeloTipo: string;
  campos: string[];
  obs: string;
}

const IMPORT_SECTIONS: ImportSection[] = [
  {
    key: 'produtos',
    title: 'Catálogo de Produtos',
    icon: '📦',
    desc: 'Cria ou atualiza produtos no catálogo global (Motos e Peças). Use antes de importar estoque.',
    endpoint: '/api/importacao/produtos',
    modeloTipo: 'produtos',
    campos: ['Nome (obrigatório)', 'Tipo (Moto ou Peca)', 'Custo R$', 'Preço Venda R$', 'Margem %'],
    obs: 'O tipo MOTO ou PEÇA é detectado automaticamente pelo nome caso a coluna Tipo esteja vazia.',
  },
  {
    key: 'estoque',
    title: 'Estoque por Loja',
    icon: '🏪',
    desc: 'Importa entradas de estoque distribuídas por loja. Cria produtos se não existirem. Registra LogEstoque.',
    endpoint: '/api/importacao/estoque',
    modeloTipo: 'estoque',
    campos: ['Modelo (obrigatório)', 'Loja/Destino (obrigatório)', 'Cor', 'Custo R$', 'Chassi', 'Quantidade'],
    obs: 'Loja pode ser "TM Recreio", "TM Barra", "TM Importação", etc. Se tiver chassi e for MOTO → cria UnidadeFisica.',
  },
  {
    key: 'unidades',
    title: 'Chassis / Unidades Físicas',
    icon: '🏍️',
    desc: 'Vincula chassis individualmente a produtos MOTO já cadastrados. Requer produto existente no catálogo.',
    endpoint: '/api/importacao/unidades',
    modeloTipo: 'unidades',
    campos: ['Modelo (nome exato do produto)', 'Cor', 'Chassi', 'Motor', 'Ano'],
    obs: 'O nome do modelo deve corresponder exatamente a um produto MOTO cadastrado.',
  },
];

function TabImportacaoCentral() {
  // Estado por seção: arquivo, loading, resultado
  const [estados, setEstados] = useState<Record<string, { arquivo: File | null; loading: boolean; resultado: any; erro: string }>>(() =>
    Object.fromEntries(IMPORT_SECTIONS.map(s => [s.key, { arquivo: null, loading: false, resultado: null, erro: '' }]))
  );
  const refProdutos = useRef<HTMLInputElement>(null);
  const refEstoque  = useRef<HTMLInputElement>(null);
  const refUnidades = useRef<HTMLInputElement>(null);
  const fileRefs: Record<string, React.RefObject<HTMLInputElement | null>> = {
    produtos: refProdutos,
    estoque:  refEstoque,
    unidades: refUnidades,
  };

  function setEstado(key: string, patch: Partial<typeof estados[string]>) {
    setEstados(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function baixarModelo(tipo: string) {
    try {
      const res = await fetch(`/api/importacao/modelo/${tipo}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (!res.ok) throw new Error('Falha ao baixar modelo');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `modelo_${tipo}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert('Erro ao baixar modelo: ' + e.message);
    }
  }

  async function importar(section: ImportSection) {
    const st = estados[section.key];
    if (!st.arquivo) { setEstado(section.key, { erro: 'Selecione um arquivo' }); return; }
    setEstado(section.key, { loading: true, erro: '', resultado: null });
    try {
      const fd = new FormData();
      fd.append('arquivo', st.arquivo);
      const res = await fetch(section.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao importar');
      setEstado(section.key, { resultado: data, arquivo: null });
      if (fileRefs[section.key]?.current) fileRefs[section.key].current!.value = '';
    } catch (e: any) {
      setEstado(section.key, { erro: e.message });
    } finally {
      setEstado(section.key, { loading: false });
    }
  }

  return (
    <div className="p-4 space-y-5">
      {/* Banner */}
      <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4 flex items-start gap-3">
        <span className="text-2xl">🏭</span>
        <div>
          <p className="text-purple-300 font-semibold text-sm">Central de Importação — TM Importação</p>
          <p className="text-zinc-400 text-xs mt-0.5">
            Use esta área para popular o sistema: primeiro importe o catálogo de produtos, depois o estoque por loja e por último os chassis das motos.
          </p>
        </div>
      </div>

      {/* Ordem recomendada */}
      <div className="flex gap-2 items-center text-xs text-zinc-500">
        <span className="bg-zinc-800 px-2 py-1 rounded font-medium text-zinc-300">1. Catálogo</span>
        <span>→</span>
        <span className="bg-zinc-800 px-2 py-1 rounded font-medium text-zinc-300">2. Estoque por Loja</span>
        <span>→</span>
        <span className="bg-zinc-800 px-2 py-1 rounded font-medium text-zinc-300">3. Chassis</span>
      </div>

      {IMPORT_SECTIONS.map((section, idx) => {
        const st = estados[section.key];
        const resultado = st.resultado;

        return (
          <div key={section.key} className="bg-[#09090b] border border-[#27272a] rounded-xl overflow-hidden">
            {/* Header da seção */}
            <div className="px-4 py-3 bg-zinc-800/50 border-b border-[#27272a] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">{section.icon}</span>
                <div>
                  <p className="text-white font-semibold text-sm">
                    <span className="text-zinc-500 mr-2 text-xs font-normal">Passo {idx + 1}</span>
                    {section.title}
                  </p>
                  <p className="text-zinc-400 text-xs mt-0.5">{section.desc}</p>
                </div>
              </div>
              <button
                onClick={() => baixarModelo(section.modeloTipo)}
                className="shrink-0 flex items-center gap-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Baixar Modelo
              </button>
            </div>

            <div className="p-4 space-y-3">
              {/* Colunas esperadas */}
              <div className="flex flex-wrap gap-1">
                {section.campos.map((c, i) => (
                  <span key={i} className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded font-mono">{c}</span>
                ))}
              </div>
              <p className="text-xs text-zinc-500">{section.obs}</p>

              {/* Upload */}
              <div className="flex gap-2 items-center">
                <input
                  ref={fileRefs[section.key]}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={e => setEstado(section.key, { arquivo: e.target.files?.[0] ?? null, erro: '', resultado: null })}
                  className="flex-1 bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-xs file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-orange-500 file:text-white cursor-pointer"
                />
                <button
                  onClick={() => importar(section)}
                  disabled={st.loading || !st.arquivo}
                  className="shrink-0 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
                >
                  {st.loading ? 'Importando...' : '📥 Importar'}
                </button>
              </div>

              {st.erro && <p className="text-red-400 text-xs">{st.erro}</p>}

              {/* Resultado */}
              {resultado && (
                <div className={`rounded-lg p-3 text-xs border ${resultado.erros > 0 ? 'bg-yellow-900/20 border-yellow-700/30' : 'bg-green-900/20 border-green-700/30'}`}>
                  <p className={`font-semibold mb-2 ${resultado.erros > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {resultado.erros > 0 ? '⚠ Concluído com avisos' : '✓ Importação concluída!'}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                    {resultado.totalLinhas     !== undefined && <div className="bg-zinc-800/60 rounded p-2"><p className="text-zinc-400">Linhas</p><p className="text-white font-bold">{resultado.totalLinhas}</p></div>}
                    {resultado.criados         !== undefined && <div className="bg-zinc-800/60 rounded p-2"><p className="text-zinc-400">Criados</p><p className="text-orange-400 font-bold">{resultado.criados}</p></div>}
                    {resultado.importados      !== undefined && <div className="bg-zinc-800/60 rounded p-2"><p className="text-zinc-400">Importados</p><p className="text-green-400 font-bold">{resultado.importados}</p></div>}
                    {resultado.atualizados     !== undefined && <div className="bg-zinc-800/60 rounded p-2"><p className="text-zinc-400">Atualizados</p><p className="text-blue-400 font-bold">{resultado.atualizados}</p></div>}
                    {resultado.entradasLancadas!== undefined && <div className="bg-zinc-800/60 rounded p-2"><p className="text-zinc-400">Entradas</p><p className="text-green-400 font-bold">{resultado.entradasLancadas}</p></div>}
                    {resultado.erros           !== undefined && <div className="bg-zinc-800/60 rounded p-2"><p className="text-zinc-400">Erros</p><p className="text-red-400 font-bold">{resultado.erros}</p></div>}
                  </div>
                  {/* Colunas detectadas */}
                  {resultado.colunasDetectadas && (
                    <div className="mt-1 mb-2">
                      <p className="text-zinc-500 mb-1">Colunas mapeadas:</p>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(resultado.colunasDetectadas).map(([k, v]: any) => (
                          <span key={k} className="text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded">
                            {k}: <span className="text-zinc-200">{v}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {resultado.detalhesErros?.length > 0 && (
                    <div className="max-h-24 overflow-y-auto mt-1 space-y-0.5">
                      {resultado.detalhesErros.map((e: string, i: number) => (
                        <p key={i} className="text-red-400">{e}</p>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => setEstado(section.key, { resultado: null })}
                    className="mt-2 text-zinc-500 hover:text-zinc-300 text-xs underline"
                  >
                    Nova importação
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── View por Empresa ─────────────────────────────────────────────────────────

type EmpresaTab = 'gerencial' | 'unitaria' | 'movimentacao' | 'solicitacoes' | 'importacao';

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
  const [data, setData] = useState<EmpresaDetalhes | null>(null);
  const [loading, setLoading] = useState(true);
  const [aba, setAba] = useState<EmpresaTab>('gerencial');
  const [busca, setBusca] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [showCadastroChassi, setShowCadastroChassi]       = useState(false);
  const [showEntradaAvulsa, setShowEntradaAvulsa]         = useState(false);
  const [showImportacaoEstoque, setShowImportacaoEstoque] = useState(false);
  const isOutraLoja = minhaLojaId !== null && lojaId !== minhaLojaId;
  const podeGerir = !isOutraLoja; // pode cadastrar chassi nesta loja

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
    ...(lojaId === LOJA_IMPORTACAO_ID ? [{ id: 'importacao' as EmpresaTab, label: '📥 Importação Central', highlight: true }] : []),
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
          {podeGerir && (
            <>
              <button
                onClick={() => setShowCadastroChassi(true)}
                className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5">
                🏍️ Cadastrar Chassi
              </button>
            </>
          )}
          {t.alertasBaixoEstoque > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 px-3 py-1.5 rounded-lg text-sm">
              ⚠ {t.alertasBaixoEstoque} alerta{t.alertasBaixoEstoque > 1 ? 's' : ''} de estoque baixo
            </div>
          )}
        </div>
      </div>

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
            onRefresh={() => setRefreshKey(k => k + 1)}
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
            onRefresh={() => setRefreshKey(k => k + 1)}
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
        {aba === 'importacao' && <TabImportacaoCentral />}
      </Card>

      {showCadastroChassi && (
        <ModalCadastroChassi
          lojaId={lojaId}
          lojas={lojas}
          isAdmin={minhaLojaId === null}
          onClose={() => setShowCadastroChassi(false)}
          onSucesso={() => { setShowCadastroChassi(false); setRefreshKey(k => k + 1); setAba('unitaria'); }}
        />
      )}

      {showEntradaAvulsa && (
        <ModalEntradaAvulsa
          lojaId={lojaId}
          lojas={lojas}
          isAdmin={minhaLojaId === null}
          onClose={() => setShowEntradaAvulsa(false)}
          onSucesso={() => { setShowEntradaAvulsa(false); setRefreshKey(k => k + 1); }}
        />
      )}

      {showImportacaoEstoque && (
        <ModalImportacaoEstoque
          onClose={() => setShowImportacaoEstoque(false)}
          onSucesso={() => { setShowImportacaoEstoque(false); setRefreshKey(k => k + 1); }}
        />
      )}
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

type MainTab = 'consolidado' | 'estoque-geral' | 'mov-estoque' | 'mov-avulsa' | 'historico';

const TAB_LABELS: { id: MainTab; label: string; icon: string }[] = [
  { id: 'consolidado',   label: 'Consolidado',   icon: '📊' },
  { id: 'estoque-geral', label: 'Estoque Geral',  icon: '📋' },
  { id: 'mov-estoque',   label: 'MOV. ESTOQUE',   icon: '🔄' },
  { id: 'mov-avulsa',    label: 'MOV. AVULSA',    icon: '⚡' },
  { id: 'historico',     label: 'Histórico',      icon: '📜' },
];

export function Estoque() {
  const { user } = useAuth();
  const { selectedLojaId: ctxLojaId } = useLojaContext();
  const [lojas, setLojas]         = useState<Loja[]>([]);
  const [lojaId, setLojaId]       = useState<number | null>(null);
  const [loadingLojas, setLoadingLojas] = useState(true);
  const [refreshSolicitacoes, setRefreshSolicitacoes] = useState(0);
  const [activeTab, setActiveTab] = useState<MainTab>('consolidado');

  const role           = user?.role || '';
  const isAdmin        = ['ADMIN_GERAL', 'ADMIN_FINANCEIRO'].includes(role);
  const isAprovador    = ['ADMIN_GERAL', 'ADMIN_FINANCEIRO'].includes(role);
  const verCustosGlobal = ['ADMIN_GERAL', 'ADMIN_FINANCEIRO', 'ADMIN_REDE'].includes(role);
  const minhaLojaId    = user?.lojaId ?? null;

  useEffect(() => {
    api.get<Loja[]>('/lojas?todos=true')
      .then(lista => {
        setLojas(lista);
        if (ctxLojaId)          setLojaId(ctxLojaId);
        else if (user?.lojaId)  setLojaId(user.lojaId);
        else if (!isAdmin && lista.length > 0) setLojaId(lista[0].id);
      })
      .catch(() => setLojas([]))
      .finally(() => setLoadingLojas(false));
  }, []);

  useEffect(() => {
    if (ctxLojaId) {
      setLojaId(ctxLojaId);
      setActiveTab('consolidado');
    } else if (isAdmin && !user?.lojaId) {
      setLojaId(null);
    }
  }, [ctxLojaId]);

  const lojasSorted = useMemo(() => {
    if (!lojas.length) return [];
    if (!isAdmin && minhaLojaId) {
      const minhaLoja  = lojas.find(l => l.id === minhaLojaId);
      const importacao = lojas.find(l => l.id === LOJA_IMPORTACAO_ID && l.id !== minhaLojaId);
      const outras     = lojas
        .filter(l => l.id !== minhaLojaId && l.id !== LOJA_IMPORTACAO_ID)
        .sort((a, b) => (LOJA_ORDER[a.id] ?? 99) - (LOJA_ORDER[b.id] ?? 99));
      return [...(minhaLoja ? [minhaLoja] : []), ...(importacao ? [importacao] : []), ...outras];
    }
    return [...lojas].sort((a, b) => (LOJA_ORDER[a.id] ?? 99) - (LOJA_ORDER[b.id] ?? 99));
  }, [lojas, isAdmin, minhaLojaId]);

  if (loadingLojas) return <div className="p-12 text-center text-zinc-400">Carregando...</div>;

  // ── Subtítulo dinâmico por aba ──────────────────────────────────────────────
  const subtitulos: Record<MainTab, string> = {
    'consolidado':   isAdmin ? 'Visão consolidada — todas as empresas' : 'Estoque da sua loja',
    'estoque-geral': 'Lista completa de itens — motos e peças',
    'mov-estoque':   'Transferência entre estoques / lojas',
    'mov-avulsa':    'Entradas e saídas manuais sem gerar financeiro',
    'historico':     'Histórico completo de movimentações',
  };

  // ── Componente da aba ativa ─────────────────────────────────────────────────
  function renderTab() {
    switch (activeTab) {

      case 'consolidado':
        return (
          <div className="space-y-4">
            {/* Seletor de loja para Consolidado */}
            {isAdmin && (
              <div className="min-w-64 max-w-sm">
                <Select
                  value={lojaId ?? ''}
                  onChange={e => setLojaId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">📊 Todas as Empresas (Consolidado)</option>
                  {lojasSorted.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.id === minhaLojaId
                        ? `🏠 ${l.nomeFantasia} (Minha Loja)`
                        : l.id === LOJA_IMPORTACAO_ID
                          ? `🏭 ${l.nomeFantasia} — Estoque Central`
                          : `🏪 ${l.nomeFantasia}`}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {isAdmin && lojaId === null ? (
              <>
                <BuscadorRede
                  minhaLojaId={minhaLojaId}
                  lojas={lojasSorted}
                  onVerLoja={id => setLojaId(id)}
                />
                <ViewConsolidada onSelectEmpresa={id => setLojaId(id)} />
              </>
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

      case 'estoque-geral':
        return (
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 sm:p-6">
            <TabEstoqueGeral lojas={lojasSorted} />
          </div>
        );

      case 'mov-estoque':
        return (
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 sm:p-6">
            <TabMovEstoque lojas={lojasSorted} />
          </div>
        );

      case 'mov-avulsa':
        return (
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 sm:p-6">
            <TabMovAvulsa lojas={lojasSorted} />
          </div>
        );

      case 'historico':
        return (
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 sm:p-6">
            <TabHistorico lojas={lojasSorted} />
          </div>
        );
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <SectionHeader
        title="Controle de Estoque"
        subtitle={subtitulos[activeTab]}
      />

      {/* Barra de abas principal */}
      <div className="flex items-center gap-0.5 border-b border-[#27272a] overflow-x-auto">
        {TAB_LABELS.filter(tab => {
          if (tab.id === 'mov-estoque' || tab.id === 'mov-avulsa') return isAdmin;
          return true;
        }).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex items-center gap-1.5 pb-3 px-3 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap
              ${activeTab === tab.id
                ? 'border-orange-500 text-orange-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'}
            `}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Conteúdo da aba ativa */}
      <div>
        {renderTab()}
      </div>
    </div>
  );
}
