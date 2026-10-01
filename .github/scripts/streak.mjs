// Builds the contribution streak card (dark + light SVG) from the GitHub GraphQL
// contribution calendar. Runs on the built-in GITHUB_TOKEN; no dependencies.
// Usage: GITHUB_TOKEN=... GH_USER=DACDaniels node .github/scripts/streak.mjs <outDir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const token = process.env.GITHUB_TOKEN;
const user = process.env.GH_USER;
const outDir = process.argv[2] || "profile";
if (!token || !user) throw new Error("GITHUB_TOKEN and GH_USER are required");

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors || body));
  return body.data;
}

const DAY = 86400000;
const { user: profile } = await gql(`query($login:String!){ user(login:$login){ createdAt } }`, { login: user });

// The API caps each contributionsCollection window at one year, so walk year by year.
const counts = new Map();
const now = new Date();
for (let from = new Date(profile.createdAt); from < now; from = new Date(from.getTime() + 365 * DAY)) {
  const to = new Date(Math.min(from.getTime() + 365 * DAY - 1000, now.getTime()));
  const data = await gql(
    `query($login:String!,$from:DateTime!,$to:DateTime!){ user(login:$login){
       contributionsCollection(from:$from,to:$to){ contributionCalendar{ weeks{ contributionDays{ date contributionCount } } } } } }`,
    { login: user, from: from.toISOString(), to: to.toISOString() },
  );
  for (const week of data.user.contributionsCollection.contributionCalendar.weeks)
    for (const d of week.contributionDays) counts.set(d.date, d.contributionCount);
}

const days = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
const today = now.toISOString().slice(0, 10);
const upToToday = days.filter(([d]) => d <= today);
const total = upToToday.reduce((s, [, c]) => s + c, 0);
const firstDay = upToToday.find(([, c]) => c > 0)?.[0] ?? today;

// Longest streak over the whole history.
let longest = { len: 0, start: null, end: null };
let run = { len: 0, start: null };
for (const [d, c] of upToToday) {
  if (c > 0) {
    run = run.len ? { len: run.len + 1, start: run.start } : { len: 1, start: d };
    if (run.len > longest.len) longest = { len: run.len, start: run.start, end: d };
  } else run = { len: 0, start: null };
}

// Current streak: a day with no contributions yet today does not break it (GitHub's own convention).
let i = upToToday.length - 1;
if (i >= 0 && upToToday[i][0] === today && upToToday[i][1] === 0) i--;
let current = { len: 0, start: null, end: null };
for (; i >= 0 && upToToday[i][1] > 0; i--)
  current = { len: current.len + 1, start: upToToday[i][0], end: current.end ?? upToToday[i][0] };

const fmt = (d) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
const range = (s) => (s.len ? `${fmt(s.start)} – ${fmt(s.end)}` : "No active streak");

const themes = {
  dark: { bg: "#0d1117", text: "#e6edf3", muted: "#8b949e", accent: "#00e5c0", rule: "#30363d" },
  light: { bg: "#ffffff", text: "#1f2328", muted: "#57606a", accent: "#0e7c6b", rule: "#d0d7de" },
};

function card(t) {
  const col = (x, value, label, sub) => `
    <text x="${x}" y="78" text-anchor="middle" font-size="30" font-weight="700" fill="${t.accent}">${value}</text>
    <text x="${x}" y="112" text-anchor="middle" font-size="14" font-weight="600" fill="${t.text}">${label}</text>
    <text x="${x}" y="134" text-anchor="middle" font-size="11" fill="${t.muted}">${sub}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="165" viewBox="0 0 495 165" role="img" aria-label="Contribution streak for ${user}">
  <style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}</style>
  <rect width="495" height="165" rx="6" fill="${t.bg}"/>
  <line x1="165" y1="40" x2="165" y2="140" stroke="${t.rule}"/>
  <line x1="330" y1="40" x2="330" y2="140" stroke="${t.rule}"/>${col(82.5, total.toLocaleString("en-GB"), "Total contributions", `${fmt(firstDay)} – present`)}${col(247.5, current.len, "Current streak", range(current))}${col(412.5, longest.len, "Longest streak", range(longest))}
</svg>
`;
}

mkdirSync(outDir, { recursive: true });
for (const [name, t] of Object.entries(themes)) writeFileSync(join(outDir, `streak-${name}.svg`), card(t));
console.log(`total=${total} current=${current.len} longest=${longest.len}`);
