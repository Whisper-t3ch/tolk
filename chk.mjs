import { chromium } from 'playwright'; const b = await chromium.launch({ args: ['--no-sandbox'] }); console.log('chromium ok', b.version()); await b.close();
