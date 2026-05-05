const API = "";
const TOKEN_KEY = "task_app_token";
const THEME_KEY = "task_app_theme";

const state = {
    tasks: [],
    editingTaskId: null,
    confirmAction: null,
    searchTimer: null,
    loadingCount: 0,
};

const TASK_THEME_CLASSES = [
    "task-theme-sky",
    "task-theme-mint",
    "task-theme-coral",
    "task-theme-gold",
    "task-theme-lilac",
    "task-theme-ocean",
    "task-theme-rose",
    "task-theme-teal",
];

function getToken() {
    const token = localStorage.getItem(TOKEN_KEY);
    return token && token !== "undefined" ? token : null;
}

function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
}

function getErrorMessage(data) {
    if (Array.isArray(data.detail)) {
        return data.detail.map((item) => item.msg).filter(Boolean).join(". ") || "Request failed";
    }
    return data.detail || data.message || "Request failed";
}

function applyTheme(theme) {
    document.body.dataset.theme = theme;
    const button = byId("themeToggleBtn");
    if (button) {
        button.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
    }
}

function toggleTheme() {
    const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, nextTheme);
    applyTheme(nextTheme);
}

function byId(id) {
    return document.getElementById(id);
}

function setMessage(text, isError = false) {
    const el = byId("taskMessage");
    el.style.display = text ? "block" : "none";
    el.textContent = text;
    el.className = "message " + (isError ? "error" : "success");
}

function showToast(text, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = text;
    byId("toastStack").appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
}

function setButtonLoading(button, loadingText) {
    if (!button.dataset.originalText) {
        button.dataset.originalText = button.textContent;
    }
    button.textContent = loadingText;
    button.disabled = true;
    button.classList.add("button-loading");
}

function resetButtonLoading(button) {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
    button.classList.remove("button-loading");
}

function setPageLoading(isLoading) {
    state.loadingCount += isLoading ? 1 : -1;
    state.loadingCount = Math.max(0, state.loadingCount);
    const loading = state.loadingCount > 0;
    document.body.dataset.loading = loading ? "true" : "false";
    [
        "createTaskBtn",
        "applyFiltersBtn",
        "resetFiltersBtn",
        "clearCompletedBtn",
        "refreshBtn",
        "logoutBtn",
        "saveEditBtn",
        "confirmActionBtn",
    ].forEach((id) => {
        const button = byId(id);
        if (button && !button.classList.contains("button-loading")) {
            button.disabled = loading;
        }
    });
}

function updateStats(tasks) {
    const total = tasks.length;
    const completed = tasks.filter((task) => task.status === "completed").length;
    const pending = total - completed;
    const rate = total ? Math.round((completed / total) * 100) : 0;

    byId("totalTasks").textContent = total;
    byId("pendingTasks").textContent = pending;
    byId("completedTasks").textContent = completed;
    byId("completionRate").textContent = `${rate}%`;
    byId("summaryText").textContent = `${total} task${total === 1 ? "" : "s"} in view`;
}

function setUserInfo(user) {
    if (!user) return;
    byId("userName").textContent = user.name || "User";
    byId("userEmail").textContent = user.email || "";
    byId("userInfo").hidden = false;
}

function parseBackendDate(value) {
    if (!value) return null;
    const stringValue = String(value).trim();
    if (!stringValue) return null;

    const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(stringValue);
    return new Date(hasZone ? stringValue : `${stringValue}Z`);
}

