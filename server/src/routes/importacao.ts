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

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const dados = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    // Buscar todos os produtos MOTO uma vez para normalização de nome
    const todosMoto = await prisma.produto.findMany({ where: { tipo: 'MOTO' } });

    const importados: Array<{ chassi: string; produto: string; linha: number }> = [];
    const ignorados: Array<{ chassi?: string; produto?: string; linha: number; motivo: string }> = [];
    const erros: Array<{ linha: number; motivo: string }> = [];
    const estoquesAtualizados: Array<{ produto: string; lojaId: number; novaQuantidade: number }> = [];

    for (let i = 1; i < dados.length; i++) {
      const row = dados[i];
      if (!row || (!row[0] && !row[2])) continue;

      const produtoNomeBruto = String(row[0] || '').trim();
      const cor = String(row[1] || '').trim();
      const chassi = String(row[2] || '').trim().toUpperCase();
      const motor = String(row[3] || '').trim().toUpperCase();
      const ano = parseInt(row[4]) || new Date().getFullYear();

      if (!produtoNomeBruto) {
        erros.push({ linha: i + 1, motivo: 'Nome do produto vazio' });
        continue;
      }

      if (!chassi) {
        ignorados.push({ produto: produtoNomeBruto, linha: i + 1, motivo: 'Chassi não informado' });
        continue;
      }

      // Busca de produto: 1) nome exato, 2) nome normalizado, 3) contains
      const normBusca = normalizarNomeProduto(produtoNomeBruto);
      let produto =
        todosMoto.find(p => p.nome === produtoNomeBruto) ||
        todosMoto.find(p => normalizarNomeProduto(p.nome) === normBusca) ||
        todosMoto.find(p => p.nome.toLowerCase().includes(produtoNomeBruto.toLowerCase())) ||
        null;

      if (!produto) {
        ignorados.push({
          chassi,
          produto: produtoNomeBruto,
          linha: i + 1,
          motivo: `Produto "${produtoNomeBruto}" não encontrado. Cadastre o produto antes de importar.`
        });
        continue;
      }

      // Gerar numeroSerie antes da transação para não misturar clientes prisma
      const numeroSerie = await gerarNumeroSerieUnidade();

      // Cada linha é atômica: UnidadeFisica + Estoque + LogEstoque juntos ou nenhum
      try {
        const resultado = await prisma.$transaction(async (tx) => {
          const chassiExistente = await tx.unidadeFisica.findFirst({ where: { chassi } });
          if (chassiExistente) {
            return { ok: false, motivo: `Chassi "${chassi}" já está cadastrado` };
          }

          await tx.unidadeFisica.create({
            data: {
              produtoId: produto!.id,
              lojaId: lojaIdNum,
              cor: cor || null,
              chassi,
              codigoMotor: motor || null,
              ano,
              numeroSerie,
              status: 'ESTOQUE',
              createdBy: usuarioId,
            }
          });

          const estoqueAtual = await tx.estoque.findUnique({
            where: { produtoId_lojaId: { produtoId: produto!.id, lojaId: lojaIdNum } }
          });

          const qtdAnterior = estoqueAtual?.quantidade ?? 0;
          const qtdNova = qtdAnterior + 1;

          if (estoqueAtual) {
            await tx.estoque.update({
              where: { id: estoqueAtual.id },
              data: { quantidade: qtdNova }
            });
          } else {
            await tx.estoque.create({
              data: { produtoId: produto!.id, lojaId: lojaIdNum, quantidade: 1 }
            });
          }

          await tx.logEstoque.create({
            data: {
              tipo: 'ENTRADA',
              origem: 'IMPORTACAO_PLANILHA',
              produtoId: produto!.id,
              lojaId: lojaIdNum,
              quantidade: 1,
              quantidadeAnterior: qtdAnterior,
              quantidadeNova: qtdNova,
              usuarioId,
            }
          });

          return { ok: true, novaQuantidade: qtdNova };
        });

        if (resultado.ok) {
          importados.push({ chassi, produto: produto.nome, linha: i + 1 });
          const idx = estoquesAtualizados.findIndex(
            e => e.produto === produto!.nome && e.lojaId === lojaIdNum
          );
          if (idx >= 0) {
            estoquesAtualizados[idx].novaQuantidade = resultado.novaQuantidade!;
          } else {
            estoquesAtualizados.push({ produto: produto.nome, lojaId: lojaIdNum, novaQuantidade: resultado.novaQuantidade! });
          }
        } else {
          ignorados.push({ chassi, produto: produto.nome, linha: i + 1, motivo: resultado.motivo! });
        }
      } catch (txErr: any) {
        erros.push({ linha: i + 1, motivo: txErr?.message || 'Erro ao processar linha' });
      }
    }

    res.json({
      sucesso: true,
      importados: importados.length,
      ignorados: ignorados.length,
      erros: erros.length,
      detalhes: {
        criados: importados.slice(0, 50),
        ignorados: ignorados.slice(0, 50),
        erros: erros.slice(0, 20),
      },
      estoquesAtualizados,
      detalhesErros: [
        ...ignorados.map(i => `Linha ${i.linha}: ${i.motivo}`),
        ...erros.map(e => `Linha ${e.linha}: ${e.motivo}`)
      ].slice(0, 15)
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
