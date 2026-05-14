/**
 * AUDITORIA DE ESTOQUE E LOJAS — SOMENTE LEITURA
 *
 * Branch: audit/inventory-store-chassi-import
 * Data  : 2026-05-14
 *
 * NÃO altera, NÃO deleta, NÃO faz upsert.
 * Toda saída vai para o terminal (stdout).
 *
 * Como rodar:
 *   npx tsx scripts/auditoria-estoque-lojas.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SEP  = '═'.repeat(72);
const SEP2 = '─'.repeat(72);
const H1   = (t: string) => console.log(`\n${SEP}\n  ${t}\n${SEP}`);
const H2   = (t: string) => console.log(`\n${SEP2}\n  ${t}\n${SEP2}`);
const OK   = (t: string) => console.log(`  ✅  ${t}`);
const WARN = (t: string) => console.log(`  ⚠️   ${t}`);
const ERR  = (t: string) => console.log(`  🔴  ${t}`);
const INFO = (t: string) => console.log(`  ℹ️   ${t}`);
const ROW  = (t: string) => console.log(`       ${t}`);

/** Normaliza nome de produto: remove espaços extras, hífens e coloca em maiúsculo */
function normalizarNome(nome: string): string {
  return nome.trim().toUpperCase().replace(/[\s\-_]+/g, '');
}

/** Verifica se dois nomes são similares (TM11 == TM 11 == TM-11) */
function nomesSimiliares(a: string, b: string): boolean {
  return normalizarNome(a) === normalizarNome(b);
}

// ─── SEÇÃO 1 — Lojas ─────────────────────────────────────────────────────────

async function auditarLojas() {
  H1('SEÇÃO 1 — LOJAS');

  const todasLojas = await prisma.loja.findMany({
    include: {
      grupo: { select: { id: true, nome: true } },
      _count: {
        select: {
          estoques: true,
          unidades: true,
          vendas: true,
          usuarios: true,
          logsEstoque: true,
          ordensServico: true,
          contasPagar: true,
          contasReceber: true,
          pedidosCompra: true,
          transferenciasOrigem: true,
          transferenciasDestino: true,
        }
      }
    },
    orderBy: { nomeFantasia: 'asc' }
  });

  H2('1.1 — Todas as Lojas');
  console.log('');
  console.log('  ID  | ATIVO | GRUPO           | NOME FANTASIA                    | CNPJ');
  console.log('  ----|-------|-----------------|----------------------------------|------------------');
  for (const l of todasLojas) {
    const status = l.ativo ? '  SIM' : '  NÃO';
    const nome = (l.nomeFantasia || l.razaoSocial || '').padEnd(32).slice(0, 32);
    const grupo = (l.grupo?.nome || '').padEnd(15).slice(0, 15);
    console.log(`  ${String(l.id).padStart(3)} | ${status} | ${grupo} | ${nome} | ${l.cnpj}`);
  }
  console.log('');
  INFO(`Total de lojas: ${todasLojas.length} (${todasLojas.filter(l => l.ativo).length} ativas, ${todasLojas.filter(l => !l.ativo).length} inativas)`);

  // Lojas com nomes parecidos com RIO SUL / ITAGUAI
  H2('1.2 — Lojas com nomes similares (RIO SUL / ITAGUAI)');
  const palavrasChave = ['RIO SUL', 'ITAGUAI', 'ITAGUAÍ', 'RIOSUL'];
  const lojasSimiliares = todasLojas.filter(l => {
    const nome = (l.nomeFantasia || l.razaoSocial || '').toUpperCase();
    return palavrasChave.some(p => nome.includes(p));
  });

  if (lojasSimiliares.length === 0) {
    OK('Nenhuma loja com nome contendo RIO SUL ou ITAGUAI encontrada.');
  } else {
    for (const l of lojasSimiliares) {
      WARN(`ID=${l.id} | ${l.ativo ? 'ATIVA' : 'INATIVA'} | ${l.nomeFantasia || l.razaoSocial} | CNPJ: ${l.cnpj}`);
      ROW(`Grupo: ${l.grupo?.nome} | Estoques: ${l._count.estoques} | Unidades: ${l._count.unidades} | Vendas: ${l._count.vendas} | Usuários: ${l._count.usuarios}`);
    }
    if (lojasSimiliares.length > 1) {
      ERR(`ATENÇÃO: ${lojasSimiliares.length} lojas com nome similar. Possível duplicidade!`);
    }
  }

  // Lojas inativas com dados
  H2('1.3 — Lojas INATIVAS com dados vinculados');
  const lojasInativas = todasLojas.filter(l => !l.ativo);
  if (lojasInativas.length === 0) {
    OK('Não há lojas inativas.');
  } else {
    for (const l of lojasInativas) {
      const temDados = l._count.estoques > 0 || l._count.unidades > 0 || l._count.vendas > 0 || l._count.logsEstoque > 0;
      if (temDados) {
        WARN(`Loja inativa ID=${l.id} "${l.nomeFantasia || l.razaoSocial}" POSSUI DADOS:`);
        ROW(`  Estoques: ${l._count.estoques} | Unidades: ${l._count.unidades} | Vendas: ${l._count.vendas}`);
        ROW(`  Logs: ${l._count.logsEstoque} | Usuários: ${l._count.usuarios} | OS: ${l._count.ordensServico}`);
      } else {
        INFO(`Loja inativa ID=${l.id} "${l.nomeFantasia || l.razaoSocial}" — sem dados vinculados.`);
      }
    }
  }

  return todasLojas;
}

