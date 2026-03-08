const { google } = require('googleapis');

class GmailService {
  _getAuth(account) {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALLBACK_URL
    );
    auth.setCredentials({
      access_token:  account.accessToken,
      refresh_token: account.refreshToken,
      expiry_date:   account.tokenExpiry ? new Date(account.tokenExpiry).getTime() : undefined,
    });
    return auth;
  }

  async fetchUnreadEmails(account, maxResults = 50) {
    const gmail = google.gmail({ version: 'v1', auth: this._getAuth(account) });

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults,
    });

    if (!listRes.data.messages?.length) return [];

    const emails = await Promise.all(
      listRes.data.messages.map(({ id }) =>
        gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date'],
        })
      )
    );

    return emails.map(({ data }) => {
      const h = (data.payload?.headers || []).reduce((acc, hdr) => {
        acc[hdr.name] = hdr.value;
        return acc;
      }, {});

      const from = h['From'] || '';
      const nameMatch = from.match(/^"?([^"<]+)"?\s*<?/);
      const emailMatch = from.match(/<(.+?)>/) || [, from];

      return {
        id:        data.id,
        subject:   h['Subject'] || '(no subject)',
        fromName:  nameMatch ? nameMatch[1].trim() : '',
        fromEmail: emailMatch[1]?.trim() || '',
        date:      h['Date'],
        snippet:   data.snippet || '',
      };
    });
  }

  async getEmailBody(account, messageId) {
    const gmail = google.gmail({ version: 'v1', auth: this._getAuth(account) });
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const extractText = (parts) => {
      if (!parts) return '';
      return parts
        .map((p) => {
          if (p.mimeType === 'text/plain' && p.body?.data) {
            return Buffer.from(p.body.data, 'base64').toString('utf-8');
          }
          if (p.parts) return extractText(p.parts);
          return '';
        })
        .join('\n');
    };

    const payload = res.data.payload;
    if (payload?.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
    return extractText(payload?.parts);
  }
}

module.exports = new GmailService();
