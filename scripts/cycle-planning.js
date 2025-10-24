const axios = require('axios');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// --- Config ---
require('dotenv').config();

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Initialize Anthropic client
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

// Team sizes for sprint capacity calculation
const TEAM_SIZES = {
  'Dashboard': 6,
  'Back Office + Internal Tools': 4
};

// Team velocities (story points per sprint)
const SCRUM_BOARDS = {
  'Dashboard': 56,
  'Back Office + Internal Tools': 100
};

// --- Config Loading Functions ---

function loadConfig() {
  try {
    const configPath = path.join(__dirname, '..', 'config', 'teams.yaml');
    const fileContents = fs.readFileSync(configPath, 'utf8');
    return yaml.load(fileContents);
  } catch (error) {
    console.error('[ERROR] Failed to load config file:', error.message);
    return null;
  }
}

// Create auth header
const getAuthHeader = () => ({
  Authorization: `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`,
  Accept: 'application/json'
});

/**
 * Parse command line arguments
 * Usage: node cycle-planning.js q4c2 dashboard
 */
function parseArguments() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: node cycle-planning.js <cycle> <team>');
    console.log('');
    console.log('Examples:');
    console.log('  node cycle-planning.js q4c2 dashboard');
    console.log('  node cycle-planning.js q126c1 "back office + internal tools"');
    console.log('');
    console.log('Available teams:');
    console.log('  - Dashboard');
    console.log('  - Back Office + Internal Tools');
    process.exit(1);
  }

  const cycle = formatCycle(args[0]);
  const teamInput = args.slice(1).join(' ');
  const team = normalizeTeamName(teamInput);

  return { cycle, team };
}

/**
 * Format cycle input to Jira format
 * q4c2 -> 25'Q4.C2
 * q126c1 -> 26'Q1.C1
 */
function formatCycle(input) {
  const cleaned = input.toLowerCase().replace(/[^q0-9c]/g, '');

  // Handle formats like q4c2, q425c2, q126c1, etc.
  const match = cleaned.match(/q(\d)(?:(\d{2}))?c(\d)/);
  if (match) {
    const [, quarter, year, cycle] = match;
    const yearPart = year || '25'; // Default to 25 if not provided
    // Jira format is: Year'Quarter.Cycle (e.g., 26'Q1.C1)
    return `${yearPart}'Q${quarter}.C${cycle}`;
  }

  return input;
}

/**
 * Normalize team name input
 */
function normalizeTeamName(input) {
  const lower = input.toLowerCase().trim();

  if (lower === 'dashboard' || lower === 'dsh') {
    return 'Dashboard';
  }

  if (lower === 'back office + internal tools' ||
      lower === 'back office' ||
      lower === 'bit') {
    return 'Back Office + Internal Tools';
  }

  // Return capitalized version if exact match not found
  return input.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Fetch JPDs by cycle and team
 */
async function fetchJPDsByCycleAndTeam(cycle, team) {
  console.log(`\nFetching JPDs for cycle: ${cycle}, team: ${team}`);

  try {
    // Build JQL query to find JPDs with matching cycle
    // Filter by team in code since Lead Team queries can be tricky
    const jql = `issuetype = "Idea" AND (customfield_10620 in ("${cycle}") OR customfield_10621 in ("${cycle}")) ORDER BY rank ASC`;

    console.log(`JQL Query: ${jql}`);

    const url = `${JIRA_BASE_URL}/rest/api/3/search/jql`;
    const requestBody = {
      jql: jql,
      fields: [
        'summary',
        'description',
        'customfield_10124',  // Story Points
        'customfield_11155',  // Discovery Ballpark
        'issuelinks',
        'project',
        'customfield_10596',  // Lead Team
        'issuetype',
        'customfield_10620',  // Committed In
        'customfield_10621'   // Roadmap Cycle
      ],
      maxResults: 100
    };

    const response = await axios.post(url, requestBody, {
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'application/json'
      }
    });

    const allJPDs = response.data.issues || [];

    // Filter by team
    const jpds = allJPDs.filter(jpd => {
      const leadTeam = jpd.fields.customfield_10596?.value || 'Unknown';
      return leadTeam === team;
    });

    console.log(`Found ${jpds.length} JPDs for ${team} team (${allJPDs.length} total)\n`);

    return jpds;

  } catch (error) {
    console.error('[ERROR] Failed to fetch JPDs:', error.response?.data || error.message);
    return [];
  }
}

/**
 * Get linked epics from a JPD
 */
