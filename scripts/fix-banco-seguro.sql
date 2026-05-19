-- ============================================================
-- FIX BANCO SEGURO — Aplicar APÓS rodar diagnostico-banco-completo.sql
-- e confirmar quais colunas/enums estão faltando.
--
-- REGRAS:
--   ADD COLUMN IF NOT EXISTS  → nunca falha se já existir
--   ALTER TYPE ADD VALUE IF NOT EXISTS → nunca falha se valor já existe
--   Nenhuma coluna é removida. Nenhum dado é alterado.
--
-- Executar: psql $DATABASE_URL -f fix-banco-seguro.sql
-- ============================================================

BEGIN;

-- ============================================================
-- BLOCO 1 — UnidadeFisica: colunas que o Prisma espera mas o banco não tem
-- ============================================================

ALTER TABLE "UnidadeFisica"
  ADD COLUMN IF NOT EXISTS "fornecedorId"      INTEGER,
  ADD COLUMN IF NOT EXISTS "notaFiscalEntrada" TEXT;

-- Foreign key para Fornecedor (segura — verifica antes)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE  constraint_name = 'UnidadeFisica_fornecedorId_fkey'
      AND  table_name      = 'UnidadeFisica'
  ) THEN
    ALTER TABLE "UnidadeFisica"
      ADD CONSTRAINT "UnidadeFisica_fornecedorId_fkey"
      FOREIGN KEY ("fornecedorId")
      REFERENCES "Fornecedor"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ============================================================
-- BLOCO 2 — LogAuditoria: colunas extras que o código usa
-- (userName, userRole, detalhes, ip — usados em auth.ts, vendas.ts, log-atividades.ts)
-- ============================================================

ALTER TABLE "LogAuditoria"
  ADD COLUMN IF NOT EXISTS "userName"  TEXT,
  ADD COLUMN IF NOT EXISTS "userRole"  TEXT,
  ADD COLUMN IF NOT EXISTS "detalhes"  TEXT,
  ADD COLUMN IF NOT EXISTS "ip"        TEXT;

-- usuarioId no banco pode ser NOT NULL (server schema) mas o código às vezes passa NULL
-- Tornamos nullable de forma segura (DROP NOT NULL nunca perde dados)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_name   = 'LogAuditoria'
      AND  column_name  = 'usuarioId'
      AND  is_nullable  = 'NO'
  ) THEN
    ALTER TABLE "LogAuditoria" ALTER COLUMN "usuarioId" DROP NOT NULL;
  END IF;
END $$;

-- entidade: o root schema define @default("") — coloca default seguro
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_name  = 'LogAuditoria'
      AND  column_name = 'entidade'
  ) THEN
    ALTER TABLE "LogAuditoria"
      ALTER COLUMN "entidade" SET DEFAULT '';
  END IF;
END $$;

-- ============================================================
-- BLOCO 3 — Enums: adicionar valores que podem estar faltando
-- ALTER TYPE ADD VALUE IF NOT EXISTS é seguro e não quebra dados existentes
-- ============================================================

-- FormaPagamento: COMBINADO
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE  t.typname = 'FormaPagamento' AND e.enumlabel = 'COMBINADO'
  ) THEN
    ALTER TYPE "FormaPagamento" ADD VALUE 'COMBINADO';
  END IF;
END $$;

-- Role: SUPER_ADMIN
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE  t.typname = 'Role' AND e.enumlabel = 'SUPER_ADMIN'
  ) THEN
    ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN';
  END IF;
END $$;

-- Role: ADMIN_COMERCIAL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE  t.typname = 'Role' AND e.enumlabel = 'ADMIN_COMERCIAL'
  ) THEN
    ALTER TYPE "Role" ADD VALUE 'ADMIN_COMERCIAL';
  END IF;
END $$;

-- StatusDisparo: ABERTO (adicionado ao schema mais recente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
    WHERE  t.typname = 'StatusDisparo' AND e.enumlabel = 'ABERTO'
  ) THEN
    ALTER TYPE "StatusDisparo" ADD VALUE 'ABERTO';
  END IF;
END $$;

-- ============================================================
-- BLOCO 4 — Lead e LeadInteracao: criar tabelas se não existirem
-- ============================================================

