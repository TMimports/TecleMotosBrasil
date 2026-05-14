/**
 * PREVIEW — MERGE DE LOJAS DUPLICADAS
 *
 * SOMENTE LEITURA. Não altera dados.
 * Mostra o que seria realocado de uma loja "origem" para uma "destino"
 * antes de qualquer operação de merge real.
 *
 * Como rodar:
 *   npx tsx scripts/preview-merge-lojas.ts
 *
 * Para especificar lojas:
 *   ORIGEM_ID=2 DESTINO_ID=5 npx tsx scripts/preview-merge-lojas.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SEP  = '═'.repeat(72);
const SEP2 = '─'.repeat(72);
const H1   = (t: string) => console.log(`\n${SEP}\n  ${t}\n${SEP}`);
const H2   = (t: string) => console.log(`\n${SEP2}\n  ${t}\n${SEP2}`);
const WARN = (t: string) => console.log(`  ⚠️   ${t}`);
const INFO = (t: string) => console.log(`  ℹ️   ${t}`);
const ROW  = (t: string) => console.log(`       ${t}`);

async function main() {
  const origemId  = Number(process.env.ORIGEM_ID  || 0);
  const destinoId = Number(process.env.DESTINO_ID || 0);

  H1('PREVIEW — MERGE DE LOJAS (SOMENTE LEITURA)');

  // Listar todas as lojas para o usuário escolher
  const lojas = await prisma.loja.findMany({
    include: {
      grupo: { select: { nome: true } },
      _count: {
        select: {
          estoques: true, unidades: true, vendas: true, usuarios: true,
          logsEstoque: true, ordensServico: true
        }
      }
    },
    orderBy: { nomeFantasia: 'asc' }
  });

  H2('Lojas disponíveis');
  console.log('  ID  | ATIVO | NOME                           | VENDAS | UNID | ESTOQUE');
  console.log('  ----|-------|--------------------------------|--------|------|--------');
  for (const l of lojas) {
    const nome = (l.nomeFantasia || l.razaoSocial).padEnd(30).slice(0, 30);
    console.log(
      `  ${String(l.id).padStart(3)} | ${l.ativo ? '  SIM' : '  NÃO'} | ${nome} | ` +
      `${String(l._count.vendas).padStart(6)} | ${String(l._count.unidades).padStart(4)} | ${String(l._count.estoques).padStart(7)}`
    );
  }

  if (!origemId || !destinoId) {
    console.log('');
    WARN('Para ver preview de merge, defina as variáveis de ambiente:');
    ROW('  ORIGEM_ID=<id_loja_que_sera_mesclada> DESTINO_ID=<id_loja_que_recebe> npx tsx scripts/preview-merge-lojas.ts');
    console.log('');
    INFO('Exemplo: ORIGEM_ID=2 DESTINO_ID=5 npx tsx scripts/preview-merge-lojas.ts');
    await prisma.$disconnect();
    return;
  }

  const origem  = lojas.find(l => l.id === origemId);
  const destino = lojas.find(l => l.id === destinoId);

  if (!origem) { console.log(`\n  🔴 Loja ORIGEM ID=${origemId} não encontrada.`); await prisma.$disconnect(); return; }
  if (!destino) { console.log(`\n  🔴 Loja DESTINO ID=${destinoId} não encontrada.`); await prisma.$disconnect(); return; }

  H1(`PREVIEW: Mesclar "${origem.nomeFantasia || origem.razaoSocial}" → "${destino.nomeFantasia || destino.razaoSocial}"`);
  WARN('Esta operação NÃO foi executada. Este é apenas um preview.');

  H2('O que seria realocado da ORIGEM para o DESTINO:');

  // Estoques
  const estoques = await prisma.estoque.findMany({
    where: { lojaId: origemId },
    include: { produto: { select: { nome: true, tipo: true } } }
  });
  INFO(`Registros de Estoque: ${estoques.length}`);
  for (const e of estoques.slice(0, 20)) {
    const estoqueDestino = await prisma.estoque.findUnique({
      where: { produtoId_lojaId: { produtoId: e.produtoId, lojaId: destinoId } }
    });
    if (estoqueDestino) {
      ROW(`  CONFLITO: "${e.produto.nome}" — Origem: ${e.quantidade} | Destino já tem: ${estoqueDestino.quantidade} → Seria somado: ${e.quantidade + estoqueDestino.quantidade}`);
    } else {
      ROW(`  NOVO: "${e.produto.nome}" → Quantidade: ${e.quantidade} seria movida para o destino`);
    }
  }

  // UnidadesFísicas
  const unidades = await prisma.unidadeFisica.findMany({ where: { lojaId: origemId } });
  INFO(`UnidadesFísicas (chassi): ${unidades.length}`);
  for (const u of unidades.slice(0, 10)) {
    const prod = estoques.find(e => e.produtoId === u.produtoId)?.produto.nome || `Produto ID=${u.produtoId}`;
    ROW(`  Chassi: ${u.chassi || 'N/A'} | Produto: ${prod} | Status: ${u.status}`);
  }
  if (unidades.length > 10) ROW(`  ... e mais ${unidades.length - 10} unidades.`);

  // Usuários
  const usuarios = await prisma.user.findMany({ where: { lojaId: origemId }, select: { nome: true, role: true, email: true } });
  INFO(`Usuários vinculados: ${usuarios.length}`);
  for (const u of usuarios) {
    ROW(`  ${u.nome} (${u.role}) — ${u.email}`);
  }

  // Logs
  const logsCount = await prisma.logEstoque.count({ where: { lojaId: origemId } });
  INFO(`Logs de movimentação: ${logsCount}`);

  // Vendas (NÃO seriam movidas — históricas)
  const vendasCount = await prisma.venda.count({ where: { lojaId: origemId, deletedAt: null } });
  WARN(`Vendas (NÃO seriam movidas — permaneceriam associadas à origem): ${vendasCount}`);

  H2('Resumo do preview');
  WARN('NENHUMA operação foi executada. Para executar o merge real:');
  ROW('  1. Obtenha confirmação explícita do responsável');
  ROW('  2. Faça backup do banco antes');
  ROW('  3. Execute em transação com rollback disponível');
  ROW('  4. Gere relatório final completo');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Erro:', e);
  await prisma.$disconnect();
  process.exit(1);
});
