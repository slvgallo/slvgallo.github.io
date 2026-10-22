// Plain text and attributes must be escaped; authored description HTML is trusted.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function serializeJson(value) {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
}

function urlAttribute(value) {
  const url = String(value ?? '');
  // Reject executable schemes, including schemes obscured by control characters.
  const normalized = url.replace(/[\u0000-\u0020]/g, '');
  if (/^[a-z][a-z\d+.-]*:/i.test(normalized) && !/^https?:/i.test(normalized)) {
    throw new Error('Only HTTP(S) and relative URLs are allowed');
  }
  return escapeHtml(url);
}

function assertWorkId(id) {
  if (typeof id !== 'string' || !/^\d{4}-\d+$/.test(id)) {
    throw new Error(`Invalid work ID: ${id}`);
  }
}

module.exports = { escapeHtml, serializeJson, urlAttribute, assertWorkId };
