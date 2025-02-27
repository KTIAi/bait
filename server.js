const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs-extra');
const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON request body
app.use(express.json());

// API endpoint to trigger scraping
app.post('/scrape', async (req, res) => {
  const { platform, creatorUrl } = req.body;
  
  if (!platform || !creatorUrl) {
    return res.status(400).json({ 
      success: false, 
      message: 'Missing platform or creatorUrl in request body' 
    });
  }

  console.log(`Received request to scrape ${platform} profile: ${creatorUrl}`);
  
  try {
    // Launch browser with Render-compatible options
    const browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    let result = { success: false, data: null };
    
    // Handle different platforms
    if (platform === 'tiktok') {
      result = await scrapeTikTok(page, creatorUrl);
    } else if (platform === 'instagram') {
      result = await scrapeInstagram(page, creatorUrl);
    } else {
      await browser.close();
      return res.status(400).json({ 
        success: false, 
        message: `Unsupported platform: ${platform}` 
      });
    }
    
    // Close browser
    await browser.close();
    
    // Return results
    return res.json({
      success: true,
      platform,
      creatorUrl,
      ...result
    });
    
  } catch (error) {
    console.error('Error during scraping:', error);
    return res.status(500).json({ 
      success: false, 
      message: `Error: ${error.message}` 
    });
  }
});

// TikTok scraping logic
async function scrapeTikTok(page, profileUrl) {
  try {
    await page.goto(profileUrl, { waitUntil: 'networkidle' });
    
    // Scrape basic profile info
    const profileInfo = await page.evaluate(() => {
      const username = document.querySelector('h1.tiktok-arkop9-H1ShareTitle')?.textContent || '';
      const followerCount = document.querySelector('strong[data-e2e="followers-count"]')?.textContent || '0';
      const bioElement = document.querySelector('h2.tiktok-1n8z9r7-H2ShareDesc');
      const bio = bioElement ? bioElement.textContent : '';
      
      return { username, followerCount, bio };
    });
    
    // Get recent posts (limited to 5 for example)
    const posts = await page.$$eval('div[data-e2e="user-post-item"]', (items) => {
      return items.slice(0, 5).map(item => {
        const link = item.querySelector('a')?.href || '';
        const thumbnail = item.querySelector('img')?.src || '';
        return { link, thumbnail };
      });
    });
    
    return {
      success: true,
      data: {
        profileInfo,
        posts
      }
    };
  } catch (error) {
    console.error('Error in TikTok scraping:', error);
    return {
      success: false,
      message: error.message
    };
  }
}

// Instagram scraping logic
async function scrapeInstagram(page, profileUrl) {
  try {
    await page.goto(profileUrl, { waitUntil: 'networkidle' });
    
    // Handle cookie consent if it appears
    const acceptCookies = await page.$('button._a9--._a9_1');
    if (acceptCookies) {
      await acceptCookies.click();
      await page.waitForTimeout(1000);
    }
    
    // Scrape basic profile info
    const profileInfo = await page.evaluate(() => {
      const username = document.querySelector('h2._aacl._aacs._aact._aacx._aada')?.textContent || '';
      const postsCount = document.querySelector('span._ac2a')?.textContent || '0';
      const bio = document.querySelector('div._aa_c')?.textContent || '';
      
      return { username, postsCount, bio };
    });
    
    // Get post links
    const posts = await page.$$eval('a[href^="/p/"]', (links) => {
      return links.slice(0, 5).map(link => {
        const href = link.href;
        const img = link.querySelector('img');
        const thumbnail = img ? img.src : '';
        return { link: href, thumbnail };
      });
    });
    
    return {
      success: true,
      data: {
        profileInfo,
        posts
      }
    };
  } catch (error) {
    console.error('Error in Instagram scraping:', error);
    return {
      success: false,
      message: error.message
    };
  }
}

// Add a simple route for health checks
app.get('/', (req, res) => {
  res.send('Social Trend Scraper API is running');
});

// Start the server
app.listen(PORT, () => {
  console.log(`Scraper API server running on port ${PORT}`);
});