function toLocalInputValue(value) {
    if (!value) return "";
    const date = parseBackendDate(value);
    if (!date || Number.isNaN(date.getTime())) return "";

    const offset = date.getTimezoneOffset();
    const local = new Date(date.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
}

function fromLocalInputValue(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

function formatDate(value) {
    if (!value) return "No due date";
    const date = parseBackendDate(value);
    if (!date || Number.isNaN(date.getTime())) return "Invalid date";
    return date.toLocaleString();
}

function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function getTaskThemeClass(task) {
    const seed = `${task.id}-${task.title}-${task.priority}`;
    let hash = 0;

    for (let i = 0; i < seed.length; i += 1) {
        hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }

    return TASK_THEME_CLASSES[hash % TASK_THEME_CLASSES.length];
}

async function apiRequest(path, options = {}) {
    const token = getToken();
    if (!token) {
        clearToken();
        window.location.href = "index.html";
        return null;
    }

    setPageLoading(true);
    try {
        const response = await fetch(API + path, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                ...(options.headers || {}),
            },
        });

        const raw = await response.text();
        let data = {};

        if (raw) {
            try {
                data = JSON.parse(raw);
            } catch {
                data = { detail: raw };
            }
        }

        if (!response.ok) {
            if (response.status === 401) {
                clearToken();
                setMessage(getErrorMessage(data), true);
                window.location.href = "index.html";
                return null;
            }
            throw new Error(getErrorMessage(data));
        }

        return data;
    } catch (error) {
        if (error instanceof TypeError) {
            throw new Error("Could not reach the API server. Make sure the backend is running.");
        }
        throw error;
    } finally {
        setPageLoading(false);
    }
}

function buildTaskQuery() {
    const params = new URLSearchParams();
    const search = byId("searchText").value.trim();
    const status = byId("filterStatus").value;
    const priority = byId("filterPriority").value;
    const sortBy = byId("sortBy").value;

    if (search) params.append("search", search);
    if (status) params.append("status", status);
    if (priority) params.append("priority", priority);
    if (sortBy) params.append("sort_by", sortBy);

    return params.toString() ? `?${params.toString()}` : "";
}

async function loadTasks(showFeedback = true) {
    try {
        if (showFeedback) {
            setMessage("Loading tasks...");
        }
        const tasks = await apiRequest(`/tasks${buildTaskQuery()}`);
        if (!tasks) return;
        state.tasks = tasks;
        renderTasks(tasks);
        updateStats(tasks);
        if (showFeedback) {
            setMessage(tasks.length ? "Tasks loaded successfully" : "No tasks found");
        } else {
            setMessage("");
        }
    } catch (error) {
        setMessage(error.message, true);
        showToast(error.message, "error");
    }
}

async function loadCurrentUser() {
    try {
        const user = await apiRequest("/me");
        setUserInfo(user);
    } catch (error) {
        setMessage(error.message, true);
    }
}

async function createTask() {
    const button = byId("createTaskBtn");
    const title = byId("taskTitle").value.trim();
    const description = byId("taskDescription").value.trim();
    const completed = byId("taskStatus").value === "completed";
    const priority = byId("taskPriority").value;
    const dueDate = fromLocalInputValue(byId("taskDueDate").value);

    try {
        setButtonLoading(button, "Adding...");
        await apiRequest("/tasks", {
            method: "POST",
            body: JSON.stringify({
                title,
                description,
                completed,
                priority,
                due_date: dueDate,
            }),
        });
        byId("taskTitle").value = "";
        byId("taskDescription").value = "";
        byId("taskStatus").value = "pending";
        byId("taskPriority").value = "medium";
        byId("taskDueDate").value = "";
        setMessage("Task created");
        showToast("Task created");
        await loadTasks(false);
    } catch (error) {
        setMessage(error.message, true);
        showToast(error.message, "error");
    } finally {
        resetButtonLoading(button);
    }
}

async function toggleTask(taskId, button) {
    try {
        if (button) setButtonLoading(button, "Saving...");
        await apiRequest(`/tasks/${taskId}`, {
            method: "PUT",
            body: JSON.stringify({ toggle_completion: true }),
        });
        showToast("Task updated");
        await loadTasks(false);
    } catch (error) {
        setMessage(error.message, true);
        showToast(error.message, "error");
    } finally {
        if (button) resetButtonLoading(button);
    }
}

