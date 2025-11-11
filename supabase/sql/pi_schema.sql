-- Tables for Pi integration
create table if not exists public.pi_users (
  uid text primary key,
  username text not null,
  roles jsonb not null default '[]'::jsonb,
  access_token text,
  updated_at timestamptz default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  pi_payment_id text unique not null,
  product_id text,
  user_uid text references public.pi_users(uid) on delete set null,
  txid text,
  paid boolean not null default false,
  cancelled boolean not null default false,
  created_at timestamptz not null default now()
);

-- For convenience
create index if not exists idx_orders_user_uid on public.orders(user_uid);
