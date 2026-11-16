// Generates a terminal-style stats card: node scripts/stats.mjs <user> <out.svg>
// Needs GITHUB_TOKEN. No dependencies (Node 18+).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [user = "housesaroma", out = "dist/stats.svg"] = process.argv.slice(2);

const query = `query($login: String!) {
  user(login: $login) {
    followers { totalCount }
    repositories(ownerAffiliations: OWNER, isFork: false, first: 100, privacy: PUBLIC) {
      totalCount
      nodes { stargazerCount languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } } }
    }
    contributionsCollection {
      totalCommitContributions totalPullRequestContributions totalIssueContributions
      contributionCalendar { totalContributions weeks { contributionDays { contributionCount date } } }
    }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${process.env.GITHUB_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query, variables: { login: user } }),
});
const json = await res.json();
if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
const u = json.data.user;
const cc = u.contributionsCollection;

// streaks
const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
let longest = 0, run = 0;
for (const d of days) { run = d.contributionCount ? run + 1 : 0; longest = Math.max(longest, run); }
let current = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (days[i].contributionCount) current++;
  else if (i === days.length - 1) continue; // today may be empty yet
  else break;
}

// languages by bytes across public repos
const langs = new Map();
for (const r of u.repositories.nodes)
  for (const e of r.languages.edges) {
    const l = langs.get(e.node.name) ?? { size: 0, color: e.node.color ?? "#8b949e" };
    l.size += e.size;
    langs.set(e.node.name, l);
  }
const top = [...langs].sort((a, b) => b[1].size - a[1].size).slice(0, 6);
const total = top.reduce((s, [, l]) => s + l.size, 0) || 1;
const stars = u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const rows = [
  ["contributions (year)", cc.contributionCalendar.totalContributions],
  ["commits", cc.totalCommitContributions],
  ["pull requests", cc.totalPullRequestContributions],
  ["issues", cc.totalIssueContributions],
  ["current streak", `${current} d`],
  ["longest streak", `${longest} d`],
  ["public repos", u.repositories.totalCount],
  ["stars", stars],
];

const rowSvg = rows.map(([k, v], i) => {
  const y = 96 + i * 26;
  return `<text x="32" y="${y}" class="d">${k}</text><text x="230" y="${y}" class="dot">${".".repeat(14)}</text><text x="400" y="${y}" class="v" text-anchor="end">${esc(v)}</text>`;
}).join("\n  ");

let x = 460;
const barW = 368;
const bar = top.map(([, l]) => {
  const w = (l.size / total) * barW;
  const r = `<rect x="${x.toFixed(1)}" y="80" width="${w.toFixed(1)}" height="10" fill="${l.color}"/>`;
  x += w;
  return r;
}).join("");
const legend = top.map(([name, l], i) => {
  const y = 124 + i * 26;
  return `<circle cx="466" cy="${y - 5}" r="5" fill="${l.color}"/><text x="482" y="${y}" class="t">${esc(name)}</text><text x="828" y="${y}" class="d" text-anchor="end">${((l.size / total) * 100).toFixed(1)}%</text>`;
}).join("\n  ");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="860" height="320" viewBox="0 0 860 320" role="img" aria-label="GitHub stats for ${esc(user)}">
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace; font-size: 15px; }
    .p { fill: #39d353; } .t { fill: #e6edf3; } .d { fill: #8b949e; } .v { fill: #39d353; font-weight: 700; } .dot { fill: #30363d; }
    .row { opacity: 0; animation: show .4s forwards; }
    @keyframes show { to { opacity: 1; } }
  </style>
  <rect x="0.5" y="0.5" width="859" height="319" rx="12" fill="#0d1117" stroke="#30363d"/>
  <path d="M0.5 40 H859.5" stroke="#30363d"/>
  <circle cx="24" cy="20" r="6" fill="#ff5f57"/><circle cx="44" cy="20" r="6" fill="#febc2e"/><circle cx="64" cy="20" r="6" fill="#28c840"/>
  <text x="430" y="25" text-anchor="middle" class="d" style="font-size:13px">gh stats ${esc(user)}</text>
  <text x="32" y="68" class="p">$ gh stats --year</text>
  <text x="460" y="68" class="p">$ gh langs --top ${top.length}</text>
  <path d="M430 56 V300" stroke="#21262d"/>
  <g class="row">
  ${rowSvg}
  </g>
  <g class="row" style="animation-delay:.3s">
  <rect x="460" y="80" width="${barW}" height="10" rx="5" fill="#21262d"/>${bar}
  ${legend}
  </g>
  <text x="828" y="306" class="dot" text-anchor="end" style="font-size:11px">updated ${new Date().toISOString().slice(0, 10)}</text>
</svg>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);
console.log(`wrote ${out}: ${rows.map(([k, v]) => `${k}=${v}`).join(", ")}`);
