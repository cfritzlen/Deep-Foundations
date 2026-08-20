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
-- SAMPLE HISTORY — realistic mid-project state (~50% complete)
-- Dates are relative to today so the demo always looks current.
-- ============================================================

-- ---- A-7: refused early on an obstruction 5 days ago, rejected,
--      replacement A-7R created (driven to depth in the loop below) ----
update bedrock_piles set status='rejected' where label='A-7' and pile_kind='driven';
insert into bedrock_log_days (pile_id, work_date, day_start, day_end, equipment_id, engineer)
select id, current_date - 5,
       (current_date - 5) + time '12:30', (current_date - 5) + time '13:55',
       '20000000-0000-0000-0000-000000000002', 'D. Okafor'
from bedrock_piles where label='A-7' and pile_kind='driven';
insert into bedrock_events (pile_id, ts, event_type, data)
select id, (current_date - 5) + time '12:41', 'drive_start', '{"start_depth_ft": 0}'
from bedrock_piles where label='A-7' and pile_kind='driven';
insert into bedrock_blow_counts (pile_id, depth_ft, blows, stroke_ft, ts)
select p.id, g,
       case when g < 20 then (7 + floor(random()*4))::int else 20 + (g-19)*14 end,
       5.5,
       (current_date - 5) + time '12:41' + (g * interval '2 minutes')
from bedrock_piles p, generate_series(1,22) g
where p.label='A-7' and p.pile_kind='driven';
insert into bedrock_events (pile_id, ts, event_type, data)
select id, (current_date - 5) + time '13:32', 'obstruction_hit',
       '{"depth_ft": 22, "type": "Unknown", "note": "suspected timber crib"}'
from bedrock_piles where label='A-7' and pile_kind='driven';
insert into bedrock_events (pile_id, ts, event_type, data)
select id, (current_date - 5) + time '13:50', 'pile_failed',
       '{"reason": "Refused early", "depth_ft": 22}'
from bedrock_piles where label='A-7' and pile_kind='driven';
insert into bedrock_piles (job_id, label, pile_kind, description, length_ft,
                   required_tip_elev_ft, driving_criteria, replaces_pile_id, sort_order)
select job_id, 'A-7R', 'driven', description, length_ft,
       required_tip_elev_ft, driving_criteria, id, 100
from bedrock_piles where label='A-7' and pile_kind='driven';

-- ---- 13 driven piles completed over the last ~2.5 weeks ----
-- Two rigs run in parallel (slot 0 = PD-1 / C. Fritzlen, slot 1 = PD-2 / D. Okafor).
-- Blow counts rise with depth (soft over hard); B-2 runs from 9-12 ft;
-- A-3 hits old dock timber at 14 ft (40 min lost).
do $$
declare
  rec record;
  pid uuid;
  rig uuid;
  eng text;
  d date;
  t_cursor timestamptz;
  drive_start_ts timestamptz;
  g int;
  nblows int;
  stroke numeric;
