/**
 * PREVIEW — ÓRFÃOS DE ESTOQUE
 *
 * SOMENTE LEITURA. Não altera dados.
 * Identifica registros de Estoque, UnidadeFisica e LogEstoque
 * que estão com referências inválidas (produto/loja inexistente).
 *
 * Como rodar:
 *   npx tsx scripts/preview-orfaos-estoque.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SEP  = '═'.repeat(72);
const SEP2 = '─'.repeat(72);
const H1   = (t: string) => console.log(`\n${SEP}\n  ${t}\n${SEP}`);
const H2   = (t: string) => console.log(`\n${SEP2}\n  ${t}\n${SEP2}`);
const OK   = (t: string) => console.log(`  ✅  ${t}`);
const WARN = (t: string) => console.log(`  ⚠️   ${t}`);
const ERR  = (t: string) => console.log(`  🔴  ${t}`);
const INFO = (t: string) => console.log(`  ℹ️   ${t}`);
const ROW  = (t: string) => console.log(`       ${t}`);

async function main() {
  H1('PREVIEW — ÓRFÃOS DE ESTOQUE (SOMENTE LEITURA)');

  // Carregar IDs válidos
  const lojaIds     = new Set((await prisma.loja.findMany({ select: { id: true } })).map(l => l.id));
  const produtoIds  = new Set((await prisma.produto.findMany({ select: { id: true } })).map(p => p.id));
  const usuarioIds  = new Set((await prisma.user.findMany({ select: { id: true } })).map(u => u.id));

  INFO(`Lojas válidas: ${lojaIds.size}`);
  INFO(`Produtos válidos: ${produtoIds.size}`);
  INFO(`Usuários válidos: ${usuarioIds.size}`);

  // ── Estoque ───────────────────────────────────────────────────────────────

  H2('Órfãos em Estoque');
  const estoques = await prisma.estoque.findMany();
  const estoqueOrfaos = estoques.filter(
    e => !lojaIds.has(e.lojaId) || !produtoIds.has(e.produtoId)
  );

  if (estoqueOrfaos.length === 0) {
    OK('Nenhum órfão em Estoque.');
  } else {
    for (const e of estoqueOrfaos) {
      ERR(`Estoque ID=${e.id}: lojaId=${e.lojaId} (${lojaIds.has(e.lojaId) ? 'OK' : '❌ INVÁLIDO'}) | produtoId=${e.produtoId} (${produtoIds.has(e.produtoId) ? 'OK' : '❌ INVÁLIDO'}) | Qtd: ${e.quantidade}`);
      ROW(`  Ação proposta: excluir Estoque ID=${e.id} (seguro se quantidade=0; verificar se quantidade>0)`);
    }
  }

  // ── UnidadeFísica ─────────────────────────────────────────────────────────

  H2('Órfãos em UnidadeFísica');
  const unidades = await prisma.unidadeFisica.findMany();
  const unidadeOrfaos = unidades.filter(
    u => !lojaIds.has(u.lojaId) || !produtoIds.has(u.produtoId)
  );

  if (unidadeOrfaos.length === 0) {
    OK('Nenhum órfão em UnidadeFísica.');
  } else {
    for (const u of unidadeOrfaos) {
      ERR(`UnidFís ID=${u.id}: lojaId=${u.lojaId} (${lojaIds.has(u.lojaId) ? 'OK' : '❌ INVÁLIDO'}) | produtoId=${u.produtoId} (${produtoIds.has(u.produtoId) ? 'OK' : '❌ INVÁLIDO'}) | Chassi: ${u.chassi}`);
      ROW(`  Ação proposta: reatribuir para loja/produto correto ou excluir após confirmação`);
    }
  }

  // ── LogEstoque ────────────────────────────────────────────────────────────

  H2('Órfãos em LogEstoque');
  const totalLogs = await prisma.logEstoque.count();
  INFO(`Total de LogEstoque: ${totalLogs}`);

  // Verificar em lotes (pode ser grande)
  const BATCH = 500;
  let offset = 0;
  let orfaosLog = 0;
  const exemploOrfaos: string[] = [];

  while (offset < totalLogs) {
    const lote = await prisma.logEstoque.findMany({ skip: offset, take: BATCH });
    for (const l of lote) {
      const isOrfao = !lojaIds.has(l.lojaId) || !produtoIds.has(l.produtoId) || !usuarioIds.has(l.usuarioId);
      if (isOrfao) {
        orfaosLog++;
        if (exemploOrfaos.length < 10) {
          exemploOrfaos.push(
            `LogEstoque ID=${l.id}: lojaId=${l.lojaId} | produtoId=${l.produtoId} | tipo=${l.tipo} | data=${l.createdAt.toLocaleDateString('pt-BR')}`
          );
        }
      }
    }
    offset += BATCH;
  }

  if (orfaosLog === 0) {
    OK('Nenhum órfão em LogEstoque.');
  } else {
    ERR(`${orfaosLog} log(s) com referência inválida:`);
    for (const ex of exemploOrfaos) {
      ROW(`  ${ex}`);
    }
    if (orfaosLog > 10) ROW(`  ... e mais ${orfaosLog - 10} log(s).`);
    WARN('Ação proposta: limpar logs órfãos (são históricos e podem ser removidos com segurança se a loja/produto não existe mais)');
  }

  // ── Chassis duplicados ────────────────────────────────────────────────────

  H2('Chassis duplicados em UnidadeFísica');
  const chassiGrupos = new Map<string, number[]>();
  for (const u of unidades) {
    if (!u.chassi) continue;
    const chave = u.chassi.trim().toUpperCase();
    if (!chassiGrupos.has(chave)) chassiGrupos.set(chave, []);
    chassiGrupos.get(chave)!.push(u.id);
  }
  const duplicados = [...chassiGrupos.entries()].filter(([, ids]) => ids.length > 1);

  if (duplicados.length === 0) {
    OK('Nenhum chassi duplicado.');
  } else {
    for (const [chassi, ids] of duplicados) {
      ERR(`Chassi duplicado: "${chassi}" — UnidFís IDs: ${ids.join(', ')}`);
      for (const id of ids) {
        const u = unidades.find(u => u.id === id);
        ROW(`  ID=${id} | Loja: lojaId=${u?.lojaId} | Produto: produtoId=${u?.produtoId} | Status: ${u?.status}`);
      }
      ROW(`  Ação proposta: manter o ID mais recente e excluir os duplicados (verificar status e histórico)`);
    }
  }

  // ── Resumo ────────────────────────────────────────────────────────────────

  H2('Resumo Geral');
  const totalOrfaos = estoqueOrfaos.length + unidadeOrfaos.length + orfaosLog + duplicados.length;

  if (totalOrfaos === 0) {
    OK('Base de dados limpa. Nenhum órfão ou duplicata encontrado.');
  } else {
    WARN(`Total de problemas encontrados: ${totalOrfaos}`);
    INFO(`  Estoque com FK inválida: ${estoqueOrfaos.length}`);
    INFO(`  UnidadeFísica com FK inválida: ${unidadeOrfaos.length}`);
    INFO(`  LogEstoque com FK inválida: ${orfaosLog}`);
    INFO(`  Chassis duplicados: ${duplicados.length}`);
    console.log('');
    WARN('NENHUMA operação foi executada. Para limpar órfãos:');
    ROW('  1. Revise cada item acima');
    ROW('  2. Faça backup do banco antes');
    ROW('  3. Execute as limpezas em transação com rollback disponível');
    ROW('  4. Gere relatório final de tudo que foi removido');
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Erro:', e);
  await prisma.$disconnect();
  process.exit(1);
});
