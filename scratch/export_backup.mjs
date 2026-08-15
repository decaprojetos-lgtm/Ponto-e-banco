import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// Carregar variáveis de ambiente
let env = {};
if (fs.existsSync('.env.local')) {
  env = Object.fromEntries(
    fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
      .filter(line => line.trim() && !line.trim().startsWith('#') && line.includes('='))
      .map(line => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
      })
  );
}

const SUPABASE_URL = env.VITE_SUPABASE_URL || "https://afpcoquiivzrckabcvzo.supabase.co";
const SUPABASE_KEY = env.VITE_SUPABASE_ANON_KEY || "sb_publishable_-5JWjReTELNk5YKnkX9OZg_EeR6j6Zy";

console.log('Conectando ao Supabase em:', SUPABASE_URL);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Função para buscar todos os registros com paginação segura (evita o teto padrão de 1000 linhas)
async function fetchAllRows(tableName, orderBy = 'id') {
  const PAGE_SIZE = 1000;
  let allRows = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.from(tableName).select('*');
    if (orderBy) {
      query = query.order(orderBy, { ascending: true });
    }
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);

    if (error) {
      // Se falhar a ordenação por 'id', tenta sem order
      if (orderBy === 'id') {
        const fallback = await supabase.from(tableName).select('*').range(from, from + PAGE_SIZE - 1);
        if (fallback.error) throw fallback.error;
        allRows = allRows.concat(fallback.data || []);
        if (!fallback.data || fallback.data.length < PAGE_SIZE) hasMore = false;
        else from += PAGE_SIZE;
        continue;
      }
      throw error;
    }

    if (data && data.length > 0) {
      allRows = allRows.concat(data);
      if (data.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        from += PAGE_SIZE;
      }
    } else {
      hasMore = false;
    }
  }

  return allRows;
}