// ─── SEÇÃO 2 — Produtos ──────────────────────────────────────────────────────

async function auditarProdutos() {
  H1('SEÇÃO 2 — PRODUTOS');

  const todosProdutos = await prisma.produto.findMany({
    include: {
      _count: { select: { estoques: true, unidades: true } }
    },
    orderBy: { nome: 'asc' }
  });

  H2('2.1 — Resumo de Produtos');
  const motos = todosProdutos.filter(p => p.tipo === 'MOTO');
  const pecas = todosProdutos.filter(p => p.tipo === 'PECA');
  INFO(`Total: ${todosProdutos.length} produtos (${motos.length} MOTOs, ${pecas.length} PEÇAs)`);
  INFO(`Ativos: ${todosProdutos.filter(p => p.ativo).length} | Inativos: ${todosProdutos.filter(p => !p.ativo).length}`);

  // Padrões de nome a verificar
  const padroesDuplicata = [
    ['TM11', 'TM 11', 'TM-11'],
    ['TM13', 'TM 13', 'TM-13'],
    ['ETREK', 'E-TREK', 'E TREK', 'E_TREK'],
    ['YEP', 'TM YEP', 'TMYEP'],
    ['FRANKFURT', 'FRANC FURT', 'FRANK FURT'],
    ['MONACO', 'MÔNACO', 'MONAC'],
    ['BABY', 'TM BABY'],
    ['EKKO', 'TM EKKO'],
  ];

  H2('2.2 — Possíveis Produtos Duplicados por Padrão de Nome');
  let encontrouDuplicata = false;

  for (const grupo of padroesDuplicata) {
    const normalizados = grupo.map(normalizarNome);
    const encontrados = todosProdutos.filter(p =>
      normalizados.includes(normalizarNome(p.nome)) ||
      normalizados.some(n => normalizarNome(p.nome).includes(n))
    );

    if (encontrados.length > 1) {
      encontrouDuplicata = true;
      ERR(`Possível duplicidade para padrão "${grupo[0]}":`);
      for (const p of encontrados) {
        ROW(`  ID=${p.id} | ${p.tipo} | "${p.nome}" | Código: ${p.codigo} | Ativo: ${p.ativo}`);
        ROW(`  Estoques em: ${p._count.estoques} loja(s) | Unidades físicas: ${p._count.unidades}`);
      }
    } else if (encontrados.length === 1) {
      OK(`Padrão "${grupo[0]}": 1 produto encontrado — ID=${encontrados[0].id} "${encontrados[0].nome}"`);
    } else {
      INFO(`Padrão "${grupo[0]}": nenhum produto encontrado.`);
    }
  }

  if (!encontrouDuplicata) {
    OK('Nenhuma duplicidade óbvia detectada nos padrões verificados.');
  }

  // Produtos sem estoque em nenhuma loja
  H2('2.3 — Produtos sem Estoque em Nenhuma Loja');
  const produtosSemEstoque = todosProdutos.filter(p => p.ativo && p._count.estoques === 0);
  if (produtosSemEstoque.length === 0) {
    OK('Todos os produtos ativos possuem registro de estoque.');
  } else {
    WARN(`${produtosSemEstoque.length} produto(s) ativo(s) sem estoque em nenhuma loja:`);
    for (const p of produtosSemEstoque.slice(0, 20)) {
      ROW(`  ID=${p.id} | ${p.tipo} | "${p.nome}" | UnidFís: ${p._count.unidades}`);
    }
    if (produtosSemEstoque.length > 20) ROW(`  ... e mais ${produtosSemEstoque.length - 20} produto(s).`);
  }

  return todosProdutos;
}

// ─── SEÇÃO 3 — Estoques por Loja ─────────────────────────────────────────────

