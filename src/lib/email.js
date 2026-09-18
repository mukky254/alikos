// src/lib/email.js
// Sends real email via Resend (https://resend.com) when RESEND_API_KEY is
// set. If it isn't set, callers should fall back to logging the content
// (e.g. a password reset link) so the app still works without an email
// account configured.
async function sendEmail({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not set' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'Aliko <onboarding@resend.dev>',
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend API error (${res.status}): ${text}`);
  }
  return { sent: true };
}

module.exports = { sendEmail };
