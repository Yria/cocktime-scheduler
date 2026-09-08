-- Synthetic records only. No real member or bank data.
set test.admin='true'; set test.member='00000000-0000-4000-8000-000000000004';
    insert into members(id,name) values ('00000000-0000-4000-8000-000000000001','김지훈'),('00000000-0000-4000-8000-000000000002','김지훈'),('00000000-0000-4000-8000-000000000004','운영진');
    insert into sessions(id,title,status,scheduled_at) values(1,'대관','closed','2026-08-22T14:00:00+09');
    insert into dues_settings values(1,5000,6000);
    insert into txn_categories values(8,'공구');
    insert into dues_batches values
      (10,'manual:meal:1','manual','회식','2026-08-22',null,null,60000),
      (20,'monthly:2026-08','monthly','8월 회비','2026-08-01',null,'2026-08',null),
      (21,'monthly:2026-09','monthly','9월 회비','2026-09-01',null,'2026-09',null),
      (22,'monthly:2026-07','monthly','7월 회비','2026-07-01',null,'2026-07',null),
      (23,'court:1','court','대관','2026-08-22',1,null,6000);
    insert into bank_transactions(id,direction,amount,occurred_at,batch_id,category_id,refund_of_tx_id) values
      (1,'in',54000,'2026-08-22T12:00:00+09',10,8,null),
      (2,'in',6000,'2026-08-23T12:00:00+09',null,null,null),
      (3,'in',5000,'2026-07-22T12:00:00+09',null,null,null),
      (4,'in',30000,'2026-08-22T12:00:00+09',null,null,null),
      (6,'in',54000,'2026-08-21T12:00:00+09',10,8,null),
      (7,'out',2000,'2026-08-23T12:00:00+09',null,null,6),
      (8,'in',5000,'2026-06-30T12:00:00+09',null,null,null),
      (9,'out',6000,'2026-09-02T12:00:00+09',null,null,null);
    insert into dues_charges(id,kind,member_id,amount_due,amount_paid,status,batch_id,period_ym) values
      (100,'manual','00000000-0000-4000-8000-000000000001',30000,30000,'paid',10,null),
      (101,'manual','00000000-0000-4000-8000-000000000002',30000,30000,'paid',10,null),
      (102,'monthly_fee','00000000-0000-4000-8000-000000000001',5000,5000,'paid',20,'2026-08'),
      (103,'monthly_fee','00000000-0000-4000-8000-000000000001',5000,5000,'paid',22,'2026-07'),
      (104,'monthly_fee','00000000-0000-4000-8000-000000000002',5000,5000,'paid',21,'2026-09'),
      (105,'court_fee','00000000-0000-4000-8000-000000000002',6000,0,'void',23,null),
      (106,'monthly_fee','00000000-0000-4000-8000-000000000002',5000,0,'unpaid',22,'2026-07');
    insert into dues_allocations(id,bank_tx_id,charge_id,member_id,amount) values
      (1,1,100,'00000000-0000-4000-8000-000000000001',30000),(2,4,101,'00000000-0000-4000-8000-000000000002',30000),(3,2,102,'00000000-0000-4000-8000-000000000001',5000),(4,8,103,'00000000-0000-4000-8000-000000000001',5000),(5,3,104,'00000000-0000-4000-8000-000000000002',5000);
