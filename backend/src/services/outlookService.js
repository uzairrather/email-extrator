const axios = require('axios');

class OutlookService {
  _headers(account) {
    return { Authorization: `Bearer ${account.accessToken}` };
  }

  async fetchUnreadEmails(account, maxResults = 50) {
    const res = await axios.get(
      `https://graph.microsoft.com/v1.0/me/messages?$filter=isRead eq false&$top=${maxResults}&$select=id,subject,from,receivedDateTime,bodyPreview`,
      { headers: this._headers(account) }
    );

    return (res.data.value || []).map((msg) => ({
      id:        msg.id,
      subject:   msg.subject || '(no subject)',
      fromName:  msg.from?.emailAddress?.name || '',
      fromEmail: msg.from?.emailAddress?.address || '',
      date:      msg.receivedDateTime,
      snippet:   msg.bodyPreview || '',
    }));
  }

  async getEmailBody(account, messageId) {
    const res = await axios.get(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}?$select=body`,
      { headers: this._headers(account) }
    );
    // Strip HTML tags for plain text
    return (res.data.body?.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

module.exports = new OutlookService();
