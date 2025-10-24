import 'dotenv/config';

const OWNER = 'CloudTalk-io';
const REPO = 'dashboard-frontend-monorepo';
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

const fetchAllPRs = async () => {
  const prs = [];
  let page = 1;
  while (true) {
    const batch = await fetchJSON(
      `https://api.github.com/repos/${OWNER}/${REPO}/pulls?state=closed&per_page=100&page=${page}`
    );
    if (batch.length === 0) break;

    const filtered = batch.filter(pr => {
      const closed = pr.closed_at && new Date(pr.closed_at);
      return closed && closed.getFullYear() === 2025;
    });

    prs.push(...filtered);
    page++;
  }
  return prs;
};

const fetchFirstReview = async (prNumber) => {
  const reviews = await fetchJSON(
    `https://api.github.com/repos/${OWNER}/${REPO}/pulls/${prNumber}/reviews`
  );
  if (!reviews.length) return null;
  const first = reviews.reduce((a, b) =>
    new Date(a.submitted_at) < new Date(b.submitted_at) ? a : b
  );
  return first.submitted_at;
};

const run = async () => {
  console.log('Fetching PRs closed in 2025...');
  const prs = await fetchAllPRs();

  const deltas = [];

  for (const pr of prs) {
    const { number, created_at, title } = pr;
    const firstReviewAt = await fetchFirstReview(number);
    if (!firstReviewAt) continue;

    const created = new Date(created_at);
    const reviewed = new Date(firstReviewAt);
    const diffMs = reviewed - created;
    const diffHrs = diffMs / 1000 / 60 / 60;

    // Skip outliers > 24h
    if (diffHrs > 24) continue;

    deltas.push(diffHrs);
    const prUrl = `https://github.com/${OWNER}/${REPO}/pull/${number}`;
    console.log(`${prUrl} - "${title}" - First review in ${diffHrs.toFixed(2)}h`);
  }

  if (!deltas.length) {
    console.log('\n❌ No reviewed PRs within 24h found.');
    return;
  }

  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  console.log(`\n✅ Avg time to first review (under 24h): ${avg.toFixed(2)} hours (${deltas.length} PRs)`);
};

run().catch(console.error);