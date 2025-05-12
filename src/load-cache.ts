import axios from 'axios';
import fs from 'fs-extra';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Event {
  id: string;
  event_name: string;
  invite_url: string;
  // Add other fields as needed
}

const API_URL = 'https://api.tech-week.com/list_events/?city=NYC';
const CACHE_DIR = path.join(__dirname, '..', 'html-cache');

async function ensureCacheDirectory() {
  await fs.ensureDir(CACHE_DIR);
}

function generateHash(url: string): string {
  return crypto.createHash('md5').update(url).digest('hex');
}

async function fetchAndCacheEvent(event: Event) {
  if (!event.invite_url) {
    console.log(`Skipping event ${event.event_name}: No invite URL available`);
    return;
  }

  if (event.invite_url === "Invite Only") {
    console.log(`Skipping event ${event.event_name}: Invite Only event`);
    return;
  }

  const hash = generateHash(event.invite_url);
  const cacheFile = path.join(CACHE_DIR, `${hash}.html`);
  
  // Check if file already exists in cache
  if (await fs.pathExists(cacheFile)) {
    console.log(`Skipping event ${event.event_name}: Already cached`);
    return;
  }

  try {
    const response = await axios.get(event.invite_url);
    await fs.writeFile(cacheFile, response.data);
    console.log(`Cached event: ${event.event_name}`);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Error caching event ${event.event_name}:`, error.message);
    } else {
      console.error(`Error caching event ${event.event_name}: Unknown error occurred`);
    }
  }
}

async function main() {
  try {
    // Ensure cache directory exists
    await ensureCacheDirectory();
    
    // Fetch events from API
    console.log('Fetching events from API...');
    const response = await axios.get<Event[]>(API_URL);
    const events = response.data;
    
    console.log(`Found ${events.length} events. Starting to cache...`);
    
    // Process events in parallel with a concurrency limit
    const concurrencyLimit = 5;
    for (let i = 0; i < events.length; i += concurrencyLimit) {
      const batch = events.slice(i, i + concurrencyLimit);
      await Promise.all(batch.map(fetchAndCacheEvent));
    }
    
    console.log('Finished caching all events!');
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('Error in main process:', error.message);
    } else {
      console.error('Error in main process: Unknown error occurred');
    }
    process.exit(1);
  }
}

main();
