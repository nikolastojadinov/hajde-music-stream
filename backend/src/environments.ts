import dotenv from 'dotenv';

console.log("NODE_ENV: " + process.env.NODE_ENV);

const result = dotenv.config()

if (result.error) {
  if (process.env.NODE_ENV === "development") {
    console.error(".env file not found. This is an error condition in development. Additional error is logged below");
    throw result.error;
  }

  // In production, environment variables are injected into the container environment. We should not even have
  // a .env file inside the running container.
}

interface Environment {
  port: number,
  session_secret: string,
  pi_api_key: string,
  platform_api_url: string,
  supabase_url: string,
  supabase_service_role_key: string,
  frontend_url: string,
}

const env: Environment = {
  port: parseInt(process.env.PORT || '8000', 10),
  session_secret: process.env.SESSION_SECRET || "This is my session secret",
  pi_api_key: process.env.PI_API_KEY || '',
  platform_api_url: process.env.PLATFORM_API_URL || 'https://api.minepi.com',
  supabase_url: process.env.SUPABASE_URL || '',
  supabase_service_role_key: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  frontend_url: process.env.FRONTEND_URL || 'http://localhost:3314',
};

export default env;
