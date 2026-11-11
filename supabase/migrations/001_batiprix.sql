-- BatiPrix — construction materials price board + quote requests (RFQ) for Djibouti
-- Tables are prefixed bati_ so the schema can share a Supabase project with other apps.

create table if not exists public.bati_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_name text not null default '',
  contact_name text not null default '',
  phone text not null default '',
  whatsapp text not null default '',
  district text not null default '',
  description text not null default '',
  categories text[] not null default '{}',
  verified boolean not null default false,
  plan text not null default 'free' check (plan in ('free','pro')),
  plan_until date,
  credits int not null default 3 check (credits >= 0),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.bati_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.bati_profiles where id = auth.uid()), false);
$$;

create or replace function public.bati_profile_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('bati.bypass', true) = 'on' then return new; end if;
  if not public.bati_is_admin() then
    if tg_op = 'INSERT' then
      new.is_admin := false; new.verified := false; new.plan := 'free'; new.plan_until := null; new.credits := 3;
    else
      new.is_admin := old.is_admin; new.verified := old.verified; new.plan := old.plan;
      new.plan_until := old.plan_until; new.credits := old.credits;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists bati_profile_guard on public.bati_profiles;
create trigger bati_profile_guard before insert or update on public.bati_profiles
for each row execute function public.bati_profile_guard();

-- ---------- Materials catalogue ----------
create table if not exists public.bati_materials (
  id serial primary key,
  category text not null,
  name text not null unique,
  unit text not null,
  sort int not null default 0
);

insert into public.bati_materials (category, name, unit, sort) values
 ('Ciment & liants','Ciment CEM II 42.5 (sac 50 kg)','sac',1),
 ('Ciment & liants','Ciment CEM I 52.5 (sac 50 kg)','sac',2),
 ('Ciment & liants','Chaux (sac 25 kg)','sac',3),
 ('Granulats','Sable lavé','m³',10),
 ('Granulats','Gravier 5/15','m³',11),
 ('Granulats','Gravier 15/25','m³',12),
 ('Granulats','Tout-venant','m³',13),
 ('Acier','Fer HA 8 (barre 12 m)','barre',20),
 ('Acier','Fer HA 10 (barre 12 m)','barre',21),
 ('Acier','Fer HA 12 (barre 12 m)','barre',22),
 ('Acier','Fer HA 14 (barre 12 m)','barre',23),
 ('Acier','Fer HA 16 (barre 12 m)','barre',24),
 ('Acier','Fil à ligaturer (rouleau)','rouleau',25),
 ('Acier','Treillis soudé (panneau)','panneau',26),
 ('Maçonnerie','Parpaing creux 10 cm','unité',30),
 ('Maçonnerie','Parpaing creux 15 cm','unité',31),
 ('Maçonnerie','Parpaing creux 20 cm','unité',32),
 ('Bois & coffrage','Planche de coffrage 4 m','unité',40),
 ('Bois & coffrage','Contreplaqué 18 mm','feuille',41),
 ('Bois & coffrage','Étai métallique (location/jour)','unité',42),
 ('Couverture','Tôle ondulée galvanisée 3 m','feuille',50),
 ('Couverture','Panneau sandwich (m²)','m²',51),
 ('Finitions','Carrelage sol 60x60 (m²)','m²',60),
 ('Finitions','Peinture acrylique (seau 20 L)','seau',61),
 ('Finitions','Enduit de façade (sac 25 kg)','sac',62),
 ('Plomberie','Tube PVC Ø100 (4 m)','unité',70),
 ('Plomberie','Tube PPR Ø20 (4 m)','unité',71),
 ('Plomberie','Réservoir d''eau 1000 L','unité',72),
 ('Électricité','Câble 2.5 mm² (rouleau 100 m)','rouleau',80),
 ('Électricité','Câble 1.5 mm² (rouleau 100 m)','rouleau',81),
 ('Électricité','Gaine ICTA Ø20 (rouleau)','rouleau',82)
on conflict (name) do nothing;

-- ---------- Supplier prices ----------
create table if not exists public.bati_prices (
  supplier_id uuid not null references public.bati_profiles(id) on delete cascade,
  material_id int not null references public.bati_materials(id) on delete cascade,
  price_djf int not null check (price_djf > 0),
  in_stock boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (supplier_id, material_id)
);

create or replace function public.bati_touch_price()
returns trigger language plpgsql set search_path = public as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists bati_touch_price on public.bati_prices;
create trigger bati_touch_price before insert or update on public.bati_prices
for each row execute function public.bati_touch_price();

