import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { prisma } from '../index.js';
import { verifyToken } from '../middleware/auth.js';

const router = Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.originalname.match(/\.(xls|xlsx|csv)$/i)) cb(null, true);
    else cb(new Error('Formato inválido. Use XLS, XLSX ou CSV.'));
  }
});

// Sanitiza dados lidos pelo xlsx para interromper Prototype Pollution (GHSA-4r6h-8v6p-xvw6)
// JSON.parse(JSON.stringify) cria objetos limpos sem herança de protótipo contaminado
function sanitizarPlanilha(dados: any[][]): any[][] {
  return JSON.parse(JSON.stringify(dados));
}

// ── Utilitários ───────────────────────────────────────────────────────────────

function parseBR(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isFinite(val) ? val : 0;
  const s = String(val).trim()
    .replace(/\s/g, '').replace('%', '')
    .replace(/^R\$/, '').replace(/^-R\$/, '-');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) {
    return s.lastIndexOf(',') > s.lastIndexOf('.')
      ? parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0
      : parseFloat(s.replace(/,/g, '')) || 0;
  }
  if (s.includes(',')) return parseFloat(s.replace(',', '.')) || 0;
  return parseFloat(s) || 0;
}

const MAX_MONEY = 99_999_999.99;
function clampMoney(v: number): number {
  if (!isFinite(v) || isNaN(v)) return 0;
  return Math.min(Math.max(v, 0), MAX_MONEY);
}

// Palavras-chave que indicam MOTO (elétrica, scooter, ciclomotor, etc.)
const MOTO_KEYWORDS = [
  'moto', 'motocicleta', 'scooter', 'scoote', 'elétric', 'eletric',
  'ciclomotor', 'patinete', 'e-bike', 'ebike', 'bike elétric',
  'vespa', 'quadriciclo', 'triciclo', 'mobilete', 'motoneta',
  'pop 100', 'biz', 'cg ', 'fazer ', 'factor ', 'neo ', 'nmax',
  'burgman', 'pcx', 'lead', 'elite', 'sh ', 'adv ', 'xre',
];

function inferirTipoPorNome(nome: string): 'MOTO' | 'PECA' {
  const lower = nome.toLowerCase();
  for (const kw of MOTO_KEYWORDS) {
    if (lower.includes(kw)) return 'MOTO';
  }
  return 'PECA';
}

function inferirTipoPorValor(val: any): 'MOTO' | 'PECA' | null {
  if (!val) return null;
  const s = String(val).trim().toLowerCase();
  if (s === 'moto' || s === 'motocicleta' || s === 'scooter' || s === 'veiculo' || s === 'veículo') return 'MOTO';
  if (s === 'peca' || s === 'peça' || s === 'acessorio' || s === 'acessório' || s === 'part') return 'PECA';
  if (s.includes('moto')) return 'MOTO';
  if (s.includes('pec') || s.includes('aces')) return 'PECA';
  return null;
}

// Encontra o índice de uma coluna dado lista de palavras-chave no header
function colIdx(header: string[], keywords: string[]): number {
  return header.findIndex(h => keywords.some(k => h.includes(k)));
}

