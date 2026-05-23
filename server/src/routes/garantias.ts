import { Router } from 'express';
import { prisma } from '../index.js';
import { verifyToken, AuthRequest, applyTenantFilter } from '../middleware/auth.js';

const router = Router();

router.use(verifyToken);

router.get('/', async (req: AuthRequest, res) => {
  try {
    const filter = applyTenantFilter(req);
    const { lojaId: queryLojaId } = req.query;
    const where: any = {};

    const effectiveLojaId = filter.lojaId ?? (queryLojaId && !filter.lojaId ? Number(queryLojaId) : null);

    if (effectiveLojaId) {
      where.OR = [
        { unidadeFisica: { lojaId: effectiveLojaId } },
        { unidadeFisicaId: null, venda: { lojaId: effectiveLojaId } }
      ];
    } else if (filter.grupoId) {
      where.OR = [
        { unidadeFisica: { loja: { grupoId: filter.grupoId } } },
        { unidadeFisicaId: null, venda: { loja: { grupoId: filter.grupoId } } }
      ];
    }

    const garantias = await prisma.garantia.findMany({
      where,
      include: { 
        unidadeFisica: { include: { produto: true, loja: true } },
        cliente: true,
        venda: { include: { itens: { include: { produto: true } }, loja: true } }
      },
      orderBy: { dataFim: 'asc' }
    });

    const resultado = garantias.map(g => ({
      ...g,
      tipo: g.tipoGarantia,
      unidade: g.unidadeFisica
    }));

    res.json(resultado);
  } catch (error) {
    console.error('Erro ao listar garantias:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.put('/:id/revisao', async (req: AuthRequest, res) => {
  try {
    const { revisaoFeita } = req.body;
    const filter = applyTenantFilter(req);

    const where: any = { id: Number(req.params.id) };
    if (filter.lojaId) {
      where.OR = [
        { unidadeFisica: { lojaId: filter.lojaId } },
        { unidadeFisicaId: null, venda: { lojaId: filter.lojaId } }
      ];
    } else if (filter.grupoId) {
      where.OR = [
        { unidadeFisica: { loja: { grupoId: filter.grupoId } } },
        { unidadeFisicaId: null, venda: { loja: { grupoId: filter.grupoId } } }
      ];
    }

    const garantiaExistente = await prisma.garantia.findFirst({ where });
    if (!garantiaExistente) {
      return res.status(404).json({ error: 'Garantia não encontrada' });
    }

    const garantia = await prisma.garantia.update({
      where: { id: garantiaExistente.id },
      data: { revisaoFeita: Boolean(revisaoFeita) }
    });

    res.json(garantia);
  } catch (error) {
    console.error('Erro ao atualizar revisao:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/alertas', async (req: AuthRequest, res) => {
  try {
    const hoje = new Date();
    const limite = new Date();
    limite.setDate(limite.getDate() + 20);

    const filter = applyTenantFilter(req);
    const where: any = {
      ativa: true,
      dataFim: { gte: hoje, lte: limite }
    };

    if (filter.lojaId) {
      where.OR = [
        { unidadeFisica: { lojaId: filter.lojaId } },
        { unidadeFisicaId: null, venda: { lojaId: filter.lojaId } }
      ];
    } else if (filter.grupoId) {
      where.OR = [
        { unidadeFisica: { loja: { grupoId: filter.grupoId } } },
        { unidadeFisicaId: null, venda: { loja: { grupoId: filter.grupoId } } }
      ];
    }

    const garantias = await prisma.garantia.findMany({
      where,
      include: { unidadeFisica: { include: { produto: true } } },
      orderBy: { dataFim: 'asc' }
    });

    res.json(garantias);
  } catch (error) {
    console.error('Erro ao listar alertas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/retroativas', async (req: AuthRequest, res) => {
  try {
    const userRole = req.user?.role;
    if (!['ADMIN_GERAL', 'ADMIN_REDE'].includes(userRole || '')) {
      return res.status(403).json({ error: 'Apenas administradores podem executar esta ação' });
    }

    const vendas = await prisma.venda.findMany({
      where: {
        tipo: 'VENDA',
        deletedAt: null
      },
      include: {
        itens: {
          include: { produto: true }
        }
      }
    });

    let garantiasCriadas = 0;
    let vendasCorrigidas = 0;

    for (const venda of vendas) {
      if (!venda.confirmadaFinanceiro) {
        await prisma.venda.update({
          where: { id: venda.id },
          data: { confirmadaFinanceiro: true }
        });
        vendasCorrigidas++;
      }

      for (const item of venda.itens) {
        const isMoto = item.produto?.tipo === 'MOTO';
        if (!isMoto) continue;

        const whereGarantia: any = { vendaId: venda.id };
        if (item.unidadeFisicaId) {
          whereGarantia.unidadeFisicaId = item.unidadeFisicaId;
        } else {
          whereGarantia.unidadeFisicaId = null;
        }
        const garantiasExistentes = await prisma.garantia.count({ where: whereGarantia });
        if (garantiasExistentes > 0) continue;

        const garantiasConfig = [
          { tipo: 'geral', meses: 3 },
          { tipo: 'motor', meses: 12 },
          { tipo: 'modulo', meses: 12 },
          { tipo: 'bateria', meses: 12 }
        ];

        for (const g of garantiasConfig) {
          const dataInicio = new Date(venda.createdAt);
          const dataFim = new Date(venda.createdAt);
          dataFim.setMonth(dataFim.getMonth() + g.meses);

          const garantiaData: any = {
            clienteId: venda.clienteId,
            vendaId: venda.id,
            tipoGarantia: g.tipo,
            meses: g.meses,
            dataInicio,
            dataFim
          };
          if (item.unidadeFisicaId) garantiaData.unidadeFisicaId = item.unidadeFisicaId;
          await prisma.garantia.create({ data: garantiaData });
          garantiasCriadas++;
        }
      }
    }

    res.json({
      success: true,
      garantiasCriadas,
      vendasCorrigidas,
      vendasProcessadas: vendas.length,
      mensagem: `${garantiasCriadas} garantias criadas e ${vendasCorrigidas} vendas corrigidas para confirmada`
    });
  } catch (error) {
    console.error('Erro ao criar garantias retroativas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// PUT /garantias/:id/inativar — baixa/consome garantia; requer OS de acionamento vinculada
router.put('/:id/inativar', async (req: AuthRequest, res) => {
  try {
    const userRole = req.user?.role;
    if (!['ADMIN_GERAL', 'ADMIN_REDE', 'DONO_LOJA', 'GERENTE_LOJA'].includes(userRole || '')) {
      return res.status(403).json({ error: 'Sem permissão para baixar garantia' });
    }

    const garantiaId = Number(req.params.id);
    const garantia = await prisma.garantia.findUnique({ where: { id: garantiaId } });
    if (!garantia) return res.status(404).json({ error: 'Garantia não encontrada' });
    if (!garantia.ativa) return res.status(400).json({ error: 'Garantia já está inativa' });

    // Verificar se existe OS de acionamento vinculada a esta garantia
    const todasOS = await prisma.ordemServico.findMany({
      where: { tipo: 'ACIONAMENTO_GARANTIA', deletedAt: null }
    });
    const osVinculada = todasOS.find(os => {
      if (!os.motoDescricao) return false;
      try { return JSON.parse(os.motoDescricao).garantiaId === garantiaId; } catch { return false; }
    });

    if (!osVinculada) {
      return res.status(400).json({
        error: 'Não é possível baixar esta garantia sem uma Ordem de Serviço de Acionamento de Garantia vinculada. Crie uma OS de Acionamento de Garantia referenciando esta garantia primeiro.'
      });
    }

    const atualizada = await prisma.garantia.update({
      where: { id: garantiaId },
      data: { ativa: false }
    });

    res.json(atualizada);
  } catch (error) {
    console.error('Erro ao baixar garantia:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const userRole = req.user?.role;
    if (!['ADMIN_GERAL', 'ADMIN_REDE', 'DONO_LOJA', 'GERENTE_LOJA'].includes(userRole || '')) {
      return res.status(403).json({ error: 'Sem permissão para excluir garantias' });
    }

    const filter = applyTenantFilter(req);
    const where: any = { id: Number(req.params.id) };
    if (filter.lojaId) {
      where.OR = [
        { unidadeFisica: { lojaId: filter.lojaId } },
        { unidadeFisicaId: null, venda: { lojaId: filter.lojaId } }
      ];
    } else if (filter.grupoId) {
      where.OR = [
        { unidadeFisica: { loja: { grupoId: filter.grupoId } } },
        { unidadeFisicaId: null, venda: { loja: { grupoId: filter.grupoId } } }
      ];
    }

    const garantia = await prisma.garantia.findFirst({ where });
    if (!garantia) {
      return res.status(404).json({ error: 'Garantia não encontrada' });
    }

    await prisma.garantia.delete({ where: { id: garantia.id } });
    res.json({ message: 'Garantia excluída com sucesso' });
  } catch (error) {
    console.error('Erro ao excluir garantia:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/', async (req: AuthRequest, res) => {
  try {
    const { unidadeFisicaId, tipoGarantia, meses } = req.body;

    const dataInicio = new Date();
    const dataFim = new Date();
    dataFim.setMonth(dataFim.getMonth() + Number(meses));

    const garantia = await prisma.garantia.create({
      data: {
        unidadeFisicaId: Number(unidadeFisicaId),
        tipoGarantia,
        meses: Number(meses),
        dataInicio,
        dataFim
      }
    });

    res.status(201).json(garantia);
  } catch (error) {
    console.error('Erro ao criar garantia:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// GET /:id/os-vinculadas — lista OS do tipo ACIONAMENTO_GARANTIA cujo garantiaId está no motoDescricao JSON
router.get('/:id/os-vinculadas', async (req: AuthRequest, res) => {
  try {
    const garantiaId = Number(req.params.id);
    const filter = applyTenantFilter(req);
    const where: any = { deletedAt: null, tipo: 'ACIONAMENTO_GARANTIA' };
    if (filter.lojaId) where.lojaId = filter.lojaId;
    else if (filter.grupoId) where.loja = { grupoId: filter.grupoId };

    const todas = await prisma.ordemServico.findMany({
      where,
      include: { cliente: true, loja: true, itens: { include: { servico: true, produto: true } } },
      orderBy: { createdAt: 'desc' }
    });

    const vinculadas = todas.filter(os => {
      if (!os.motoDescricao) return false;
      try {
        const dados = JSON.parse(os.motoDescricao);
        return dados.garantiaId === garantiaId;
      } catch {
        return false;
      }
    });

    res.json(vinculadas);
  } catch (error) {
    console.error('Erro ao buscar OS vinculadas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/revisoes', async (req: AuthRequest, res) => {
  try {
    const filter = applyTenantFilter(req);
    const where: any = {};

    if (filter.lojaId) {
      where.unidadeFisica = { lojaId: filter.lojaId };
    } else if (filter.grupoId) {
      where.unidadeFisica = { loja: { grupoId: filter.grupoId } };
    }

    const revisoes = await prisma.revisao.findMany({
      where,
      include: { unidadeFisica: { include: { produto: true } } },
      orderBy: { dataAgendada: 'asc' }
    });

    res.json(revisoes);
  } catch (error) {
    console.error('Erro ao listar revisões:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/revisoes/alertas', async (req: AuthRequest, res) => {
  try {
    const hoje = new Date();
    const limite = new Date();
    limite.setDate(limite.getDate() + 20);

    const filter = applyTenantFilter(req);
    const where: any = {
      dataRealizada: null,
      dataAgendada: { gte: hoje, lte: limite }
    };

    if (filter.lojaId) {
      where.unidadeFisica = { lojaId: filter.lojaId };
    } else if (filter.grupoId) {
      where.unidadeFisica = { loja: { grupoId: filter.grupoId } };
    }

    const revisoes = await prisma.revisao.findMany({
      where,
      include: { unidadeFisica: { include: { produto: true } } },
      orderBy: { dataAgendada: 'asc' }
    });

    res.json(revisoes);
  } catch (error) {
    console.error('Erro ao listar alertas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/revisoes', async (req: AuthRequest, res) => {
  try {
    const { unidadeFisicaId, dataAgendada, gratuita, valor } = req.body;

    const ultimaRevisao = await prisma.revisao.findFirst({
      where: { unidadeFisicaId: Number(unidadeFisicaId) },
      orderBy: { numero: 'desc' }
    });

    const numero = (ultimaRevisao?.numero || 0) + 1;
    const isGratuita = numero === 1 || gratuita;

    const revisao = await prisma.revisao.create({
      data: {
        unidadeFisicaId: Number(unidadeFisicaId),
        numero,
        dataAgendada: new Date(dataAgendada),
        gratuita: isGratuita,
        valor: isGratuita ? null : (valor ? Number(valor) : null)
      }
    });

    res.status(201).json(revisao);
  } catch (error) {
    console.error('Erro ao agendar revisão:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.put('/revisoes/:id/realizar', async (req: AuthRequest, res) => {
  try {
    const revisao = await prisma.revisao.update({
      where: { id: Number(req.params.id) },
      data: { dataRealizada: new Date() }
    });

    res.json(revisao);
  } catch (error) {
    console.error('Erro ao realizar revisão:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

export default router;
