import { Router } from 'express';
import { prisma } from '../index.js';
import { verifyToken, AuthRequest } from '../middleware/auth.js';
import { InventoryService } from '../services/InventoryService.js';
import { sendEmail } from '../services/email.js';
import { criarDisparo } from '../services/whatsapp.js';
import { criarContasReceber, criarGarantiasVenda } from './vendas.js';
import { registrarLog, obterIp } from '../services/logService.js';

const router = Router();
router.use(verifyToken);

// Roles globais que podem acessar qualquer loja/grupo
const ROLES_GLOBAIS = new Set(['SUPER_ADMIN', 'ADMIN_GERAL', 'ADMIN_REDE', 'ADMIN_FINANCEIRO', 'ADMIN_COMERCIAL']);

// Verifica se o usuário autenticado tem acesso à venda pelo grupo da loja
function verificarAcessoVenda(req: AuthRequest, vendaLojaGrupoId: number | null | undefined): boolean {
  const role = req.user?.role as string;
  if (ROLES_GLOBAIS.has(role)) return true;
  const userGrupoId = req.user?.grupoId;
  if (!userGrupoId || !vendaLojaGrupoId) return false;
  return vendaLojaGrupoId === userGrupoId;
}

function gerarSerie(prefixo: string, vendaId: number): string {
  const ano = new Date().getFullYear();
  return `${prefixo}-${ano}-${vendaId.toString().padStart(6, '0')}`;
}

