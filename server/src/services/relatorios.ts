import { prisma } from '../index.js';
import ExcelJS from 'exceljs';
import { sendEmail } from './email.js';

export type TipoRelatorio = 'FINANCEIRO' | 'COMERCIAL' | 'GERAL';
export type PeriodoRelatorio = 'SEMANAL' | 'MENSAL';

// Mapeamento exato: cada role recebe UM tipo de relatório
// ADMIN_GERAL  = Diretores e sócios → Relatório Geral (visão completa)
// ADMIN_FINANCEIRO = Diretor Financeiro → Relatório Financeiro
// ADMIN_REDE   = Diretor Comercial → Relatório Comercial
const ROLE_RELATORIO_MAP: Record<string, TipoRelatorio> = {
  ADMIN_GERAL:       'GERAL',
  ADMIN_FINANCEIRO:  'FINANCEIRO',
  ADMIN_REDE:        'COMERCIAL',
};

export function tipoRelatorioParaRole(role: string): TipoRelatorio[] {
  const tipo = ROLE_RELATORIO_MAP[role];
  return tipo ? [tipo] : [];
}

async function coletarDadosFinanceiros(inicio: Date, fim: Date, lojaId?: number) {
  const where: any = {
    createdAt: { gte: inicio, lte: fim }
  };
  if (lojaId) where.lojaId = lojaId;

  const [contasReceberTotal, contasReceberVencidas, contasPagarTotal, contasPagarVencidas, recebimentos, pagamentos] = await Promise.all([
    prisma.parcelaContaReceber.aggregate({
      _sum: { valor: true },
      where: { ...where, status: 'PENDENTE' }
    }),
    prisma.parcelaContaReceber.aggregate({
      _sum: { valor: true },
      where: { ...where, status: 'PENDENTE', dataVencimento: { lt: new Date() } }
    }),
    prisma.parcelaContaPagar.aggregate({
      _sum: { valor: true },
      where: { ...where, status: 'PENDENTE' }
    }),
    prisma.parcelaContaPagar.aggregate({
      _sum: { valor: true },
      where: { ...where, status: 'PENDENTE', dataVencimento: { lt: new Date() } }
    }),
    prisma.recebimento.aggregate({
      _sum: { valor: true },
      where: { createdAt: { gte: inicio, lte: fim } }
    }),
    prisma.pagamento.aggregate({
      _sum: { valor: true },
      where: { createdAt: { gte: inicio, lte: fim } }
    })
  ]);

  return {
    aReceber: Number(contasReceberTotal._sum.valor || 0),
    aReceberVencido: Number(contasReceberVencidas._sum.valor || 0),
    aPagar: Number(contasPagarTotal._sum.valor || 0),
    aPagarVencido: Number(contasPagarVencidas._sum.valor || 0),
    totalRecebido: Number(recebimentos._sum.valor || 0),
    totalPago: Number(pagamentos._sum.valor || 0),
    saldoLiquido: Number(recebimentos._sum.valor || 0) - Number(pagamentos._sum.valor || 0)
  };
}

