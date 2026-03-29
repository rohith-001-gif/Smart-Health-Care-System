insert into public.doctors(email, password)
values ('rohith262008@gmail.com', '12345678')
on conflict (email) do nothing;