function getLinkedEpics(jpd) {
  const linkedEpics = [];

  if (jpd.fields.issuelinks) {
    for (const link of jpd.fields.issuelinks) {
      // Check for inward links
      if (link.inwardIssue && link.type.name === 'Polaris work item link') {
        linkedEpics.push(link.inwardIssue.key);
      }
      // Check for outward links
      if (link.outwardIssue && link.type.name === 'Polaris work item link') {
        linkedEpics.push(link.outwardIssue.key);
      }
    }
  }

  return linkedEpics;
}

/**
 * Get child user stories of an epic
 */
async function getEpicUserStories(epicKey) {
  const jqlOptions = [
    `"Epic Link" = ${epicKey}`,
    `parent = ${epicKey}`
  ];

  for (const jql of jqlOptions) {
    try {
      const url = `${JIRA_BASE_URL}/rest/api/3/search/jql`;
      const response = await axios.post(url, {
        jql,
        fields: ['summary', 'description', 'issuetype', 'customfield_10124'],
        expand: ['renderedFields'],
        maxResults: 100
      }, {
        headers: {
          ...getAuthHeader(),
          'Content-Type': 'application/json'
        }
      });

      if (response.data.issues && response.data.issues.length > 0) {
        return response.data.issues;
      }
    } catch (error) {
      continue;
    }
  }

  // Try Agile API
  try {
    const url = `${JIRA_BASE_URL}/rest/agile/1.0/epic/${epicKey}/issue`;
    const response = await axios.get(url, {
      params: {
        fields: 'summary,description,issuetype,customfield_10124',
        expand: 'renderedFields',
        maxResults: 100
      },
      headers: getAuthHeader()
    });

    if (response.data.issues && response.data.issues.length > 0) {
      return response.data.issues;
    }
  } catch (error) {
    // Ignore
  }

  return [];
}

/**
 * Fetch comments for a user story
 */
async function fetchUserStoryComments(issueKey) {
  try {
    const url = `${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}/comment`;
    const response = await axios.get(url, {
      headers: getAuthHeader()
    });

    return response.data.comments || [];
  } catch (error) {
    console.error(`[WARN] Failed to fetch comments for ${issueKey}:`, error.message);
    return [];
  }
}

/**
 * Check if text contains technical/ED content
 */
function isTechnicalContent(text) {
  if (!text) return false;

  const technicalKeywords = [
    'TBD', 'TODO', 'rough estimate', 'SP:', 'story points',
    'BE:', 'FE:', 'backend', 'frontend', 'API', 'endpoint',
    'database', 'mongodb', 'redis', 'postgresql', 'mysql',
    'service', 'microservice', 'implementation', 'architecture',
    'schema', 'validation', 'query', 'index',
    'test', 'unit test', 'e2e test', 'integration test',
    'dependency', 'dependencies', 'blocker', 'blocked by',
    'technical', 'performance', 'scalability', 'security',
    'migration', 'refactor', 'optimization'
  ];

  const lowerText = text.toLowerCase();
  return technicalKeywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

/**
 * Extract ED (Engineering Discovery) sections from text
 * Looks for explicit ED markers OR technical content
 */
function extractEDSections(text, issueKey = '') {
  if (!text) return null;

  const edSections = {
    technicalComplexity: '',
    dependencies: '',
    rawContent: '',
    hasExplicitED: false
  };

  // Convert Atlassian Document Format to plain text if needed
  let plainText = text;
  if (typeof text === 'object' && text.type === 'doc') {
    plainText = convertADFToText(text);
  }

  // Look for explicit ED section markers
  const edPatterns = [
    /## ED\s*\n([\s\S]*?)(?=\n##|\n---|\Z)/i,
    /## Engineering Discovery\s*\n([\s\S]*?)(?=\n##|\n---|\Z)/i,
    /\*\*ED\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n---|\Z)/i,
    /Engineering Discovery:?\s*\n([\s\S]*?)(?=\n##|\n\*\*|\n---|\Z)/i,
    /ED Section:?\s*\n([\s\S]*?)(?=\n##|\n\*\*|\n---|\Z)/i,
    /\bED\b.*?:([\s\S]*?)(?=\n\n|\Z)/i
  ];

  for (const pattern of edPatterns) {
    const match = plainText.match(pattern);
    if (match) {
      edSections.rawContent = match[1].trim();
      edSections.hasExplicitED = true;
      break;
    }
  }

  // If no explicit ED marker found, check if content is technical
  if (!edSections.rawContent && isTechnicalContent(plainText)) {
    // Extract meaningful content (skip very short descriptions)
    if (plainText.length > 50) {
      edSections.rawContent = plainText;
      edSections.hasExplicitED = false;
    }
  }

  if (!edSections.rawContent) {
    return null;
  }

  // Extract dependencies
  const dependenciesPatterns = [
    /(?:Dependencies|Dependency|Depends on|Blocked by|Blockers):?\s*\n([\s\S]*?)(?=\n(?:Technical|Implementation|Test|BE:|FE:|\n\n)|\Z)/gi,
    /blocker[s]?:?\s*([^\n]+)/gi
  ];

  for (const pattern of dependenciesPatterns) {
    const matches = [...plainText.matchAll(pattern)];
    for (const match of matches) {
      if (match[1] && match[1].trim()) {
        edSections.dependencies += (edSections.dependencies ? '\n' : '') + match[1].trim();
      }
    }
  }

  // Extract technical complexity sections
  const techPatterns = [
    /(?:BE|Backend):?\s*(?:\(rough estimate[^\)]*\):?)?\s*\n([\s\S]*?)(?=\n(?:FE|Frontend|Dependencies|Test)|\Z)/i,
    /(?:FE|Frontend):?\s*(?:\(rough estimate[^\)]*\):?)?\s*\n([\s\S]*?)(?=\n(?:BE|Backend|Dependencies|Test)|\Z)/i,
    /(?:Technical|Implementation|Architecture):?\s*\n([\s\S]*?)(?=\n(?:Dependencies|Test)|\Z)/i
  ];

  for (const pattern of techPatterns) {
    const match = plainText.match(pattern);
    if (match && match[1] && match[1].trim()) {
      edSections.technicalComplexity += (edSections.technicalComplexity ? '\n\n' : '') + match[1].trim();
    }
  }

  // If no specific sections found, use raw content as technical complexity
  if (!edSections.technicalComplexity && !edSections.dependencies) {
    edSections.technicalComplexity = edSections.rawContent;
  }

  return edSections;
}

