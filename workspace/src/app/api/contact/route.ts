import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const TO_EMAIL = process.env.CONTACT_EMAIL || "support@exergylab.com";

function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not configured");
  return new Resend(key);
}

export async function POST(req: NextRequest) {
  try {
    const { name, email, subject, message } = await req.json();

    if (!name || !email || !subject || !message) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 },
      );
    }

    const subjectLine = `[Exergy Lab Contact] ${subject} — from ${name}`;

    await getResend().emails.send({
      from: "Exergy Lab <noreply@exergylab.com>",
      to: [TO_EMAIL],
      replyTo: email,
      subject: subjectLine,
      text: [
        `Name: ${name}`,
        `Email: ${email}`,
        `Subject: ${subject}`,
        "",
        message,
      ].join("\n"),
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Send failed";
    console.error("Contact form error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
