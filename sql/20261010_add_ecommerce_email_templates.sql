-- Run this once against an existing notification-service PostgreSQL schema
-- before seeding the new templates. Safe to run repeatedly.
DO $migration$
DECLARE
  enum_type TEXT;
  enum_value TEXT;
BEGIN
  FOREACH enum_type IN ARRAY ARRAY[
    'email_template_template_type_enum',
    'job_template_template_type_enum'
  ] LOOP
    IF to_regtype(enum_type) IS NOT NULL THEN
      FOREACH enum_value IN ARRAY ARRAY[
        'order_confirmation',
        'payment_receipt',
        'shipping_update',
        'promotion_campaign'
      ] LOOP
        EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', enum_type, enum_value);
      END LOOP;
    END IF;
  END LOOP;

  enum_type := 'job_template_job_name_enum';
  IF to_regtype(enum_type) IS NOT NULL THEN
    FOREACH enum_value IN ARRAY ARRAY[
      'send-order-confirmation-email',
      'send-payment-receipt-email',
      'send-shipping-update-email',
      'send-promotion-email'
    ] LOOP
      EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS %L', enum_type, enum_value);
    END LOOP;
  END IF;
END
$migration$;