begin
  for rec in
    select * from (values
      ('A-1', 62, 0, 0), ('A-2', 63, 0, 1),
      ('A-4', 61, 1, 0), ('A-5', 64, 1, 1),
      ('A-6', 62, 2, 0), ('B-1', 63, 2, 1),
      ('B-2', 62, 3, 0), ('B-3', 64, 3, 1),
      ('B-4', 63, 4, 0), ('B-5', 61, 4, 1),
      ('B-6', 63, 5, 0), ('A-3', 62, 5, 1),
      ('A-7R', 63, 6, 0)
    ) as v(lbl, final_ft, day_off, slot)
  loop
    select id into pid from bedrock_piles where label = rec.lbl and pile_kind = 'driven';
    rig := case when rec.slot = 0 then '20000000-0000-0000-0000-000000000001'::uuid
                else '20000000-0000-0000-0000-000000000002'::uuid end;
    eng := case when rec.slot = 0 then 'C. Fritzlen' else 'D. Okafor' end;
    d := current_date - 16 + rec.day_off * 2;
    drive_start_ts := d + time '07:05' + (rec.slot * interval '95 minutes')
                        + (floor(random()*20) * interval '1 minute');
    t_cursor := drive_start_ts;

    insert into bedrock_events (pile_id, ts, event_type, data)
    values (pid, drive_start_ts, 'drive_start', '{"start_depth_ft": 0}');

    for g in 1..rec.final_ft loop
      t_cursor := t_cursor + interval '2 minutes';
      if rec.lbl = 'B-2' and g between 9 and 12 then
        insert into bedrock_blow_counts (pile_id, depth_ft, blows, stroke_ft, ts)
        values (pid, g, 0, null, t_cursor);
        continue;
      end if;
      if rec.lbl = 'A-3' and g = 14 then
        insert into bedrock_events (pile_id, ts, event_type, data)
        values (pid, t_cursor, 'obstruction_hit',
                '{"depth_ft": 14, "type": "Timber", "note": "old dock piles"}');
        t_cursor := t_cursor + interval '40 minutes';
        insert into bedrock_events (pile_id, ts, event_type, data)
        values (pid, t_cursor, 'obstruction_cleared', '{"depth_ft": 14}');
      end if;
      nblows := greatest(3, (4 + 32 * power(g::numeric / rec.final_ft, 2))::int
                            + floor(random()*4)::int);
      stroke := least(7.5, round((4.5 + 3.0 * g / rec.final_ft)::numeric, 1));
      insert into bedrock_blow_counts (pile_id, depth_ft, blows, stroke_ft, ts)
      values (pid, g, nblows, stroke, t_cursor);
    end loop;

    if rec.lbl = 'B-2' then
      insert into bedrock_events (pile_id, ts, event_type, data)
      values (pid, drive_start_ts + interval '26 minutes', 'pile_run',
              '{"from_ft": 8, "to_ft": 12}');
    end if;

    insert into bedrock_events (pile_id, ts, event_type, data)
    values (pid, t_cursor + interval '3 minutes', 'drive_end',
            json_build_object('end_depth_ft', rec.final_ft,
                              'tip_elev_ft', -58 - round((random()*0.6)::numeric, 1),
                              'criteria_met', 'tip elevation')::jsonb);

    insert into bedrock_log_days (pile_id, work_date, day_start, day_end, equipment_id, engineer)
    values (pid, d, drive_start_ts - interval '10 minutes',
            t_cursor + interval '25 minutes', rig, eng);

    update bedrock_piles set status = 'complete' where id = pid;
  end loop;
end $$;

-- ---- B-7: mid-drive TODAY (in progress, 31 ft in) ----
do $$
declare pid uuid; t timestamptz; g int; nblows int;
begin
  select id into pid from bedrock_piles where label='B-7' and pile_kind='driven';
  insert into bedrock_log_days (pile_id, work_date, day_start, equipment_id, engineer)
  values (pid, current_date, current_date + time '06:55',
          '20000000-0000-0000-0000-000000000001', 'C. Fritzlen');
  insert into bedrock_events (pile_id, ts, event_type, data)
  values (pid, current_date + time '07:08', 'drive_start', '{"start_depth_ft": 0}');
  t := current_date + time '07:08';
  for g in 1..31 loop
    t := t + interval '2 minutes';
    nblows := greatest(3, (4 + 32 * power(g::numeric / 63, 2))::int + floor(random()*4)::int);
    insert into bedrock_blow_counts (pile_id, depth_ft, blows, stroke_ft, ts)
    values (pid, g, nblows, round((4.5 + 3.0 * g / 63)::numeric, 1), t);
  end loop;
  update bedrock_piles set status='in_progress' where id=pid;
end $$;

-- ---- SH-1: complete — two days, boulder at 18 ft, failed first socket
--      inspection (+5 ft), re-drill, pass, cage & 3-truck pour ----
update bedrock_piles set status='complete', socket_extension_ft=5
 where label='SH-1' and pile_kind='shaft';
insert into bedrock_log_days (pile_id, work_date, day_start, day_end, equipment_id, engineer)
select id, current_date - 14,
       (current_date - 14) + time '07:00', (current_date - 14) + time '15:30',
       '20000000-0000-0000-0000-000000000003', 'C. Fritzlen'
