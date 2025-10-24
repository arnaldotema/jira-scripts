import 'dotenv/config';
import { table } from 'table';

const OWNER = 'CloudTalk-io';
const TOKEN = process.env.GITHUB_TOKEN;
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
};

const fetchJSON = async (url) => {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed: ${res.status} ${res.statusText}\n${body}`);
  }
  return res.json();
};

const fetchAllRepos = async () => {
  const repos = [];
  let page = 1;
  while (true) {
    const batch = await fetchJSON(
      `https://api.github.com/orgs/${OWNER}/repos?per_page=100&page=${page}`
    );
    if (batch.length === 0) break;
    repos.push(...batch);
    page++;
  }
  return repos;
};

const fetchMergedPRs = async (repo, since) => {
  const prs = [];
  let page = 1;
  while (true) {
    const batch = await fetchJSON(
      `https://api.github.com/repos/${OWNER}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`
    );
    if (batch.length === 0) break;

    const filtered = batch.filter(pr => {
      if (!pr.merged_at) return false;
      const merged = new Date(pr.merged_at);
      return merged >= since;
    });

    prs.push(...filtered);
    
    // If the oldest PR in the batch is before our since date, we can stop
    if (batch[batch.length - 1].updated_at < since.toISOString()) break;
    page++;
  }
  return prs;
};

const run = async () => {
  const days = parseInt(process.argv[2]) || 7;
  const since = new Date();
  since.setDate(since.getDate() - days);

  console.log(`Analyzing PRs merged in the last ${days} days...`);
  
  const repos = await fetchAllRepos();
  const engineerStats = new Map();

  for (const repo of repos) {
    console.log(`Fetching PRs for ${repo.name}...`);
    const prs = await fetchMergedPRs(repo.name, since);

    for (const pr of prs) {
      const author = pr.user.login;
      if (!engineerStats.has(author)) {
        engineerStats.set(author, {
          totalPRs: 0,
          prs: []
        });
      }

      const stats = engineerStats.get(author);
      stats.totalPRs++;
      stats.prs.push({
        repo: repo.name,
        number: pr.number,
        title: pr.title
      });
    }
  }

  // Convert to array and sort by total PRs
  const sortedStats = Array.from(engineerStats.entries())
    .map(([engineer, stats]) => ({
      engineer,
      totalPRs: stats.totalPRs,
      avgPerDay: stats.totalPRs / days,
      prs: stats.prs
    }))
    .sort((a, b) => b.totalPRs - a.totalPRs);

  // Prepare table data
  const tableData = [
    ['Engineer', 'Total PRs', 'Avg/Day', 'PRs']
  ];

  for (const stat of sortedStats) {
    const prList = stat.prs
      .map(pr => `${pr.repo}#${pr.number} - ${pr.title}`)
      .join(', ');
    
    tableData.push([
      stat.engineer,
      stat.totalPRs.toString(),
      stat.avgPerDay.toFixed(2),
      prList
    ]);
  }

  console.log('\n' + table(tableData, {
    columns: [
      { width: 20 },
      { width: 10 },
      { width: 10 },
      { width: 100 }
    ]
  }));
};

run().catch(console.error); 