async function gerarCodigoProduto(tipo: string): Promise<string> {
  const prefixo = tipo === 'MOTO' ? 'TMMOT' : 'TMPEC';
  const ultimo = await prisma.produto.findFirst({
    where: { codigo: { startsWith: prefixo } },
    orderBy: { codigo: 'desc' }
  });
  let numero = 1;
  if (ultimo) {
    const match = ultimo.codigo.match(/\d+$/);
    if (match) numero = parseInt(match[0]) + 1;
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
    if (match) numero = parseInt(match[0]) + 1;
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
  if (ultimo?.numeroSerie) {
    const match = ultimo.numeroSerie.match(/\d+$/);
    if (match) numero = parseInt(match[0]) + 1;
  }
  return `${prefixo}${String(numero).padStart(5, '0')}`;
}

// ── POST /importacao/produtos ────────────────────────────────────────────────
// Aceita qualquer planilha. Detecção automática de colunas via header.
// Determina MOTO vs PEÇA pela coluna "tipo/categoria" se existir,
// senão infere pelo nome do produto.
router.post('/produtos', verifyToken, upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const dados = sanitizarPlanilha(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]);

    if (dados.length < 2) return res.status(400).json({ error: 'Planilha vazia ou sem dados' });

    // ── Detectar colunas pelo cabeçalho ──────────────────────────────────────
    const headerRaw: string[] = (dados[0] as any[]).map(h => String(h ?? '').toLowerCase().trim());

    const iNome      = colIdx(headerRaw, ['nome', 'produto', 'modelo', 'descricao', 'descrição', 'name', 'item']);
    const iCusto     = colIdx(headerRaw, ['custo', 'cif', 'valor custo', 'preco custo', 'preço custo', 'cost']);
    const iPreco     = colIdx(headerRaw, ['preco venda', 'preço venda', 'pvp', 'venda', 'price']);
    const iTipo      = colIdx(headerRaw, ['tipo', 'categoria', 'category', 'type', 'classe']);
    const iMargem    = colIdx(headerRaw, ['margem', 'lucro', 'markup', 'margin']);
    const iUnidade   = colIdx(headerRaw, ['unidade', 'un', 'unit', 'und']);

    // Fallback: se não achou coluna de nome, usa coluna 1 (col B)
    const colNome  = iNome  >= 0 ? iNome  : 1;
    const colCusto = iCusto >= 0 ? iCusto : 2;

    const config = await prisma.configuracao.findFirst();
    const margemMoto = config ? Number(config.lucroMoto) : 30;
    const margemPeca = config ? Number(config.lucroPeca) : 30;

    const criados: any[]    = [];
    const atualizados: any[] = [];
    const erros: string[]   = [];

    // Log do mapeamento detectado
    console.log('[Importação Produtos] Header detectado:', headerRaw);
    console.log('[Importação Produtos] Mapeamento:', { colNome, colCusto, iTipo, iPreco, iMargem });

    for (let i = 1; i < dados.length; i++) {
      const row = dados[i];
      const nome = String(row[colNome] ?? '').trim();
      if (!nome) continue;

      try {
        const custo = clampMoney(parseBR(row[colCusto]));

        // ── Determinar tipo: coluna explícita → inferência pelo nome ──────
        let tipo: 'MOTO' | 'PECA';
        if (iTipo >= 0 && row[iTipo]) {
          const tipoInferido = inferirTipoPorValor(row[iTipo]);
          tipo = tipoInferido ?? inferirTipoPorNome(nome);
        } else {
          tipo = inferirTipoPorNome(nome);
        }

        // ── Calcular preço ─────────────────────────────────────────────────
        let preco: number;
        if (iPreco >= 0 && parseBR(row[iPreco]) > 0) {
          preco = clampMoney(parseBR(row[iPreco]));
        } else {
          const margem = iMargem >= 0 && parseBR(row[iMargem]) > 0
            ? parseBR(row[iMargem])
            : (tipo === 'MOTO' ? margemMoto : margemPeca);
          const denominador = 1 - margem / 100;
          preco = clampMoney(
            custo > 0 && denominador > 0.001
              ? custo / denominador
              : custo > 0 ? custo * 1.3 : 0
          );
        }

        const percentualLucro = tipo === 'MOTO' ? margemMoto : margemPeca;
        const unidade = iUnidade >= 0 ? String(row[iUnidade] ?? '').trim() || null : null;

        // ── Upsert produto ─────────────────────────────────────────────────
        const existente = await prisma.produto.findFirst({
          where: { nome: { equals: nome, mode: 'insensitive' } }
        });

        if (existente) {
          const atualizado = await prisma.produto.update({
            where: { id: existente.id },
            data: { tipo, custo, percentualLucro, preco, ativo: true }
          });
          atualizados.push({ nome, tipo });
        } else {
          const codigo = await gerarCodigoProduto(tipo);
          const criado = await prisma.produto.create({
            data: { codigo, nome, tipo, custo, percentualLucro, preco, ativo: true }
          });
          criados.push({ nome, tipo });
        }
      } catch (lineErr: any) {
        console.error(`Importação linha ${i + 1}:`, lineErr.message);
        erros.push(`Linha ${i + 1} (${nome}): ${lineErr.message}`);
      }
    }

    res.json({
      sucesso: true,
      criados: criados.length,
      atualizados: atualizados.length,
      erros: erros.length,
      detalhesErros: erros.slice(0, 20),
      amostraCriados: criados.slice(0, 10),
      colunasDetectadas: {
        nome: headerRaw[colNome] || `coluna ${colNome + 1}`,
        custo: colCusto >= 0 ? headerRaw[colCusto] || `coluna ${colCusto + 1}` : 'não encontrada',
        tipo: iTipo >= 0 ? headerRaw[iTipo] : 'inferido pelo nome',
        preco: iPreco >= 0 ? headerRaw[iPreco] : 'calculado pela margem',
      }
    });
  } catch (error: any) {
    console.error('[Importação Produtos]', error);
    res.status(500).json({ error: error.message });
  }
});

