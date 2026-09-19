const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const path = require('node:path');
const { isIP } = require('node:net');

const emailPattern = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const successMessage = 'Thank you! Your message has been sent. We will reply by email.';
const unavailableMessage = 'Messages are temporarily unavailable. Please email us directly.';

function validateContact(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const limits = { name: [2, 100], email: [3, 254], institute: [0, 150], phone: [0, 40], message: [10, 5000] };
  const contact = {};

  for (const [field, [min, max]] of Object.entries(limits)) {
    const value = body[field] ?? '';
    if (typeof value !== 'string') return null;
    contact[field] = value.trim();
    if (contact[field].length < min || contact[field].length > max) return null;
    if (field !== 'message' && /[\x00-\x1f\x7f]/.test(contact[field])) return null;
  }

  return emailPattern.test(contact.email) ? contact : null;
}

function createApp({ env = process.env, sendRequest = fetch } = {}) {
  const app = express();
  const onRailway = Boolean(env.RAILWAY_PROJECT_ID);
  app.disable('x-powered-by');
  // Hosted services receive public traffic through their edge proxy.
  if (onRailway || env.RENDER === 'true') app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const contactLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Railway supplies the visitor address in X-Real-IP, including IPv6 clients.
      const railwayIp = onRailway && req.get('x-real-ip');
      return ipKeyGenerator(railwayIp && isIP(railwayIp) ? railwayIp : req.ip);
    },
    message: { message: 'Too many messages. Please try again in 15 minutes or email us directly.' },
  });

  app.post('/api/contact', contactLimit, express.json({ limit: '24kb' }), async (req, res) => {
    const origin = req.get('origin');
    if (origin) {
      try {
        const host = (onRailway && req.get('x-forwarded-host')) || req.get('host');
        if (new URL(origin).host !== host) return res.status(403).json({ message: 'Please send your message from this website.' });
      } catch {
        return res.status(403).json({ message: 'Please send your message from this website.' });
      }
    }

    if (!req.is('application/json')) return res.status(415).json({ message: 'Please use the contact form to send your message.' });
    if (req.body?.website) return res.status(400).json({ message: 'Your message could not be submitted.' });

    const contact = validateContact(req.body);
    if (!contact) return res.status(400).json({ message: 'Please check your name, email and message, then try again.' });

    const from = env.CONTACT_FROM_EMAIL?.trim();
    const to = env.CONTACT_TO_EMAIL?.trim() || 'shopifyorchis@gmail.com';
    if (!env.RESEND_API_KEY?.trim() || !from || !emailPattern.test(from) || !emailPattern.test(to)) {
      return res.status(503).json({ message: unavailableMessage });
    }

    try {
      const response = await sendRequest('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          from: `EduOp CRM <${from}>`,
          to: [to],
          reply_to: contact.email,
          subject: 'New EduOp CRM contact enquiry',
          text: [
            `Name: ${contact.name}`,
            `Email: ${contact.email}`,
            `Institute: ${contact.institute || 'Not provided'}`,
            `Phone: ${contact.phone || 'Not provided'}`,
            '',
            'Message:',
            contact.message,
          ].join('\n'),
        }),
      });

      if (!response.ok) {
        console.error('Contact email rejected by provider:', response.status);
        return res.status(502).json({ message: unavailableMessage });
      }
      const result = await response.json();
      if (!result.id) return res.status(502).json({ message: unavailableMessage });

      return res.json({ message: successMessage });
    } catch {
      console.error('Contact email request could not be confirmed.');
      return res.status(502).json({ message: 'We could not confirm your message was sent. Please try again or email us directly.' });
    }
  });

  // Only public website files are served; server code and environment files stay private.
  app.get(['/', '/index.html'], (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
  for (const file of ['styles.css', 'script.js']) {
    app.get(`/${file}`, (_req, res) => res.sendFile(path.join(__dirname, file)));
  }
  app.use('/assets', express.static(path.join(__dirname, 'assets'), { dotfiles: 'deny', index: false }));
  app.use((_req, res) => res.status(404).json({ message: 'Not found.' }));
  app.use((error, _req, res, _next) => {
    const status = error.type === 'entity.too.large' ? 413 : error.status === 400 ? 400 : 500;
    const message = status === 413 ? 'Your message is too long. Please shorten it and try again.' : 'Your request could not be processed. Please try again.';
    res.status(status).json({ message });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  createApp().listen(port, '0.0.0.0', () => {
    console.log(`EduOp CRM is running on port ${port}`);
    if (!process.env.RESEND_API_KEY || !process.env.CONTACT_FROM_EMAIL) {
      console.log('Contact email is not configured. Set RESEND_API_KEY and CONTACT_FROM_EMAIL.');
    }
  });
}

module.exports = { createApp };
