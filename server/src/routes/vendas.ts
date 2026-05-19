import { Router } from 'express';
import { prisma } from '../index.js';
import { verifyToken, applyTenantFilter, requireRole, AuthRequest } from '../middleware/auth.js';
import { InventoryService } from '../services/InventoryService.js';
import { registrarLog, obterIp } from '../services/logService.js';

const router = Router();

router.use(verifyToken);

async function criarContasReceber(params: {
  vendaId: number;
  lojaId: number;
  clienteId: number;
  valorTotal: number;
  formaPagamento: string;
  parcelas: number | null;
  createdBy: number;
}) {
  const { vendaId, lojaId, clienteId, valorTotal, formaPagamento, parcelas, createdBy } = params;

  const contasExistentes = await prisma.contaReceber.count({ where: { vendaId } });
  if (contasExistentes > 0) return;

  if (formaPagamento === 'FINANCIAMENTO' || (parcelas && parcelas > 1)) {
    const numParcelas = parcelas || 1;
    const valorParcela = valorTotal / numParcelas;
    for (let i = 0; i < numParcelas; i++) {
      const vencimento = new Date();
      vencimento.setMonth(vencimento.getMonth() + i + 1);
      await prisma.contaReceber.create({
        data: {
          lojaId, clienteId, vendaId,
          descricao: `Venda #${vendaId} - Parcela ${i + 1}/${numParcelas}`,
          valor: valorParcela, vencimento, createdBy
        }
      });
    }
  } else {
    const vencimento = new Date();
    if (formaPagamento === 'CARTAO_CREDITO') {
      vencimento.setDate(vencimento.getDate() + 30);
    }
    await prisma.contaReceber.create({
      data: {
        lojaId, clienteId, vendaId,
        descricao: `Venda #${vendaId} - ${formaPagamento}`,
        valor: valorTotal, vencimento, createdBy
      }
    });
  }
}

async function criarGarantiasVenda(vendaId: number, clienteId: number, itens: any[]) {
  for (const item of itens) {
    if (!item.produtoId) continue;
    const produto = item.produto || await prisma.produto.findUnique({ where: { id: item.produtoId } });
    if (!produto || produto.tipo !== 'MOTO') continue;

    const garantiasExistentes = await prisma.garantia.count({
      where: { vendaId, ...(item.unidadeFisicaId ? { unidadeFisicaId: item.unidadeFisicaId } : {}) }
    });
    if (garantiasExistentes > 0) continue;

    const garantiasConfig = [
      { tipo: 'geral', meses: 3 },
      { tipo: 'motor', meses: 12 },
      { tipo: 'modulo', meses: 12 },
      { tipo: 'bateria', meses: 12 }
    ];

    for (const g of garantiasConfig) {
      const dataInicio = new Date();
      const dataFim = new Date();
      dataFim.setMonth(dataFim.getMonth() + g.meses);
      await prisma.garantia.create({
        data: {
          unidadeFisicaId: item.unidadeFisicaId || null,
          clienteId, vendaId,
          tipoGarantia: g.tipo, meses: g.meses,
          dataInicio, dataFim
        }
      });
    }
  }
}

