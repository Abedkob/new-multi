/** Shared helpers for the real-browser checks (system Chrome via playwright-core). */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { prisma } from "../../lib/prisma";
import { createStoreWithOwner } from "../../lib/data/tenants";
import { generateTempPassword, hashPassword } from "../../lib/passwords";

export const BASE = process.env.BASE_URL ?? "http://localhost:3000";

export async function launch() {
  const browser: Browser = await chromium.launch({ channel: "chrome", headless: true });
  const context: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return { browser, context };
}

export async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click('button:has-text("Sign in")')]);
}

/** A throwaway store + owner (already past the forced password change). */
export async function makeStore(label: string) {
  const run = Date.now().toString(36);
  const password = generateTempPassword();
  const { tenant, user } = await createStoreWithOwner({
    storeName: `${label} ${run}`,
    ownerName: label,
    ownerEmail: `e2e-${label.toLowerCase().replace(/\W+/g, "")}-${run}@example.test`,
    passwordHash: await hashPassword(password),
  });
  await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: false } });
  return {
    tenant,
    user,
    password,
    async remove() {
      await prisma.tenant.deleteMany({ where: { id: tenant.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    },
  };
}
