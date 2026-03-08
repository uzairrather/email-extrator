const express = require('express');
const authMiddleware = require('../middleware/auth');
const ExtractedData = require('../models/ExtractedData');

const router = express.Router();
router.use(authMiddleware);

// GET /api/data — list extracted data with pagination & filters
// Default: only shows 'extracted' records, newest first
// Pass status=all to see everything, status=skipped to see skipped only
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      accountId,
      status = 'extracted',   // DEFAULT: only extracted records
      search,
      hasPhone,
      hasAddress,
      category,
      sort = 'newest',
    } = req.query;

    const filter = { userId: req.user._id };
    if (accountId) filter.emailAccountId = accountId;

    // Status filter: 'all' shows everything, otherwise filter by status
    if (status && status !== 'all') {
      filter.status = status;
    }

    // Category filter: exclude newsletter_spam by default unless explicitly requested
    if (category) {
      filter.category = category;
    } else if (status !== 'all') {
      // When showing extracted records, never show spam
      filter.category = { $ne: 'newsletter_spam' };
    }

    if (hasPhone === 'true') filter['extractedFields.phones.0'] = { $exists: true };
    if (hasAddress === 'true') filter['extractedFields.addresses.0'] = { $exists: true };

    if (search) {
      filter.$or = [
        { subject: { $regex: search, $options: 'i' } },
        { fromEmail: { $regex: search, $options: 'i' } },
        { fromName: { $regex: search, $options: 'i' } },
        { 'extractedFields.phones': { $regex: search, $options: 'i' } },
        { 'extractedFields.addresses': { $regex: search, $options: 'i' } },
        { 'extractedFields.companies': { $regex: search, $options: 'i' } },
        { 'extractedFields.names': { $regex: search, $options: 'i' } },
        { 'extractedFields.emails': { $regex: search, $options: 'i' } },
      ];
    }

    // Sort: newest first by default
    const sortOrder = sort === 'oldest' ? { receivedAt: 1 } : { receivedAt: -1 };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [data, total] = await Promise.all([
      ExtractedData.find(filter)
        .sort(sortOrder)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ExtractedData.countDocuments(filter),
    ]);

    res.json({
      data,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)) || 1,
        limit: parseInt(limit),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/data/stats — summary counts
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user._id;

    // Only count extracted records for the main stats
    const extractedFilter = { userId, status: 'extracted' };

    const [total, extracted, withPhone, withAddress, withCompany, byStatus, byCategory] = await Promise.all([
      ExtractedData.countDocuments({ userId }),
      ExtractedData.countDocuments(extractedFilter),
      ExtractedData.countDocuments({ ...extractedFilter, 'extractedFields.phones.0': { $exists: true } }),
      ExtractedData.countDocuments({ ...extractedFilter, 'extractedFields.addresses.0': { $exists: true } }),
      ExtractedData.countDocuments({ ...extractedFilter, 'extractedFields.companies.0': { $exists: true } }),
      ExtractedData.aggregate([
        { $match: { userId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      ExtractedData.aggregate([
        { $match: { userId } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ]),
    ]);

    const statusMap   = byStatus.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {});
    const categoryMap = byCategory.reduce((acc, c) => { acc[c._id] = c.count; return acc; }, {});

    res.json({
      total,
      extracted,
      withPhone,
      withAddress,
      withCompany,
      pending:     statusMap.pending    || 0,
      failed:      statusMap.failed     || 0,
      skipped:     statusMap.skipped    || 0,
      byCategory:  categoryMap,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/data/export — export only extracted records as CSV
router.get('/export', async (req, res) => {
  try {
    const { category } = req.query;
    const filter = { userId: req.user._id, status: 'extracted' };
    if (category) filter.category = category;

    const data = await ExtractedData.find(filter)
      .sort({ receivedAt: -1 })
      .lean();

    const rows = [
      ['Subject', 'From Name', 'From Email', 'Category', 'Date', 'Phones', 'Addresses', 'Companies', 'Names', 'Websites', 'Emails', 'Summary'],
      ...data.map((d) => [
        `"${(d.subject || '').replace(/"/g, '""')}"`,
        `"${(d.fromName || '').replace(/"/g, '""')}"`,
        d.fromEmail || '',
        d.category || '',
        d.receivedAt ? new Date(d.receivedAt).toISOString().split('T')[0] : '',
        `"${(d.extractedFields?.phones || []).join('; ')}"`,
        `"${(d.extractedFields?.addresses || []).join('; ')}"`,
        `"${(d.extractedFields?.companies || []).join('; ')}"`,
        `"${(d.extractedFields?.names || []).join('; ')}"`,
        `"${(d.extractedFields?.websites || []).join('; ')}"`,
        `"${(d.extractedFields?.emails || []).join('; ')}"`,
        `"${(d.extractedFields?.summary || '').replace(/"/g, '""')}"`,
      ]),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="extracted_data.csv"');
    res.send(rows.map((r) => r.join(',')).join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/data/:id
router.delete('/:id', async (req, res) => {
  try {
    await ExtractedData.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;