function buildEmailVenda(venda: any, checkin: any): string {
  const itensHtml = (venda.itens || []).map((it: any) => {
    const nome = it.produto?.nome || it.servico?.nome || '-';
    const uf = it.unidadeFisica;
    const detalhe = uf ? ` (Chassi: ${uf.chassi || '-'} · Motor: ${uf.codigoMotor || '-'} · Cor: ${uf.cor || '-'})` : '';
    return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${nome}${detalhe}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">R$ ${Number(it.precoUnitario).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;color:#1a1a1a;background:#f5f5f5;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <div style="background:#111;padding:20px 30px;display:flex;align-items:center;justify-content:space-between">
    <span style="font-size:20px;font-weight:900;color:#f97316">Tecle Motos</span>
    <span style="font-size:12px;color:#9ca3af">Comprovante de Venda</span>
  </div>
  <div style="height:4px;background:#f97316"></div>
  <div style="padding:24px 30px">
    <p style="font-size:18px;font-weight:700;margin:0 0 4px">Olá, ${venda.cliente?.nome?.split(' ')[0] || 'Cliente'}! 🎉</p>
    <p style="color:#555;margin:0 0 20px">Sua compra foi concluída com sucesso. Abaixo os detalhes:</p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px">
      <tr style="background:#f8f8f8"><td style="padding:6px 10px;font-weight:600;color:#555;width:140px">Nº da Venda</td><td style="padding:6px 10px">#${String(venda.id).padStart(5,'0')}</td></tr>
      <tr><td style="padding:6px 10px;font-weight:600;color:#555">Nº do Laudo</td><td style="padding:6px 10px">${checkin?.numeroSerie || gerarSerie('LDS', venda.id)}</td></tr>
      <tr style="background:#f8f8f8"><td style="padding:6px 10px;font-weight:600;color:#555">Data</td><td style="padding:6px 10px">${new Date(venda.createdAt).toLocaleDateString('pt-BR')}</td></tr>
      <tr><td style="padding:6px 10px;font-weight:600;color:#555">Loja</td><td style="padding:6px 10px">${venda.loja?.nomeFantasia || '-'}</td></tr>
      <tr style="background:#f8f8f8"><td style="padding:6px 10px;font-weight:600;color:#555">Vendedor</td><td style="padding:6px 10px">${venda.vendedor?.nome || '-'}</td></tr>
      <tr><td style="padding:6px 10px;font-weight:600;color:#555">Pagamento</td><td style="padding:6px 10px">${venda.formaPagamento}</td></tr>
      <tr style="background:#f8f8f8"><td style="padding:6px 10px;font-weight:600;color:#555">Total</td><td style="padding:6px 10px;font-weight:700;color:#16a34a">R$ ${Number(venda.valorTotal).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td></tr>
    </table>

    <p style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#f97316;margin:0 0 8px">Itens</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
      <thead><tr style="background:#111;color:#fff"><th style="padding:7px 10px;text-align:left">Produto</th><th style="padding:7px 10px;text-align:right">Valor</th></tr></thead>
      <tbody>${itensHtml}</tbody>
    </table>

    <div style="background:#fffbf5;border-left:4px solid #f97316;padding:12px 16px;font-size:12px;color:#555;margin-bottom:20px">
      Seus documentos (Recibo, Laudo de Saída e Manual) estão disponíveis para consulta no sistema.<br>
      <strong>Nº do Laudo:</strong> ${checkin?.numeroSerie || gerarSerie('LDS', venda.id)}
    </div>

    <p style="font-size:11px;color:#aaa;text-align:center">Tecle Motos · Gerado em ${new Date().toLocaleString('pt-BR')}</p>
  </div>
</div>
</body></html>`;
}

// ── GET /api/checkin/:vendaId ─────────────────────────────────────────────────
router.get('/:vendaId', async (req: AuthRequest, res) => {
  try {
    const vendaId = Number(req.params.vendaId);
    const venda = await prisma.venda.findUnique({
      where: { id: vendaId },
      include: {
        cliente: true,
        vendedor: { select: { id: true, nome: true } },
        loja: true,
        itens: { include: { produto: true, servico: true, unidadeFisica: true } },
        checkin: true,
        documentos: true,
      }
    });

    if (!venda) return res.status(404).json({ error: 'Venda não encontrada' });
    if (!verificarAcessoVenda(req, venda.loja?.grupoId)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if (venda.tipo !== 'VENDA') return res.status(400).json({ error: 'Orçamentos não têm check-in' });

    res.json(venda);
  } catch (err) {
    console.error('[CHECKIN] GET erro:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── POST /api/checkin/:vendaId ── salva rascunho ──────────────────────────────
router.post('/:vendaId', async (req: AuthRequest, res) => {
  try {
    const vendaId = Number(req.params.vendaId);
    const { checklistJson, quilometragem, assinaturaCliente, assinaturaVendedor,
            assinaturaEntregador, nomeCliente, nomeVendedor, nomeEntregador } = req.body;

    // Verificar acesso antes de qualquer operação
    const vendaParaCheck = await prisma.venda.findUnique({
      where: { id: vendaId },
      include: { loja: { select: { grupoId: true } } }
    });
    if (!vendaParaCheck) return res.status(404).json({ error: 'Venda não encontrada' });
    if (!verificarAcessoVenda(req, vendaParaCheck.loja?.grupoId)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const existing = await prisma.vendaCheckin.findUnique({ where: { vendaId } });
    const now = new Date();

    if (existing) {
      const updated = await prisma.vendaCheckin.update({
        where: { vendaId },
        data: { checklistJson, quilometragem: quilometragem ? Number(quilometragem) : null,
                assinaturaCliente, assinaturaVendedor, assinaturaEntregador,
                nomeCliente, nomeVendedor, nomeEntregador: nomeEntregador || null, updatedAt: now }
      });
      return res.json(updated);
    }

    const numeroSerie = gerarSerie('LDS', vendaId);
    const created = await prisma.vendaCheckin.create({
      data: { vendaId, numeroSerie, checklistJson,
              quilometragem: quilometragem ? Number(quilometragem) : null,
              assinaturaCliente, assinaturaVendedor, assinaturaEntregador,
              nomeCliente, nomeVendedor, nomeEntregador: nomeEntregador || null,
              createdAt: now, updatedAt: now }
    });
    res.status(201).json(created);
  } catch (err) {
    console.error('[CHECKIN] POST erro:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── PUT /api/checkin/:vendaId/finalizar ───────────────────────────────────────
router.put('/:vendaId/finalizar', async (req: AuthRequest, res) => {
  try {
    const vendaId = Number(req.params.vendaId);
    const { checklistJson, quilometragem, assinaturaCliente, assinaturaVendedor,
            assinaturaEntregador, nomeCliente, nomeVendedor, nomeEntregador,
            assinadoClienteAt, assinadoVendedorAt } = req.body;

    // ── Validações ────────────────────────────────────────────────────────────
    if (!assinaturaCliente || assinaturaCliente.length < 10) {
      return res.status(400).json({ error: 'Assinatura do cliente é obrigatória' });
    }
    if (!assinaturaVendedor || assinaturaVendedor.length < 10) {
      return res.status(400).json({ error: 'Assinatura do vendedor é obrigatória' });
    }

    if (checklistJson) {
      const items: { label: string; status: string; obs: string }[] = JSON.parse(checklistJson);
      for (const item of items) {
        if (!item.status) {
          return res.status(400).json({ error: `Item "${item.label}" não foi conferido` });
        }
        if (item.status === 'NAO_OK' && !item.obs?.trim()) {
          return res.status(400).json({ error: `Item "${item.label}" marcado como Não OK requer observação` });
        }
      }
    }

    // ── Carregar venda ────────────────────────────────────────────────────────
    const venda = await prisma.venda.findUnique({
      where: { id: vendaId },
      include: {
        itens: { include: { produto: true, unidadeFisica: true } },
        cliente: true,
        vendedor: { select: { id: true, nome: true } },
        loja: true,
      }
    });

    if (!venda) return res.status(404).json({ error: 'Venda não encontrada' });
    if (!verificarAcessoVenda(req, venda.loja?.grupoId)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    if ((venda as any).status !== 'PENDENTE_CHECKIN') {
      return res.status(400).json({ error: 'Esta venda já foi finalizada ou não está em check-in' });
    }

    // ── Salvar/atualizar checkin ───────────────────────────────────────────────
    const now = new Date();
    const numeroSerie = gerarSerie('LDS', vendaId);
    const checkinData = {
      checklistJson,
      quilometragem: Number(quilometragem),
      assinaturaCliente,
      assinaturaVendedor,
      nomeCliente:          nomeCliente || venda.cliente?.nome,
      nomeVendedor:         nomeVendedor || (venda.vendedor as any)?.nome,
      assinaturaEntregador: assinaturaEntregador || null,
      nomeEntregador:       nomeEntregador || null,
      assinadoClienteAt: assinadoClienteAt ? new Date(assinadoClienteAt) : now,
      assinadoVendedorAt: assinadoVendedorAt ? new Date(assinadoVendedorAt) : now,
      finalizadoAt: now,
      updatedAt: now,
    };

    const existingCheckin = await prisma.vendaCheckin.findUnique({ where: { vendaId } });
    const checkin = existingCheckin
      ? await prisma.vendaCheckin.update({ where: { vendaId }, data: checkinData })
      : await prisma.vendaCheckin.create({ data: { vendaId, numeroSerie, ...checkinData, createdAt: now } });

    // ── Baixa de estoque ──────────────────────────────────────────────────────
    const itensParaBaixa = venda.itens
      .filter(i => i.produtoId)
      .map(i => ({ produtoId: i.produtoId!, quantidade: i.quantidade, unidadeFisicaId: i.unidadeFisicaId || undefined }));

    if (itensParaBaixa.length > 0) {
      const resultadoBaixa = await InventoryService.processarBaixaVenda(
        vendaId, itensParaBaixa, venda.lojaId, req.user!.id
      );
      if (!resultadoBaixa.success) {
        return res.status(400).json({ error: `Erro na baixa de estoque: ${resultadoBaixa.error}` });
      }
    }

    // ── Caixa ─────────────────────────────────────────────────────────────────
    if (venda.formaPagamento !== 'FINANCIAMENTO') {
      await prisma.caixa.create({
        data: {
          lojaId: venda.lojaId,
          tipo: 'entrada',
          descricao: `Venda #${vendaId} (check-in concluído)`,
          valor: venda.valorTotal,
          formaPagamento: venda.formaPagamento,
          referencia: `venda_${vendaId}`
        }
      });
    }

    // ── Contas a Receber ──────────────────────────────────────────────────────
    await criarContasReceber({
      vendaId, lojaId: venda.lojaId, clienteId: venda.clienteId,
      valorTotal: Number(venda.valorTotal),
      formaPagamento: venda.formaPagamento,
      parcelas: venda.parcelas,
      createdBy: req.user!.id
    });

    // ── Comissão ──────────────────────────────────────────────────────────────
    const config = await prisma.configuracao.findFirst();
    const comissaoPercent = Number(config?.comissaoVendedorMoto || 1);
    const comissaoValor = Number(venda.valorTotal) * (comissaoPercent / 100);
    await prisma.comissao.create({
      data: {
        usuarioId: venda.vendedorId,
        vendaId,
        tipo: 'vendedor',
        valor: comissaoValor,
        periodo: config?.periodoComissao || 'MENSAL'
      }
    });

    // ── Garantias ─────────────────────────────────────────────────────────────
    await criarGarantiasVenda(vendaId, venda.clienteId, venda.itens);

    // ── Atualizar status da venda ──────────────────────────────────────────────
    await prisma.venda.update({
      where: { id: vendaId },
      data: { status: 'FINALIZADA', confirmadaFinanceiro: true }
    });

    // ── Criar registros de DocumentoVenda ─────────────────────────────────────
    const anoAtual = new Date().getFullYear();
    const serieRecibo = `REC-${anoAtual}-${vendaId.toString().padStart(6, '0')}`;
    const serieLaudo  = checkin.numeroSerie;
    const serieManual = `MAN-${anoAtual}-${vendaId.toString().padStart(6, '0')}`;
    const temManual   = venda.itens.some(i => (i.produto as any)?.manualUrl);

    await prisma.documentoVenda.createMany({
      data: [
        { vendaId, tipo: 'RECIBO', numeroSerie: serieRecibo, createdAt: now, updatedAt: now },
        { vendaId, tipo: 'LAUDO_SAIDA', numeroSerie: serieLaudo, createdAt: now, updatedAt: now },
        ...(temManual ? [{ vendaId, tipo: 'MANUAL', numeroSerie: serieManual, createdAt: now, updatedAt: now }] : [])
      ]
    });

    // ── Envio de Email (não bloqueia a resposta) ───────────────────────────────
    const vendaCompleta = await prisma.venda.findUnique({
      where: { id: vendaId },
      include: {
        cliente: true, vendedor: { select: { id: true, nome: true } },
        loja: true, itens: { include: { produto: true, servico: true, unidadeFisica: true } }
      }
    });

    if (vendaCompleta?.cliente?.email) {
      const htmlEmail = buildEmailVenda(vendaCompleta, checkin);
      sendEmail(
        vendaCompleta.cliente.email,
        `Comprovante de Venda #${String(vendaId).padStart(5,'0')} — ${vendaCompleta.loja?.nomeFantasia || 'Tecle Motos'}`,
        htmlEmail
      ).then(async (ok) => {
        if (ok) {
          await prisma.documentoVenda.updateMany({
            where: { vendaId, tipo: { in: ['RECIBO', 'LAUDO_SAIDA'] } },
            data: { enviadoEmail: true, updatedAt: new Date() }
          });
        } else {
          await prisma.documentoVenda.updateMany({
            where: { vendaId },
            data: { erroEnvioEmail: 'Falha no envio de email', updatedAt: new Date() }
          });
        }
      }).catch(err => console.error('[CHECKIN] Erro email:', err));
    }

    // ── Envio de WhatsApp (não bloqueia) ──────────────────────────────────────
    if (vendaCompleta?.cliente?.telefone) {
      const primeiroNome = (vendaCompleta.cliente.nome || '').split(' ')[0];
      const mensagemWpp = `Olá, ${primeiroNome}! 🎉 Sua compra na ${vendaCompleta.loja?.nomeFantasia || 'Tecle Motos'} foi concluída com sucesso!\n\n` +
        `📋 Venda #${String(vendaId).padStart(5,'0')}\n` +
        `📄 Laudo: ${serieLaudo}\n` +
        `💰 Total: R$ ${Number(venda.valorTotal).toLocaleString('pt-BR',{minimumFractionDigits:2})}\n\n` +
        `Seus documentos estão disponíveis para consulta. Obrigado pela confiança! 🏍️`;

      criarDisparo({
        destinatario: vendaCompleta.cliente.nome || '',
        numero: vendaCompleta.cliente.telefone,
        mensagem: mensagemWpp,
        contexto: 'CONFIRMACAO_VENDA',
        operadorId: req.user!.id,
        clienteId: venda.clienteId,
        tipo: 'AUTOMATICO',
      }).then(async () => {
        await prisma.documentoVenda.updateMany({
          where: { vendaId },
          data: { enviadoWhatsapp: true, updatedAt: new Date() }
        });
      }).catch(async (err) => {
        console.error('[CHECKIN] Erro WhatsApp:', err);
        await prisma.documentoVenda.updateMany({
          where: { vendaId },
          data: { erroEnvioWhatsapp: 'Falha no envio WhatsApp', updatedAt: new Date() }
        });
      });
    }

    registrarLog({
      usuarioId:  req.user!.id,
      userName:   req.user!.nome,
      userRole:   req.user!.role,
      acao:       'FINALIZAR_CHECKIN',
      entidade:   'VENDA',
      entidadeId: vendaId,
      detalhes:   `Check-in finalizado para Venda #${vendaId} — Laudo ${serieLaudo}`,
      ip:         obterIp(req),
    });

    res.json({ success: true, vendaId, numeroSerieCheckin: serieLaudo, numeroSerieRecibo: serieRecibo });
  } catch (err: any) {
    console.error('[CHECKIN] FINALIZAR erro:', err);
    res.status(500).json({ error: process.env.NODE_ENV === 'development' ? err.message : 'Erro interno' });
  }
});

