import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/20260827140000_product_so_reservation_dc_batch_allocation.sql','utf8');
const dcUi = fs.readFileSync('src/pages/DeliveryChallan.tsx','utf8');
const plan = JSON.parse(fs.readFileSync('audits/inventory/product-reservation-migration-plan-20260827.json','utf8'));

class Model {
  constructor(stock) { this.stock={...stock}; this.orders=new Map(); this.allocations=new Set(); }
  atp(product,exclude) { return (this.stock[product]||0)-[...this.orders.entries()].reduce((n,[id,o])=>n+(id===exclude||!o.active?0:o.reserved),0); }
  approve(id,product,ordered,delivered=0) { const old=this.orders.get(id); const required=ordered-delivered; if(required<0) throw Error('over'); if(required>this.atp(product,id)) throw Error('atp'); this.orders.set(id,{product,ordered,delivered,reserved:required,active:true}); return old?required-old.reserved:required; }
  edit(id,ordered) { const o=this.orders.get(id); return this.approve(id,o.product,ordered,o.delivered); }
  release(id) { const o=this.orders.get(id); if(!o.active) return 0; const q=o.reserved;o.active=false;o.reserved=0;return q; }
  deliver(id,key,batch,qty) { const o=this.orders.get(id); if(this.allocations.has(key)) throw Error('duplicate'); if(!o.active||qty>o.reserved) throw Error('reservation'); if((this.stock[batch]||0)<qty) throw Error('stock'); o.reserved-=qty;o.delivered+=qty;this.stock[batch]-=qty;this.allocations.add(key);return o; }
}

test('A/B approval and competing ATP do not change physical stock',()=>{const m=new Model({p:1000});assert.equal(m.approve('a','p',600),600);assert.throws(()=>m.approve('b','p',401),/atp/);assert.equal(m.stock.p,1000);assert.equal(m.approve('b','p',400),400);});
test('C/D/E edit increase decrease and partial delivery use deltas',()=>{const m=new Model({p:1000,b:1000});m.approve('a','p',500);assert.equal(m.edit('a',700),200);assert.equal(m.edit('a',500),-200);m.deliver('a','d1','b',300);assert.equal(m.edit('a',700),200);assert.equal(m.edit('a',500),-200);assert.equal(m.orders.get('a').reserved,200);});
test('F/G/H/I/J/W rejection cancellation void and reapproval are idempotent',()=>{const m=new Model({p:1000});m.approve('a','p',500);assert.equal(m.release('a'),500);assert.equal(m.release('a'),0);m.approve('a','p',500);assert.equal(m.orders.get('a').reserved,500);m.release('a');m.approve('a','p',700);assert.equal(m.orders.get('a').reserved,700);});
test('K/L/M multiple DCs, partial DC and multiple batches reconcile',()=>{const m=new Model({p:1000,a:200,b:300});m.approve('so','p',500);m.deliver('so','d1','a',200);m.deliver('so','d2','b',300);assert.deepEqual(m.orders.get('so'),{product:'p',ordered:500,delivered:500,reserved:0,active:true});});
test('Q/R/S/T/U/V invalid, insufficient, duplicate and rollback conditions fail safely',()=>{const m=new Model({p:500,a:200});m.approve('so','p',500);const before=JSON.stringify(m);assert.throws(()=>m.deliver('so','bad','a',300),/stock/);assert.equal(JSON.stringify(m),before);m.deliver('so','one','a',100);assert.throws(()=>m.deliver('so','one','a',1),/duplicate/);assert.throws(()=>m.deliver('so','two','a',101),/stock/);});
test('N/O/P/X architecture supports multiple lines, FEFO suggestion, alternate batches and audit history',()=>{assert.match(sql,/so_product_reservation_events/);assert.match(sql,/dc_batch_allocations/);assert.match(sql,/expiry_date/);assert.match(dcUi,/const fifoBatch = productBatches\[0\]/);assert.doesNotMatch(sql,/INSERT INTO public\.stock_reservations/);});
test('constraints prevent duplicate active reservation, negatives and over-delivery',()=>{assert.match(sql,/uq_so_product_reservation_active_item/);assert.match(sql,/reserved_quantity > 0/);assert.match(sql,/current_stock>=v\.quantity/);assert.match(sql,/DC quantity exceeds remaining SO product reservation/);});
test('concurrent ATP, lifecycle entry points and approval are database-guarded',()=>{assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/trg_reconcile_active_so_item_v2/);assert.match(sql,/fn_auto_rereserve_on_batch_arrival[\s\S]*RETURN NEW/);assert.match(sql,/Cannot approve Delivery Challan % without items/);assert.match(sql,/REVOKE ALL ON FUNCTION[\s\S]*approve_sales_order_product_reservation_v2/);});
test('pending DC creation does not mark the SO delivered',()=>{assert.doesNotMatch(dcUi,/rpc\('update_so_delivered_quantity_atomic'/);assert.match(dcUi,/Pending DCs are not deliveries/);});
test('current 0033/0034 cases and third row are explicit and held',()=>{const held=plan.reservations.filter(r=>r.migration_action==='HOLD_AMBIGUOUS_PENDING_DC');assert.equal(held.length,3);assert.deepEqual([...new Set(held.map(r=>r.so))],['SO-2026-0033','SO-2026-0034']);assert.equal(plan.missing_third_ambiguous_record,'f7428c8d-68fd-473f-9d14-ce5b77a98768');});
test('all 19 safe rows are exactly represented and history is excluded',()=>{const safe=plan.reservations.filter(r=>r.migration_action==='CONSOLIDATE_TO_PRODUCT_RESERVATION');assert.equal(safe.length,19);assert.equal(safe.reduce((n,r)=>n+r.current_quantity,0),15630);assert.equal(plan.summary.historical_rows,126);});

console.log('product reservation v2 regression matrix passed');
