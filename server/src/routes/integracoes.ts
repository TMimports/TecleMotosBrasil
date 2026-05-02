import { Router } from 'express';
import { prisma } from '../index.js';

const router = Router();

router.post('/leads-test', async (req, res) => {
  const INTEGRATION_TOKEN = process.env.INTEGRATION_TOKEN;

  if (!INTEGRATION_TOKEN) {
    return res.status(500).json({ error: 'INTEGRATION_TOKEN não configurado' });
  }

  const tokenHeader = req.headers['x-integration-token'];
  if (!tokenHeader || tokenHeader !== INTEGRATION_TOKEN) {
    return res.status(401).json({ error: 'Token de integração inválido ou ausente' });
  }

  const { nome, telefone, email } = req.body;
  if (!nome || !telefone) {
    return res.status(400).json({ error: 'nome e telefone são obrigatórios' });
  }

  try {
    const lead = await prisma.cliente.create({
      data: { nome, telefone, email: email ?? null },
    });
    return res.status(201).json({ id: lead.id, nome: lead.nome, telefone: lead.telefone, createdAt: lead.createdAt });
  } catch (err) {
    console.error('[integracoes] Erro ao criar lead:', err);
    return res.status(500).json({ error: 'Erro interno ao registrar lead' });
  }
});

export default router;
