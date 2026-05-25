import nodemailer from 'nodemailer';

export async function sendMileageExcelEmail(params: {
  subject: string;
  html: string;
  attachmentPath: string;
  attachmentFilename: string;
}): Promise<boolean> {
  if (process.env.ENABLE_EMAIL_REPORTS !== 'true') {
    console.log('[MileageEmail] ENABLE_EMAIL_REPORTS is not true; skip send');
    return false;
  }

  const requiredVars = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_TO'];
  const missingVars = requiredVars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    console.log(`[MileageEmail] Missing: ${missingVars.join(', ')}`);
    return false;
  }

  const smtpPort = parseInt(process.env.SMTP_PORT || '465', 10);
  const smtpSecure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : smtpPort === 465;
  const recipients = process.env.EMAIL_TO?.split(',').map((e) => e.trim()).join(', ') || '';

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: recipients,
    subject: params.subject,
    html: params.html,
    attachments: [
      {
        filename: params.attachmentFilename,
        path: params.attachmentPath,
      },
    ],
  });

  console.log(`[MileageEmail] Sent: ${params.subject}`);
  return true;
}
