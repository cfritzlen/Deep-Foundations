-- ============================================================
-- Bedrock & Sons — Drill Log App
-- Database setup + playground data
-- Run this once in the Supabase SQL Editor.
-- ALL tables are prefixed "bedrock_" — this script only ever
-- touches bedrock_* tables and the "bedrock-tickets" storage
-- bucket. It never reads or changes anything else in the
-- database. Safe to re-run: it wipes and rebuilds the demo
-- tables (bedrock_* only).
-- ============================================================

-- Seeded sample times below are wall-clock Eastern time.
set timezone = 'America/New_York';

-- ---- start clean (bedrock_ demo tables only) ----
drop table if exists bedrock_concrete_tickets cascade;
drop table if exists bedrock_blow_counts cascade;
drop table if exists bedrock_events cascade;
drop table if exists bedrock_log_days cascade;
drop table if exists bedrock_piles cascade;
drop table if exists bedrock_equipment cascade;
drop table if exists bedrock_mix_designs cascade;
drop table if exists bedrock_jobs cascade;

-- ============================================================
-- TABLES
-- ============================================================

create table bedrock_jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  job_number text,
  location text,
  job_type text not null check (job_type in ('pile_driving','drilled_shafts'))
);

create table bedrock_equipment (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references bedrock_jobs(id) on delete cascade,
  name text not null,                  -- e.g. "PD-1 — Link-Belt 448"
  hammer_make_model text,              -- e.g. "Delmag D46-32"
  hammer_type text,                    -- diesel / hydraulic
  rated_energy_ftlbs integer
);

create table bedrock_mix_designs (
  id uuid primary key default gen_random_uuid(),
  code text not null,                  -- e.g. "BS-4000T"
  description text,
  strength_psi integer,
  supplier text
);

create table bedrock_piles (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references bedrock_jobs(id) on delete cascade,
  label text not null,                 -- e.g. "B-14" / "SH-3"
  pile_kind text not null check (pile_kind in ('driven','shaft')),
  status text not null default 'not_started'
    check (status in ('not_started','in_progress','complete','rejected')),
  description text,                    -- e.g. "HP 14x89" / "72 in dia drilled shaft"
  length_ft numeric,
  -- driven piles
  required_tip_elev_ft numeric,
  driving_criteria text,
  -- drilled shafts
  required_casing_depth_ft numeric,
  required_socket_depth_ft numeric,
  socket_extension_ft numeric not null default 0,
  mix_design_id uuid references bedrock_mix_designs(id),
  -- failure / replacement chain
  replaces_pile_id uuid references bedrock_piles(id),
  sort_order integer
);

-- one row per pile per day worked (day-over-day continuation)
create table bedrock_log_days (
  id uuid primary key default gen_random_uuid(),
  pile_id uuid not null references bedrock_piles(id) on delete cascade,
  work_date date not null,
  day_start timestamptz,
  day_end timestamptz,
  equipment_id uuid references bedrock_equipment(id),
  engineer text,
  unique (pile_id, work_date)
);

-- timestamped event stream per pile: drill_start, drill_end, obstruction_hit,
-- obstruction_cleared, inspection, socket_extension, cage_set, pour_start,
-- pour_end, drive_start, drive_end, pile_failed, note
create table bedrock_events (
  id uuid primary key default gen_random_uuid(),
  pile_id uuid not null references bedrock_piles(id) on delete cascade,
  ts timestamptz not null default now(),
  event_type text not null,
  data jsonb not null default '{}'::jsonb
);

-- per-foot driving record
create table bedrock_blow_counts (
  id uuid primary key default gen_random_uuid(),
  pile_id uuid not null references bedrock_piles(id) on delete cascade,
  depth_ft integer not null,           -- the foot mark completed
  blows integer not null,
  stroke_ft numeric,
  ts timestamptz not null default now(),
  unique (pile_id, depth_ft)
);

-- pour log: one row per concrete truck
create table bedrock_concrete_tickets (
  id uuid primary key default gen_random_uuid(),
  pile_id uuid not null references bedrock_piles(id) on delete cascade,
  ts timestamptz not null default now(),
  truck_no text,
  ticket_no text,
  supplier text,
  volume_cy numeric,
  photo_path text,                     -- path in the 'bedrock-tickets' storage bucket
  slump_in numeric,
  air_pct numeric,
  temp_f numeric,
  cylinders integer
);

