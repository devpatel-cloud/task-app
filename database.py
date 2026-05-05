from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = "sqlite:///./tasks.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def migrate_legacy_schema():
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    if "users" in table_names:
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        with engine.begin() as connection:
            if "name" not in user_columns:
                connection.execute(text("ALTER TABLE users ADD COLUMN name VARCHAR NOT NULL DEFAULT ''"))
            connection.execute(
                text(
                    """
                    UPDATE users
                    SET name = CASE
                        WHEN TRIM(COALESCE(name, '')) != '' THEN name
                        ELSE SUBSTR(email, 1, INSTR(email, '@') - 1)
                    END
                    """
                )
            )

    if "tasks" not in table_names:
        return

    task_columns = {column["name"] for column in inspector.get_columns("tasks")}
    required_columns = {"user_id", "status", "created_at"}

    if not required_columns.issubset(task_columns):
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE tasks RENAME TO tasks_legacy"))
            connection.execute(
                text(
                    """
                    CREATE TABLE tasks (
                        id INTEGER NOT NULL PRIMARY KEY,
                        title VARCHAR NOT NULL,
                        status VARCHAR NOT NULL DEFAULT 'pending',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        user_id INTEGER NOT NULL,
                        FOREIGN KEY(user_id) REFERENCES users (id)
                    )
                    """
                )
            )
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_tasks_id ON tasks (id)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_tasks_user_id ON tasks (user_id)"))
            connection.execute(
                text(
                    """
                    INSERT INTO tasks (id, title, status, created_at, user_id)
                    SELECT tasks_legacy.id, tasks_legacy.title, 'pending', CURRENT_TIMESTAMP, users.id
                    FROM tasks_legacy
                    JOIN users ON users.email = tasks_legacy.user_email
                    """
                )
            )
            connection.execute(text("DROP TABLE tasks_legacy"))

    inspector = inspect(engine)
    task_columns = {column["name"] for column in inspector.get_columns("tasks")}

    with engine.begin() as connection:
        if "description" not in task_columns:
            connection.execute(text("ALTER TABLE tasks ADD COLUMN description TEXT NOT NULL DEFAULT ''"))
        if "priority" not in task_columns:
            connection.execute(text("ALTER TABLE tasks ADD COLUMN priority VARCHAR NOT NULL DEFAULT 'medium'"))
        if "due_date" not in task_columns:
            connection.execute(text("ALTER TABLE tasks ADD COLUMN due_date DATETIME NULL"))
        if "updated_at" not in task_columns:
            connection.execute(text("ALTER TABLE tasks ADD COLUMN updated_at DATETIME NULL"))
        connection.execute(text("UPDATE tasks SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)"))
