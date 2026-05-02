import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { PrismaClient } from '@prisma/client';

import authRoutes from './routes/auth.js';
import gruposRoutes from './routes/grupos.js';
import lojasRoutes from './routes/lojas.js';
import usuariosRoutes from './routes/usuarios.js';
import produtosRoutes from './routes/produtos.js';
import servicosRoutes from './routes/servicos.js';
import unidadesRoutes from './routes/unidades.js';
import estoqueRoutes from './routes/estoque.js';
import clientesRoutes from './routes/clientes.js';
import vendasRoutes from './routes/vendas.js';
import osRoutes from './routes/ordens-servico.js';
import financeiroRoutes from './routes/financeiro.js';
import comissoesRoutes from './routes/comissoes.js';
import dashboardRoutes from './routes/dashboard.js';
import garantiasRoutes from './routes/garantias.js';
import transferenciasRoutes from './routes/transferencias.js';
import importacaoRoutes from './routes/importacao.js';
import rankingRoutes from './routes/ranking.js';
import franqueadosRoutes from './routes/franqueados.js';
import sistemaRoutes from './routes/sistema.js';
import configuracoesRoutes from './routes/configuracoes.js';
import adminRoutes from './routes/admin.js';
import pedidosCompraRoutes from './routes/pedidos-compra.js';
import auditoriaRoutes from './routes/auditoria.js';
import categoriasFinanceirasRoutes from './routes/categorias-financeiras.js';
import departamentosRoutes from './routes/departamentos.js';
import fornecedoresRoutes from './routes/fornecedores.js';
import crmRoutes from './routes/crm.js';
import integracoesRoutes from './routes/integracoes.js';
import notasFiscaisRoutes from './routes/notas-fiscais.js';
import conciliacaoBancariaRoutes from './routes/conciliacao-bancaria.js';
import relatoriosRoutes from './routes/relatorios.js';
import whatsappRoutes from './routes/whatsapp.js';
import { iniciarScheduler } from './services/scheduler.js';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : []
});

prisma.$connect().then(async () => {
  console.log('Prisma conectado ao banco de dados');

  // Normaliza números de OS existentes (cuid → OS-XXXXX)
  try {
    const todasOS = await prisma.ordemServico.findMany({ select: { id: true, numero: true }, orderBy: { id: 'asc' } });
    const semFormatoOS = todasOS.filter(os => !os.numero.startsWith('OS-'));
    for (const os of semFormatoOS) {
      await prisma.ordemServico.update({ where: { id: os.id }, data: { numero: `OS-${os.id.toString().padStart(5, '0')}` } });
    }
    if (semFormatoOS.length > 0) console.log(`[Init] ${semFormatoOS.length} OS normalizadas para formato sequencial`);
  } catch (e) { console.error('[Init] Erro ao normalizar OS:', e); }

  // Normaliza códigos de produto existentes (cuid → TM{tipo}XXXXX)
  try {
    const prefixoTipo: Record<string, string> = { MOTO: 'MOT', PECA: 'PEC', SERVICO: 'SRV' };
    const todosProdutos = await prisma.produto.findMany({ select: { id: true, codigo: true, tipo: true }, orderBy: { id: 'asc' } });
    const semFormatoProd = todosProdutos.filter(p => !p.codigo.startsWith('TM'));
    for (const p of semFormatoProd) {
      const novoCodigo = `TM${prefixoTipo[p.tipo] || 'PRD'}${p.id.toString().padStart(5, '0')}`;
      await prisma.produto.update({ where: { id: p.id }, data: { codigo: novoCodigo } });
    }
    if (semFormatoProd.length > 0) console.log(`[Init] ${semFormatoProd.length} produtos normalizados para formato sequencial`);
  } catch (e) { console.error('[Init] Erro ao normalizar produtos:', e); }

}).catch((e: Error) => {
  console.error('Erro ao conectar Prisma:', e.message);
});

const app = express();
const isDev = process.env.NODE_ENV !== 'production';

app.use(cors());
app.use(express.json());

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
});