-- ============================================================
-- ROW LEVEL SECURITY
-- Every bedrock_ table gets RLS turned ON, with a policy that
-- allows the app (public key) full access to THESE tables only.
-- Nothing here grants access to any other table.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['bedrock_jobs','bedrock_equipment','bedrock_mix_designs',
                          'bedrock_piles','bedrock_log_days','bedrock_events',
                          'bedrock_blow_counts','bedrock_concrete_tickets'] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "bedrock demo full access" on %I for all using (true) with check (true)', t);
  end loop;
end $$;

-- storage bucket for concrete ticket photos
insert into storage.buckets (id, name, public)
values ('bedrock-tickets','bedrock-tickets', true)
on conflict (id) do nothing;

drop policy if exists "bedrock tickets read"  on storage.objects;
drop policy if exists "bedrock tickets write" on storage.objects;
create policy "bedrock tickets read"  on storage.objects
  for select using (bucket_id = 'bedrock-tickets');
create policy "bedrock tickets write" on storage.objects
  for insert with check (bucket_id = 'bedrock-tickets');

-- ============================================================
-- PLAYGROUND DATA
-- ============================================================

-- ---- jobs ----
insert into bedrock_jobs (id, name, job_number, location, job_type) values
  ('10000000-0000-0000-0000-000000000001',
   'Harbor Terminal Wharf Reconstruction', 'BS-2417',
   'Port Newton, NY', 'pile_driving'),
  ('10000000-0000-0000-0000-000000000002',
   'Riverside Tower — Parcel C', 'BS-2422',
   'New Rochelle, NY', 'drilled_shafts');

-- ---- equipment (two pile drivers on the wharf job, one drill rig on the tower) ----
insert into bedrock_equipment (id, job_id, name, hammer_make_model, hammer_type, rated_energy_ftlbs) values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
   'PD-1 — Link-Belt 448','Delmag D46-32','diesel',107177),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',
   'PD-2 — Manitowoc 999','APE D50-42','diesel',114000),
  ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002',
   'DR-1 — Bauer BG 39', null, null, null);

-- ---- mix design for the shafts ----
insert into bedrock_mix_designs (id, code, description, strength_psi, supplier) values
  ('30000000-0000-0000-0000-000000000001','BS-4000T',
   '4000 psi tremie mix, 3/8" pea gravel, HRWR', 4000, 'Colonial Concrete Corp.');

-- ---- driven piles: A-1..A-12 and B-1..B-12, HP 14x89, 65 ft ----
insert into bedrock_piles (id, job_id, label, pile_kind, description, length_ft,
                   required_tip_elev_ft, driving_criteria, sort_order)
select
  ('40000000-0000-0000-0000-0000000000' || lpad((row_number() over ())::text, 2, '0'))::uuid,
  '10000000-0000-0000-0000-000000000001',
  s.label, 'driven', 'HP 14x89', 65, -58,
  '20 blows/ft min. or tip elev.',
  row_number() over ()
from (
  select 'A-' || g as label, 1 as grp, g from generate_series(1,12) g
  union all
  select 'B-' || g, 2, g from generate_series(1,12) g
) s;

-- ---- drilled shafts: SH-1..SH-6, 72", casing 35 ft, socket 15 ft ----
insert into bedrock_piles (id, job_id, label, pile_kind, description, length_ft,
                   required_casing_depth_ft, required_socket_depth_ft,
                   mix_design_id, sort_order)
select
  ('50000000-0000-0000-0000-0000000000' || lpad(g::text, 2, '0'))::uuid,
  '10000000-0000-0000-0000-000000000002',
  'SH-' || g, 'shaft', '72 in dia drilled shaft', 55, 35, 15,
  '30000000-0000-0000-0000-000000000001', g
from generate_series(1,6) g;

-- ============================================================
-- SAMPLE HISTORY (so exports & statuses have something to show)
-- ============================================================

