import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";

export const PiProvider = ({ children }: { children: ReactNode }) => {
  return <AuthProvider>{children}</AuthProvider>;
};

export const usePi = useAuth;

export type PiUser = ReturnType<typeof useAuth>["user"];