async function auditarEstoques(todasLojas: any[]) {
  H1('SEÇÃO 3 — ESTOQUES POR LOJA');

  const estoques = await prisma.estoque.findMany({
    include: {
      produto: { select: { id: true, nome: true, tipo: true, ativo: true } },
      loja:    { select: { id: true, nomeFantasia: true, razaoSocial: true, ativo: true } },
    },
    orderBy: [{ loja: { nomeFantasia: 'asc' } }, { produto: { nome: 'asc' } }]
  });

  H2('3.1 — Resumo de Estoques');
  INFO(`Total de registros em Estoque: ${estoques.length}`);
  INFO(`Com quantidade > 0: ${estoques.filter(e => e.quantidade > 0).length}`);
  INFO(`Com quantidade = 0: ${estoques.filter(e => e.quantidade === 0).length}`);
  INFO(`Com quantidade < 0: ${estoques.filter(e => e.quantidade < 0).length}`);

  // Estoques negativos — crítico
  H2('3.2 — Estoques NEGATIVOS (crítico)');
  const negativos = estoques.filter(e => e.quantidade < 0);
  if (negativos.length === 0) {
    OK('Nenhum estoque negativo encontrado.');
  } else {
    for (const e of negativos) {
      ERR(`Loja ID=${e.lojaId} "${e.loja.nomeFantasia}" | Produto ID=${e.produtoId} "${e.produto.nome}" | Qtd: ${e.quantidade}`);
    }
  }

  // Estoques com produto inativo
  H2('3.3 — Estoques com Produto INATIVO');
  const comProdutoInativo = estoques.filter(e => !e.produto.ativo && e.quantidade > 0);
  if (comProdutoInativo.length === 0) {
    OK('Nenhum estoque com produto inativo e quantidade > 0.');
  } else {
    for (const e of comProdutoInativo) {
      WARN(`Estoque ID=${e.id} | Produto INATIVO ID=${e.produtoId} "${e.produto.nome}" | Loja: ${e.loja.nomeFantasia} | Qtd: ${e.quantidade}`);
    }
  }

  // Estoques com loja inativa
  H2('3.4 — Estoques com Loja INATIVA');
  const comLojaInativa = estoques.filter(e => !e.loja.ativo && e.quantidade > 0);
  if (comLojaInativa.length === 0) {
    OK('Nenhum estoque com loja inativa e quantidade > 0.');
  } else {
    for (const e of comLojaInativa) {
      WARN(`Estoque ID=${e.id} | Loja INATIVA ID=${e.lojaId} "${e.loja.nomeFantasia}" | Produto: "${e.produto.nome}" | Qtd: ${e.quantidade}`);
    }
  }

  // Estoque das lojas RIO SUL / ITAGUAI
  H2('3.5 — Estoque das Lojas RIO SUL / ITAGUAI');
  const lojasSimilares = todasLojas.filter(l => {
    const nome = (l.nomeFantasia || l.razaoSocial || '').toUpperCase();
    return ['RIO SUL', 'ITAGUAI', 'RIOSUL'].some(p => nome.includes(p));
  });

  if (lojasSimilares.length === 0) {
    INFO('Nenhuma loja RIO SUL/ITAGUAI encontrada.');
  } else {
    for (const loja of lojasSimilares) {
      const estLoja = estoques.filter(e => e.lojaId === loja.id);
      INFO(`Loja ID=${loja.id} "${loja.nomeFantasia || loja.razaoSocial}" [${loja.ativo ? 'ATIVA' : 'INATIVA'}]:`);
      if (estLoja.length === 0) {
        WARN(`  Nenhum registro de Estoque para esta loja.`);
      } else {
        const comQtd = estLoja.filter(e => e.quantidade > 0);
        ROW(`  Total de registros: ${estLoja.length} (${comQtd.length} com quantidade > 0)`);
        for (const e of estLoja.filter(e => e.quantidade > 0).slice(0, 15)) {
          ROW(`    ${e.produto.tipo.padEnd(4)} | "${e.produto.nome}" | Qtd: ${e.quantidade} | Min: ${e.estoqueMinimo}`);
        }
      }
    }
  }

  return estoques;
}

// ─── SEÇÃO 4 — Unidades Físicas (Chassi) ─────────────────────────────────────

