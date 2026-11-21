"use client";

import React from "react";
import { ThemeProvider } from "@/lib/context/theme-context";
import { ToastProvider } from "@/components/ui/toast";
import { CityStoreProvider } from "@/lib/store/city-store";
import { AuthProvider } from "@/lib/auth/auth-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <CityStoreProvider>{children}</CityStoreProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