// ── POST /importacao/servicos ────────────────────────────────────────────────
router.post('/servicos', verifyToken, upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const dados = sanitizarPlanilha(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]);

    const headerRaw: string[] = (dados[0] as any[]).map(h => String(h ?? '').toLowerCase().trim());
    const iNome   = colIdx(headerRaw, ['nome', 'servico', 'serviço', 'descricao', 'descrição']);
    const iPreco  = colIdx(headerRaw, ['preco', 'preço', 'valor', 'price']);
    const iDuracao = colIdx(headerRaw, ['duracao', 'duração', 'tempo', 'minutos', 'min']);

    const colNome  = iNome  >= 0 ? iNome  : 0;
    const colPreco = iPreco >= 0 ? iPreco : 1;

    const servicos: any[] = [];
    const erros: string[] = [];

    for (let i = 1; i < dados.length; i++) {
      const row = dados[i];
      const nome = String(row[colNome] ?? '').trim();
      if (!nome) continue;

      const preco   = clampMoney(parseBR(row[colPreco]));
      const duracao = iDuracao >= 0 ? (parseInt(row[iDuracao]) || null) : null;

      try {
        const existente = await prisma.servico.findFirst({
          where: { nome: { equals: nome, mode: 'insensitive' } }
        });
        if (existente) {
          await prisma.servico.update({ where: { id: existente.id }, data: { preco, duracao, ativo: true } });
          servicos.push({ nome, acao: 'atualizado' });
        } else {
          await prisma.servico.create({ data: { nome, preco, duracao, ativo: true } });
          servicos.push({ nome, acao: 'criado' });
        }
      } catch (lineErr: any) {
        erros.push(`Linha ${i + 1} (${nome}): ${lineErr.message}`);
      }
    }

    res.json({ sucesso: true, importados: servicos.length, erros: erros.length, detalhesErros: erros.slice(0, 10) });
  } catch (error: any) {
    console.error('[Importação Serviços]', error);
    res.status(500).json({ error: error.message });
  }
});

// ── POST /importacao/unidades ────────────────────────────────────────────────
router.post('/unidades', verifyToken, upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

    const { lojaId } = req.body;
    if (!lojaId) return res.status(400).json({ error: 'Loja é obrigatória' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const dados = sanitizarPlanilha(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]);

    const headerRaw: string[] = (dados[0] as any[]).map(h => String(h ?? '').toLowerCase().trim());
    const iProduto = colIdx(headerRaw, ['modelo', 'produto', 'nome', 'name']);
    const iCor     = colIdx(headerRaw, ['cor', 'color']);
    const iChassi  = colIdx(headerRaw, ['chassi', 'chassis', 'vin']);
    const iMotor   = colIdx(headerRaw, ['motor', 'engine']);
    const iAno     = colIdx(headerRaw, ['ano', 'year']);

    const colProduto = iProduto >= 0 ? iProduto : 0;
    const colChassi  = iChassi  >= 0 ? iChassi  : 2;

    const unidades: any[] = [];
    const erros: string[] = [];
    const duplicados: Array<{ linha: number; chassi: string; modelo: string; lojaOndeEsta: string }> = [];

    for (let i = 1; i < dados.length; i++) {
      const row = dados[i];
      const produtoNome = String(row[colProduto] ?? '').trim();
      if (!produtoNome) continue;

      const chassi = (iChassi >= 0 ? String(row[iChassi] ?? '') : String(row[colChassi] ?? '')).trim().toUpperCase();
      const cor    = iCor   >= 0 ? String(row[iCor]   ?? '').trim() : '';
      const motor  = iMotor >= 0 ? String(row[iMotor] ?? '').trim() : '';
      const ano    = iAno   >= 0 ? parseInt(row[iAno]) || new Date().getFullYear() : new Date().getFullYear();

      try {
        let produto = await prisma.produto.findFirst({
          where: { nome: { contains: produtoNome, mode: 'insensitive' }, tipo: 'MOTO' }
        });

        if (!produto) {
          const codigo = await gerarCodigoProduto('MOTO');
          produto = await prisma.produto.create({
            data: { codigo, nome: produtoNome, tipo: 'MOTO', custo: 0, percentualLucro: 30, preco: 0, ativo: true }
          });
        }

        if (chassi) {
          const dup = await prisma.unidadeFisica.findFirst({
            where: { chassi },
            include: { loja: { select: { nomeFantasia: true, razaoSocial: true } } }
          });
          if (dup) {
            duplicados.push({
              linha: i + 1,
              chassi,
              modelo: produto.nome,
              lojaOndeEsta: dup.loja?.nomeFantasia || dup.loja?.razaoSocial || `Loja #${dup.lojaId}`
            });
            continue;
          }
        }

        const numeroSerie = await gerarNumeroSerieUnidade();
        await prisma.unidadeFisica.create({
          data: {
            produtoId: produto.id,
            lojaId: parseInt(lojaId),
            cor: cor || null,
            chassi: chassi || null,
            codigoMotor: motor || null,
            ano,
            numeroSerie,
            status: 'ESTOQUE'
          }
        });
        unidades.push({ produtoNome, chassi });
      } catch (lineErr: any) {
        erros.push(`Linha ${i + 1} (${produtoNome}): ${lineErr.message}`);
      }
    }

    res.json({
      sucesso: true,
      importados: unidades.length,
      erros: erros.length,
      detalhesErros: erros.slice(0, 10),
      duplicados: duplicados.length,
      detalhesDuplicados: duplicados
    });
  } catch (error: any) {
    console.error('[Importação Unidades]', error);
    res.status(500).json({ error: error.message });
  }
});

