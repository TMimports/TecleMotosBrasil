/**
 * PREVIEW — NORMALIZAÇÃO DE NOMES DE PRODUTO
 *
 * SOMENTE LEITURA. Não altera dados.
 * Mostra quais produtos seriam afetados pela normalização de nomes.
 * Exemplos: TM11 = TM 11 = TM-11 seriam tratados como o mesmo produto.
 *
 * Como rodar:
 *   npx tsx scripts/preview-normalizar-produtos.ts
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

function normalizar(nome: string): string {
  return nome.trim().toUpperCase().replace(/[\s\-_]+/g, '');
}

async function main() {
  H1('PREVIEW — NORMALIZAÇÃO DE NOMES DE PRODUTO (SOMENTE LEITURA)');

  const produtos = await prisma.produto.findMany({
    include: {
      _count: { select: { estoques: true, unidades: true } }
    },
    orderBy: { nome: 'asc' }
  });

  INFO(`Total de produtos: ${produtos.length}`);

  // Agrupar por nome normalizado
  const grupos = new Map<string, typeof produtos>();
  for (const p of produtos) {
    const chave = normalizar(p.nome);
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave)!.push(p);
  }

  H2('Grupos com nomes similares (candidatos à unificação)');
  let totalDuplicatas = 0;
  let totalProdutosAfetados = 0;

  for (const [chave, lista] of grupos.entries()) {
    if (lista.length < 2) continue;
    totalDuplicatas++;
    totalProdutosAfetados += lista.length;

    ERR(`Chave normalizada: "${chave}" → ${lista.length} produtos similares`);
    for (const p of lista) {
      const principal = lista.reduce((a, b) =>
        (a._count.unidades + a._count.estoques) >= (b._count.unidades + b._count.estoques) ? a : b
      );
      const label = p.id === principal.id ? ' ← MANTER (mais dados)' : ' ← seria unificado para o principal';
      ROW(`  ID=${p.id} | ${p.tipo} | "${p.nome}" | Ativo: ${p.ativo} | Estoque em: ${p._count.estoques} loja(s) | Unidades: ${p._count.unidades}${label}`);
    }

    // Mostrar o que seria feito se o merge fosse executado
    const principal = lista.reduce((a, b) =>
      (a._count.unidades + a._count.estoques) >= (b._count.unidades + b._count.estoques) ? a : b
    );
    const secundarios = lista.filter(p => p.id !== principal.id);
    ROW(`  Ação (preview): manter ID=${principal.id} "${principal.nome}", redirecionar FK de ${secundarios.map(p => `ID=${p.id}`).join(', ')}`);
  }

  if (totalDuplicatas === 0) {
    OK('Nenhum grupo de nomes similares encontrado.');
  } else {
    WARN(`${totalDuplicatas} grupo(s) com nomes similares. ${totalProdutosAfetados} produto(s) seriam afetados.`);
  }

  // Mostrar padrões conhecidos
  H2('Verificação de padrões conhecidos');
  const padroes = [
    'TM11', 'TM13', 'ETREK', 'YEP', 'FRANKFURT', 'MONACO', 'BABY', 'EKKO',
    'SUNRA', 'ELECTRIC', 'ELETRIC', 'SPORT', 'PRO'
  ];

  for (const padrao of padroes) {
    const encontrados = produtos.filter(p =>
      normalizar(p.nome).includes(normalizar(padrao))
    );
    if (encontrados.length > 1) {
      WARN(`Padrão "${padrao}": ${encontrados.length} produtos encontrados:`);
      for (const p of encontrados) {
        ROW(`  ID=${p.id} | "${p.nome}" | ${p.tipo} | ${p.ativo ? 'Ativo' : 'Inativo'}`);
      }
    } else if (encontrados.length === 1) {
      OK(`Padrão "${padrao}": 1 produto — ID=${encontrados[0].id} "${encontrados[0].nome}"`);
    } else {
      INFO(`Padrão "${padrao}": nenhum produto encontrado.`);
    }
  }

  H2('Resumo');
  WARN('NENHUMA operação foi executada. Para normalizar nomes:');
  ROW('  1. Confirme quais produtos devem ser unificados');
  ROW('  2. Faça backup do banco antes');
  ROW('  3. Execute o merge em transação com rollback disponível');
  ROW('  4. Atualize: Estoque, UnidadeFisica, ItemVenda, ItemOS, LogEstoque, etc.');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Erro:', e);
  await prisma.$disconnect();
  process.exit(1);
});
