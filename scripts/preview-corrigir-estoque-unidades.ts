/**
 * PREVIEW — CORREÇÃO DE DIVERGÊNCIAS ESTOQUE AGREGADO x UNIDADES FÍSICAS
 *
 * SOMENTE LEITURA. Não altera dados.
 * Identifica e mostra o que seria corrigido nas divergências entre
 * Estoque.quantidade e o count de UnidadeFisica em ESTOQUE.
 *
 * Como rodar:
 *   npx tsx scripts/preview-corrigir-estoque-unidades.ts
 *
 * Para filtrar por loja:
 *   LOJA_ID=5 npx tsx scripts/preview-corrigir-estoque-unidades.ts
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
  const lojaIdFiltro = process.env.LOJA_ID ? Number(process.env.LOJA_ID) : null;

  H1('PREVIEW — CORREÇÃO DE ESTOQUE x UNIDADES FÍSICAS (SOMENTE LEITURA)');

  if (lojaIdFiltro) {
    const loja = await prisma.loja.findUnique({ where: { id: lojaIdFiltro } });
    INFO(`Filtrando por loja: ID=${lojaIdFiltro} "${loja?.nomeFantasia || 'N/A'}"`);
  }

  const whereEstoque = lojaIdFiltro ? { lojaId: lojaIdFiltro } : {};
  const whereUnidade = lojaIdFiltro ? { lojaId: lojaIdFiltro, status: 'ESTOQUE' as const } : { status: 'ESTOQUE' as const };

  const estoques = await prisma.estoque.findMany({
    where: { ...whereEstoque, produto: { tipo: 'MOTO' } },
    include: {
      produto: { select: { id: true, nome: true } },
      loja:    { select: { id: true, nomeFantasia: true } }
    }
  });

  const unidades = await prisma.unidadeFisica.findMany({
    where: whereUnidade,
    include: {
      produto: { select: { id: true, nome: true } },
      loja:    { select: { id: true, nomeFantasia: true } }
    }
  });

  // Agrupar unidades por loja+produto
  const mapUnidades = new Map<string, number>();
  for (const u of unidades) {
    const chave = `${u.lojaId}-${u.produtoId}`;
    mapUnidades.set(chave, (mapUnidades.get(chave) || 0) + 1);
  }

  H2('Divergências encontradas — o que seria corrigido');

  let totalDivergencias = 0;
  let totalCorrecoesProposta = 0;

  for (const e of estoques) {
    const chave = `${e.lojaId}-${e.produtoId}`;
    const qtdUnidades = mapUnidades.get(chave) || 0;
    const diferenca = e.quantidade - qtdUnidades;

    if (diferenca === 0) continue;

    totalDivergencias++;
    totalCorrecoesProposta++;

    if (diferenca > 0) {
      WARN(`Estoque MAIOR que UnidadesFísicas:`);
      ROW(`  Loja: "${e.loja.nomeFantasia}" | Produto: "${e.produto.nome}"`);
      ROW(`  Estoque atual: ${e.quantidade} | UnidFís em ESTOQUE: ${qtdUnidades} | Diferença: +${diferenca}`);
      ROW(`  Ação proposta: reduzir Estoque.quantidade de ${e.quantidade} para ${qtdUnidades}`);
      ROW(`  Causa provável: import de planilha anterior que não atualizou Estoque, ou baixa manual incorreta.`);
    } else {
      ERR(`UnidadesFísicas MAIOR que Estoque:`);
      ROW(`  Loja: "${e.loja.nomeFantasia}" | Produto: "${e.produto.nome}"`);
      ROW(`  Estoque atual: ${e.quantidade} | UnidFís em ESTOQUE: ${qtdUnidades} | Diferença: ${diferenca}`);
      ROW(`  Ação proposta: incrementar Estoque.quantidade de ${e.quantidade} para ${qtdUnidades}`);
      ROW(`  Causa provável: UnidadeFisica criada sem atualizar Estoque (bug corrigido na branch atual).`);
    }
  }

  // Unidades sem registro de Estoque
  H2('Produtos com UnidadesFísicas mas SEM Estoque cadastrado');
  for (const [chave, qtd] of mapUnidades.entries()) {
    const [lojaIdStr, produtoIdStr] = chave.split('-');
    const estoqueExiste = estoques.find(e => e.lojaId === Number(lojaIdStr) && e.produtoId === Number(produtoIdStr));
    if (!estoqueExiste) {
      totalDivergencias++;
      const u = unidades.find(u => u.lojaId === Number(lojaIdStr) && u.produtoId === Number(produtoIdStr));
      ERR(`SEM registro de Estoque:`);
      ROW(`  Loja: "${u?.loja.nomeFantasia || lojaIdStr}" | Produto: "${u?.produto.nome || produtoIdStr}"`);
      ROW(`  UnidFís em ESTOQUE: ${qtd}`);
      ROW(`  Ação proposta: criar Estoque com quantidade=${qtd} para esta loja+produto`);
    }
  }

  H2('Resumo');
  INFO(`Registros de Estoque verificados (MOTOs): ${estoques.length}`);
  INFO(`UnidadesFísicas em ESTOQUE verificadas: ${unidades.length}`);

  if (totalDivergencias === 0) {
    OK('Nenhuma divergência encontrada. Estoque e UnidadesFísicas estão consistentes.');
  } else {
    WARN(`${totalDivergencias} divergência(s) encontrada(s).`);
    WARN(`${totalCorrecoesProposta} correção(ões) seriam aplicadas.`);
    console.log('');
    WARN('NENHUMA operação foi executada. Para corrigir:');
    ROW('  1. Revise as divergências acima');
    ROW('  2. Confirme qual é o valor correto (Estoque ou UnidadesFísicas)');
    ROW('  3. Faça backup do banco antes');
    ROW('  4. Execute as correções em transação com rollback disponível');
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Erro:', e);
  await prisma.$disconnect();
  process.exit(1);
});
