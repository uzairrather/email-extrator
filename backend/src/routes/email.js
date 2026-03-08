const express = require('express');
const authMiddleware = require('../middleware/auth');
const EmailAccount = require('../models/EmailAccount');
const ExtractedData = require('../models/ExtractedData');
const gmailService = require('../services/gmailService');
const outlookService = require('../services/outlookService');
const {
  classifyAndExtract,
  heuristicPreFilter,
  CATEGORIES,
} = require('../services/extractorService');

const router = express.Router();
router.use(authMiddleware);

// GET /api/email/categories
router.get('/categories', (req, res) => {
  const labels = {
    business_inquiry:    'Business Inquiry',
    partnership_request: 'Partnership Request',
    sales_lead:          'Sales Lead',
    job_application:     'Job Application',
    customer_support:    'Customer Support',
    newsletter_spam:     'Newsletter/Spam (skip)',
    other:               'Any email (no filter)',
  };
  res.json({ categories: CATEGORIES.map(k => ({ key: k, label: labels[k] })) });
});

// GET /api/email/accounts
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await EmailAccount.find({ userId: req.user._id, isActive: true })
      .select('-accessToken -refreshToken')
      .lean();
    res.json({ accounts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/email/accounts/:id
router.delete('/accounts/:id', async (req, res) => {
  try {
    await EmailAccount.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { isActive: false }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/email/sync/:accountId
 *
 * Body: { categories: ['sales_lead', ...] }
 *
 * Flow:
 *   1. Fetch unread emails
 *   2. Skip already-extracted emails
 *   3. Re-process previously skipped emails if they match NEW category selection
 *   4. New emails: heuristic pre-filter → Gemini classify+extract → save
 */
router.post('/sync/:accountId', async (req, res) => {
  try {
    const account = await EmailAccount.findOne({
      _id: req.params.accountId,
      userId: req.user._id,
      isActive: true,
    });

    if (!account) return res.status(404).json({ error: 'Account not found' });

    const selectedCategories = Array.isArray(req.body.categories) && req.body.categories.length
      ? req.body.categories
      : null;

    const extractAll = !selectedCategories || selectedCategories.includes('other');

    const service = account.provider === 'gmail' ? gmailService : outlookService;
    const emails = await service.fetchUnreadEmails(account, 50);

    if (!emails.length) {
      return res.json({ message: 'No unread emails found', processed: 0, skipped: 0 });
    }

    let processed = 0;
    let skipped = 0;
    const results = [];

    for (const email of emails) {
      // ── Check existing record ──
      const existing = await ExtractedData.findOne({
        userId: req.user._id,
        emailId: email.id,
        emailAccountId: account._id,
      });

      // Already extracted → always skip
      if (existing && existing.status === 'extracted') {
        skipped++;
        continue;
      }

      // Previously skipped → re-check if it matches NEW selection
      if (existing && existing.status === 'skipped') {
        const nowMatches = extractAll
          ? existing.category !== 'newsletter_spam'
          : selectedCategories.includes(existing.category);

        if (!nowMatches) {
          skipped++;
          continue;
        }

        // Matches now → re-process with full extraction
        let bodyText = email.snippet;
        try { bodyText = await service.getEmailBody(account, email.id); } catch (_) {}

        let result;
        try {
          result = await classifyAndExtract(email.fromEmail, email.subject, email.snippet, bodyText);
        } catch (err) {
          console.error('[Sync] Re-process error:', email.id, err.message);
          skipped++;
          continue;
        }

        const aiMatches = extractAll
          ? result.category !== 'newsletter_spam'
          : selectedCategories.includes(result.category);

        if (!aiMatches) {
          await ExtractedData.findByIdAndUpdate(existing._id, { category: result.category, status: 'skipped' });
          skipped++;
          continue;
        }

        const { category, confidence, summary, ...extractedFields } = result;
        await ExtractedData.findByIdAndUpdate(existing._id, {
          category,
          status: 'extracted',
          extractedFields: { ...extractedFields, summary: summary || '' },
        });
        results.push({ emailId: email.id, subject: email.subject, category, confidence, extracted: extractedFields });
        processed++;
        continue;
      }

      // Failed → delete and retry
      if (existing && existing.status === 'failed') {
        await ExtractedData.findByIdAndDelete(existing._id);
      }

      // ── NEW EMAIL ──

      // Stage 1: Heuristic pre-filter (FREE)
      const heuristic = heuristicPreFilter(email.fromEmail, email.subject, email.snippet);

      if (heuristic.confidence === 'high') {
        const matchesSelection = extractAll
          ? heuristic.category !== 'newsletter_spam'
          : selectedCategories.includes(heuristic.category);

        if (!matchesSelection) {
          try {
            await ExtractedData.create({
              userId: req.user._id, emailAccountId: account._id, emailId: email.id,
              subject: email.subject, fromEmail: email.fromEmail, fromName: email.fromName,
              receivedAt: email.date ? new Date(email.date) : null,
              rawSnippet: email.snippet, category: heuristic.category, status: 'skipped',
            });
          } catch (dupErr) { if (dupErr.code !== 11000) throw dupErr; }
          skipped++;
          continue;
        }
      }

      // Stage 2: Get full body
      let bodyText = email.snippet;
      try { bodyText = await service.getEmailBody(account, email.id); } catch (_) {}

      // Stage 3: Gemini classify + extract
      let result;
      try {
        result = await classifyAndExtract(email.fromEmail, email.subject, email.snippet, bodyText);
      } catch (err) {
        console.error('[Sync] classifyAndExtract error:', email.id, err.message);
        result = {
          category: heuristic.category, confidence: 0.2,
          phones: [], emails: [], addresses: [], names: [],
          companies: [], websites: [], dates: [], summary: '', custom: {},
        };
      }

      // Stage 4: Check if matches selection
      const categoryMatches = extractAll
        ? result.category !== 'newsletter_spam'
        : selectedCategories.includes(result.category);

      if (!categoryMatches) {
        try {
          await ExtractedData.create({
            userId: req.user._id, emailAccountId: account._id, emailId: email.id,
            subject: email.subject, fromEmail: email.fromEmail, fromName: email.fromName,
            receivedAt: email.date ? new Date(email.date) : null,
            rawSnippet: email.snippet, category: result.category, status: 'skipped',
          });
        } catch (dupErr) { if (dupErr.code !== 11000) throw dupErr; }
        skipped++;
        continue;
      }

      // Stage 5: Save extracted
      const { category, confidence, summary, ...extractedFields } = result;
      try {
        await ExtractedData.create({
          userId: req.user._id, emailAccountId: account._id, emailId: email.id,
          subject: email.subject, fromEmail: email.fromEmail, fromName: email.fromName,
          receivedAt: email.date ? new Date(email.date) : null,
          rawSnippet: email.snippet, category, status: 'extracted',
          extractedFields: { ...extractedFields, summary: summary || '' },
        });
        results.push({ emailId: email.id, subject: email.subject, category, confidence, extracted: extractedFields });
        processed++;
      } catch (dupErr) {
        if (dupErr.code === 11000) { skipped++; continue; }
        throw dupErr;
      }
    }

    await EmailAccount.findByIdAndUpdate(account._id, { lastSyncAt: new Date() });

    res.json({
      message: processed > 0
        ? `Found ${processed} matching emails (${skipped} skipped)`
        : `No ${selectedCategories ? selectedCategories.join('/') : ''} emails found in ${emails.length} unread emails`,
      processed,
      skipped,
      total: emails.length,
      selectedCategories: selectedCategories || ['all'],
      results,
    });
  } catch (err) {
    console.error('[Sync] Fatal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;