import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

const COST = 12;

export function hashPassword(password: string) {
  return bcrypt.hash(password, COST);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

// Compared against when the email is unknown so login timing doesn't reveal
// which emails exist.
export const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", COST);

// No look-alike characters (0/O, 1/l/I) since these get read and pasted by hand.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const ALL = UPPER + LOWER + DIGITS;

export function generateTempPassword(length = 16) {
  for (;;) {
    let out = "";
    for (let i = 0; i < length; i++) out += ALL[randomInt(ALL.length)];
    if (/[A-Z]/.test(out) && /[a-z]/.test(out) && /[2-9]/.test(out)) return out;
  }
}