async function auditarUnidades(todasLojas: any[]) {
  H1('SEÇÃO 4 — UNIDADES FÍSICAS (CHASSI)');

  const unidades = await prisma.unidadeFisica.findMany({
    include: {
      produto: { select: { id: true, nome: true, tipo: true, ativo: true } },
      loja:    { select: { id: true, nomeFantasia: true, razaoSocial: true, ativo: true } },
    },
    orderBy: [{ loja: { nomeFantasia: 'asc' } }, { createdAt: 'desc' }]
  });

  H2('4.1 — Resumo de Unidades Físicas');
  INFO(`Total de UnidadeFisica: ${unidades.length}`);
  const porStatus: Record<string, number> = {};
  for (const u of unidades) {
    porStatus[u.status] = (porStatus[u.status] || 0) + 1;
  }
  for (const [status, qtd] of Object.entries(porStatus)) {
    INFO(`  Status ${status}: ${qtd}`);
  }

  // Chassis duplicados
  H2('4.2 — Chassis DUPLICADOS');
  const chassiMap = new Map<string, typeof unidades>();
  for (const u of unidades) {
    if (!u.chassi) continue;
    const chave = u.chassi.trim().toUpperCase();
    if (!chassiMap.has(chave)) chassiMap.set(chave, []);
    chassiMap.get(chave)!.push(u);
  }
  const duplicados = [...chassiMap.entries()].filter(([, list]) => list.length > 1);
  if (duplicados.length === 0) {
    OK('Nenhum chassi duplicado encontrado.');
  } else {
    for (const [chassi, lista] of duplicados) {
      ERR(`Chassi DUPLICADO: "${chassi}" (${lista.length} ocorrências):`);
      for (const u of lista) {
        ROW(`  UnidFís ID=${u.id} | Loja: "${u.loja.nomeFantasia}" | Produto: "${u.produto.nome}" | Status: ${u.status} | Criado: ${u.createdAt.toLocaleDateString('pt-BR')}`);
      }
    }
  }

  // Chassis sem chassi (campo vazio)
  H2('4.3 — Unidades sem Chassi informado');
  const semChassi = unidades.filter(u => !u.chassi || !u.chassi.trim());
  if (semChassi.length === 0) {
    OK('Todas as unidades possuem chassi informado.');
  } else {
    WARN(`${semChassi.length} unidade(s) sem chassi:`);
    for (const u of semChassi.slice(0, 20)) {
      ROW(`  ID=${u.id} | Produto: "${u.produto.nome}" | Loja: "${u.loja.nomeFantasia}" | Status: ${u.status}`);
    }
  }

  // Unidades com produto inativo
  H2('4.4 — Unidades com Produto INATIVO');
  const comProdutoInativo = unidades.filter(u => !u.produto.ativo && u.status === 'ESTOQUE');
  if (comProdutoInativo.length === 0) {
    OK('Nenhuma unidade em ESTOQUE com produto inativo.');
  } else {
    WARN(`${comProdutoInativo.length} unidade(s) em ESTOQUE com produto inativo:`);
    for (const u of comProdutoInativo) {
      ROW(`  ID=${u.id} | Produto INATIVO: "${u.produto.nome}" | Loja: "${u.loja.nomeFantasia}" | Chassi: ${u.chassi}`);
    }
  }

  // Unidades com loja inativa
  H2('4.5 — Unidades com Loja INATIVA');
  const comLojaInativa = unidades.filter(u => !u.loja.ativo && u.status === 'ESTOQUE');
  if (comLojaInativa.length === 0) {
    OK('Nenhuma unidade em ESTOQUE com loja inativa.');
  } else {
    WARN(`${comLojaInativa.length} unidade(s) em ESTOQUE com loja inativa:`);
    for (const u of comLojaInativa) {
      ROW(`  ID=${u.id} | Loja INATIVA: "${u.loja.nomeFantasia}" | Produto: "${u.produto.nome}" | Chassi: ${u.chassi}`);
    }
  }

  // Unidades das lojas RIO SUL / ITAGUAI
  H2('4.6 — Unidades das Lojas RIO SUL / ITAGUAI');
  const lojasSimilares = todasLojas.filter(l => {
    const nome = (l.nomeFantasia || l.razaoSocial || '').toUpperCase();
    return ['RIO SUL', 'ITAGUAI', 'RIOSUL'].some(p => nome.includes(p));
  });

  if (lojasSimilares.length === 0) {
    INFO('Nenhuma loja RIO SUL/ITAGUAI encontrada.');
  } else {
    for (const loja of lojasSimilares) {
      const uniLoja = unidades.filter(u => u.lojaId === loja.id);
      INFO(`Loja ID=${loja.id} "${loja.nomeFantasia || loja.razaoSocial}" [${loja.ativo ? 'ATIVA' : 'INATIVA'}]:`);
      if (uniLoja.length === 0) {
        WARN(`  Nenhuma UnidadeFisica para esta loja.`);
      } else {
        const emEstoque = uniLoja.filter(u => u.status === 'ESTOQUE');
        ROW(`  Total: ${uniLoja.length} (${emEstoque.length} em ESTOQUE)`);
        for (const u of uniLoja.slice(0, 20)) {
          ROW(`  ID=${u.id} | "${u.produto.nome}" | Chassi: ${u.chassi || 'N/A'} | Status: ${u.status} | ${u.createdAt.toLocaleDateString('pt-BR')}`);
        }
        if (uniLoja.length > 20) ROW(`  ... e mais ${uniLoja.length - 20} unidade(s).`);
      }
    }
  }

  return unidades;
}

// ─── SEÇÃO 5 — Divergências Estoque x Unidades Físicas ───────────────────────

