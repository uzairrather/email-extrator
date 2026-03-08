const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const EmailAccount = require('../models/EmailAccount');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// ─── Google OAuth ────────────────────────────────────────────────────────────

const googleOAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL
);

// Step 1: Redirect user to Google
router.get('/google', authMiddleware, (req, res) => {
  const url = googleOAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    state: req.user._id.toString(),
  });
  res.json({ url });
});

// Step 2: Google callback
router.get('/google/callback', async (req, res) => {
  try {
    const { code, state: userId } = req.query;
    const { tokens } = await googleOAuth2Client.getToken(code);
    googleOAuth2Client.setCredentials(tokens);

    // Get user info
    const oauth2 = google.oauth2({ version: 'v2', auth: googleOAuth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    await EmailAccount.findOneAndUpdate(
      { userId, email: profile.email },
      {
        userId,
        provider: 'gmail',
        email: profile.email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        isActive: true,
      },
      { upsert: true, new: true }
    );

    res.redirect(`${process.env.CLIENT_URL}/dashboard?connected=gmail`);
  } catch (err) {
    console.error('Google callback error:', err.message);
    res.redirect(`${process.env.CLIENT_URL}/dashboard?error=gmail_failed`);
  }
});

// ─── Microsoft / Outlook OAuth ───────────────────────────────────────────────

router.get('/outlook', authMiddleware, (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: process.env.MICROSOFT_CALLBACK_URL,
    scope: 'openid email profile Mail.Read offline_access',
    state: req.user._id.toString(),
  });
  res.json({ url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}` });
});

router.get('/outlook/callback', async (req, res) => {
  try {
    const { code, state: userId } = req.query;

    const tokenRes = await axios.post(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      new URLSearchParams({
        client_id:     process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        code,
        redirect_uri:  process.env.MICROSOFT_CALLBACK_URL,
        grant_type:    'authorization_code',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    // Get user profile
    const profileRes = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const profile = profileRes.data;
    const email = profile.mail || profile.userPrincipalName;

    await EmailAccount.findOneAndUpdate(
      { userId, email },
      {
        userId,
        provider: 'outlook',
        email,
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpiry: new Date(Date.now() + expires_in * 1000),
        isActive: true,
      },
      { upsert: true, new: true }
    );

    res.redirect(`${process.env.CLIENT_URL}/dashboard?connected=outlook`);
  } catch (err) {
    console.error('Outlook callback error:', err.message);
    res.redirect(`${process.env.CLIENT_URL}/dashboard?error=outlook_failed`);
  }
});

// ─── App Login (simple email/name → JWT) ─────────────────────────────────────

router.post('/login', async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = await User.create({ email: email.toLowerCase(), name: name || email.split('@')[0] });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
