import { Router } from 'express';
import { prisma } from '../index.js';
import { verifyToken, applyTenantFilter, requireRole, AuthRequest } from '../middleware/auth.js';
import { InventoryService } from '../services/InventoryService.js';

const router = Router();

router.use(verifyToken);

router.get('/', async (req: AuthRequest, res) => {
  try {
    const filter = applyTenantFilter(req);
    const { lojaId: queryLojaId } = req.query;

    const where: any = { deletedAt: null };
    if (filter.lojaId) where.lojaId = filter.lojaId;
    else if (filter.grupoId) where.loja = { grupoId: filter.grupoId };
    else if (queryLojaId) where.lojaId = Number(queryLojaId);

    const ordens = await prisma.ordemServico.findMany({
      where,
      include: {
        cliente: true,
        loja: true,
        unidadeFisica: { include: { produto: true } },
        itens: { include: { produto: true, servico: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(ordens);
  } catch (error) {
    console.error('Erro ao listar OS:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/por-cliente/:clienteId', async (req: AuthRequest, res) => {
  try {
    const clienteId = Number(req.params.clienteId);
    const filter = applyTenantFilter(req);
    const where: any = { clienteId, deletedAt: null };
    if (filter.lojaId) where.lojaId = filter.lojaId;
    if (filter.grupoId) where.loja = { grupoId: filter.grupoId };

    const ordens = await prisma.ordemServico.findMany({
      where,
      include: {
        cliente: true,
        loja: true,
        unidadeFisica: { include: { produto: true } },
        itens: { include: { produto: true, servico: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(ordens);
  } catch (error) {
    console.error('Erro ao buscar OS por cliente:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/buscar-cliente', async (req: AuthRequest, res) => {
  try {
    const { q } = req.query;
    if (!q || String(q).length < 2) {
      return res.json([]);
    }

    const filter = applyTenantFilter(req);
    const termo = String(q).toLowerCase();
    const clienteWhere: any = {
      OR: [
        { nome: { contains: termo, mode: 'insensitive' } },
        { telefone: { contains: termo } },
        { cpfCnpj: { contains: termo } }
      ]
    };
    if (filter.lojaId) clienteWhere.lojaId = filter.lojaId;
    if (filter.grupoId) clienteWhere.loja = { grupoId: filter.grupoId };

    const clientes = await prisma.cliente.findMany({
      where: clienteWhere,
      include: {
        ordensServico: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            loja: true,
            itens: { include: { servico: true } }
          }
        }
      },
      take: 10
    });

    res.json(clientes);
  } catch (error) {
    console.error('Erro ao buscar clientes:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const os = await prisma.ordemServico.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        cliente: true,
        loja: true,
        unidadeFisica: { include: { produto: true } },
        itens: { include: { produto: true, servico: true } }
      }
    });

    if (!os) {
      return res.status(404).json({ error: 'OS não encontrada' });
    }

    const userRole = req.user?.role;
    if (userRole !== 'ADMIN_GERAL' && userRole !== 'ADMIN_REDE') {
      const userGrupoId = req.user?.grupoId;
      if (os.loja && os.loja.grupoId !== userGrupoId) {
        return res.status(403).json({ error: 'Acesso negado' });
      }
    }

    res.json(os);
  } catch (error) {
    console.error('Erro ao buscar OS:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/:id/cliente', async (req, res) => {
  try {
    const os = await prisma.ordemServico.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        cliente: { select: { nome: true, telefone: true } },
        loja: { select: { nomeFantasia: true, telefone: true, endereco: true } },
        unidadeFisica: { include: { produto: { select: { nome: true } } } },
        itens: { 
          include: { 
            produto: { select: { nome: true } }, 
            servico: { select: { id: true, nome: true, preco: true } }
          } 
        }
      }
    });

    if (!os) {
      return res.status(404).json({ error: 'OS não encontrada' });
    }

    const osCliente = {
      id: os.id,
      numero: os.numero,
      tipo: os.tipo,
      status: os.status,
      valorTotal: os.valorTotal,
      motoDescricao: os.motoDescricao,
      observacoes: os.observacoes,
      cliente: os.cliente,
      loja: os.loja,
      unidadeFisica: os.unidadeFisica,
      itens: os.itens.map(item => ({
        ...item,
        servico: item.servico ? { id: item.servico.id, nome: item.servico.nome, preco: item.servico.preco } : null
      })),
      createdAt: os.createdAt
    };

    res.json(osCliente);
  } catch (error) {
    console.error('Erro ao buscar OS para cliente:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/', async (req: AuthRequest, res) => {
  try {
    const { clienteId, unidadeFisicaId, motoDescricao, tecnico, observacoes, lojaId, itens, tipo, desconto: descontoForm } = req.body;

    if (!clienteId || !lojaId) {
      return res.status(400).json({ error: 'Cliente e loja são obrigatórios' });
    }

    const config = await prisma.configuracao.findFirst();
    const userRole = req.user?.role;

    const itensParaVerificar = (itens || [])
      .filter((item: any) => item.produtoId)
      .map((item: any) => ({ produtoId: item.produtoId, quantidade: item.quantidade }));

    // Acionamento de Garantia não verifica nem baixa estoque
    const isGarantia = tipo === 'ACIONAMENTO_GARANTIA';

    if (tipo !== 'ORCAMENTO' && !isGarantia && itensParaVerificar.length > 0) {
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

    if (itens?.length) {
      for (const item of itens) {
        const subtotalBruto = Number(item.precoUnitario) * item.quantidade;
        valorBruto += subtotalBruto;
        
        let desconto = Number(item.desconto || 0);
        
        if (item.servicoId) {
          let maxDesconto = Number(config?.descontoMaxServico || 10);
          if (userRole === 'GERENTE_LOJA') {
            maxDesconto = maxDesconto * 2;
          }
          if (desconto > maxDesconto) {
            return res.status(400).json({ 
              error: `Desconto de ${desconto}% em servicos excede o maximo permitido para seu perfil (${maxDesconto}%)` 
            });
          }
        } else if (item.produtoId) {
          let maxDesconto = Number(config?.descontoMaxPeca || 10);
          if (userRole === 'GERENTE_LOJA') {
            maxDesconto = maxDesconto * 2;
          }
          if (desconto > maxDesconto) {
            return res.status(400).json({ 
              error: `Desconto de ${desconto}% em pecas excede o maximo permitido para seu perfil (${maxDesconto}%)` 
            });
          }
        }

        const subtotal = subtotalBruto * (1 - desconto / 100);
        // Peças não cobradas não entram no total financeiro, mas entram no valorBruto
        const cobrada = item.cobrada !== false; // default true
        if (cobrada) valorTotal += subtotal;

        itensProcessados.push({
          produtoId: item.produtoId || null,
          servicoId: item.servicoId || null,
          quantidade: item.quantidade,
          precoUnitario: Number(item.precoUnitario),
          desconto,
          cobrada
        });
      }
    }

    const tipoOS = tipo || 'OS';
    const status = tipoOS === 'ORCAMENTO' ? 'ORCAMENTO' : 'EM_EXECUCAO';
    const skipEstoque = tipoOS === 'ORCAMENTO' || tipoOS === 'ACIONAMENTO_GARANTIA';

    const osCreated = await prisma.ordemServico.create({
      data: {
        clienteId: Number(clienteId),
        unidadeFisicaId: unidadeFisicaId ? Number(unidadeFisicaId) : null,
        motoDescricao,
        tecnico,
        observacoes,
        lojaId: Number(lojaId),
        valorBruto,
        valorTotal,
        desconto: Number(descontoForm) || 0,
        tipo: tipoOS,
        status: status as any,
        createdBy: req.user!.id,
        itens: { create: itensProcessados }
      },
      include: { 
        itens: { include: { produto: true, servico: true } }, 
        cliente: true, 
        loja: true 
      }
    });

    // Atribui número sequencial baseado no ID
    const numeroOS = `OS-${osCreated.id.toString().padStart(5, '0')}`;
    await prisma.ordemServico.update({ where: { id: osCreated.id }, data: { numero: numeroOS } });
    const os = { ...osCreated, numero: numeroOS };

    if (!skipEstoque && itensProcessados.some(i => i.produtoId)) {
      const resultadoBaixa = await InventoryService.processarBaixaOS(
        os.id,
        itensProcessados.filter(i => i.produtoId).map(i => ({
          produtoId: i.produtoId!,
          quantidade: i.quantidade
        })),
        Number(lojaId),
        req.user!.id
      );

      if (!resultadoBaixa.success) {
        await prisma.ordemServico.delete({ where: { id: os.id } });
        return res.status(400).json({ error: resultadoBaixa.error });
      }
    }

    res.status(201).json(os);
  } catch (error) {
    console.error('Erro ao criar OS:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── PUT /os/:id/laudo — salva parecer técnico/administrativo em observacoes ──
router.put('/:id/laudo', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { parecerTecnico, parecerAdmin, responsavelTecnico, responsavelAdmin, statusLaudo } = req.body;

    const osAtual = await prisma.ordemServico.findUnique({ where: { id } });
    if (!osAtual) return res.status(404).json({ error: 'OS não encontrada' });

    let obsParsed: any = {};
    try { obsParsed = JSON.parse(osAtual.observacoes || '{}'); } catch { obsParsed = { texto: osAtual.observacoes || '' }; }

    obsParsed.laudo = {
      parecerTecnico: parecerTecnico || '',
      parecerAdmin: parecerAdmin || '',
      responsavelTecnico: responsavelTecnico || '',
      responsavelAdmin: responsavelAdmin || '',
      status: statusLaudo || 'EM_ANALISE',
      data: new Date().toISOString()
    };

    const os = await prisma.ordemServico.update({
      where: { id },
      data: { observacoes: JSON.stringify(obsParsed) }
    });

    res.json(os);
  } catch (error) {
    console.error('Erro ao salvar laudo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.put('/:id/status', async (req: AuthRequest, res) => {
  try {
    const { status } = req.body;

    const os = await prisma.ordemServico.update({
      where: { id: Number(req.params.id) },
      data: { status }
    });

    res.json(os);
  } catch (error) {
    console.error('Erro ao atualizar status:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.put('/:id/confirmar', requireRole('ADMIN_GERAL', 'GERENTE_LOJA', 'DONO_LOJA'), async (req: AuthRequest, res) => {
  try {
    const osAtual = await prisma.ordemServico.findUnique({
      where: { id: Number(req.params.id) },
      include: { itens: true }
    });

    if (!osAtual) {
      return res.status(404).json({ error: 'OS não encontrada' });
    }

    // ACIONAMENTO_GARANTIA: verificar e baixar estoque das peças ao confirmar
    if (osAtual.tipo === 'ACIONAMENTO_GARANTIA') {
      const itensPecas = osAtual.itens
        .filter(i => i.produtoId)
        .map(i => ({ produtoId: i.produtoId!, quantidade: i.quantidade }));

      if (itensPecas.length > 0) {
        const verificacao = await InventoryService.verificarItensVenda(itensPecas, osAtual.lojaId);
        if (!verificacao.valido) {
          return res.status(400).json({
            error: 'Estoque insuficiente para concluir OS de garantia',
            detalhes: verificacao.erros
          });
        }
        const resultadoBaixa = await InventoryService.processarBaixaOS(
          osAtual.id,
          itensPecas,
          osAtual.lojaId,
          req.user!.id
        );
        if (!resultadoBaixa.success) {
          return res.status(400).json({ error: resultadoBaixa.error });
        }
      }
    }

    const os = await prisma.ordemServico.update({
      where: { id: Number(req.params.id) },
      data: { confirmadaFinanceiro: true, status: 'EXECUTADA' }
    });

    await prisma.caixa.create({
      data: {
        lojaId: os.lojaId,
        tipo: 'entrada',
        descricao: `OS #${os.numero}`,
        valor: os.valorTotal,
        referencia: `os_${os.id}`
      }
    });

    await prisma.contaReceber.create({
      data: {
        lojaId: os.lojaId,
        clienteId: osAtual.clienteId,
        descricao: `OS #${os.numero}`,
        valor: os.valorTotal,
        vencimento: new Date(),
        createdBy: req.user!.id
      }
    });

    if (osAtual.tecnico) {
      const tecnicoUser = await prisma.user.findFirst({
        where: { nome: osAtual.tecnico, role: 'TECNICO' }
      });

      if (tecnicoUser) {
        const config = await prisma.configuracao.findFirst();
        const comissaoPercent = Number(config?.comissaoTecnico || 25);

        const itensServico = osAtual.itens.filter(i => i.servicoId !== null);
        const valorServicos = itensServico.reduce((acc, i) => {
          const subtotal = Number(i.precoUnitario) * i.quantidade;
          const desc = Number(i.desconto || 0);
          return acc + subtotal * (1 - desc / 100);
        }, 0);

        if (valorServicos > 0) {
          const comissaoValor = valorServicos * (comissaoPercent / 100);

          await prisma.comissao.create({
            data: {
              usuarioId: tecnicoUser.id,
              ordemServicoId: os.id,
              tipo: 'tecnico',
              valor: comissaoValor,
              periodo: config?.periodoComissao || 'MENSAL'
            }
          });
        }
      }
    }

    res.json(os);
  } catch (error) {
    console.error('Erro ao confirmar OS:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.put('/:id/converter-os', async (req: AuthRequest, res) => {
  try {
    const osAtual = await prisma.ordemServico.findUnique({
      where: { id: Number(req.params.id) },
      include: { itens: { include: { produto: true, servico: true } } }
    });

    if (!osAtual) {
      return res.status(404).json({ error: 'OS não encontrada' });
    }

    if (osAtual.tipo !== 'ORCAMENTO') {
      return res.status(400).json({ error: 'Apenas orçamentos podem ser convertidos' });
    }

    const itensParaVerificar = osAtual.itens
      .filter(item => item.produtoId)
      .map(item => ({ produtoId: item.produtoId!, quantidade: item.quantidade }));

    if (itensParaVerificar.length > 0) {
      const verificacao = await InventoryService.verificarItensVenda(itensParaVerificar, osAtual.lojaId);
      if (!verificacao.valido) {
        return res.status(400).json({ 
          error: 'Estoque insuficiente',
          detalhes: verificacao.erros
        });
      }
    }

    const os = await prisma.ordemServico.update({
      where: { id: Number(req.params.id) },
      data: { 
        tipo: 'OS',
        status: 'EM_EXECUCAO'
      }
    });

    if (itensParaVerificar.length > 0) {
      const resultadoBaixa = await InventoryService.processarBaixaOS(
        os.id,
        itensParaVerificar,
        osAtual.lojaId,
        req.user!.id
      );

      if (!resultadoBaixa.success) {
        await prisma.ordemServico.update({
          where: { id: os.id },
          data: { tipo: 'ORCAMENTO', status: 'ORCAMENTO' }
        });
        return res.status(400).json({ error: resultadoBaixa.error });
      }
    }

    res.json(os);
  } catch (error) {
    console.error('Erro ao converter orçamento:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { clienteId, tecnico, motoDescricao, observacoes } = req.body;

    const osAtual = await prisma.ordemServico.findUnique({ where: { id } });
    if (!osAtual) return res.status(404).json({ error: 'OS não encontrada' });

    if (osAtual.confirmadaFinanceiro || osAtual.status === 'EXECUTADA') {
      return res.status(400).json({ error: 'Não é possível editar OS finalizada ou confirmada' });
    }

    const os = await prisma.ordemServico.update({
      where: { id },
      data: {
        ...(clienteId ? { clienteId: Number(clienteId) } : {}),
        ...(tecnico !== undefined ? { tecnico: tecnico || null } : {}),
        ...(motoDescricao !== undefined ? { motoDescricao } : {}),
        ...(observacoes !== undefined ? { observacoes } : {})
      },
      include: { cliente: true, loja: true, itens: { include: { produto: true, servico: true } } }
    });

    res.json(os);
  } catch (error) {
    console.error('Erro ao editar OS:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.delete('/:id', requireRole('ADMIN_GERAL', 'GERENTE_LOJA', 'DONO_LOJA'), async (req: AuthRequest, res) => {
  try {
    const os = await prisma.ordemServico.findUnique({
      where: { id: Number(req.params.id) }
    });

    if (!os) {
      return res.status(404).json({ error: 'OS não encontrada' });
    }

    if (os.confirmadaFinanceiro || os.status === 'EXECUTADA') {
      return res.status(400).json({ error: 'Não é possível excluir OS confirmadas ou finalizadas' });
    }

    await prisma.ordemServico.update({
      where: { id: Number(req.params.id) },
      data: { 
        deletedAt: new Date(),
        deletedBy: req.user!.id
      }
    });

    await prisma.logAuditoria.create({
      data: {
        usuarioId: req.user!.id,
        acao: 'DELETE',
        entidade: 'OrdemServico',
        entidadeId: Number(req.params.id),
        dados: JSON.stringify(os)
      }
    });

    res.json({ message: 'OS excluída' });
  } catch (error) {
    console.error('Erro ao excluir OS:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/ordens-servico/normalizar-numeros — corrige numeros com cuid para formato OS-XXXXX
router.post('/normalizar-numeros', requireRole('ADMIN_GERAL'), async (req: AuthRequest, res) => {
  try {
    const todas = await prisma.ordemServico.findMany({ orderBy: { id: 'asc' } });
    const semFormato = todas.filter(os => !os.numero.startsWith('OS-'));
    let atualizadas = 0;
    for (const os of semFormato) {
      const novoNumero = `OS-${os.id.toString().padStart(5, '0')}`;
      await prisma.ordemServico.update({ where: { id: os.id }, data: { numero: novoNumero } });
      atualizadas++;
    }
    res.json({ message: `${atualizadas} OS atualizadas`, total: todas.length, atualizadas });
  } catch (error) {
    console.error('Erro ao normalizar números de OS:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

export default router;
