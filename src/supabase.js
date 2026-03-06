import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://snzgucatulndhysqznrp.supabase.co'
const SUPABASE_KEY = 'sb_publishable_HKBIZNy1jeDA-vN5nzAKiQ_D_rGLhPp'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)