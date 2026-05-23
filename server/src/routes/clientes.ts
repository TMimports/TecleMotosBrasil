import { Router } from 'express';
import { prisma } from '../index.js';
import { verifyToken, AuthRequest } from '../middleware/auth.js';
import { registrarLog, obterIp } from '../services/logService.js';

const router = Router();

router.use(verifyToken);

function normalizarDocumento(doc: string): string {
  return doc.replace(/\D/g, '');
}

// ── GET /clientes ─────────────────────────────────────────────────────────────
router.get('/', async (req: AuthRequest, res) => {
  try {
    const where: any = {};

    if (req.user?.role === 'ADMIN_GERAL' || req.user?.role === 'ADMIN_REDE') {
    } else if (req.user?.lojaId) {
      where.OR = [
        { lojaId: req.user.lojaId },
        { lojaId: null, createdBy: null }
      ];
    } else if (req.user?.grupoId) {
      const lojasDoGrupo = await prisma.loja.findMany({
        where: { grupoId: req.user.grupoId },
        select: { id: true }
      });
      const lojaIds = lojasDoGrupo.map(l => l.id);
      where.OR = [
        { lojaId: { in: lojaIds } },
        { lojaId: null, createdBy: null }
      ];
    }

    const clientes = await prisma.cliente.findMany({
      where,
      orderBy: { nome: 'asc' }
    });

    res.json(clientes);
  } catch (error) {
    console.error('Erro ao listar clientes:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /clientes/buscar-cep/:cep ─────────────────────────────────────────────
router.get('/buscar-cep/:cep', async (req: AuthRequest, res) => {
  try {
    const cep = req.params.cep.replace(/\D/g, '');
    if (cep.length !== 8) {
      return res.status(400).json({ error: 'CEP inválido' });
    }

    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const data = await response.json();

    if (data.erro) {
      return res.status(404).json({ error: 'CEP não encontrado' });
    }

    res.json({
      cep: data.cep,
      logradouro: data.logradouro,
      bairro: data.bairro,
      cidade: data.localidade,
      estado: data.uf
    });
  } catch (error) {
    console.error('Erro ao buscar CEP:', error);
    res.status(500).json({ error: 'Erro ao buscar CEP' });
  }
});

// ── GET /clientes/por-documento/:documento ────────────────────────────────────
// Busca cliente por CPF ou CNPJ (com ou sem máscara)
router.get('/por-documento/:documento', async (req: AuthRequest, res) => {
  try {
    const docLimpo = normalizarDocumento(req.params.documento);
    if (docLimpo.length < 11) {
      return res.status(400).json({ error: 'Documento inválido' });
    }

    const cliente = await prisma.cliente.findFirst({
      where: { cpfCnpj: docLimpo }
    });

    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    res.json(cliente);
  } catch (error) {
    console.error('Erro ao buscar por documento:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── GET /clientes/:id ─────────────────────────────────────────────────────────
router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const cliente = await prisma.cliente.findUnique({
      where: { id: Number(req.params.id) },
      include: { vendas: true, ordensServico: true, loja: true }
    });

    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado' });
    }

    const userRole = req.user?.role;
    if (userRole !== 'ADMIN_GERAL' && userRole !== 'ADMIN_REDE') {
      if (req.user?.lojaId) {
        if (cliente.lojaId && cliente.lojaId !== req.user.lojaId) {
          return res.status(403).json({ error: 'Acesso negado' });
        }
      } else if (req.user?.grupoId) {
        if (cliente.loja && cliente.loja.grupoId !== req.user.grupoId) {
          return res.status(403).json({ error: 'Acesso negado' });
        }
      }
    }

    res.json(cliente);
  } catch (error) {
    console.error('Erro ao buscar cliente:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── POST /clientes ────────────────────────────────────────────────────────────
router.post('/', async (req: AuthRequest, res) => {
  try {
    const { nome, cpfCnpj, telefone, email, cep, logradouro, numero, complemento, bairro, cidade, estado, lojaId: lojaIdBody } = req.body;

    if (!nome?.trim()) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    if (!cpfCnpj?.trim()) {
      return res.status(400).json({ error: 'CPF/CNPJ é obrigatório' });
    }

    if (!telefone?.trim() && !email?.trim()) {
      return res.status(400).json({ error: 'Informe pelo menos email ou telefone para envio dos documentos da venda.' });
    }

    const docLimpo = normalizarDocumento(cpfCnpj);
    if (docLimpo.length !== 11 && docLimpo.length !== 14) {
      return res.status(400).json({ error: 'CPF/CNPJ inválido. Informe CPF (11 dígitos) ou CNPJ (14 dígitos).' });
    }

    // Verificar duplicidade por CPF/CNPJ (sempre normalizado — dígitos apenas)
    const existente = await prisma.cliente.findFirst({
      where: { cpfCnpj: docLimpo }
    });
    if (existente) {
      return res.status(409).json({
        error: `Cliente já cadastrado com este ${docLimpo.length === 11 ? 'CPF' : 'CNPJ'}.`,
        clienteId: existente.id,
        clienteNome: existente.nome
      });
    }

    let lojaId = req.user!.lojaId;
    if (!lojaId && lojaIdBody) {
      if (req.user!.role === 'ADMIN_GERAL' || req.user!.role === 'ADMIN_REDE') {
        const lojaExists = await prisma.loja.findFirst({ where: { id: parseInt(lojaIdBody), ativo: true } });
        if (lojaExists) lojaId = lojaExists.id;
      } else if (req.user!.grupoId) {
        const lojaValida = await prisma.loja.findFirst({
          where: { id: parseInt(lojaIdBody), grupoId: req.user!.grupoId, ativo: true }
        });
        if (lojaValida) lojaId = lojaValida.id;
      }
    }
    if (!lojaId && req.user!.grupoId) {
      const primeiraLoja = await prisma.loja.findFirst({
        where: { grupoId: req.user!.grupoId, ativo: true },
        select: { id: true }
      });
      if (primeiraLoja) lojaId = primeiraLoja.id;
    }

    const cliente = await prisma.cliente.create({
      data: {
        nome: nome.trim(),
        cpfCnpj: docLimpo,
        telefone: telefone?.trim() || null,
        email: email?.trim() || null,
        cep: cep?.trim() || null,
        logradouro: logradouro?.trim() || null,
        numero: numero?.trim() || null,
        complemento: complemento?.trim() || null,
        bairro: bairro?.trim() || null,
        cidade: cidade?.trim() || null,
        estado: estado?.trim() || null,
        lojaId,
        createdBy: req.user!.id
      }
    });

    res.status(201).json(cliente);
  } catch (error) {
    console.error('Erro ao criar cliente:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── PUT /clientes/:id ─────────────────────────────────────────────────────────
router.put('/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { nome, cpfCnpj, telefone, email, cep, logradouro, numero, complemento, bairro, cidade, estado } = req.body;

    if (!nome?.trim()) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    if (!cpfCnpj?.trim()) {
      return res.status(400).json({ error: 'CPF/CNPJ é obrigatório' });
    }

    if (!telefone?.trim() && !email?.trim()) {
      return res.status(400).json({ error: 'Informe pelo menos email ou telefone para envio dos documentos da venda.' });
    }

    const docLimpo = normalizarDocumento(cpfCnpj);
    if (docLimpo.length !== 11 && docLimpo.length !== 14) {
      return res.status(400).json({ error: 'CPF/CNPJ inválido.' });
    }

    // Verificar duplicidade excluindo o próprio cliente (sempre normalizado — dígitos apenas)
    const existente = await prisma.cliente.findFirst({
      where: {
        cpfCnpj: docLimpo,
        id: { not: id }
      }
    });
    if (existente) {
      return res.status(409).json({
        error: `Outro cliente já cadastrado com este ${docLimpo.length === 11 ? 'CPF' : 'CNPJ'}.`,
        clienteId: existente.id,
        clienteNome: existente.nome
      });
    }

    const cliente = await prisma.cliente.update({
      where: { id },
      data: {
        nome: nome.trim(),
        cpfCnpj: docLimpo,
        telefone: telefone?.trim() || null,
        email: email?.trim() || null,
        cep: cep?.trim() || null,
        logradouro: logradouro?.trim() || null,
        numero: numero?.trim() || null,
        complemento: complemento?.trim() || null,
        bairro: bairro?.trim() || null,
        cidade: cidade?.trim() || null,
        estado: estado?.trim() || null
      }
    });

    res.json(cliente);
  } catch (error) {
    console.error('Erro ao atualizar cliente:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ── DELETE /clientes/:id ──────────────────────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res) => {
  try {
    const clienteId = Number(req.params.id);

    const [vendasCount, osCount] = await Promise.all([
      prisma.venda.count({ where: { clienteId } }),
      prisma.ordemServico.count({ where: { clienteId } }),
    ]);

    if (vendasCount > 0 || osCount > 0) {
      const refs: string[] = [];
      if (vendasCount > 0) refs.push(`${vendasCount} venda(s)`);
      if (osCount > 0) refs.push(`${osCount} ordem(ns) de serviço`);
      return res.status(400).json({
        error: `Não é possível excluir este cliente pois ele possui ${refs.join(' e ')} vinculada(s).`
      });
    }

    const clienteParaExcluir = await prisma.cliente.findUnique({ where: { id: clienteId }, select: { nome: true } });

    await prisma.cliente.delete({ where: { id: clienteId } });

    registrarLog({
      usuarioId:  req.user?.id,
      userName:   req.user?.nome,
      userRole:   req.user?.role,
      acao:       'EXCLUIR_CLIENTE',
      entidade:   'CLIENTE',
      entidadeId: clienteId,
      detalhes:   `Cliente "${clienteParaExcluir?.nome || clienteId}" excluído`,
      ip: obterIp(req),
    });

    res.json({ message: 'Cliente excluído' });
  } catch (error) {
    console.error('Erro ao excluir cliente:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

export default router;
