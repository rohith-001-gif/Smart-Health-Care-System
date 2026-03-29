create table if not exists public.doctors (
  id bigint generated always as identity primary key,
  email text not null unique,
  password text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.patients (
  watch_id text primary key,
  name text not null,
  email text not null,
  doctor_email text not null,
  age text not null default '',
  condition text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.readings (
  id bigint generated always as identity primary key,
  watch_id text not null references public.patients(watch_id) on delete cascade,
  hr integer not null default 0,
  spo2 integer not null default 0,
  steps integer not null default 0,
  status text not null default 'normal',
  time timestamptz not null default now()
);

create index if not exists idx_patients_doctor_email on public.patients(doctor_email);
create index if not exists idx_readings_watch_time on public.readings(watch_id, time desc);