async function auditarDivergencias(estoques: any[], unidades: any[]) {
  H1('SEÇÃO 5 — DIVERGÊNCIAS ESTOQUE AGREGADO x UNIDADES FÍSICAS');

  // Agrupar unidades por loja+produto (apenas ESTOQUE)
  const unidadesEmEstoque = unidades.filter(u => u.status === 'ESTOQUE');
  const mapUnidades = new Map<string, number>();
  for (const u of unidadesEmEstoque) {
    const chave = `${u.lojaId}-${u.produtoId}`;
    mapUnidades.set(chave, (mapUnidades.get(chave) || 0) + 1);
  }

  // Filtrar apenas estoques de MOTO (UnidadeFisica só existe para MOTO)
  const estoquesMotos = estoques.filter(e => e.produto.tipo === 'MOTO' && e.quantidade > 0);

  H2('5.1 — Estoque MOTO maior que UnidadesFísicas em ESTOQUE');
  let divergenciasEncontradas = 0;
  for (const e of estoquesMotos) {
    const chave = `${e.lojaId}-${e.produtoId}`;
    const qtdUnidades = mapUnidades.get(chave) || 0;
    if (e.quantidade > qtdUnidades) {
      divergenciasEncontradas++;
      WARN(`Loja "${e.loja.nomeFantasia}" | Produto "${e.produto.nome}"`);
      ROW(`  Estoque agregado: ${e.quantidade} | UnidFís em ESTOQUE: ${qtdUnidades} | Diferença: +${e.quantidade - qtdUnidades}`);
    }
  }
  if (divergenciasEncontradas === 0) OK('Nenhuma divergência: estoque ≤ unidades físicas para todas as MOTOs.');

  H2('5.2 — UnidadesFísicas em ESTOQUE maior que Estoque Agregado MOTO');
  const lojasProdutos = new Set(estoquesMotos.map(e => `${e.lojaId}-${e.produtoId}`));
  let divergenciasUnidades = 0;
  for (const [chave, qtdUnidades] of mapUnidades.entries()) {
    const [lojaIdStr, produtoIdStr] = chave.split('-');
    const lojaId = Number(lojaIdStr);
    const produtoId = Number(produtoIdStr);
    const estoqueAgg = estoques.find(e => e.lojaId === lojaId && e.produtoId === produtoId);
    const qtdAgg = estoqueAgg?.quantidade || 0;
    if (qtdUnidades > qtdAgg) {
      divergenciasUnidades++;
      const lojaNome = unidades.find(u => u.lojaId === lojaId)?.loja.nomeFantasia || `ID=${lojaId}`;
      const prodNome = unidades.find(u => u.produtoId === produtoId)?.produto.nome || `ID=${produtoId}`;
      ERR(`Loja "${lojaNome}" | Produto "${prodNome}"`);
      ROW(`  UnidFís em ESTOQUE: ${qtdUnidades} | Estoque agregado: ${qtdAgg} | Diferença: +${qtdUnidades - qtdAgg}`);
    }
  }
  if (divergenciasUnidades === 0) OK('Nenhuma divergência: unidades físicas ≤ estoque agregado para todas as combinações.');

  H2('5.3 — Produtos MOTO com UnidadeFísica mas SEM registro em Estoque');
  let semEstoque = 0;
  for (const [chave, qtdUnidades] of mapUnidades.entries()) {
    const [lojaIdStr, produtoIdStr] = chave.split('-');
    const lojaId = Number(lojaIdStr);
    const produtoId = Number(produtoIdStr);
    const estoqueAgg = estoques.find(e => e.lojaId === lojaId && e.produtoId === produtoId);
    if (!estoqueAgg) {
      semEstoque++;
      const lojaNome = unidades.find(u => u.lojaId === lojaId)?.loja.nomeFantasia || `ID=${lojaId}`;
      const prodNome = unidades.find(u => u.produtoId === produtoId)?.produto.nome || `ID=${produtoId}`;
      ERR(`Loja "${lojaNome}" | Produto "${prodNome}" | ${qtdUnidades} UnidFís em ESTOQUE mas SEM registro em Estoque!`);
    }
  }
  if (semEstoque === 0) OK('Todos os produtos com UnidadeFísica possuem registro em Estoque.');
}

// ─── SEÇÃO 6 — Movimentações (LogEstoque) ────────────────────────────────────

