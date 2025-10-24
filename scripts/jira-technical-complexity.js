const axios = require('axios');

// --- Config ---
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

/**
 * Fetch a single Jira issue with all details including subtasks, links, and comments
 */
async function fetchIssue(issueKey) {
  const url = `${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}`;

  try {
    const res = await axios.get(url, {
      params: {
        fields: '*all',
        expand: 'changelog,renderedFields'
      },
      headers: {
        Authorization: `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`,
        Accept: 'application/json'
      }
    });

    return res.data;
  } catch (err) {
    console.error(`[ERROR] Failed to fetch ${issueKey}:`, err.response?.data?.errorMessages || err.message);
    throw err;
  }
}

/**
 * Extract key technical details from an issue
 */
function analyzeTechnicalComplexity(issue) {
  const fields = issue.fields;
  const renderedFields = issue.renderedFields || {};

  return {
    key: issue.key,
    url: `${JIRA_BASE_URL}/browse/${issue.key}`,
    summary: fields.summary,
    description: getPlainTextDescription(fields),
    renderedDescription: renderedFields.description || null,
    issueType: fields.issuetype?.name,
    status: fields.status?.name,
    priority: fields.priority?.name,
    storyPoints: fields.customfield_10124 || null,

    // Technical context
    components: fields.components?.map(c => c.name) || [],
    labels: fields.labels || [],

    // Relationships
    subtasks: fields.subtasks?.map(st => ({
      key: st.key,
      summary: st.fields.summary,
      status: st.fields.status?.name
    })) || [],

    issueLinks: fields.issuelinks?.map(link => ({
      type: link.type?.name,
      relationship: link.type?.inward || link.type?.outward,
      linkedIssue: link.inwardIssue || link.outwardIssue,
      key: (link.inwardIssue || link.outwardIssue)?.key,
      summary: (link.inwardIssue || link.outwardIssue)?.fields?.summary
    })) || [],

    // People involved
    assignee: fields.assignee?.displayName || 'Unassigned',
    reporter: fields.reporter?.displayName,

    // Timing
    created: fields.created,
    updated: fields.updated,
    resolved: fields.resolutiondate,

    // Technical details from description
    acceptanceCriteria: extractAcceptanceCriteria(fields),
    technicalNotes: extractTechnicalNotes(fields)
  };
}

/**
 * Try to extract acceptance criteria from description
 */
