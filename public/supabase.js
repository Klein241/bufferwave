import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

export const supabase = createClient(
  'https://udmmtyczhxqscgigrden.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkbW10eWN6aHhxc2NnaWdyZGVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NzY5ODgsImV4cCI6MjA4NzI1Mjk4OH0.VrLhrYQgy31EsstVXLeeVVVYP5iMvsYG5Sel0hp6dgI'
)
