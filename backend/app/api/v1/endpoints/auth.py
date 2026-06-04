from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload
from jose import jwt, JWTError
from app.core.database import get_db
from app.models.user import User
from app.schemas.auth import (
    AuthSessionResponse,
    UserCreate,
    UserLogin,
    UserWithHistoryResponse,
    ForgotPasswordRequest,
    ResetPasswordRequest,
)
from app.core.security import get_password_hash, verify_password, create_access_token, SECRET_KEY, ALGORITHM
from app.api.deps import get_current_user

router = APIRouter()


def _load_user_with_history(db: Session, user_id: int) -> User:
    user = (
        db.query(User)
        .options(selectinload(User.history))
        .filter(User.id == user_id)
        .first()
    )
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return user


@router.post("/register", response_model=AuthSessionResponse)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    """Register a new user and return a JWT token. Does NOT write login history here —
    history is only written when the user generates an SRS document."""
    existing = db.query(User).filter(User.email == user_in.email).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail="An account with this email already exists.",
        )

    hashed_password = get_password_hash(user_in.password)
    db_user = User(
        name=user_in.name,
        email=user_in.email,
        hashed_password=hashed_password,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    full_user = _load_user_with_history(db, db_user.id)

    access_token = create_access_token(data={"sub": db_user.email})
    return {"access_token": access_token, "token_type": "bearer", "user": full_user}


@router.post("/login", response_model=AuthSessionResponse)
def login(user_in: UserLogin, db: Session = Depends(get_db)):
    """Authenticate a user and return a JWT token."""
    user = db.query(User).filter(User.email == user_in.email).first()
    if not user or not verify_password(user_in.password, user.hashed_password):
        raise HTTPException(
            status_code=400,
            detail="Incorrect email or password.",
        )

    full_user = _load_user_with_history(db, user.id)
    access_token = create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer", "user": full_user}


@router.get("/me", response_model=UserWithHistoryResponse)
def get_user_me(current_user: User = Depends(get_current_user)):
    """Return the authenticated user's profile plus their SRS generation history."""
    return current_user


@router.post("/forgot-password")
def forgot_password(user_in: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Generate a password reset OTP and send it via SMTP email."""
    user = db.query(User).filter(User.email == user_in.email).first()
    if not user:
        raise HTTPException(
            status_code=404,
            detail="No account exists with this email address.",
        )

    import secrets
    from datetime import datetime, timedelta
    from app.utils.email import send_otp_email

    # Generate a 6-digit numeric OTP
    otp = "".join(secrets.choice("0123456789") for _ in range(6))
    
    # Set expiration: 10 minutes from now
    expires_at = datetime.utcnow() + timedelta(minutes=10)
    
    user.reset_otp = otp
    user.reset_otp_expires_at = expires_at
    db.commit()

    # Send the OTP via SMTP
    sent = send_otp_email(user.email, otp)
    if not sent:
        raise HTTPException(
            status_code=500,
            detail="Failed to send verification email. Please try again later."
        )

    return {
        "message": "A 6-digit verification code has been sent to your registered email address. It expires in 10 minutes.",
    }


@router.post("/reset-password")
def reset_password(user_in: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Reset the user's password using a verified OTP code."""
    user = db.query(User).filter(User.email == user_in.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="No account exists with this email address.")

    if not user.reset_otp or user.reset_otp != user_in.otp:
        raise HTTPException(status_code=400, detail="Invalid password reset verification code.")

    from datetime import datetime

    current_time = datetime.utcnow()
    expires_at = user.reset_otp_expires_at
    
    # Normalize comparison if one is timezone-aware and the other is naive
    if expires_at and expires_at.tzinfo is not None:
        from datetime import timezone
        current_time = datetime.now(timezone.utc)

    if not expires_at or current_time > expires_at:
        raise HTTPException(status_code=400, detail="The password reset verification code has expired.")

    user.hashed_password = get_password_hash(user_in.new_password)
    user.reset_otp = None
    user.reset_otp_expires_at = None
    db.commit()

    return {"message": "Your password has been successfully reset."}