async function auditarMovimentacoes(todasLojas: any[]) {
  H1('SEÇÃO 6 — MOVIMENTAÇÕES DE ESTOQUE (LogEstoque)');

  const totalLogs = await prisma.logEstoque.count();
  INFO(`Total de registros em LogEstoque: ${totalLogs}`);

  // Logs das lojas RIO SUL / ITAGUAI
  H2('6.1 — Logs das Lojas RIO SUL / ITAGUAI');
  const lojasSimilares = todasLojas.filter(l => {
    const nome = (l.nomeFantasia || l.razaoSocial || '').toUpperCase();
    return ['RIO SUL', 'ITAGUAI', 'RIOSUL'].some(p => nome.includes(p));
  });

  for (const loja of lojasSimilares) {
    const logs = await prisma.logEstoque.findMany({
      where: { lojaId: loja.id },
      include: {
        produto: { select: { nome: true, tipo: true } },
        usuario: { select: { nome: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    INFO(`Loja ID=${loja.id} "${loja.nomeFantasia}" — ${logs.length > 0 ? logs.length + ' log(s) recentes' : 'NENHUM log'}`);
    for (const l of logs) {
      ROW(`  ${l.createdAt.toLocaleDateString('pt-BR')} | ${l.tipo} | ${l.produto.nome} | Qtd: ${l.quantidade} | ${l.usuario.nome}`);
    }
  }

  // Logs de produtos TM11 / TM13
  H2('6.2 — Logs de Produtos TM11 / TM13');
  const produtosTM = await prisma.produto.findMany({
    where: {
      OR: [
        { nome: { contains: 'TM11', mode: 'insensitive' } },
        { nome: { contains: 'TM 11', mode: 'insensitive' } },
        { nome: { contains: 'TM-11', mode: 'insensitive' } },
        { nome: { contains: 'TM13', mode: 'insensitive' } },
        { nome: { contains: 'TM 13', mode: 'insensitive' } },
        { nome: { contains: 'TM-13', mode: 'insensitive' } },
      ]
    }
  });

  if (produtosTM.length === 0) {
    INFO('Nenhum produto TM11 ou TM13 encontrado.');
  } else {
    for (const p of produtosTM) {
      const logs = await prisma.logEstoque.findMany({
        where: { produtoId: p.id },
        include: { loja: { select: { nomeFantasia: true } }, usuario: { select: { nome: true } } },
        orderBy: { createdAt: 'desc' },
        take: 15
      });
      INFO(`Produto ID=${p.id} "${p.nome}" — ${logs.length} log(s):`);
      for (const l of logs) {
        ROW(`  ${l.createdAt.toLocaleDateString('pt-BR')} | ${l.tipo} | Loja: ${l.loja.nomeFantasia} | Qtd: ${l.quantidade} | ${l.usuario.nome}`);
      }
    }
  }

  // Logs recentes (últimas 48h)
  H2('6.3 — Logs Recentes (últimas 48h)');
  const recentes = await prisma.logEstoque.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 48 * 3600 * 1000) } },
    include: {
      produto: { select: { nome: true, tipo: true } },
      loja:    { select: { nomeFantasia: true } },
      usuario: { select: { nome: true } }
    },
    orderBy: { createdAt: 'desc' }
  });
  if (recentes.length === 0) {
    INFO('Nenhuma movimentação nas últimas 48h.');
  } else {
    INFO(`${recentes.length} movimentação(ões) nas últimas 48h:`);
    for (const l of recentes) {
      ROW(`  ${l.createdAt.toLocaleString('pt-BR')} | ${l.tipo} | "${l.produto.nome}" | Loja: ${l.loja.nomeFantasia} | Qtd: ${l.quantidade}`);
    }
  }
}

// ─── SEÇÃO 7 — Risco de Exclusão de Loja ─────────────────────────────────────

async function auditarRiscoExclusao(todasLojas: any[]) {
  H1('SEÇÃO 7 — RISCO DE EXCLUSÃO DE LOJA');

  INFO('Análise do que seria deletado se DELETE /lojas/:id fosse chamado para cada loja:');
  console.log('');
  console.log('  LOJA                            | VENDAS | OS  | ESTOQUE | UNID | LOGS | USUÁRIOS | RISCO');
  console.log('  --------------------------------|--------|-----|---------|------|------|----------|------');

  for (const loja of todasLojas) {
    const temHistorico = loja._count.vendas > 0 || loja._count.ordensServico > 0 || loja._count.logsEstoque > 0;
    const risco = temHistorico ? '🔴 ALTO' : loja._count.estoques > 0 ? '🟡 MÉDIO' : '🟢 BAIXO';
    const nome = (loja.nomeFantasia || loja.razaoSocial).padEnd(30).slice(0, 30);
    console.log(
      `  ${nome} | ${String(loja._count.vendas).padStart(6)} | ${String(loja._count.ordensServico).padStart(3)} | ` +
      `${String(loja._count.estoques).padStart(7)} | ${String(loja._count.unidades).padStart(4)} | ` +
      `${String(loja._count.logsEstoque).padStart(4)} | ${String(loja._count.usuarios).padStart(8)} | ${risco}`
    );
  }

  ERR('ALERTA CRÍTICO: A rota DELETE /lojas/:id executa exclusão em cascata SEM transação e SEM confirmação!');
  ROW('Vendas, OS, comissões, contas, estoque, unidades e usuários são deletados irreversivelmente.');
  ROW('Recomendação: implementar política de arquivamento (ativo=false) em vez de exclusão física.');
}

// ─── SEÇÃO 8 — Auditoria da Importação ───────────────────────────────────────

