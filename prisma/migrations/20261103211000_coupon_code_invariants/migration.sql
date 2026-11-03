-- Keep case-insensitive application lookups enforceably canonical even for direct database writes.
ALTER TABLE "Coupon"
  ADD CONSTRAINT "Coupon_code_normalized_check" CHECK (
    "code" = upper(btrim("code")) AND "code" ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'
  ),
  ADD CONSTRAINT "Coupon_fixed_value_max_check" CHECK (
    "type" <> 'FIXED_AMOUNT' OR "value" BETWEEN 1 AND 100000000
  );
