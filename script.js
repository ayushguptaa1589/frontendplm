// Cache DOM elements
const loginTab = document.getElementById('loginTab');
const signupTab = document.getElementById('signupTab');
const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');
const loginFormElement = loginForm.querySelector('form');
const signupFormElement = signupForm.querySelector('form');
const logoSection = document.querySelector('.logo-section');
const logo = document.querySelector('.logo');

// Password toggle functionality
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

// Logo flip interaction - Touch and Click
if (logoSection) {
    logoSection.addEventListener('click', (e) => {
        triggerLogoFlip();
    });

    logoSection.addEventListener('touchstart', (e) => {
        triggerLogoFlip();
    });

    // Trigger flip on both hover and touch
    logoSection.addEventListener('mouseenter', () => {
        // Optional: uncomment to flip on hover
        // triggerLogoFlip();
    });
}

function triggerLogoFlip() {
    // Remove animation temporarily to allow retriggering
    logo.style.animation = 'none';
    
    // Trigger reflow to restart animation
    void logo.offsetWidth;
    
    // Reapply animation
    setTimeout(() => {
        logo.style.animation = '';
    }, 10);
}

// Toggle between Login and Signup forms
function toggleForms() {
    loginForm.classList.toggle('active');
    signupForm.classList.toggle('active');
    loginTab.classList.toggle('active');
    signupTab.classList.toggle('active');
}

// Tab button event listeners
loginTab.addEventListener('click', () => {
    if (!loginForm.classList.contains('active')) {
        loginForm.classList.add('active');
        signupForm.classList.remove('active');
        loginTab.classList.add('active');
        signupTab.classList.remove('active');
    }
});

signupTab.addEventListener('click', () => {
    if (!signupForm.classList.contains('active')) {
        signupForm.classList.add('active');
        loginForm.classList.remove('active');
        signupTab.classList.add('active');
        loginTab.classList.remove('active');
    }
});

// Email validation
function validateEmail(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
}

// Strong Password validation
function validatePassword(password) {
    const errors = [];
    
    if (password.length < 8) {
        errors.push('at least 8 characters');
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('at least one uppercase letter (A-Z)');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('at least one lowercase letter (a-z)');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('at least one number (0-9)');
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('at least one symbol (!@#$%^&* etc.)');
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

// Show error message
function showError(message) {
    alert(message);
}

// Show inline error message
function showInlineError(containerId, message) {
    const errorEl = document.getElementById(containerId);
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
    }
}

// Hide inline error message
function hideInlineError(containerId) {
    const errorEl = document.getElementById(containerId);
    if (errorEl) {
        errorEl.style.display = 'none';
        errorEl.textContent = '';
    }
}

// Login Form Submission
loginFormElement.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Hide previous errors
    hideInlineError('loginError');
    
    const id = document.getElementById('loginId').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const role = document.getElementById('loginRole').value;

    // Validation
    if (!id || !password || !role) {
        showInlineError('loginError', 'Please fill in all fields');
        return;
    }

    if (id.length < 3) {
        showInlineError('loginError', 'User ID must be at least 3 characters');
        return;
    }

    if (password.length < 8) {
        showInlineError('loginError', 'Password must be at least 8 characters');
        return;
    }

    try {
        // Show loading state
        const btn = loginFormElement.querySelector('.btn-submit');
        const originalText = btn.textContent;
        btn.textContent = 'Logging in...';
        btn.disabled = true;

        // Call API
        const response = await loginUser(id, password, role);
        
        console.log('Login successful:', response);
        
        // Store user data in sessionStorage for dashboard
        sessionStorage.setItem('currentUser', JSON.stringify({
            username: response.user.username,
            role: response.user.role,
            id: response.user.id,
            loginTime: new Date().toISOString()
        }));
        
        // Redirect based on role
        redirectToDashboard(response.user.role);
    } catch (error) {
        // Show specific error messages
        if (error.message.includes('pending admin approval')) {
            showInlineError('loginError', '⏳ ' + error.message);
        } else {
            showInlineError('loginError', '❌ ' + error.message);
        }
        const btn = loginFormElement.querySelector('.btn-submit');
        btn.textContent = 'Login';
        btn.disabled = false;
    }
});

// Redirect to dashboard based on role
function redirectToDashboard(role) {
    const dashboards = {
        admin: 'admin-dashboard.html',
        designer: 'designer-dashboard.html',
        approver: 'approver-dashboard.html'
    };
    
    const dashboard = dashboards[role];
    if (dashboard) {
        window.location.href = dashboard;
    } else {
        showError('Invalid role');
    }
}