async function auditarImportacao() {
  H1('SEÇÃO 8 — PROBLEMAS IDENTIFICADOS NA IMPORTAÇÃO DE PLANILHA');

  WARN('importacao.ts — POST /importacao/unidades:');
  ROW('  1. NÃO está em transação: falha no meio deixa unidades parcialmente importadas.');
  ROW('  2. Busca produto por nome com contains (parcial) — pode vincular chassi ao produto errado.');
  ROW('     Ex: "TM11 Sport" pode ser encontrado ao buscar "TM11".');
  ROW('  3. NÃO incrementa o Estoque.quantidade ao importar UnidadeFisica via planilha.');
  ROW('     Resultado: UnidadeFisica existe mas Estoque fica zerado ou desatualizado.');
  ROW('  4. NÃO tem normalização de nome (TM11 ≠ TM-11).');
  ROW('  5. Se produto não existe: retorna erro e abandona linha. NÃO cadastra produto automaticamente.');
  ROW('  6. NÃO valida slots disponíveis antes de importar.');
  ROW('  7. NÃO gera relatório detalhado por loja/produto.');
  console.log('');
  WARN('importacao.ts — POST /importacao/produtos:');
  ROW('  1. Busca produto por nome EXATO — NÃO normaliza (TM11 ≠ TM 11).');
  ROW('  2. Não está em transação (múltiplos await fora de $transaction).');
  ROW('  3. Marca produto como ativo=true mesmo se estava inativo por razão válida.');
  console.log('');
  ERR('PROBLEMA CRÍTICO: POST /importacao/unidades não chama Estoque.update.');
  ERR('Isso explica por que UnidadeFisica pode existir mas Estoque fica zerado.');
}

// ─── SEÇÃO 9 — Problema do Seletor "13 unid." ────────────────────────────────

async function auditarSeletorLabel() {
  H1('SEÇÃO 9 — PROBLEMA DO SELETOR "N unid." NO LAYOUT');

  WARN('client/src/components/Layout.tsx — linha 642:');
  ROW('  ({lojas.length} unid.) — exibe o número de LOJAS DA REDE, não unidades de produto.');
  ROW('  Causa confusão: ao selecionar "RIO SUL ITAGUAI", aparece "(13 unid.)"');
  ROW('  que parece dizer que a loja tem 13 unidades de produto em estoque.');
  ROW('');
  ROW('  Correção segura: trocar "unid." por "lojas" — ex: "(13 lojas)" — ou remover o contador.');
  ROW('  Arquivo: client/src/components/Layout.tsx, linha 642');
  ROW('  Impacto: apenas visual, sem risco de dados.');
}

// ─── SEÇÃO 10 — Problema da Exclusão de Loja ─────────────────────────────────

async function auditarExclusaoLoja() {
  H1('SEÇÃO 10 — ANÁLISE CRÍTICA DA ROTA DELETE /lojas/:id');

  ERR('A rota atual (server/src/routes/lojas.ts, linha 185) é PERIGOSA:');
  ROW('');
  ROW('  1. NÃO está em transação ($transaction). Se falhar no meio, deixa dados órfãos.');
  ROW('  2. Deleta VENDAS, comissões, contas a receber, garantias — dados fiscais e históricos.');
  ROW('  3. Deleta USUÁRIOS com lojaId, mesmo os que são ADMIN_GERAL (atualmente protegido,');
  ROW('     mas o updateMany muda lojaId para null APENAS para roles admin, depois deleta o restante).');
  ROW('  4. NÃO valida se há notas fiscais emitidas (NotaFiscal não é deletada — FK vai quebrar!).');
  ROW('  5. NÃO exige confirmação forte (nenhum "digite o nome da loja" ou preview).');
  ROW('  6. NÃO faz backup antes de deletar.');
  ROW('  7. NÃO deleta: NotaFiscal, ContaBancaria, Fornecedor, PedidoCompra, AuditoriaEstoque,');
  ROW('     Transferencia (origem/destino), Revisao, Garantia (via UnidadeFisica), LogConfiguracao.');
  ROW('     → Essas tabelas terão lojaId orphan após a exclusão!');
  ROW('');
  WARN('Tabelas NÃO deletadas que têm lojaId e vão ter FK órfã:');
  ROW('  - NotaFiscal.lojaId');
  ROW('  - ContaBancaria.lojaId');
  ROW('  - Fornecedor.lojaId');
  ROW('  - PedidoCompra.lojaId');
  ROW('  - AuditoriaEstoque.lojaId');
  ROW('  - Transferencia.lojaOrigemId / lojaDestinoId');
  ROW('  - Pagamento.lojaId');
  ROW('  - Recebimento.lojaId');
  ROW('  (Se o banco não tiver CASCADE, vai gerar erro de FK. Se tiver, deleta silenciosamente.)');
}

// ─── RESUMO EXECUTIVO ─────────────────────────────────────────────────────────

