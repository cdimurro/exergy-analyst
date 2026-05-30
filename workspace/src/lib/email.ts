/**
 * Email service — Resend for transactional emails.
 *
 * All emails use the Exergy Lab brand template with consistent styling.
 */

import { Resend } from "resend";

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

const FROM = "Exergy Lab <noreply@exergylab.com>";

/** Shared email wrapper with Exergy Lab branding */
function brandedEmail(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #060a12; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; padding: 48px 24px;">
    <!-- Header -->
    <div style="text-align: center; margin-bottom: 40px;">
      <div style="display: inline-block; width: 40px; height: 40px; background: linear-gradient(135deg, #4db8a4, #5b8dd9); border-radius: 12px; margin-bottom: 16px;"></div>
      <h1 style="font-size: 22px; font-weight: 700; margin: 0; color: #e8ecf4; letter-spacing: -0.02em;">Exergy Lab</h1>
      <p style="font-size: 13px; color: #5a6a7e; margin: 4px 0 0;">Energy Technology Evaluation Platform</p>
    </div>

    <!-- Content card -->
    <div style="background: #0c1020; border: 1px solid #1a2238; border-radius: 16px; padding: 32px 28px;">
      ${content}
    </div>

    <!-- Footer -->
    <div style="text-align: center; margin-top: 32px; padding: 0 16px;">
      <p style="font-size: 12px; color: #3a4a5e; line-height: 1.6; margin: 0;">
        Your documents and data are encrypted and never shared.<br>
        Purpose-built for the energy transition.
      </p>
      <p style="font-size: 11px; color: #2a3a4e; margin-top: 16px;">
        Exergy Lab &mdash; Accelerating energy innovation
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ── Verification Email ──────────────────────────────────────────────

export async function sendVerificationEmail(
  email: string,
  token: string,
  name: string,
): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn("RESEND_API_KEY not set — skipping verification email");
    return;
  }

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${token}`;

  const content = `
    <h2 style="font-size: 18px; font-weight: 600; color: #e8ecf4; margin: 0 0 20px;">Verify your email</h2>
    <p style="font-size: 15px; line-height: 1.7; color: #a0adc0; margin: 0 0 8px;">Hi ${name},</p>
    <p style="font-size: 15px; line-height: 1.7; color: #a0adc0; margin: 0 0 28px;">
      Thanks for signing up. Click the button below to verify your email address and activate your account.
    </p>
    <div style="text-align: center; margin: 0 0 28px;">
      <a href="${verifyUrl}" style="display: inline-block; padding: 14px 36px; background: linear-gradient(135deg, #4db8a4, #5b8dd9); color: #fff; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 600; letter-spacing: 0.01em;">
        Verify Email Address
      </a>
    </div>
    <p style="font-size: 13px; line-height: 1.6; color: #5a6a7e; margin: 0;">
      If you didn't create an account, you can safely ignore this email. This link expires in 24 hours.
    </p>
  `;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: "Verify your Exergy Lab account",
    html: brandedEmail(content),
  });
}

// ── Welcome Email (sent after verification) ─────────────────────────

export function welcomeIntroParagraph(): string {
  return "Your account is verified and ready to go. You now have access to an energy technology evaluation workspace built for evidence-grounded diligence.";
}

export function welcomeFeatureBullets(): string[] {
  return [
    "Evaluate technologies across 100+ energy domains",
    "Upload datasheets and research papers for analysis",
    "Run solver-aware evaluations when structured artifacts support them",
    "Generate modeled assessment reports with validation-pending evidence caveats",
    "Search published literature across 10 academic databases",
  ];
}

export async function sendWelcomeEmail(
  email: string,
  name: string,
): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  const content = `
    <h2 style="font-size: 18px; font-weight: 600; color: #e8ecf4; margin: 0 0 20px;">Welcome to Exergy Lab</h2>
    <p style="font-size: 15px; line-height: 1.7; color: #a0adc0; margin: 0 0 8px;">Hi ${name},</p>
    <p style="font-size: 15px; line-height: 1.7; color: #a0adc0; margin: 0 0 24px;">
      ${welcomeIntroParagraph()}
    </p>

    <div style="background: #111628; border-radius: 12px; padding: 20px; margin: 0 0 24px;">
      <p style="font-size: 13px; font-weight: 600; color: #e8ecf4; margin: 0 0 12px;">What you can do:</p>
      <table style="width: 100%; border-collapse: collapse;">
        ${welcomeFeatureBullets().map((bullet) => `
          <tr>
            <td style="padding: 6px 0; font-size: 14px; color: #a0adc0;">
              <span style="color: #4db8a4; margin-right: 8px;">&#10003;</span> ${bullet}
            </td>
          </tr>
        `).join("")}
      </table>
    </div>

    <div style="text-align: center; margin: 0 0 24px;">
      <a href="${baseUrl}" style="display: inline-block; padding: 14px 36px; background: linear-gradient(135deg, #4db8a4, #5b8dd9); color: #fff; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 600;">
        Start Your First Project
      </a>
    </div>

    <p style="font-size: 13px; line-height: 1.6; color: #5a6a7e; margin: 0;">
      The free tier includes 5 projects, 20 AI messages per day, and full access to all evaluation modules. Need more? <a href="${baseUrl}/pricing" style="color: #5b8dd9; text-decoration: none;">See plans</a>.
    </p>
  `;

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: "Welcome to Exergy Lab — your account is ready",
    html: brandedEmail(content),
  });
}