// ── POST /importacao/estoque ─────────────────────────────────────────────────
// Importa estoque geral. Detecta colunas automaticamente.
// Determina MOTO vs PEÇA pela coluna tipo/categoria ou nome do produto.
router.post('/estoque', verifyToken, upload.single('arquivo'), async (req: any, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

    const userId: number = req.user?.id ?? 1;
    const todasLojas = await prisma.loja.findMany({ select: { id: true, nomeFantasia: true, razaoSocial: true } });

    function resolverLoja(nomeInput: string): number | null {
      if (!nomeInput) return null;
      const n = nomeInput.trim().toLowerCase();
      const exata = todasLojas.find(l =>
        (l.nomeFantasia ?? '').toLowerCase() === n || (l.razaoSocial ?? '').toLowerCase() === n
      );
      if (exata) return exata.id;
      const parcial = todasLojas.find(l => {
        const nf = (l.nomeFantasia ?? '').toLowerCase();
        return nf.includes(n) || n.includes(nf.split(' ').slice(-1)[0] ?? '');
      });
      return parcial?.id ?? null;
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = sanitizarPlanilha(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]);

    if (rows.length < 2) return res.status(400).json({ error: 'Planilha vazia ou sem dados' });

    const headerRaw: string[] = (rows[0] as any[]).map(h => String(h ?? '').toLowerCase().trim());

    const iModelo  = colIdx(headerRaw, ['modelo', 'produto', 'nome', 'descricao', 'descrição', 'name', 'item']);
    const iCor     = colIdx(headerRaw, ['cor', 'color']);
    const iCusto   = colIdx(headerRaw, ['custo', 'cif', 'valor custo', 'preco custo', 'cost']);
    const iLoja    = colIdx(headerRaw, ['estoque', 'unidade', 'loja', 'destino', 'filial']);
    const iQtd     = colIdx(headerRaw, ['qtd', 'quantidade', 'qty', 'quant']);
    const iChassi  = colIdx(headerRaw, ['chassi', 'chassis', 'vin']);
    const iTipo    = colIdx(headerRaw, ['tipo', 'categoria', 'category', 'type']);

    if (iModelo < 0) return res.status(400).json({ error: 'Coluna de modelo/produto não encontrada. Certifique que o cabeçalho tem "Modelo", "Produto" ou "Nome".' });
    if (iLoja < 0)   return res.status(400).json({ error: 'Coluna de loja/destino não encontrada. Certifique que o cabeçalho tem "Loja", "Estoque" ou "Destino".' });

    console.log('[Importação Estoque] Header:', headerRaw);
    console.log('[Importação Estoque] Mapeamento:', { iModelo, iCor, iCusto, iLoja, iQtd, iChassi, iTipo });

    let criados = 0, atualizados = 0, entradas = 0;
    const erros: string[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const nomeModelo = String(row[iModelo] ?? '').trim();
      if (!nomeModelo) continue;

      const nomeLojaStr = String(row[iLoja] ?? '').trim();
      const lojaId = resolverLoja(nomeLojaStr);
      if (!lojaId) { erros.push(`Linha ${i + 1}: loja "${nomeLojaStr}" não encontrada`); continue; }

      const cor       = iCor    >= 0 ? String(row[iCor]   ?? '').trim() : null;
      const custo     = clampMoney(parseBR(iCusto >= 0 ? row[iCusto] : 0));
      const qtd       = Math.max(1, Number(iQtd >= 0 ? (row[iQtd] || 1) : 1));
      const chassiVal = iChassi >= 0 ? String(row[iChassi] ?? '').trim() : null;

      // Determinar tipo
      let tipo: 'MOTO' | 'PECA';
      if (iTipo >= 0 && row[iTipo]) {
        const tipoExplicito = inferirTipoPorValor(row[iTipo]);
        tipo = tipoExplicito ?? inferirTipoPorNome(nomeModelo);
      } else {
        tipo = chassiVal ? 'MOTO' : inferirTipoPorNome(nomeModelo);
      }

      try {
        let produto = await prisma.produto.findFirst({
          where: { nome: { equals: nomeModelo, mode: 'insensitive' } }
        });

        if (!produto) {
          const codigo = await gerarCodigoProduto(tipo);
          produto = await prisma.produto.create({
            data: { codigo, nome: nomeModelo, tipo, custo, preco: custo > 0 ? custo * 1.3 : 0, percentualLucro: 30, ativo: true }
          });
          criados++;
        } else if (custo > 0 && Number(produto.custo) !== custo) {
          await prisma.produto.update({ where: { id: produto.id }, data: { custo } });
          atualizados++;
        }

        // Criar UnidadeFisica se chassi presente e produto MOTO
        if (chassiVal && produto.tipo === 'MOTO') {
          const dup = await prisma.unidadeFisica.findFirst({ where: { chassi: chassiVal } });
          if (dup) { erros.push(`Linha ${i + 1}: chassi "${chassiVal}" já cadastrado`); continue; }
          const numeroSerie = await gerarNumeroSerieUnidade();
          await prisma.unidadeFisica.create({
            data: { produtoId: produto.id, lojaId, chassi: chassiVal, cor: cor || null, ano: new Date().getFullYear(), numeroSerie, status: 'ESTOQUE', createdBy: userId }
          });
        }

        // Lançar entrada de estoque
        const atual = await prisma.estoque.findUnique({ where: { produtoId_lojaId: { produtoId: produto.id, lojaId } } });
        const qtdAnt = atual?.quantidade ?? 0;
        await prisma.estoque.upsert({
          where: { produtoId_lojaId: { produtoId: produto.id, lojaId } },
          update: { quantidade: { increment: qtd } },
          create: { produtoId: produto.id, lojaId, quantidade: qtd },
        });
        await prisma.logEstoque.create({
          data: { tipo: 'ENTRADA', origem: 'IMPORTACAO_ESTOQUE', produtoId: produto.id, lojaId, quantidade: qtd, quantidadeAnterior: qtdAnt, quantidadeNova: qtdAnt + qtd, usuarioId: userId }
        });
        entradas++;
      } catch (lineErr: any) {
        erros.push(`Linha ${i + 1} (${nomeModelo}): ${lineErr.message}`);
      }
    }

    res.json({
      sucesso: true,
      totalLinhas: rows.length - 1,
      produtosCriados: criados,
      produtosAtualizados: atualizados,
      entradasLancadas: entradas,
      erros: erros.length,
      detalhesErros: erros.slice(0, 20),
      colunasDetectadas: {
        modelo: headerRaw[iModelo],
        loja: headerRaw[iLoja],
        tipo: iTipo >= 0 ? headerRaw[iTipo] : 'inferido pelo nome/chassi',
        custo: iCusto >= 0 ? headerRaw[iCusto] : 'não encontrada',
        chassi: iChassi >= 0 ? headerRaw[iChassi] : 'não encontrada',
      }
    });
  } catch (error: any) {
    console.error('[Importação Estoque]', error);
    res.status(500).json({ error: error.message });
  }
});

