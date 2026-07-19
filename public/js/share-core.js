(function exposeShareCore(root, factory) {
  'use strict';

  const share = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = share;
  } else {
    root.XRRCShareCore = share;
  }
})(typeof window === 'undefined' ? globalThis : window, function createShareCore() {
  'use strict';

  function composeShareMessage(text, url) {
    const message = String(text || '').trim();
    const shareUrl = String(url || '').trim();
    if (!shareUrl) throw new TypeError('A room URL is required.');
    return message ? `${message}\n\n${shareUrl}` : shareUrl;
  }

  function buildShareTargets({ title, text, url } = {}) {
    const subject = String(title || '').trim();
    const message = composeShareMessage(text, url);
    return Object.freeze({
      email: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`,
      sms: `sms:?body=${encodeURIComponent(message)}`,
      whatsapp: `https://wa.me/?text=${encodeURIComponent(message)}`,
    });
  }

  return Object.freeze({
    buildShareTargets,
    composeShareMessage,
  });
});
