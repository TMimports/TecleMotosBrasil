import { Router } from 'express';
import ExcelJS from 'exceljs';
import { prisma } from '../index.js';
import { verifyToken, applyTenantFilter, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(verifyToken);

// ── Parser OFX simples (suporta SGML e XML) ───────────────────────────────────
function parseOFX(content: string): Array<{
  fitid: string; dtposted: string; trnamt: string; trntype: string; memo: string;
}> {
  // Normaliza line endings e remove BOM
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\uFEFF/, '');

  // Extrai transações de SGML ou XML
  const transactions: Array<{
    fitid: string; dtposted: string; trnamt: string; trntype: string; memo: string;
  }> = [];

  // Regex para encontrar blocos <STMTTRN>...</STMTTRN> (SGML sem fechamento obrigatório)
  const trnBlockRegex = /<STMTTRN>([\s\S]*?)(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi;
  let match;

  while ((match = trnBlockRegex.exec(text)) !== null) {
    const block = match[1];

    const getField = (tag: string): string => {
      const r = new RegExp(`<${tag}[^>]*>([^<\n]+)`, 'i');
      const m = block.match(r);
      return m ? m[1].trim() : '';
    };

    const fitid = getField('FITID');
    const dtposted = getField('DTPOSTED');
    const trnamt = getField('TRNAMT');
    const trntype = getField('TRNTYPE');
    const memo = getField('MEMO') || getField('NAME') || 'Lançamento importado';

    if (fitid && dtposted && trnamt) {
      transactions.push({ fitid, dtposted, trnamt, trntype, memo });
    }
  }

  return transactions;
}

function parseOFXDate(dtposted: string): Date {
  // Formato: YYYYMMDDHHMMSS[timezone] ou YYYYMMDD
  const clean = dtposted.replace(/\[.*\]/, '').trim();
  const year  = parseInt(clean.slice(0, 4));
  const month = parseInt(clean.slice(4, 6)) - 1;
  const day   = parseInt(clean.slice(6, 8));
  return new Date(year, month, day, 12, 0, 0);
}

// ── Contas Bancárias ──────────────────────────────────────────────────────────

router.get('/contas', async (req: AuthRequest, res) => {
  try {
    const filter = applyTenantFilter(req);
    const where: any = {};
    if (filter.lojaId) where.lojaId = filter.lojaId;
    else if (filter.grupoId) where.loja = { grupoId: filter.grupoId };
    if (req.query.lojaId) where.lojaId = Number(req.query.lojaId);

    const contas = await prisma.contaBancaria.findMany({
      where,
      include: {
        loja: { select: { id: true, nomeFantasia: true, cnpj: true } },
        _count: { select: { lancamentos: true } },
      },
      orderBy: [{ loja: { nomeFantasia: 'asc' } }, { banco: 'asc' }],
    });

    // Calcula saldo atual para cada conta
    const contasComSaldo = await Promise.all(contas.map(async (c) => {
      const creditos = await prisma.lancamentoBancario.aggregate({
        where: { contaBancariaId: c.id, tipo: 'CREDITO' },
        _sum: { valor: true },
      });
      const debitos = await prisma.lancamentoBancario.aggregate({
        where: { contaBancariaId: c.id, tipo: 'DEBITO' },
        _sum: { valor: true },
      });
      const saldoMovimentos =
        Number(creditos._sum.valor ?? 0) - Number(debitos._sum.valor ?? 0);
      return {
        ...c,
        saldoAtual: Number(c.saldoInicial) + saldoMovimentos,
      };
    }));

    res.json(contasComSaldo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/contas', async (req: AuthRequest, res) => {
  try {
    const { lojaId, banco, agencia, conta, digitoConta, tipoConta, saldoInicial, descricao } = req.body;
    if (!lojaId || !banco || !agencia || !conta) {
      return res.status(400).json({ error: 'Campos obrigatórios: lojaId, banco, agencia, conta' });
    }
    const nova = await prisma.contaBancaria.create({
      data: {
        lojaId: Number(lojaId), banco, agencia, conta,
        digitoConta: digitoConta || null,
        tipoConta: tipoConta || 'CC',
        saldoInicial: saldoInicial ? Number(saldoInicial) : 0,
        descricao: descricao || null,
      },
      include: { loja: { select: { id: true, nomeFantasia: true } } },
    });
    res.status(201).json(nova);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.put('/contas/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { banco, agencia, conta, digitoConta, tipoConta, saldoInicial, descricao, ativa } = req.body;
    const atualizada = await prisma.contaBancaria.update({
      where: { id },
      data: {
        banco, agencia, conta,
        digitoConta: digitoConta ?? null,
        tipoConta: tipoConta || 'CC',
        saldoInicial: saldoInicial !== undefined ? Number(saldoInicial) : undefined,
        descricao: descricao ?? null,
        ativa: ativa !== undefined ? Boolean(ativa) : undefined,
      },
    });
    res.json(atualizada);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/contas/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const qtd = await prisma.lancamentoBancario.count({ where: { contaBancariaId: id } });
    if (qtd > 0) {
      await prisma.contaBancaria.update({ where: { id }, data: { ativa: false } });
      return res.json({ message: 'Conta desativada (possui lançamentos)' });
    }
    await prisma.contaBancaria.delete({ where: { id } });
    res.json({ message: 'Conta excluída' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Lançamentos Bancários ─────────────────────────────────────────────────────

router.get('/lancamentos', async (req: AuthRequest, res) => {
  try {
    const filter = applyTenantFilter(req);
    const where: any = {};

    if (req.query.contaBancariaId) {
      where.contaBancariaId = Number(req.query.contaBancariaId);
    } else if (filter.lojaId) {
      where.contaBancaria = { lojaId: filter.lojaId };
    } else if (filter.grupoId) {
      where.contaBancaria = { loja: { grupoId: filter.grupoId } };
    }

    if (req.query.conciliado !== undefined) {
      where.conciliado = req.query.conciliado === 'true';
    }
    if (req.query.tipo) where.tipo = req.query.tipo;
    if (req.query.mes) {
      const [ano, mes] = (req.query.mes as string).split('-').map(Number);
      where.data = {
        gte: new Date(ano, mes - 1, 1),
        lte: new Date(ano, mes, 0, 23, 59, 59),
      };
    }

    const lancamentos = await prisma.lancamentoBancario.findMany({
      where,
      include: {
        contaBancaria: { select: { id: true, banco: true, agencia: true, conta: true, loja: { select: { nomeFantasia: true } } } },
        pagamento: {
          select: {
            id: true, valor: true, dataPagamento: true, formaPagamento: true,
            contaPagar: { select: { descricao: true } },
          },
        },
        recebimento: {
          select: {
            id: true, valor: true, dataRecebimento: true, formaPagamento: true,
            contaReceber: { select: { descricao: true } },
          },
        },
      },
      orderBy: { data: 'desc' },
      take: 500,
    });

    res.json(lancamentos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/lancamentos', async (req: AuthRequest, res) => {
  try {
    const { contaBancariaId, data, descricao, valor, tipo, observacoes } = req.body;
    if (!contaBancariaId || !data || !descricao || !valor || !tipo) {
      return res.status(400).json({ error: 'Campos obrigatórios: contaBancariaId, data, descricao, valor, tipo' });
    }
    const novo = await prisma.lancamentoBancario.create({
      data: {
        contaBancariaId: Number(contaBancariaId),
        data: new Date(data),
        descricao,
        valor: Number(valor),
        tipo,
        observacoes: observacoes || null,
      },
    });
    res.status(201).json(novo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.delete('/lancamentos/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const l = await prisma.lancamentoBancario.findUnique({ where: { id } });
    if (!l) return res.status(404).json({ error: 'Lançamento não encontrado' });
    if (l.conciliado) return res.status(400).json({ error: 'Não é possível excluir lançamento já conciliado' });
    await prisma.lancamentoBancario.delete({ where: { id } });
    res.json({ message: 'Lançamento excluído' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Conciliação ───────────────────────────────────────────────────────────────

router.post('/lancamentos/:id/conciliar', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { pagamentoId, recebimentoId } = req.body;

    if (!pagamentoId && !recebimentoId) {
      return res.status(400).json({ error: 'Informe pagamentoId ou recebimentoId' });
    }

    const lancamento = await prisma.lancamentoBancario.findUnique({ where: { id } });
    if (!lancamento) return res.status(404).json({ error: 'Lançamento não encontrado' });
    if (lancamento.conciliado) return res.status(400).json({ error: 'Já conciliado' });

    const atualizado = await prisma.lancamentoBancario.update({
      where: { id },
      data: {
        conciliado: true,
        pagamentoId: pagamentoId ? Number(pagamentoId) : null,
        recebimentoId: recebimentoId ? Number(recebimentoId) : null,
      },
      include: {
        pagamento: { select: { id: true, valor: true, dataPagamento: true } },
        recebimento: { select: { id: true, valor: true, dataRecebimento: true } },
      },
    });

    res.json(atualizado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

router.post('/lancamentos/:id/desconciliar', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const atualizado = await prisma.lancamentoBancario.update({
      where: { id },
      data: { conciliado: false, pagamentoId: null, recebimentoId: null },
    });
    res.json(atualizado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Importação OFX ────────────────────────────────────────────────────────────

router.post('/contas/:id/importar-ofx', async (req: AuthRequest, res) => {
  try {
    const contaBancariaId = Number(req.params.id);
    const conta = await prisma.contaBancaria.findUnique({ where: { id: contaBancariaId } });
    if (!conta) return res.status(404).json({ error: 'Conta bancária não encontrada' });

    const { ofxContent } = req.body;
    if (!ofxContent || typeof ofxContent !== 'string') {
      return res.status(400).json({ error: 'Conteúdo OFX não fornecido' });
    }

    const transactions = parseOFX(ofxContent);
    if (transactions.length === 0) {
      return res.status(400).json({ error: 'Nenhuma transação encontrada no arquivo OFX' });
    }

    let importados = 0;
    let duplicados = 0;

    for (const trn of transactions) {
      const valor = parseFloat(trn.trnamt.replace(',', '.'));
      const tipo = valor >= 0 ? 'CREDITO' : 'DEBITO';
      const valorAbs = Math.abs(valor);
      const data = parseOFXDate(trn.dtposted);
      const fitid = trn.fitid;

      // Verifica duplicata
      const existe = await prisma.lancamentoBancario.findUnique({
        where: { contaBancariaId_fitid: { contaBancariaId, fitid } },
      });

      if (existe) {
        duplicados++;
        continue;
      }

      await prisma.lancamentoBancario.create({
        data: {
          contaBancariaId,
          data,
          descricao: trn.memo.slice(0, 255),
          valor: valorAbs,
          tipo: tipo as 'CREDITO' | 'DEBITO',
          fitid,
          importadoOFX: true,
        },
      });
      importados++;
    }

    res.json({
      message: `Importação concluída: ${importados} novos lançamentos, ${duplicados} duplicatas ignoradas`,
      importados,
      duplicados,
      total: transactions.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno ao processar OFX' });
  }
});

// ── Busca de Pagamentos/Recebimentos para conciliação ─────────────────────────

router.get('/candidatos', async (req: AuthRequest, res) => {
  try {
    const { tipo, lojaId, data, valor } = req.query;
    const lId = lojaId ? Number(lojaId) : undefined;
    const valorNum = valor ? Number(valor) : undefined;

    const dataRef = data ? new Date(data as string) : undefined;
    const dataInicio = dataRef ? new Date(dataRef.getTime() - 7 * 86400000) : undefined;
    const dataFim    = dataRef ? new Date(dataRef.getTime() + 7 * 86400000) : undefined;

    if (tipo === 'DEBITO') {
      // Para débito, busca pagamentos não vinculados
      const pagamentos = await prisma.pagamento.findMany({
        where: {
          ...(lId ? { lojaId: lId } : {}),
          lancamentosBancarios: { none: {} },
          ...(dataInicio && dataFim ? { dataPagamento: { gte: dataInicio, lte: dataFim } } : {}),
          ...(valorNum ? { valor: { gte: valorNum * 0.9, lte: valorNum * 1.1 } } : {}),
        },
        include: {
          contaPagar: { select: { descricao: true, fornecedor: true } },
          loja: { select: { nomeFantasia: true } },
        },
        orderBy: { dataPagamento: 'desc' },
        take: 50,
      });
      return res.json({ pagamentos, recebimentos: [] });
    } else {
      // Para crédito, busca recebimentos não vinculados
      const recebimentos = await prisma.recebimento.findMany({
        where: {
          ...(lId ? { lojaId: lId } : {}),
          lancamentosBancarios: { none: {} },
          ...(dataInicio && dataFim ? { dataRecebimento: { gte: dataInicio, lte: dataFim } } : {}),
          ...(valorNum ? { valor: { gte: valorNum * 0.9, lte: valorNum * 1.1 } } : {}),
        },
        include: {
          contaReceber: { select: { descricao: true } },
          loja: { select: { nomeFantasia: true } },
        },
        orderBy: { dataRecebimento: 'desc' },
        take: 50,
      });
      return res.json({ pagamentos: [], recebimentos });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Importação por Planilha (Excel/CSV) ──────────────────────────────────────
// Recebe um array de lançamentos JÁ parseado pelo cliente (usando exceljs no
// browser). Detecta duplicatas por hash data+valor+descricao (já que planilha
// não tem FITID). NUNCA sobrescreve lançamentos já conciliados.

router.post('/contas/:id/importar-planilha', async (req: AuthRequest, res) => {
  try {
    const contaBancariaId = Number(req.params.id);
    const conta = await prisma.contaBancaria.findUnique({ where: { id: contaBancariaId } });
    if (!conta) return res.status(404).json({ error: 'Conta bancária não encontrada' });

    const { lancamentos } = req.body as {
      lancamentos: Array<{ data: string; descricao: string; valor: number; tipo: 'CREDITO' | 'DEBITO' }>;
    };

    if (!Array.isArray(lancamentos) || lancamentos.length === 0) {
      return res.status(400).json({ error: 'Nenhum lançamento enviado' });
    }

    let importados = 0;
    let duplicados = 0;
    let invalidos = 0;
    const erros: string[] = [];

    for (const l of lancamentos) {
      // Validação básica
      if (!l.data || !l.descricao || l.valor === undefined || !l.tipo) {
        invalidos++;
        continue;
      }
      const dataObj = new Date(l.data);
      if (isNaN(dataObj.getTime())) {
        invalidos++;
        erros.push(`Data inválida: "${l.data}"`);
        continue;
      }
      const valor = Math.round(Math.abs(Number(l.valor)) * 100) / 100;
      if (valor <= 0) {
        invalidos++;
        continue;
      }
      if (l.tipo !== 'CREDITO' && l.tipo !== 'DEBITO') {
        invalidos++;
        continue;
      }

      // Duplicata: mesma conta + mesma data (dia) + mesmo valor + mesma descrição
      const inicioDia = new Date(dataObj); inicioDia.setHours(0, 0, 0, 0);
      const fimDia    = new Date(dataObj); fimDia.setHours(23, 59, 59, 999);
      const existe = await prisma.lancamentoBancario.findFirst({
        where: {
          contaBancariaId,
          data: { gte: inicioDia, lte: fimDia },
          valor,
          descricao: l.descricao.slice(0, 255),
          tipo: l.tipo,
        },
      });
      if (existe) {
        duplicados++;
        continue;
      }

      await prisma.lancamentoBancario.create({
        data: {
          contaBancariaId,
          data: dataObj,
          descricao: l.descricao.slice(0, 255),
          valor,
          tipo: l.tipo,
          importadoOFX: false,
          observacoes: 'Importado via planilha',
        },
      });
      importados++;
    }

    res.json({
      message: `Importação concluída: ${importados} novos, ${duplicados} duplicados, ${invalidos} inválidos`,
      importados,
      duplicados,
      invalidos,
      total: lancamentos.length,
      erros: erros.slice(0, 10),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno ao processar planilha' });
  }
});

// ── Auto-Conciliação em lote ─────────────────────────────────────────────────
// Para cada lançamento pendente, busca Pagamento (débito) ou Recebimento (crédito)
// não vinculado, com valor EXATO e data dentro de ±5 dias. Marca como sugestão
// para o financeiro revisar antes de aplicar.

router.post('/contas/:id/auto-conciliar/sugerir', async (req: AuthRequest, res) => {
  try {
    const contaBancariaId = Number(req.params.id);
    const conta = await prisma.contaBancaria.findUnique({ where: { id: contaBancariaId } });
    if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });

    const pendentes = await prisma.lancamentoBancario.findMany({
      where: { contaBancariaId, conciliado: false },
      orderBy: { data: 'asc' },
    });

    const sugestoes: Array<{
      lancamentoId: number; data: string; descricao: string; valor: number; tipo: string;
      candidato: { tipo: 'pagamento' | 'recebimento'; id: number; valor: number; data: string; descricao: string } | null;
      confianca: 'alta' | 'media' | 'baixa';
    }> = [];

    for (const lanc of pendentes) {
      const valor = Number(lanc.valor);
      const data = new Date(lanc.data);
      const dataIni = new Date(data.getTime() - 5 * 86400000);
      const dataFim = new Date(data.getTime() + 5 * 86400000);

      let candidato: any = null;
      let confianca: 'alta' | 'media' | 'baixa' = 'baixa';

      if (lanc.tipo === 'DEBITO') {
        const pagamento = await prisma.pagamento.findFirst({
          where: {
            lojaId: conta.lojaId,
            lancamentosBancarios: { none: {} },
            valor,
            dataPagamento: { gte: dataIni, lte: dataFim },
          },
          include: { contaPagar: { select: { descricao: true } } },
        });
        if (pagamento) {
          const diffDias = Math.abs((new Date(pagamento.dataPagamento).getTime() - data.getTime()) / 86400000);
          confianca = diffDias <= 1 ? 'alta' : diffDias <= 3 ? 'media' : 'baixa';
          candidato = {
            tipo: 'pagamento' as const,
            id: pagamento.id,
            valor: Number(pagamento.valor),
            data: pagamento.dataPagamento.toISOString(),
            descricao: pagamento.contaPagar?.descricao || 'Pagamento sem descrição',
          };
        }
      } else {
        const recebimento = await prisma.recebimento.findFirst({
          where: {
            lojaId: conta.lojaId,
            lancamentosBancarios: { none: {} },
            valor,
            dataRecebimento: { gte: dataIni, lte: dataFim },
          },
          include: { contaReceber: { select: { descricao: true } } },
        });
        if (recebimento) {
          const diffDias = Math.abs((new Date(recebimento.dataRecebimento).getTime() - data.getTime()) / 86400000);
          confianca = diffDias <= 1 ? 'alta' : diffDias <= 3 ? 'media' : 'baixa';
          candidato = {
            tipo: 'recebimento' as const,
            id: recebimento.id,
            valor: Number(recebimento.valor),
            data: recebimento.dataRecebimento.toISOString(),
            descricao: recebimento.contaReceber?.descricao || 'Recebimento sem descrição',
          };
        }
      }

      sugestoes.push({
        lancamentoId: lanc.id,
        data: lanc.data.toISOString(),
        descricao: lanc.descricao,
        valor,
        tipo: lanc.tipo,
        candidato,
        confianca,
      });
    }

    res.json({
      total: pendentes.length,
      comCandidato: sugestoes.filter(s => s.candidato).length,
      sugestoes,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao gerar sugestões' });
  }
});

router.post('/auto-conciliar/aplicar', async (req: AuthRequest, res) => {
  try {
    const { aplicacoes } = req.body as {
      aplicacoes: Array<{ lancamentoId: number; tipo: 'pagamento' | 'recebimento'; candidatoId: number }>;
    };
    if (!Array.isArray(aplicacoes) || aplicacoes.length === 0) {
      return res.status(400).json({ error: 'Nenhuma aplicação enviada' });
    }

    let aplicadas = 0;
    let falhas = 0;
    const erros: string[] = [];

    for (const ap of aplicacoes) {
      try {
        const lanc = await prisma.lancamentoBancario.findUnique({ where: { id: ap.lancamentoId } });
        if (!lanc || lanc.conciliado) {
          falhas++;
          continue;
        }
        await prisma.lancamentoBancario.update({
          where: { id: ap.lancamentoId },
          data: {
            conciliado: true,
            pagamentoId: ap.tipo === 'pagamento' ? ap.candidatoId : null,
            recebimentoId: ap.tipo === 'recebimento' ? ap.candidatoId : null,
          },
        });
        aplicadas++;
      } catch (e: any) {
        falhas++;
        erros.push(e.message);
      }
    }

    res.json({ aplicadas, falhas, erros: erros.slice(0, 10) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao aplicar conciliações' });
  }
});

// ── Resumo de conciliação ─────────────────────────────────────────────────────

router.get('/resumo', async (req: AuthRequest, res) => {
  try {
    const filter = applyTenantFilter(req);
    const where: any = {};
    if (filter.lojaId) where.contaBancaria = { lojaId: filter.lojaId };
    else if (filter.grupoId) where.contaBancaria = { loja: { grupoId: filter.grupoId } };
    if (req.query.lojaId) where.contaBancaria = { lojaId: Number(req.query.lojaId) };

    const [totalLancamentos, conciliados, naoConciliados] = await Promise.all([
      prisma.lancamentoBancario.count({ where }),
      prisma.lancamentoBancario.count({ where: { ...where, conciliado: true } }),
      prisma.lancamentoBancario.count({ where: { ...where, conciliado: false } }),
    ]);

    const creditosAgg = await prisma.lancamentoBancario.aggregate({
      where: { ...where, tipo: 'CREDITO' }, _sum: { valor: true },
    });
    const debitosAgg = await prisma.lancamentoBancario.aggregate({
      where: { ...where, tipo: 'DEBITO' }, _sum: { valor: true },
    });

    res.json({
      totalLancamentos,
      conciliados,
      naoConciliados,
      totalCreditos: Number(creditosAgg._sum.valor ?? 0),
      totalDebitos: Number(debitosAgg._sum.valor ?? 0),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ── Export Excel do Extrato Conciliado ────────────────────────────────────────
// Gera planilha .xlsx com filtros aplicáveis (período, status) para o financeiro
// fazer fechamento mensal e enviar para contador.

router.get('/contas/:id/exportar-excel', async (req: AuthRequest, res) => {
  try {
    const contaBancariaId = Number(req.params.id);
    const conta = await prisma.contaBancaria.findUnique({
      where: { id: contaBancariaId },
      include: { loja: { select: { nomeFantasia: true, cnpj: true } } },
    });
    if (!conta) return res.status(404).json({ error: 'Conta bancária não encontrada' });

    const where: any = { contaBancariaId };
    if (req.query.mes) {
      const [ano, mes] = (req.query.mes as string).split('-').map(Number);
      where.data = { gte: new Date(ano, mes - 1, 1), lte: new Date(ano, mes, 0, 23, 59, 59) };
    }
    if (req.query.conciliado !== undefined) {
      where.conciliado = req.query.conciliado === 'true';
    }

    const lancamentos = await prisma.lancamentoBancario.findMany({
      where,
      include: {
        pagamento: { select: { id: true, valor: true, contaPagar: { select: { descricao: true } } } },
        recebimento: { select: { id: true, valor: true, contaReceber: { select: { descricao: true } } } },
      },
      orderBy: { data: 'asc' },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TM Imports ERP';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Extrato Bancário', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    // Cabeçalho da conta
    sheet.addRow([`${conta.banco} — Ag. ${conta.agencia} / CC ${conta.conta}${conta.digitoConta ? '-' + conta.digitoConta : ''}`]);
    sheet.addRow([`Loja: ${conta.loja.nomeFantasia} — CNPJ ${conta.loja.cnpj || '-'}`]);
    sheet.addRow([`Extrato gerado em ${new Date().toLocaleString('pt-BR')}`]);
    if (req.query.mes) sheet.addRow([`Período: ${req.query.mes}`]);
    sheet.addRow([]);

    // Header das colunas
    const headerRow = sheet.addRow([
      'Data', 'Descrição', 'Tipo', 'Crédito (R$)', 'Débito (R$)', 'Saldo (R$)',
      'Conciliado', 'Vinculado a', 'Observações', 'Origem',
    ]);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    headerRow.alignment = { horizontal: 'center' };

    // Lançamentos com saldo acumulado
    let saldo = Number(conta.saldoInicial);
    for (const l of lancamentos) {
      const valor = Number(l.valor);
      saldo += l.tipo === 'CREDITO' ? valor : -valor;
      const vinculado = l.pagamento
        ? `Pagamento #${l.pagamento.id} - ${l.pagamento.contaPagar?.descricao || ''}`
        : l.recebimento
        ? `Recebimento #${l.recebimento.id} - ${l.recebimento.contaReceber?.descricao || ''}`
        : '';
      const row = sheet.addRow([
        l.data.toLocaleDateString('pt-BR'),
        l.descricao,
        l.tipo === 'CREDITO' ? 'Crédito' : 'Débito',
        l.tipo === 'CREDITO' ? valor : null,
        l.tipo === 'DEBITO' ? valor : null,
        saldo,
        l.conciliado ? 'Sim' : 'Não',
        vinculado,
        l.observacoes || '',
        l.importadoOFX ? 'OFX' : (l.observacoes?.includes('planilha') ? 'Planilha' : 'Manual'),
      ]);
      const moneyFormat = '"R$" #,##0.00;[Red]"-R$ "#,##0.00';
      row.getCell(4).numFmt = moneyFormat;
      row.getCell(5).numFmt = moneyFormat;
      row.getCell(6).numFmt = moneyFormat;
      if (!l.conciliado) row.getCell(7).font = { color: { argb: 'FFB45309' } };
      else row.getCell(7).font = { color: { argb: 'FF16A34A' } };
    }

    // Totais
    sheet.addRow([]);
    const totalCreditos = lancamentos.filter(l => l.tipo === 'CREDITO').reduce((acc, l) => acc + Number(l.valor), 0);
    const totalDebitos  = lancamentos.filter(l => l.tipo === 'DEBITO').reduce((acc, l) => acc + Number(l.valor), 0);
    const totalRow = sheet.addRow(['', 'TOTAL', '', totalCreditos, totalDebitos, saldo]);
    totalRow.font = { bold: true };
    const moneyFormat = '"R$" #,##0.00;[Red]"-R$ "#,##0.00';
    totalRow.getCell(4).numFmt = moneyFormat;
    totalRow.getCell(5).numFmt = moneyFormat;
    totalRow.getCell(6).numFmt = moneyFormat;

    // Larguras
    sheet.columns = [
      { width: 12 }, { width: 40 }, { width: 10 }, { width: 16 }, { width: 16 },
      { width: 16 }, { width: 12 }, { width: 35 }, { width: 30 }, { width: 12 },
    ];

    // Buffer e resposta
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `extrato-${conta.banco.replace(/\s/g, '_')}-${conta.agencia}-${conta.conta}${req.query.mes ? '-' + req.query.mes : ''}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[CONCILIACAO] Erro ao exportar Excel:', err);
    res.status(500).json({ error: 'Erro ao gerar planilha' });
  }
});

export default router;