function openEditModal(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task) return;

    state.editingTaskId = taskId;
    byId("editTaskTitle").value = task.title;
    byId("editTaskDescription").value = task.description || "";
    byId("editTaskPriority").value = task.priority || "medium";
    byId("editTaskStatus").value = task.status;
    byId("editTaskDueDate").value = toLocalInputValue(task.due_date);
    byId("editModal").classList.remove("hidden");
}

function closeEditModal() {
    state.editingTaskId = null;
    byId("editModal").classList.add("hidden");
}

async function saveEditTask() {
    if (!state.editingTaskId) return;

    const button = byId("saveEditBtn");

    try {
        setButtonLoading(button, "Saving...");
        await apiRequest(`/tasks/${state.editingTaskId}`, {
            method: "PUT",
            body: JSON.stringify({
                title: byId("editTaskTitle").value.trim(),
                description: byId("editTaskDescription").value.trim(),
                priority: byId("editTaskPriority").value,
                completed: byId("editTaskStatus").value === "completed",
                due_date: fromLocalInputValue(byId("editTaskDueDate").value),
            }),
        });
        closeEditModal();
        showToast("Task changes saved");
        await loadTasks(false);
    } catch (error) {
        setMessage(error.message, true);
        showToast(error.message, "error");
    } finally {
        resetButtonLoading(button);
    }
}

function openConfirmModal({ title, message, confirmLabel = "Confirm", destructive = false, onConfirm }) {
    state.confirmAction = onConfirm;
    byId("confirmTitle").textContent = title;
    byId("confirmMessage").textContent = message;
    const button = byId("confirmActionBtn");
    button.textContent = confirmLabel;
    button.className = destructive ? "btn-danger" : "btn";
    byId("confirmModal").classList.remove("hidden");
}

function closeConfirmModal() {
    state.confirmAction = null;
    byId("confirmModal").classList.add("hidden");
}

async function runConfirmAction() {
    if (!state.confirmAction) return;
    const action = state.confirmAction;
    const button = byId("confirmActionBtn");

    try {
        setButtonLoading(button, "Working...");
        await action();
        closeConfirmModal();
    } catch (error) {
        setMessage(error.message, true);
        showToast(error.message, "error");
    } finally {
        resetButtonLoading(button);
    }
}

function confirmDeleteTask(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    openConfirmModal({
        title: "Delete this task?",
        message: task ? `This will permanently remove "${task.title}".` : "This action cannot be undone.",
        confirmLabel: "Delete Task",
        destructive: true,
        onConfirm: async () => {
            await apiRequest(`/tasks/${taskId}`, { method: "DELETE" });
            showToast("Task deleted");
            await loadTasks(false);
        },
    });
}

function confirmClearCompleted() {
    openConfirmModal({
        title: "Clear completed tasks?",
        message: "All completed tasks in your account will be permanently removed.",
        confirmLabel: "Clear Completed",
        destructive: true,
        onConfirm: async () => {
            const result = await apiRequest("/tasks/completed", { method: "DELETE" });
            showToast(result.message || "Completed tasks cleared");
            await loadTasks(false);
        },
    });
}

function resetFilters() {
    byId("searchText").value = "";
    byId("filterStatus").value = "";
    byId("filterPriority").value = "";
    byId("sortBy").value = "newest";
    loadTasks(false);
}

function logoutUser() {
    clearToken();
    window.location.href = "index.html";
}

