// ============================================================
// GT Nights — Bleu Out · Serveur backend Node.js
// ============================================================
// Installation : npm install
// Demarrage    : node server.js
// ============================================================

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const { Client, Environment } = require('square');
const QRCode     = require('qrcode');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const { v4: uuidv4 } = require('uuid');
const path       = require('path');

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// SQUARE CLIENT
// ============================================================
const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment: process.env.NODE_ENV === 'production'
    ? Environment.Production
    : Environment.Sandbox,
});

// ============================================================
// GOOGLE SHEETS
// ============================================================
const sheetsAuth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

async function appendToSheet(row) {
  const auth  = await sheetsAuth.getClient();
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Ventes!A:L',
    valueInputOption: 'RAW',
    resource: { values: [row] },
  });
}

// ============================================================
// NODEMAILER — Gmail
// ============================================================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD, // Mot de passe d'application Google
  },
});

// ============================================================
// GENERATEUR QR + BILLET HTML
// ============================================================
async function generateTicketQR(confirmationId, data) {
  const payload = JSON.stringify({
    id:    confirmationId,
    name:  data.name,
    tier:  data.tier,
    qty:   data.qty,
    event: 'GTNIGHTS-BLEUOUT-2026',
  });
  // QR en base64 pour inclure dans l'email sans fichier externe
  return await QRCode.toDataURL(payload, {
    width: 300,
    margin: 2,
    color: { dark: '#06080f', light: '#ffffff' },
  });
}