async function resumoExecutivo(
  totalLojas: number,
  totalProdutos: number,
  totalEstoques: number,
  totalUnidades: number,
  totalLogs: number
) {
  H1('RESUMO EXECUTIVO — AUDITORIA ERP TECLE MOTOS / TM IMPORTS');
  console.log('  Data: ' + new Date().toLocaleString('pt-BR'));
  console.log('  Branch: audit/inventory-store-chassi-import');
  console.log('');

  console.log('  MÉTRICAS GERAIS:');
  INFO(`Lojas cadastradas: ${totalLojas}`);
  INFO(`Produtos cadastrados: ${totalProdutos}`);
  INFO(`Registros de Estoque: ${totalEstoques}`);
  INFO(`Unidades Físicas: ${totalUnidades}`);
  INFO(`Logs de Movimentação: ${totalLogs}`);

  console.log('');
  console.log('  PROBLEMAS IDENTIFICADOS (em ordem de prioridade):');
  console.log('');
  ERR('[P1 — CRÍTICO] POST /importacao/unidades NÃO atualiza Estoque.quantidade.');
  ROW('  Unidades físicas são criadas, mas o contador agregado fica zerado.');
  ROW('  Isso explica Estoque Geral zerado mesmo com UnidadeFisica cadastrada.');
  console.log('');
  ERR('[P2 — CRÍTICO] DELETE /lojas/:id sem transação e sem validar todas as FKs.');
  ROW('  NotaFiscal, ContaBancaria, Fornecedor etc. ficam órfãos após exclusão.');
  console.log('');
  ERR('[P3 — ALTO] POST /importacao/unidades não está em transação.');
  ROW('  Falha parcial deixa dados inconsistentes sem possibilidade de rollback.');
  console.log('');
  WARN('[P4 — ALTO] Normalização de nomes de produto ausente.');
  ROW('  TM11, TM 11 e TM-11 são tratados como produtos diferentes.');
  ROW('  Afeta importação e busca de produto similar.');
  console.log('');
  WARN('[P5 — MÉDIO] Label "N unid." no seletor de lojas é enganoso.');
  ROW('  Mostra número de lojas da rede, não unidades de produto.');
  ROW('  Layout.tsx linha 642.');
  console.log('');
  WARN('[P6 — MÉDIO] Importação de unidades não cadastra produto automaticamente.');
  ROW('  Se produto não existe, a linha é ignorada com erro. Sem sugestão de similar.');
  console.log('');
  WARN('[P7 — MÉDIO] Importação de produtos não está em transação e ativa produtos inativos.');
  console.log('');
  WARN('[P8 — BAIXO] Modal "Entrada de Moto" pode exibir mensagem de planilha no modo unitário.');
  ROW('  Verificar se ModalEntradaMoto e ImportPlanilha compartilham algum estado.');
  console.log('');

  console.log('  RECOMENDAÇÕES IMEDIATAS:');
  console.log('');
  OK('1. Corrigir POST /importacao/unidades para atualizar Estoque.quantidade e usar $transaction.');
  OK('2. Corrigir DELETE /lojas/:id: adicionar $transaction + validar todas as FKs + preview + confirmação.');
  OK('3. Adicionar normalização de nomes em importacao.ts e estoque.ts.');
  OK('4. Corrigir label "unid." para "lojas" em Layout.tsx:642.');
  OK('5. Executar as queries SQL de diagnóstico no banco de produção para confirmar estado atual.');
  console.log('');

  console.log('  PRÓXIMOS SCRIPTS A CRIAR (somente preview):');
  ROW('  - scripts/preview-merge-lojas.ts');
  ROW('  - scripts/preview-normalizar-produtos.ts');
  ROW('  - scripts/preview-corrigir-estoque-unidades.ts');
  ROW('  - scripts/preview-orfaos-estoque.ts');
  console.log('');
  console.log(SEP);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║     AUDITORIA DE ESTOQUE E LOJAS — SOMENTE LEITURA                 ║');
  console.log('║     ERP Tecle Motos / TM Imports                                   ║');
  console.log('║     Branch: audit/inventory-store-chassi-import                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  try {
    const todasLojas  = await auditarLojas();
    const todosProdutos = await auditarProdutos();
    const estoques    = await auditarEstoques(todasLojas);
    const unidades    = await auditarUnidades(todasLojas);
    await auditarDivergencias(estoques, unidades);
    await auditarMovimentacoes(todasLojas);
    await auditarRiscoExclusao(todasLojas);
    await auditarImportacao();
    await auditarSeletorLabel();
    await auditarExclusaoLoja();

    const totalLogs = await prisma.logEstoque.count();
    await resumoExecutivo(
      todasLojas.length,
      todosProdutos.length,
      estoques.length,
      unidades.length,
      totalLogs
    );
  } catch (err) {
    console.error('\n🔴 ERRO AO EXECUTAR AUDITORIA:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
