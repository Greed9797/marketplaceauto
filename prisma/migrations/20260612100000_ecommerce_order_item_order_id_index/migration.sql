-- Index the EcommerceOrderItem -> EcommerceOrder foreign key. The dashboard
-- order-items query joins on ecommerceOrderId (to read order status); without
-- this index the child side of the join cannot use an index scan at high row
-- counts. Also speeds up the ON DELETE CASCADE when an EcommerceOrder is
-- removed. Created IF NOT EXISTS so re-applying is safe.
CREATE INDEX IF NOT EXISTS "EcommerceOrderItem_ecommerceOrderId_idx"
  ON "w3ads"."EcommerceOrderItem" ("ecommerceOrderId");
