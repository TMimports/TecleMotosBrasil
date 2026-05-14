import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { prisma } from '../index.js';
import { verifyToken, AuthRequest } from '../middleware/auth.js';

/** Normaliza nome de produto para comparação: remove espaços, hífens e converte a maiúsculo */
function normalizarNomeProduto(nome: string): string {
  return nome.trim().toUpperCase().replace(/[\s\-_]+/g, '');
}

const router = Router();

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv'
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(xls|xlsx|csv)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Formato de arquivo invalido. Use XLS, XLSX ou CSV.'));
    }
  }
});

async function gerarCodigoProduto(tipo: string): Promise<string> {
  const prefixo = tipo === 'MOTO' ? 'TMMOT' : 'TMPEC';
  
  const ultimo = await prisma.produto.findFirst({
    where: { codigo: { startsWith: prefixo } },
    orderBy: { codigo: 'desc' }
  });
  
  let numero = 1;
  if (ultimo) {
    const match = ultimo.codigo.match(/\d+$/);
    if (match) {
      numero = parseInt(match[0]) + 1;
    }
  }
  
  return `${prefixo}${String(numero).padStart(5, '0')}`;
}

async function gerarCodigoOS(): Promise<string> {
  const prefixo = 'TMOS';
  const ano = new Date().getFullYear();
  
  const ultimo = await prisma.ordemServico.findFirst({
    where: { numero: { startsWith: `${prefixo}${ano}` } },
    orderBy: { numero: 'desc' }
  });
  
  let numero = 1;
  if (ultimo) {
    const match = ultimo.numero.match(/\d{4}$/);
    if (match) {
      numero = parseInt(match[0]) + 1;
    }
  }
  
  return `${prefixo}${ano}${String(numero).padStart(4, '0')}`;
}

async function gerarNumeroSerieUnidade(): Promise<string> {
  const prefixo = 'TMUNI';
  
  const ultimo = await prisma.unidadeFisica.findFirst({
    where: { numeroSerie: { startsWith: prefixo } },
    orderBy: { numeroSerie: 'desc' }
  });
  
  let numero = 1;
  if (ultimo && ultimo.numeroSerie) {
    const match = ultimo.numeroSerie.match(/\d+$/);
    if (match) {
      numero = parseInt(match[0]) + 1;
    }
  }
  
  return `${prefixo}${String(numero).padStart(5, '0')}`;
}

