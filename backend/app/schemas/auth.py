from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: int
    name: str
    email: EmailStr
    is_admin: bool = False
    created_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse

class UserHistoryResponse(BaseModel):
    id: int
    action: str
    project_name: Optional[str] = None
    provider: Optional[str] = None
    sections_count: Optional[int] = None
    details: Optional[str] = None
    created_at: datetime
    
    class Config:
        from_attributes = True

class UserWithHistoryResponse(UserResponse):
    history: List[UserHistoryResponse] = []


class AuthSessionResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserWithHistoryResponse


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    otp: str
    new_password: str

