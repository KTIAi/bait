const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');
const { CronJob } = require('cron');
require('dotenv').config();
const express = require('express'); // Add Express

// Load creator data with error handling
let creatorsData;
try {
  creatorsData = require('./creators.json');
} catch (error) {
  console.error('Error loading creators.json:', error.message);
  creatorsData = { data: { targets: [], hashtagsToMonitor: [] } };
}

// Config
const config = {
  storage: {
    basePath: process.env.STORAGE_PATH || './storage',
    ensureDirs: () => {
      fs.ensureDirSync(config.storage.basePath);
      creatorsData.data.targets.forEach(creator => {
        const creatorDir = path.join(config.storage.basePath, creator.name.replace(/\s+/g, '_'));
        fs.ensureDirSync(creatorDir);
        ['images', 'posts', 'videos'].forEach(type => {
          fs.ensureDirSync(path.join(creatorDir, type));
        });
      });
    }
  },
  browser: {
    headless: true,
    slowMo: 100,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  },
  sleep: async (ms) => new Promise(resolve => setTimeout(resolve, ms))
};

// Create storage directories
config.storage.ensureDirs();

// Helper function to randomize delays
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

// Scrape functions (unchanged)
async function scrapeTwitter(page, creator) {
  // ... (your existing scrapeTwitter function)
}

async function scrapeInstagram(page, creator) {
  // ... (your existing scrapeInstagram function)
}

async function scrapeContent() {
  console.log('Starting scrape job...');
  const browser = await chromium.launch(config.browser);
  const context = await browser.newContext({ userAgent: config.browser.userAgent, viewport: { width: 1280, height: 800 } });
  try {
    for (const creator of creatorsData.data.targets) {
      console.log(`Processing creator: ${creator.name}`);
      const page = await context.newPage();
      if (creator.platforms.twitter) {
        await scrapeTwitter(page, creator);
        await config.sleep(randomDelay(5000, 10000));
      }
      if (creator.platforms.instagram) {
        await scrapeInstagram(page, creator);
        await config.sleep(randomDelay(5000, 10000));
      }
      await page.close();
    }
    // Hashtag scraping (unchanged)
    // ...
  } catch (error) {
    console.error('Error in scrape job:', error);
  } finally {
    await browser.close();
  }
  console.log('Scrape job completed!');
}

// Initialize Express app
const app = express();
app.use(express.json());

// Add /scrape endpoint for n8n
app.post('/scrape', async (req, res) => {
  const { platform, creatorUrl } = req.body;
  const creator = creatorsData.data.targets.find(c => 
    Object.values(c.platforms).some(p => p.profileUrl === creatorUrl)
  );
  if (!creator) {
    return res.status(400).json({ error: 'Creator not found' });
  }
  console.log(`Scraping ${creator.name} on ${platform}...`);
  const browser = await chromium.launch(config.browser);
  const context = await browser.newContext({ userAgent: config.browser.userAgent });
  const page = await context.newPage();
  let result = null;
  if (platform === 'twitter') result = await scrapeTwitter(page, creator);
  else if (platform === 'instagram') result = await scrapeInstagram(page, creator);
  await page.close();
  await browser.close();
  res.json({ message: 'Scraping completed', data: result || {} });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Run once immediately on startup
scrapeContent().catch(err => console.error('Error in initial scrape:', err));

// Schedule recurring job (every 4 hours)
const job = new CronJob('0 */4 * * *', () => {
  scrapeContent().catch(err => console.error('Error in scheduled scrape:', err));
});
job.start();
console.log('Scraper started and scheduled to run every 4 hours');