// ── GET /api/checkin/:vendaId/laudo ───────────────────────────────────────────
router.get('/:vendaId/laudo', async (req: AuthRequest, res) => {
  try {
    const vendaId = Number(req.params.vendaId);
    const venda = await prisma.venda.findUnique({
      where: { id: vendaId },
      include: {
        cliente: true,
        vendedor: { select: { id: true, nome: true } },
        loja: true,
        itens: { include: { produto: true, unidadeFisica: true } },
        checkin: true,
      }
    });
    if (!venda) return res.status(404).json({ error: 'Venda não encontrada' });
    if (!verificarAcessoVenda(req, venda.loja?.grupoId)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    res.json(venda);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── POST /api/checkin/:vendaId/reenviar ──────────────────────────────────────
router.post('/:vendaId/reenviar', async (req: AuthRequest, res) => {
  try {
    const vendaId = Number(req.params.vendaId);
    const venda = await prisma.venda.findUnique({
      where: { id: vendaId },
      include: {
        cliente: true, vendedor: { select: { id: true, nome: true } },
        loja: true, itens: { include: { produto: true, servico: true, unidadeFisica: true } },
        checkin: true,
      }
    });

    if (!venda) return res.status(404).json({ error: 'Venda não encontrada' });
    if (!verificarAcessoVenda(req, venda.loja?.grupoId)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }
    if ((venda as any).status !== 'FINALIZADA') {
      return res.status(400).json({ error: 'Venda não finalizada' });
    }

    const resultados: { email?: boolean; whatsapp?: boolean; erros: string[] } = { erros: [] };

    if (venda.cliente?.email) {
      const html = buildEmailVenda(venda, (venda as any).checkin);
      const ok = await sendEmail(
        venda.cliente.email,
        `Comprovante de Venda #${String(vendaId).padStart(5,'0')} — Reenvio`,
        html
      );
      resultados.email = ok;
      if (!ok) resultados.erros.push('Falha no envio de email');
    }

    if (venda.cliente?.telefone) {
      const primeiroNome = (venda.cliente.nome || '').split(' ')[0];
      await criarDisparo({
        destinatario: venda.cliente.nome || '',
        numero: venda.cliente.telefone,
        mensagem: `Olá, ${primeiroNome}! Segue reenvio do comprovante da Venda #${String(vendaId).padStart(5,'0')}.\nLaudo: ${(venda as any).checkin?.numeroSerie || 'N/A'} — Tecle Motos`,
        contexto: 'CONFIRMACAO_VENDA',
        operadorId: req.user!.id,
        clienteId: venda.clienteId,
        tipo: 'MANUAL',
      });
      resultados.whatsapp = true;
    }

    res.json(resultados);
  } catch (err) {
    console.error('[CHECKIN] REENVIAR erro:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

export default router;
