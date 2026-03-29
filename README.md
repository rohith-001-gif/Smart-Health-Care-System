# Smart Health Care System

ESP32-based patient monitoring system with doctor dashboard, patient portal, and alerting.

## Supabase Setup

1. Install dependencies:
   - `npm install`

2. Create local env file:
   - Copy `.env.example` to `.env`
   - Fill `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`

3. Create database tables:
   - Open Supabase Dashboard -> SQL Editor
   - Run SQL from `supabase/schema.sql`

4. Seed one doctor login (optional):
   - Run SQL from `supabase/seed.sql`
   - You can then sign in using `doctor@example.com` / `12345678`

5. Start server:
   - `node server.js`
   - Open `http://localhost:3000/login.html`

6. Verify Supabase connection:
   - Visit `http://localhost:3000/supabase-health`
   - Expected: `{ "success": true, "message": "Supabase connected" }`

## Existing Features

- Doctor login and patient linking
- Patient portal with trend charts
- Critical alert notifications
- AI chat assistant with Groq API
