import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { getGoogleUserFromRequest } from "./googleAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  try {
    user = await getGoogleUserFromRequest(opts.req);
  } catch (error) {
    console.error("[Auth] Failed to read Google session", error);
  }
  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
