require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const { Client, Environment, WebhooksHelper } = require('square');
const QRCode     = require('qrcode');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use('/api/webhook-square', express.raw({ type: 'application/json' }));
app.use(express.json());

const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: process.env.NODE_ENV === 'production'
    ? Environment.Production
    : Environment.Sandbox,
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

async function generateQR(payload) {
  return await QRCode.toDataURL(JSON.stringify(payload), {
    width: 300, margin: 2,
    color: { dark: '#06080f', light: '#ffffff' },
  });
}

function getTierLabel(amount) {
  if (amount <= 500) return 'Precommande';
  if (amount <= 2000) return 'Regulier';
  return 'A la porte';
}

function buildEmail(confirmationId, name, email, amount, qrDataUrl) {
  const tierLabel = getTierLabel(amount);
  const total = (amount / 100).toLocaleString('fr-CA', { minimumFractionDigits: 2 });
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Billet GT Nights</title></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
  <tr><td align="center">
    <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td style="background:#06080f;padding:36px 40px 28px;">
        <div style="font-size:28px;letter-spacing:4px;color:#f0f4ff;font-weight:bold;">GT NIGHTS</div>
        <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#60a5fa;margin-top:4px;">Edition 01 — Bleu Out</div>
      </td></tr>
      <tr><td style="background:#0a0d18;padding:28px 40px 24px;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:13px;color:#60a5fa;letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px;">Billet confirme</div>
        <div style="font-size:52px;color:#f0f4ff;line-height:.9;margin-bottom:8px;font-weight:bold;">BLEU<br><span style="color:#60a5fa;">OUT</span></div>
        <div style="font-size:14px;color:rgba(240,244,255,0.5);">Vendredi 26 juin 2026 · 21h - 1h · Salle des Ormeaux, Trois-Rivieres</div>
      </td></tr>
      <tr><td style="padding:36px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="55%" style="vertical-align:top;padding-right:32px;">
              <div style="margin-bottom:20px;">
                <div style="font-size:11px;color:#888;text-transform:uppercase;margin-bottom:4px;">Titulaire</div>
                <div style="font-size:17px;font-weight:bold;color:#111;">${name}</div>
              </div>
              <div style="margin-bottom:20px;">
                <div style="font-size:11px;color:#888;text-transform:uppercase;margin-bottom:4px;">Type de billet</div>
                <div style="font-size:17px;font-weight:bold;color:#111;">${tierLabel}</div>
              </div>
              <div style="margin-bottom:20px;">
                <div style="font-size:11px;color:#888;text-transform:uppercase;margin-bottom:4px;">Confirmation</div>
                <div style="font-size:14px;font-family:monospace;color:#1d6ef5;font-weight:bold;">${confirmationId}</div>
              </div>
              <div style="margin-bottom:20px;">
                <div style="font-size:11px;color:#888;text-transform:uppercase;margin-bottom:4px;">Total paye</div>
                <div style="font-size:17px;font-weight:bold;color:#111;">${total} $</div>
              </div>
            </td>
            <td width="45%" style="vertical-align:top;text-align:center;">
              <div style="font-size:11px;color:#888;text-transform:uppercase;margin-bottom:12px;">Scanner a l'entree</div>
              <img src="${qrDataUrl}" alt="QR" style="width:200px;height:200px;border-radius:12px;">
              <div style="font-size:11px;color:#aaa;margin-top:8px;">Presente ce code a l'entree</div>
            </td>
          </tr>
        </table>
        <div style="margin-top:28px;padding:18px 20px;background:#fff8e6;border-left:3px solid #f59e0b;border-radius:0 8px 8px 0;">
          <div style="font-size:13px;color:#92400e;font-weight:bold;margin-bottom:4px;">Important</div>
          <div style="font-size:13px;color:#a16207;line-height:1.6;">Aucune reentree · Fouille des sacs · Zero alcool · Questions: 819-944-4661</div>
        </div>
      </td></tr>
      <tr><td style="background:#f8f9ff;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
        <div style="font-size:12px;color:#aaa;">GT Nights · Trois-Rivieres · gtnights@gmail.com</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// Stockage en memoire des billets scannes
const scannedTickets = new Map();
const issuedTickets  = new Map();

// ============================================================
// WEBHOOK SQUARE — declenche a chaque paiement
// ============================================================
app.post('/api/webhook-square', async (req, res) => {
  const signature = req.headers['x-square-hmacsha256-signature'];
  const rawBody   = req.body.toString();

  try {
    const isValid = WebhooksHelper.isValidWebhookEventSignature(
      rawBody,
      signature,
      process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
      'https://gtnights-servere.onrender.com/api/webhook-square'
    );
    if (!isValid) return res.status(401).json({ error: 'Signature invalide' });
  } catch(e) {
    return res.status(401).json({ error: 'Erreur signature' });
  }

  const event   = JSON.parse(rawBody);
  const payment = event.data?.object?.payment;

  if (!payment || payment.status !== 'COMPLETED') {
    return res.status(200).json({ received: true });
  }

  // Anti-doublon
  if (issuedTickets.has(payment.id)) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  try {
    const confirmationId = 'GTN-' + uuidv4().slice(0, 8).toUpperCase();
    const amount         = Number(payment.amount_money?.amount || 0);
    const buyerEmail     = payment.buyer_email_address;
    const buyerName      = payment.shipping_address?.firstName
      ? `${payment.shipping_address.firstName} ${payment.shipping_address.lastName || ''}`.trim()
      : 'Client GT Nights';

    if (!buyerEmail || !buyerEmail.includes('@')) {
      console.log('Pas de courriel pour paiement:', payment.id);
      return res.status(200).json({ received: true });
    }

    const qrPayload  = { id: confirmationId, name: buyerName, amount, event: 'GTNIGHTS-BLEUOUT-2026' };
    const qrDataUrl  = await generateQR(qrPayload);
    const emailHtml  = buildEmail(confirmationId, buyerName, buyerEmail, amount, qrDataUrl);

    await transporter.sendMail({
      from:    `"GT Nights" <${process.env.GMAIL_USER}>`,
      to:      buyerEmail,
      subject: `Ton billet GT Nights — Bleu Out · ${confirmationId}`,
      html:    emailHtml,
    });

    issuedTickets.set(payment.id, { confirmationId, buyerEmail, issuedAt: new Date().toISOString() });
    console.log(`Billet envoye: ${confirmationId} -> ${buyerEmail}`);
    return res.status(200).json({ success: true, confirmationId });

  } catch(err) {
    console.error('Erreur webhook:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// SCAN QR A L'ENTREE
// ============================================================
app.post('/api/verify-ticket', (req, res) => {
  const { confirmationId } = req.body;
  if (!confirmationId) return res.status(400).json({ valid: false, error: 'ID manquant' });

  // Verifier si le billet a ete emis
  const issued = [...issuedTickets.values()].find(t => t.confirmationId === confirmationId);
  if (!issued) return res.json({ valid: false, error: 'Billet introuvable' });

  // Verifier si deja scanne
  if (scannedTickets.has(confirmationId)) {
    const info = scannedTickets.get(confirmationId);
    return res.json({ valid: false, error: 'Billet deja utilise', scannedAt: info.scannedAt });
  }

  const scannedAt = new Date().toLocaleString('fr-CA');
  scannedTickets.set(confirmationId, { scannedAt, email: issued.buyerEmail });

  return res.json({ valid: true, confirmationId, scannedAt });
});

// ============================================================
// STATS
// ============================================================
app.get('/api/stats', (req, res) => {
  res.json({
    billetsEmis:   issuedTickets.size,
    billetsScanne: scannedTickets.size,
    placesRestantes: 350 - issuedTickets.size,
  });
});

app.get('/', (req, res) => res.json({ status: 'GT Nights server running', version: '2.0' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GT Nights server on port ${PORT}`));
