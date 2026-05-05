import math
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Task, User
from schemas import MessageResponse, TaskCreate, TaskResponse, TaskUpdate

router = APIRouter()


def compute_alert(due_date: datetime | None) -> tuple[str | None, str | None]:
    if not due_date:
        return None, None
    now = datetime.now(timezone.utc)
    if due_date.tzinfo is None:
        due_date = due_date.replace(tzinfo=timezone.utc)
    else:
        due_date = due_date.astimezone(timezone.utc)
    time_diff = due_date - now
    hours_left = time_diff.total_seconds() / 3600
    if hours_left <= 0:
        return "Time is done", "danger"
    if hours_left < 1:
        return "Less than 1 hour left", "warning"
    if hours_left <= 2:
        return f"{math.ceil(hours_left)} hours left", "warning"
    if hours_left <= 24:
        return f"{math.ceil(hours_left)} hours left", "info"
    return None, None


def get_task_for_user_or_error(task_id: int, current_user: User, db: Session) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if task.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to access this task",
        )
    return task


@router.get("/tasks", response_model=list[TaskResponse])
def get_tasks(
    search: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    priority_filter: str | None = Query(default=None, alias="priority"),
    sort_by: str = Query(default="newest"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        query = db.query(Task).filter(Task.user_id == current_user.id)

        if search:
            query = query.filter(Task.title.ilike(f"%{search.strip()}%"))

        if status_filter:
            normalized = status_filter.lower().strip()
            if normalized not in {"pending", "completed"}:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Status filter must be 'pending' or 'completed'",
                )
            query = query.filter(Task.status == normalized)

        if priority_filter:
            normalized_priority = priority_filter.lower().strip()
            if normalized_priority not in {"low", "medium", "high"}:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Priority filter must be 'low', 'medium', or 'high'",
                )
            query = query.filter(Task.priority == normalized_priority)

        if sort_by == "oldest":
            query = query.order_by(Task.created_at.asc(), Task.id.asc())
        elif sort_by == "priority":
            priority_rank = case(
                (Task.priority == "high", 3),
                (Task.priority == "medium", 2),
                else_=1,
            )
            query = query.order_by(
                priority_rank.desc(),
                Task.status.asc(),
                Task.created_at.desc(),
                Task.id.desc(),
            )
        elif sort_by == "due_soon":
            query = query.order_by(Task.due_date.is_(None), Task.due_date.asc(), Task.created_at.desc())
        elif sort_by == "newest":
            query = query.order_by(Task.created_at.desc(), Task.id.desc())
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Sort must be 'newest', 'oldest', 'priority', or 'due_soon'",
            )
        tasks = query.offset(skip).limit(limit).all()
        # Add alerts to each task
        task_responses = []
        for task in tasks:
            alert_message, alert_type = compute_alert(task.due_date)
            task_dict = {
                "id": task.id,
                "title": task.title,
                "description": task.description,
                "status": task.status,
                "priority": task.priority,
                "due_date": task.due_date,
                "created_at": task.created_at,
                "updated_at": task.updated_at,
                "user_id": task.user_id,
                "alert_message": alert_message,
                "alert_type": alert_type,
            }
            task_responses.append(TaskResponse(**task_dict))
        return task_responses
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not load tasks",
        ) from exc


@router.post(
    "/tasks",
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_task(
    task: TaskCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        now = datetime.now(timezone.utc)
        new_task = Task(
            title=task.title,
            description=task.description,
            status=task.status,
            priority=task.priority,
            due_date=task.due_date,
            created_at=now,
            updated_at=now,
            user_id=current_user.id,
        )
        db.add(new_task)
        db.commit()
        db.refresh(new_task)
        alert_message, alert_type = compute_alert(new_task.due_date)
        task_dict = {
            "id": new_task.id,
            "title": new_task.title,
            "description": new_task.description,
            "status": new_task.status,
            "priority": new_task.priority,
            "due_date": new_task.due_date,
            "created_at": new_task.created_at,
            "updated_at": new_task.updated_at,
            "user_id": new_task.user_id,
            "alert_message": alert_message,
            "alert_type": alert_type,
        }
        return TaskResponse(**task_dict)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not create task",
        ) from exc


@router.put("/tasks/{task_id}", response_model=TaskResponse)
def update_task(
    task_id: int,
    task_update: TaskUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = get_task_for_user_or_error(task_id, current_user, db)

    if task_update.title is not None:
        task.title = task_update.title

    if task_update.description is not None:
        task.description = task_update.description

    if task_update.status is not None:
        task.status = task_update.status

    if task_update.priority is not None:
        task.priority = task_update.priority

    task.due_date = task_update.due_date if "due_date" in task_update.model_fields_set else task.due_date

    if task_update.toggle_completion:
        task.status = "completed" if task.status == "pending" else "pending"

    task.updated_at = datetime.now(timezone.utc)
    try:
        db.commit()
        db.refresh(task)
        alert_message, alert_type = compute_alert(task.due_date)
        task_dict = {
            "id": task.id,
            "title": task.title,
            "description": task.description,
            "status": task.status,
            "priority": task.priority,
            "due_date": task.due_date,
            "created_at": task.created_at,
            "updated_at": task.updated_at,
            "user_id": task.user_id,
            "alert_message": alert_message,
            "alert_type": alert_type,
        }
        return TaskResponse(**task_dict)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not update task",
        ) from exc


@router.delete("/tasks/completed", response_model=MessageResponse)
def delete_completed_tasks(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        deleted_count = (
            db.query(Task)
            .filter(Task.user_id == current_user.id, Task.status == "completed")
            .delete(synchronize_session=False)
        )
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not delete completed tasks",
        ) from exc
    return {"message": f"Deleted {deleted_count} completed task(s)"}


@router.delete("/tasks/{task_id}", response_model=MessageResponse)
def delete_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = get_task_for_user_or_error(task_id, current_user, db)

    try:
        db.delete(task)
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not delete task",
        ) from exc

    return {"message": "Task deleted successfully"}