from bedrock_piles where label='SH-1' and pile_kind='shaft';
insert into bedrock_log_days (pile_id, work_date, day_start, day_end, equipment_id, engineer)
select id, current_date - 13,
       (current_date - 13) + time '06:45', (current_date - 13) + time '17:10',
       '20000000-0000-0000-0000-000000000003', 'C. Fritzlen'
from bedrock_piles where label='SH-1' and pile_kind='shaft';
insert into bedrock_events (pile_id, ts, event_type, data)
select id, ts, event_type, data::jsonb from bedrock_piles p, (values
  ((current_date - 14) + time '07:20', 'drill_start',        '{"start_depth_ft": 0}'),
  ((current_date - 14) + time '10:05', 'obstruction_hit',    '{"depth_ft": 18, "type": "Boulder"}'),
  ((current_date - 14) + time '11:35', 'obstruction_cleared','{"depth_ft": 18}'),
  ((current_date - 14) + time '14:20', 'rock_reached',       '{"depth_ft": 35}'),
  ((current_date - 14) + time '15:20', 'drill_end',          '{"end_depth_ft": 38, "note": "casing seated at 35 ft"}'),
  ((current_date - 13) + time '06:55', 'drill_start',        '{"start_depth_ft": 38}'),
  ((current_date - 13) + time '09:40', 'drill_end',          '{"end_depth_ft": 50}'),
  ((current_date - 13) + time '10:15', 'inspection',         '{"result": "fail", "inspector": "GeoTech NY - R. Alvarez", "note": "soft seams in socket sidewall"}'),
  ((current_date - 13) + time '10:20', 'socket_extension',   '{"added_ft": 5, "new_required_socket_ft": 20}'),
  ((current_date - 13) + time '10:30', 'drill_start',        '{"start_depth_ft": 50}'),
  ((current_date - 13) + time '12:10', 'drill_end',          '{"end_depth_ft": 55}'),
  ((current_date - 13) + time '12:45', 'inspection',         '{"result": "pass", "inspector": "GeoTech NY - R. Alvarez"}'),
  ((current_date - 13) + time '13:30', 'cage_set',           '{"cage": "72 in x 55 ft, #11 verticals"}'),
  ((current_date - 13) + time '14:05', 'pour_start',         '{}'),
  ((current_date - 13) + time '16:40', 'pour_end',           '{"total_cy": 30}')
) v(ts, event_type, data)
where p.label='SH-1' and p.pile_kind='shaft';
insert into bedrock_concrete_tickets (pile_id, ts, truck_no, ticket_no, supplier, volume_cy,
                              slump_in, air_pct, temp_f, cylinders)
select id, ts, truck_no, ticket_no, 'Colonial Concrete Corp.', cy, slump, air, temp, cyl
from bedrock_piles p, (values
  ((current_date - 13) + time '14:05','CC-214','88121', 10.0, 8.5, 4.2, 78, 4),
  ((current_date - 13) + time '15:10','CC-208','88134', 10.0, 8.0, 4.5, 80, 0),
  ((current_date - 13) + time '16:05','CC-214','88142', 10.0, 8.5, 4.0, 79, 0)
) v(ts, truck_no, ticket_no, cy, slump, air, temp, cyl)
where p.label='SH-1' and p.pile_kind='shaft';

-- ---- SH-2: complete — clean two-day shaft, passed first inspection,
--      4-truck pour ----
update bedrock_piles set status='complete' where label='SH-2' and pile_kind='shaft';
insert into bedrock_log_days (pile_id, work_date, day_start, day_end, equipment_id, engineer)
select id, current_date - 8,
       (current_date - 8) + time '07:10', (current_date - 8) + time '15:20',
       '20000000-0000-0000-0000-000000000003', 'C. Fritzlen'
from bedrock_piles where label='SH-2' and pile_kind='shaft';
insert into bedrock_log_days (pile_id, work_date, day_start, day_end, equipment_id, engineer)
select id, current_date - 7,
       (current_date - 7) + time '06:50', (current_date - 7) + time '14:45',
       '20000000-0000-0000-0000-000000000003', 'C. Fritzlen'