-- ---- B-1: driven to depth yesterday, complete ----
update bedrock_piles set status='complete' where label='B-1' and pile_kind='driven';
insert into bedrock_log_days (pile_id, work_date, day_start, day_end, equipment_id, engineer)
select id, current_date - 1,
       (current_date - 1) + time '07:05', (current_date - 1) + time '09:40',
       '20000000-0000-0000-0000-000000000001', 'C. Fritzlen'
from bedrock_piles where label='B-1' and pile_kind='driven';
insert into bedrock_events (pile_id, ts, event_type, data)
select id, (current_date - 1) + time '07:12', 'drive_start', '{"start_depth_ft": 0}'
from bedrock_piles where label='B-1' and pile_kind='driven';
insert into bedrock_blow_counts (pile_id, depth_ft, blows, stroke_ft, ts)
select p.id, g,
       greatest(4, (6 + g/6 + floor(random()*4))::int),
       round((5 + (g::numeric/30))::numeric, 1),
       (current_date - 1) + time '07:12' + (g * interval '2 minutes')
from bedrock_piles p, generate_series(1,63) g
where p.label='B-1' and p.pile_kind='driven';
insert into bedrock_events (pile_id, ts, event_type, data)
select id, (current_date - 1) + time '09:31', 'drive_end',
       '{"end_depth_ft": 63, "tip_elev_ft": -58.2, "criteria_met": "tip elevation"}'
from bedrock_piles where label='B-1' and pile_kind='driven';

-- ---- A-7: refused early on an obstruction, rejected, replaced by A-7R ----
update bedrock_piles set status='rejected' where label='A-7' and pile_kind='driven';
insert into bedrock_log_days (pile_id, work_date, day_start, day_end, equipment_id, engineer)
select id, current_date - 2,
       (current_date - 2) + time '12:30', (current_date - 2) + time '13:55',
       '20000000-0000-0000-0000-000000000002', 'C. Fritzlen'
from bedrock_piles where label='A-7' and pile_kind='driven';
insert into bedrock_events (pile_id, ts, event_type, data)
select id, (current_date - 2) + time '12:41', 'drive_start', '{"start_depth_ft": 0}'
from bedrock_piles where label='A-7' and pile_kind='driven';
insert into bedrock_blow_counts (pile_id, depth_ft, blows, stroke_ft, ts)
select p.id, g,
       case when g < 20 then (7 + floor(random()*4))::int else 20 + (g-19)*14 end,
       5.5,
       (current_date - 2) + time '12:41' + (g * interval '2 minutes')
from bedrock_piles p, generate_series(1,22) g
where p.label='A-7' and p.pile_kind='driven';
insert into bedrock_events (pile_id, ts, event_type, data)
select id, (current_date - 2) + time '13:32', 'obstruction_hit',
       '{"depth_ft": 22, "type": "unknown - suspected timber crib"}'
from bedrock_piles where label='A-7' and pile_kind='driven';
insert into bedrock_events (pile_id, ts, event_type, data)
select id, (current_date - 2) + time '13:50', 'pile_failed',
       '{"reason": "refused early on obstruction", "depth_ft": 22}'
from bedrock_piles where label='A-7' and pile_kind='driven';
insert into bedrock_piles (job_id, label, pile_kind, description, length_ft,
                   required_tip_elev_ft, driving_criteria, replaces_pile_id, sort_order)
select job_id, 'A-7R', 'driven', description, length_ft,
       required_tip_elev_ft, driving_criteria, id, 100
from bedrock_piles where label='A-7' and pile_kind='driven';

-- ---- SH-1: fully complete shaft — drilled over two days, failed first
--      inspection (+5 ft socket), cage + pour with 3 trucks ----
update bedrock_piles set status='complete', socket_extension_ft=5
 where label='SH-1' and pile_kind='shaft';
insert into bedrock_log_days (pile_id, work_date, day_start, day_end, equipment_id, engineer)
select id, current_date - 4,
       (current_date - 4) + time '07:00', (current_date - 4) + time '15:30',
       '20000000-0000-0000-0000-000000000003', 'C. Fritzlen'
