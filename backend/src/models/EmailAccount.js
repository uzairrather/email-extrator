const mongoose = require('mongoose');

const emailAccountSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  provider:     { type: String, enum: ['gmail', 'outlook'], required: true },
  email:        { type: String, required: true },
  accessToken:  { type: String, required: true },
  refreshToken: { type: String },
  tokenExpiry:  { type: Date },
  lastSyncAt:   { type: Date },
  isActive:     { type: Boolean, default: true },
}, { timestamps: true });

emailAccountSchema.index({ userId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('EmailAccount', emailAccountSchema);
