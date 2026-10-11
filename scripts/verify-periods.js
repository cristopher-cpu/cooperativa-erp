const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://fihovunxkkkwaqsggcri.supabase.co';
const supabaseKey = 'sb_publishable_tElx3P7KYXfYsqzsn2R7_g_lWT0yulK';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPeriods() {
  try {
    console.log('Obteniendo períodos...\n');

    const { data: periods, error } = await supabase
      .from('periods')
      .select('id, label, active, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error:', error.message);
      return;
    }

    console.log(`Total de períodos: ${periods.length}\n`);
    periods.forEach(p => {
      console.log(`${p.active ? '✅' : '⭕'} ${p.label} (${p.id}) - Creado: ${new Date(p.created_at).toLocaleDateString()}`);
    });

    // Contar movimientos en cada período
    console.log('\n--- Movimientos por período ---\n');
    for (const p of periods) {
      const tables = ['sealed_orders', 'order_adjustments', 'purchase_orders', 'bodega', 'cash_flow'];
      let total = 0;

      for (const table of tables) {
        const { data } = await supabase
          .from(table)
          .select('id', { count: 'exact', head: true })
          .eq('period_id', p.id);
        total += data?.length || 0;
      }

      console.log(`${p.label}: ${total} movimientos`);
    }

  } catch (error) {
    console.error('Error inesperado:', error.message);
  }
}

checkPeriods();