/**
 * Convert Atlassian Document Format (ADF) to plain text
 */
function convertADFToText(adf) {
  if (!adf || !adf.content) return '';

  let text = '';

  function processNode(node) {
    if (!node) return '';

    if (node.type === 'text') {
      return node.text || '';
    }

    if (node.type === 'paragraph') {
      const content = node.content ? node.content.map(processNode).join('') : '';
      return content + '\n';
    }

    if (node.type === 'heading') {
      const level = node.attrs?.level || 1;
      const content = node.content ? node.content.map(processNode).join('') : '';
      return '#'.repeat(level) + ' ' + content + '\n';
    }

    if (node.type === 'bulletList' || node.type === 'orderedList') {
      return node.content ? node.content.map(processNode).join('') : '';
    }

    if (node.type === 'listItem') {
      const content = node.content ? node.content.map(processNode).join('') : '';
      return '- ' + content;
    }

    if (node.content && Array.isArray(node.content)) {
      return node.content.map(processNode).join('');
    }

    return '';
  }

  for (const node of adf.content) {
    text += processNode(node);
  }

  return text;
}

/**
 * Recursively get all child issues (stories, subtasks, etc.)
 */
async function getAllChildIssues(parentKey, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return [];

  const allChildren = [];

  try {
    // Try to get direct children via JQL
    const jql = `parent = ${parentKey}`;
    const url = `${JIRA_BASE_URL}/rest/api/3/search/jql`;

    const response = await axios.post(url, {
      jql,
      fields: ['summary', 'description', 'issuetype', 'customfield_10124', 'subtasks'],
      expand: ['renderedFields'],
      maxResults: 100
    }, {
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'application/json'
      }
    });

    const children = response.data.issues || [];

    for (const child of children) {
      allChildren.push(child);

      // Recursively get children of this child
      const grandchildren = await getAllChildIssues(child.key, depth + 1, maxDepth);
      allChildren.push(...grandchildren);
    }
  } catch (error) {
    // Silently continue if we can't get children
  }

  return allChildren;
}

/**
 * Gather ED information from all user stories under a JPD's epics
 */
