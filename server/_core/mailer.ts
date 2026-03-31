import nodemailer from "nodemailer";

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn("[Mailer] SMTP settings not configured. Emails will not be sent.");
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendInvitationEmail({
  to,
  projectName,
  inviteUrl,
  inviterName,
}: {
  to: string;
  projectName: string;
  inviteUrl: string;
  inviterName: string;
}) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn(`[Mailer] Would send invite to ${to} but SMTP not configured.`);
    return false;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  await transporter.sendMail({
    from,
    to,
    subject: `【TaskBoard】${projectName} へ招待されました`,
    html: `
      <div style="font-family:'Noto Sans JP',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8f7ff;border-radius:16px;">
        <h2 style="color:#6366f1;font-size:20px;margin:0 0 12px;">📋 TaskBoard 招待</h2>
        <p style="color:#1e1b4b;font-size:14px;line-height:1.7;margin:0 0 16px;">
          <strong>${inviterName}</strong> さんから <strong>「${projectName}」</strong> プロジェクトへの招待が届いています。
        </p>
        <a href="${inviteUrl}"
           style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:14px;box-shadow:0 4px 12px rgba(99,102,241,.35);">
          招待を承認して参加する
        </a>
        <p style="color:#94a3b8;font-size:11px;margin:20px 0 0;">
          このリンクは72時間有効です。心当たりがない場合は無視してください。
        </p>
      </div>
    `,
  });

  return true;
}
