const API = "";
const TOKEN_KEY = "task_app_token";
const THEME_KEY = "task_app_theme";

function setMessage(text, isError = false) {
    const el = document.getElementById("authMessage");
    el.style.display = text ? "block" : "none";
    el.textContent = text;
    el.className = "message " + (isError ? "error" : "success");
}

function setToken(token) {
    if (!token || token === "undefined") {
        localStorage.removeItem(TOKEN_KEY);
        return;
    }
    localStorage.setItem(TOKEN_KEY, token);
}

function getToken() {
    const token = localStorage.getItem(TOKEN_KEY);
    return token && token !== "undefined" ? token : null;
}

function getErrorMessage(data) {
    if (Array.isArray(data.detail)) {
        return data.detail.map((item) => item.msg).filter(Boolean).join(". ") || "Request failed";
    }
    return data.detail || data.message || "Request failed";
}

function applyTheme(theme) {
    document.body.dataset.theme = theme;
    const button = document.getElementById("themeToggleBtn");
    if (button) {
        button.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
    }
}

function toggleTheme() {
    const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, nextTheme);
    applyTheme(nextTheme);
}

async function apiRequest(path, options = {}) {
    try {
        const response = await fetch(API + path, {
            ...options,
            headers: {
                "Content-Type": "application/json",
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
            throw new Error(getErrorMessage(data));
        }

        return data;
    } catch (error) {
        if (error instanceof TypeError) {
            throw new Error("Could not reach the API server. Make sure the backend is running.");
        }
        throw error;
    }
}

async function registerUser() {
    const name = document.getElementById("registerName").value.trim();
    const email = document.getElementById("registerEmail").value.trim();
    const password = document.getElementById("registerPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    const button = document.getElementById("registerBtn");

    if (password !== confirmPassword) {
        setMessage("Passwords do not match", true);
        return;
    }

    try {
        button.dataset.originalText = button.dataset.originalText || button.textContent;
        button.textContent = "Registering...";
        button.disabled = true;
        const data = await apiRequest("/register", {
            method: "POST",
            body: JSON.stringify({
                name,
                email,
                password,
                confirm_password: confirmPassword,
            }),
        });
        setMessage(data.message || "Registration successful. You can log in now.");
    } catch (error) {
        setMessage(error.message, true);
    } finally {
        button.textContent = button.dataset.originalText || "Register";
        button.disabled = false;
    }
}

async function loginUser() {
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const button = document.getElementById("loginBtn");

    try {
        button.dataset.originalText = button.dataset.originalText || button.textContent;
        button.textContent = "Logging in...";
        button.disabled = true;
        const data = await apiRequest("/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
        });
        if (!data.access_token) {
            throw new Error("Login did not return a token");
        }
        setToken(data.access_token);
        window.location.href = "dashboard.html";
    } catch (error) {
        setMessage(error.message, true);
    } finally {
        button.textContent = button.dataset.originalText || "Login";
        button.disabled = false;
    }
}

const registerBtn = document.getElementById("registerBtn");
const loginBtn = document.getElementById("loginBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const loginPassword = document.getElementById("loginPassword");
const confirmPassword = document.getElementById("confirmPassword");

if (registerBtn) registerBtn.addEventListener("click", registerUser);
if (loginBtn) loginBtn.addEventListener("click", loginUser);
if (themeToggleBtn) themeToggleBtn.addEventListener("click", toggleTheme);
if (loginPassword) {
    loginPassword.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            loginUser();
        }
    });
}
if (confirmPassword) {
    confirmPassword.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            registerUser();
        }
    });
}

window.addEventListener("load", () => {
    applyTheme(localStorage.getItem(THEME_KEY) || "light");
    if (getToken()) {
        window.location.href = "dashboard.html";
    }
});
