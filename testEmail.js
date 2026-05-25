const nodemailer = require('nodemailer');
require('dotenv').config({ path: '.env.local' });

async function testEmail() {
  console.log('🔧 Testing SMTP Configuration...\n');

  const smtpPort = parseInt(process.env.SMTP_PORT || '465', 10);
  const smtpSecure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : smtpPort === 465;

  const config = {
    host: process.env.SMTP_HOST,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS?.replace(/"/g, '') // Remove quotes if present
    }
  };

  console.log('📧 SMTP Settings:');
  console.log(`   Host: ${config.host}`);
  console.log(`   Port: ${config.port}`);
  console.log(`   User: ${config.auth.user}`);
  console.log(`   Secure: ${config.secure}\n`);

  try {
    console.log('⏳ Creating transporter...');
    const transporter = nodemailer.createTransport(config);

    console.log('⏳ Verifying SMTP connection...');
    await transporter.verify();
    console.log('✓ SMTP connection verified!\n');

    console.log('⏳ Sending test email...');
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || config.auth.user,
      to: process.env.EMAIL_TO || 'ifodomartin@gmail.com',
      subject: '✅ Email Test - System Working',
      html: `
        <h2>Email Notification System Test</h2>
        <p>This is a test email from the GIGMotors Dashboard monitoring system.</p>
        <p><strong>SMTP Host:</strong> ${config.host}</p>
        <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
        <p>If you receive this email, the notification system is working correctly.</p>
      `
    });

    console.log('✓ Email sent successfully!');
    console.log(`   Message ID: ${info.messageId}`);
    console.log(`   Response: ${info.response}\n`);
    console.log('✅ Test completed successfully!');
    
  } catch (error) {
    console.error('✗ Test failed:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  }
}

testEmail();