function extractAcceptanceCriteria(fields) {
  const desc = getPlainTextDescription(fields);
  if (!desc) return null;

  // Look for common AC patterns
  const acMatch = desc.match(/acceptance criteria:?\s*([\s\S]*?)(?=\n\n|\n#|$)/i);
  return acMatch ? acMatch[1].trim() : null;
}

/**
 * Try to extract technical notes
 */
function extractTechnicalNotes(fields) {
  const desc = getPlainTextDescription(fields);
  if (!desc) return null;

  const techMatch = desc.match(/technical notes?:?\s*([\s\S]*?)(?=\n\n|\n#|$)/i);
  return techMatch ? techMatch[1].trim() : null;
}

/**
 * Convert Jira ADF (Atlassian Document Format) to plain text
 */
function getPlainTextDescription(fields) {
  if (!fields.description) return '';

  // If it's already a string, return it
  if (typeof fields.description === 'string') {
    return fields.description;
  }

  // Handle ADF format
  if (fields.description.content) {
    return extractTextFromADF(fields.description.content);
  }

  return '';
}

function extractTextFromADF(content, depth = 0) {
  if (!content) return '';

  let text = '';
  for (const node of content) {
    if (node.type === 'text') {
      text += node.text;
    } else if (node.type === 'paragraph' || node.type === 'heading') {
      if (text && !text.endsWith('\n')) text += '\n';
      if (node.content) {
        text += extractTextFromADF(node.content, depth + 1);
      }
      text += '\n';
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      if (node.content) {
        text += extractTextFromADF(node.content, depth + 1);
      }
    } else if (node.type === 'listItem') {
      text += '• ';
      if (node.content) {
        text += extractTextFromADF(node.content, depth + 1);
      }
      text += '\n';
    } else if (node.content) {
      text += extractTextFromADF(node.content, depth + 1);
    }
  }

  return text;
}

/**
 * Analyze relationships between multiple issues
 */
function analyzeCorrelations(analyses) {
  const correlations = [];

  // Check for direct issue links between the analyzed issues
  for (let i = 0; i < analyses.length; i++) {
    for (let j = i + 1; j < analyses.length; j++) {
      const issue1 = analyses[i];
      const issue2 = analyses[j];

      // Check if they link to each other
      const link1to2 = issue1.issueLinks.find(link => link.key === issue2.key);
      const link2to1 = issue2.issueLinks.find(link => link.key === issue1.key);

      if (link1to2 || link2to1) {
        correlations.push({
          issues: [issue1.key, issue2.key],
          relationship: link1to2?.type || link2to1?.type,
          description: link1to2?.relationship || link2to1?.relationship
        });
      }

      // Check for shared components
      const sharedComponents = issue1.components.filter(c => issue2.components.includes(c));
      if (sharedComponents.length > 0) {
        correlations.push({
          issues: [issue1.key, issue2.key],
          relationship: 'shared-components',
          description: `Both affect: ${sharedComponents.join(', ')}`
        });
      }

      // Check for shared labels
      const sharedLabels = issue1.labels.filter(l => issue2.labels.includes(l));
      if (sharedLabels.length > 0) {
        correlations.push({
          issues: [issue1.key, issue2.key],
          relationship: 'shared-labels',
          description: `Both tagged: ${sharedLabels.join(', ')}`
        });
      }

      // Check if one has subtasks referencing the other
      const subtaskLink = issue1.subtasks.find(st => st.key === issue2.key) ||
                         issue2.subtasks.find(st => st.key === issue1.key);
      if (subtaskLink) {
        correlations.push({
          issues: [issue1.key, issue2.key],
          relationship: 'parent-subtask',
          description: 'One is a subtask of the other'
        });
      }
    }
  }

  return correlations;
}

/**
 * Convert HTML to clean readable text (strip tags but keep structure)
 */
function htmlToText(html) {
  if (!html) return '';

  return html
    .replace(/<h[1-6][^>]*>/gi, '\n### ')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/li>/gi, '')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<strong>|<b>/gi, '**')
    .replace(/<\/strong>|<\/b>/gi, '**')
    .replace(/<em>|<i>/gi, '_')
    .replace(/<\/em>|<\/i>/gi, '_')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

/**
 * Generate human-readable technical explanation
 */
function generateExplanation(analysis) {
  let explanation = '';

  explanation += `## ${analysis.key}: ${analysis.summary}\n\n`;
  explanation += `**Status:** ${analysis.status} | **Priority:** ${analysis.priority} | **Story Points:** ${analysis.storyPoints || 'N/A'}\n\n`;

  if (analysis.components.length > 0) {
    explanation += `**Affected Components:** ${analysis.components.join(', ')}\n\n`;
  }

  // Use rendered description if available (cleaner), otherwise fall back to plain text
  const desc = analysis.renderedDescription
    ? htmlToText(analysis.renderedDescription)
    : analysis.description;

  if (desc && desc.trim().length > 0) {
    explanation += desc.trim() + '\n\n';
  }

  if (analysis.acceptanceCriteria) {
    explanation += `### Acceptance Criteria\n\n${analysis.acceptanceCriteria}\n\n`;
  }

  if (analysis.technicalNotes) {
    explanation += `### Technical Notes\n\n${analysis.technicalNotes}\n\n`;
  }

  if (analysis.subtasks.length > 0) {
    explanation += `### Subtasks (${analysis.subtasks.length})\n\n`;
    analysis.subtasks.forEach(st => {
      explanation += `- [${st.status}] ${st.key}: ${st.summary}\n`;
    });
    explanation += '\n';
  }

  if (analysis.issueLinks.length > 0) {
    explanation += `### Related Issues\n\n`;
    analysis.issueLinks.forEach(link => {
      explanation += `- ${link.relationship}: ${link.key} - ${link.summary}\n`;
    });
    explanation += '\n';
  }

  explanation += `[View in Jira](${analysis.url})\n\n`;
  explanation += '---\n\n';

  return explanation;
}

/**
 * Generate technical synthesis showing relationships and complexities
 */
function generateTechnicalSynthesis(analyses) {
  const correlations = analyzeCorrelations(analyses);

  console.log('### Overview\n');

  // Find common implementation issue
  const allLinkedIssues = analyses.flatMap(a => a.issueLinks);
  const implementationLinks = allLinkedIssues.filter(l => l.relationship === 'is implemented by');

  // Group by common linked issues
  const linkedIssueCounts = {};
  implementationLinks.forEach(link => {
    if (!linkedIssueCounts[link.key]) {
      linkedIssueCounts[link.key] = {
        key: link.key,
        summary: link.summary,
        count: 0,
        relatedTo: []
      };
    }
    linkedIssueCounts[link.key].count++;
  });

  // Find the umbrella ticket (linked to all issues)
  const umbrellaTicket = Object.values(linkedIssueCounts).find(l => l.count === analyses.length);

  if (umbrellaTicket) {
    console.log(`🎯 **Common Thread**: All ${analyses.length} tickets are part of ${umbrellaTicket.key} (${umbrellaTicket.summary})\n`);
    console.log(`This indicates they're part of a **coordinated initiative** to improve agent activity tracking.\n`);
  }

  console.log('### Technical Scope Breakdown\n');

  analyses.forEach(a => {
    console.log(`**${a.key}** - ${a.summary}`);

    // Extract what makes this unique
    const desc = a.renderedDescription ? htmlToText(a.renderedDescription) : a.description;

    // Find key phrases that indicate technical work
    const keyPhrases = [];
    if (desc.includes('Idle') || a.summary.includes('Idle')) keyPhrases.push('Idle sub-status tracking');
    if (desc.includes('Online') || a.summary.includes('Online')) keyPhrases.push('Online/Hold sub-status tracking');
    if (desc.includes('Offline') || a.summary.includes('Offline')) keyPhrases.push('Offline status tracking');
    if (desc.includes('Export') || a.summary.includes('Export')) keyPhrases.push('CSV export functionality');
    if (desc.includes('API')) keyPhrases.push('API integration');
    if (desc.includes('Agent Report')) keyPhrases.push('Agent Report UI');
    if (desc.includes('Real-time')) keyPhrases.push('Real-time reporting');

    if (keyPhrases.length > 0) {
      console.log(`  → Focus: ${keyPhrases.join(', ')}`);
    }
    console.log(`  → Status: ${a.status} | Priority: ${a.priority}\n`);
  });

  console.log('---\n');
  console.log('### How They Relate\n');

  // Identify the pattern
  console.log('These tickets represent **different dimensions of the same feature set**: enhancing agent status visibility.\n');
  console.log('**Key distinctions:**\n');
  console.log('1. **By Status Type** (what status is being tracked):');
  const statusTypes = [
    { ticket: 'DSH-5026', type: 'Idle sub-statuses (Lunch, Training, Break, etc.)' },
    { ticket: 'DSH-6226', type: 'Online sub-statuses (Hold time)' },
    { ticket: 'DSH-6276', type: 'Offline status' }
  ];
  statusTypes.forEach(st => {
    const found = analyses.find(a => a.key === st.ticket);
    if (found) {
      console.log(`   • ${st.ticket}: ${st.type}`);
    }
  });

  console.log('\n2. **By Output Format** (where the data is visible):');
  const formats = [
    { ticket: 'DSH-5026', format: 'UI (Agent Status Breakdown tabs)' },
    { ticket: 'DSH-6226', format: 'UI (Agent Report + Real-time) and Exports' },
    { ticket: 'DSH-6276', format: 'UI (Agent Status Breakdown)' },
    { ticket: 'DSH-6274', format: 'CSV Exports + Analytics API' }
  ];
  formats.forEach(fmt => {
    const found = analyses.find(a => a.key === fmt.ticket);
    if (found) {
      console.log(`   • ${fmt.ticket}: ${fmt.format}`);
    }
  });

  console.log('\n---\n');
  console.log('### Potential Overlap Analysis\n');

  // Check for shared implementation concerns
  const uiTickets = analyses.filter(a =>
    a.summary.includes('UI') ||
    a.summary.includes('Agent Report') ||
    htmlToText(a.renderedDescription || '').includes('Agent Report (UI)')
  );

  const exportTickets = analyses.filter(a =>
    a.summary.includes('Export') ||
    htmlToText(a.renderedDescription || '').includes('Export')
  );

  if (uiTickets.length > 1) {
    console.log(`**UI Layer** (${uiTickets.map(t => t.key).join(', ')})`);
    console.log('These all modify the Agent Report UI to display different status types.');
    console.log('✅ **Not duplicate work** - each focuses on a different status dimension.\n');
    console.log('⚠️  **Watch for**: Shared UI components (tables, filters, date pickers) that might need');
    console.log('   refactoring once to support all status types, rather than modifying the same');
    console.log('   components multiple times across different tickets.\n');
  }

  if (exportTickets.length >= 1) {
    console.log(`**Export Layer** (${exportTickets.map(t => t.key).join(', ')})`);
    console.log('DSH-6274 explicitly focuses on export functionality.');
    console.log('✅ **Not duplicate** - DSH-6226 mentions exports but only for "Hold" sub-status,');
    console.log('   while DSH-6274 provides comprehensive export of all agent statuses/sub-statuses.\n');
  }

  console.log('---\n');
  console.log('### Implementation Coordination Notes\n');

  console.log('**Database Layer**: All tickets likely touch the same underlying agent status data models.');
  console.log('Consider implementing a **unified sub-status schema** first to avoid rework.\n');

  console.log('**UI Components**: The "Agent Status Breakdown" is modified by multiple tickets.');
  console.log('Build **reusable components** for sub-status display to avoid code duplication.\n');

  console.log('**API Layer**: DSH-6274 introduces API endpoints. Ensure they\'re designed to support');
  console.log('all status types (Idle, Online, Offline) from the start, not just the immediate requirement.\n');

  console.log('**Testing Strategy**: Since these all interact with agent status tracking, comprehensive');
  console.log('integration tests covering status transitions across all types will be critical.\n');

  console.log('---\n');
  console.log('### Recommended Implementation Order\n');

  console.log('1. **Foundation** - DSH-6304 (Improve Agent Activity Tracking)');
  console.log('   Start here to establish the core tracking infrastructure.\n');

  console.log('2. **Status Types** (parallel work possible):');
  console.log('   • DSH-6276 (Offline) - Likely simplest, fills a data gap');
  console.log('   • DSH-5026 (Idle sub-statuses) - Medium complexity, UI-focused');
  console.log('   • DSH-6226 (Online/Hold) - Similar to Idle, but with customer urgency\n');

  console.log('3. **Export Layer** - DSH-6274');
  console.log('   Build after status types are established, so exports include all new data.\n');
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node jira-technical-complexity.js <ISSUE-KEY> [ISSUE-KEY...]');
    console.error('Example: node jira-technical-complexity.js DSH-5026 DSH-6226');
    process.exit(1);
  }

  console.log(`\n🔍 Fetching ${args.length} issue(s)...\n`);

  try {
    // Fetch all issues in parallel
    const issues = await Promise.all(args.map(key => fetchIssue(key)));

    // Analyze each issue
    const analyses = issues.map(issue => analyzeTechnicalComplexity(issue));

    // Generate explanations
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('TECHNICAL COMPLEXITY ANALYSIS');
    console.log('═══════════════════════════════════════════════════════════════\n');

    analyses.forEach(analysis => {
      console.log(generateExplanation(analysis));
    });

    // Analyze correlations if multiple issues
    if (analyses.length > 1) {
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('TECHNICAL SYNTHESIS & RELATIONSHIPS');
      console.log('═══════════════════════════════════════════════════════════════\n');

      generateTechnicalSynthesis(analyses);
    }

  } catch (err) {
    console.error('[FATAL] Script failed:', err.message);
    process.exit(1);
  }
}

main();
