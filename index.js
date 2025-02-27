const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');
const { CronJob } = require('cron');
require('dotenv').config();

// Load creator data
const creatorsData = require('e('./creators.json') || { data: { targets: [], hashtagsToMonitor: [] } };');

// Config
const config = {
  storage: {
    basePath: process.env.STORAGE_PATH || './storage',
    ensureDirs: () => {
      // Create main storage directory
      fs.ensureDirSync(config.storage.basePath);
      
      // Create directories for each creator
      creatorsData.data.targets.forEach(creator => {
        const creatorDir = path.join(
          config.storage.basePath, 
          creator.name.replace(/\s+/g, '_')
        );
        fs.ensureDirSync(creatorDir);
        
        // Create subdirectories for different content types
        ['images', 'posts', 'videos'].forEach(type => {
          fs.ensureDirSync(path.join(creatorDir, type));
        });
      });
    }
  },
  // Browser settings
  browser: {
    headless: true,  // Set to false for debugging
    slowMo: 100,     // Slow down execution to avoid detection
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  },
  // Sleep function to avoid being detected as a bot
  sleep: async (ms) => new Promise(resolve => setTimeout(resolve, ms))
};

// Create storage directories
config.storage.ensureDirs();

// Helper function to randomize delays
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

// Scrape Twitter without API
async function scrapeTwitter(page, creator) {
  try {
    const username = new URL(creator.platforms.twitter.profileUrl).pathname.slice(1);
    console.log(`Scraping Twitter for ${creator.name} (${username})...`);
    
    // Navigate to the profile
    await page.goto(`https://twitter.com/${username}`, { waitUntil: 'networkidle' });
    
    // Wait for tweets to load
    await page.waitForSelector('article[data-testid="tweet"]', { timeout: 10000 }).catch(() => {
      console.log('No tweets found or login required');
    });
    
    // Extract tweets
    const tweets = await page.evaluate(() => {
      const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');
      return Array.from(tweetElements).slice(0, 10).map(tweet => {
        // Find text content
        const tweetTextElement = tweet.querySelector('div[data-testid="tweetText"]');
        const tweetText = tweetTextElement ? tweetTextElement.textContent : '';
        
        // Find timestamp
        const timeElement = tweet.querySelector('time');
        const timestamp = timeElement ? timeElement.getAttribute('datetime') : '';
        
        // Find media (if any)
        const mediaElements = tweet.querySelectorAll('img[src*="media"]');
        const mediaUrls = Array.from(mediaElements).map(img => img.src);
        
        // Find engagement stats
        const statsElements = tweet.querySelectorAll('div[data-testid$="-count"]');
        const stats = Array.from(statsElements).map(stat => stat.textContent);
        
        return {
          text: tweetText,
          timestamp,
          mediaUrls,
          stats
        };
      });
    });
    
    // Save the results
    const savePath = path.join(
      config.storage.basePath, 
      creator.name.replace(/\s+/g, '_'), 
      'posts', 
      `twitter_${new Date().toISOString().slice(0, 10)}.json`
    );
    
    fs.writeJsonSync(savePath, {
      username,
      date: new Date().toISOString(),
      tweets
    });
    
    // Download images if available
    for (let i = 0; i < tweets.length; i++) {
      const tweet = tweets[i];
      if (tweet.mediaUrls && tweet.mediaUrls.length > 0) {
        for (let j = 0; j < tweet.mediaUrls.length; j++) {
          const imgUrl = tweet.mediaUrls[j];
          try {
            // Navigate to image
            await page.goto(imgUrl, { waitUntil: 'networkidle' });
            
            // Take screenshot of the image
            const imgPath = path.join(
              config.storage.basePath, 
              creator.name.replace(/\s+/g, '_'), 
              'images', 
              `twitter_${new Date().toISOString().slice(0, 10)}_${i}_${j}.png`
            );
            
            await page.screenshot({ path: imgPath });
            console.log(`Saved image: ${imgPath}`);
            
            // Random delay
            await config.sleep(randomDelay(1000, 3000));
          } catch (err) {
            console.error(`Error downloading image: ${imgUrl}`, err.message);
          }
        }
      }
    }
    
    return tweets;
  } catch (error) {
    console.error(`Error scraping Twitter for ${creator.name}:`, error.message);
    return null;
  }
}