async function coletarDadosComerciais(inicio: Date, fim: Date, lojaId?: number) {
  const whereVenda: any = {
    createdAt: { gte: inicio, lte: fim },
    tipo: 'VENDA',
    deletedAt: null
  };
  if (lojaId) whereVenda.lojaId = lojaId;

  const whereOS: any = {
    createdAt: { gte: inicio, lte: fim }
  };
  if (lojaId) whereOS.lojaId = lojaId;

  const [vendas, orcamentos, ordensServico, ranking] = await Promise.all([
    prisma.venda.findMany({
      where: whereVenda,
      include: {
        loja: { select: { nomeFantasia: true } },
        vendedor: { select: { nome: true } },
        cliente: { select: { nome: true } }
      },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.venda.count({
      where: { ...whereVenda, tipo: 'ORCAMENTO' }
    }),
    prisma.ordemServico.findMany({
      where: whereOS,
      include: { loja: { select: { nomeFantasia: true } } }
    }),
    prisma.venda.groupBy({
      by: ['vendedorId'],
      _count: { id: true },
      _sum: { valorTotal: true },
      where: whereVenda,
      orderBy: { _sum: { valorTotal: 'desc' } },
      take: 10
    })
  ]);

  const totalVendas = vendas.reduce((acc, v) => acc + Number(v.valorTotal || 0), 0);
  const totalOS = ordensServico.reduce((acc, o) => acc + Number((o as any).total || (o as any).valorTotal || 0), 0);

  const rankingComNome = await Promise.all(
    ranking.map(async (r) => {
      if (!r.vendedorId) return null;
      const user = await prisma.user.findUnique({ where: { id: r.vendedorId }, select: { nome: true } });
      return {
        nome: user?.nome || 'Desconhecido',
        qtd: r._count?.id || 0,
        total: Number(r._sum?.valorTotal || 0)
      };
    })
  );

  const porLoja = vendas.reduce((acc: any, v) => {
    const loja = v.loja?.nomeFantasia || 'Sem loja';
    if (!acc[loja]) acc[loja] = { qtd: 0, total: 0 };
    acc[loja].qtd++;
    acc[loja].total += Number(v.valorTotal || 0);
    return acc;
  }, {});

  return {
    totalVendas: vendas.length,
    totalFaturado: totalVendas,
    totalOrcamentos: orcamentos,
    taxaConversao: orcamentos > 0 ? ((vendas.length / (vendas.length + orcamentos)) * 100).toFixed(1) : '0',
    totalOS: ordensServico.length,
    faturamentoOS: totalOS,
    faturamentoTotal: totalVendas + totalOS,
    ranking: rankingComNome.filter(Boolean),
    porLoja,
    vendas: (vendas as any[]).slice(0, 20)
  };
}

async function coletarDadosEstoque(lojaId?: number) {
  const where: any = {};
  if (lojaId) where.lojaId = lojaId;

  const [estoqueTotal, estoqueZerado, unidades] = await Promise.all([
    prisma.estoque.aggregate({
      _sum: { quantidade: true, custoMedio: true },
      where
    }),
    prisma.estoque.count({ where: { ...where, quantidade: { lte: 0 } } }),
    prisma.unidadeFisica.count({ where: { ...where, status: 'ESTOQUE' } })
  ]);

  const itensEstoque = await prisma.estoque.findMany({
    where,
    include: {
      produto: { select: { nome: true, tipo: true } },
      loja: { select: { nomeFantasia: true } }
    },
    orderBy: { quantidade: 'asc' },
    take: 50
  });

  const itensCriticos = itensEstoque.filter(e => e.quantidade <= 2);

  return {
    totalItens: itensEstoque.length,
    itensZerados: estoqueZerado,
    itensCriticos: itensCriticos.length,
    unidadesEmEstoque: unidades,
    valorEstimadoEstoque: itensEstoque.reduce((acc, e) => acc + (Number(e.custoMedio || 0) * e.quantidade), 0),
    alertasCriticos: itensCriticos.map(e => `${e.produto.nome} (${e.loja?.nomeFantasia || ''}): ${e.quantidade} un.`)
  };
}

function gerarAlertas(dados: any, tipo: TipoRelatorio): string[] {
  const alertas: string[] = [];

  if (tipo === 'FINANCEIRO' || tipo === 'GERAL') {
    const fin = dados.financeiro;
    if (fin.aReceberVencido > 0) alertas.push(`⚠️ R$ ${fin.aReceberVencido.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} em contas a receber VENCIDAS`);
    if (fin.aPagarVencido > 0) alertas.push(`🔴 R$ ${fin.aPagarVencido.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} em contas a pagar VENCIDAS`);
    if (fin.saldoLiquido < 0) alertas.push(`🔴 Fluxo de caixa NEGATIVO no período: R$ ${Math.abs(fin.saldoLiquido).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }

  if (tipo === 'COMERCIAL' || tipo === 'GERAL') {
    const com = dados.comercial;
    if (parseFloat(com.taxaConversao) < 30) alertas.push(`⚠️ Taxa de conversão de orçamentos baixa: ${com.taxaConversao}%`);
    if (com.totalVendas === 0) alertas.push('🔴 Nenhuma venda registrada no período');
  }

  if (tipo === 'GERAL') {
    const est = dados.estoque;
    if (est.itensCriticos > 0) alertas.push(`⚠️ ${est.itensCriticos} produto(s) com estoque crítico (≤2 unidades)`);
    if (est.itensZerados > 0) alertas.push(`🔴 ${est.itensZerados} produto(s) com estoque zerado`);
  }

  return alertas;
}

function gerarSugestoes(dados: any, tipo: TipoRelatorio): string[] {
  const sugestoes: string[] = [];

  if (tipo === 'FINANCEIRO' || tipo === 'GERAL') {
    const fin = dados.financeiro;
    if (fin.aReceberVencido > 0) sugestoes.push('💡 Acione a régua de cobrança para os clientes com parcelas vencidas');
    if (fin.saldoLiquido > 0) sugestoes.push('💡 Saldo positivo — considere antecipar pagamentos a fornecedores para negociar descontos');
    if (fin.aPagarVencido > 0) sugestoes.push('💡 Priorize a regularização das contas a pagar vencidas para evitar juros e multas');
  }

  if (tipo === 'COMERCIAL' || tipo === 'GERAL') {
    const com = dados.comercial;
    if (parseFloat(com.taxaConversao) < 50) sugestoes.push('💡 Revise o script de vendas — muitos orçamentos não estão sendo convertidos');
    if (com.totalVendas > 0) sugestoes.push('💡 Parabenize os top vendedores e compartilhe as melhores práticas com o time');
    if (com.totalOS > 0) sugestoes.push('💡 As ordens de serviço representam receita recorrente — incentive o pós-venda de revisões');
  }

  if (tipo === 'GERAL') {
    const est = dados.estoque;
    if (est.itensCriticos > 0) sugestoes.push('💡 Emita pedidos de compra para os itens com estoque crítico antes de zerar');
  }

  return sugestoes;
}

function gerarHTMLRelatorio(tipo: TipoRelatorio, periodo: PeriodoRelatorio, dados: any, alertas: string[], sugestoes: string[], nomeDestinatario: string, inicio: Date, fim: Date): string {
  const tipoLabel = { FINANCEIRO: 'Financeiro', COMERCIAL: 'Comercial', GERAL: 'Geral' }[tipo];
  const periodoLabel = { SEMANAL: 'Semanal', MENSAL: 'Mensal' }[periodo];
  const dataFmt = (d: Date) => d.toLocaleDateString('pt-BR');
  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const corPrimaria = '#f97316';
  const corFundo = '#09090b';
  const corCard = '#18181b';
  const corBorda = '#27272a';

  const cardStyle = `background:${corCard};border:1px solid ${corBorda};border-radius:8px;padding:16px;margin-bottom:16px;`;
  const kpiStyle = `background:${corCard};border:1px solid ${corBorda};border-radius:8px;padding:12px;text-align:center;`;
  const thStyle = `background:#27272a;color:#e4e4e7;padding:8px 12px;text-align:left;font-size:12px;text-transform:uppercase;`;
  const tdStyle = `padding:8px 12px;border-bottom:1px solid #27272a;color:#d4d4d8;font-size:13px;`;

  let secaoFinanceiro = '';
  if ((tipo === 'FINANCEIRO' || tipo === 'GERAL') && dados.financeiro) {
    const f = dados.financeiro;
    secaoFinanceiro = `
    <div style="${cardStyle}">
      <h3 style="color:${corPrimaria};margin:0 0 12px 0;font-size:16px;">💰 Indicadores Financeiros</h3>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:12px;">
        <div style="${kpiStyle}"><div style="font-size:11px;color:#71717a;margin-bottom:4px;">A Receber (Pendente)</div><div style="font-size:18px;font-weight:bold;color:#22c55e;">${brl(f.aReceber)}</div></div>
        <div style="${kpiStyle}"><div style="font-size:11px;color:#71717a;margin-bottom:4px;">A Pagar (Pendente)</div><div style="font-size:18px;font-weight:bold;color:#ef4444;">${brl(f.aPagar)}</div></div>
        <div style="${kpiStyle}"><div style="font-size:11px;color:#71717a;margin-bottom:4px;">Recebido no Período</div><div style="font-size:18px;font-weight:bold;color:#22c55e;">${brl(f.totalRecebido)}</div></div>
        <div style="${kpiStyle}"><div style="font-size:11px;color:#71717a;margin-bottom:4px;">Pago no Período</div><div style="font-size:18px;font-weight:bold;color:#ef4444;">${brl(f.totalPago)}</div></div>
      </div>
      <div style="${kpiStyle};border:1px solid ${f.saldoLiquido >= 0 ? '#22c55e' : '#ef4444'};">
        <div style="font-size:11px;color:#71717a;margin-bottom:4px;">Saldo Líquido do Período</div>
        <div style="font-size:22px;font-weight:bold;color:${f.saldoLiquido >= 0 ? '#22c55e' : '#ef4444'};">${brl(f.saldoLiquido)}</div>
      </div>
      ${f.aReceberVencido > 0 ? `<p style="color:#ef4444;font-size:12px;margin:8px 0 0 0;">⚠️ Inadimplência em aberto: ${brl(f.aReceberVencido)}</p>` : ''}
    </div>`;
  }

  let secaoComercial = '';
  if ((tipo === 'COMERCIAL' || tipo === 'GERAL') && dados.comercial) {
    const c = dados.comercial;
    const rankRows = (c.ranking || []).map((r: any, i: number) => `
      <tr><td style="${tdStyle}">${i + 1}. ${r?.nome || '-'}</td><td style="${tdStyle}">${r?.qtd || 0} vendas</td><td style="${tdStyle}">${brl(r?.total || 0)}</td></tr>
    `).join('');

    const lojaRows = Object.entries(c.porLoja || {}).map(([loja, val]: any) => `
      <tr><td style="${tdStyle}">${loja}</td><td style="${tdStyle}">${val.qtd}</td><td style="${tdStyle}">${brl(val.total)}</td></tr>
    `).join('');

    secaoComercial = `
    <div style="${cardStyle}">
      <h3 style="color:${corPrimaria};margin:0 0 12px 0;font-size:16px;">📊 Métricas Comerciais</h3>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:12px;">
        <div style="${kpiStyle}"><div style="font-size:11px;color:#71717a;margin-bottom:4px;">Vendas Realizadas</div><div style="font-size:22px;font-weight:bold;color:#f97316;">${c.totalVendas}</div></div>
        <div style="${kpiStyle}"><div style="font-size:11px;color:#71717a;margin-bottom:4px;">Faturamento Total</div><div style="font-size:18px;font-weight:bold;color:#22c55e;">${brl(c.faturamentoTotal)}</div></div>
        <div style="${kpiStyle}"><div style="font-size:11px;color:#71717a;margin-bottom:4px;">Orçamentos Gerados</div><div style="font-size:18px;font-weight:bold;color:#a78bfa;">${c.totalOrcamentos}</div></div>
        <div style="${kpiStyle}"><div style="font-size:11px;color:#71717a;margin-bottom:4px;">Taxa de Conversão</div><div style="font-size:18px;font-weight:bold;color:${parseFloat(c.taxaConversao) >= 50 ? '#22c55e' : '#f59e0b'};">${c.taxaConversao}%</div></div>
        <div style="${kpiStyle}"><div style="font-size:11px;color:#71717a;margin-bottom:4px;">Ordens de Serviço</div><div style="font-size:18px;font-weight:bold;color:#38bdf8;">${c.totalOS}</div></div>
        <div style="${kpiStyle}"><div style="font-size:11px;color:#71717a;margin-bottom:4px;">Receita de OS</div><div style="font-size:18px;font-weight:bold;color:#22c55e;">${brl(c.faturamentoOS)}</div></div>
      </div>
      ${rankRows ? `<h4 style="color:#e4e4e7;margin:16px 0 8px 0;font-size:14px;">🏆 Ranking de Vendedores</h4>
      <table style="width:100%;border-collapse:collapse;"><thead><tr>
        <th style="${thStyle}">Vendedor</th><th style="${thStyle}">Qtd</th><th style="${thStyle}">Total</th>
      </tr></thead><tbody>${rankRows}</tbody></table>` : ''}
      ${lojaRows ? `<h4 style="color:#e4e4e7;margin:16px 0 8px 0;font-size:14px;">🏪 Performance por Loja</h4>
      <table style="width:100%;border-collapse:collapse;"><thead><tr>
        <th style="${thStyle}">Loja</th><th style="${thStyle}">Vendas</th><th style="${thStyle}">Total</th>
      </tr></thead><tbody>${lojaRows}</tbody></table>` : ''}
    </div>`;
  }

  let secaoEstoque = '';
  if (tipo === 'GERAL' && dados.estoque) {
    const e = dados.estoque;
    secaoEstoque = `
    <div style="${cardStyle}">
      <h3 style="color:${corPrimaria};margin:0 0 12px 0;font-size:16px;">📦 Estoque</h3>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
        <div style="${kpiStyle}"><div style="font-size:11px;color:#71717a;margin-bottom:4px;">Motos em Estoque</div><div style="font-size:22px;font-weight:bold;color:#f97316;">${e.unidadesEmEstoque}</div></div>
        <div style="${kpiStyle}"><div style="font-size:11px;color:#71717a;margin-bottom:4px;">Valor Est. Estoque</div><div style="font-size:16px;font-weight:bold;color:#22c55e;">${brl(e.valorEstimadoEstoque)}</div></div>
        <div style="${kpiStyle}"><div style="font-size:11px;color:#71717a;margin-bottom:4px;">Itens Críticos (≤2)</div><div style="font-size:22px;font-weight:bold;color:#f59e0b;">${e.itensCriticos}</div></div>
        <div style="${kpiStyle}"><div style="font-size:11px;color:#71717a;margin-bottom:4px;">Itens Zerados</div><div style="font-size:22px;font-weight:bold;color:#ef4444;">${e.itensZerados}</div></div>
      </div>
      ${e.alertasCriticos.length > 0 ? `<div style="margin-top:12px;padding:10px;background:#292524;border-radius:6px;border-left:3px solid #f59e0b;">
        <p style="color:#f59e0b;font-size:12px;margin:0 0 6px 0;font-weight:bold;">Itens com estoque crítico:</p>
        ${e.alertasCriticos.map((a: string) => `<p style="color:#d4d4d8;font-size:12px;margin:2px 0;">• ${a}</p>`).join('')}
      </div>` : ''}
    </div>`;
  }

  const alertasHTML = alertas.length > 0 ? `
    <div style="${cardStyle};border-left:3px solid #ef4444;">
      <h3 style="color:#ef4444;margin:0 0 10px 0;font-size:15px;">🚨 Alertas</h3>
      ${alertas.map(a => `<p style="color:#fca5a5;font-size:13px;margin:4px 0;">• ${a}</p>`).join('')}
    </div>` : '';

  const sugestoesHTML = sugestoes.length > 0 ? `
    <div style="${cardStyle};border-left:3px solid #22c55e;">
      <h3 style="color:#22c55e;margin:0 0 10px 0;font-size:15px;">💡 Sugestões de Melhoria</h3>
      ${sugestoes.map(s => `<p style="color:#86efac;font-size:13px;margin:4px 0;">${s}</p>`).join('')}
    </div>` : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#f4f4f5;margin:0;padding:20px;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;">
    
    <div style="background:linear-gradient(135deg,#1c1917,#292524);border-radius:12px 12px 0 0;padding:24px;text-align:center;">
      <div style="font-size:28px;font-weight:bold;color:${corPrimaria};letter-spacing:1px;">TM IMPORTS</div>
      <div style="color:#a8a29e;font-size:13px;margin-top:4px;">Sistema ERP — Relatório ${tipoLabel} ${periodoLabel}</div>
    </div>
    
    <div style="background:#1c1917;padding:16px 24px;border-bottom:1px solid #27272a;">
      <p style="color:#d6d3d1;margin:0;font-size:14px;">Olá, <strong style="color:#fff;">${nomeDestinatario}</strong> 👋</p>
      <p style="color:#a8a29e;margin:6px 0 0 0;font-size:13px;">
        Período: <strong>${dataFmt(inicio)}</strong> a <strong>${dataFmt(fim)}</strong> &nbsp;|&nbsp;
        Gerado em: ${new Date().toLocaleString('pt-BR')}
      </p>
    </div>

    <div style="background:${corFundo};padding:20px 24px;">
      ${alertasHTML}
      ${secaoFinanceiro}
      ${secaoComercial}
      ${secaoEstoque}
      ${sugestoesHTML}
    </div>

    <div style="background:#1c1917;border-radius:0 0 12px 12px;padding:16px 24px;text-align:center;border-top:1px solid #27272a;">
      <p style="color:#71717a;font-size:11px;margin:0;">Este relatório foi gerado automaticamente pelo Sistema ERP TM Imports.</p>
      <p style="color:#71717a;font-size:11px;margin:4px 0 0 0;">Não responda este email. Em caso de dúvidas, acesse o sistema.</p>
    </div>
  </div>
</body>
</html>`;
}

async function gerarPlanilhaXLSX(tipo: TipoRelatorio, dados: any, periodo: PeriodoRelatorio, inicio: Date, fim: Date): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const dataFmt = (d: Date) => d.toLocaleDateString('pt-BR');

  const addSheet = (nome: string, rows: any[][]) => {
    const sheet = workbook.addWorksheet(nome);
    rows.forEach(row => sheet.addRow(row));
  };

  addSheet('Capa', [
    ['TM IMPORTS — Relatório ERP'],
    [`Tipo: ${tipo}`, `Período: ${periodo}`],
    [`De: ${dataFmt(inicio)}`, `Até: ${dataFmt(fim)}`],
    [`Gerado em: ${new Date().toLocaleString('pt-BR')}`],
  ]);

  if ((tipo === 'FINANCEIRO' || tipo === 'GERAL') && dados.financeiro) {
    const f = dados.financeiro;
    addSheet('Financeiro', [
      ['Indicador', 'Valor (R$)'],
      ['A Receber (Pendente)', f.aReceber],
      ['A Receber Vencido', f.aReceberVencido],
      ['A Pagar (Pendente)', f.aPagar],
      ['A Pagar Vencido', f.aPagarVencido],
      ['Total Recebido no Período', f.totalRecebido],
      ['Total Pago no Período', f.totalPago],
      ['Saldo Líquido', f.saldoLiquido],
    ]);
  }

  if ((tipo === 'COMERCIAL' || tipo === 'GERAL') && dados.comercial) {
    const c = dados.comercial;
    addSheet('Vendas_Resumo', [
      ['Indicador', 'Valor'],
      ['Total de Vendas', c.totalVendas],
      ['Faturamento de Vendas', c.totalFaturado],
      ['Total de Orçamentos', c.totalOrcamentos],
      ['Taxa de Conversão (%)', c.taxaConversao],
      ['Ordens de Serviço', c.totalOS],
      ['Faturamento de OS', c.faturamentoOS],
      ['Faturamento Total', c.faturamentoTotal],
    ]);

    if (c.ranking?.length) {
      addSheet('Ranking_Vendedores', [
        ['Posição', 'Vendedor', 'Qtd. Vendas', 'Total (R$)'],
        ...c.ranking.filter(Boolean).map((r: any, i: number) => [i + 1, r.nome, r.qtd, r.total])
      ]);
    }

    if (Object.keys(c.porLoja || {}).length) {
      addSheet('Por_Loja', [
        ['Loja', 'Qtd. Vendas', 'Total (R$)'],
        ...Object.entries(c.porLoja).map(([l, v]: any) => [l, v.qtd, v.total])
      ]);
    }

    if (c.vendas?.length) {
      addSheet('Vendas_Detalhadas', [
        ['Data', 'Cliente', 'Vendedor', 'Loja', 'Total (R$)'],
        ...c.vendas.map((v: any) => [
          new Date(v.createdAt).toLocaleDateString('pt-BR'),
          v.cliente?.nome || '-',
          v.vendedor?.nome || '-',
          v.loja?.nomeFantasia || '-',
          Number(v.valorTotal || v.total || 0)
        ])
      ]);
    }
  }

  if (tipo === 'GERAL' && dados.estoque) {
    const e = dados.estoque;
    addSheet('Estoque', [
      ['Indicador', 'Valor'],
      ['Motos em Estoque (Unidades)', e.unidadesEmEstoque],
      ['Itens com Estoque Crítico (≤2)', e.itensCriticos],
      ['Itens Zerados', e.itensZerados],
      ['Valor Estimado (R$)', e.valorEstimadoEstoque],
      [],
      ['Alertas de Estoque Crítico'],
      ...e.alertasCriticos.map((a: string) => [a])
    ]);
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export async function gerarEEnviarRelatorio(tipo: TipoRelatorio, periodo: PeriodoRelatorio, destinatarios: { nome: string; email: string; lojaId?: number }[]) {
  const fim = new Date();
  const inicio = new Date();
  if (periodo === 'SEMANAL') {
    inicio.setDate(inicio.getDate() - 7);
  } else {
    inicio.setMonth(inicio.getMonth() - 1);
    inicio.setDate(1);
    fim.setDate(0);
  }

  console.log(`[RELATORIO] Gerando relatório ${tipo} ${periodo} para ${destinatarios.length} destinatário(s)`);

  const dadosBase: any = {};

  if (tipo === 'FINANCEIRO' || tipo === 'GERAL') {
    dadosBase.financeiro = await coletarDadosFinanceiros(inicio, fim);
  }
  if (tipo === 'COMERCIAL' || tipo === 'GERAL') {
    dadosBase.comercial = await coletarDadosComerciais(inicio, fim);
  }
  if (tipo === 'GERAL') {
    dadosBase.estoque = await coletarDadosEstoque();
  }

  const resultados: { email: string; ok: boolean }[] = [];

  for (const dest of destinatarios) {
    const dadosDest = { ...dadosBase };

    if (dest.lojaId && tipo === 'COMERCIAL') {
      dadosDest.comercial = await coletarDadosComerciais(inicio, fim, dest.lojaId);
    }

    const alertas = gerarAlertas(dadosDest, tipo);
    const sugestoes = gerarSugestoes(dadosDest, tipo);
    const html = gerarHTMLRelatorio(tipo, periodo, dadosDest, alertas, sugestoes, dest.nome, inicio, fim);

    let attachments: any[] = [];
    try {
      const xlsxBuffer = await gerarPlanilhaXLSX(tipo, dadosDest, periodo, inicio, fim);
      const nomeArq = `relatorio-${tipo.toLowerCase()}-${periodo.toLowerCase()}-${inicio.toISOString().split('T')[0]}.xlsx`;
      attachments = [{ filename: nomeArq, content: xlsxBuffer, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }];
    } catch (e) {
      console.error('[RELATORIO] Erro ao gerar XLSX:', e);
    }

    const tipoLabel = { FINANCEIRO: 'Financeiro', COMERCIAL: 'Comercial', GERAL: 'Geral' }[tipo];
    const periodoLabel = { SEMANAL: 'Semanal', MENSAL: 'Mensal' }[periodo];
    const subject = `📊 TM Imports — Relatório ${tipoLabel} ${periodoLabel} | ${inicio.toLocaleDateString('pt-BR')} a ${fim.toLocaleDateString('pt-BR')}`;

    const ok = await sendEmail(dest.email, subject, html, attachments);
    resultados.push({ email: dest.email, ok });
  }

  return resultados;
}

export async function dispararRelatoriosPorRole(periodo: PeriodoRelatorio) {
  // Apenas os roles corporativos recebem relatórios:
  // ADMIN_GERAL → Geral | ADMIN_FINANCEIRO → Financeiro | ADMIN_REDE → Comercial
  const rolesDestinatarios = Object.keys(ROLE_RELATORIO_MAP);

  const usuarios = await prisma.user.findMany({
    where: { ativo: true, role: { in: rolesDestinatarios as any } },
    select: { id: true, nome: true, email: true, role: true, lojaId: true }
  });

  // Agrupar por tipo de relatório
  const grupos: Record<TipoRelatorio, typeof usuarios> = {
    GERAL: [],
    FINANCEIRO: [],
    COMERCIAL: []
  };

  for (const u of usuarios) {
    const tipo = ROLE_RELATORIO_MAP[u.role];
    if (tipo) grupos[tipo].push(u);
  }

  const resultados: any[] = [];

  for (const tipo of (['GERAL', 'FINANCEIRO', 'COMERCIAL'] as TipoRelatorio[])) {
    const dest = grupos[tipo];
    if (dest.length > 0) {
      const r = await gerarEEnviarRelatorio(tipo, periodo, dest.map(u => ({
        nome: u.nome,
        email: u.email,
        lojaId: u.lojaId || undefined
      })));
      resultados.push({ tipo, resultados: r });
    }
  }

  const total = Object.values(grupos).reduce((a, g) => a + g.length, 0);
  console.log(`[RELATORIO] Despacho ${periodo} concluído. Total destinatários: ${total}`);
  return resultados;
}