-- Enums necessários para Lead (criar apenas se não existem)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrigemLead') THEN
    CREATE TYPE "OrigemLead" AS ENUM (
      'META', 'GOOGLE', 'SITE', 'WHATSAPP', 'INDICACAO', 'OUTRO', 'TESTE'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InteresseLead') THEN
    CREATE TYPE "InteresseLead" AS ENUM (
      'MOTO', 'PECA', 'SERVICO', 'CURSO', 'OUTRO'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StatusLead') THEN
    CREATE TYPE "StatusLead" AS ENUM (
      'NOVO', 'EM_ATENDIMENTO', 'PROPOSTA_ENVIADA', 'GANHO', 'PERDIDO', 'SEM_RESPOSTA'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PrioridadeLead') THEN
    CREATE TYPE "PrioridadeLead" AS ENUM ('BAIXA', 'MEDIA', 'ALTA');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TipoInteracaoLead') THEN
    CREATE TYPE "TipoInteracaoLead" AS ENUM (
      'LIGACAO', 'WHATSAPP', 'EMAIL', 'REUNIAO', 'VISITA', 'OBSERVACAO', 'FOLLOW_UP'
    );
  END IF;
END $$;

-- Tabela Lead
CREATE TABLE IF NOT EXISTS "Lead" (
  "id"                      SERIAL PRIMARY KEY,
  "nome"                    TEXT NOT NULL,
  "telefone"                TEXT,
  "email"                   TEXT,
  "origem"                  "OrigemLead"     NOT NULL DEFAULT 'OUTRO',
  "campanha"                TEXT,
  "interesse"               "InteresseLead"  NOT NULL DEFAULT 'MOTO',
  "interesseCorrigido"      TEXT,
  "lojaId"                  INTEGER,
  "vendedorId"              INTEGER,
  "repassadoPorId"          INTEGER,
  "dataRepasseVendedor"     TIMESTAMP(3),
  "status"                  "StatusLead"     NOT NULL DEFAULT 'NOVO',
  "prioridade"              "PrioridadeLead" NOT NULL DEFAULT 'MEDIA',
  "resumo"                  TEXT,
  "proximaAcao"             TEXT,
  "mensagemWhatsApp"        TEXT,
  "dataProximoFollowUp"     TIMESTAMP(3),
  "observacoes"             TEXT,
  "whatsappComercialOrigem" TEXT,
  "canalOrigem"             TEXT,
  "mensagemRecebida"        TEXT,
  "linkConversa"            TEXT,
  "regiaoCliente"           TEXT,
  "bairroCliente"           TEXT,
  "cidadeCliente"           TEXT,
  "ufCliente"               TEXT,
  "lojaSugerida"            TEXT,
  "motivoLojaSugerida"      TEXT,
  "origemRepasse"           TEXT,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Foreign keys de Lead (seguras)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE  constraint_name = 'Lead_lojaId_fkey' AND table_name = 'Lead'
  ) THEN
    ALTER TABLE "Lead"
      ADD CONSTRAINT "Lead_lojaId_fkey"
      FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE  constraint_name = 'Lead_vendedorId_fkey' AND table_name = 'Lead'
  ) THEN
    ALTER TABLE "Lead"
      ADD CONSTRAINT "Lead_vendedorId_fkey"
      FOREIGN KEY ("vendedorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE  constraint_name = 'Lead_repassadoPorId_fkey' AND table_name = 'Lead'
  ) THEN
    ALTER TABLE "Lead"
      ADD CONSTRAINT "Lead_repassadoPorId_fkey"
      FOREIGN KEY ("repassadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Tabela LeadInteracao
CREATE TABLE IF NOT EXISTS "LeadInteracao" (
  "id"        SERIAL PRIMARY KEY,
  "leadId"    INTEGER NOT NULL,
  "usuarioId" INTEGER NOT NULL,
  "tipo"      "TipoInteracaoLead" NOT NULL DEFAULT 'OBSERVACAO',
  "descricao" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE  constraint_name = 'LeadInteracao_leadId_fkey' AND table_name = 'LeadInteracao'
  ) THEN
    ALTER TABLE "LeadInteracao"
      ADD CONSTRAINT "LeadInteracao_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE  constraint_name = 'LeadInteracao_usuarioId_fkey' AND table_name = 'LeadInteracao'
  ) THEN
    ALTER TABLE "LeadInteracao"
      ADD CONSTRAINT "LeadInteracao_usuarioId_fkey"
      FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ============================================================
-- BLOCO 5 — Colunas extras em ContaPagar que o Prisma espera
-- ============================================================
ALTER TABLE "ContaPagar"
  ADD COLUMN IF NOT EXISTS "fornecedorId"   INTEGER,
  ADD COLUMN IF NOT EXISTS "departamentoId" INTEGER,
  ADD COLUMN IF NOT EXISTS "categoriaId"    INTEGER,
  ADD COLUMN IF NOT EXISTS "centroCusto"    TEXT,
  ADD COLUMN IF NOT EXISTS "documento"      TEXT,
  ADD COLUMN IF NOT EXISTS "numeroParcelas" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "pedidoCompraId" INTEGER;

-- ============================================================
-- BLOCO 6 — Colunas extras em PedidoCompra
-- ============================================================
ALTER TABLE "PedidoCompra"
  ADD COLUMN IF NOT EXISTS "dataPagamento"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "metodoPagamento" TEXT,
  ADD COLUMN IF NOT EXISTS "numeroParcelas"  INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "categoriaId"     INTEGER,
  ADD COLUMN IF NOT EXISTS "departamentoId"  INTEGER;

COMMIT;

-- ============================================================
-- VERIFICAÇÃO FINAL (somente leitura, fora do BEGIN/COMMIT)
-- ============================================================
\echo ''
\echo '=== VERIFICAÇÃO PÓS-FIX: colunas UnidadeFisica ==='
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_name = 'UnidadeFisica'
ORDER  BY ordinal_position;

\echo ''
\echo '=== VERIFICAÇÃO PÓS-FIX: colunas LogAuditoria ==='
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_name = 'LogAuditoria'
ORDER  BY ordinal_position;

\echo ''
\echo '=== VERIFICAÇÃO PÓS-FIX: enum FormaPagamento ==='
SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
WHERE  t.typname = 'FormaPagamento' ORDER BY e.enumsortorder;

\echo ''
\echo '=== VERIFICAÇÃO PÓS-FIX: tabelas Lead/LeadInteracao ==='
SELECT table_name FROM information_schema.tables
WHERE  table_schema = 'public'
  AND  table_name   IN ('Lead', 'LeadInteracao');