function buildTicketEmail(confirmationId, data, qrDataUrl) {
  const tierLabel = { precommande: 'Precommande', regulier: 'Regulier', porte: 'A la porte' }[data.tier] || data.tier;
  const fmt = n => n.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const TPS = data.amount / 100 * (5 / 114.975);
  const TVQ = data.amount / 100 * (9.975 / 114.975);
  const sub = data.amount / 100 - TPS - TVQ;

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Billet GT Nights</title></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'DM Sans',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:40px 0;">
  <tr><td align="center">
    <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <!-- EN-TETE -->
      <tr><td style="background:#06080f;padding:36px 40px 28px;">
        <div style="font-family:'Bebas Neue',Impact,sans-serif;font-size:28px;letter-spacing:4px;color:#f0f4ff;">GT NIGHTS</div>
        <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#60a5fa;margin-top:4px;">Edition 01 — Bleu Out</div>
      </td></tr>
      <!-- TITRE -->
      <tr><td style="background:#0a0d18;padding:28px 40px 24px;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:13px;color:#60a5fa;letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px;">Billet confirme</div>
        <div style="font-family:'Bebas Neue',Impact,sans-serif;font-size:52px;color:#f0f4ff;line-height:.9;margin-bottom:8px;">BLEU<br><span style="color:#60a5fa;">OUT</span></div>
        <div style="font-size:14px;color:rgba(240,244,255,0.5);">Vendredi 26 juin 2026 · 21 h — 1 h · Salle des Ormeaux, Trois-Rivieres</div>
      </td></tr>
      <!-- CORPS -->
      <tr><td style="padding:36px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="55%" style="vertical-align:top;padding-right:32px;">
              <div style="margin-bottom:20px;">
                <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Titulaire</div>
                <div style="font-size:17px;font-weight:500;color:#111;">${data.name}</div>
              </div>
              <div style="margin-bottom:20px;">
                <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Type de billet</div>
                <div style="font-size:17px;font-weight:500;color:#111;">${tierLabel}</div>
              </div>
              <div style="margin-bottom:20px;">
                <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Quantite</div>
                <div style="font-size:17px;font-weight:500;color:#111;">${data.qty} billet${data.qty > 1 ? 's' : ''}</div>
              </div>
              <div style="margin-bottom:20px;">
                <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Confirmation</div>
                <div style="font-size:14px;font-family:monospace;color:#1d6ef5;font-weight:600;">${confirmationId}</div>
              </div>
              <div style="background:#f8f9ff;border-radius:10px;padding:16px;margin-top:8px;">
                <div style="font-size:13px;color:#555;margin-bottom:6px;font-weight:500;">Facture</div>
                <div style="display:flex;justify-content:space-between;font-size:13px;color:#777;margin-bottom:4px;"><span>Sous-total</span><span>${fmt(sub)} $</span></div>
                <div style="display:flex;justify-content:space-between;font-size:13px;color:#777;margin-bottom:4px;"><span>TPS (5%)</span><span>${fmt(TPS)} $</span></div>
                <div style="display:flex;justify-content:space-between;font-size:13px;color:#777;margin-bottom:8px;"><span>TVQ (9.975%)</span><span>${fmt(TVQ)} $</span></div>
                <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:600;color:#111;border-top:1px solid #e8e8e8;padding-top:8px;"><span>Total paye</span><span>${fmt(data.amount / 100)} $</span></div>
              </div>
            </td>
            <td width="45%" style="vertical-align:top;text-align:center;">
              <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px;">Code QR — Scanner a l'entree</div>
              <img src="${qrDataUrl}" alt="Code QR" style="width:200px;height:200px;border-radius:12px;">
              <div style="font-size:11px;color:#aaa;margin-top:8px;">Presente ce code a l'entree</div>
            </td>
          </tr>
        </table>
        <div style="margin-top:28px;padding:18px 20px;background:#fff8e6;border-left:3px solid #f59e0b;border-radius:0 8px 8px 0;">
          <div style="font-size:13px;color:#92400e;font-weight:500;margin-bottom:4px;">Informations importantes</div>
          <div style="font-size:13px;color:#a16207;line-height:1.6;">
            Aucune reentree apres la sortie · Fouille des sacs a l'entree · Zéro alcool ·
            Questions : 819-944-4661 · info@gtnights.ca
          </div>
        </div>
      </td></tr>
      <!-- PIED -->
      <tr><td style="background:#f8f9ff;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
        <div style="font-size:12px;color:#aaa;">GT Nights · Trois-Rivieres, Quebec · info@gtnights.ca</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ============================================================
// ROUTE PRINCIPALE — Traitement paiement
// ============================================================
app.post('/api/create-payment', async (req, res) => {
  const { sourceId, amount, currency, name, email, tier, qty, pricePerUnit } = req.body;

  // Validation basique
  if (!sourceId || !amount || !name || !email) {
    return res.status(400).json({ success: false, error: 'Donnees manquantes' });
  }

  const confirmationId = 'GTN-' + uuidv4().slice(0, 8).toUpperCase();
  const idempotencyKey = uuidv4();

  try {
    // 1. PAIEMENT SQUARE
    const { result, statusCode } = await squareClient.paymentsApi.createPayment({
      sourceId,
      idempotencyKey,
      amountMoney: { amount: BigInt(amount), currency },
      note: `GT Nights Bleu Out — ${tier} x${qty} — ${confirmationId}`,
      buyerEmailAddress: email,
    });

    if (statusCode !== 200) {
      return res.status(400).json({ success: false, error: 'Paiement refuse par Square' });
    }

    const paymentId = result.payment.id;
    const now = new Date();

    // 2. GENERER QR CODE
    const qrDataUrl = await generateTicketQR(confirmationId, { name, tier, qty });

    // 3. ENVOYER EMAIL avec billet
    const emailHtml = buildTicketEmail(confirmationId, { name, tier, qty, amount }, qrDataUrl);
    await transporter.sendMail({
      from: `"GT Nights" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: `Ton billet GT Nights — Bleu Out · ${confirmationId}`,
      html: emailHtml,
    });

    // 4. LOGGER DANS GOOGLE SHEETS
    await appendToSheet([
      now.toISOString(),
      confirmationId,
      paymentId,
      name,
      email,
      tier,
      qty,
      pricePerUnit,
      amount / 100,
      'confirme',
      '0', // scanné (0 = non)
      '',  // heure de scan
    ]);

    return res.json({ success: true, confirmationId });

  } catch (err) {
    console.error('Erreur paiement:', err);
    return res.status(500).json({ success: false, error: err.message || 'Erreur serveur' });
  }
});

// ============================================================
// ROUTE — Verifier un QR code a l'entree (scannner)
// ============================================================
app.post('/api/verify-ticket', async (req, res) => {
  const { confirmationId } = req.body;
  if (!confirmationId) return res.status(400).json({ valid: false, error: 'ID manquant' });

  try {
    const auth   = await sheetsAuth.getClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Ventes!A:L',
    });

    const rows = response.data.values || [];
    const header = rows[0];
    const data = rows.slice(1);

    // Chercher le billet par ID
    const rowIndex = data.findIndex(r => r[1] === confirmationId);
    if (rowIndex === -1) {
      return res.json({ valid: false, error: 'Billet introuvable' });
    }

    const row = data[rowIndex];
    if (row[9] !== 'confirme') {
      return res.json({ valid: false, error: 'Billet non confirme' });
    }
    if (row[10] === '1') {
      return res.json({ valid: false, error: 'Billet deja utilise', scannedAt: row[11] });
    }

    // Marquer comme scanne
    const sheetRow = rowIndex + 2; // +2 car 1-indexed + header
    const scannedAt = new Date().toLocaleString('fr-CA');
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Ventes!K${sheetRow}:L${sheetRow}`,
      valueInputOption: 'RAW',
      resource: { values: [['1', scannedAt]] },
    });

    return res.json({
      valid: true,
      name:  row[3],
      tier:  row[5],
      qty:   row[6],
      scannedAt,
    });

  } catch (err) {
    console.error('Erreur verification:', err);
    return res.status(500).json({ valid: false, error: 'Erreur serveur' });
  }
});

// ============================================================
// ROUTE — Dashboard ventes en temps reel
// ============================================================
app.get('/api/stats', async (req, res) => {
  try {
    const auth   = await sheetsAuth.getClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Ventes!A:L',
    });
    const rows = (response.data.values || []).slice(1);
    const confirmed = rows.filter(r => r[9] === 'confirme');
    const totalBillets = confirmed.reduce((sum, r) => sum + parseInt(r[6] || 0), 0);
    const totalRevenu  = confirmed.reduce((sum, r) => sum + parseFloat(r[8] || 0), 0);
    const byTier = { precommande: 0, regulier: 0, porte: 0 };
    confirmed.forEach(r => { byTier[r[5]] = (byTier[r[5]] || 0) + parseInt(r[6] || 0); });

    return res.json({
      totalBillets,
      totalRevenu: Math.round(totalRevenu * 100) / 100,
      placesRestantes: 350 - totalBillets,
      byTier,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DEMARRAGE
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`GT Nights server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
