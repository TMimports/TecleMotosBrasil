import { Router } from 'express';
import { prisma } from '../index.js';
import { verifyToken, requireAdminRede, applyTenantFilter, AuthRequest } from '../middleware/auth.js';

const router = Router();

router.use(verifyToken);

router.get('/', async (req: AuthRequest, res) => {
  try {
    // ?todos=true: retorna todas as lojas da rede (para Estoque cross-store)
    const todosDaRede = req.query.todos === 'true';

    let where: any = {};
    if (!todosDaRede) {
      const filter = applyTenantFilter(req);
      if (filter.grupoId) where = { grupoId: filter.grupoId };
      else if (filter.lojaId) where = { id: filter.lojaId };
    }

    const lojas = await prisma.loja.findMany({
      where,
      include: { grupo: true, _count: { select: { usuarios: true } } },
      orderBy: { nomeFantasia: 'asc' }
    });

    res.json(lojas);
  } catch (error) {
    console.error('Erro ao listar lojas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/consultar-cnpj/:cnpj', requireAdminRede, async (req, res) => {
  try {
    const cnpj = String(req.params.cnpj).replace(/\D/g, '');

    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);

    if (!response.ok) {
      return res.status(404).json({ error: 'CNPJ não encontrado' });
    }

    const data = await response.json();

    res.json({
      cnpj: data.cnpj,
      razaoSocial: data.razao_social,
      nomeFantasia: data.nome_fantasia,
      endereco: [
        data.descricao_tipo_logradouro,
        data.logradouro,
        data.numero,
        data.complemento,
        data.bairro,
        data.municipio,
        data.uf,
        data.cep
      ].filter(Boolean).join(', '),
      telefone: data.ddd_telefone_1,
      email: data.email
    });
  } catch (error) {
    console.error('Erro ao consultar CNPJ:', error);
    res.status(500).json({ error: 'Erro ao consultar CNPJ' });
  }
});

router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const loja = await prisma.loja.findUnique({
      where: { id: Number(req.params.id) },
      include: { grupo: true, usuarios: true }
    });

    if (!loja) {
      return res.status(404).json({ error: 'Loja não encontrada' });
    }

    res.json(loja);
  } catch (error) {
    console.error('Erro ao buscar loja:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/', requireAdminRede, async (req: AuthRequest, res) => {
  try {
    const { cnpj, razaoSocial, nomeFantasia, endereco, telefone, email, grupoId: grupoIdParam } = req.body;

    if (!razaoSocial) {
      return res.status(400).json({ error: 'Razão social é obrigatória' });
    }

    if (!grupoIdParam) {
      return res.status(400).json({ error: 'Grupo é obrigatório' });
    }

    const grupoExiste = await prisma.grupo.findUnique({ where: { id: Number(grupoIdParam) } });
    if (!grupoExiste) {
      return res.status(400).json({ error: 'Grupo não encontrado' });
    }

    const loja = await prisma.loja.create({
      data: {
        cnpj: cnpj.replace(/\D/g, ''),
        razaoSocial,
        nomeFantasia,
        endereco,
        telefone,
        email,
        grupoId: Number(grupoIdParam)
      }
    });

    res.status(201).json(loja);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'CNPJ já cadastrado' });
    }
    console.error('Erro ao criar loja:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.put('/:id', requireAdminRede, async (req, res) => {
  try {
    const { razaoSocial, nomeFantasia, endereco, telefone, email, ativo, grupoId, comissaoMoto, comissaoPecas, comissaoServico } = req.body;

    const loja = await prisma.loja.update({
      where: { id: Number(req.params.id) },
      data: { 
        razaoSocial, nomeFantasia, endereco, telefone, email, ativo, grupoId,
        ...(comissaoMoto !== undefined && { comissaoMoto }),
        ...(comissaoPecas !== undefined && { comissaoPecas }),
        ...(comissaoServico !== undefined && { comissaoServico })
      }
    });

    res.json(loja);
  } catch (error) {
    console.error('Erro ao atualizar loja:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.put('/:id/comissoes', async (req: AuthRequest, res) => {
  try {
    const { comissaoMoto, comissaoPecas, comissaoServico } = req.body;
    const lojaId = Number(req.params.id);
    
    if (!['ADMIN_GERAL', 'ADMIN_REDE', 'DONO_LOJA'].includes(req.user?.role || '')) {
      return res.status(403).json({ error: 'Sem permissao para alterar comissoes' });
    }
    
    const validateComissao = (val: any) => val === undefined || (typeof val === 'number' && val >= 0 && val <= 100);
    if (!validateComissao(comissaoMoto) || !validateComissao(comissaoPecas) || !validateComissao(comissaoServico)) {
      return res.status(400).json({ error: 'Valores de comissao devem estar entre 0 e 100' });
    }
    
    if (req.user?.role === 'DONO_LOJA') {
      const loja = await prisma.loja.findUnique({ where: { id: lojaId } });
      if (!loja || loja.grupoId !== req.user.grupoId) {
        return res.status(403).json({ error: 'Sem permissao para esta loja' });
      }
    }
    
    const updateData: any = {};
    if (comissaoMoto !== undefined) updateData.comissaoMoto = comissaoMoto;
    if (comissaoPecas !== undefined) updateData.comissaoPecas = comissaoPecas;
    if (comissaoServico !== undefined) updateData.comissaoServico = comissaoServico;
    
    const lojaAtualizada = await prisma.loja.update({
      where: { id: lojaId },
      data: updateData
    });

    res.json(lojaAtualizada);
  } catch (error) {
    console.error('Erro ao atualizar comissoes:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.delete('/:id', requireAdminRede, async (req, res) => {
  try {
    const lojaId = Number(req.params.id);

    const loja = await prisma.loja.findUnique({ where: { id: lojaId } });
    if (!loja) {
      return res.status(404).json({ error: 'Loja não encontrada' });
    }

    // Verificar dados críticos que impedem exclusão física irreversível
    const [
      vendas, ordensServico, caixa, contasPagar, contasReceber,
      notasFiscais, transferenciasOrigem, transferenciasDestino,
      pagamentos, recebimentos, fornecedores, pedidosCompra, contasBancarias
    ] = await Promise.all([
      prisma.venda.count({ where: { lojaId, deletedAt: null } }),
      prisma.ordemServico.count({ where: { lojaId, deletedAt: null } }),
      prisma.caixa.count({ where: { lojaId } }),
      prisma.contaPagar.count({ where: { lojaId } }),
      prisma.contaReceber.count({ where: { lojaId } }),
      prisma.notaFiscal.count({ where: { lojaId } }),
      prisma.transferencia.count({ where: { lojaOrigemId: lojaId } }),
      prisma.transferencia.count({ where: { lojaDestinoId: lojaId } }),
      prisma.pagamento.count({ where: { lojaId } }),
      prisma.recebimento.count({ where: { lojaId } }),
      prisma.fornecedor.count({ where: { lojaId } }),
      prisma.pedidoCompra.count({ where: { lojaId } }),
      prisma.contaBancaria.count({ where: { lojaId } }),
    ]);

    const dadosCriticos = {
      vendas, ordensServico, caixa, contasPagar, contasReceber,
      notasFiscais, transferenciasOrigem, transferenciasDestino,
      pagamentos, recebimentos, fornecedores, pedidosCompra, contasBancarias
    };

    const totalCritico = Object.values(dadosCriticos).reduce((a, b) => a + b, 0);

    if (totalCritico > 0) {
      // Bloquear exclusão física — dados fiscais/financeiros/operacionais presentes
      return res.status(400).json({
        error: 'Exclusão bloqueada: esta loja possui dados vinculados que impedem a exclusão física.',
        recomendacao: 'Use a opção ARQUIVAR (PATCH /lojas/:id/arquivar) para inativar a loja preservando o histórico.',
        preview: {
          loja: { id: loja.id, nome: loja.nomeFantasia || loja.razaoSocial, cnpj: loja.cnpj },
          dadosCriticos,
          totalRegistrosCriticos: totalCritico,
        }
      });
    }

    // Sem dados críticos — verificar dados operacionais menores
    const [estoques, unidades, logsEstoque, clientes, usuarios] = await Promise.all([
      prisma.estoque.count({ where: { lojaId } }),
      prisma.unidadeFisica.count({ where: { lojaId } }),
      prisma.logEstoque.count({ where: { lojaId } }),
      prisma.cliente.count({ where: { lojaId } }),
      prisma.user.count({ where: { lojaId } }),
    ]);

    const totalOperacional = estoques + unidades + logsEstoque + clientes + usuarios;

    if (totalOperacional > 0) {
      // Dados operacionais sem histórico fiscal — pode excluir com transação segura
      await prisma.$transaction(async (tx) => {
        await tx.logEstoque.deleteMany({ where: { lojaId } });
        await tx.estoque.deleteMany({ where: { lojaId } });
        await tx.unidadeFisica.deleteMany({ where: { lojaId } });
        await tx.cliente.deleteMany({ where: { lojaId } });
        await tx.user.updateMany({
          where: { lojaId, role: { in: ['ADMIN_GERAL', 'ADMIN_REDE', 'DONO_LOJA'] } },
          data: { lojaId: null }
        });
        await tx.user.deleteMany({ where: { lojaId } });
        await tx.loja.delete({ where: { id: lojaId } });
      });

      return res.json({
        success: true,
        message: 'Loja e dados operacionais removidos com sucesso (sem histórico fiscal/financeiro).',
        removidos: { estoques, unidades, logsEstoque, clientes, usuarios }
      });
    }

    // Loja completamente vazia — exclusão direta segura
    await prisma.loja.delete({ where: { id: lojaId } });
    res.json({ success: true, message: 'Loja removida com sucesso.' });

  } catch (error: any) {
    console.error('Erro ao excluir loja:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Arquivar loja (inativar) — preserva todo o histórico
router.patch('/:id/arquivar', requireAdminRede, async (req, res) => {
  try {
    const lojaId = Number(req.params.id);

    const loja = await prisma.loja.findUnique({ where: { id: lojaId } });
    if (!loja) {
      return res.status(404).json({ error: 'Loja não encontrada' });
    }

    if (!loja.ativo) {
      return res.status(400).json({ error: 'Loja já está arquivada/inativa.' });
    }

    const atualizada = await prisma.loja.update({
      where: { id: lojaId },
      data: { ativo: false }
    });

    res.json({
      success: true,
      message: `Loja "${atualizada.nomeFantasia || atualizada.razaoSocial}" arquivada com sucesso. Histórico preservado.`,
      loja: { id: atualizada.id, nomeFantasia: atualizada.nomeFantasia, ativo: atualizada.ativo }
    });
  } catch (error: any) {
    console.error('Erro ao arquivar loja:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

export default router;