// ── GET /importacao/modelo/:tipo — baixar planilha modelo ────────────────────
router.get('/modelo/:tipo', verifyToken, (req, res) => {
  const { tipo } = req.params;

  let sheetData: any[][];
  let filename: string;

  if (tipo === 'produtos') {
    filename = 'modelo_importacao_produtos.xlsx';
    sheetData = [
      // Cabeçalho
      ['Nome', 'Tipo', 'Custo (R$)', 'Preco Venda (R$)', 'Margem (%)'],
      // Linha de instrução (em itálico visual via valor)
      ['OBRIGATORIO', 'Moto ou Peca', 'Opcional', 'Opcional - se vazio usa margem', 'Opcional - se vazio usa config do sistema'],
      // Exemplos
      ['Scooter Eletrica 1500W', 'Moto', 3500.00, '', ''],
      ['Scooter Cargo 2000W', 'Moto', 4200.00, '', ''],
      ['Kit Relacao 428H', 'Peca', 85.00, '', ''],
      ['Capacete Integral Preto', 'Peca', 120.00, '', ''],
      ['Freio a Disco Dianteiro', 'Peca', 75.00, '', ''],
      ['Bateria 60V 20Ah', 'Peca', 320.00, '', ''],
    ];
  } else if (tipo === 'servicos') {
    filename = 'modelo_importacao_servicos.xlsx';
    sheetData = [
      ['Nome', 'Preco (R$)', 'Duracao (min)'],
      ['OBRIGATORIO', 'OBRIGATORIO', 'Opcional - ex: 30, 60, 90'],
      ['Revisao Geral', 150.00, 60],
      ['Troca de Oleo', 80.00, 30],
      ['Alinhamento e Balanceamento', 90.00, 45],
      ['Calibragem de Pneus', 20.00, 15],
      ['Diagnostico Eletrico', 120.00, 45],
    ];
  } else if (tipo === 'unidades') {
    filename = 'modelo_importacao_unidades.xlsx';
    sheetData = [
      ['Modelo', 'Cor', 'Chassi', 'Motor', 'Ano'],
      ['Nome exato do produto no sistema', 'Opcional', 'Opcional', 'Opcional', 'Opcional - padrao ano atual'],
      ['Scooter Eletrica 1500W', 'Branca', '9BWZZZ377VT004251', 'EL1500BR', 2024],
      ['Scooter Eletrica 1500W', 'Preta', '9BWZZZ377VT004252', 'EL1500BR', 2024],
      ['Scooter Cargo 2000W', 'Azul', '9BWZZZ377VT004253', 'EL2000CG', 2025],
    ];
  } else if (tipo === 'estoque') {
    filename = 'modelo_importacao_estoque.xlsx';
    sheetData = [
      ['Modelo', 'Loja', 'Tipo', 'Cor', 'Custo (R$)', 'Chassi', 'Quantidade'],
      ['Nome do produto', 'Nome da loja de destino', 'Moto ou Peca', 'Opcional', 'Opcional', 'Opcional (so MOTO)', 'Opcional - padrao 1'],
      ['Scooter Eletrica 1500W', 'TM Importacao', 'Moto', 'Branca', 3500.00, '9BWZZZ377VT004251', 1],
      ['Scooter Eletrica 1500W', 'TM Recreio', 'Moto', 'Preta', 3500.00, '9BWZZZ377VT004252', 1],
      ['Scooter Cargo 2000W', 'TM Barra', 'Moto', 'Azul', 4200.00, '', 1],
      ['Kit Relacao 428H', 'TM Importacao', 'Peca', '', 85.00, '', 10],
      ['Capacete Integral Preto', 'TM Campo Grande', 'Peca', 'Preto', 120.00, '', 5],
      ['Bateria 60V 20Ah', 'TM Recreio', 'Peca', '', 320.00, '', 3],
    ];
  } else {
    return res.status(400).json({ error: 'Tipo de modelo inválido. Use: produtos, servicos, unidades, estoque' });
  }

  const wb  = XLSX.utils.book_new();
  const ws  = XLSX.utils.aoa_to_sheet(sheetData);

  // Larguras automáticas das colunas
  ws['!cols'] = sheetData[0].map((_: any, ci: number) => ({
    wch: Math.max(...sheetData.map(r => String(r[ci] ?? '').length), 14)
  }));

  XLSX.utils.book_append_sheet(wb, ws, 'Modelo');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

// ── GET /importacao/gerar-codigo/:tipo ───────────────────────────────────────
router.get('/gerar-codigo/:tipo', verifyToken, async (req, res) => {
  try {
    const { tipo } = req.params;
    let codigo: string;
    switch (tipo) {
      case 'MOTO': case 'PECA': codigo = await gerarCodigoProduto(tipo); break;
      case 'OS':                 codigo = await gerarCodigoOS();          break;
      case 'UNIDADE':            codigo = await gerarNumeroSerieUnidade(); break;
      default: return res.status(400).json({ error: 'Tipo inválido' });
    }
    res.json({ codigo });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
export { gerarCodigoProduto, gerarCodigoOS, gerarNumeroSerieUnidade };
