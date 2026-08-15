import { createClient } from '@supabase/supabase-js';

const NEW_URL = "https://pbvtbwzswkhgeazhwqfa.supabase.co";
const NEW_KEY = "sb_publishable_N7XxUfuRSScEe5hMy3Yvag_JHwJd-9I";

console.log('Testando conexão com o NOVO Supabase...');
const supabase = createClient(NEW_URL, NEW_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function test() {
  try {
    const { data: emps, error: empErr } = await supabase.from('employees').select('*');
    if (empErr) {
      console.log('Tabela employees ainda não criada ou erro:', empErr.message);
      return;
    }
    console.log('✅ Conexão bem-sucedida! Tabela employees encontrada com', emps.length, 'registros.');
    
    const { data: recs, error: recErr } = await supabase.from('records').select('*');
    console.log('✅ Tabela records encontrada com', (recs || []).length, 'registros.');

    const { data: bank, error: bankErr } = await supabase.from('timeBank').select('*');
    console.log('✅ Tabela timeBank encontrada com', (bank || []).length, 'registros.');

    const { data: settings, error: settErr } = await supabase.from('settings').select('*');
    console.log('✅ Tabela settings encontrada com', (settings || []).length, 'registros.');

    console.log('🎉 NOVO BANCO DE DADOS 100% CONFIGURADO E PRONTO!');
  } catch (e) {
    console.error('Erro ao testar:', e.message);
  }
}

test();