async function gatherEDInformation(jpd) {
  const linkedEpics = getLinkedEpics(jpd);
  const edData = {
    technicalComplexity: [],
    dependencies: []
  };

  console.log(`  Analyzing ${linkedEpics.length} linked delivery items...`);

  for (const epicKey of linkedEpics) {
    // Get direct children from epic
    const directChildren = await getEpicUserStories(epicKey);

    // Get all children recursively
    const allChildren = [];
    allChildren.push(...directChildren);

    for (const child of directChildren) {
      const grandchildren = await getAllChildIssues(child.key);
      allChildren.push(...grandchildren);
    }

    console.log(`    ${epicKey}: Found ${allChildren.length} total child items`);

    for (const story of allChildren) {
      // Check story description
      const description = story.fields.description || story.renderedFields?.description;
      const edFromDescription = extractEDSections(description, story.key);

      if (edFromDescription) {
        if (edFromDescription.technicalComplexity) {
          const source = `${story.key}: ${story.fields.summary}`;
          edData.technicalComplexity.push({
            source: source,
            content: edFromDescription.technicalComplexity,
            issueType: story.fields.issuetype.name
          });
          console.log(`      ✓ Found technical details in ${story.key}`);
        }
        if (edFromDescription.dependencies) {
          const source = `${story.key}: ${story.fields.summary}`;
          edData.dependencies.push({
            source: source,
            content: edFromDescription.dependencies,
            issueType: story.fields.issuetype.name
          });
          console.log(`      ✓ Found dependencies in ${story.key}`);
        }
      }

      // Check story comments
      const comments = await fetchUserStoryComments(story.key);
      for (const comment of comments) {
        const commentBody = comment.body;
        const edFromComment = extractEDSections(commentBody, story.key);

        if (edFromComment) {
          if (edFromComment.technicalComplexity) {
            edData.technicalComplexity.push({
              source: `${story.key} (comment by ${comment.author?.displayName || 'Unknown'})`,
              content: edFromComment.technicalComplexity,
              issueType: story.fields.issuetype.name
            });
            console.log(`      ✓ Found technical details in ${story.key} comment`);
          }
          if (edFromComment.dependencies) {
            edData.dependencies.push({
              source: `${story.key} (comment by ${comment.author?.displayName || 'Unknown'})`,
              content: edFromComment.dependencies,
              issueType: story.fields.issuetype.name
            });
            console.log(`      ✓ Found dependencies in ${story.key} comment`);
          }
        }
      }
    }
  }

  return edData;
}

/**
 * Calculate story points for a JPD
 */
async function calculateJPDStoryPoints(jpd) {
  const linkedEpics = getLinkedEpics(jpd);
  let totalPoints = 0;

  for (const epicKey of linkedEpics) {
    const userStories = await getEpicUserStories(epicKey);

    for (const story of userStories) {
      const points = story.fields.customfield_10124 || 0;
      totalPoints += points;
    }
  }

  return totalPoints;
}

/**
 * Get team velocity
 */
async function getTeamVelocity(teamName) {
  const boardId = SCRUM_BOARDS[teamName];
  if (!boardId) {
    return 20; // Default velocity
  }

  try {
    const url = `${JIRA_BASE_URL}/rest/greenhopper/1.0/rapid/charts/velocity`;
    const params = {
      rapidViewId: boardId
    };

    const response = await axios.get(url, {
      params,
      headers: getAuthHeader()
    });

    const velocityData = response.data.velocityStatEntries;

    if (!velocityData || Object.keys(velocityData).length === 0) {
      return 20;
    }

    // Get the last 3 sprints and calculate average
    const sprintEntries = Object.values(velocityData).slice(-3);

    if (sprintEntries.length > 0) {
      const totalCompleted = sprintEntries.reduce((sum, sprint) =>
        sum + (sprint.completed?.value || 0), 0);
      const avgVelocity = totalCompleted / sprintEntries.length;

      return Math.max(avgVelocity, 1);
    }

    return 20;
  } catch (error) {
    return 20;
  }
}

/**
 * Generate AI summary of technical complexity from ED data
 */