function renderTasks(tasks) {
    const list = byId("taskList");
    list.innerHTML = "";

    if (!tasks.length) {
        list.innerHTML = `
            <div class="empty-state">
                <strong>No tasks in this view.</strong>
                <p>Try creating a new task, clearing filters, or searching for a different keyword.</p>
                <button class="btn" id="emptyCreateBtn">Create a Task</button>
            </div>
        `;
        return;
    }

    tasks.forEach((task) => {
        const item = document.createElement("div");
        item.className = `task-item ${getTaskThemeClass(task)}`;
        const alertHtml = task.alert_message ? `<div class="alert alert-${task.alert_type}">${escapeHtml(task.alert_message)}</div>` : "";
        item.innerHTML = `
            ${alertHtml}
            <div class="task-main">
                <div class="task-top">
                    <span class="task-title ${task.status === "completed" ? "done" : ""}">${escapeHtml(task.title)}</span>
                    <span class="status ${task.status}">${task.status}</span>
                    <span class="priority ${task.priority}">${task.priority}</span>
                </div>
                ${task.description ? `<p class="task-description">${escapeHtml(task.description)}</p>` : ""}
                <div class="task-meta">
                    <span>Task ID: #${task.id}</span>
                    <span>Created ${formatDate(task.created_at)}</span>
                </div>
            </div>
            <div class="task-side">
                <div class="task-side-row">
                    <span class="task-side-label">Due Date</span>
                    <span class="task-side-value">${formatDate(task.due_date)}</span>
                </div>
                <div class="task-side-row">
                    <span class="task-side-label">Updated</span>
                    <span class="task-side-value">${formatDate(task.updated_at)}</span>
                </div>
                <div class="task-side-row">
                    <span class="task-side-label">Priority</span>
                    <span class="task-side-value">${task.priority}</span>
                </div>
            </div>
            <div class="task-actions">
                <button class="btn-success" data-action="toggle" data-id="${task.id}">
                    ${task.status === "completed" ? "Mark Pending" : "Mark Done"}
                </button>
                <button class="btn-secondary" data-action="edit" data-id="${task.id}">Edit Task</button>
                <button class="btn-danger" data-action="delete" data-id="${task.id}">Delete</button>
            </div>
        `;
        list.appendChild(item);
    });
}

function handleLiveSearch() {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
        loadTasks(false);
    }, 220);
}

byId("createTaskBtn").addEventListener("click", createTask);
byId("applyFiltersBtn").addEventListener("click", () => loadTasks(false));
byId("resetFiltersBtn").addEventListener("click", resetFilters);
byId("clearCompletedBtn").addEventListener("click", confirmClearCompleted);
byId("refreshBtn").addEventListener("click", () => loadTasks(true));
byId("logoutBtn").addEventListener("click", logoutUser);
byId("themeToggleBtn").addEventListener("click", toggleTheme);
byId("saveEditBtn").addEventListener("click", saveEditTask);
byId("cancelEditBtn").addEventListener("click", closeEditModal);
byId("closeEditModalBtn").addEventListener("click", closeEditModal);
byId("confirmActionBtn").addEventListener("click", runConfirmAction);
byId("cancelConfirmBtn").addEventListener("click", closeConfirmModal);
byId("closeConfirmModalBtn").addEventListener("click", closeConfirmModal);
byId("searchText").addEventListener("input", handleLiveSearch);
byId("filterStatus").addEventListener("change", () => loadTasks(false));
byId("filterPriority").addEventListener("change", () => loadTasks(false));
byId("sortBy").addEventListener("change", () => loadTasks(false));
byId("taskTitle").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        createTask();
    }
});

byId("taskList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action], #emptyCreateBtn");
    if (!button) return;

    if (button.id === "emptyCreateBtn") {
        byId("taskTitle").focus();
        return;
    }

    const taskId = Number(button.dataset.id);

    if (button.dataset.action === "toggle") {
        await toggleTask(taskId, button);
    }

    if (button.dataset.action === "edit") {
        openEditModal(taskId);
    }

    if (button.dataset.action === "delete") {
        confirmDeleteTask(taskId);
    }
});

window.addEventListener("click", (event) => {
    if (event.target === byId("editModal")) closeEditModal();
    if (event.target === byId("confirmModal")) closeConfirmModal();
});

window.addEventListener("load", async () => {
    applyTheme(localStorage.getItem(THEME_KEY) || "light");
    if (!getToken()) {
        window.location.href = "index.html";
        return;
    }
    updateStats([]);
    await loadCurrentUser();
    await loadTasks(false);
});
