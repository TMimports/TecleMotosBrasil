/**
 * Diagnóstico: compara Estoque.quantidade vs UnidadeFisica por produto/loja
 * Uso: node scripts/diagnostico-unidades.js [nomeModelo] [lojaId]
 * Ex:  node scripts/diagnostico-unidades.js TM11 1
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const busca = process.argv[2] || '';
  const lojaFiltro = process.argv[3] ? Number(process.argv[3]) : null;

  console.log('\n=== DIAGNÓSTICO DE UNIDADES FÍSICAS ===');
  console.log(`Filtro produto: "${busca || '(todos)'}"`);
  console.log(`Filtro loja:    ${lojaFiltro ?? '(todas)'}\n`);

  const produtos = await prisma.produto.findMany({
    where: {
      tipo: 'MOTO',
      ativo: true,
      ...(busca ? { nome: { contains: busca } } : {})
    },
    include: {
      estoques: {
        include: { loja: { select: { id: true, nomeFantasia: true } } },
        ...(lojaFiltro ? { where: { lojaId: lojaFiltro } } : {})
      },
      unidades: {
        include: { loja: { select: { id: true, nomeFantasia: true } } },
        ...(lojaFiltro ? { where: { lojaId: lojaFiltro } } : {})
      }
    }
  });

  if (produtos.length === 0) {
    console.log('Nenhum produto MOTO encontrado com esse filtro.');
    return;
  }

  for (const p of produtos) {
    console.log(`\n━━━ ${p.nome} (produtoId: ${p.id}) ━━━`);
    for (const est of p.estoques) {
      const unidadesNaLoja = p.unidades.filter(u => u.lojaId === est.lojaId);
      const porStatus = {
        ESTOQUE:    unidadesNaLoja.filter(u => u.status === 'ESTOQUE').length,
        VENDIDA:    unidadesNaLoja.filter(u => u.status === 'VENDIDA').length,
        MANUTENCAO: unidadesNaLoja.filter(u => u.status === 'MANUTENCAO').length,
        RESERVADA:  unidadesNaLoja.filter(u => u.status === 'RESERVADA').length,
      };
      const ok = est.quantidade <= porStatus.ESTOQUE;
      const alerta = !ok ? ' ⚠ INCONSISTÊNCIA' : ' ✓ OK';

      console.log(`  Loja ${est.lojaId} — ${est.loja.nomeFantasia}`);
      console.log(`    Estoque gerencial: ${est.quantidade}${alerta}`);
      console.log(`    UnidadeFisica total nesta loja: ${unidadesNaLoja.length}`);
      console.log(`      ESTOQUE:    ${porStatus.ESTOQUE}`);
      console.log(`      VENDIDA:    ${porStatus.VENDIDA}`);
      console.log(`      MANUTENCAO: ${porStatus.MANUTENCAO}`);
      console.log(`      RESERVADA:  ${porStatus.RESERVADA}`);

      if (unidadesNaLoja.length > 0) {
        console.log('    Detalhes:');
        for (const u of unidadesNaLoja) {
          console.log(`      id:${u.id} status:${u.status} chassi:${u.chassi || '-'} motor:${u.codigoMotor || '-'} cor:${u.cor || '-'}`);
        }
      }
    }

    if (p.estoques.length === 0) {
      console.log('  Sem registro de Estoque nesta loja.');
      const unidades = p.unidades;
      if (unidades.length > 0) {
        console.log('  UnidadeFisica orphan encontradas:');
        for (const u of unidades) {
          console.log(`    id:${u.id} loja:${u.lojaId} status:${u.status} chassi:${u.chassi || '-'}`);
        }
      }
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
