-- =============================================================
-- FIX: UnidadeFisica — adicionar colunas fornecedorId e notaFiscalEntrada
-- Seguro: ADD COLUMN IF NOT EXISTS nunca falha se já existir
-- Não apaga dados. Não altera registros existentes.
-- Executar na VPS via: psql $DATABASE_URL -f fix-unidade-fisica-columns.sql
-- =============================================================

BEGIN;

-- 1. Adicionar colunas ausentes
ALTER TABLE "UnidadeFisica"
  ADD COLUMN IF NOT EXISTS "fornecedorId"      INTEGER,
  ADD COLUMN IF NOT EXISTS "notaFiscalEntrada" TEXT;

-- 2. Foreign key para Fornecedor (criada somente se não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   information_schema.table_constraints
    WHERE  constraint_name = 'UnidadeFisica_fornecedorId_fkey'
      AND  table_name      = 'UnidadeFisica'
  ) THEN
    ALTER TABLE "UnidadeFisica"
      ADD CONSTRAINT "UnidadeFisica_fornecedorId_fkey"
      FOREIGN KEY ("fornecedorId")
      REFERENCES "Fornecedor"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;

-- Verificação final (deve mostrar as duas colunas novas)
SELECT column_name, data_type, is_nullable
FROM   information_schema.columns
WHERE  table_name = 'UnidadeFisica'
  AND  column_name IN ('fornecedorId', 'notaFiscalEntrada')
ORDER  BY column_name;
