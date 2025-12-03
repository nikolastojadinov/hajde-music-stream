import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, type User } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be defined");
}

const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
  },
});

const ACCESS_TOKEN_COOKIES = ["sb-access-token", "supabase-access-token", "sb:token"] as const;

export const getUserFromCookies = async (): Promise<User | null> => {
  const store = cookies();
  const token = ACCESS_TOKEN_COOKIES.map((key) => store.get(key)?.value).find(Boolean);
  if (!token) {
    return null;
  }
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    return null;
  }
  return data.user;
};

export const requireUser = async (redirectTo?: string): Promise<User> => {
  const user = await getUserFromCookies();
  if (!user) {
    redirect(redirectTo ?? "/login");
  }
  return user;
};