if (isDev) {
  app.get('/api/setup', async (req, res) => {
    try {
      const bcrypt = await import('bcryptjs');
      let admin = await prisma.user.findFirst({ where: { email: 'admin@teclemotos.com' } });
      if (!admin) {
        const senha = await bcrypt.default.hash('123456', 10);
        admin = await prisma.user.create({
          data: { nome: 'Admin Geral', email: 'admin@teclemotos.com', senha, role: 'ADMIN_GERAL', ativo: true }
        });
        res.json({ status: 'Admin criado!', email: 'admin@teclemotos.com', senha: '123456' });
      } else {
        const senha = await bcrypt.default.hash('123456', 10);
        await prisma.user.update({ where: { id: admin.id }, data: { senha, ativo: true, lojaId: null, grupoId: null } });
        res.json({ status: 'Senha resetada!', email: 'admin@teclemotos.com', senha: '123456' });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}

app.use('/api/auth', authRoutes);
app.use('/api/grupos', gruposRoutes);
app.use('/api/lojas', lojasRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/produtos', produtosRoutes);
app.use('/api/servicos', servicosRoutes);
app.use('/api/unidades', unidadesRoutes);
app.use('/api/estoque', estoqueRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/vendas', vendasRoutes);
app.use('/api/os', osRoutes);
app.use('/api/financeiro', financeiroRoutes);
app.use('/api/comissoes', comissoesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/garantias', garantiasRoutes);
app.use('/api/transferencias', transferenciasRoutes);
app.use('/api/importacao', importacaoRoutes);
app.use('/api/ranking', rankingRoutes);
app.use('/api/franqueados', franqueadosRoutes);
app.use('/api/sistema', sistemaRoutes);
app.use('/api/configuracoes', configuracoesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/pedidos-compra', pedidosCompraRoutes);
app.use('/api/auditoria', auditoriaRoutes);
app.use('/api/categorias-financeiras', categoriasFinanceirasRoutes);
app.use('/api/departamentos', departamentosRoutes);
app.use('/api/fornecedores', fornecedoresRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/integracoes', integracoesRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/notas-fiscais', notasFiscaisRoutes);
app.use('/api/conciliacao-bancaria', conciliacaoBancariaRoutes);
app.use('/api/relatorios', relatoriosRoutes);

if (isDev) app.get('/api/debug-build', (req, res) => {
  const fs = require('fs');
  try {
    const distPath = path.join(process.cwd(), 'client/dist');
    const htmlPath = path.join(distPath, 'index.html');
    const assetsPath = path.join(distPath, 'assets');
    
    const htmlExists = fs.existsSync(htmlPath);
    const html = htmlExists ? fs.readFileSync(htmlPath, 'utf8') : 'NOT FOUND';
    const jsMatch = html.match(/index-([^.]+)\.js/);
    const cssMatch = html.match(/index-([^.]+)\.css/);
    const assetFiles = fs.existsSync(assetsPath) ? fs.readdirSync(assetsPath) : [];
    
    const cssFile = assetFiles.find((f: string) => f.endsWith('.css'));
    let hasOldSelectRules = false;
    if (cssFile) {
      const cssContent = fs.readFileSync(path.join(assetsPath, cssFile), 'utf8');
      hasOldSelectRules = /select\.input|select\s*\{[^}]*cursor.*pointer/.test(cssContent);
    }
    
    res.json({
      cwd: process.cwd(),
      distExists: fs.existsSync(distPath),
      htmlExists,
      jsHash: jsMatch ? jsMatch[1] : 'unknown',
      cssHash: cssMatch ? cssMatch[1] : 'unknown',
      assetFiles,
      hasOldSelectRules,
      nodeEnv: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    });
  } catch (e: any) {
    res.json({ error: e.message });
  }
});

if (!isDev) {
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
    next();
  });

  app.use(express.static(path.join(process.cwd(), 'client/dist')));

  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(process.cwd(), 'client/dist/index.html'));
    }
  });
}

const PORT = isDev ? 3001 : (process.env.PORT ? Number(process.env.PORT) : 5000);

async function initializeDatabase() {
  const bcrypt = await import('bcryptjs');
  
  const adminExiste = await prisma.user.findFirst({ where: { role: 'ADMIN_GERAL' } });
  
  if (!adminExiste) {
    console.log('Admin nao encontrado, criando...');
    const senhaAdmin = await bcrypt.default.hash('123456', 10);
    await prisma.user.create({
      data: {
        nome: 'Admin Geral',
        email: 'admin@teclemotos.com',
        senha: senhaAdmin,
        role: 'ADMIN_GERAL',
        ativo: true
      }
    });
    console.log('Admin criado! Login: admin@teclemotos.com / 123456');
  } else {
    const senhaCorreta = await bcrypt.default.compare('123456', adminExiste.senha);
    if (!senhaCorreta) {
      const senhaAdmin = await bcrypt.default.hash('123456', 10);
      await prisma.user.update({
        where: { id: adminExiste.id },
        data: { senha: senhaAdmin, lojaId: null, grupoId: null, ativo: true }
      });
      console.log('Senha do admin corrigida para 123456');
    }
  }
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Servidor ${isDev ? 'DEV' : 'PROD'} rodando em http://0.0.0.0:${PORT}`);
  await initializeDatabase();
  iniciarScheduler();
});

// Em produção, o .replit mapeia tanto a porta 3001 quanto a 5000.
// Sobe um segundo listener na porta alternativa para que o sistema de deploy
// encontre um processo ativo em ambas as portas configuradas.
if (!isDev) {
  const SECONDARY_PORT = PORT === 5000 ? 3001 : 5000;
  app.listen(SECONDARY_PORT, '0.0.0.0', () => {
    console.log(`Porta secundária ${SECONDARY_PORT} ativa`);
  });
}