router.post('/produtos', verifyToken, upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const dados = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    const produtosCriados: any[] = [];
    const produtosAtualizados: any[] = [];
    let erros: string[] = [];

    const config = await prisma.configuracao.findFirst();
    if (!config) {
      return res.status(400).json({ error: 'Configurações não encontradas. Defina as margens na aba Configurações antes de importar.' });
    }
    const margemMoto = Number(config.lucroMoto);
    const margemPeca = Number(config.lucroPeca);

    for (let i = 1; i < dados.length; i++) {
      const row = dados[i];
      if (!row || !row[1]) continue;

      const nome = String(row[1] || '').trim();
      const custo = parseFloat(row[2]) || 0;
      const categoria = String(row[11] || 'Peça').trim().toLowerCase();
      const tipo = categoria.includes('moto') ? 'MOTO' : 'PECA';

      if (!nome) {
        erros.push(`Linha ${i + 1}: Nome do produto vazio`);
        continue;
      }

      const percentualLucro = tipo === 'MOTO' ? margemMoto : margemPeca;
      const preco = custo > 0 ? custo / (1 - percentualLucro / 100) : 0;

      const existente = await prisma.produto.findFirst({ where: { nome } });
      if (existente) {
        const produtoAtualizado = await prisma.produto.update({
          where: { id: existente.id },
          data: {
            tipo,
            custo,
            percentualLucro,
            preco,
            ativo: true
          }
        });
        produtosAtualizados.push(produtoAtualizado);
        continue;
      }

      const codigo = await gerarCodigoProduto(tipo);

      const produto = await prisma.produto.create({
        data: {
          codigo,
          nome,
          tipo,
          custo,
          percentualLucro,
          preco,
          ativo: true
        }
      });

      produtosCriados.push(produto);
    }

    res.json({
      sucesso: true,
      criados: produtosCriados.length,
      atualizados: produtosAtualizados.length,
      erros: erros.length,
      detalhesErros: erros.slice(0, 10),
      produtos: [...produtosCriados, ...produtosAtualizados].slice(0, 5)
    });
  } catch (error: any) {
    console.error('Erro na importacao:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/servicos', verifyToken, upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const dados = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    const servicos: any[] = [];
    let erros: string[] = [];

    for (let i = 1; i < dados.length; i++) {
      const row = dados[i];
      if (!row || !row[0]) continue;

      const nome = String(row[0] || '').trim();
      const preco = parseFloat(row[1]) || 0;
      const duracao = parseInt(row[2]) || null;

      if (!nome) {
        erros.push(`Linha ${i + 1}: Nome do servico vazio`);
        continue;
      }

      const existente = await prisma.servico.findFirst({ where: { nome } });
      if (existente) {
        erros.push(`Linha ${i + 1}: Servico "${nome}" ja existe`);
        continue;
      }

      const servico = await prisma.servico.create({
        data: {
          nome,
          preco,
          duracao,
          ativo: true
        }
      });

      servicos.push(servico);
    }

    res.json({
      sucesso: true,
      importados: servicos.length,
      erros: erros.length,
      detalhesErros: erros.slice(0, 10)
    });
  } catch (error: any) {
    console.error('Erro na importacao:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/unidades', verifyToken, upload.single('arquivo'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const { lojaId } = req.body;
    if (!lojaId) {
      return res.status(400).json({ error: 'Loja é obrigatória' });
    }

    const lojaIdNum = parseInt(lojaId);
    const usuarioId = req.user!.id;

    const loja = await prisma.loja.findUnique({ where: { id: lojaIdNum } });
    if (!loja) {
      return res.status(400).json({ error: 'Loja não encontrada' });
    }

    // Margem padrão para produtos auto-criados
    const config = await prisma.configuracao.findFirst();
    const margemMoto = config ? Number(config.lucroMoto) : 30;

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const dados = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    // Cache de produtos MOTO — mutado quando auto-criamos novos
    const todosMoto: any[] = await prisma.produto.findMany({ where: { tipo: 'MOTO' } });
    // Produtos criados nesta importação: normNome → produto (atualizado só após tx bem-sucedida)
    const criadosNestaImportacao = new Map<string, any>();

    type OrigemProduto = 'encontrado' | 'similar' | 'criado_auto';

    const importados: Array<{ chassi: string; produto: string; linha: number; origemProduto: OrigemProduto }> = [];
    const ignorados: Array<{ chassi?: string; produto?: string; linha: number; motivo: string }> = [];
    const erros: Array<{ linha: number; motivo: string }> = [];
    const estoquesAtualizados: Array<{ produto: string; lojaId: number; novaQuantidade: number }> = [];
    const produtosCriadosAuto: string[] = [];
    const produtosSimilaresUsados: Array<{ nomePlanilha: string; nomeCadastro: string }> = [];

    for (let i = 1; i < dados.length; i++) {
      const row = dados[i];
      if (!row || (!row[0] && !row[2])) continue;

      const produtoNomeBruto = String(row[0] || '').trim();
      const cor              = String(row[1] || '').trim();
      const chassi           = String(row[2] || '').trim().toUpperCase();
      const motor            = String(row[3] || '').trim().toUpperCase();
      const ano              = parseInt(row[4]) || new Date().getFullYear();

      if (!produtoNomeBruto) {
        erros.push({ linha: i + 1, motivo: 'Nome do produto vazio' });
        continue;
      }

      if (!chassi) {
        ignorados.push({ produto: produtoNomeBruto, linha: i + 1, motivo: 'Chassi não informado' });
        continue;
      }

      // ── Resolução do produto ─────────────────────────────────────────────────
      const normBusca = normalizarNomeProduto(produtoNomeBruto);
      let produto: any = null;
      let origemProduto: OrigemProduto = 'encontrado';
      let nomeLimpo = produtoNomeBruto.replace(/\s+/g, ' ').trim(); // nome a ser usado na criação

      // 1. Cache desta importação (evita duplicar produto criado em linhas anteriores)
      produto = criadosNestaImportacao.get(normBusca) ?? null;

      // 2. Nome exato
      if (!produto) {
        produto = todosMoto.find((p: any) => p.nome === produtoNomeBruto) ?? null;
      }

      // 3. Nome normalizado exato: TM11 = TM 11 = TM-11 = TM_11
      if (!produto) {
        const achado = todosMoto.find((p: any) => normalizarNomeProduto(p.nome) === normBusca);
        if (achado) {
          produto = achado;
          origemProduto = 'similar';
          produtosSimilaresUsados.push({ nomePlanilha: produtoNomeBruto, nomeCadastro: achado.nome });
        }
      }

      // 4. Similaridade forte: um normalizado contém o outro E razão de comprimento ≥ 0.6
      if (!produto) {
        const achado = todosMoto.find((p: any) => {
          const normP   = normalizarNomeProduto(p.nome);
          const menor   = normBusca.length <= normP.length ? normBusca : normP;
          const maior   = normBusca.length >  normP.length ? normBusca : normP;
          return maior.includes(menor) && (menor.length / maior.length) >= 0.6;
        });
        if (achado) {
          produto = achado;
          origemProduto = 'similar';
          const jaReg = produtosSimilaresUsados.find(
            s => s.nomePlanilha === produtoNomeBruto && s.nomeCadastro === achado.nome
          );
          if (!jaReg) produtosSimilaresUsados.push({ nomePlanilha: produtoNomeBruto, nomeCadastro: achado.nome });
        }
      }

      // 5. Nenhum similar → criar automaticamente
      if (!produto) {
        origemProduto = 'criado_auto';
      }

      // Gerar códigos fora da transação (usa prisma global, não tx)
      const numeroSerie = await gerarNumeroSerieUnidade();
      const codigoProdutoNovo = origemProduto === 'criado_auto'
        ? await gerarCodigoProduto('MOTO')
        : '';

      // ── Transação atômica por linha ──────────────────────────────────────────
      // Se produto for criado + chassi duplicado → ambos fazem rollback (sem produto órfão)
      try {
        const resultado = await prisma.$transaction(async (tx) => {
          let produtoId: number;
          let produtoNomeFinal: string;
          let produtoCriado: any = null;

          if (origemProduto === 'criado_auto') {
            produtoCriado = await tx.produto.create({
              data: {
                codigo:          codigoProdutoNovo,
                nome:            nomeLimpo,
                tipo:            'MOTO',
                custo:           0,
                percentualLucro: margemMoto,
                preco:           0,
                ativo:           true,
                descricao:       'Criado automaticamente via importação de planilha',
              }
            });
            produtoId        = produtoCriado.id;
            produtoNomeFinal = produtoCriado.nome;
          } else {
            produtoId        = produto.id;
            produtoNomeFinal = produto.nome;
          }

          // Verificar chassi duplicado
          const chassiExistente = await tx.unidadeFisica.findFirst({ where: { chassi } });
          if (chassiExistente) {
            // Se chegou aqui com produtoCriado, o produto também sofre rollback automaticamente
            return { ok: false as const, motivo: `Chassi "${chassi}" já está cadastrado`, produtoNomeFinal, produtoCriado: null };
          }

          // Criar UnidadeFisica
          await tx.unidadeFisica.create({
            data: {
              produtoId,
              lojaId: lojaIdNum,
              cor:          cor   || null,
              chassi,
              codigoMotor:  motor || null,
              ano,
              numeroSerie,
              status:    'ESTOQUE',
              createdBy: usuarioId,
            }
          });

          // Upsert Estoque
          const estoqueAtual = await tx.estoque.findUnique({
            where: { produtoId_lojaId: { produtoId, lojaId: lojaIdNum } }
          });
          const qtdAnterior = estoqueAtual?.quantidade ?? 0;
          const qtdNova     = qtdAnterior + 1;

          if (estoqueAtual) {
            await tx.estoque.update({ where: { id: estoqueAtual.id }, data: { quantidade: qtdNova } });
          } else {
            await tx.estoque.create({ data: { produtoId, lojaId: lojaIdNum, quantidade: 1 } });
          }

          // Log de movimentação
          await tx.logEstoque.create({
            data: {
              tipo:               'ENTRADA',
              origem:             'IMPORTACAO_PLANILHA',
              produtoId,
              lojaId:             lojaIdNum,
              quantidade:         1,
              quantidadeAnterior: qtdAnterior,
              quantidadeNova:     qtdNova,
              usuarioId,
            }
          });

          return { ok: true as const, novaQuantidade: qtdNova, produtoNomeFinal, produtoCriado };
        });

        if (resultado.ok) {
          const nomeUsado = resultado.produtoNomeFinal;
          importados.push({ chassi, produto: nomeUsado, linha: i + 1, origemProduto });

          // Só atualizar cache APÓS transação confirmada — evita usar ID de produto revertido
          if (resultado.produtoCriado) {
            criadosNestaImportacao.set(normBusca, resultado.produtoCriado);
            todosMoto.push(resultado.produtoCriado);
            if (!produtosCriadosAuto.includes(nomeUsado)) {
              produtosCriadosAuto.push(nomeUsado);
            }
          }

          const idx = estoquesAtualizados.findIndex(e => e.produto === nomeUsado && e.lojaId === lojaIdNum);
          if (idx >= 0) {
            estoquesAtualizados[idx].novaQuantidade = resultado.novaQuantidade;
          } else {
            estoquesAtualizados.push({ produto: nomeUsado, lojaId: lojaIdNum, novaQuantidade: resultado.novaQuantidade });
          }
        } else {
          ignorados.push({ chassi, produto: resultado.produtoNomeFinal, linha: i + 1, motivo: resultado.motivo });
        }
      } catch (txErr: any) {
        erros.push({ linha: i + 1, motivo: txErr?.message || 'Erro ao processar linha' });
      }
    }

    res.json({
      sucesso:                true,
      importados:             importados.length,
      ignorados:              ignorados.length,
      erros:                  erros.length,
      produtosEncontrados:    [...new Set(importados.filter(i => i.origemProduto === 'encontrado').map(i => i.produto))],
      produtosCriadosAuto,
      produtosSimilaresUsados,
      estoquesAtualizados,
      detalhes: {
        criados:   importados.slice(0, 50),
        ignorados: ignorados.slice(0, 50),
        erros:     erros.slice(0, 20),
      },
      detalhesErros: [
        ...ignorados.map(i => `Linha ${i.linha}: ${i.motivo}`),
        ...erros.map(e => `Linha ${e.linha}: ${e.motivo}`)
      ].slice(0, 15),
    });
  } catch (error: any) {
    console.error('Erro na importacao de unidades:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/gerar-codigo/:tipo', verifyToken, async (req, res) => {
  try {
    const { tipo } = req.params;
    let codigo: string;

    switch (tipo) {
      case 'MOTO':
      case 'PECA':
        codigo = await gerarCodigoProduto(tipo);
        break;
      case 'OS':
        codigo = await gerarCodigoOS();
        break;
      case 'UNIDADE':
        codigo = await gerarNumeroSerieUnidade();
        break;
      default:
        return res.status(400).json({ error: 'Tipo invalido' });
    }

    res.json({ codigo });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

export { gerarCodigoProduto, gerarCodigoOS, gerarNumeroSerieUnidade };
