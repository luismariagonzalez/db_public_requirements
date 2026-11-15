// Los scripts de semilla necesitan GEMINI_API_KEY. Vive en ~/.secretos/nano-banana.env
// (una sola copia, fuera de OneDrive); aquí solo se lee si el entorno no la trae ya.
// Nunca se copia a un .env del proyecto.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import './entorno.mjs';

if (!process.env.GEMINI_API_KEY) {
  const ruta = process.env.GEMINI_ENV ?? join(homedir(), '.secretos', 'nano-banana.env');
  if (existsSync(ruta)) {
    const m = /^\s*GEMINI_API_KEY\s*=\s*["']?([^"'\r\n#]+?)["']?\s*$/m.exec(readFileSync(ruta, 'utf8'));
    if (m) process.env.GEMINI_API_KEY = m[1];
  }
}

// En ~/.secretos/home.env la clave secreta de Supabase se llama supabase_admin_secret_key;
// el código del proyecto (y Vercel) la llaman SUPABASE_SECRET_KEY.
process.env.SUPABASE_SECRET_KEY ??= process.env.supabase_admin_secret_key;
