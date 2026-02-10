// API Configuration
const API_BASE_URL = 'http://localhost:5000/api';

// HTML Escape utility to prevent XSS
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Get token from localStorage
function getToken() {
    return localStorage.getItem('authToken');
}

// Set token in localStorage
function setToken(token) {
    localStorage.setItem('authToken', token);
}

// Set current user in localStorage
function setCurrentUser(user) {
    localStorage.setItem('currentUser', JSON.stringify(user));
}

// Get current user from localStorage
function getCurrentUser() {
    const user = localStorage.getItem('currentUser');
    return user ? JSON.parse(user) : null;
}

// Make API request with authorization
async function apiRequest(endpoint, options = {}) {
    const token = getToken();
    const isFormData = options.body instanceof FormData;
    const headers = {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers
    });

    if (response.status === 401) {
        // Token expired, redirect to login
        localStorage.removeItem('authToken');
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html';
        return null;
    }

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

    if (!response.ok) {
        const message = data && typeof data === 'object' && data.error
            ? data.error
            : (typeof data === 'string' && data.trim() ? data : 'API Error');
        throw new Error(message);
    }

    return data;
}

// Auth API Calls
async function loginUser(username, password, role) {
    try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Login failed');
        }

        setToken(data.token);
        setCurrentUser(data.user);
        return data;
    } catch (error) {
        console.error('Login error:', error);
        throw error;
    }
}

