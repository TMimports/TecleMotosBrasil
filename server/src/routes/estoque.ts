import { Router } from 'express';
import { prisma } from '../index.js';
import { verifyToken, applyTenantFilter, AuthRequest, requireRole } from '../middleware/auth.js';
import { InventoryService } from '../services/InventoryService.js';

const router = Router();

router.use(verifyToken);

router.get('/grupo', async (req: AuthRequest, res) => {
  try {
    if (req.user?.role === 'ADMIN_GERAL') {
      const estoqueGeral = await InventoryService.getEstoqueTodas();
      return res.json(estoqueGeral);
    }

    let grupoId = req.user?.grupoId;
    
    if (!grupoId && req.user?.lojaId) {
      const loja = await prisma.loja.findUnique({ where: { id: req.user.lojaId } });
      grupoId = loja?.grupoId;
    }
    
    if (!grupoId) {
      return res.status(400).json({ error: 'Usuário não pertence a um grupo' });
    }

    const estoqueGrupo = await InventoryService.getEstoqueGrupo(grupoId);
    res.json(estoqueGrupo);
  } catch (error) {
    console.error('Erro ao buscar estoque do grupo:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/logs', requireRole('ADMIN_GERAL', 'DONO_LOJA', 'GERENTE_LOJA'), async (req: AuthRequest, res) => {
  try {
    const filter = applyTenantFilter(req);

    const where: any = {};
    if (filter.lojaId) where.lojaId = filter.lojaId;
    if (filter.grupoId) where.loja = { grupoId: filter.grupoId };

    const logs = await prisma.logEstoque.findMany({
      where,
      include: { 
        produto: { select: { nome: true } },
        loja: { select: { nomeFantasia: true } },
        usuario: { select: { nome: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 200
    });

    res.json(logs);
  } catch (error) {
    console.error('Erro ao buscar logs de estoque:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /estoque/unidades-disponiveis?lojaId=&produtoId= ─────────────────────
// Retorna UnidadeFisica em status ESTOQUE para um produto+loja.
// Compara com Estoque.quantidade e sinaliza inconsistência quando diverge.
router.get('/unidades-disponiveis', async (req: AuthRequest, res) => {
  try {
    const lojaId   = Number(req.query.lojaId);
    const produtoId = Number(req.query.produtoId);

    if (!lojaId || !produtoId) {
      return res.status(400).json({ error: 'lojaId e produtoId são obrigatórios' });
    }

    const filter = applyTenantFilter(req);
    if (filter.lojaId && filter.lojaId !== lojaId) {
      return res.status(403).json({ error: 'Acesso negado a esta loja' });
    }
    if (filter.grupoId) {
      const loja = await prisma.loja.findFirst({ where: { id: lojaId, grupoId: filter.grupoId } });
      if (!loja) return res.status(403).json({ error: 'Acesso negado a esta loja' });
    }

    const [estoque, unidades] = await Promise.all([
      prisma.estoque.findUnique({
        where: { produtoId_lojaId: { produtoId, lojaId } },
        select: { quantidade: true }
      }),
      prisma.unidadeFisica.findMany({
        where: { produtoId, lojaId, status: 'ESTOQUE' },
        include: { produto: { select: { id: true, nome: true, preco: true } } },
        orderBy: { createdAt: 'asc' }
      })
    ]);

    const estoqueGerencial = estoque?.quantidade ?? 0;
    const resultado = unidades.map(u => ({
      id: u.id,
      produtoId: u.produtoId,
      produtoNome: u.produto.nome,
      preco: Number(u.produto.preco),
      chassi: u.chassi,
      codigoMotor: u.codigoMotor,
      cor: u.cor,
      ano: u.ano,
      status: u.status,
      displayName: `Chassi: ${u.chassi || 'N/A'} | Motor: ${u.codigoMotor || 'N/A'} | Cor: ${u.cor || 'N/A'}`
    }));

    res.json({
      estoqueGerencial,
      unidades: resultado,
      alertaInconsistencia: estoqueGerencial > resultado.length
    });
  } catch (error) {
    console.error('Erro ao buscar unidades disponíveis por produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /estoque/entrada-avulsa ──────────────────────────────────────────────
// Entrada manual de estoque sem gerar financeiro.
// Para PECA: incrementa Estoque + LogEstoque.
// Para MOTO: cria UnidadeFisica por chassi + LogEstoque.
router.post(
  '/entrada-avulsa',
  requireRole('ADMIN_GERAL', 'ADMIN_FINANCEIRO', 'ADMIN_REDE', 'DONO_LOJA', 'GERENTE_LOJA'),
  async (req: AuthRequest, res) => {
    try {
      const { produtoId, lojaId, tipo, quantidade, chassis, custo, fornecedorId, notaFiscalEntrada, observacao } = req.body;
      const userId = req.user!.id;

      if (!produtoId || !lojaId) return res.status(400).json({ error: 'produtoId e lojaId são obrigatórios' });

      const produto = await prisma.produto.findUnique({ where: { id: Number(produtoId) } });
      if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });

      const loja = await prisma.loja.findUnique({ where: { id: Number(lojaId) } });
      if (!loja) return res.status(404).json({ error: 'Loja não encontrada' });

      const tipoProduto = tipo || produto.tipo;

      // ── MOTO: criar UnidadeFisica por chassi ──────────────────────────────
      if (tipoProduto === 'MOTO') {
        const chassisList: { chassi?: string; cor?: string; ano?: number; custo?: number }[] = Array.isArray(chassis) ? chassis : [];
        if (chassisList.length === 0) return res.status(400).json({ error: 'Informe ao menos um chassi para Moto' });

        const criados: any[] = [];
        const erros: string[] = [];

        for (const item of chassisList) {
          try {
            const chassiStr = item.chassi?.trim() || null;
            if (chassiStr) {
              const dup = await prisma.unidadeFisica.findFirst({ where: { chassi: chassiStr } });
              if (dup) { erros.push(`Chassi "${chassiStr}" já cadastrado`); continue; }
            }

            // Gerar número de série
            const prefixo = 'TMUNI';
            const ultimo = await prisma.unidadeFisica.findFirst({
              where: { numeroSerie: { startsWith: prefixo } },
              orderBy: { numeroSerie: 'desc' },
            });
            let seq = 1;
            if (ultimo?.numeroSerie) { const m = ultimo.numeroSerie.match(/\d+$/); if (m) seq = parseInt(m[0]) + 1; }
            const numeroSerie = `${prefixo}${String(seq).padStart(5, '0')}`;

            const unidade = await prisma.unidadeFisica.create({
              data: {
                produtoId: Number(produtoId),
                lojaId: Number(lojaId),
                chassi: chassiStr,
                cor: item.cor?.trim() || null,
                ano: item.ano ? Number(item.ano) : new Date().getFullYear(),
                numeroSerie,
                status: 'ESTOQUE',
                createdBy: userId,
              },
            });

            // Log de estoque (origem = ENTRADA_AVULSA)
            const estoqueAtual = await prisma.estoque.findUnique({ where: { produtoId_lojaId: { produtoId: Number(produtoId), lojaId: Number(lojaId) } } });
            const qtdAnterior = estoqueAtual?.quantidade ?? 0;

            // Calcular custo médio ponderado (CMP)
            const custoUnit = item.custo ? Number(item.custo) : (custo ? Number(custo) : 0);
            if (custoUnit > 0) {
              const custoAnterior = estoqueAtual?.custoMedio ? Number(estoqueAtual.custoMedio) : (produto.custo ? Number(produto.custo) : 0);
              const novoCMP = qtdAnterior === 0
                ? custoUnit
                : (qtdAnterior * custoAnterior + 1 * custoUnit) / (qtdAnterior + 1);
              await prisma.produto.update({ where: { id: Number(produtoId) }, data: { custo: novoCMP } });
              await prisma.estoque.upsert({
                where: { produtoId_lojaId: { produtoId: Number(produtoId), lojaId: Number(lojaId) } },
                update: { quantidade: { increment: 1 }, custoMedio: novoCMP },
                create: { produtoId: Number(produtoId), lojaId: Number(lojaId), quantidade: 1, custoMedio: novoCMP },
              });
            } else {
              await prisma.estoque.upsert({
                where: { produtoId_lojaId: { produtoId: Number(produtoId), lojaId: Number(lojaId) } },
                update: { quantidade: { increment: 1 } },
                create: { produtoId: Number(produtoId), lojaId: Number(lojaId), quantidade: 1 },
              });
            }
            await prisma.logEstoque.create({
              data: {
                tipo: 'ENTRADA', origem: 'ENTRADA_AVULSA', produtoId: Number(produtoId), lojaId: Number(lojaId),
                quantidade: 1, quantidadeAnterior: qtdAnterior, quantidadeNova: qtdAnterior + 1, usuarioId: userId,
              },
            });

            criados.push(unidade);
          } catch (e: any) {
            erros.push(e.message || 'Erro ao criar chassi');
          }
        }

        return res.json({ sucesso: true, criados: criados.length, erros });
      }

      // ── PECA: incrementar estoque ──────────────────────────────────────────
      const qtd = Math.max(1, Number(quantidade) || 1);
      const resultado = await InventoryService.darEntrada({
        tipo: 'ENTRADA', origem: 'ENTRADA_AVULSA',
        produtoId: Number(produtoId), lojaId: Number(lojaId),
        quantidade: qtd, usuarioId: userId,
      });

      if (!resultado.success) return res.status(500).json({ error: resultado.error });

      // Atualizar custo se informado
      const custoNum = custo ? Number(custo) : 0;
      if (custoNum > 0) await prisma.produto.update({ where: { id: Number(produtoId) }, data: { custo: custoNum } });

      res.json({ sucesso: true, quantidade: qtd, observacao: observacao || null });
    } catch (err: any) {
      console.error('[Entrada Avulsa]', err);
      res.status(500).json({ error: err.message || 'Erro interno' });
    }
  }
);

// Novo endpoint: resumo hierarquico por grupo
router.get('/grupo-resumo', async (req: AuthRequest, res) => {
  try {
    const role = req.user?.role;
    let gruposWhere: any = {};

    if (role !== 'ADMIN_GERAL') {
      let grupoId = req.user?.grupoId;
      if (!grupoId && req.user?.lojaId) {
        const loja = await prisma.loja.findUnique({ where: { id: req.user.lojaId } });
        grupoId = loja?.grupoId ?? undefined;
      }
      if (!grupoId) return res.status(400).json({ error: 'Usuário não pertence a um grupo' });
      gruposWhere = { id: grupoId };
    }

    const grupos = await prisma.grupo.findMany({
      where: gruposWhere,
      include: {
        lojas: {
          where: { ativo: true },
          include: {
            estoques: {
              include: { produto: { select: { tipo: true, preco: true } } }
            }
          }
        }
      },
      orderBy: { nome: 'asc' }
    });

    // Buscar ultima movimentacao por loja
    const allLojaIds = grupos.flatMap(g => g.lojas.map(l => l.id));
    const ultimosLogs = await prisma.logEstoque.findMany({
      where: { lojaId: { in: allLojaIds } },
      select: { lojaId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      distinct: ['lojaId']
    });
    const ultimaMovMap = new Map(ultimosLogs.map(l => [l.lojaId, l.createdAt]));

    const resultado = grupos.map(grupo => {
      const lojas = grupo.lojas.map(loja => {
        const totalMotos = loja.estoques
          .filter(e => e.produto.tipo === 'MOTO')
          .reduce((s, e) => s + e.quantidade, 0);
        const totalPecas = loja.estoques
          .filter(e => e.produto.tipo === 'PECA')
          .reduce((s, e) => s + e.quantidade, 0);
        const totalAlertas = loja.estoques.filter(e => e.quantidade <= e.estoqueMinimo && e.estoqueMinimo > 0).length;
        const semEstoque = loja.estoques.filter(e => e.quantidade === 0).length;
        const valorEstimado = loja.estoques.reduce(
          (s, e) => s + (e.quantidade * Number(e.produto.preco)),
          0
        );

        return {
          id: loja.id,
          nomeFantasia: loja.nomeFantasia || loja.razaoSocial,
          razaoSocial: loja.razaoSocial,
          endereco: loja.endereco,
          telefone: loja.telefone,
          email: loja.email,
          ativo: loja.ativo,
          createdAt: loja.createdAt,
          totalMotos,
          totalPecas,
          totalAlertas,
          semEstoque,
          valorEstimado,
          ultimaMovimentacao: ultimaMovMap.get(loja.id) || null
        };
      });

      const totalLojas = lojas.length;
      const totalMotos = lojas.reduce((s, l) => s + l.totalMotos, 0);
      const totalPecas = lojas.reduce((s, l) => s + l.totalPecas, 0);
      const totalAlertas = lojas.reduce((s, l) => s + l.totalAlertas, 0);

      return {
        id: grupo.id,
        nome: grupo.nome,
        totalLojas,
        totalMotos,
        totalPecas,
        totalAlertas,
        lojas
      };
    });

    res.json(resultado);
  } catch (error) {
    console.error('Erro ao buscar resumo de grupos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Novo endpoint: detalhes completos de uma loja
router.get('/loja/:lojaId/detalhes', async (req: AuthRequest, res) => {
  try {
    const lojaId = Number(req.params.lojaId);
    if (isNaN(lojaId)) return res.status(400).json({ error: 'ID inválido' });

    // Validar acesso multi-tenant
    const role = req.user?.role;
    if (role !== 'ADMIN_GERAL') {
      if (req.user?.lojaId && req.user.lojaId !== lojaId) {
        return res.status(403).json({ error: 'Acesso negado' });
      }
      if (req.user?.grupoId) {
        const loja = await prisma.loja.findFirst({ where: { id: lojaId, grupoId: req.user.grupoId } });
        if (!loja) return res.status(403).json({ error: 'Acesso negado' });
      }
    }

    const [loja, itensEstoque, vendas, os, logs] = await Promise.all([
      prisma.loja.findUnique({
        where: { id: lojaId },
        include: {
          grupo: { select: { id: true, nome: true } },
          usuarios: { where: { role: 'DONO_LOJA' }, select: { nome: true, email: true } }
        }
      }),
      prisma.estoque.findMany({
        where: { lojaId },
        include: { produto: { select: { id: true, nome: true, tipo: true, preco: true, codigo: true } } },
        orderBy: { produto: { nome: 'asc' } }
      }),
      prisma.venda.findMany({
        where: { lojaId, deletedAt: null },
        include: {
          cliente: { select: { nome: true } },
          vendedor: { select: { nome: true } },
          itens: {
            include: { produto: { select: { nome: true, tipo: true } } }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 30
      }),
      prisma.ordemServico.findMany({
        where: { lojaId },
        include: {
          cliente: { select: { nome: true } },
          itens: {
            include: { produto: { select: { nome: true } }, servico: { select: { nome: true } } }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 30
      }),
      prisma.logEstoque.findMany({
        where: { lojaId },
        include: {
          produto: { select: { nome: true, tipo: true } },
          usuario: { select: { nome: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 100
      })
    ]);

    if (!loja) return res.status(404).json({ error: 'Loja não encontrada' });

    const totalMotos = itensEstoque
      .filter(e => e.produto.tipo === 'MOTO')
      .reduce((s, e) => s + e.quantidade, 0);
    const totalPecas = itensEstoque
      .filter(e => e.produto.tipo === 'PECA')
      .reduce((s, e) => s + e.quantidade, 0);
    const totalAlertas = itensEstoque.filter(e => e.quantidade <= e.estoqueMinimo && e.estoqueMinimo > 0).length;
    const semEstoque = itensEstoque.filter(e => e.quantidade === 0).length;
    const valorEstimado = itensEstoque.reduce((s, e) => s + (e.quantidade * Number(e.produto.preco)), 0);
    const ultimaMovimentacao = logs[0]?.createdAt || null;

    res.json({
      loja,
      resumo: { totalMotos, totalPecas, totalAlertas, semEstoque, valorEstimado, ultimaMovimentacao },
      itens: itensEstoque,
      vendas,
      os,
      logs,
      alertas: itensEstoque.filter(e => e.quantidade <= e.estoqueMinimo && e.estoqueMinimo > 0)
    });
  } catch (error) {
    console.error('Erro ao buscar detalhes da loja:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/', async (req: AuthRequest, res) => {
  try {
    const filter = applyTenantFilter(req);

    const where: any = {};
    if (filter.lojaId) where.lojaId = filter.lojaId;
    if (filter.grupoId) where.loja = { grupoId: filter.grupoId };

    const estoques = await prisma.estoque.findMany({
      where,
      include: { produto: true, loja: { include: { grupo: true } } },
      orderBy: { produto: { nome: 'asc' } }
    });

    res.json(estoques);
  } catch (error) {
    console.error('Erro ao listar estoque:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/alertas', async (req: AuthRequest, res) => {
  try {
    const filter = applyTenantFilter(req);

    const where: any = {};
    if (filter.lojaId) where.lojaId = filter.lojaId;
    if (filter.grupoId) where.loja = { grupoId: filter.grupoId };

    const estoques = await prisma.estoque.findMany({
      where,
      include: { produto: true, loja: true }
    });

    const alertas = estoques.filter(e => e.quantidade <= e.estoqueMinimo);

    res.json(alertas);
  } catch (error) {
    console.error('Erro ao listar alertas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/', requireRole('ADMIN_GERAL', 'DONO_LOJA', 'GERENTE_LOJA'), async (req: AuthRequest, res) => {
  try {
    const { produtoId, lojaId, quantidade, estoqueMinimo, estoqueMaximo } = req.body;

    if (!produtoId || !lojaId) {
      return res.status(400).json({ error: 'Produto e loja são obrigatórios' });
    }

    const estoque = await prisma.estoque.upsert({
      where: {
        produtoId_lojaId: {
          produtoId: Number(produtoId),
          lojaId: Number(lojaId)
        }
      },
      update: {
        quantidade: Number(quantidade || 0),
        estoqueMinimo: Number(estoqueMinimo || 0),
        estoqueMaximo: Number(estoqueMaximo || 0)
      },
      create: {
        produtoId: Number(produtoId),
        lojaId: Number(lojaId),
        quantidade: Number(quantidade || 0),
        estoqueMinimo: Number(estoqueMinimo || 0),
        estoqueMaximo: Number(estoqueMaximo || 0)
      },
      include: { produto: true, loja: true }
    });

    res.json(estoque);
  } catch (error) {
    console.error('Erro ao atualizar estoque:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.put('/:id', requireRole('ADMIN_GERAL', 'ADMIN_FINANCEIRO', 'DONO_LOJA', 'GERENTE_LOJA'), async (req: AuthRequest, res) => {
  try {
    const { quantidade, estoqueMinimo, estoqueMaximo, custoMedio, precoVenda } = req.body;

    const estoque = await prisma.estoque.update({
      where: { id: Number(req.params.id) },
      data: {
        quantidade: quantidade !== undefined ? Number(quantidade) : undefined,
        estoqueMinimo: estoqueMinimo !== undefined ? Number(estoqueMinimo) : undefined,
        estoqueMaximo: estoqueMaximo !== undefined ? Number(estoqueMaximo) : undefined,
        custoMedio: custoMedio !== undefined ? Number(custoMedio) : undefined,
        precoVenda: precoVenda !== undefined ? (precoVenda === null ? null : Number(precoVenda)) : undefined,
      },
      include: { produto: true, loja: true }
    });

    res.json(estoque);
  } catch (error) {
    console.error('Erro ao atualizar estoque:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ─── Remover produto do estoque (apenas qtd=0 e sem chassi em ESTOQUE) ────────
router.delete('/:id(\\d+)', requireRole('ADMIN_GERAL'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const estoque = await prisma.estoque.findUnique({
      where: { id },
      include: { produto: true }
    });
    if (!estoque) return res.status(404).json({ error: 'Registro de estoque não encontrado' });
    if (estoque.quantidade > 0) return res.status(400).json({ error: `Estoque deve estar zerado para remover. Quantidade atual: ${estoque.quantidade}` });

    const chassiAtivos = await prisma.unidadeFisica.count({
      where: { produtoId: estoque.produtoId, lojaId: estoque.lojaId, status: 'ESTOQUE' }
    });
    if (chassiAtivos > 0) return res.status(400).json({ error: `Existem ${chassiAtivos} chassi(s) com status ESTOQUE. Remova-os primeiro.` });

    await prisma.estoque.delete({ where: { id } });
    res.json({ sucesso: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Erro interno' });
  }
});

// ─── VISÃO GERENCIAL POR EMPRESA / CNPJ ──────────────────────────────────────
router.get('/empresa/:lojaId', async (req: AuthRequest, res) => {
  try {
    const lojaId = Number(req.params.lojaId);
    if (isNaN(lojaId)) return res.status(400).json({ error: 'ID inválido' });

    const role = req.user!.role;

    // Qualquer usuário autenticado pode consultar estoque de qualquer loja (para busca e solicitação de transferência)
    // Restrições de escrita são controladas nas rotas de criação/edição

    const loja = await prisma.loja.findUnique({
      where: { id: lojaId },
      include: { grupo: { select: { id: true, nome: true } } }
    });
    if (!loja) return res.status(404).json({ error: 'Empresa não encontrada' });

    const [estoques, unidades, pedidosPendentes, logsRecentes] = await Promise.all([
      prisma.estoque.findMany({
        where: { lojaId },
        include: {
          produto: { select: { id: true, nome: true, tipo: true, preco: true, custo: true, codigo: true } }
        },
        orderBy: { produto: { nome: 'asc' } }
      }),
      prisma.unidadeFisica.findMany({
        where: { lojaId },
        include: { produto: { select: { id: true, nome: true, tipo: true } } },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.pedidoCompra.count({ where: { lojaId, status: { in: ['PENDENTE', 'APROVADO'] } } }),
      prisma.logEstoque.findMany({
        where: { lojaId },
        include: {
          produto: { select: { nome: true, tipo: true } },
          usuario: { select: { nome: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: 50
      }),
    ]);

    // Totalizadores gerenciais
    const motosEstoque  = estoques.filter(e => e.produto.tipo === 'MOTO');
    const pecasEstoque  = estoques.filter(e => e.produto.tipo === 'PECA');
    const totalMotos    = motosEstoque.reduce((s, e) => s + e.quantidade, 0);
    const totalPecas    = pecasEstoque.reduce((s, e) => s + e.quantidade, 0);
    const valorTotalCM  = estoques.reduce((s, e) => {
      const cm = e.custoMedio ? Number(e.custoMedio) : Number(e.produto.custo);
      return s + cm * e.quantidade;
    }, 0);
    const valorTotalPreco = estoques.reduce((s, e) => s + Number(e.produto.preco) * e.quantidade, 0);
    const alertasBaixo  = estoques.filter(e => e.quantidade <= e.estoqueMinimo && e.estoqueMinimo > 0).length;
    const semGiro       = estoques.filter(e => e.quantidade === 0).length;

    // Visão gerencial por modelo (produto)
    const gerencial = estoques.map(e => ({
      id: e.id,
      produtoId: e.produtoId,
      nome: e.produto.nome,
      tipo: e.produto.tipo,
      codigo: e.produto.codigo,
      quantidade: e.quantidade,
      estoqueMinimo: e.estoqueMinimo,
      estoqueMaximo: e.estoqueMaximo,
      custoMedio: e.custoMedio ? Number(e.custoMedio) : Number(e.produto.custo),
      precoVenda: e.precoVenda ? Number(e.precoVenda) : Number(e.produto.preco),
      precoVendaLoja: e.precoVenda ? Number(e.precoVenda) : null,
      precoVendaBase: Number(e.produto.preco),
      valorTotalCusto: (e.custoMedio ? Number(e.custoMedio) : Number(e.produto.custo)) * e.quantidade,
      valorTotalPreco: (e.precoVenda ? Number(e.precoVenda) : Number(e.produto.preco)) * e.quantidade,
      alerta: e.quantidade <= e.estoqueMinimo && e.estoqueMinimo > 0,
      semEstoque: e.quantidade === 0,
    }));

    // Visão unitária (chassi)
    const unitaria = unidades.map(u => ({
      id: u.id,
      produtoId: u.produtoId,
      modeloNome: u.produto.nome,
      chassi: u.chassi,
      codigoMotor: u.codigoMotor,
      cor: u.cor,
      ano: u.ano,
      status: u.status,
      createdAt: u.createdAt,
    }));

    res.json({
      empresa: {
        id: loja.id,
        cnpj: loja.cnpj,
        razaoSocial: loja.razaoSocial,
        nomeFantasia: loja.nomeFantasia,
        grupoNome: loja.grupo.nome,
      },
      totalizadores: {
        totalMotos,
        totalPecas,
        totalItens: totalMotos + totalPecas,
        valorTotalCusto: valorTotalCM,
        valorTotalVenda: valorTotalPreco,
        alertasBaixoEstoque: alertasBaixo,
        semGiro,
        pedidosPendentes,
        unidadesTotal: unidades.length,
        unidadesEmEstoque: unidades.filter(u => u.status !== 'VENDIDA').length,
        unidadesVendidas: unidades.filter(u => u.status === 'VENDIDA').length,
      },
      gerencial,
      unitaria,
      logsRecentes,
    });
  } catch (error) {
    console.error('Erro ao buscar estoque empresa:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ─── BUSCA CROSS-REDE ─────────────────────────────────────────────────────────
// Qualquer usuário autenticado pode buscar produto em todas as lojas da rede
router.get('/buscar-rede', async (req: AuthRequest, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q || q.length < 2) return res.json([]);

    const estoques = await prisma.estoque.findMany({
      where: {
        quantidade: { gt: 0 },
        loja: { ativo: true },
        produto: {
          OR: [
            { nome: { contains: q, mode: 'insensitive' } },
            { codigo: { contains: q, mode: 'insensitive' } },
          ]
        }
      },
      include: {
        produto: { select: { id: true, nome: true, tipo: true, codigo: true, preco: true } },
        loja: { select: { id: true, nomeFantasia: true, endereco: true } }
      },
      orderBy: { produto: { nome: 'asc' } }
    });

    // Agrupa por produto
    const byProduct = new Map<number, { produto: any; lojas: any[] }>();
    for (const e of estoques) {
      if (!byProduct.has(e.produtoId)) {
        byProduct.set(e.produtoId, { produto: e.produto, lojas: [] });
      }
      byProduct.get(e.produtoId)!.lojas.push({
        lojaId: e.lojaId,
        nomeFantasia: e.loja.nomeFantasia,
        endereco: e.loja.endereco,
        quantidade: e.quantidade,
      });
    }

    res.json(Array.from(byProduct.values()));
  } catch (error) {
    console.error('Erro na busca cross-rede:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ─── VISÃO CONSOLIDADA (todos os CNPJs) ───────────────────────────────────────
router.get('/consolidado', requireRole('ADMIN_GERAL', 'ADMIN_FINANCEIRO'), async (req: AuthRequest, res) => {
  try {
    const lojas = await prisma.loja.findMany({
      where: { ativo: true },
      include: {
        grupo: { select: { id: true, nome: true } },
        estoques: {
          include: { produto: { select: { tipo: true, preco: true, custo: true } } }
        },
        _count: { select: { unidades: true, pedidosCompra: { where: { status: { in: ['PENDENTE', 'APROVADO'] } } } } }
      },
      orderBy: { razaoSocial: 'asc' }
    });

    const resultado = lojas.map(loja => {
      const totalMotos  = loja.estoques.filter(e => e.produto.tipo === 'MOTO').reduce((s, e) => s + e.quantidade, 0);
      const totalPecas  = loja.estoques.filter(e => e.produto.tipo === 'PECA').reduce((s, e) => s + e.quantidade, 0);
      const valorCusto  = loja.estoques.reduce((s, e) => {
        const cm = e.custoMedio ? Number(e.custoMedio) : Number(e.produto.custo);
        return s + cm * e.quantidade;
      }, 0);
      const valorPreco  = loja.estoques.reduce((s, e) => s + Number(e.produto.preco) * e.quantidade, 0);
      const alertas     = loja.estoques.filter(e => e.quantidade <= e.estoqueMinimo && e.estoqueMinimo > 0).length;

      return {
        lojaId: loja.id,
        cnpj: loja.cnpj,
        razaoSocial: loja.razaoSocial,
        nomeFantasia: loja.nomeFantasia,
        grupoId: loja.grupoId,
        grupoNome: loja.grupo.nome,
        totalMotos,
        totalPecas,
        totalItens: totalMotos + totalPecas,
        valorTotalCusto: valorCusto,
        valorTotalVenda: valorPreco,
        alertas,
        unidades: loja._count.unidades,
        pedidosPendentes: loja._count.pedidosCompra,
      };
    });

    const totais = {
      totalEmpresas: resultado.length,
      totalMotos: resultado.reduce((s, l) => s + l.totalMotos, 0),
      totalPecas: resultado.reduce((s, l) => s + l.totalPecas, 0),
      valorTotalCusto: resultado.reduce((s, l) => s + l.valorTotalCusto, 0),
      valorTotalVenda: resultado.reduce((s, l) => s + l.valorTotalVenda, 0),
      totalAlertas: resultado.reduce((s, l) => s + l.alertas, 0),
    };

    res.json({ totais, empresas: resultado });
  } catch (error) {
    console.error('Erro ao buscar estoque consolidado:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ─── ESTOQUE GERAL (listagem cross-store: Motos por chassi + Peças por qtd) ────
router.get('/geral', async (req: AuthRequest, res) => {
  try {
    const { lojaId: qLojaId, tipo, chassi, modelo, statusUni } = req.query as Record<string, string>;
    const filter = applyTenantFilter(req);
    const role = req.user?.role;

    // ── Motos (UnidadeFisica) ────────────────────────────────────────────────
    const motoWhere: any = {};
    if (filter.lojaId)          motoWhere.lojaId = filter.lojaId;
    else if (filter.grupoId)    motoWhere.loja   = { grupoId: filter.grupoId };
    if (qLojaId)                motoWhere.lojaId = Number(qLojaId);
    if (statusUni)              motoWhere.status = statusUni;

    // produto filter sempre tem tipo MOTO
    const prodMotoFilter: any = { tipo: 'MOTO' };
    if (modelo) prodMotoFilter.nome = { contains: modelo, mode: 'insensitive' };
    motoWhere.produto = prodMotoFilter;

    if (chassi) motoWhere.chassi = { contains: chassi, mode: 'insensitive' };

    const unidades = (!tipo || tipo === 'MOTO')
      ? await prisma.unidadeFisica.findMany({
          where: motoWhere,
          include: {
            produto: { select: { id: true, nome: true, codigo: true, custo: true, preco: true } },
            loja:    { select: { id: true, nomeFantasia: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 500,
        })
      : [];

    // ── Peças (Estoque por produto/loja) ─────────────────────────────────────
    const pecaWhere: any = {};
    if (filter.lojaId)       pecaWhere.lojaId = filter.lojaId;
    else if (filter.grupoId) pecaWhere.loja   = { grupoId: filter.grupoId };
    if (qLojaId)             pecaWhere.lojaId = Number(qLojaId);

    const prodPecaFilter: any = { tipo: 'PECA' };
    if (modelo) prodPecaFilter.nome = { contains: modelo, mode: 'insensitive' };
    pecaWhere.produto = prodPecaFilter;

    const pecas = (!tipo || tipo === 'PECA')
      ? await prisma.estoque.findMany({
          where: pecaWhere,
          include: {
            produto: { select: { id: true, nome: true, codigo: true, tipo: true, custo: true, preco: true } },
            loja:    { select: { id: true, nomeFantasia: true } },
          },
          orderBy: { produto: { nome: 'asc' } },
          take: 500,
        })
      : [];

    const verCustos = ['ADMIN_GERAL', 'ADMIN_FINANCEIRO', 'ADMIN_REDE'].includes(role || '');

    res.json({ unidades, pecas, verCustos });
  } catch (error) {
    console.error('[EstoqueGeral]', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ─── SAÍDA AVULSA ─────────────────────────────────────────────────────────────
// Saída manual de estoque sem gerar financeiro.
// Para MOTO: marca UnidadeFisica como VENDIDA + decrementa Estoque.
// Para PECA: decrementa Estoque.
router.post(
  '/saida-avulsa',
  requireRole('ADMIN_GERAL', 'ADMIN_FINANCEIRO', 'ADMIN_REDE', 'DONO_LOJA', 'GERENTE_LOJA'),
  async (req: AuthRequest, res) => {
    try {
      const { produtoId, lojaId, tipo, quantidade, chassi, motivo, observacao } = req.body;
      const userId = req.user!.id;

      if (!produtoId || !lojaId) return res.status(400).json({ error: 'produtoId e lojaId são obrigatórios' });
      if (!motivo?.trim())       return res.status(400).json({ error: 'Motivo é obrigatório para saída avulsa' });

      const produto = await prisma.produto.findUnique({ where: { id: Number(produtoId) } });
      if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });

      const tipoProd = tipo || produto.tipo;
      const origemStr = observacao?.trim()
        ? `SAIDA_AVULSA | ${motivo.trim()} — ${observacao.trim()}`
        : `SAIDA_AVULSA | ${motivo.trim()}`;

      // ── MOTO ──────────────────────────────────────────────────────────────
      if (tipoProd === 'MOTO') {
        if (!chassi?.trim()) return res.status(400).json({ error: 'Chassi obrigatório para saída de Moto' });

        const unidade = await prisma.unidadeFisica.findFirst({
          where: { chassi: chassi.trim(), lojaId: Number(lojaId) },
        });
        if (!unidade)                 return res.status(404).json({ error: `Chassi "${chassi}" não encontrado nesta loja` });
        if (unidade.status !== 'ESTOQUE') return res.status(400).json({ error: `Chassi "${chassi}" não está disponível (status: ${unidade.status})` });

        const estoqueReg = await prisma.estoque.findUnique({
          where: { produtoId_lojaId: { produtoId: Number(produtoId), lojaId: Number(lojaId) } },
        });
        const qtdAnterior = estoqueReg?.quantidade ?? 0;
        const qtdNova     = Math.max(0, qtdAnterior - 1);

        await prisma.$transaction([
          prisma.unidadeFisica.update({ where: { id: unidade.id }, data: { status: 'VENDIDA' } }),
          prisma.estoque.upsert({
            where:  { produtoId_lojaId: { produtoId: Number(produtoId), lojaId: Number(lojaId) } },
            update: { quantidade: qtdNova },
            create: { produtoId: Number(produtoId), lojaId: Number(lojaId), quantidade: 0 },
          }),
          prisma.logEstoque.create({
            data: {
              tipo: 'SAIDA', origem: origemStr,
              produtoId: Number(produtoId), lojaId: Number(lojaId),
              quantidade: 1, quantidadeAnterior: qtdAnterior, quantidadeNova: qtdNova,
              usuarioId: userId,
            },
          }),
        ]);

        return res.json({ sucesso: true, chassi: chassi.trim() });
      }

      // ── PECA ──────────────────────────────────────────────────────────────
      const qtd = Math.max(1, Number(quantidade) || 1);
      const estoqueReg = await prisma.estoque.findUnique({
        where: { produtoId_lojaId: { produtoId: Number(produtoId), lojaId: Number(lojaId) } },
      });
      const qtdAnterior = estoqueReg?.quantidade ?? 0;

      if (qtdAnterior < qtd) {
        return res.status(400).json({ error: `Estoque insuficiente. Disponível: ${qtdAnterior}` });
      }

      const qtdNova = qtdAnterior - qtd;
      await prisma.$transaction([
        prisma.estoque.update({
          where: { produtoId_lojaId: { produtoId: Number(produtoId), lojaId: Number(lojaId) } },
          data:  { quantidade: qtdNova },
        }),
        prisma.logEstoque.create({
          data: {
            tipo: 'SAIDA', origem: origemStr,
            produtoId: Number(produtoId), lojaId: Number(lojaId),
            quantidade: qtd, quantidadeAnterior: qtdAnterior, quantidadeNova: qtdNova,
            usuarioId: userId,
          },
        }),
      ]);

      res.json({ sucesso: true, quantidade: qtd });
    } catch (err: any) {
      console.error('[SaídaAvulsa]', err);
      res.status(500).json({ error: err.message || 'Erro interno' });
    }
  }
);

// ─── HISTÓRICO DE MOVIMENTAÇÕES (logs com filtros avançados) ──────────────────
router.get('/historico', async (req: AuthRequest, res) => {
  try {
    const { lojaId: qLojaId, tipo, dias, chassi, modelo, usuarioId: qUsuarioId } = req.query as Record<string, string>;
    const filter = applyTenantFilter(req);

    const where: any = {};
    if (filter.lojaId)       where.lojaId = filter.lojaId;
    else if (filter.grupoId) where.loja   = { grupoId: filter.grupoId };
    if (qLojaId)             where.lojaId = Number(qLojaId);
    if (tipo)                where.tipo   = tipo;
    if (qUsuarioId)          where.usuarioId = Number(qUsuarioId);

    if (dias) {
      const desde = new Date();
      desde.setDate(desde.getDate() - Number(dias));
      where.createdAt = { gte: desde };
    }

    if (chassi || modelo) {
      where.produto = {};
      if (modelo) where.produto.nome = { contains: modelo, mode: 'insensitive' };
    }

    const logs = await prisma.logEstoque.findMany({
      where,
      include: {
        produto: { select: { nome: true, tipo: true, codigo: true } },
        loja:    { select: { id: true, nomeFantasia: true } },
        usuario: { select: { id: true, nome: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    // Post-filter por chassi (origemId aponta para unidadeFisica)
    const filtrado = chassi
      ? logs.filter(l => l.origem.toLowerCase().includes(chassi.toLowerCase()))
      : logs;

    res.json(filtrado);
  } catch (error) {
    console.error('[Histórico]', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

export default router;