from bedrock_piles where label='SH-1' and pile_kind='shaft';
insert into bedrock_log_days (pile_id, work_date, day_start, day_end, equipment_id, engineer)
select id, current_date - 3,
       (current_date - 3) + time '06:45', (current_date - 3) + time '17:10',
       '20000000-0000-0000-0000-000000000003', 'C. Fritzlen'
from bedrock_piles where label='SH-1' and pile_kind='shaft';
insert into bedrock_events (pile_id, ts, event_type, data)
select id, ts, event_type, data::jsonb from bedrock_piles p, (values
  ((current_date - 4) + time '07:20', 'drill_start',        '{"start_depth_ft": 0}'),
  ((current_date - 4) + time '10:05', 'obstruction_hit',    '{"depth_ft": 18, "type": "boulder"}'),
  ((current_date - 4) + time '11:35', 'obstruction_cleared','{"depth_ft": 18}'),
  ((current_date - 4) + time '15:20', 'drill_end',          '{"end_depth_ft": 38, "note": "casing seated at 35 ft"}'),
  ((current_date - 3) + time '06:55', 'drill_start',        '{"start_depth_ft": 38}'),
  ((current_date - 3) + time '09:40', 'drill_end',          '{"end_depth_ft": 50}'),
  ((current_date - 3) + time '10:15', 'inspection',         '{"result": "fail", "inspector": "GeoTech NY - R. Alvarez", "note": "soft seams in socket sidewall"}'),
  ((current_date - 3) + time '10:20', 'socket_extension',   '{"added_ft": 5, "new_required_socket_ft": 20}'),
  ((current_date - 3) + time '10:30', 'drill_start',        '{"start_depth_ft": 50}'),
  ((current_date - 3) + time '12:10', 'drill_end',          '{"end_depth_ft": 55}'),
  ((current_date - 3) + time '12:45', 'inspection',         '{"result": "pass", "inspector": "GeoTech NY - R. Alvarez"}'),
  ((current_date - 3) + time '13:30', 'cage_set',           '{"cage": "72 in x 55 ft, #11 verticals"}'),
  ((current_date - 3) + time '14:05', 'pour_start',         '{}'),
  ((current_date - 3) + time '16:40', 'pour_end',           '{"total_cy": 30, "theoretical_cy": 28.5}')
) v(ts, event_type, data)
where p.label='SH-1' and p.pile_kind='shaft';
insert into bedrock_concrete_tickets (pile_id, ts, truck_no, ticket_no, supplier, volume_cy,
                              slump_in, air_pct, temp_f, cylinders)
select id, ts, truck_no, ticket_no, 'Colonial Concrete Corp.', cy, slump, air, temp, cyl from bedrock_piles p, (values
  ((current_date - 3) + time '14:05','CC-214','88121', 10.0, 8.5, 4.2, 78, 4),
  ((current_date - 3) + time '15:10','CC-208','88134', 10.0, 8.0, 4.5, 80, 0),
  ((current_date - 3) + time '16:05','CC-214','88142', 10.0, 8.5, 4.0, 79, 0)
) v(ts, truck_no, ticket_no, cy, slump, air, temp, cyl)
where p.label='SH-1' and p.pile_kind='shaft';

-- ---- SH-2: in progress — drilling stopped mid-shaft yesterday ----
update bedrock_piles set status='in_progress' where label='SH-2' and pile_kind='shaft';
insert into bedrock_log_days (pile_id, work_date, day_start, day_end, equipment_id, engineer)
select id, current_date - 1,
       (current_date - 1) + time '07:15', (current_date - 1) + time '15:45',
       '20000000-0000-0000-0000-000000000003', 'C. Fritzlen'
from bedrock_piles where label='SH-2' and pile_kind='shaft';
insert into bedrock_events (pile_id, ts, event_type, data)
select id, ts, event_type, data::jsonb from bedrock_piles p, (values
  ((current_date - 1) + time '07:40', 'drill_start', '{"start_depth_ft": 0}'),
  ((current_date - 1) + time '13:20', 'note',        '{"text": "Slow going 20-25 ft, wet sand, added casing ahead of auger"}'),
  ((current_date - 1) + time '15:35', 'drill_end',   '{"end_depth_ft": 27}')
) v(ts, event_type, data)
where p.label='SH-2' and p.pile_kind='shaft';