async function generateTechnicalSummary(jpdKey, jpdSummary, edData) {
  if (!anthropic) {
    console.log(`    ⚠ Anthropic API key not configured, skipping AI summary`);
    return null;
  }

  if (edData.technicalComplexity.length === 0) {
    return null;
  }

  try {
    // Prepare technical content for Claude
    let technicalContent = `JPD: ${jpdKey} - ${jpdSummary}\n\n`;
    technicalContent += `Technical details from child items:\n\n`;

    edData.technicalComplexity.forEach((item, index) => {
      technicalContent += `\n--- Item ${index + 1}: ${item.source} (${item.issueType}) ---\n`;
      technicalContent += item.content + '\n';
    });

    const prompt = `You are analyzing a software project's JPD (Jira Product Discovery) item and its technical implementation details.

Below are technical details extracted from various user stories, bugs, and tasks that are part of this JPD. Please create a concise, non-technical summary that explains:

1. What technical changes or implementations are required
2. Which services or components are affected
3. What makes this work complex (if anything)
4. Any notable technical challenges or considerations

Write this for a non-technical audience (product managers, stakeholders) who want to understand the engineering effort and complexity.

Keep it to 2-4 paragraphs maximum. Reference specific ticket numbers when mentioning implementation details.

${technicalContent}

Please provide a clear, concise summary:`;

    console.log(`    🤖 Generating AI summary for ${jpdKey}...`);

    const message = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const summary = message.content[0].text;
    console.log(`    ✓ AI summary generated`);
    return summary;

  } catch (error) {
    console.error(`    ✗ Failed to generate AI summary:`, error.message);
    return null;
  }
}

/**
 * Calculate release ETA based on JPD order and velocity
 */
function calculateReleaseETA(jpdIndex, totalJPDs, storyPoints, velocity, cycleStartDate) {
  const sprintsNeeded = Math.ceil(storyPoints / velocity);

  // Calculate cumulative sprints for all previous JPDs
  // This is simplified - in reality you'd want to calculate based on actual previous JPDs
  const cumulativeSprints = jpdIndex * 2; // Rough estimate

  const totalSprints = cumulativeSprints + sprintsNeeded;

  // Each sprint is 2 weeks
  const weeksFromStart = totalSprints * 2;

  const etaDate = new Date(cycleStartDate);
  etaDate.setDate(etaDate.getDate() + (weeksFromStart * 7));

  return {
    sprint: totalSprints,
    date: etaDate.toISOString().split('T')[0],
    sprintsNeeded
  };
}

/**
 * Generate markdown file for a JPD
 */
function generateJPDMarkdown(jpd, jpdIndex, totalJPDs, edData, storyPoints, discoveryBallpark, releaseETA, team, aiSummary) {
  const jpdKey = jpd.key;
  const jpdSummary = jpd.fields.summary;
  const jpdUrl = `${JIRA_BASE_URL}/browse/${jpdKey}`;

  // Get description for summary
  const description = jpd.fields.description || jpd.renderedFields?.description || '';
  const descriptionText = typeof description === 'object' ? convertADFToText(description) : description;
  const summaryText = descriptionText.substring(0, 500) + (descriptionText.length > 500 ? '...' : '');

  let markdown = `# ${jpdSummary}\n\n`;
  markdown += `**JPD ID:** [${jpdKey}](${jpdUrl})\n\n`;
  markdown += `---\n\n`;

  // Summary section
  markdown += `## Summary\n\n`;
  markdown += `${summaryText || 'No summary available.'}\n\n`;

  // Effort section
  markdown += `## Effort\n\n`;
  markdown += `**Story Points:** ${storyPoints}\n\n`;
  markdown += `**Estimated Sprints:** ${releaseETA.sprintsNeeded}\n\n`;

  // Discovery Ballpark
  markdown += `## Discovery Ballpark\n\n`;
  markdown += `${discoveryBallpark || 'Not specified'}\n\n`;

  // Release ETA
  markdown += `## Release ETA\n\n`;
  markdown += `**Target Sprint:** Sprint ${releaseETA.sprint}\n\n`;
  markdown += `**Estimated Date:** ${releaseETA.date}\n\n`;
  markdown += `*(Based on JPD position ${jpdIndex + 1} of ${totalJPDs} in cycle)*\n\n`;

  // Technical Complexity
  markdown += `## Technical Complexity\n\n`;
  if (aiSummary) {
    markdown += `${aiSummary}\n\n`;

    // Add expandable section with raw details
    markdown += `<details>\n<summary>View detailed technical breakdown</summary>\n\n`;
    edData.technicalComplexity.forEach(item => {
      const issueUrl = `${JIRA_BASE_URL}/browse/${item.source.split(':')[0]}`;
      markdown += `### [${item.source}](${issueUrl})\n\n`;
      markdown += `**Type:** ${item.issueType}\n\n`;
      markdown += `${item.content}\n\n`;
      markdown += `---\n\n`;
    });
    markdown += `</details>\n\n`;
  } else if (edData.technicalComplexity.length > 0) {
    markdown += `*AI summary not available. Showing raw technical details below:*\n\n`;
    edData.technicalComplexity.forEach(item => {
      const issueUrl = `${JIRA_BASE_URL}/browse/${item.source.split(':')[0]}`;
      markdown += `### [${item.source}](${issueUrl})\n\n`;
      markdown += `**Type:** ${item.issueType}\n\n`;
      markdown += `${item.content}\n\n`;
      markdown += `---\n\n`;
    });
  } else {
    markdown += `*No technical complexity information found. This may indicate that Engineering Discovery is still in progress.*\n\n`;
  }

  // Dependencies
  markdown += `## Dependencies\n\n`;
  if (edData.dependencies.length > 0) {
    edData.dependencies.forEach(item => {
      const issueUrl = `${JIRA_BASE_URL}/browse/${item.source.split(':')[0]}`;
      markdown += `### [${item.source}](${issueUrl})\n\n`;
      markdown += `**Type:** ${item.issueType}\n\n`;
      markdown += `${item.content}\n\n`;
      markdown += `---\n\n`;
    });
  } else {
    markdown += `*No external dependencies identified yet.*\n\n`;
  }

  return markdown;
}

