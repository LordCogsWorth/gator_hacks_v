/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'local' | 'supabase' | 'auto' (default auto: Supabase when both keys are set). */
  readonly VITE_DATA_SOURCE?: 'local' | 'supabase' | 'auto' | '';
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
