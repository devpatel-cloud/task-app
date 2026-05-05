from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from database import get_db
from models import Task, User
from schemas import MessageResponse, TokenResponse, UserCreate, UserLogin, UserResponse

router = APIRouter()

SECRET_KEY = "change-this-secret-key-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

DEFAULT_SAMPLE_TASKS = [
    {"title": "Review product roadmap", "status": "pending", "priority": "high", "description": "Check milestones and confirm next sprint goals."},
    {"title": "Prepare weekly status report", "status": "completed", "priority": "medium", "description": "Summarize wins, blockers, and follow-up items."},
    {"title": "Test login and dashboard flow", "status": "pending", "priority": "high", "description": "Verify auth redirects and dashboard actions."},
    {"title": "Update API integration notes", "status": "pending", "priority": "medium", "description": "Capture endpoint details for frontend usage."},
    {"title": "Clean completed backlog items", "status": "completed", "priority": "low", "description": "Archive old done tasks and tidy the list."},
    {"title": "Write database validation checks", "status": "pending", "priority": "high", "description": "Review schema safety and model constraints."},
    {"title": "Verify JWT protected routes", "status": "completed", "priority": "high", "description": "Make sure unauthenticated access is blocked."},
    {"title": "Draft release checklist", "status": "pending", "priority": "medium", "description": "List final QA and deployment steps."},
    {"title": "Refine task filter behavior", "status": "pending", "priority": "medium", "description": "Improve how search and filters work together."},
    {"title": "Review sample user activity", "status": "completed", "priority": "low", "description": "Confirm seeded tasks and user onboarding flow."},
]

try:
    import bcrypt

    if not hasattr(bcrypt, "__about__"):
        class _BcryptAbout:
            __version__ = getattr(bcrypt, "__version__", "unknown")

        bcrypt.__about__ = _BcryptAbout()
except Exception:
    pass

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login", auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password[:72])


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password[:72], hashed_password)


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def seed_sample_tasks_for_user(db: Session, user: User) -> None:
    existing_titles = {
        row[0]
        for row in db.query(Task.title).filter(Task.user_id == user.id).all()
    }

    now = datetime.now(timezone.utc)
    sample_tasks = [
        Task(
            title=item["title"],
            description=item["description"],
            status=item["status"],
            priority=item["priority"],
            created_at=now,
            updated_at=now,
            user_id=user.id,
        )
        for item in DEFAULT_SAMPLE_TASKS
        if item["title"] not in existing_titles
    ]

    if sample_tasks:
        db.add_all(sample_tasks)
        db.commit()


def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token is missing",
            headers={"WWW-Authenticate": "Bearer"},
        )

    invalid_token_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication token is invalid or expired",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        if not email:
            raise invalid_token_exception
    except JWTError as exc:
        raise invalid_token_exception from exc

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise invalid_token_exception

    return user


@router.post(
    "/register",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
)
def register(user: UserCreate, db: Session = Depends(get_db)):
    existing_user = db.query(User).filter(User.email == user.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is already registered",
        )

    try:
        new_user = User(
            name=user.name,
            email=user.email,
            password=hash_password(user.password),
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        seed_sample_tasks_for_user(db, new_user)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is already registered",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not create user",
        ) from exc

    return {"message": "User created successfully"}


@router.post("/login", response_model=TokenResponse)
def login(user: UserLogin, db: Session = Depends(get_db)):
    try:
        db_user = db.query(User).filter(User.email == user.email).first()
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not log in right now",
        ) from exc

    if not db_user or not verify_password(user.password, db_user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        seed_sample_tasks_for_user(db, db_user)
    except SQLAlchemyError:
        db.rollback()

    token = create_access_token({"sub": db_user.email, "user_id": db_user.id})
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user
