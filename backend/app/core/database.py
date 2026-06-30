import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.core.config import settings

logger = logging.getLogger(__name__)

# Enforce PostgreSQL URL
database_url = settings.database_url
if "postgresql" not in database_url:
    raise ValueError(f"Database URL must be a PostgreSQL connection string. Got: {database_url}")

# Create engine directly
engine = create_engine(database_url)

# Attempt a connection on startup to verify PostgreSQL is available
try:
    with engine.connect() as conn:
        logger.info("Successfully connected to PostgreSQL database.")
except Exception as e:
    logger.critical("Failed to connect to PostgreSQL database: %s", e)
    raise e

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


