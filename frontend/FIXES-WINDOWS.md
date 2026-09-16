# NOKHBA student and authentication fixes

cd frontend
npm install
npm start

Open http://localhost:3000/

Test adding a student from Dashboard > Students > Add Student.

For production, set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the frontend environment. Do not place service-role or secret Supabase keys in the frontend.