-- Public price board: verified suppliers, prices updated in the last 45 days.
create or replace view public.bati_price_board with (security_invoker = true) as
  select m.id as material_id, m.category, m.name, m.unit, m.sort,
         min(p.price_djf) as min_price,
         round(avg(p.price_djf))::int as avg_price,
         max(p.price_djf) as max_price,
         count(p.*)::int as supplier_count,
         max(p.updated_at) as last_update
  from public.bati_materials m
  left join public.bati_prices p on p.material_id = m.id and p.in_stock
     and p.updated_at > now() - interval '45 days'
     and exists (select 1 from public.bati_profiles s where s.id = p.supplier_id and s.verified)
  group by m.id;

-- Per-supplier offers for one material (pro suppliers ranked first)
create or replace view public.bati_offers with (security_invoker = true) as
  select p.material_id, p.price_djf, p.in_stock, p.updated_at,
         s.id as supplier_id, s.company_name, s.district, s.whatsapp, s.phone,
         (s.plan = 'pro' and s.plan_until >= current_date) as is_pro
  from public.bati_prices p join public.bati_profiles s on s.id = p.supplier_id
  where s.verified and p.updated_at > now() - interval '45 days';

-- ---------- Quote requests (RFQ) ----------
create table if not exists public.bati_rfqs (
  id uuid primary key default gen_random_uuid(),
  district text not null,
  project_type text not null default '',
  items text not null check (char_length(items) between 5 and 3000),
  needed_by date,
  delivery boolean not null default true,
  status text not null default 'open' check (status in ('open','closed')),
  unlock_count int not null default 0,
  created_at timestamptz not null default now()
);
-- Contact details are stored separately so suppliers only see them after unlocking.
create table if not exists public.bati_rfq_contacts (
  rfq_id uuid primary key references public.bati_rfqs(id) on delete cascade,
  buyer_name text not null,
  phone text not null,
  email text not null default ''
);
create table if not exists public.bati_unlocks (
  supplier_id uuid not null references public.bati_profiles(id) on delete cascade,
  rfq_id uuid not null references public.bati_rfqs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (supplier_id, rfq_id)
);

-- Anyone (no login) can post an RFQ.
create or replace function public.bati_create_rfq(
  p_name text, p_phone text, p_email text, p_district text, p_project_type text,
  p_items text, p_needed_by date, p_delivery boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if char_length(coalesce(p_name,'')) < 2 or char_length(coalesce(p_phone,'')) < 6 then
    raise exception 'Nom et téléphone requis';
  end if;
  insert into public.bati_rfqs (district, project_type, items, needed_by, delivery)
    values (p_district, coalesce(p_project_type,''), p_items, p_needed_by, coalesce(p_delivery,true))
    returning id into rid;
  insert into public.bati_rfq_contacts values (rid, p_name, p_phone, coalesce(p_email,''));
  return rid;
end $$;

-- Supplier spends 1 credit (or uses Pro plan) to reveal buyer contact. Max 5 suppliers per RFQ.
create or replace function public.bati_unlock_rfq(p_rfq uuid)
returns table (buyer_name text, phone text, email text)
language plpgsql security definer set search_path = public as $$
declare s public.bati_profiles; already boolean; cnt int;
begin
  select * into s from public.bati_profiles where id = auth.uid();
  if s.id is null then raise exception 'Connexion requise'; end if;
  if not s.verified then raise exception 'NOT_VERIFIED: votre compte fournisseur doit être vérifié'; end if;
  select exists(select 1 from public.bati_unlocks u where u.supplier_id = s.id and u.rfq_id = p_rfq) into already;
  if not already then
    select unlock_count into cnt from public.bati_rfqs where id = p_rfq and status = 'open' for update;
    if cnt is null then raise exception 'Demande introuvable ou fermée'; end if;
    if cnt >= 5 then raise exception 'FULL: 5 fournisseurs ont déjà répondu à cette demande'; end if;
    if not (s.plan = 'pro' and s.plan_until >= current_date) then
      if s.credits <= 0 then raise exception 'NO_CREDITS: achetez des crédits ou passez Pro'; end if;
      perform set_config('bati.bypass', 'on', true);
      update public.bati_profiles set credits = credits - 1 where id = s.id;
      perform set_config('bati.bypass', 'off', true);
    end if;
    insert into public.bati_unlocks (supplier_id, rfq_id) values (s.id, p_rfq);
    update public.bati_rfqs set unlock_count = unlock_count + 1 where id = p_rfq;
  end if;
  return query select c.buyer_name, c.phone, c.email from public.bati_rfq_contacts c where c.rfq_id = p_rfq;
end $$;

-- ---------- Payments ----------
create table if not exists public.bati_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.bati_profiles(id) on delete cascade,
  product text not null check (product in ('credits_10','credits_30','pro_month')),
  amount_djf int not null,
  method text not null check (method in ('dmoney','waafi','cac_pay','cash')),
  reference text not null check (char_length(reference) between 3 and 60),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  created_at timestamptz not null default now()
);

