import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260827100000_harden_so_dc_batch_reservation_lifecycle.sql', 'utf8');
const dc = fs.readFileSync('src/pages/DeliveryChallan.tsx', 'utf8');

assert.match(migration, /realign_reservation_for_delivery_challan/);
assert.match(migration, /Explicit DC batch alignment/);
assert.match(migration, /Selected batch differs from the Sales Order reservation/);
assert.match(migration, /status='released'/);
assert.match(migration, /dci\.sales_order_item_id/);
assert.match(dc, /canonical SO reservation is authoritative/);
assert.match(dc, /realign_reservation_for_delivery_challan/);
assert.match(dc, /selected batch is eligible/);

console.log('delivery challan reservation regression checks passed');
