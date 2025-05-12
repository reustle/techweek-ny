import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_URL = 'https://api.tech-week.com/list_events/?city=NYC';
const OUTPUT_DIR = path.join(__dirname, '..', 'docs');
const INDEX_PATH = path.join(OUTPUT_DIR, 'index.html');

// Utility to generate MD5 hash from a string
function generateHash(url: string): string {
  return crypto.createHash('md5').update(url).digest('hex');
}

// Utility to detect if an event is from Partiful
function isPartifulEvent(html: string): boolean {
  const dom = new JSDOM(html);
  const meta = dom.window.document.querySelector('meta[property="og:site_name"]');
  return meta?.getAttribute('content') === 'Partiful';
}

// Utility to extract platform information from non-Partiful events
function extractPlatformInfo(html: string): { siteName: string | null; url: string | null } {
  const dom = new JSDOM(html);
  const siteNameMeta = dom.window.document.querySelector('meta[property="og:site_name"]');
  const urlMeta = dom.window.document.querySelector('meta[property="og:url"]');
  return {
    siteName: siteNameMeta?.getAttribute('content') || null,
    url: urlMeta?.getAttribute('content') || null
  };
}

// Utility to extract meta description from HTML
function extractMetaDescription(html: string): string | null {
  const dom = new JSDOM(html);
  const metaDesc = dom.window.document.querySelector('meta[name="description"]');
  const ogDesc = dom.window.document.querySelector('meta[property="og:description"]');
  
  const descContent = metaDesc?.getAttribute('content');
  const ogContent = ogDesc?.getAttribute('content');
  
  if (!descContent && !ogContent) return null;
  if (!descContent) return ogContent;
  if (!ogContent) return descContent;
  
  // Return the longer description
  return descContent.length > ogContent.length ? descContent : ogContent;
}

// Utility to format date to English readable in EST
function formatDateToEST(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    timeZoneName: 'short'
  });
}

// Utility to get date string for filename
function getDateString(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric'
  }).toLowerCase().replace(' ', '_');
}

const HTML_CACHE_DIR = path.join(__dirname, '..', 'html-cache');

async function fetchAndSaveData() {
  try {
    const response = await fetch(API_URL as string);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    await fs.ensureDir(OUTPUT_DIR);
    await fs.writeJson(path.join(OUTPUT_DIR, 'all_events.txt'), data, { spaces: 2 });
    console.log(`Data fetched from ${API_URL} and saved to all_events.txt`);
  } catch (error) {
    console.error('Error fetching or saving data:', error);
    process.exit(1);
  }
}

async function updateIndexFile(eventFiles: string[]) {
  const links = eventFiles
    .sort()
    .map(file => `<a href="${file}">${file}</a>`)
    .join('\n');
  
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>Tech Week NYC Events</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; }
    a { display: block; margin: 10px 0; color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Tech Week NYC Events</h1>
  ${links}
</body>
</html>`;

  await fs.writeFile(INDEX_PATH, htmlContent);
  console.log(`Updated index.html with ${eventFiles.length} event files`);
}

async function enrichWithDescriptions() {
  const data = await fs.readJson(path.join(OUTPUT_DIR, 'all_events.txt'));
  console.log(`Starting to process ${data.length} events...`);
  
  let processed = 0;
  let enriched = 0;
  let partifulEvents = 0;
  let nonPartifulEvents = 0;
  const platformStats: { [key: string]: number } = {};
  
  // Group events by date
  const eventsByDate: { [key: string]: any[] } = {};
  
  for (const event of data) {
    processed++;
    if (!event.invite_url) {
      console.log(`[${processed}/${data.length}] Skipping event without invite URL`);
      continue;
    }
    
    const hash = generateHash(event.invite_url);
    const htmlPath = path.join(HTML_CACHE_DIR, `${hash}.html`);
    
    let description = null;
    if (await fs.pathExists(htmlPath)) {
      const html = await fs.readFile(htmlPath, 'utf-8');
      const isPartiful = isPartifulEvent(html);
      
      if (isPartiful) {
        partifulEvents++;
      } else {
        nonPartifulEvents++;
        const platformInfo = extractPlatformInfo(html);
        const platformName = platformInfo.siteName || 'unknown';
        platformStats[platformName] = (platformStats[platformName] || 0) + 1;
      }
      
      description = extractMetaDescription(html);
      if (description) {
        enriched++;
        console.log(`[${processed}/${data.length}] Enriched event: ${event.event_name || 'Untitled'} (${description.length} chars)`);
      }
    }
    
    // Transform the event data
    const transformedEvent = {
      event_name: event.event_name,
      start_time: formatDateToEST(event.start_time),
      neighborhood: event.neighborhood,
      url: event.invite_url,
      hosts: event.hosts.join(', '),
      target_audiences: event.target_audiences.join(', '),
      themes: event.themes.join(', '),
      formats: event.formats.join(', '),
      description: description || event.desc || null
    };
    
    // Group by date
    const eventDate = new Date(event.start_time);
    const dateKey = getDateString(eventDate);
    if (!eventsByDate[dateKey]) {
      eventsByDate[dateKey] = [];
    }
    eventsByDate[dateKey].push(transformedEvent);
  }
  
  // Save events to separate files by date
  const eventFiles: string[] = [];
  for (const [dateKey, events] of Object.entries(eventsByDate)) {
    const filename = `events_${dateKey}.txt`;
    const outputPath = path.join(OUTPUT_DIR, filename);
    await fs.writeJson(outputPath, events, { spaces: 2 });
    eventFiles.push(filename);
    console.log(`Saved ${events.length} events for ${dateKey} to ${outputPath}`);
  }
  
  // Update index.html with the new file list
  await updateIndexFile(eventFiles);
  
  console.log(`\nProcessing complete!`);
  console.log(`Total events processed: ${processed}`);
  console.log(`Events enriched with descriptions: ${enriched}`);
  console.log(`Partiful events: ${partifulEvents}`);
  console.log(`Non-Partiful events: ${nonPartifulEvents}`);
  console.log(`\nPlatform distribution for non-Partiful events:`);
  Object.entries(platformStats).forEach(([platform, count]) => {
    console.log(`  ${platform}: ${count} events`);
  });
  console.log(`\nEvents skipped: ${processed - enriched}`);
}

// First fetch and save data, then enrich
(async () => {
  await fetchAndSaveData();
  await enrichWithDescriptions();
})();