/**
 * Main function
 */
async function main() {
  const { cycle, team } = parseArguments();
  const config = loadConfig();

  console.log(`\n=== CYCLE PLANNING GENERATOR ===`);
  console.log(`Cycle: ${cycle}`);
  console.log(`Team: ${team}`);

  // Fetch JPDs
  const jpds = await fetchJPDsByCycleAndTeam(cycle, team);

  if (jpds.length === 0) {
    console.log('\nNo JPDs found for the specified cycle and team.');
    return;
  }

  // Get cycle start date from config
  // Convert from Jira format (26'Q1.C1) to config key format (q126c1)
  const cycleMatch = cycle.match(/(\d{2})'Q(\d)\.C(\d)/);
  const cycleKey = cycleMatch ? `q${cycleMatch[2]}${cycleMatch[1]}c${cycleMatch[3]}` : cycle.toLowerCase().replace(/['']/g, '').replace(/[.]/g, '');
  const cycleConfig = config?.quarters?.[cycleKey];
  const cycleStartDate = cycleConfig ? parseDateDDMMYYYY(cycleConfig.start) : new Date();

  // Get team velocity
  const velocity = await getTeamVelocity(team);
  console.log(`Team velocity: ${velocity.toFixed(1)} points/sprint\n`);

  // Create output directory
  const outputDir = path.join(__dirname, '..', 'output', 'cycle-planning', cycle.replace(/['']/g, '').replace(/\./g, '-'), team.toLowerCase().replace(/\s+/g, '-'));
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`Generating markdown files for ${jpds.length} JPDs...\n`);

  // Process each JPD
  for (let i = 0; i < jpds.length; i++) {
    const jpd = jpds[i];
    console.log(`\n[${i + 1}/${jpds.length}] Processing ${jpd.key}: ${jpd.fields.summary}`);

    // Gather ED information
    const edData = await gatherEDInformation(jpd);

    // Calculate story points
    const storyPoints = await calculateJPDStoryPoints(jpd);

    // Get discovery ballpark (it's a number field)
    const discoveryBallpark = jpd.fields.customfield_11155 || 'Not specified';

    // Generate AI summary of technical complexity
    const aiSummary = await generateTechnicalSummary(jpd.key, jpd.fields.summary, edData);

    // Calculate release ETA
    const releaseETA = calculateReleaseETA(i, jpds.length, storyPoints, velocity, cycleStartDate);

    // Generate markdown
    const markdown = generateJPDMarkdown(jpd, i, jpds.length, edData, storyPoints, discoveryBallpark, releaseETA, team, aiSummary);

    // Write to file
    const filename = `${jpd.key}-${jpd.fields.summary.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '-').substring(0, 50)}.md`;
    const filepath = path.join(outputDir, filename);
    fs.writeFileSync(filepath, markdown);

    console.log(`  ✓ Generated: ${filename}`);
  }

  console.log(`\n✅ Done! Generated ${jpds.length} markdown files in:`);
  console.log(`   ${outputDir}\n`);
}

/**
 * Parse date in DD-MM-YYYY format
 */
function parseDateDDMMYYYY(dateStr) {
  const [day, month, year] = dateStr.split('-');
  return new Date(year, month - 1, day);
}

// Run main function
main().catch(error => {
  console.error('[FATAL] Script failed:', error);
  process.exit(1);
});