async function signupUser(username, email, password, role) {
    try {
        const response = await fetch(`${API_BASE_URL}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password, role })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Signup failed');
        }

        if (data.token) setToken(data.token);
        if (data.user) setCurrentUser(data.user);
        return data;
    } catch (error) {
        console.error('Signup error:', error);
        throw error;
    }
}

// Password Reset API Calls
async function forgotPassword(username, email) {
    try {
        const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to process password reset request');
        }

        return data;
    } catch (error) {
        console.error('Forgot password error:', error);
        throw error;
    }
}

async function resetPassword(username, email, resetCode, newPassword, confirmPassword) {
    try {
        const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, resetCode, newPassword, confirmPassword })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to reset password');
        }

        return data;
    } catch (error) {
        console.error('Reset password error:', error);
        throw error;
    }
}

// Projects API Calls
async function getProjects() {
    try {
        return await apiRequest('/projects', { method: 'GET' });
    } catch (error) {
        console.error('Error fetching projects:', error);
        return [];
    }
}

async function createProject(name, status = 'active') {
    try {
        return await apiRequest('/projects', {
            method: 'POST',
            body: JSON.stringify({ name, status })
        });
    } catch (error) {
        console.error('Error creating project:', error);
        throw error;
    }
}

async function deleteProject(id) {
    try {
        return await apiRequest(`/projects/${id}`, { method: 'DELETE' });
    } catch (error) {
        console.error('Error deleting project:', error);
        throw error;
    }
}

// Users API Calls
async function getUsers() {
    try {
        return await apiRequest('/users', { method: 'GET' });
    } catch (error) {
        console.error('Error fetching users:', error);
        return [];
    }
}

async function changePassword(currentPassword, newPassword, confirmPassword) {
    try {
        return await apiRequest('/users/change-password', {
            method: 'POST',
            body: JSON.stringify({ 
                currentPassword, 
                newPassword, 
                confirmPassword 
            })
        });
    } catch (error) {
        console.error('Error changing password:', error);
        throw error;
    }
}

async function updateEmail(newEmail, password) {
    try {
        return await apiRequest('/users/update-email', {
            method: 'POST',
            body: JSON.stringify({ newEmail, password })
        });
    } catch (error) {
        console.error('Error updating email:', error);
        throw error;
    }
}

// Tasks API Calls
async function getTasks() {
    try {
        return await apiRequest('/tasks', { method: 'GET' });
    } catch (error) {
        console.error('Error fetching tasks:', error);
        return [];
    }
}

async function createTask(projectId, title, description, priority = 'medium', dueDate = null) {
    try {
        return await apiRequest('/tasks', {
            method: 'POST',
            body: JSON.stringify({ 
                project_id: projectId, 
                title, 
                description, 
                priority, 
                due_date: dueDate 
            })
        });
    } catch (error) {
        console.error('Error creating task:', error);
        throw error;
    }
}

// Submissions API Calls
async function getSubmissions() {
    try {
        return await apiRequest('/submissions', { method: 'GET' });
    } catch (error) {
        console.error('Error fetching submissions:', error);
        return [];
    }
}

async function submitWork(projectId, submissionType, comments = '') {
    try {
        return await apiRequest('/submissions', {
            method: 'POST',
            body: JSON.stringify({ 
                project_id: projectId, 
                submission_type: submissionType, 
                comments 
            })
        });
    } catch (error) {
        console.error('Error submitting work:', error);
        throw error;
    }
}

// Approvals API Calls
async function getPendingApprovals() {
    try {
        return await apiRequest('/approvals/pending', { method: 'GET' });
    } catch (error) {
        console.error('Error fetching approvals:', error);
        return [];
    }
}

async function submitApprovalDecision(submissionId, decision, feedback = '') {
    try {
        return await apiRequest(`/approvals/${submissionId}`, {
            method: 'POST',
            body: JSON.stringify({ decision, feedback })
        });
    } catch (error) {
        console.error('Error submitting approval decision:', error);
        throw error;
    }
}

// Utility function to show errors (Toast)
function showError(message) {
    showToast(message, 'error');
    console.error(message);
}

// Utility function to show success (Toast)
function showSuccess(message) {
    showToast(message, 'success');
    console.log(message);
}

// Toast notification system
function showToast(message, type = 'info', title = null, duration = 4000) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const titles = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Info' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <div class="toast-body">
            <div class="toast-title">${escapeHtml(title || titles[type] || 'Notice')}</div>
            <div class="toast-message">${escapeHtml(message)}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.classList.add('toast-out'); setTimeout(() => this.parentElement.remove(), 300)">&times;</button>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('toast-out');
            setTimeout(() => toast.remove(), 300);
        }
    }, duration);
}

// ====== Global Search ======
let searchTimeout = null;
function initGlobalSearch() {
    const input = document.querySelector('.global-search-input');
    const dropdown = document.querySelector('.search-results-dropdown');
    if (!input || !dropdown) return;

    input.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        const q = input.value.trim();
        if (q.length < 2) { dropdown.classList.remove('open'); return; }
        searchTimeout = setTimeout(async () => {
            try {
                const results = await apiRequest(`/search?q=${encodeURIComponent(q)}`, { method: 'GET' });
                renderSearchResults(results, dropdown);
            } catch (e) { dropdown.classList.remove('open'); }
        }, 300);
    });

    input.addEventListener('blur', () => { setTimeout(() => dropdown.classList.remove('open'), 200); });
    input.addEventListener('focus', () => { if (input.value.trim().length >= 2) input.dispatchEvent(new Event('input')); });
}

function renderSearchResults(results, dropdown) {
    let html = '';
    if (results.parts && results.parts.length) {
        html += `<div class="search-category">Parts</div>`;
        results.parts.forEach(p => { html += `<div class="search-result-item" onclick="navigateToSection('vault')" style="cursor:pointer"><span class="search-result-name">${escapeHtml(p.part_code)} - ${escapeHtml(p.name)}</span><span class="search-result-meta">${escapeHtml(p.criticality || 'normal')}</span></div>`; });
    }
    if (results.assemblies && results.assemblies.length) {
        html += `<div class="search-category">Assemblies</div>`;
        results.assemblies.forEach(a => { html += `<div class="search-result-item" onclick="navigateToSection('vault')" style="cursor:pointer"><span class="search-result-name">${escapeHtml(a.assembly_code)} - ${escapeHtml(a.name)}</span><span class="search-result-meta">${escapeHtml(a.criticality || 'normal')}</span></div>`; });
    }
    if (results.projects && results.projects.length) {
        html += `<div class="search-category">Projects</div>`;
        results.projects.forEach(p => { html += `<div class="search-result-item" onclick="navigateToSection('projects')" style="cursor:pointer"><span class="search-result-name">${escapeHtml(p.plm_id)} - ${escapeHtml(p.name)}</span><span class="search-result-meta">${escapeHtml(p.status)}</span></div>`; });
    }
    if (results.ecos && results.ecos.length) {
        html += `<div class="search-category">ECOs</div>`;
        results.ecos.forEach(e => { html += `<div class="search-result-item" onclick="navigateToSection('eco')" style="cursor:pointer"><span class="search-result-name">${escapeHtml(e.eco_number)} - ${escapeHtml(e.title)}</span><span class="search-result-meta">${escapeHtml(e.status)}</span></div>`; });
    }
    if (results.users && results.users.length) {
        html += `<div class="search-category">Users</div>`;
        results.users.forEach(u => { html += `<div class="search-result-item" onclick="navigateToSection('users')" style="cursor:pointer"><span class="search-result-name">${escapeHtml(u.username)}</span><span class="search-result-meta">${escapeHtml(u.role)}</span></div>`; });
    }
    if (!html) html = '<div style="padding: 16px; text-align: center; color: var(--text-muted);">No results found</div>';
    dropdown.innerHTML = html;
    dropdown.classList.add('open');
}

// ====== Notification Bell ======
async function loadNotifications() {
    try {
        const countData = await apiRequest('/notifications/unread-count', { method: 'GET' });
        const badge = document.querySelector('.notification-badge') || document.querySelector('.notif-badge');
        if (badge) {
            badge.textContent = countData.count || 0;
            badge.style.display = countData.count > 0 ? 'flex' : 'none';
        }
    } catch (e) { /* silent */ }
}

async function toggleNotificationDropdown() {
    const dropdown = document.querySelector('.notification-dropdown');
    if (!dropdown) return;
    if (dropdown.classList.contains('open')) {
        dropdown.classList.remove('open');
        return;
    }
    try {
        const notifications = await apiRequest('/notifications?limit=20', { method: 'GET' });
        const html = notifications.length
            ? notifications.map(n => `<div class="notification-item ${n.is_read ? '' : 'unread'}">
                <div class="notification-item-title">${escapeHtml(n.title)}</div>
                <div class="notification-item-msg">${escapeHtml(n.message)}</div>
                <div class="notification-item-time">${formatToIST(n.created_at)}</div>
            </div>`).join('')
            : '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No notifications</div>';
        dropdown.querySelector('.notification-list').innerHTML = html;
        dropdown.classList.add('open');
        // Mark all as read
        await apiRequest('/notifications/mark-read', { method: 'POST', body: JSON.stringify({}) });
        loadNotifications();
    } catch (e) { /* silent */ }
}

// ====== Theme Toggle ======
function initTheme() {
    const saved = localStorage.getItem('plm-theme');
    if (saved === 'light') document.body.classList.add('light-theme');
}

function toggleTheme() {
    document.body.classList.toggle('light-theme');
    localStorage.setItem('plm-theme', document.body.classList.contains('light-theme') ? 'light' : 'dark');
    const btn = document.querySelector('.theme-toggle');
    if (btn) btn.textContent = document.body.classList.contains('light-theme') ? '🌙' : '☀️';
}

// ====== Loading Spinner ======
function showLoading(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div>Loading...</div>';
}

// ====== CSV Export Helper ======
function exportCSV(endpoint, filename) {
    const token = getToken();
    fetch(`${API_BASE_URL}${endpoint}`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => r.blob())
        .then(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename || 'export.csv';
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
            showSuccess('Export downloaded');
        })
        .catch(e => showError('Export failed: ' + e.message));
}

// Initialize common UI features on page load
let _notificationIntervalId = null;
function initCommonUI() {
    initTheme();
    initGlobalSearch();
    loadNotifications();
    // Refresh notifications every 30s (store ID so it can be cleared)
    _notificationIntervalId = setInterval(loadNotifications, 30000);
    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.notification-bell') && !e.target.closest('.notification-dropdown')) {
            const dd = document.querySelector('.notification-dropdown');
            if (dd) dd.classList.remove('open');
        }
    });
}

// Clean up notification polling on page unload
window.addEventListener('beforeunload', () => {
    if (_notificationIntervalId) clearInterval(_notificationIntervalId);
});
// Navigate to a dashboard section (used by search results)
function navigateToSection(section) {
    if (typeof showSection === 'function') {
        showSection(section);
    }
    // Close search dropdown
    const dd = document.querySelector('.search-results-dropdown');
    if (dd) dd.classList.remove('open');
}

// Utility function to format timestamp to IST timezone
function formatToIST(timestamp) {
    if (!timestamp) return 'N/A';
    
    try {
        let date;
        
        // Handle ISO strings (e.g., "2026-02-09T12:18:07.123Z")
        if (typeof timestamp === 'string' && timestamp.includes('T')) {
            date = new Date(timestamp);
        } 
        // Handle SQLite datetime strings (e.g., "2026-02-09 12:18:07")
        else if (typeof timestamp === 'string' && timestamp.includes('-')) {
            date = new Date(timestamp + 'Z');
        } 
        // Handle numeric timestamps
        else {
            date = new Date(timestamp);
        }
        
        // Validate the date
        if (isNaN(date.getTime())) {
            return timestamp;
        }
        
        // Format in IST timezone
        return date.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
    } catch (error) {
        console.error('Error formatting date to IST:', error);
        return timestamp;
    }
}

// ====== Shared Dashboard Utility Functions ======
// These are used identically across admin, designer, and approver dashboards

// Set hierarchy flow indicator
function setHierarchyFlow(role) {
    const flow = document.getElementById('hierarchyFlow');
    if (!flow) return;

    const steps = Array.from(flow.querySelectorAll('.flow-step'));
    const order = ['designer', 'approver', 'admin'];
    const activeIndex = order.indexOf(role);

    steps.forEach((step) => {
        step.classList.remove('active', 'prev');
        const stepRole = step.dataset.role;
        const stepIndex = order.indexOf(stepRole);

        if (stepIndex === activeIndex) {
            step.classList.add('active');
        } else if (stepIndex > -1 && stepIndex < activeIndex) {
            step.classList.add('prev');
        }
    });
}

// Setup password toggle functionality
function setupPasswordToggle() {
    document.querySelectorAll('.password-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = btn.getAttribute('data-target');
            const inputField = document.getElementById(targetId);
            const toggleIcon = btn.querySelector('.toggle-icon');

            if (inputField.type === 'password') {
                inputField.type = 'text';
                toggleIcon.textContent = '🙈';
            } else {
                inputField.type = 'password';
                toggleIcon.textContent = '👁️';
            }
        });
    });
}

// Handle change password form submission
async function handleChangePassword() {
    const currentPassword = document.getElementById('currentPassword').value.trim();
    const newPassword = document.getElementById('newPassword').value.trim();
    const confirmPassword = document.getElementById('confirmPassword').value.trim();
    const errorDiv = document.getElementById('passwordError');
    const successDiv = document.getElementById('passwordSuccess');

    // Clear previous messages
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';

    // Validate inputs
    if (!currentPassword || !newPassword || !confirmPassword) {
        errorDiv.textContent = 'All fields are required';
        errorDiv.style.display = 'block';
        return;
    }

    if (newPassword.length < 8) {
        errorDiv.textContent = 'New password must be at least 8 characters long';
        errorDiv.style.display = 'block';
        return;
    }

    if (newPassword !== confirmPassword) {
        errorDiv.textContent = 'New passwords do not match';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        const result = await changePassword(currentPassword, newPassword, confirmPassword);

        // Clear the form
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';

        // Show success message
        successDiv.textContent = result.message || 'Password changed successfully!';
        successDiv.style.display = 'block';

        // Hide success message after 3 seconds
        setTimeout(() => {
            successDiv.style.display = 'none';
        }, 3000);
    } catch (error) {
        errorDiv.textContent = error.message || 'Error changing password';
        errorDiv.style.display = 'block';
    }
}

// Logout with confirmation
function logout() {
    if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('authToken');
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html';
    }
}

// Modal open/close
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('open');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('open');
}

// Close modal on escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('open');
        });
    }
});

// Close modal on background click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('open');
    }
});