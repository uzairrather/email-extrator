/**
 * extractorService.js — Gemini 2.5 Flash + Heuristic + Regex
 *
 * Setup:
 *   1. Go to https://aistudio.google.com/app/apikey → Create API Key (FREE, no card)
 *   2. Add to .env:  GEMINI_API_KEY=your_key_here
 *   3. Run:          npm install @google/genai
 *
 * Free tier limits (Gemini 2.5 Flash):
 *   - 10 requests/minute
 *   - 250 requests/day
 *   - 250,000 tokens/minute
 *   - No credit card required
 *
 * Architecture:
 *   Stage 1 (FREE):  Heuristic pre-filter → tags obvious spam/jobs instantly
 *   Stage 2 (GEMINI): Single combined classify+extract call
 *   Fallback:         Regex extraction if Gemini unavailable
 */

const { GoogleGenAI } = require('@google/genai');

// ─── Gemini Client (lazy init) ──────────────────────────────────────────────
let _gemini = null;
function getGemini() {
  if (!_gemini && hasGemini()) {
    _gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _gemini;
}

const hasGemini = () =>
  process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key';

// ─── Rate limit tracker ─────────────────────────────────────────────────────
let dailyRequestCount = 0;
let dailyResetAt = 0;
const DAILY_LIMIT = 240; // stay under 250 RPD with buffer

function checkDailyLimit() {
  const now = Date.now();
  // Reset counter at midnight-ish (every 24h)
  if (now > dailyResetAt) {
    dailyRequestCount = 0;
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    dailyResetAt = tomorrow.getTime();
  }
  return dailyRequestCount < DAILY_LIMIT;
}

// ─── Categories ─────────────────────────────────────────────────────────────
const CATEGORIES = [
  'business_inquiry',
  'partnership_request',
  'sales_lead',
  'job_application',
  'customer_support',
  'newsletter_spam',
  'other',
];

// ─── Helpers ────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── STAGE 1: Heuristic Pre-Filter (FREE) ───────────────────────────────────

const SPAM_DOMAINS = [
  // Bulk / marketing senders
  'noreply', 'no-reply', 'mailer-daemon', 'mailchimp', 'sendgrid', 'hubspot',
  'amazonses', 'postmaster', 'bounce', 'notifications', 'news@', 'alerts@',
  // Indian banks & fintech
  'axisbank', 'hdfcbank', 'icicibank', 'sbi.co', 'kotak', 'yesbank',
  'paytm', 'phonepe', 'gpay', 'razorpay', 'paypal', 'stripe',
  'upstox', 'zerodha', 'groww', 'binance', 'coinbase',
  // Social media
  'facebook', 'instagram', 'twitter', 'youtube', 'tiktok', 'snapchat',
  // Google / Microsoft system emails
  'google.com', 'accounts.google', 'google-pay', 'microsoft.com',
  // E-commerce
  'swiggy', 'zomato', 'amazon.in', 'flipkart', 'myntra', 'ajio',
  'apple.com', 'spotify', 'netflix', 'hotstar', 'jiocinema',
  // Developer tools & CI/CD (build notifications, deploy alerts)
  'render.com', 'vercel.com', 'netlify.com', 'heroku.com', 'railway.app',
  'github.com', 'gitlab.com', 'bitbucket.org', 'emailjs.com',
  'postman', 'aws.amazon.com', 'cloudflare.com', 'digitalocean.com',
  // Newsletters & content platforms
  'substack.com', 'medium.com', 'gatesnotes', 'transformation.today',
  'jobgether', 'newsletter',
];

const JOB_DOMAINS = [
  'indeed.com', 'naukri.com', 'foundit.in', 'linkedin.com', 'monster.com',
  'glassdoor.com', 'internshala.com', 'shine.com', 'apna.co', 'hirist.com',
  'wellfound.com', 'angel.co', 'dice.com', 'ziprecruiter.com',
];

function heuristicPreFilter(from, subject, snippet) {
  const fromLower = (from || '').toLowerCase();
  const subjectLower = (subject || '').toLowerCase();
  const text = `${fromLower} ${subjectLower} ${(snippet || '').toLowerCase()}`;

  // High confidence: Job Application (CHECK FIRST — job domains like indeed.com
  // also use alert@ prefix which would falsely trigger spam pattern)
  if (JOB_DOMAINS.some(d => fromLower.includes(d)))
    return { category: 'job_application', confidence: 'high' };
  if (/^(jobs|careers|recruitment|hiring|talent)@/i.test(fromLower))
    return { category: 'job_application', confidence: 'high' };
  if (/(job.*opening|we.*hiring|apply now|job.*alert|new.*vacanc|job.*match|resume.*received|apply to jobs)/i.test(subjectLower))
    return { category: 'job_application', confidence: 'high' };

  // High confidence: Newsletter/Spam
  if (SPAM_DOMAINS.some(d => fromLower.includes(d)))
    return { category: 'newsletter_spam', confidence: 'high' };
  if (/^(alert|notification|promo|marketing|news|digest|update|campaign)@/i.test(fromLower))
    return { category: 'newsletter_spam', confidence: 'high' };
  if (/(your otp|otp is|verification code|₹.*debited|₹.*credited|inr.*debited|inr.*credited|transaction.*alert|account.*statement)/i.test(text))
    return { category: 'newsletter_spam', confidence: 'high' };
  if (/(unsubscribe|email preferences|view in browser|update your preferences|manage subscriptions)/i.test(text))
    return { category: 'newsletter_spam', confidence: 'high' };
  // Developer tool notifications (builds, deploys, CI/CD)
  if (/(build failed|deploy failed|deployment failed|build succeeded|pipeline failed|your .* has stopped|service .* stopped|verify your identity|verification code|security alert|credit card no|statement for)/i.test(subjectLower))
    return { category: 'newsletter_spam', confidence: 'high' };
  // Receipts and invoices from services
  if (/(your receipt|invoice available|gst invoice|payment received|billing statement)/i.test(subjectLower))
    return { category: 'newsletter_spam', confidence: 'high' };

  // Low confidence — needs AI
  if (/(demo|pricing|quote|rfp|rfq|interested in your|want to buy|purchase order)/i.test(text))
    return { category: 'sales_lead', confidence: 'low' };
  if (/(partnership|collaborate|joint venture|affiliate|referral|co-brand|sponsorship)/i.test(text))
    return { category: 'partnership_request', confidence: 'low' };
  if (/(support ticket|not working|bug report|complaint|help needed|issue with|refund)/i.test(text))
    return { category: 'customer_support', confidence: 'low' };
  if (/(meeting|schedule.*call|introduction|inquiry|inquire|information about)/i.test(text))
    return { category: 'business_inquiry', confidence: 'low' };

  return { category: 'other', confidence: 'low' };
}

// ─── STAGE 2: Gemini Combined Classify + Extract ────────────────────────────

const COMBINED_PROMPT = `You are an email analysis AI. Analyze the email and return ONLY valid JSON (no markdown, no backticks, no explanation).

CLASSIFY into exactly ONE category:
- business_inquiry: business questions, service inquiries, meeting requests, introductions
- partnership_request: collaboration, affiliate, joint venture, sponsorship proposals  
- sales_lead: buying intent, pricing/demo requests, RFPs, purchase inquiries
- job_application: resumes, cover letters, job seekers, recruiter outreach
- customer_support: existing customer issues, complaints, help/support requests
- newsletter_spam: marketing, newsletters, bank alerts, OTP, automated bulk mail
- other: anything that doesn't clearly fit above

EXTRACT all structured data found in the email.

Return this exact JSON:
{"category":"one_key","confidence":0.95,"phones":[],"emails":[],"addresses":[],"names":[],"companies":[],"websites":[],"dates":[],"summary":"One sentence about this email","custom":{}}

RULES:
- Only extract REAL data from the email. NEVER invent data.
- phones: include country code if present (+91, +1 etc).
- emails: only valid emails from the content body.
- names: human names only, not companies or email addresses.
- companies: business/organization names.
- websites: clean URLs, remove tracking params.
- addresses: physical addresses including Indian formats.
- dates: appointments, deadlines, meeting times mentioned.
- Empty array [] if nothing found. JSON only, no markdown.`;

async function geminiClassifyAndExtract(from, subject, snippet, bodyText) {
  const client = getGemini();
  if (!client || !checkDailyLimit()) return null;

  const emailContent = `From: ${from || 'unknown'}
Subject: ${subject || 'no subject'}
Body:
${(bodyText || snippet || 'no content').slice(0, 3000)}`;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [{ text: `${COMBINED_PROMPT}\n\nEMAIL:\n${emailContent}` }],
        },
      ],
      config: {
        temperature: 0.1,
        maxOutputTokens: 800,
        responseMimeType: 'application/json',
      },
    });

    dailyRequestCount++;

    const raw = response.text.trim();
    // Clean potential markdown wrapping
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    const category = CATEGORIES.includes(parsed.category) ? parsed.category : 'other';

    return {
      category,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      phones:    Array.isArray(parsed.phones)    ? parsed.phones    : [],
      emails:    Array.isArray(parsed.emails)    ? parsed.emails    : [],
      addresses: Array.isArray(parsed.addresses) ? parsed.addresses : [],
      names:     Array.isArray(parsed.names)     ? parsed.names     : [],
      companies: Array.isArray(parsed.companies) ? parsed.companies : [],
      websites:  Array.isArray(parsed.websites)  ? parsed.websites  : [],
      dates:     Array.isArray(parsed.dates)     ? parsed.dates     : [],
      summary:   parsed.summary || '',
      custom:    parsed.custom && typeof parsed.custom === 'object' ? parsed.custom : {},
    };
  } catch (err) {
    const msg = err.message || '';

    // Rate limit — back off
    if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
      console.warn('[Gemini] Rate limited. Using regex fallback.');
      return null;
    }

    console.warn('[Gemini] Error:', msg);
    return null;
  }
}

