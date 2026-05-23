import { useEffect, useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { api } from '../services/api';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface UnidadeFisica {
  chassi?: string;
  codigoMotor?: string;
  cor?: string;
}

interface VendaItem {
  produto?: { nome: string; manualUrl?: string };
  servico?: { nome: string };
  unidadeFisica?: UnidadeFisica;
  precoUnitario: number;
  quantidade: number;
}

interface VendaCheckin {
  id?: number;
  numeroSerie: string;
  checklistJson?: string;
  quilometragem?: number;
  assinaturaCliente?: string;
  assinaturaVendedor?: string;
  assinaturaEntregador?: string;
  nomeCliente?: string;
  nomeVendedor?: string;
  nomeEntregador?: string;
  assinadoClienteAt?: string;
  assinadoVendedorAt?: string;
  finalizadoAt?: string;
}

interface Documento {
  tipo: string;
  numeroSerie: string;
  enviadoEmail: boolean;
  enviadoWhatsapp: boolean;
}

interface VendaCheckinData {
  id: number;
  status: string;
  tipo: string;
  formaPagamento: string;
  parcelas?: number;
  valorTotal: number;
  createdAt: string;
  observacoes?: string;
  cliente: {
    nome: string;
    cpfCnpj?: string;
    telefone?: string;
    email?: string;
  };
  vendedor: { nome: string };
  loja: { nomeFantasia: string; cnpj?: string };
  itens: VendaItem[];
  checkin?: VendaCheckin;
  documentos?: Documento[];
}

interface ChecklistItemState {
  key: string;
  label: string;
  status: 'OK' | 'NAO_OK' | '';
  obs: string;
}

interface CheckinSaidaProps {
  vendaId: number;
  onConcluir: () => void;
  onCancelar: () => void;
}

// Converte o canvas do signature-pad em dataURL com FUNDO BRANCO.
// Necessário porque o canvas é transparente e JPEG não suporta canal alpha,
// então o fundo transparente vira PRETO ao converter (tarja preta sobre os traços).
// Solução: redesenhar a assinatura sobre um canvas com fundo branco antes de exportar.
function assinaturaParaDataUrl(ref: { current: SignatureCanvas | null }): string {
  try {
    if (!ref.current || ref.current.isEmpty()) return '';
    const trimmed = ref.current.getTrimmedCanvas();
    const w = trimmed.width || 1;
    const h = trimmed.height || 1;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return trimmed.toDataURL('image/png');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(trimmed, 0, 0);
    return c.toDataURL('image/jpeg', 0.85);
  } catch {
    return '';
  }
}

// ── Itens do checklist técnico ────────────────────────────────────────────────

const CHECKLIST_INICIAL: ChecklistItemState[] = [
  { key: 'buzina',     label: 'Buzina',             status: '', obs: '' },
  { key: 'retrovisor', label: 'Retrovisor',          status: '', obs: '' },
  { key: 'seta',       label: 'Seta',                status: '', obs: '' },
  { key: 'acelerador', label: 'Acelerador',          status: '', obs: '' },
  { key: 'painel',     label: 'Painel',              status: '', obs: '' },
  { key: 'freio',      label: 'Freio',               status: '', obs: '' },
  { key: 'parafusos',  label: 'Parafusos apertados', status: '', obs: '' },
  { key: 'carregador', label: 'Carregador',          status: '', obs: '' },
  { key: 'bateria',    label: 'Bateria',             status: '', obs: '' },
  { key: 'pedaleira',  label: 'Pedaleira',           status: '', obs: '' },
  { key: 'encosto',    label: 'Encosto',             status: '', obs: '' },
  { key: 'alarme',     label: 'Alarme',              status: '', obs: '' },
  { key: 'pisca',      label: 'Pisca-alerta',        status: '', obs: '' },
  { key: 're',         label: 'Ré',                  status: '', obs: '' },
  { key: 'banco',      label: 'Banco',               status: '', obs: '' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatarPagamento(fp: string, parcelas?: number, valor?: number): string {
  const labels: Record<string, string> = {
    PIX: 'PIX', DINHEIRO: 'Dinheiro', CARTAO: 'Cartão', CARTAO_DEBITO: 'Cartão Débito',
    CARTAO_CREDITO: 'Cartão Crédito', FINANCIAMENTO: 'Financiamento', COMBINADO: 'Combinado',
  };
  const label = labels[fp] || fp;
  if ((fp === 'CARTAO_CREDITO' || fp === 'FINANCIAMENTO') && parcelas && parcelas > 1 && valor) {
    return `${label} — ${parcelas}x de R$ ${(valor / parcelas).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return label;
}

// ── Componente principal ──────────────────────────────────────────────────────

export function CheckinSaida({ vendaId, onConcluir, onCancelar }: CheckinSaidaProps) {
  const [venda, setVenda] = useState<VendaCheckinData | null>(null);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [concluido, setConcluido] = useState(false);
  const [seriesFinais, setSeriesFinais] = useState<{ checkin: string; recibo: string } | null>(null);

  const [checklist, setChecklist] = useState<ChecklistItemState[]>(CHECKLIST_INICIAL);
  const [nomeEntregador, setNomeEntregador] = useState('');

  const sigClienteRef    = useRef<SignatureCanvas>(null);
  const sigVendedorRef   = useRef<SignatureCanvas>(null);
  const sigEntregadorRef = useRef<SignatureCanvas>(null);

  // ── Carregar dados da venda ─────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const data = await api.get<VendaCheckinData>(`/checkin/${vendaId}`);
        setVenda(data);

        // Restaurar rascunho se existir
        if (data.checkin?.checklistJson) {
          try {
            const saved: ChecklistItemState[] = JSON.parse(data.checkin.checklistJson);
            setChecklist(prev => prev.map(item => {
              const s = saved.find(x => x.key === item.key);
              return s ? { ...item, status: s.status, obs: s.obs } : item;
            }));
          } catch (_) { /* checklist corrompido: ignora */ }
        }
        if (data.checkin?.nomeEntregador) {
          setNomeEntregador(data.checkin.nomeEntregador);
        }
      } catch (e: any) {
        setErro(e.message || 'Erro ao carregar venda');
      } finally {
        setLoading(false);
      }
    })();
  }, [vendaId]);

  // ── Atualizar item do checklist ─────────────────────────────────────────────
  const atualizarItem = (key: string, campo: 'status' | 'obs', valor: string) => {
    setChecklist(prev => prev.map(item =>
      item.key === key ? { ...item, [campo]: valor } : item
    ));
  };

  // ── Salvar rascunho ─────────────────────────────────────────────────────────
  const salvarRascunho = async () => {
    try {
      const assinaturaCliente    = assinaturaParaDataUrl(sigClienteRef);
      const assinaturaVendedor   = assinaturaParaDataUrl(sigVendedorRef);
      const assinaturaEntregador = assinaturaParaDataUrl(sigEntregadorRef);

      await api.post(`/checkin/${vendaId}`, {
        checklistJson: JSON.stringify(checklist),
        assinaturaCliente,
        assinaturaVendedor,
        assinaturaEntregador,
        nomeCliente:    venda?.cliente?.nome,
        nomeVendedor:   venda?.vendedor?.nome,
        nomeEntregador: nomeEntregador || undefined,
      });
    } catch (_) { /* rascunho falha silenciosamente */ }
  };

  // ── Finalizar check-in ──────────────────────────────────────────────────────
  const finalizar = async () => {
    setErro('');

    // Validação: todos os itens conferidos
    const naoConferidos = checklist.filter(i => !i.status);
    if (naoConferidos.length > 0) {
      setErro(`Item(s) não conferido(s): ${naoConferidos.map(i => i.label).join(', ')}`);
      return;
    }

    // Validação: Não OK precisa de observação
    const naoOkSemObs = checklist.filter(i => i.status === 'NAO_OK' && !i.obs.trim());
    if (naoOkSemObs.length > 0) {
      setErro(`Item(s) "Não OK" sem observação: ${naoOkSemObs.map(i => i.label).join(', ')}`);
      return;
    }

    // Validação: assinaturas
    if (sigClienteRef.current?.isEmpty()) {
      setErro('Assinatura do cliente é obrigatória');
      return;
    }
    if (sigVendedorRef.current?.isEmpty()) {
      setErro('Assinatura do vendedor é obrigatória');
      return;
    }

    const assinaturaCliente    = assinaturaParaDataUrl(sigClienteRef);
    const assinaturaVendedor   = assinaturaParaDataUrl(sigVendedorRef);
    const assinaturaEntregador = sigEntregadorRef.current?.isEmpty()
      ? undefined : assinaturaParaDataUrl(sigEntregadorRef) || undefined;

    const agora = new Date().toISOString();
    setSalvando(true);
    try {
      const resultado = await api.put<{ numeroSerieCheckin: string; numeroSerieRecibo: string }>(
        `/checkin/${vendaId}/finalizar`,
        {
          checklistJson: JSON.stringify(checklist),
          assinaturaCliente,
          assinaturaVendedor,
          assinaturaEntregador,
          nomeCliente:    venda?.cliente?.nome,
          nomeVendedor:   venda?.vendedor?.nome,
          nomeEntregador: nomeEntregador || undefined,
          assinadoClienteAt: agora,
          assinadoVendedorAt: agora,
        }
      );
      setSeriesFinais({ checkin: resultado.numeroSerieCheckin, recibo: resultado.numeroSerieRecibo });

      // Atualiza venda em memória com o checkin recém-salvo para que o botão
      // "Imprimir Laudo" tenha acesso às assinaturas mesmo depois do canvas
      // ter sido desmontado.
      setVenda(prev => prev ? {
        ...prev,
        checkin: {
          ...(prev.checkin || {} as any),
          numeroSerie: resultado.numeroSerieCheckin,
          checklistJson: JSON.stringify(checklist),
          assinaturaCliente,
          assinaturaVendedor,
          assinaturaEntregador: assinaturaEntregador || undefined,
          nomeCliente:    venda?.cliente?.nome,
          nomeVendedor:   venda?.vendedor?.nome,
          nomeEntregador: nomeEntregador || undefined,
          assinadoClienteAt: agora,
          assinadoVendedorAt: agora,
          finalizadoAt: agora,
        },
      } : prev);

      setConcluido(true);
    } catch (e: any) {
      setErro(e.message || 'Erro ao finalizar check-in');
    } finally {
      setSalvando(false);
    }
  };

  // ── Imprimir laudo ──────────────────────────────────────────────────────────
  // Prioriza as assinaturas salvas no banco (venda.checkin) sobre o canvas em memória.
  // Motivo: depois de finalizar o check-in o componente troca de tela ("concluído")
  // e os refs do signature-pad ficam null/vazios — sem este fallback o <img src="">
  // ficaria em branco e as assinaturas sumiriam do laudo.
  const imprimirLaudo = () => {
    if (!venda) return;
    const assinaturaClienteB64    = venda.checkin?.assinaturaCliente    || assinaturaParaDataUrl(sigClienteRef);
    const assinaturaVendedorB64   = venda.checkin?.assinaturaVendedor   || assinaturaParaDataUrl(sigVendedorRef);
    const assinaturaEntregadorB64 = venda.checkin?.assinaturaEntregador || assinaturaParaDataUrl(sigEntregadorRef);

    const nomeFantasia = (venda.loja?.nomeFantasia || '').toLowerCase();
    const isTM = nomeFantasia.includes('tm import') || nomeFantasia.includes('importa');
    const logoUrl  = `${window.location.origin}/${isTM ? 'logo-tm.png' : 'logo.png'}`;
    const brandName = isTM ? 'TM Imports' : 'Tecle Motos';
    const numeroSerie = seriesFinais?.checkin || venda.checkin?.numeroSerie || `LDS-${new Date().getFullYear()}-${String(vendaId).padStart(6,'0')}`;

    const motosHtml = venda.itens
      .filter(it => it.unidadeFisica)
      .map(it => {
        const uf = it.unidadeFisica!;
        return `<tr>
          <td>${it.produto?.nome || '-'}</td>
          <td>${uf.chassi || '<span style="color:#b91c1c">Não informado</span>'}</td>
          <td>${uf.codigoMotor || '-'}</td>
          <td>${uf.cor || '-'}</td>
        </tr>`;
      }).join('');

    const checklistHtml = checklist.map(item => {
      const cor = item.status === 'OK' ? '#16a34a' : item.status === 'NAO_OK' ? '#dc2626' : '#aaa';
      const label = item.status === 'OK' ? '✔ OK' : item.status === 'NAO_OK' ? '✘ Não OK' : '—';
      return `<tr>
        <td style="padding:5px 10px;border-bottom:1px solid #f0f0f0;font-size:12px">${item.label}</td>
        <td style="padding:5px 10px;border-bottom:1px solid #f0f0f0;font-size:12px;font-weight:700;color:${cor}">${label}</td>
        <td style="padding:5px 10px;border-bottom:1px solid #f0f0f0;font-size:11px;color:#555">${item.obs || ''}</td>
      </tr>`;
    }).join('');

    const pw = window.open('', '_blank');
    if (!pw) return;

    pw.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/>
<title>Laudo de Saída ${numeroSerie}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;color:#1a1a1a;background:#fff;font-size:13px}
  .stripe{display:flex;height:16px;width:100%}
  .sb{background:#0a0a0a;flex:2}.so{background:#f97316;flex:5}.sw{background:#f0f0f0;flex:1}
  .header{background:#111;display:flex;align-items:center;justify-content:space-between;padding:14px 30px}
  .header img{height:50px;object-fit:contain}
  .hr{text-align:right}
  .doc-label{font-size:9px;font-weight:700;letter-spacing:2px;color:#f97316;text-transform:uppercase}
  .doc-num{font-size:20px;font-weight:900;color:#fff;line-height:1.1}
  .doc-meta{font-size:10px;color:#9ca3af;margin-top:2px}
  .orange-bar{height:3px;background:#f97316}
  .body{padding:18px 30px}
  .sec-title{font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#f97316;border-bottom:1.5px solid #f97316;padding-bottom:3px;margin-bottom:10px}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px}
  .info-col p{font-size:12px;margin-bottom:3px}
  .info-col .lbl{color:#777;display:inline-block;min-width:100px}
  .info-col .val{font-weight:600}
  table{width:100%;border-collapse:collapse}
  thead tr{background:#111;color:#fff}
  th{padding:7px 10px;font-size:11px;font-weight:600;text-align:left}
  tbody tr:nth-child(even){background:#f8f8f8}
  td{padding:6px 10px;border-bottom:1px solid #eee}
  .assin{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-top:6px}
  .assin-box{text-align:center}
  .assin-img{height:70px;border-bottom:1.5px solid #333;margin-bottom:6px;display:flex;align-items:flex-end;justify-content:center}
  .assin-img img{max-height:65px;max-width:100%}
  .assin-label{font-size:11px;color:#555}
  .assin-nome{font-size:10px;color:#888;margin-top:2px}
  .footer{margin-top:20px;padding-top:10px;border-top:1px solid #e5e5e5;text-align:center;font-size:10px;color:#aaa}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="stripe"><div class="sb"></div><div class="so"></div><div class="sw"></div></div>
<div class="header">
  <img src="${logoUrl}" alt="${brandName}"/>
  <div class="hr">
    <div class="doc-label">Laudo de Saída</div>
    <div class="doc-num">${numeroSerie}</div>
    <div class="doc-meta">Venda #${String(vendaId).padStart(5,'0')} · ${new Date(venda.createdAt).toLocaleDateString('pt-BR')}</div>
    <div style="font-size:11px;color:#d1d5db;margin-top:2px">${venda.loja?.nomeFantasia || ''}</div>
  </div>
</div>
<div class="orange-bar"></div>
<div class="body">

<div class="info-grid">
  <div class="info-col">
    <div class="sec-title">Dados da Venda</div>
    <p><span class="lbl">Nº da Venda:</span> <span class="val">#${String(vendaId).padStart(5,'0')}</span></p>
    <p><span class="lbl">Laudo:</span> <span class="val">${numeroSerie}</span></p>
    <p><span class="lbl">Data:</span> <span class="val">${new Date(venda.createdAt).toLocaleDateString('pt-BR')}</span></p>
    <p><span class="lbl">Loja:</span> <span class="val">${venda.loja?.nomeFantasia || '-'}</span></p>
    <p><span class="lbl">Vendedor:</span> <span class="val">${venda.vendedor?.nome || '-'}</span></p>
  </div>
  <div class="info-col">
    <div class="sec-title">Dados do Cliente</div>
    <p><span class="lbl">Nome:</span> <span class="val">${venda.cliente?.nome || '-'}</span></p>
    ${venda.cliente?.cpfCnpj ? `<p><span class="lbl">CPF/CNPJ:</span> <span class="val">${venda.cliente.cpfCnpj}</span></p>` : ''}
    ${venda.cliente?.telefone ? `<p><span class="lbl">Telefone:</span> <span class="val">${venda.cliente.telefone}</span></p>` : ''}
    ${venda.cliente?.email ? `<p><span class="lbl">E-mail:</span> <span class="val">${venda.cliente.email}</span></p>` : ''}
  </div>
</div>

${motosHtml ? `<div style="margin-bottom:18px">
  <div class="sec-title">Dados da Moto</div>
  <table><thead><tr><th>Modelo</th><th>Chassi</th><th>Cód. Motor</th><th>Cor</th></tr></thead>
  <tbody>${motosHtml}</tbody></table>
</div>` : ''}

<div style="margin-bottom:18px">
  <div class="sec-title">Checklist Técnico</div>
  <table>
    <thead><tr><th>Item</th><th style="width:100px">Status</th><th>Observação</th></tr></thead>
    <tbody>${checklistHtml}</tbody>
  </table>
</div>

<div style="margin-bottom:18px">
  <div class="sec-title">Assinaturas</div>
  <div class="assin">
    <div class="assin-box">
      <div class="assin-img">${assinaturaClienteB64 ? `<img src="${assinaturaClienteB64}"/>` : ''}</div>
      <div class="assin-label">Assinatura do Cliente</div>
      <div class="assin-nome">${venda.cliente?.nome || ''}</div>
    </div>
    <div class="assin-box">
      <div class="assin-img">${assinaturaVendedorB64 ? `<img src="${assinaturaVendedorB64}"/>` : ''}</div>
      <div class="assin-label">Assinatura do Vendedor</div>
      <div class="assin-nome">${venda.vendedor?.nome || ''}</div>
    </div>
    <div class="assin-box">
      <div class="assin-img">${assinaturaEntregadorB64 ? `<img src="${assinaturaEntregadorB64}"/>` : ''}</div>
      <div class="assin-label">Assinatura do Entregador <span style="font-size:9px;color:#aaa">(opcional)</span></div>
      <div class="assin-nome">${nomeEntregador || ''}</div>
    </div>
  </div>
</div>

<div class="footer">
  ${brandName} · Laudo gerado em ${new Date().toLocaleString('pt-BR')}<br>
  Este documento é válido somente com as assinaturas das partes.
</div>
</div></body></html>`);
    pw.document.close();
    pw.print();
  };

  // ── Tela de loading ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <div className="text-zinc-400 text-sm">Carregando check-in...</div>
      </div>
    );
  }

  if (!venda) {
    return (
      <div className="min-h-screen bg-[#09090b] flex flex-col items-center justify-center gap-4">
        <p className="text-red-400">{erro || 'Venda não encontrada'}</p>
        <button onClick={onCancelar} className="btn btn-secondary">Voltar</button>
      </div>
    );
  }

  // ── Tela de sucesso ─────────────────────────────────────────────────────────
  if (concluido) {
    return (
      <div className="min-h-screen bg-[#09090b] flex flex-col items-center justify-center p-6 gap-6">
        <div className="w-full max-w-lg bg-[#18181b] border border-[#27272a] rounded-2xl p-8 text-center space-y-5">
          <div className="text-5xl">🎉</div>
          <h2 className="text-2xl font-bold text-white">Check-in Concluído!</h2>
          <p className="text-zinc-400 text-sm">
            A venda foi finalizada com sucesso. Os documentos foram enviados para o cliente.
          </p>

          <div className="bg-zinc-900 rounded-xl p-4 text-left space-y-2 text-sm">
            <p className="text-zinc-400">Laudo: <span className="text-orange-400 font-mono font-bold">{seriesFinais?.checkin}</span></p>
            <p className="text-zinc-400">Recibo: <span className="text-orange-400 font-mono font-bold">{seriesFinais?.recibo}</span></p>
            {venda.cliente?.email && (
              <p className="text-zinc-500 text-xs">Email enviado para: {venda.cliente.email}</p>
            )}
            {venda.cliente?.telefone && (
              <p className="text-zinc-500 text-xs">WhatsApp enviado para: {venda.cliente.telefone}</p>
            )}
          </div>

          <div className="flex gap-3 justify-center flex-wrap">
            <button
              onClick={imprimirLaudo}
              className="px-5 py-2.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
            >
              Imprimir Laudo
            </button>
            <button
              onClick={onConcluir}
              className="px-5 py-2.5 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium"
            >
              Voltar para Vendas
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Moto(s) da venda ────────────────────────────────────────────────────────
  const motos = venda.itens.filter(it => it.unidadeFisica);

  // ── Tela principal do check-in ──────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#09090b] pb-20">

      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#18181b] border-b border-[#27272a] px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold tracking-widest text-orange-500 uppercase">Check-in Técnico</p>
          <p className="text-white font-bold">Venda #{String(vendaId).padStart(5,'0')}</p>
        </div>
        <button
          onClick={async () => { await salvarRascunho(); onCancelar(); }}
          className="text-zinc-400 hover:text-white text-sm px-3 py-1.5 border border-zinc-700 rounded-lg"
        >
          Salvar e Voltar
        </button>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-5 space-y-5">

        {/* Dados da venda — read only */}
        <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 space-y-3">
          <p className="text-[10px] font-bold tracking-widest text-orange-500 uppercase">Dados da Venda</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><p className="text-zinc-500 text-xs">Loja</p><p className="text-white font-medium">{venda.loja?.nomeFantasia}</p></div>
            <div><p className="text-zinc-500 text-xs">Vendedor</p><p className="text-white font-medium">{venda.vendedor?.nome}</p></div>
            <div><p className="text-zinc-500 text-xs">Total</p><p className="text-green-400 font-bold">R$ {Number(venda.valorTotal).toLocaleString('pt-BR',{minimumFractionDigits:2})}</p></div>
            <div><p className="text-zinc-500 text-xs">Pagamento</p><p className="text-white">{formatarPagamento(venda.formaPagamento, venda.parcelas, venda.valorTotal)}</p></div>
          </div>
        </div>

        {/* Dados do cliente */}
        <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 space-y-2">
          <p className="text-[10px] font-bold tracking-widest text-orange-500 uppercase">Cliente</p>
          <p className="text-white font-semibold">{venda.cliente?.nome}</p>
          {venda.cliente?.cpfCnpj && <p className="text-zinc-400 text-sm">CPF/CNPJ: {venda.cliente.cpfCnpj}</p>}
          {venda.cliente?.telefone && <p className="text-zinc-400 text-sm">Tel: {venda.cliente.telefone}</p>}
          {venda.cliente?.email && <p className="text-zinc-400 text-sm">Email: {venda.cliente.email}</p>}
        </div>

        {/* Dados da moto */}
        {motos.length > 0 && (
          <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 space-y-3">
            <p className="text-[10px] font-bold tracking-widest text-orange-500 uppercase">Moto(s) Entregue(s)</p>
            {motos.map((it, i) => (
              <div key={i} className="bg-zinc-900 rounded-lg p-3 space-y-1">
                <p className="text-white font-semibold">{it.produto?.nome || 'Moto'}</p>
                <div className="grid grid-cols-3 gap-2 text-xs text-zinc-400">
                  <div><span className="text-zinc-600">Chassi</span><br/><span className="text-white font-mono">{it.unidadeFisica?.chassi || '—'}</span></div>
                  <div><span className="text-zinc-600">Motor</span><br/><span className="text-white font-mono">{it.unidadeFisica?.codigoMotor || '—'}</span></div>
                  <div><span className="text-zinc-600">Cor</span><br/><span className="text-white">{it.unidadeFisica?.cor || '—'}</span></div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Checklist técnico */}
        <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 space-y-3">
          <p className="text-[10px] font-bold tracking-widest text-orange-500 uppercase">
            Checklist Técnico <span className="text-zinc-500 font-normal normal-case">({checklist.filter(i => i.status).length}/{checklist.length})</span>
          </p>

          <div className="space-y-2">
            {checklist.map(item => (
              <div key={item.key} className="bg-zinc-900 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-white text-sm font-medium flex-1">{item.label}</span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => atualizarItem(item.key, 'status', 'OK')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                        item.status === 'OK'
                          ? 'bg-green-500 text-white'
                          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                      }`}
                    >
                      OK
                    </button>
                    <button
                      type="button"
                      onClick={() => atualizarItem(item.key, 'status', 'NAO_OK')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                        item.status === 'NAO_OK'
                          ? 'bg-red-500 text-white'
                          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                      }`}
                    >
                      Não OK
                    </button>
                  </div>
                </div>

                {item.status === 'NAO_OK' && (
                  <input
                    type="text"
                    placeholder="Descreva o problema... (obrigatório)"
                    value={item.obs}
                    onChange={e => atualizarItem(item.key, 'obs', e.target.value)}
                    className="w-full bg-zinc-800 border border-red-500/40 text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-red-500 placeholder-zinc-500"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Assinatura do cliente */}
        <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold tracking-widest text-orange-500 uppercase">
              Assinatura do Cliente <span className="text-red-400">*</span>
            </p>
            <button
              type="button"
              onClick={() => sigClienteRef.current?.clear()}
              className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 border border-zinc-700 rounded"
            >
              Limpar
            </button>
          </div>
          <p className="text-zinc-400 text-sm">{venda.cliente?.nome}</p>
          <div className="bg-white rounded-lg overflow-hidden" style={{ touchAction: 'none' }}>
            <SignatureCanvas
              ref={sigClienteRef}
              penColor="#000"
              canvasProps={{ className: 'w-full', height: 160, style: { width: '100%', display: 'block' } }}
            />
          </div>
        </div>

        {/* Assinatura do vendedor */}
        <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold tracking-widest text-orange-500 uppercase">
              Assinatura do Vendedor <span className="text-red-400">*</span>
            </p>
            <button
              type="button"
              onClick={() => sigVendedorRef.current?.clear()}
              className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 border border-zinc-700 rounded"
            >
              Limpar
            </button>
          </div>
          <p className="text-zinc-400 text-sm">{venda.vendedor?.nome}</p>
          <div className="bg-white rounded-lg overflow-hidden" style={{ touchAction: 'none' }}>
            <SignatureCanvas
              ref={sigVendedorRef}
              penColor="#000"
              canvasProps={{ className: 'w-full', height: 160, style: { width: '100%', display: 'block' } }}
            />
          </div>
        </div>

        {/* Assinatura do entregador — opcional */}
        <div className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
                Assinatura do Entregador <span className="text-zinc-600 font-normal normal-case">(opcional)</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => { sigEntregadorRef.current?.clear(); }}
              className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 border border-zinc-700 rounded"
            >
              Limpar
            </button>
          </div>
          <input
            type="text"
            placeholder="Nome do entregador (opcional)"
            value={nomeEntregador}
            onChange={e => setNomeEntregador(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:border-zinc-500 placeholder-zinc-600"
          />
          <div className="bg-white rounded-lg overflow-hidden" style={{ touchAction: 'none' }}>
            <SignatureCanvas
              ref={sigEntregadorRef}
              penColor="#000"
              canvasProps={{ className: 'w-full', height: 120, style: { width: '100%', display: 'block' } }}
            />
          </div>
        </div>

        {/* Erro */}
        {erro && (
          <div className="bg-red-500/15 border border-red-500/40 rounded-xl p-4 text-red-400 text-sm">
            {erro}
          </div>
        )}

        {/* Botão finalizar */}
        <div className="pb-6">
          <button
            onClick={finalizar}
            disabled={salvando}
            className="w-full py-4 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold rounded-xl text-base transition-colors"
          >
            {salvando ? 'Finalizando...' : 'Finalizar Check-in e Concluir Venda'}
          </button>
        </div>

      </div>
    </div>
  );
}
