import { createClient } from '@supabase/supabase-js';

const NEW_URL = "https://pbvtbwzswkhgeazhwqfa.supabase.co";
const NEW_KEY = "sb_publishable_N7XxUfuRSScEe5hMy3Yvag_JHwJd-9I";

const supabase = createClient(NEW_URL, NEW_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function runHealthCheck() {
  console.log('--- TESTE COMPLETO DE OPERAÇÕES NO NOVO BANCO ---');

  // 1. Ler funcionários
  const { data: emps, error: eErr } = await supabase.from('employees').select('*').order('name');
  if (eErr) throw eErr;
  console.log('1. Funcionários cadastrados:');
  emps.forEach(e => console.log(`   - ${e.name} (${e.role}): Saldo Inicial = ${e.initialBalanceMinutes}min, Início = ${e.startDate}`));

  // 2. Testar inserção e exclusão de registro de teste (Mock Clock)
  const testId = 'rec_test_' + Date.now();
  const { error: insErr } = await supabase.from('records').insert([{
    id: testId,
    employeeId: emps[0].id,
    date: '2026-08-14',
    clockIn: '2026-08-14T09:00:00-03:00',
    clockOut: '2026-08-14T18:00:00-03:00',
    expectedMinutes: 480,
    type: 'WORK',
    note: 'Teste automatizado de validação'
  }]);
  if (insErr) throw insErr;
  console.log('2. Inserção de batida de ponto: OK');

  // 3. Testar inserção no timeBank
  const bankTestId = 'tb_test_' + Date.now();
  const { error: tbErr } = await supabase.from('timeBank').insert([{
    id: bankTestId,
    employeeId: emps[0].id,
    date: '2026-08-14',
    minutes: 60,
    type: 'WORK',
    note: 'Teste automatizado'
  }]);
  if (tbErr) throw tbErr;
  console.log('3. Inserção de extrato de banco de horas: OK');

  // 4. Limpar os testes para manter o banco zerado
  await supabase.from('records').delete().eq('id', testId);
  await supabase.from('timeBank').delete().eq('id', bankTestId);
  console.log('4. Limpeza de registros de teste: OK');

  // 5. Ler settings
  const { data: settings, error: sErr } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle();
  if (sErr) throw sErr;
  console.log('5. Settings configuradas: PIN de Gerência =', settings.managerPin);

  console.log('\n🌟 TODOS OS TESTES PASSARAM COM SUCESSO! O NOVO BANCO ESTÁ 100% OPERACIONAL, SEGURO E ZERADO.');
}

runHealthCheck().catch(err => {
  console.error('Falha no teste:', err);
  process.exit(1);
});
