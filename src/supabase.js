import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://snzgucatulndhysqznrp.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNuemd1Y2F0dWxuZGh5c3F6bnJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3Mjc2MzUsImV4cCI6MjA4ODMwMzYzNX0.p31EGLTSW5YMYKlYaaKxOaccD_4CEK6YJ1aH0ASZFZY'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)