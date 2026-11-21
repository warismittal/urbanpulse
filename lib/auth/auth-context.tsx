"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ROLES, type Role } from "./roles";

export interface Session {
  name: string;
  email: string;
  role: Role;
  since: number;
}

interface StoredUser {
  name: string;
  email: string;
  role: Role;
  password: string;
}

interface AuthValue {
  user: Session | null;
  ready: boolean;
  login: (email: string, password: string, role: Role) => { ok: true } | { ok: false; error: string };
  register: (u: StoredUser) => { ok: true } | { ok: false; error: string };
  logout: () => void;
}

const KEY = "urbanpulse_session";
const USERS = "urbanpulse_users";
const Ctx = createContext<AuthValue | null>(null);

function readUsers(): StoredUser[] {
  try {
    return JSON.parse(localStorage.getItem(USERS) ?? "[]") as StoredUser[];
  } catch {
    return [];
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setUser(JSON.parse(raw) as Session);
    } catch {
      /* storage blocked: stay signed out */
    }
    setReady(true);
  }, []);

  const save = (s: Session | null) => {
    setUser(s);
    try {
      if (s) localStorage.setItem(KEY, JSON.stringify(s));
      else localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  };

  const login = useCallback((email: string, password: string, role: Role) => {
    const e = email.trim().toLowerCase();
    const demo = ROLES.find((r) => r.demo.email === e);
    if (demo) {
      if (password !== demo.demo.password) return { ok: false as const, error: "Wrong password for this demo account (it is demo1234)." };
      save({ name: demo.demo.name, email: e, role: demo.id, since: Date.now() });
      return { ok: true as const };
    }
    const u = readUsers().find((x) => x.email === e);
    if (!u) return { ok: false as const, error: "No account with that email. Use a demo account or create one." };
    if (u.password !== password) return { ok: false as const, error: "That password doesn't match." };
    // Official roles need an official account; self-registered users are citizens.
    if (role !== u.role && role !== "citizen") return { ok: false as const, error: `This account is registered as ${u.role}. Pick that role.` };
    save({ name: u.name, email: e, role: u.role, since: Date.now() });
    return { ok: true as const };
  }, []);

  const register = useCallback((u: StoredUser) => {
    const e = u.email.trim().toLowerCase();
    if (ROLES.some((r) => r.demo.email === e) || readUsers().some((x) => x.email === e)) return { ok: false as const, error: "An account with this email already exists." };
    const list = [...readUsers(), { ...u, email: e, role: "citizen" as Role }];
    try {
      localStorage.setItem(USERS, JSON.stringify(list));
    } catch {
      /* ignore */
    }
    save({ name: u.name, email: e, role: "citizen", since: Date.now() });
    return { ok: true as const };
  }, []);

  const logout = useCallback(() => save(null), []);

  const value = useMemo(() => ({ user, ready, login, register, logout }), [user, ready, login, register, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
