const mongoose = require('mongoose');

const extractedDataSchema = new mongoose.Schema({
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  emailAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailAccount', required: true },
  emailId:        { type: String, required: true },
  subject:        { type: String },
  fromEmail:      { type: String },
  fromName:       { type: String },
  receivedAt:     { type: Date },
  extractedFields: {
    phones:    [String],
    emails:    [String],
    addresses: [String],
    names:     [String],
    companies: [String],
    websites:  [String],
    dates:     [String],
    custom:    { type: mongoose.Schema.Types.Mixed },
  },
  rawSnippet: { type: String },
  category:   {
    type: String,
    enum: ['business_inquiry', 'partnership_request', 'sales_lead', 'job_application', 'customer_support', 'newsletter_spam', 'other'],
    default: 'other',
    index: true,
  },
  status:     { type: String, enum: ['pending', 'extracted', 'failed', 'skipped'], default: 'pending', index: true },
}, { timestamps: true });

extractedDataSchema.index({ userId: 1, emailId: 1, emailAccountId: 1 }, { unique: true });

module.exports = mongoose.model('ExtractedData', extractedDataSchema);