router.get('/', async (req: AuthRequest, res) => {
  try {
    const filter = applyTenantFilter(req);
    const { lojaId: queryLojaId, clienteId: queryClienteId } = req.query;

    const where: any = { deletedAt: null };
    if (filter.lojaId) where.lojaId = filter.lojaId;
    else if (filter.grupoId) where.loja = { grupoId: filter.grupoId };
    if (queryLojaId && !filter.lojaId) where.lojaId = Number(queryLojaId);
    if (queryClienteId) where.clienteId = Number(queryClienteId);
    const vendas = await prisma.venda.findMany({
      where,
      include: {
        cliente: true,
        vendedor: { select: { id: true, nome: true } },
        loja: true,
        itens: { include: { produto: true, servico: true, unidadeFisica: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(vendas);
  } catch (error) {
    console.error('Erro ao listar vendas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/produtos-disponiveis/:lojaId', async (req: AuthRequest, res) => {
  try {
    const lojaId = Number(req.params.lojaId);
    const produtos = await InventoryService.getProdutosDisponiveis(lojaId);
    res.json(produtos);
  } catch (error) {
    console.error('Erro ao buscar produtos disponíveis:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/produtos-catalogo/:lojaId', async (req: AuthRequest, res) => {
  try {
    const lojaId = Number(req.params.lojaId);
    const produtos = await prisma.produto.findMany({
      where: { ativo: true },
      include: {
        estoques: {
          where: { lojaId }
        }
      },
      orderBy: { nome: 'asc' }
    });

    const resultado = produtos.map(p => ({
      id: p.id,
      nome: p.nome,
      preco: p.estoques[0]?.precoVenda ?? p.preco,
      precoBase: p.preco,
      precoLoja: p.estoques[0]?.precoVenda ?? null,
      tipo: p.tipo,
      codigo: p.codigo,
      estoque: p.estoques[0]?.quantidade || 0
    }));

    res.json(resultado);
  } catch (error) {
    console.error('Erro ao buscar catálogo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const venda = await prisma.venda.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        cliente: true,
        vendedor: true,
        loja: true,
        itens: { include: { produto: true, servico: true, unidadeFisica: true } }
      }
    });

    if (!venda) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    const userRole = req.user?.role;
    if (userRole !== 'ADMIN_GERAL' && userRole !== 'ADMIN_REDE') {
      const userGrupoId = req.user?.grupoId;
      if (venda.loja && venda.loja.grupoId !== userGrupoId) {
        return res.status(403).json({ error: 'Acesso negado' });
      }
    }

    res.json(venda);
  } catch (error) {
    console.error('Erro ao buscar venda:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/', async (req: AuthRequest, res) => {
  try {
    const { tipo, clienteId, vendedorId, lojaId, formaPagamento, parcelas, itens, valorTotalManual, observacoes, pagamentosCompostos } = req.body;

    if (!clienteId || !lojaId || !formaPagamento || !itens?.length) {
      return res.status(400).json({ error: 'Dados incompletos' });
    }

    if (req.user?.lojaId && req.user.lojaId !== Number(lojaId)) {
      return res.status(403).json({ error: 'Você só pode registrar vendas para sua própria loja.' });
    }

    const config = await prisma.configuracao.findFirst();
    const userRole = req.user?.role;

    for (const item of itens) {
      if (item.unidadeFisicaId) {
        const unidade = await prisma.unidadeFisica.findUnique({ where: { id: Number(item.unidadeFisicaId) } });
        if (unidade?.status === 'VENDIDA') {
          return res.status(400).json({
            error: `Chassi ${unidade.chassi || '#' + unidade.id} já foi vendido anteriormente e não pode ser vendido novamente.`
          });
        }
      }
    }

    const tipoVendaCheck = tipo || 'VENDA';

    const itensParaVerificar = itens
      .filter((item: any) => item.produtoId)
      .map((item: any) => ({ produtoId: item.produtoId, quantidade: item.quantidade }));

    if (tipoVendaCheck !== 'ORCAMENTO' && itensParaVerificar.length > 0) {
      const verificacao = await InventoryService.verificarItensVenda(itensParaVerificar, Number(lojaId));
      if (!verificacao.valido) {
        return res.status(400).json({
          error: 'Estoque insuficiente',
          detalhes: verificacao.erros
        });
      }
    }

    let valorBruto = 0;
    let valorTotal = 0;
    const itensProcessados = [];

    for (const item of itens) {
      let precoUnitario = Number(item.precoUnitario);
      let desconto = Number(item.desconto || 0);

      if (item.produtoId && desconto > 0) {
        // ADMIN_GERAL, ADMIN_FINANCEIRO, ADMIN_REDE: sem limite de desconto
        const rolesLivres = ['ADMIN_GERAL', 'ADMIN_FINANCEIRO', 'ADMIN_REDE'];
        if (!rolesLivres.includes(userRole || '')) {
          // Perfis operacionais: trava de 15%
          const rolesCap15 = ['VENDEDOR', 'DONO_LOJA'];
          if (rolesCap15.includes(userRole || '')) {
            if (desconto > 15) {
              return res.status(400).json({
                error: `O desconto máximo permitido para este perfil é de 15%. Desconto informado: ${desconto}%`
              });
            }
          } else {
            // GERENTE_LOJA e outros: usa config * 2
            const produto = await prisma.produto.findUnique({ where: { id: item.produtoId } });
            if (produto) {
              let maxDesconto = produto.tipo === 'MOTO' ? Number(config?.descontoMaxMoto || 3.5) : Number(config?.descontoMaxPeca || 10);
              if (userRole === 'GERENTE_LOJA') maxDesconto = maxDesconto * 2;
              if (desconto > maxDesconto) {
                return res.status(400).json({
                  error: `Desconto de ${desconto}% excede o máximo permitido para seu perfil (${maxDesconto}%)`
                });
              }
            }
          }
        }
      }

      if (formaPagamento === 'CARTAO_DEBITO' || formaPagamento === 'CARTAO_CREDITO') {
        desconto = 0;
      }

      const subtotalBruto = precoUnitario * item.quantidade;
      const subtotal = subtotalBruto * (1 - desconto / 100);
      valorBruto += subtotalBruto;
      valorTotal += subtotal;

      itensProcessados.push({
        produtoId: item.produtoId || null,
        servicoId: item.servicoId || null,
        unidadeFisicaId: item.unidadeFisicaId || null,
        quantidade: item.quantidade,
        precoUnitario,
        desconto
      });
    }

    if (valorTotalManual && Number(valorTotalManual) > 0) {
      valorTotal = Number(valorTotalManual);
    } else if (valorTotal % 1 !== 0) {
      valorTotal = Math.ceil(valorTotal);
    }

    const tipoVenda = tipo || 'VENDA';
    const confirmarAutomaticamente = tipoVenda === 'VENDA';

    const venda = await prisma.venda.create({
      data: {
        tipo: tipoVenda,
        clienteId: Number(clienteId),
        vendedorId: Number(vendedorId || req.user!.id),
        lojaId: Number(lojaId),
        formaPagamento,
        parcelas: parcelas ? Number(parcelas) : null,
        valorBruto,
        valorTotal,
        observacoes: observacoes?.trim() || null,
        pagamentosJson: pagamentosCompostos ? JSON.stringify(pagamentosCompostos) : null,
        confirmadaFinanceiro: confirmarAutomaticamente,
        createdBy: req.user!.id,
        itens: { create: itensProcessados }
      },
      include: { 
        itens: { include: { produto: true, servico: true, unidadeFisica: true } },
        cliente: true,
        vendedor: true,
        loja: true
      }
    });

    if (confirmarAutomaticamente) {
      const resultadoBaixa = await InventoryService.processarBaixaVenda(
        venda.id,
        itensProcessados.filter(i => i.produtoId).map(i => ({
          produtoId: i.produtoId!,
          quantidade: i.quantidade,
          unidadeFisicaId: i.unidadeFisicaId || undefined
        })),
        Number(lojaId),
        req.user!.id
      );

      if (!resultadoBaixa.success) {
        await prisma.venda.delete({ where: { id: venda.id } });
        return res.status(400).json({ error: resultadoBaixa.error });
      }

      if (formaPagamento !== 'FINANCIAMENTO') {
        await prisma.caixa.create({
          data: {
            lojaId: Number(lojaId),
            tipo: 'entrada',
            descricao: `Venda #${venda.id}`,
            valor: valorTotal,
            formaPagamento,
            referencia: `venda_${venda.id}`
          }
        });
      }

      await criarContasReceber({
        vendaId: venda.id,
        lojaId: Number(lojaId),
        clienteId: Number(clienteId),
        valorTotal,
        formaPagamento,
        parcelas: parcelas ? Number(parcelas) : null,
        createdBy: req.user!.id
      });

      const comissaoPercent = Number(config?.comissaoVendedorMoto || 1);
      const comissaoValor = valorTotal * (comissaoPercent / 100);

      await prisma.comissao.create({
        data: {
          usuarioId: Number(vendedorId || req.user!.id),
          vendaId: venda.id,
          tipo: 'vendedor',
          valor: comissaoValor,
          periodo: config?.periodoComissao || 'MENSAL'
        }
      });

      await criarGarantiasVenda(venda.id, Number(clienteId), venda.itens);
    }

    registrarLog({
      usuarioId:  req.user!.id,
      userName:   req.user!.nome,
      userRole:   req.user!.role,
      acao:       tipoVenda === 'ORCAMENTO' ? 'CRIAR_ORCAMENTO' : 'CRIAR_VENDA',
      entidade:   'VENDA',
      entidadeId: venda.id,
      detalhes:   `${tipoVenda === 'ORCAMENTO' ? 'Orçamento' : 'Venda'} #${venda.id} criado para "${(venda as any).cliente?.nome || clienteId}" — R$ ${valorTotal.toFixed(2)}`,
      ip: obterIp(req),
    });

    res.status(201).json(venda);
  } catch (error: any) {
    console.error('Erro ao criar venda:', error);
    const msg = process.env.NODE_ENV === 'development'
      ? (error?.message || String(error))
      : 'Erro interno do servidor';
    res.status(500).json({ error: msg });
  }
});

router.put('/:id/confirmar', requireRole('ADMIN_GERAL', 'GERENTE_LOJA', 'DONO_LOJA'), async (req: AuthRequest, res) => {
  try {
    const vendaAtual = await prisma.venda.findUnique({
      where: { id: Number(req.params.id) },
      include: { itens: { include: { produto: true, servico: true } } }
    });

    if (!vendaAtual) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    if (vendaAtual.confirmadaFinanceiro) {
      return res.status(400).json({ error: 'Venda já confirmada' });
    }

    const itensParaVerificar = vendaAtual.itens
      .filter(item => item.produtoId)
      .map(item => ({ produtoId: item.produtoId!, quantidade: item.quantidade }));

    if (itensParaVerificar.length > 0) {
      const verificacao = await InventoryService.verificarItensVenda(itensParaVerificar, vendaAtual.lojaId);
      if (!verificacao.valido) {
        return res.status(400).json({ 
          error: 'Estoque insuficiente',
          detalhes: verificacao.erros
        });
      }
    }

    const venda = await prisma.venda.update({
      where: { id: Number(req.params.id) },
      data: { confirmadaFinanceiro: true },
      include: { 
        itens: { include: { produto: true, servico: true, unidadeFisica: true } },
        cliente: true,
        vendedor: true,
        loja: true
      }
    });

    const resultadoBaixa = await InventoryService.processarBaixaVenda(
      venda.id,
      venda.itens.filter(i => i.produtoId).map(i => ({
        produtoId: i.produtoId!,
        quantidade: i.quantidade,
        unidadeFisicaId: i.unidadeFisicaId || undefined
      })),
      venda.lojaId,
      req.user!.id
    );

    if (!resultadoBaixa.success) {
      await prisma.venda.update({
        where: { id: venda.id },
        data: { confirmadaFinanceiro: false }
      });
      return res.status(400).json({ error: resultadoBaixa.error });
    }

    if (venda.formaPagamento !== 'FINANCIAMENTO') {
      await prisma.caixa.create({
        data: {
          lojaId: venda.lojaId,
          tipo: 'entrada',
          descricao: `Venda #${venda.id}`,
          valor: venda.valorTotal,
          formaPagamento: venda.formaPagamento,
          referencia: `venda_${venda.id}`
        }
      });
    }

    await criarContasReceber({
      vendaId: venda.id,
      lojaId: venda.lojaId,
      clienteId: venda.clienteId,
      valorTotal: Number(venda.valorTotal),
      formaPagamento: venda.formaPagamento,
      parcelas: venda.parcelas,
      createdBy: req.user!.id
    });

    await criarGarantiasVenda(venda.id, venda.clienteId, venda.itens);

    res.json(venda);
  } catch (error) {
    console.error('Erro ao confirmar venda:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.put('/:id/converter-venda', async (req: AuthRequest, res) => {
  try {
    const vendaAtual = await prisma.venda.findUnique({
      where: { id: Number(req.params.id) },
      include: { itens: true }
    });

    if (!vendaAtual) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    if (vendaAtual.tipo !== 'ORCAMENTO') {
      return res.status(400).json({ error: 'Apenas orçamentos podem ser convertidos em venda' });
    }

    const itensParaVerificar = vendaAtual.itens
      .filter(item => item.produtoId)
      .map(item => ({ produtoId: item.produtoId!, quantidade: item.quantidade }));

    if (itensParaVerificar.length > 0) {
      const verificacao = await InventoryService.verificarItensVenda(itensParaVerificar, vendaAtual.lojaId);
      if (!verificacao.valido) {
        return res.status(400).json({ 
          error: 'Estoque insuficiente',
          detalhes: verificacao.erros
        });
      }
    }

    const venda = await prisma.venda.update({
      where: { id: Number(req.params.id) },
      data: { 
        tipo: 'VENDA',
        confirmadaFinanceiro: true 
      },
      include: { 
        itens: { include: { produto: true, servico: true, unidadeFisica: true } },
        cliente: true,
        vendedor: true,
        loja: true
      }
    });

    const resultadoBaixa = await InventoryService.processarBaixaVenda(
      venda.id,
      venda.itens.filter(i => i.produtoId).map(i => ({
        produtoId: i.produtoId!,
        quantidade: i.quantidade,
        unidadeFisicaId: i.unidadeFisicaId || undefined
      })),
      venda.lojaId,
      req.user!.id
    );

    if (!resultadoBaixa.success) {
      await prisma.venda.update({
        where: { id: venda.id },
        data: { tipo: 'ORCAMENTO', confirmadaFinanceiro: false }
      });
      return res.status(400).json({ error: resultadoBaixa.error });
    }

    if (venda.formaPagamento !== 'FINANCIAMENTO') {
      await prisma.caixa.create({
        data: {
          lojaId: venda.lojaId,
          tipo: 'entrada',
          descricao: `Venda #${venda.id} (convertido de orçamento)`,
          valor: venda.valorTotal,
          formaPagamento: venda.formaPagamento,
          referencia: `venda_${venda.id}`
        }
      });
    }

    await criarContasReceber({
      vendaId: venda.id,
      lojaId: venda.lojaId,
      clienteId: venda.clienteId,
      valorTotal: Number(venda.valorTotal),
      formaPagamento: venda.formaPagamento,
      parcelas: venda.parcelas,
      createdBy: req.user!.id
    });

    const config = await prisma.configuracao.findFirst();
    const comissaoPercent = Number(config?.comissaoVendedorMoto || 1);
    const comissaoValor = Number(venda.valorTotal) * (comissaoPercent / 100);

    await prisma.comissao.create({
      data: {
        usuarioId: venda.vendedorId,
        vendaId: venda.id,
        tipo: 'vendedor',
        valor: comissaoValor,
        periodo: config?.periodoComissao || 'MENSAL'
      }
    });

    await criarGarantiasVenda(venda.id, venda.clienteId, venda.itens);

    res.json(venda);
  } catch (error) {
    console.error('Erro ao converter orçamento:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.put('/:id/cancelar', requireRole('ADMIN_GERAL', 'GERENTE_LOJA', 'DONO_LOJA'), async (req: AuthRequest, res) => {
  try {
    const vendaId = Number(req.params.id);
    const { motivo } = req.body;

    if (!motivo || motivo.trim().length < 3) {
      return res.status(400).json({ error: 'Informe o motivo do cancelamento (mínimo 3 caracteres)' });
    }

    const venda = await prisma.venda.findUnique({
      where: { id: vendaId },
      include: {
        itens: { include: { produto: true, unidadeFisica: true } },
        loja: true
      }
    });

    if (!venda) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    if (venda.deletedAt) {
      return res.status(400).json({ error: 'Esta venda já foi cancelada' });
    }

    await prisma.$transaction(async (tx) => {
      if (venda.tipo === 'VENDA') {
        for (const item of venda.itens) {
          if (item.produtoId) {
            const estoque = await tx.estoque.findUnique({
              where: { produtoId_lojaId: { produtoId: item.produtoId, lojaId: venda.lojaId } }
            });

            if (estoque) {
              await tx.estoque.update({
                where: { id: estoque.id },
                data: { quantidade: estoque.quantidade + item.quantidade }
              });

              await tx.logEstoque.create({
                data: {
                  tipo: 'ENTRADA',
                  origem: 'CANCELAMENTO',
                  origemId: vendaId,
                  produtoId: item.produtoId,
                  lojaId: venda.lojaId,
                  quantidade: item.quantidade,
                  quantidadeAnterior: estoque.quantidade,
                  quantidadeNova: estoque.quantidade + item.quantidade,
                  usuarioId: req.user!.id
                }
              });
            }

            if (item.unidadeFisicaId) {
              await tx.unidadeFisica.update({
                where: { id: item.unidadeFisicaId },
                data: { status: 'ESTOQUE' }
              });
            }
          }
        }

        await tx.contaReceber.deleteMany({ where: { vendaId } });
        await tx.comissao.deleteMany({ where: { vendaId } });
        await tx.garantia.updateMany({
          where: { vendaId },
          data: { ativa: false }
        });
        await tx.caixa.deleteMany({
          where: { referencia: `venda_${vendaId}` }
        });
      }

      await tx.venda.update({
        where: { id: vendaId },
        data: {
          deletedAt: new Date(),
          deletedBy: req.user!.id
        }
      });

      await tx.logAuditoria.create({
        data: {
          usuarioId: req.user!.id,
          acao: 'CANCELAMENTO',
          entidade: 'Venda',
          entidadeId: vendaId,
          dados: JSON.stringify({ motivo, tipo: venda.tipo, valorTotal: venda.valorTotal })
        }
      });
    });

    res.json({ message: 'Venda cancelada com sucesso. Estoque restaurado e registros financeiros removidos.' });
  } catch (error) {
    console.error('Erro ao cancelar venda:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.delete('/:id', requireRole('ADMIN_GERAL', 'GERENTE_LOJA', 'DONO_LOJA'), async (req: AuthRequest, res) => {
  try {
    const venda = await prisma.venda.findUnique({
      where: { id: Number(req.params.id) }
    });

    if (!venda) {
      return res.status(404).json({ error: 'Venda não encontrada' });
    }

    if (venda.confirmadaFinanceiro) {
      return res.status(400).json({ error: 'Não é possível excluir vendas confirmadas' });
    }

    await prisma.venda.update({
      where: { id: Number(req.params.id) },
      data: { 
        deletedAt: new Date(),
        deletedBy: req.user!.id
      }
    });

    registrarLog({
      usuarioId:  req.user!.id,
      userName:   req.user!.nome,
      userRole:   req.user!.role,
      acao:       'EXCLUIR_VENDA',
      entidade:   'VENDA',
      entidadeId: Number(req.params.id),
      detalhes:   `Venda/Orçamento #${req.params.id} excluído (tipo: ${venda.tipo}, valor: R$ ${Number(venda.valorTotal).toFixed(2)})`,
      ip: obterIp(req),
    });

    res.json({ message: 'Orçamento excluído' });
  } catch (error) {
    console.error('Erro ao excluir venda:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

export default router;