from bedrock_piles where label='SH-2' and pile_kind='shaft';
insert into bedrock_events (pile_id, ts, event_type, data)
select id, ts, event_type, data::jsonb from bedrock_piles p, (values
  ((current_date - 8) + time '07:25', 'drill_start',  '{"start_depth_ft": 0}'),
  ((current_date - 8) + time '11:50', 'note',         '{"text": "Wet sand 8-14 ft, kept casing ahead of auger"}'),
  ((current_date - 8) + time '14:10', 'rock_reached', '{"depth_ft": 34}'),
  ((current_date - 8) + time '15:05', 'drill_end',    '{"end_depth_ft": 36, "note": "casing seated at 35 ft"}'),
  ((current_date - 7) + time '06:58', 'drill_start',  '{"start_depth_ft": 36}'),
  ((current_date - 7) + time '09:20', 'drill_end',    '{"end_depth_ft": 49}'),
  ((current_date - 7) + time '09:55', 'inspection',   '{"result": "pass", "inspector": "GeoTech NY - R. Alvarez", "note": "clean socket, 15 ft sound rock"}'),
  ((current_date - 7) + time '10:40', 'cage_set',     '{"cage": "72 in x 50 ft, #11 verticals"}'),
  ((current_date - 7) + time '11:10', 'pour_start',   '{}'),
  ((current_date - 7) + time '14:00', 'pour_end',     '{"total_cy": 32.5}')
) v(ts, event_type, data)
where p.label='SH-2' and p.pile_kind='shaft';
insert into bedrock_concrete_tickets (pile_id, ts, truck_no, ticket_no, supplier, volume_cy,
                              slump_in, air_pct, temp_f, cylinders)
select id, ts, truck_no, ticket_no, 'Colonial Concrete Corp.', cy, slump, air, temp, cyl
from bedrock_piles p, (values
  ((current_date - 7) + time '11:10','CC-211','89012', 8.5, 8.0, 4.4, 82, 4),
  ((current_date - 7) + time '11:55','CC-217','89025', 8.5, null, null, null, 0),
  ((current_date - 7) + time '12:40','CC-211','89033', 8.5, 8.5, 4.1, 83, 0),
  ((current_date - 7) + time '13:30','CC-224','89041', 7.0, null, null, null, 0)
) v(ts, truck_no, ticket_no, cy, slump, air, temp, cyl)
where p.label='SH-2' and p.pile_kind='shaft';

-- ---- SH-3: in progress — started yesterday, drilling continues today ----
update bedrock_piles set status='in_progress' where label='SH-3' and pile_kind='shaft';
insert into bedrock_log_days (pile_id, work_date, day_start, day_end, equipment_id, engineer)
select id, current_date - 1,
       (current_date - 1) + time '07:15', (current_date - 1) + time '15:40',
       '20000000-0000-0000-0000-000000000003', 'C. Fritzlen'
from bedrock_piles where label='SH-3' and pile_kind='shaft';
insert into bedrock_log_days (pile_id, work_date, day_start, equipment_id, engineer)
select id, current_date, current_date + time '06:58',
       '20000000-0000-0000-0000-000000000003', 'C. Fritzlen'
from bedrock_piles where label='SH-3' and pile_kind='shaft';
insert into bedrock_events (pile_id, ts, event_type, data)
select id, ts, event_type, data::jsonb from bedrock_piles p, (values
  ((current_date - 1) + time '07:35', 'drill_start',        '{"start_depth_ft": 0}'),
  ((current_date - 1) + time '10:20', 'obstruction_hit',    '{"depth_ft": 12, "type": "Boulder"}'),
  ((current_date - 1) + time '11:15', 'obstruction_cleared','{"depth_ft": 12}'),
  ((current_date - 1) + time '13:00', 'note',               '{"text": "Slow drilling 14-18 ft, dense glacial till"}'),
  ((current_date - 1) + time '15:30', 'drill_end',          '{"end_depth_ft": 19}'),
  (current_date + time '07:12',       'drill_start',        '{"start_depth_ft": 19}'),
  (current_date + time '09:05',       'drill_end',          '{"end_depth_ft": 26}')
) v(ts, event_type, data)
where p.label='SH-3' and p.pile_kind='shaft';
