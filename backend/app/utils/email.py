import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from app.core.config import settings

def send_otp_email(to_email: str, otp_code: str) -> bool:
    """
    Sends a 6-digit OTP password reset email to the specified recipient.
    If credentials are placeholders or not configured, it prints instructions
    and the OTP code to the console as a development fallback.
    """
    # Check if SMTP configuration is default/placeholder or empty
    is_placeholder = (
        not settings.smtp_user or 
        not settings.smtp_password or
        "your_gmail" in settings.smtp_user or
        "your_gmail" in settings.smtp_password
    )

    if is_placeholder:
        print("\n" + "="*80)
        print("WARNING: SMTP_USER or SMTP_PASSWORD is not configured in .env!")
        print("To send real emails, configure real Gmail SMTP credentials in .env.")
        print(f"FALLBACK OTP CODE: {otp_code}")
        print("="*80 + "\n")
        return True # Return true so development flow isn't blocked

    sender_email = settings.smtp_user
    sender_name = "ScopeSense AI"
    
    # Create HTML styled message matching application aesthetics
    msg = MIMEMultipart()
    msg["From"] = f"{sender_name} <{sender_email}>"
    msg["To"] = to_email
    msg["Subject"] = "ScopeSense AI Password Reset OTP Code"
    
    body = f"""
    <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #0A1C16; background-color: #EBEBEB; padding: 40px 20px; margin: 0;">
        <div style="max-width: 460px; margin: 0 auto; background: #F5F3EE; padding: 40px; border: 1px solid #0A1C16; box-shadow: 0 4px 20px rgba(10,28,22,0.05); text-align: left;">
          <h2 style="font-family: monospace; font-weight: 500; font-size: 20px; letter-spacing: 0.1em; color: #0A1C16; border-bottom: 1px solid rgba(10,28,22,0.1); padding-bottom: 20px; margin-top: 0; text-transform: uppercase;">
            ScopeSense AI
          </h2>
          <p style="font-size: 14px; color: #0A1C16; opacity: 0.8; margin-top: 24px; margin-bottom: 24px;">
            A request was made to reset your account password. Please use the verification code below to proceed:
          </p>
          <div style="font-family: monospace; font-size: 36px; font-weight: 700; letter-spacing: 0.15em; text-align: center; background: #0A1C16; color: #8EC4A0; padding: 20px; margin: 24px 0; border-radius: 2px;">
            {otp_code}
          </div>
          <p style="font-size: 13px; color: #0A1C16; opacity: 0.6; line-height: 1.5; margin-top: 24px; border-top: 1px solid rgba(10,28,22,0.08); padding-top: 20px;">
            This verification code is valid for 10 minutes. If you did not request this, please disregard this email.
          </p>
        </div>
      </body>
    </html>
    """
    msg.attach(MIMEText(body, "html"))
    
    try:
        # Standard Gmail SMTP connection (Port 587 TLS)
        server = smtplib.SMTP(settings.smtp_host, settings.smtp_port)
        server.starttls()
        server.login(settings.smtp_user, settings.smtp_password)
        server.sendmail(sender_email, to_email, msg.as_string())
        server.quit()
        print(f"Successfully sent OTP email to {to_email}")
        return True
    except Exception as e:
        print(f"Failed to send email to {to_email}: {e}")
        # Log warning fallback in case of errors
        print("\n" + "="*80)
        print(f"EMAIL DISPATCH ERROR. FALLBACK OTP CODE: {otp_code}")
        print("="*80 + "\n")
        return False
