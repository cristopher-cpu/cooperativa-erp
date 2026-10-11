const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://fihovunxkkkwaqsggcri.supabase.co';
const supabaseKey = 'sb_publishable_tElx3P7KYXfYsqzsn2R7_g_lWT0yulK';

const supabase = createClient(supabaseUrl, supabaseKey);

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

async function resetDemo() {
  console.log('Iniciando reset del periodo de prueba...\n');

  try {
    // PASO 0: Buscar o crear el periodo "Prueba MVP"
    console.log('PASO 0: Buscando periodo "Prueba MVP"...');
    let { data: existingPeriods } = await supabase
      .from('periods')
      .select('id, label, active')
      .eq('label', 'Prueba MVP');

    let period;
    if (existingPeriods && existingPeriods.length > 0) {
      period = existingPeriods[0];
      console.log(`OK - Periodo encontrado: ${period.label} (${period.id})`);

      // Cambiar a activo si no lo es
      if (!period.active) {
        await supabase
          .from('periods')
          .update({ active: true })
          .eq('id', period.id);
        console.log('OK - Periodo activado');
      }
    } else {
      console.log('Periodo no existe. Creando "Prueba MVP"...');

      const periodId = 'P' + generateId().toUpperCase();
      const today = new Date().toISOString().split('T')[0];

      const { data: created, error: createError } = await supabase
        .from('periods')
        .insert({
          id: periodId,
          label: 'Prueba MVP',
          active: true,
          date_from: today,
          date_to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (createError) {
        console.log(`ERROR: ${createError.message}`);
        return;
      }

      period = created;
      console.log(`OK - Periodo creado: ${period.label} (${period.id})\n`);
    }

    // PASO 2: Borrar datos
    console.log('PASO 2: Borrando movimientos...');

    const deletes = [
      ['bodega_bajas', 'Mermas y bajas'],
      ['bodega_assignments', 'Asignaciones de bodega'],
      ['bodega', 'Stock de bodega'],
      ['order_adjustments', 'Faltantes y extras'],
      ['purchase_orders', 'Ordenes de compra'],
      ['cash_flow', 'Movimientos de caja'],
      ['sealed_orders', 'Pedidos'],
    ];

    for (const [table, label] of deletes) {
      await supabase
        .from(table)
        .delete()
        .eq('period_id', period.id);

      console.log(`OK - ${label} borrados`);
    }

    // Reabrir ventana de pedidos
    await supabase
      .from('periods')
      .update({ orders_closed_at: null })
      .eq('id', period.id);

    console.log('OK - Ventana de pedidos reabierta\n');

    // PASO 3: Resetear saldos a 0
    console.log('PASO 3: Reseteando saldos de familias a 0...');
    const { data: families } = await supabase
      .from('families')
      .select('id');

    if (families && families.length > 0) {
      await supabase
        .from('families')
        .update({ balance: 0 })
        .neq('id', null);

      console.log(`OK - Saldos de ${families.length} familias reseteados a 0\n`);
    }

    // PASO 4: Verificar
    console.log('PASO 4: Verificando...');
    const verifyTables = [
      ['sealed_orders', 'Pedidos'],
      ['order_adjustments', 'Faltantes/extras'],
      ['purchase_orders', 'Ordenes de compra'],
      ['bodega', 'Items bodega'],
      ['cash_flow', 'Movimientos caja'],
    ];

    for (const [table, label] of verifyTables) {
      const { data } = await supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('period_id', period.id);

      const count = data?.length || 0;
      const status = count === 0 ? 'OK' : 'WARN';
      console.log(`[${status}] ${label}: ${count}`);
    }

    console.log('\n*** Reset completado exitosamente! ***');
    console.log(`Periodo activo: "${period.label}" (${period.id})`);
    console.log('\nAhora puedes ir a la app y:');
    console.log('1. Configurar las fechas del periodo');
    console.log('2. Abrir la ventana de pedidos');
    console.log('3. Las familias pueden empezar a pedir');

  } catch (error) {
    console.error('ERROR:', error.message);
  }
}

resetDemo();