// ─── PUBLIC: classifyEmail (standalone) ─────────────────────────────────────

async function classifyEmail(subject, snippet, from) {
  const heuristic = heuristicPreFilter(from, subject, snippet);
  if (heuristic.confidence === 'high') return heuristic.category;

  const client = getGemini();
  if (!client || !checkDailyLimit()) return heuristic.category;

  try {
    const text = `From: ${from || ''}\nSubject: ${subject}\n\n${snippet}`.slice(0, 500);
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [{ text: `Classify this email into ONE category. Return ONLY the key: business_inquiry, partnership_request, sales_lead, job_application, customer_support, newsletter_spam, other\n\n${text}` }],
        },
      ],
      config: { temperature: 0, maxOutputTokens: 20 },
    });

    dailyRequestCount++;
    const result = response.text.trim().toLowerCase();
    return CATEGORIES.includes(result) ? result : heuristic.category;
  } catch {
    return heuristic.category;
  }
}

// ─── PUBLIC: extractFromEmail (standalone) ───────────────────────────────────

async function extractFromEmail(text) {
  const client = getGemini();
  if (!client || !checkDailyLimit()) return regexFallback(text);

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [{ text: `Extract contact data from this email. Return ONLY JSON:\n{"phones":[],"emails":[],"addresses":[],"names":[],"companies":[],"websites":[],"dates":[],"summary":"","custom":{}}\nRules: Only REAL data. No hallucination. Empty array if nothing. No markdown.\n\nEMAIL:\n${text.slice(0, 3000)}` }],
        },
      ],
      config: {
        temperature: 0.1,
        maxOutputTokens: 800,
        responseMimeType: 'application/json',
      },
    });

    dailyRequestCount++;
    const raw = response.text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(raw);

    return {
      phones:    Array.isArray(parsed.phones)    ? parsed.phones    : [],
      emails:    Array.isArray(parsed.emails)    ? parsed.emails    : [],
      addresses: Array.isArray(parsed.addresses) ? parsed.addresses : [],
      names:     Array.isArray(parsed.names)     ? parsed.names     : [],
      companies: Array.isArray(parsed.companies) ? parsed.companies : [],
      websites:  Array.isArray(parsed.websites)  ? parsed.websites  : [],
      dates:     Array.isArray(parsed.dates)     ? parsed.dates     : [],
      summary:   parsed.summary || '',
      custom:    parsed.custom && typeof parsed.custom === 'object' ? parsed.custom : {},
    };
  } catch (err) {
    console.warn('[Gemini] Extract error:', err.message);
    return regexFallback(text);
  }
}