// Scrape Instagram without API
async function scrapeInstagram(page, creator) {
  try {
    const username = new URL(creator.platforms.instagram.profileUrl).pathname.slice(1);
    console.log(`Scraping Instagram for ${creator.name} (${username})...`);
    
    // Navigate to the profile
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'networkidle' });
    
    // Check for login popup and close it if it appears
    const closeButton = await page.$('button.xqrby0s[aria-label="Close"]');
    if (closeButton) {
      await closeButton.click();
      await config.sleep(1000);
    }
    
    // Wait for posts to load
    await page.waitForSelector('article a', { timeout: 10000 }).catch(() => {
      console.log('No posts found or login required');
    });
    
    // Extract post links
    const postLinks = await page.evaluate(() => {
      const links = document.querySelectorAll('article a');
      return Array.from(links).slice(0, 5).map(link => link.href);
    });
    
    // Extract basic profile info
    const profileInfo = await page.evaluate(() => {
      const usernameMeta = document.querySelector('meta[property="og:title"]');
      const username = usernameMeta ? usernameMeta.content : '';
      
      const descriptionMeta = document.querySelector('meta[property="og:description"]');
      const description = descriptionMeta ? descriptionMeta.content : '';
      
      return { username, description };
    });
    
    // Save screenshot of the profile
    const profileImagePath = path.join(
      config.storage.basePath, 
      creator.name.replace(/\s+/g, '_'), 
      'images', 
      `instagram_profile_${new Date().toISOString().slice(0, 10)}.png`
    );
    
    await page.screenshot({ path: profileImagePath });
    
    // Save the results
    const savePath = path.join(
      config.storage.basePath, 
      creator.name.replace(/\s+/g, '_'), 
      'posts', 
      `instagram_${new Date().toISOString().slice(0, 10)}.json`
    );
    
    fs.writeJsonSync(savePath, {
      username,
      date: new Date().toISOString(),
      profileInfo,
      postLinks
    });
    
    // Visit a few posts if available
    for (let i = 0; i < Math.min(postLinks.length, 2); i++) {
      try {
        await page.goto(postLinks[i], { waitUntil: 'networkidle' });
        
        // Take screenshot of the post
        const postImagePath = path.join(
          config.storage.basePath, 
          creator.name.replace(/\s+/g, '_'), 
          'images', 
          `instagram_post_${new Date().toISOString().slice(0, 10)}_${i}.png`
        );
        
        await page.screenshot({ path: postImagePath });
        console.log(`Saved post screenshot: ${postImagePath}`);
        
        // Random delay
        await config.sleep(randomDelay(2000, 5000));
      } catch (err) {
        console.error(`Error processing Instagram post: ${postLinks[i]}`, err.message);
      }
    }
    
    return { profileInfo, postLinks };
  } catch (error) {
    console.error(`Error scraping Instagram for ${creator.name}:`, error.message);
    return null;
  }
}

// Main scraping function
async function scrapeContent() {
  console.log('Starting scrape job...');
  
  // Launch browser
  const browser = await chromium.launch({
    headless: config.browser.headless,
    slowMo: config.browser.slowMo
  });
  
  // Create context with custom user agent
  const context = await browser.newContext({
    userAgent: config.browser.userAgent,
    viewport: { width: 1280, height: 800 }
  });
  
  try {
    // Process each creator
    for (const creator of creatorsData.data.targets) {
      console.log(`Processing creator: ${creator.name}`);
      
      // Create a new page for each creator
      const page = await context.newPage();
      
      // Scrape platforms
      if (creator.platforms.twitter) {
        await scrapeTwitter(page, creator);
        // Wait between requests to avoid being blocked
        await config.sleep(randomDelay(5000, 10000));
      }
      
      if (creator.platforms.instagram) {
        await scrapeInstagram(page, creator);
        await config.sleep(randomDelay(5000, 10000));
      }
      
      // Add scraping for other platforms here
      
      await page.close();
    }
    
    // Scrape hashtags (simplified version)
    console.log('Scraping hashtags...');
    const hashtagPage = await context.newPage();
    
    for (const hashtag of creatorsData.data.hashtagsToMonitor.slice(0, 3)) { // Limit to first 3 hashtags for demo
      const tag = hashtag.replace('#', '');
      try {
        await hashtagPage.goto(`https://twitter.com/search?q=${encodeURIComponent(hashtag)}&src=typed_query&f=top`, 
          { waitUntil: 'networkidle' }
        );
        
        // Take screenshot of search results
        const hashtagImagePath = path.join(
          config.storage.basePath,
          'hashtags',
          `${tag}_${new Date().toISOString().slice(0, 10)}.png`
        );
        
        fs.ensureDirSync(path.dirname(hashtagImagePath));
        await hashtagPage.screenshot({ path: hashtagImagePath });
        console.log(`Saved hashtag search: ${hashtagImagePath}`);
        
        await config.sleep(randomDelay(3000, 7000));
      } catch (error) {
        console.error(`Error scraping hashtag ${hashtag}:`, error.message);
      }
    }
    
    await hashtagPage.close();
  } catch (error) {
    console.error('Error in scrape job:', error);
  } finally {
    // Close browser
    await browser.close();
  }
  
  console.log('Scrape job completed!');
}

// Run once immediately on startup
scrapeContent().catch(err => console.error('Error in initial scrape:', err));

// Schedule recurring job (every 4 hours)
const job = new CronJob('0 */4 * * *', () => {
  scrapeContent().catch(err => console.error('Error in scheduled scrape:', err));
});

job.start();
console.log('Scraper started and scheduled to run every 4 hours');