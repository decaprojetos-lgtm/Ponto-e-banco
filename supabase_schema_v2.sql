-- ==============================================================================
-- NOBEL PETRÓPOLIS - PONTO & BANCO V2 (SCHEMA SEGURO COM RLS + PERMISSÕES)
-- ==============================================================================

-- 1. TABELA DE COLABORADORES (employees)
CREATE TABLE IF NOT EXISTS public.employees (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    role TEXT DEFAULT '',
    "baseDailyMinutes" INTEGER NOT NULL DEFAULT 480,
    "englishWeekDay" INTEGER NOT NULL DEFAULT 6,
    "englishWeekMinutes" INTEGER NOT NULL DEFAULT 240,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TEXT NOT NULL DEFAULT (CURRENT_DATE::text),
    "initialBalanceMinutes" INTEGER NOT NULL DEFAULT 0,
    "isHourly" BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. TABELA DE BATIDAS DE PONTO (records)
CREATE TABLE IF NOT EXISTS public.records (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "employeeId" TEXT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    "clockIn" TEXT,
    "lunchStart" TEXT,
    "lunchEnd" TEXT,
    "snackStart" TEXT,
    "snackEnd" TEXT,
    "clockOut" TEXT,
    "expectedMinutes" INTEGER NOT NULL DEFAULT 480,
    type TEXT NOT NULL DEFAULT 'WORK',
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. TABELA DE EXTRATO DO BANCO DE HORAS (timeBank)
CREATE TABLE IF NOT EXISTS public."timeBank" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "employeeId" TEXT NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    minutes INTEGER NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'WORK',
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. TABELA DE CONFIGURAÇÕES GERAIS (settings)
CREATE TABLE IF NOT EXISTS public.settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    "managerPin" TEXT NOT NULL DEFAULT '1234',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ÍNDICES DE PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_records_employee_date ON public.records("employeeId", date DESC);
CREATE INDEX IF NOT EXISTS idx_timebank_employee_date ON public."timeBank"("employeeId", date DESC);
CREATE INDEX IF NOT EXISTS idx_employees_active ON public.employees("isActive");

-- ==============================================================================
-- CONCESSÃO DE PERMISSÕES PARA AS ROLES DA API (anon, authenticated)
-- ==============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated;

-- ==============================================================================
-- SEGURANÇA: ROW LEVEL SECURITY (RLS) ATIVADO EM TODAS AS TABELAS
-- ==============================================================================
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."timeBank" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- POLÍTICAS DE ACESSO
DROP POLICY IF EXISTS "Permitir leitura de colaboradores" ON public.employees;
CREATE POLICY "Permitir leitura de colaboradores" ON public.employees FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir gerenciamento de colaboradores" ON public.employees;
CREATE POLICY "Permitir gerenciamento de colaboradores" ON public.employees FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir acesso completo a records" ON public.records;
CREATE POLICY "Permitir acesso completo a records" ON public.records FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir acesso completo ao timeBank" ON public."timeBank";
CREATE POLICY "Permitir acesso completo ao timeBank" ON public."timeBank" FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir leitura e atualização de settings" ON public.settings;
CREATE POLICY "Permitir leitura e atualização de settings" ON public.settings FOR ALL USING (true) WITH CHECK (true);

-- ==============================================================================
-- CARGA INICIAL (SEED ZERADO)
-- ==============================================================================
INSERT INTO public.settings (id, "managerPin") VALUES (1, '1234') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.employees (id, name, role, "baseDailyMinutes", "englishWeekDay", "englishWeekMinutes", "isActive", "startDate", "initialBalanceMinutes", "isHourly")
VALUES
    ('emp_douglas', 'Douglas', 'Vendedor responsável', 480, 6, 240, true, '2026-08-14', 0, false),
    ('emp_luana', 'Luana', 'Vendedora', 480, 6, 240, true, '2026-08-14', 0, false),
    ('emp_matheus', 'Matheus', 'Gerente Administrativo', 480, 6, 240, true, '2026-08-14', 0, false),
    ('emp_patricia', 'Patrícia', 'Estagiária', 360, 6, 240, true, '2026-08-14', 0, false),
    ('emp_roberto', 'Roberto', 'Vendedor', 480, 6, 240, true, '2026-08-14', 0, false)
ON CONFLICT (id) DO NOTHING;
