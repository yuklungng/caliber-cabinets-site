-- Link to the photo of each hardware order (the Drive file behind the sheet's "Open cell image" cell).
-- Additive and dev_ only. Apply before the code that reads or writes photo_url ships.
alter table public.dev_hardware_orders add column if not exists photo_url text;
