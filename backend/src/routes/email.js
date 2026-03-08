const express = require('express');
const authMiddleware = require('../middleware/auth');
const EmailAccount = require('../models/EmailAccount');
const ExtractedData = require('../models/ExtractedData');
const gmailService = require('../services/gmailService');
const outlookService = require('../services/outlookService');
const {
  classifyAndExtract,
  heuristicPreFilter,
  isGeminiAvailable,
  CATEGORIES,
} = require('../services/extractorService');

const router = express.Router();
router.use(authMiddleware);

// ─── In-memory sync progress tracker ────────────────────────────────────────
const syncProgress = new Map();

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

// GET /api/email/sync-status/:accountId — poll sync progress
// GET /api/email/ai-status — check if AI extraction is available
router.get('/ai-status', (req, res) => {
  res.json(isGeminiAvailable());
});

router.get('/sync-status/:accountId', (req, res) => {
  const key = `${req.user._id}_${req.params.accountId}`;
  const progress = syncProgress.get(key);

  if (!progress) {
    return res.json({ status: 'idle' });
  }

  res.json(progress);

  // Clean up if done
  if (progress.done) {
    setTimeout(() => syncProgress.delete(key), 30000);
  }
});

/**
 * POST /api/email/sync/:accountId
 * Returns immediately, processes in background.
 * Frontend polls GET /sync-status/:accountId for progress.
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

    const key = `${req.user._id}_${account._id}`;

    // Check if already syncing
    const existing = syncProgress.get(key);
    if (existing && !existing.done) {
      return res.json({ background: true, message: 'Sync already in progress' });
    }

    // Check AI availability
    const aiStatus = isGeminiAvailable();

    // Initialize progress
    syncProgress.set(key, {
      done: false,
      total: 0,
      current: 0,
      processed: 0,
      skipped: 0,
      status: 'fetching',
      message: 'Clearing old data & fetching emails...',
      aiAvailable: aiStatus.available,
      aiWarning: aiStatus.reason,
    });

    // Return immediately with AI status
    res.json({
      background: true,
      message: 'Sync started',
      aiAvailable: aiStatus.available,
      aiWarning: aiStatus.reason,
    });

    // ─── Background processing ──────────────────────────────────────────
    (async () => {
      try {
        // Delete all previous records for this account (fresh sync)
        await ExtractedData.deleteMany({
          userId: req.user._id,
          emailAccountId: account._id,
        });

        const extractAll = !selectedCategories || selectedCategories.includes('other');
        const service = account.provider === 'gmail' ? gmailService : outlookService;
        const emails = await service.fetchUnreadEmails(account, 50);

        syncProgress.set(key, {
          ...syncProgress.get(key),
          total: emails.length,
          status: 'processing',
          message: `Processing ${emails.length} emails...`,
        });

        if (!emails.length) {
          syncProgress.set(key, {
            done: true, total: 0, current: 0, processed: 0, skipped: 0,
            status: 'complete', message: 'No unread emails found',
          });
          return;
        }

        let processed = 0;
        let skipped = 0;

        for (let i = 0; i < emails.length; i++) {
          const email = emails[i];

          // Update progress
          syncProgress.set(key, {
            ...syncProgress.get(key),
            current: i + 1,
            processed,
            skipped,
            message: `Processing ${i + 1} / ${emails.length}...`,
          });

          // ── Check existing record ──
          const existingRecord = await ExtractedData.findOne({
            userId: req.user._id,
            emailId: email.id,
            emailAccountId: account._id,
          });

          if (existingRecord && existingRecord.status === 'extracted') {
            skipped++;
            continue;
          }

          // Previously skipped → re-check if matches NEW selection
          if (existingRecord && existingRecord.status === 'skipped') {
            const nowMatches = extractAll
              ? existingRecord.category !== 'newsletter_spam'
              : selectedCategories.includes(existingRecord.category);

            if (!nowMatches) {
              skipped++;
              continue;
            }

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
              await ExtractedData.findByIdAndUpdate(existingRecord._id, { category: result.category, status: 'skipped' });
              skipped++;
              continue;
            }

            const { category, confidence, summary, ...extractedFields } = result;
            await ExtractedData.findByIdAndUpdate(existingRecord._id, {
              category, status: 'extracted',
              extractedFields: { ...extractedFields, summary: summary || '' },
            });
            processed++;
            continue;
          }

          // Failed → delete and retry
          if (existingRecord && existingRecord.status === 'failed') {
            await ExtractedData.findByIdAndDelete(existingRecord._id);
          }

          // ── NEW EMAIL ──
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
              } catch (dupErr) { if (dupErr.code !== 11000) console.error(dupErr); }
              skipped++;
              continue;
            }
          }

          // Get full body
          let bodyText = email.snippet;
          try { bodyText = await service.getEmailBody(account, email.id); } catch (_) {}

          // Gemini classify + extract
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

          // Check if matches selection
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
            } catch (dupErr) { if (dupErr.code !== 11000) console.error(dupErr); }
            skipped++;
            continue;
          }

          // Save extracted
          const { category, confidence, summary, ...extractedFields } = result;
          try {
            await ExtractedData.create({
              userId: req.user._id, emailAccountId: account._id, emailId: email.id,
              subject: email.subject, fromEmail: email.fromEmail, fromName: email.fromName,
              receivedAt: email.date ? new Date(email.date) : null,
              rawSnippet: email.snippet, category, status: 'extracted',
              extractedFields: { ...extractedFields, summary: summary || '' },
            });
            processed++;
          } catch (dupErr) {
            if (dupErr.code === 11000) { skipped++; continue; }
            console.error(dupErr);
          }
        }

        // Update last sync time
        await EmailAccount.findByIdAndUpdate(account._id, { lastSyncAt: new Date() });

        // Mark complete
        syncProgress.set(key, {
          done: true,
          total: emails.length,
          current: emails.length,
          processed,
          skipped,
          status: 'complete',
          message: processed > 0
            ? `Found ${processed} matching emails (${skipped} skipped)`
            : `No matching emails found in ${emails.length} unread emails`,
        });

      } catch (err) {
        console.error('[Sync] Background error:', err.message);
        syncProgress.set(key, {
          done: true, total: 0, current: 0, processed: 0, skipped: 0,
          status: 'error', message: err.message,
        });
      }
    })();

  } catch (err) {
    console.error('[Sync] Fatal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;