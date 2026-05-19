import { Router } from 'express';
import { prisma } from '../index.js';
import { verifyToken, requireAdminGeral, AuthRequest } from '../middleware/auth.js';

const router = Router();

router.use(verifyToken);

router.get('/', async (req: AuthRequest, res) => {
  try {
    const produtos = await prisma.produto.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' }
    });
    res.json(produtos);
  } catch (error) {
    console.error('Erro ao listar produtos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const produto = await prisma.produto.findUnique({
      where: { id: Number(req.params.id) },
      include: { estoques: { include: { loja: true } } }
    });
    if (!produto) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    res.json(produto);
  } catch (error) {
    console.error('Erro ao buscar produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Criação: apenas nome, tipo e descrição obrigatórios.
// Custo e preço são sempre definidos via Pedido de Compra (custo médio ponderado).
router.post('/', requireAdminGeral, async (req: AuthRequest, res) => {
  try {
    const { nome, tipo, descricao } = req.body;

    if (!nome || !tipo) {
      return res.status(400).json({ error: 'Nome e tipo são obrigatórios' });
    }

    const tiposValidos = ['MOTO', 'PECA', 'SERVICO'];
    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({ error: 'Tipo inválido. Use MOTO, PECA ou SERVICO' });
    }

    const produtoCriado = await prisma.produto.create({
      data: {
        nome,
        tipo,
        descricao: descricao || null,
        custo: 0,
        percentualLucro: 0,
        preco: 0,
        createdBy: req.user!.id
      }
    });

    // Atribui código sequencial padronizado baseado no tipo e ID
    const prefixoTipo: Record<string, string> = { MOTO: 'MOT', PECA: 'PEC', SERVICO: 'SRV' };
    const codigoProduto = `TM${prefixoTipo[tipo] || 'PRD'}${produtoCriado.id.toString().padStart(5, '0')}`;
    const produto = await prisma.produto.update({
      where: { id: produtoCriado.id },
      data: { codigo: codigoProduto }
    });

    res.status(201).json(produto);
  } catch (error) {
    console.error('Erro ao criar produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Edição: permite alterar nome, tipo, descrição, ativo e preço/custo.
// Quando preco é alterado, sincroniza com precoVenda de todos os estoques associados.
router.put('/:id', requireAdminGeral, async (req: AuthRequest, res) => {
  try {
    const { nome, tipo, descricao, ativo, custo, percentualLucro, preco } = req.body;

    const data: any = {};
    if (nome !== undefined)             data.nome = nome;
    if (tipo !== undefined)             data.tipo = tipo;
    if (descricao !== undefined)        data.descricao = descricao;
    if (ativo !== undefined)            data.ativo = ativo;
    if (custo !== undefined)            data.custo = Number(custo);
    if (percentualLucro !== undefined)  data.percentualLucro = Number(percentualLucro);
    if (preco !== undefined)            data.preco = Number(preco);

    const produto = await prisma.produto.update({
      where: { id: Number(req.params.id) },
      data
    });

    if (preco !== undefined) {
      await prisma.estoque.updateMany({
        where: { produtoId: produto.id },
        data: { precoVenda: Number(preco) }
      });
    }

    res.json(produto);
  } catch (error) {
    console.error('Erro ao atualizar produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/produtos/normalizar-codigos — corrige codigos com cuid para formato TM{tipo}XXXXX
router.post('/normalizar-codigos', requireAdminGeral, async (req: AuthRequest, res) => {
  try {
    const prefixoTipo: Record<string, string> = { MOTO: 'MOT', PECA: 'PEC', SERVICO: 'SRV' };
    const todos = await prisma.produto.findMany({ orderBy: { id: 'asc' } });
    const semFormato = todos.filter(p => {
      return !p.codigo.startsWith('TM');
    });
    let atualizados = 0;
    for (const p of semFormato) {
      const novoCodigo = `TM${prefixoTipo[p.tipo] || 'PRD'}${p.id.toString().padStart(5, '0')}`;
      await prisma.produto.update({ where: { id: p.id }, data: { codigo: novoCodigo } });
      atualizados++;
    }
    res.json({ message: `${atualizados} produtos atualizados`, total: todos.length, atualizados });
  } catch (error) {
    console.error('Erro ao normalizar códigos de produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/produtos/recodificar — reatribui TODOS os códigos TMMOT/TMPEC/TMSRV
// baseado no tipo atual do produto, renumerando sequencialmente por tipo (ordem por ID)
router.post('/recodificar', requireAdminGeral, async (req: AuthRequest, res) => {
  try {
    const prefixoMap: Record<string, string> = { MOTO: 'TMMOT', PECA: 'TMPEC', SERVICO: 'TMSRV' };

    // Busca todos ordenados por tipo e ID para manter sequência lógica
    const todos = await prisma.produto.findMany({ orderBy: [{ tipo: 'asc' }, { id: 'asc' }] });

    const contadores: Record<string, number> = { MOTO: 1, PECA: 1, SERVICO: 1 };
    let atualizados = 0;

    for (const p of todos) {
      const prefixo = prefixoMap[p.tipo] || 'TMPRD';
      const tipo = p.tipo in contadores ? p.tipo : 'PECA';
      const seq = contadores[tipo]++;
      const novoCodigo = `${prefixo}${String(seq).padStart(5, '0')}`;

      if (p.codigo !== novoCodigo) {
        await prisma.produto.update({ where: { id: p.id }, data: { codigo: novoCodigo } });
        atualizados++;
      }
    }

    res.json({
      message: `Recodificação concluída — ${atualizados} produto(s) atualizados`,
      total: todos.length,
      atualizados,
      contadores: {
        MOTO: contadores.MOTO - 1,
        PECA: contadores.PECA - 1,
        SERVICO: contadores.SERVICO - 1
      }
    });
  } catch (error) {
    console.error('Erro ao recodificar produtos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.delete('/:id', requireAdminGeral, async (req, res) => {
  try {
    await prisma.produto.update({
      where: { id: Number(req.params.id) },
      data: { ativo: false }
    });
    res.json({ message: 'Produto desativado com sucesso' });
  } catch (error) {
    console.error('Erro ao desativar produto:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

export default router;