// ─── PUBLIC: classifyAndExtract (combined — used by email.js) ───────────────

async function classifyAndExtract(from, subject, snippet, bodyText) {
  // Stage 1: Heuristic
  const heuristic = heuristicPreFilter(from, subject, snippet);

  if (heuristic.confidence === 'high') {
    const extracted = regexFallback(`${from} ${subject} ${snippet} ${bodyText || ''}`);
    return { category: heuristic.category, confidence: 0.95, ...extracted, summary: '' };
  }

  // Stage 2: Gemini combined call
  const geminiResult = await geminiClassifyAndExtract(from, subject, snippet, bodyText);
  if (geminiResult) return geminiResult;

  // Fallback: heuristic + regex
  const extracted = regexFallback(`${from} ${subject} ${snippet} ${bodyText || ''}`);
  return { category: heuristic.category, confidence: 0.3, ...extracted, summary: '' };
}

// ─── Regex Fallback ─────────────────────────────────────────────────────────

function regexFallback(text) {
  const phones = [
    ...new Set(
      (text.match(/(\+?\d[\d\s\-().]{7,}\d)/g) || []).map(p => p.trim())
    ),
  ];
  const emails = [
    ...new Set(
      (text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [])
    ),
  ];
  const websites = [
    ...new Set(
      (text.match(/https?:\/\/[^\s"'<>]+/g) || [])
    ),
  ];
  const addressLines = text.split('\n').filter(line =>
    /\d+\s+\w/.test(line) &&
    /(street|st|avenue|ave|road|rd|blvd|lane|ln|drive|dr|way|court|ct|plaza|square|block|nagar|sector|colony|phase|mohalla|gali|chowk)/i.test(line)
  );

  return {
    phones,
    emails,
    addresses: addressLines.map(l => l.trim()),
    names:     [],
    companies: [],
    websites,
    dates:     [],
    custom:    {},
  };
}

module.exports = {
  classifyEmail,
  extractFromEmail,
  classifyAndExtract,
  heuristicPreFilter,
  CATEGORIES,
};