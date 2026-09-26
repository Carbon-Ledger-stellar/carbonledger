import * as jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

export function signSecurityToken(publicKey: string, role: string): string {
  return jwt.sign({ sub: publicKey, type: "access", role }, SECRET, {
    expiresIn: "1h",
    issuer: "carbonledger",
  });
}

export function inferRoleFromPublicKey(publicKey: string): string {
  if (publicKey.includes("VERIFIER") || publicKey.includes("VERIF")) return "verifier";
  if (publicKey.includes("ADMIN")) return "admin";
  if (publicKey.includes("DEV")) return "project_developer";
  if (publicKey.includes("SELLER")) return "corporation";
  if (publicKey.includes("ATTACKER")) return "corporation";
  return "corporation";
}