function jsonToCsv(data) {
  if (!data || data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const rows = [
    headers.join(';'),
    ...data.map(row =>
      headers.map(header => {
        let val = row[header];
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      }).join(';')
    )
  ];
  return '\uFEFF' + rows.join('\r\n');
}

function formatMinutes(minutes) {
  const isNeg = minutes < 0;
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = Math.floor(abs % 60);
  return `${isNeg ? '-' : '+'}${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
}

function formatTime(val) {
  if (!val) return '--:--';
  if (val.length === 5 && val.includes(':')) return val;
  const d = new Date(val);
  if (isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
}

async function runBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(process.cwd(), 'backups', `backup_${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  console.log(`Iniciando extração total para: ${backupDir}`);

  // 1. Extrair tabelas
  console.log('Baixando tabela: employees...');
  const employees = await fetchAllRows('employees', 'name');
  console.log(`-> ${employees.length} funcionários encontrados.`);

  console.log('Baixando tabela: records...');
  const records = await fetchAllRows('records', 'date');
  console.log(`-> ${records.length} batidas encontradas.`);

  console.log('Baixando tabela: timeBank...');
  const timeBank = await fetchAllRows('timeBank', 'date');
  console.log(`-> ${timeBank.length} lançamentos de banco de horas encontrados.`);

  console.log('Baixando tabela: settings...');
  let settings = [];
  try {
    settings = await fetchAllRows('settings', null);
  } catch (err) {
    console.warn('Aviso: settings não pôde ser listada com paginação, tentando direto:', err.message);
    const sRes = await supabase.from('settings').select('*');
    settings = sRes.data || [];
  }
  console.log(`-> ${settings.length} registros de settings encontrados.`);

  // 2. Salvar arquivos JSON
  fs.writeFileSync(path.join(backupDir, 'employees.json'), JSON.stringify(employees, null, 2), 'utf8');
  fs.writeFileSync(path.join(backupDir, 'records.json'), JSON.stringify(records, null, 2), 'utf8');
  fs.writeFileSync(path.join(backupDir, 'timeBank.json'), JSON.stringify(timeBank, null, 2), 'utf8');
  fs.writeFileSync(path.join(backupDir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');

  const fullBackup = {
    metadata: {
      extractedAt: new Date().toISOString(),
      sourceUrl: SUPABASE_URL,
      totals: {
        employees: employees.length,
        records: records.length,
        timeBank: timeBank.length,
        settings: settings.length
      }
    },
    employees,
    records,
    timeBank,
    settings
  };
  fs.writeFileSync(path.join(backupDir, 'full_backup.json'), JSON.stringify(fullBackup, null, 2), 'utf8');

  // 3. Salvar arquivos CSV
  fs.writeFileSync(path.join(backupDir, 'employees.csv'), jsonToCsv(employees), 'utf8');
  fs.writeFileSync(path.join(backupDir, 'records.csv'), jsonToCsv(records), 'utf8');
  fs.writeFileSync(path.join(backupDir, 'timeBank.csv'), jsonToCsv(timeBank), 'utf8');
  if (settings.length > 0) {
    fs.writeFileSync(path.join(backupDir, 'settings.csv'), jsonToCsv(settings), 'utf8');
  }

  console.log('Arquivos de backup salvos com sucesso.');

  // 4. Gerar Relatório Histórico Consolidado
  console.log('Gerando Relatório Histórico Consolidado...');

  const empMap = new Map();
  employees.forEach(emp => {
    empMap.set(emp.id, {
      ...emp,
      totalRecords: 0,
      totalBankEntries: 0,
      bankMinutesSum: 0,
      typesBreakdown: {},
      firstRecordDate: null,
      lastRecordDate: null,
      recordsList: [],
      bankList: []
    });
  });

  records.forEach(rec => {
    const emp = empMap.get(rec.employeeId);
    if (emp) {
      emp.totalRecords++;
      emp.recordsList.push(rec);
      if (!emp.firstRecordDate || rec.date < emp.firstRecordDate) emp.firstRecordDate = rec.date;
      if (!emp.lastRecordDate || rec.date > emp.lastRecordDate) emp.lastRecordDate = rec.date;
    }
  });

  timeBank.forEach(tb => {
    const emp = empMap.get(tb.employeeId);
    if (emp) {
      emp.totalBankEntries++;
      const mins = Number(tb.minutes) || 0;
      emp.bankMinutesSum += mins;
      emp.typesBreakdown[tb.type] = (emp.typesBreakdown[tb.type] || 0) + mins;
      emp.bankList.push(tb);
    }
  });

  const datesAll = records.map(r => r.date).filter(Boolean).sort();
  const minDate = datesAll[0] || 'N/A';
  const maxDate = datesAll[datesAll.length - 1] || 'N/A';

  let reportMd = `# 📊 Relatório Histórico Consolidado - Nobel Petrópolis
**Data da Extração:** ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
**Período dos Registros no Banco:** ${minDate} até ${maxDate}
**Origem dos Dados:** Supabase (${SUPABASE_URL})

---

## 1. Resumo Geral da Base de Dados

| Entidade | Quantidade Total |
| :--- | :--- |
| **Funcionários Cadastrados** | ${employees.length} |
| **Funcionários Ativos** | ${employees.filter(e => e.isActive !== false).length} |
| **Funcionários Inativos/Arquivados** | ${employees.filter(e => e.isActive === false).length} |
| **Total de Batidas de Ponto (\`records\`)** | ${records.length} |
| **Total de Lançamentos de Banco (\`timeBank\`)** | ${timeBank.length} |

---

## 2. Quadro Resumo por Colaborador

| Funcionário | Status | Cargo | Tipo | Saldo Inicial | Saldo Lançado no Banco | Saldo Total Acumulado | Total Batidas | 1ª Batida | Última Batida |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
`;

  const sortedEmps = Array.from(empMap.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  sortedEmps.forEach(emp => {
    const initial = Number(emp.initialBalanceMinutes) || 0;
    const bankSum = emp.bankMinutesSum;
    const finalTotal = initial + bankSum;
    const status = emp.isActive !== false ? '✅ Ativo' : '⚪ Inativo';
    const tipo = emp.isHourly ? 'Horista' : 'CLT';
    const first = emp.firstRecordDate || '-';
    const last = emp.lastRecordDate || '-';

    reportMd += `| **${emp.name}** | ${status} | ${emp.role || '-'} | ${tipo} | ${formatMinutes(initial)} | ${formatMinutes(bankSum)} | **${formatMinutes(finalTotal)}** | ${emp.totalRecords} | ${first} | ${last} |\n`;
  });

  reportMd += `\n---\n\n## 3. Detalhamento por Colaborador\n\n`;

  sortedEmps.forEach(emp => {
    const initial = Number(emp.initialBalanceMinutes) || 0;
    const bankSum = emp.bankMinutesSum;
    const finalTotal = initial + bankSum;

    reportMd += `### 👤 ${emp.name} (${emp.role || 'Sem Cargo'})\n`;
    reportMd += `- **Status:** ${emp.isActive !== false ? 'Ativo' : 'Inativo'}\n`;
    reportMd += `- **Data Início Contrato:** ${emp.startDate || 'Não informada'}\n`;
    reportMd += `- **Jornada Padrão:** ${emp.isHourly ? 'Horista (meta 0h)' : `${(emp.baseDailyMinutes || 480)/60}h/dia`}\n`;
    reportMd += `- **Saldo Inicial Configurado:** ${formatMinutes(initial)} (${initial} min)\n`;
    reportMd += `- **Saldo de Lançamentos Acumulado:** ${formatMinutes(bankSum)} (${bankSum} min)\n`;
    reportMd += `- **SALDO FINAL LÍQUIDO:** **${formatMinutes(finalTotal)}** (${finalTotal} minutos = ${(finalTotal/60).toFixed(2)} horas)\n\n`;

    reportMd += `#### Composição dos Lançamentos no Banco:\n`;
    if (Object.keys(emp.typesBreakdown).length === 0) {
      reportMd += `*Nenhum lançamento no banco de horas.*\n\n`;
    } else {
      reportMd += `| Categoria | Saldo de Minutos | Formatado |
| :--- | :--- | :--- |
`;
      for (const [type, mins] of Object.entries(emp.typesBreakdown)) {
        reportMd += `| \`${type}\` | ${mins} min | ${formatMinutes(mins)} |\n`;
      }
      reportMd += `\n`;
    }
  });

  fs.writeFileSync(path.join(backupDir, 'relatorio_historico_consolidado.md'), reportMd, 'utf8');
  fs.writeFileSync(path.join(process.cwd(), 'relatorio_historico_consolidado.md'), reportMd, 'utf8');

  console.log(`Relatório salvo em: ${path.join(backupDir, 'relatorio_historico_consolidado.md')}`);
  console.log(`Backup finalizado com sucesso!`);
}

runBackup().catch(err => {
  console.error('Erro no backup:', err);
  process.exit(1);
});