// Signup Form Submission
signupFormElement.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Hide previous errors
    hideInlineError('signupError');
    
    const id = document.getElementById('signupId').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value.trim();
    const role = document.getElementById('signupRole').value;

    // Validation
    if (!id || !email || !password || !role) {
        showInlineError('signupError', 'Please fill in all fields');
        return;
    }

    if (id.length < 3) {
        showInlineError('signupError', 'User ID must be at least 3 characters');
        return;
    }

    if (!validateEmail(email)) {
        showInlineError('signupError', 'Please enter a valid email address');
        return;
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
        const errorMsg = '❌ Weak Password! Password must have: ' + passwordValidation.errors.join(', ');
        showInlineError('signupError', errorMsg);
        return;
    }

    try {
        // Show loading state
        const btn = signupFormElement.querySelector('.btn-submit');
        const originalText = btn.textContent;
        btn.textContent = 'Creating account...';
        btn.disabled = true;

        // Call API
        const response = await signupUser(id, email, password, role);
        
        console.log('Signup successful:', response);
        showInlineError('signupError', response.message);
        
        // Store user data in sessionStorage for dashboard
        sessionStorage.setItem('currentUser', JSON.stringify({
            username: response.user.username,
            role: response.user.role,
            id: response.user.id,
            loginTime: new Date().toISOString()
        }));
        
        // Redirect based on role if token was provided
        if (response.token) {
            setTimeout(() => redirectToDashboard(response.user.role), 1500);
        }
    } catch (error) {
        showInlineError('signupError', '❌ ' + error.message);
        const btn = signupFormElement.querySelector('.btn-submit');
        btn.textContent = 'Signup';
        btn.disabled = false;
    }
});

// Prevent form submission on link click
document.querySelectorAll('.redirect-text a').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        toggleForms();
    });
});

// Forgot Password Functions
function openForgotPasswordModal() {
    const modal = document.getElementById('forgotPasswordModal');
    modal.style.display = 'flex';
    document.getElementById('resetStep1').style.display = 'block';
    document.getElementById('resetStep2').style.display = 'none';
    clearResetForm();
}

function closeForgotPasswordModal() {
    const modal = document.getElementById('forgotPasswordModal');
    modal.style.display = 'none';
    clearResetForm();
}

function clearResetForm() {
    document.getElementById('resetUsername').value = '';
    document.getElementById('resetEmail').value = '';
    document.getElementById('resetCode').value = '';
    document.getElementById('resetNewPassword').value = '';
    document.getElementById('resetConfirmPassword').value = '';
    document.getElementById('resetError1').style.display = 'none';
    document.getElementById('resetError2').style.display = 'none';
    document.getElementById('resetSuccess').style.display = 'none';
}

async function requestPasswordReset() {
    const username = document.getElementById('resetUsername').value.trim();
    const email = document.getElementById('resetEmail').value.trim();
    const errorDiv = document.getElementById('resetError1');

    errorDiv.style.display = 'none';

    if (!username || !email) {
        errorDiv.textContent = 'Please enter username and email';
        errorDiv.style.display = 'block';
        return;
    }

    if (!validateEmail(email)) {
        errorDiv.textContent = 'Please enter a valid email';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        const result = await forgotPassword(username, email);
        
        // In production, the reset code would be sent via email
        // The server no longer exposes the code in the API response
        alert(`✓ Password reset code has been generated.\nCheck server console for the code (dev mode).\nExpires in ${result.expiresIn || '15 minutes'}`);
        
        // Move to step 2
        document.getElementById('resetStep1').style.display = 'none';
        document.getElementById('resetStep2').style.display = 'block';
    } catch (error) {
        errorDiv.textContent = error.message || 'Error requesting password reset';
        errorDiv.style.display = 'block';
    }
}

async function completePasswordReset() {
    const username = document.getElementById('resetUsername').value.trim();
    const email = document.getElementById('resetEmail').value.trim();
    const resetCode = document.getElementById('resetCode').value.trim();
    const newPassword = document.getElementById('resetNewPassword').value.trim();
    const confirmPassword = document.getElementById('resetConfirmPassword').value.trim();
    const errorDiv = document.getElementById('resetError2');
    const successDiv = document.getElementById('resetSuccess');

    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';

    if (!resetCode || !newPassword || !confirmPassword) {
        errorDiv.textContent = 'Please fill in all fields';
        errorDiv.style.display = 'block';
        return;
    }

    if (newPassword.length < 8) {
        errorDiv.textContent = 'Password must be at least 8 characters';
        errorDiv.style.display = 'block';
        return;
    }

    if (newPassword !== confirmPassword) {
        errorDiv.textContent = 'Passwords do not match';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        const result = await resetPassword(username, email, resetCode, newPassword, confirmPassword);
        
        successDiv.textContent = result.message || 'Password reset successfully!';
        successDiv.style.display = 'block';

        setTimeout(() => {
            closeForgotPasswordModal();
            toggleForms(); // Go back to login form
        }, 2000);
    } catch (error) {
        errorDiv.textContent = error.message || 'Error resetting password';
        errorDiv.style.display = 'block';
    }
}

// Close modal when clicking outside of it
document.getElementById('forgotPasswordModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'forgotPasswordModal') {
        closeForgotPasswordModal();
    }
});

