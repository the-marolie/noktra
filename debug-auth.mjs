import { chromium } from "playwright";
import readline from "node:readline/promises";

const [loginUrl, testUrl] = process.argv.slice(2);

// Step 1: visible login, then capture state
const headed = await chromium.launch({ headless: false });
const ctx1 = await headed.newContext();
const page1 = await ctx1.newPage();
await page1.goto(loginUrl);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question("Log in, wait for the dashboard, then press Enter... ");
rl.close();
for (const p of ctx1.pages()) console.log("Open tab:", p.url());
console.log("Headed localStorage:", await page1.evaluate(() => Object.keys(localStorage)));
console.log("Headed sessionStorage:", await page1.evaluate(() => Object.keys(sessionStorage)));
console.log("Context cookies:", (await ctx1.cookies()).map((c) => c.domain + " " + c.name));
const state = await ctx1.storageState();
console.log("\nCaptured cookies:", state.cookies.length);
for (const o of state.origins) console.log("Captured localStorage for", o.origin, "->", o.localStorage.map((e) => e.name));
await headed.close();

// Step 2: headless with that state, visit the test URL and report
const headless = await chromium.launch({ headless: true });
const ctx2 = await headless.newContext({ storageState: state });
const page2 = await ctx2.newPage();
page2.on("response", (r) => { if (r.status() === 401 || r.status() === 403) console.log("API rejected:", r.status(), r.url()); });
await page2.goto(testUrl, { waitUntil: "load" });
await page2.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => { });
console.log("\nHeadless ended on:", page2.url());
console.log("Headless localStorage keys:", await page2.evaluate(() => Object.keys(localStorage)));
await headless.close();