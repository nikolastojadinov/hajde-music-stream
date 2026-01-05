// Environment loader (clean rewrite)
// Loads .env only in development; in production Render injects env vars.
import dotenv from 'dotenv';

const nodeEnv = process.env.NODE_ENV || 'production';
console.log('NODE_ENV:', nodeEnv);

if (nodeEnv === 'development') {
  const result = dotenv.config();
  if (result.error) {
    console.error('.env file not found in development. Throwing to prevent silent misconfiguration');
    throw result.error;
  }
}

// Define shape of required environment variables.
interface Environment {
  port: number;
  session_secret: string;
  pi_api_key: string;
  platform_api_url: string;
  supabase_url: string;
  supabase_service_role_key: string;
  supabase_anon_key: string;
  supabase_jwt_secret: string;
  frontend_url: string;
  enable_run_jobs: boolean;
}

// Map only supported Supabase vars (external_* removed).
const env: Environment = {
  port: parseInt(process.env.PORT || '8000', 10),
  session_secret: process.env.SESSION_SECRET || 'This is my session secret',
  pi_api_key: process.env.PI_API_KEY || '',
  platform_api_url: process.env.PLATFORM_API_URL || 'https://api.minepi.com',
  supabase_url: process.env.SUPABASE_URL || '',
  supabase_service_role_key: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  supabase_anon_key: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '',
  supabase_jwt_secret: process.env.SUPABASE_JWT_SECRET || '',
  frontend_url: process.env.FRONTEND_URL || 'http://localhost:3314',
  enable_run_jobs: (process.env.ENABLE_RUN_JOBS || 'true').toLowerCase() !== 'false',
};

export default env;