create or replace function public.bati_payment_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.bati_is_admin() then new.status := 'pending'; new.user_id := auth.uid(); end if;
    new.amount_djf := case new.product when 'credits_10' then 5000 when 'credits_30' then 12000 when 'pro_month' then 20000 end;
    return new;
  end if;
  if new.status = 'confirmed' and old.status <> 'confirmed' then
    if new.product = 'credits_10' then update public.bati_profiles set credits = credits + 10 where id = new.user_id;
    elsif new.product = 'credits_30' then update public.bati_profiles set credits = credits + 30 where id = new.user_id;
    elsif new.product = 'pro_month' then
      update public.bati_profiles set plan = 'pro',
        plan_until = greatest(coalesce(plan_until, current_date), current_date) + 30 where id = new.user_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists bati_payment_guard on public.bati_payments;
create trigger bati_payment_guard before insert or update on public.bati_payments
for each row execute function public.bati_payment_guard();

-- ---------- RLS ----------
alter table public.bati_profiles enable row level security;
alter table public.bati_materials enable row level security;
alter table public.bati_prices enable row level security;
alter table public.bati_rfqs enable row level security;
alter table public.bati_rfq_contacts enable row level security;
alter table public.bati_unlocks enable row level security;
alter table public.bati_payments enable row level security;

drop policy if exists bati_profiles_read on public.bati_profiles;
create policy bati_profiles_read on public.bati_profiles for select using (verified or id = (select auth.uid()) or public.bati_is_admin());
drop policy if exists bati_profiles_insert on public.bati_profiles;
create policy bati_profiles_insert on public.bati_profiles for insert with check (id = (select auth.uid()));
drop policy if exists bati_profiles_update on public.bati_profiles;
create policy bati_profiles_update on public.bati_profiles for update using (id = (select auth.uid()) or public.bati_is_admin());

drop policy if exists bati_materials_read on public.bati_materials;
create policy bati_materials_read on public.bati_materials for select using (true);
drop policy if exists bati_materials_admin on public.bati_materials;
create policy bati_materials_admin on public.bati_materials for all using (public.bati_is_admin()) with check (public.bati_is_admin());

drop policy if exists bati_prices_read on public.bati_prices;
create policy bati_prices_read on public.bati_prices for select using (true);
drop policy if exists bati_prices_write on public.bati_prices;
create policy bati_prices_write on public.bati_prices for all
  using (supplier_id = (select auth.uid()) or public.bati_is_admin())
  with check (supplier_id = (select auth.uid()) or public.bati_is_admin());

-- RFQ details (no contact) visible to logged-in suppliers and admins
drop policy if exists bati_rfqs_read on public.bati_rfqs;
create policy bati_rfqs_read on public.bati_rfqs for select to authenticated using (true);
drop policy if exists bati_rfqs_admin on public.bati_rfqs;
create policy bati_rfqs_admin on public.bati_rfqs for update using (public.bati_is_admin());

drop policy if exists bati_contacts_read on public.bati_rfq_contacts;
create policy bati_contacts_read on public.bati_rfq_contacts for select using (
  public.bati_is_admin() or exists (select 1 from public.bati_unlocks u where u.rfq_id = bati_rfq_contacts.rfq_id and u.supplier_id = (select auth.uid()))
);

drop policy if exists bati_unlocks_read on public.bati_unlocks;
create policy bati_unlocks_read on public.bati_unlocks for select using (supplier_id = (select auth.uid()) or public.bati_is_admin());

drop policy if exists bati_payments_read on public.bati_payments;
create policy bati_payments_read on public.bati_payments for select using (user_id = (select auth.uid()) or public.bati_is_admin());
drop policy if exists bati_payments_insert on public.bati_payments;
create policy bati_payments_insert on public.bati_payments for insert with check ((select auth.uid()) is not null);
drop policy if exists bati_payments_update on public.bati_payments;
create policy bati_payments_update on public.bati_payments for update using (public.bati_is_admin());

grant select on public.bati_price_board, public.bati_offers to anon, authenticated;
grant execute on function public.bati_create_rfq(text,text,text,text,text,text,date,boolean) to anon, authenticated;
revoke execute on function public.bati_unlock_rfq(uuid) from anon, public;
grant execute on function public.bati_unlock_rfq(uuid) to authenticated;
