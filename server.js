const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const sqlite3 = require('sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const multer = require('multer');
const fs = require('fs');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 16) {
    console.error('FATAL: JWT_SECRET is missing or too short. Set a strong secret in .env');
    process.exit(1);
}

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false,  // Allow inline scripts for our SPA
    crossOriginEmbedderPolicy: false
}));
app.use(compression());

// Rate limiting
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500,
    message: { error: 'Too many requests, please try again later.' }
});
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many login attempts, please try again after 15 minutes.' }
});

app.use('/api/', generalLimiter);
app.use('/api/auth/', authLimiter);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve uploads only with auth
app.use('/uploads', (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
    const token = authHeader.split(' ')[1];
    try {
        jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}, express.static(path.join(__dirname, 'uploads')));

app.use(express.static(path.join(__dirname)));

// File upload setup
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
        const allowed = /\.(pdf|doc|docx|xls|xlsx|csv|txt|png|jpg|jpeg|gif|svg|step|stp|iges|igs|stl|dwg|dxf|zip|rar|7z)$/i;
        if (allowed.test(path.extname(file.originalname))) {
            cb(null, true);
        } else {
            cb(new Error('File type not allowed'), false);
        }
    }
});

// Enum validators
const VALID_ROLES = ['admin', 'designer', 'approver'];
const VALID_CRITICALITY = ['normal', 'low', 'high', 'critical'];
const VALID_LIFECYCLE = ['draft', 'active', 'released', 'obsolete'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const VALID_ECO_STATUS = ['draft', 'submitted', 'in_review', 'approved', 'rejected', 'implemented'];

function validateEnum(value, allowed, fieldName) {
    if (value && !allowed.includes(value)) {
        return `Invalid ${fieldName}: must be one of ${allowed.join(', ')}`;
    }
    return null;
}

// Database setup
const db = new sqlite3.Database('./plm_database.db');

// Initialize database tables
function initializeDatabase() {
    db.serialize(() => {
        // Users table
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                role TEXT NOT NULL,
                approved_by TEXT,
                approved_at DATETIME,
                is_active BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(approved_by) REFERENCES users(id)
            )
        `);

        // Ensure legacy databases have new columns
        db.all(`PRAGMA table_info(users)`, (err, columns) => {
            if (err) {
                console.error('Error checking users schema:', err);
                return;
            }

            const columnNames = columns.map((col) => col.name);

            if (!columnNames.includes('approved_by')) {
                db.run(`ALTER TABLE users ADD COLUMN approved_by TEXT`);
            }

            if (!columnNames.includes('approved_at')) {
                db.run(`ALTER TABLE users ADD COLUMN approved_at DATETIME`);
            }

            const hasIsActive = columnNames.includes('is_active');

            if (!hasIsActive) {
                db.run(`ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 0`, (alterErr) => {
                    if (alterErr) {
                        console.error('Error adding is_active column:', alterErr);
                        return;
                    }
                    // Preserve existing behavior for older rows
                    db.run(`UPDATE users SET is_active = 1 WHERE is_active IS NULL`);
                });
            } else {
                // Preserve existing behavior for older rows
                db.run(`UPDATE users SET is_active = 1 WHERE is_active IS NULL`);
            }

            if (!columnNames.includes('created_at')) {
                db.run(`ALTER TABLE users ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
            }

            if (!columnNames.includes('reset_code')) {
                db.run(`ALTER TABLE users ADD COLUMN reset_code TEXT`);
            }

            if (!columnNames.includes('reset_code_expiration')) {
                db.run(`ALTER TABLE users ADD COLUMN reset_code_expiration DATETIME`);
            }
        });

        // Projects table
        db.run(`
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plm_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                owner_id TEXT NOT NULL,
                status TEXT DEFAULT 'active',
                progress INTEGER DEFAULT 0,
                deadline TEXT,
                manager TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(owner_id) REFERENCES users(id)
            )
        `);

        // Migrate projects table for new columns (for existing DBs that lack them)
        db.all(`PRAGMA table_info(projects)`, (err, columns) => {
            if (err) { console.error('Error checking projects schema:', err); return; }
            const colNames = columns.map(c => c.name);
            if (!colNames.includes('progress')) db.run(`ALTER TABLE projects ADD COLUMN progress INTEGER DEFAULT 0`);
            if (!colNames.includes('deadline')) db.run(`ALTER TABLE projects ADD COLUMN deadline TEXT`);
            if (!colNames.includes('manager')) db.run(`ALTER TABLE projects ADD COLUMN manager TEXT`);
        });

        // Submissions table
        db.run(`
            CREATE TABLE IF NOT EXISTS submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                designer_id TEXT NOT NULL,
                submission_type TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                file_path TEXT,
                comments TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(project_id) REFERENCES projects(id),
                FOREIGN KEY(designer_id) REFERENCES users(id)
            )
        `);

        // Tasks table
        db.run(`
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                designer_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                priority TEXT DEFAULT 'medium',
                due_date DATETIME,
                completed BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(project_id) REFERENCES projects(id),
                FOREIGN KEY(designer_id) REFERENCES users(id)
            )
        `);

        // Approvals table
        db.run(`
            CREATE TABLE IF NOT EXISTS approvals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                submission_id INTEGER NOT NULL,
                approver_id TEXT NOT NULL,
                decision TEXT,
                feedback TEXT,
                decision_date DATETIME,
                FOREIGN KEY(submission_id) REFERENCES submissions(id),
                FOREIGN KEY(approver_id) REFERENCES users(id)
            )
        `);

        // Activity Logs table
        db.run(`
            CREATE TABLE IF NOT EXISTS activity_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                action TEXT NOT NULL,
                action_type TEXT NOT NULL,
                details TEXT,
                timestamp TEXT DEFAULT (datetime('now')),
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        `);

        // Parts table
        db.run(`
            CREATE TABLE IF NOT EXISTS parts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                part_code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                material TEXT,
                vendor TEXT,
                criticality TEXT DEFAULT 'normal',
                lifecycle_state TEXT DEFAULT 'draft',
                tags TEXT,
                owner_id TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(owner_id) REFERENCES users(id)
            )
        `);

        // Part versions table
        db.run(`
            CREATE TABLE IF NOT EXISTS part_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                part_id INTEGER NOT NULL,
                version_label TEXT NOT NULL,
                status TEXT DEFAULT 'working',
                storage_path TEXT,
                working_path TEXT,
                change_notes TEXT,
                frozen_by TEXT,
                frozen_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(part_id) REFERENCES parts(id),
                FOREIGN KEY(frozen_by) REFERENCES users(id)
            )
        `);

        // Assemblies table
        db.run(`
            CREATE TABLE IF NOT EXISTS assemblies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                assembly_code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                criticality TEXT DEFAULT 'normal',
                lifecycle_state TEXT DEFAULT 'draft',
                tags TEXT,
                owner_id TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(owner_id) REFERENCES users(id)
            )
        `);

        // Assembly versions table
        db.run(`
            CREATE TABLE IF NOT EXISTS assembly_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                assembly_id INTEGER NOT NULL,
                version_label TEXT NOT NULL,
                status TEXT DEFAULT 'working',
                storage_path TEXT,
                working_path TEXT,
                change_notes TEXT,
                frozen_by TEXT,
                frozen_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(assembly_id) REFERENCES assemblies(id),
                FOREIGN KEY(frozen_by) REFERENCES users(id)
            )
        `);

        // Assembly parts mapping table
        db.run(`
            CREATE TABLE IF NOT EXISTS assembly_parts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                assembly_version_id INTEGER NOT NULL,
                part_version_id INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(assembly_version_id) REFERENCES assembly_versions(id),
                FOREIGN KEY(part_version_id) REFERENCES part_versions(id)
            )
        `);

        // Part permissions table
        db.run(`
            CREATE TABLE IF NOT EXISTS part_permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                part_id INTEGER NOT NULL,
                user_id TEXT NOT NULL,
                can_edit BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(part_id, user_id),
                FOREIGN KEY(part_id) REFERENCES parts(id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        `);

        // Edit access requests table
        db.run(`
            CREATE TABLE IF NOT EXISTS edit_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                part_id INTEGER NOT NULL,
                requester_id TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                reason TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                decided_by TEXT,
                decided_at DATETIME,
                FOREIGN KEY(part_id) REFERENCES parts(id),
                FOREIGN KEY(requester_id) REFERENCES users(id),
                FOREIGN KEY(decided_by) REFERENCES users(id)
            )
        `);

        // Release requests table
        db.run(`
            CREATE TABLE IF NOT EXISTS release_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_type TEXT NOT NULL,
                item_version_id INTEGER NOT NULL,
                requester_id TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                reason TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                decided_by TEXT,
                decided_at DATETIME,
                FOREIGN KEY(requester_id) REFERENCES users(id),
                FOREIGN KEY(decided_by) REFERENCES users(id)
            )
        `);

        // Indexes for common queries
        db.run(`CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role, is_active)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(timestamp)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_submissions_designer ON submissions(designer_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_approvals_submission ON approvals(submission_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_parts_owner ON parts(owner_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_parts_lifecycle ON parts(lifecycle_state)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_part_versions_part ON part_versions(part_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_part_versions_status ON part_versions(status)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_part_versions_created ON part_versions(created_at)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_assemblies_owner ON assemblies(owner_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_assemblies_lifecycle ON assemblies(lifecycle_state)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_assembly_versions_assembly ON assembly_versions(assembly_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_assembly_versions_status ON assembly_versions(status)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_assembly_parts_part_version ON assembly_parts(part_version_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_edit_requests_status ON edit_requests(status)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_release_requests_status ON release_requests(status)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_release_requests_item ON release_requests(item_type, item_version_id)`);

        // Notifications table
        db.run(`
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                type TEXT DEFAULT 'info',
                is_read BOOLEAN DEFAULT 0,
                link TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        `);
        db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read)`);

        // Engineering Change Orders table
        db.run(`
            CREATE TABLE IF NOT EXISTS eco_orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                eco_number TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                reason TEXT,
                priority TEXT DEFAULT 'medium',
                status TEXT DEFAULT 'draft',
                requester_id TEXT NOT NULL,
                reviewer_id TEXT,
                affected_parts TEXT,
                affected_assemblies TEXT,
                implementation_notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                decided_at DATETIME,
                FOREIGN KEY(requester_id) REFERENCES users(id),
                FOREIGN KEY(reviewer_id) REFERENCES users(id)
            )
        `);
        db.run(`CREATE INDEX IF NOT EXISTS idx_eco_status ON eco_orders(status)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_eco_requester ON eco_orders(requester_id)`);

        // Comments table (for parts, assemblies, ECOs)
        db.run(`
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_type TEXT NOT NULL,
                entity_id INTEGER NOT NULL,
                user_id TEXT NOT NULL,
                username TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        `);
        db.run(`CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_type, entity_id)`);

        // File attachments table
        db.run(`
            CREATE TABLE IF NOT EXISTS attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_type TEXT NOT NULL,
                entity_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                original_name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_size INTEGER,
                mime_type TEXT,
                uploaded_by TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(uploaded_by) REFERENCES users(id)
            )
        `);
        db.run(`CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id)`);

        // Performance indexes for frequently queried columns
        db.run(`CREATE INDEX IF NOT EXISTS idx_users_username_role ON users(username, role)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_designer ON tasks(designer_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_submissions_project ON submissions(project_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_part_versions_part ON part_versions(part_id, created_at DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_assembly_versions_assembly ON assembly_versions(assembly_id, created_at DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id, timestamp DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_eco_orders_status ON eco_orders(status, priority)`);

        // Add new columns to existing tables (safe migration)
        const addColumnSafe = (table, column, type) => {
            db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`, (err) => {
                // Ignore "duplicate column" errors
            });
        };
        addColumnSafe('parts', 'description', 'TEXT');
        addColumnSafe('parts', 'material', 'TEXT');
        addColumnSafe('parts', 'vendor', 'TEXT');
        addColumnSafe('parts', 'criticality', "TEXT DEFAULT 'normal'");
        addColumnSafe('parts', 'lifecycle_state', "TEXT DEFAULT 'draft'");
        addColumnSafe('parts', 'tags', 'TEXT');
        addColumnSafe('parts', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
        addColumnSafe('part_versions', 'change_notes', 'TEXT');
        addColumnSafe('part_versions', 'frozen_by', 'TEXT');
        addColumnSafe('part_versions', 'frozen_at', 'DATETIME');
        addColumnSafe('assemblies', 'description', 'TEXT');
        addColumnSafe('assemblies', 'criticality', "TEXT DEFAULT 'normal'");
        addColumnSafe('assemblies', 'lifecycle_state', "TEXT DEFAULT 'draft'");
        addColumnSafe('assemblies', 'tags', 'TEXT');
        addColumnSafe('assemblies', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
        addColumnSafe('assembly_versions', 'change_notes', 'TEXT');
        addColumnSafe('assembly_versions', 'frozen_by', 'TEXT');
        addColumnSafe('assembly_versions', 'frozen_at', 'DATETIME');
        addColumnSafe('tasks', 'status', "TEXT DEFAULT 'pending'");
        addColumnSafe('tasks', 'progress', 'INTEGER DEFAULT 0');
        addColumnSafe('tasks', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');

        console.log('✓ Database tables initialized');
    });
}

// Helper function to convert UTC/ISO timestamp to India Standard Time (IST)
function convertToIST(timestamp) {
    if (!timestamp) return 'N/A';
    
    try {
        // Parse the timestamp
        let date;
        
        // Handle ISO strings (e.g., "2026-02-09T12:18:07.123Z")
        if (typeof timestamp === 'string' && timestamp.includes('T')) {
            date = new Date(timestamp);
        } 
        // Handle SQLite datetime strings (e.g., "2026-02-09 12:18:07")
        else if (typeof timestamp === 'string' && timestamp.includes('-')) {
            date = new Date(timestamp + 'Z'); // Assume UTC if no timezone specified
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
        console.error('Error converting to IST:', error, timestamp);
        return timestamp;
    }
}

// Helper function to log activities
function logActivity(userId, username, action, actionType, details = null) {
    const isoTimestamp = new Date().toISOString();
    db.run(
        `INSERT INTO activity_logs (user_id, username, action, action_type, details, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, username, action, actionType, details ? JSON.stringify(details) : null, isoTimestamp],
        (err) => {
            if (err) console.error('Error logging activity:', err);
        }
    );
}

// Initialize default users
function initializeDefaultUsers() {
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync('Admin@123', salt);

    const defaultUsers = [
        { id: 'ADMIN-001', username: 'admin', email: 'admin@plm.com', password: hashedPassword, role: 'admin', is_active: 1 },
        { id: 'DESIGNER-01', username: 'designer', email: 'designer@plm.com', password: hashedPassword, role: 'designer', is_active: 1 },
        { id: 'APPROVER-01', username: 'approver', email: 'approver@plm.com', password: hashedPassword, role: 'approver', is_active: 1 }
    ];

    defaultUsers.forEach(user => {
        db.run(
            `INSERT OR IGNORE INTO users (id, username, email, password, role, is_active) VALUES (?, ?, ?, ?, ?, ?)`,
            [user.id, user.username, user.email, user.password, user.role, user.is_active],
            (err) => {
                if (!err) console.log(`✓ User ${user.username} initialized`);
            }
        );
    });

    // Ensure default admin and approver are active in existing databases
    db.run(`UPDATE users SET is_active = 1 WHERE id IN ('ADMIN-001', 'APPROVER-01', 'DESIGNER-01')`);

    // Insert default project with all columns
    db.run(
        `INSERT OR IGNORE INTO projects (plm_id, name, owner_id, status, progress, deadline, manager) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['PLM-PRI-003', 'Dashboard Project', 'ADMIN-001', 'active', 65, '2026-03-15', 'ADMIN-001']
    );
}

// Password validation function
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

// Email validation function
function validateEmail(email) {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
}

// Auth Routes
app.post('/api/auth/login', (req, res) => {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    db.get(
        `SELECT * FROM users WHERE username = ? AND role = ?`,
        [username, role],
        (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            
            // User not found - generic error to prevent user enumeration
            if (!user) {
                return res.status(401).json({ 
                    error: 'Invalid credentials'
                });
            }

            // Check if user is active (approved by admin)
            if (!user.is_active) {
                return res.status(403).json({ error: 'Your account is pending admin approval' });
            }

            // Check password - generic error to prevent user enumeration
            const validPassword = bcrypt.compareSync(password, user.password);
            if (!validPassword) {
                return res.status(401).json({ 
                    error: 'Invalid credentials'
                });
            }

            const token = jwt.sign(
                { id: user.id, username: user.username, role: user.role },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            // Log login activity
            logActivity(user.id, user.username, `${user.role} login successful`, 'LOGIN', {
                role: user.role,
                email: user.email
            });

            res.json({
                success: true,
                token,
                user: { id: user.id, username: user.username, role: user.role, email: user.email, is_active: user.is_active }
            });
        }
    );
});

app.post('/api/auth/signup', async (req, res) => {
    const { username, email, password, role } = req.body;

    if (!username || !email || !password || !role) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Input length validation
    if (username.length > 50) return res.status(400).json({ error: 'Username must be 50 characters or less' });
    if (email.length > 100) return res.status(400).json({ error: 'Email must be 100 characters or less' });
    if (password.length > 128) return res.status(400).json({ error: 'Password must be 128 characters or less' });

    // Prevent admin role signup
    if (role === 'admin') {
        return res.status(403).json({ error: 'Admin accounts cannot be created through signup. Contact system administrator.' });
    }

    // Validate email format
    if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
        const errorMsg = 'Weak Password! Password must have: ' + passwordValidation.errors.join(', ');
        return res.status(400).json({ error: errorMsg });
    }

    const userId = `${role.toUpperCase()}-${Date.now()}`;

    // New users (except designer) need admin approval
    const needsApproval = role !== 'designer';
    const isActive = !needsApproval;

    // Use async bcrypt to avoid blocking the event loop
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    db.run(
        `INSERT INTO users (id, username, email, password, role, is_active) VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, username, email, hashedPassword, role, isActive ? 1 : 0],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(400).json({ error: 'Username or email already exists' });
                }
                return res.status(500).json({ error: err.message });
            }

            // Log account creation
            logActivity(userId, username, `${role} account created`, 'ACCOUNT_CREATED', {
                role: role,
                email: email,
                needsApproval: needsApproval
            });

            // If needs approval, don't issue token yet
            if (needsApproval) {
                return res.status(201).json({
                    success: true,
                    message: `${role} account created. Awaiting admin approval.`,
                    token: null,
                    user: { id: userId, username, role, email, is_active: false }
                });
            }

            const token = jwt.sign(
                { id: userId, username, role },
                JWT_SECRET,
                { expiresIn: '24h' }
            );

            res.status(201).json({
                success: true,
                token,
                user: { id: userId, username, role, email, is_active: true }
            });
        }
    );
});

// Middleware: Verify JWT Token
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Invalid token' });
        req.user = decoded;
        next();
    });
};

// Role-based access middleware
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ error: `Access denied. Requires role: ${roles.join(' or ')}` });
        }
        next();
    };
}

function isApproverOrAdmin(role) {
    return role === 'approver' || role === 'admin';
}

function canEditPart(userId, role, partId, callback) {
    if (role === 'admin') {
        return callback(null, true);
    }

    db.get(`SELECT owner_id FROM parts WHERE id = ?`, [partId], (err, part) => {
        if (err) return callback(err);
        if (!part) return callback(null, false);

        if (part.owner_id === userId) {
            return callback(null, true);
        }

        db.get(
            `SELECT can_edit FROM part_permissions WHERE part_id = ? AND user_id = ?`,
            [partId, userId],
            (permErr, perm) => {
                if (permErr) return callback(permErr);
                callback(null, !!(perm && perm.can_edit));
            }
        );
    });
}

function getLatestPartVersion(partId, callback) {
    db.get(
        `SELECT * FROM part_versions WHERE part_id = ? ORDER BY created_at DESC LIMIT 1`,
        [partId],
        callback
    );
}

function getLatestAssemblyVersion(assemblyId, callback) {
    db.get(
        `SELECT * FROM assembly_versions WHERE assembly_id = ? ORDER BY created_at DESC LIMIT 1`,
        [assemblyId],
        callback
    );
}

// ====== Vault Rules: Parts ======
app.post('/api/parts', verifyToken, requireRole('designer', 'admin'), (req, res) => {
    const { part_code, name, working_path, description, material, vendor, criticality, tags } = req.body;

    if (!part_code || !name) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Input length limits
    if (part_code.length > 50) return res.status(400).json({ error: 'Part code too long (max 50)' });
    if (name.length > 200) return res.status(400).json({ error: 'Name too long (max 200)' });
    if (description && description.length > 2000) return res.status(400).json({ error: 'Description too long (max 2000)' });

    const cErr = validateEnum(criticality, VALID_CRITICALITY, 'criticality');
    if (cErr) return res.status(400).json({ error: cErr });

    db.run(
        `INSERT INTO parts (part_code, name, owner_id, description, material, vendor, criticality, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [part_code, name, req.user.id, description || null, material || null, vendor || null, criticality || 'normal', tags || null],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(400).json({ error: 'Part code already exists' });
                }
                return res.status(500).json({ error: err.message });
            }

            const partId = this.lastID;

            db.run(
                `INSERT INTO part_versions (part_id, version_label, status, working_path) VALUES (?, ?, ?, ?)`,
                [partId, 'V1', 'working', working_path || null],
                (versionErr) => {
                    if (versionErr) return res.status(500).json({ error: versionErr.message });

                    db.run(
                        `INSERT OR IGNORE INTO part_permissions (part_id, user_id, can_edit) VALUES (?, ?, 1)`,
                        [partId, req.user.id]
                    );

                    logActivity(req.user.id, req.user.username, `Created part ${part_code}`, 'PART_CREATED', {
                        part_id: partId,
                        part_code: part_code
                    });

                    res.status(201).json({ id: partId, part_code, name });
                }
            );
        }
    );
});

app.get('/api/parts', verifyToken, (req, res) => {
    const { search, owner, status, criticality, lifecycle, tags } = req.query;
    let query = `SELECT p.*, u.username as owner_name,
        COALESCE(pv_agg.version_count, 0) as version_count,
        pv_agg.latest_status, pv_agg.latest_version
        FROM parts p JOIN users u ON p.owner_id = u.id
        LEFT JOIN (
            SELECT part_id, COUNT(*) as version_count,
                   MAX(CASE WHEN rn = 1 THEN status END) as latest_status,
                   MAX(CASE WHEN rn = 1 THEN version_label END) as latest_version
            FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY part_id ORDER BY created_at DESC) as rn FROM part_versions) sub
            GROUP BY part_id
        ) pv_agg ON pv_agg.part_id = p.id`;
    const conditions = [];
    const params = [];

    if (search) {
        conditions.push(`(p.part_code LIKE ? OR p.name LIKE ? OR p.description LIKE ? OR p.material LIKE ? OR p.vendor LIKE ?)`);
        const s = `%${search}%`;
        params.push(s, s, s, s, s);
    }
    if (owner) { conditions.push(`u.username = ?`); params.push(owner); }
    if (criticality) { conditions.push(`p.criticality = ?`); params.push(criticality); }
    if (lifecycle) { conditions.push(`p.lifecycle_state = ?`); params.push(lifecycle); }
    if (tags) { conditions.push(`p.tags LIKE ?`); params.push(`%${tags}%`); }

    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY p.created_at DESC';

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.get('/api/parts/:part_id/versions', verifyToken, (req, res) => {
    db.all(
        `SELECT pv.*, u.username as frozen_by_name FROM part_versions pv
         LEFT JOIN users u ON pv.frozen_by = u.id
         WHERE pv.part_id = ? ORDER BY pv.created_at DESC`,
        [req.params.part_id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        }
    );
});

// Get part detail with metadata
app.get('/api/parts/:part_id', verifyToken, (req, res) => {
    db.get(
        `SELECT p.*, u.username as owner_name FROM parts p JOIN users u ON p.owner_id = u.id WHERE p.id = ?`,
        [req.params.part_id],
        (err, part) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!part) return res.status(404).json({ error: 'Part not found' });
            res.json(part);
        }
    );
});

// Update part metadata
app.put('/api/parts/:part_id', verifyToken, (req, res) => {
    const partId = req.params.part_id;
    canEditPart(req.user.id, req.user.role, partId, (permErr, allowed) => {
        if (permErr) return res.status(500).json({ error: permErr.message });
        if (!allowed) return res.status(403).json({ error: 'No edit permission for this part' });

        const { name, description, material, vendor, criticality, lifecycle_state, tags } = req.body;

        // Validate lifecycle_state if provided
        if (lifecycle_state && !VALID_LIFECYCLE.includes(lifecycle_state)) {
            return res.status(400).json({ error: `Invalid lifecycle state. Must be one of: ${VALID_LIFECYCLE.join(', ')}` });
        }

        db.run(
            `UPDATE parts SET name = COALESCE(?, name), description = COALESCE(?, description),
             material = COALESCE(?, material), vendor = COALESCE(?, vendor),
             criticality = COALESCE(?, criticality), lifecycle_state = COALESCE(?, lifecycle_state),
             tags = COALESCE(?, tags), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [name, description, material, vendor, criticality, lifecycle_state, tags, partId],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                logActivity(req.user.id, req.user.username, `Updated part metadata ${partId}`, 'PART_UPDATED', { part_id: partId });
                res.json({ success: true, message: 'Part updated' });
            }
        );
    });
});

// Delete part (admin only)
app.delete('/api/parts/:part_id', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can delete parts' });
    }
    const partId = req.params.part_id;

    // Check if any assembly references this part's versions
    db.get(
        `SELECT COUNT(*) as count FROM assembly_parts ap
         JOIN part_versions pv ON ap.part_version_id = pv.id
         WHERE pv.part_id = ?`,
        [partId],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (row.count > 0) {
                return res.status(400).json({ error: 'Cannot delete: part is referenced by assemblies. Remove assembly references first.' });
            }
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                db.run(`DELETE FROM part_permissions WHERE part_id = ?`, [partId]);
                db.run(`DELETE FROM edit_requests WHERE part_id = ?`, [partId]);
                db.run(`DELETE FROM part_versions WHERE part_id = ?`, [partId]);
                db.run(`DELETE FROM parts WHERE id = ?`, [partId], function(delErr) {
                    if (delErr) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: delErr.message });
                    }
                    db.run('COMMIT');
                    logActivity(req.user.id, req.user.username, `Deleted part ${partId}`, 'PART_DELETED', { part_id: partId });
                    res.json({ success: true, message: 'Part deleted' });
                });
            });
        }
    );
});

// Impact check: show all assemblies referencing a part
app.get('/api/parts/:part_id/impact', verifyToken, (req, res) => {
    db.all(
        `SELECT DISTINCT a.id, a.assembly_code, a.name as assembly_name, av.version_label, av.status as version_status,
         pv.version_label as part_version_label, pv.id as part_version_id
         FROM assembly_parts ap
         JOIN part_versions pv ON ap.part_version_id = pv.id
         JOIN assembly_versions av ON ap.assembly_version_id = av.id
         JOIN assemblies a ON av.assembly_id = a.id
         WHERE pv.part_id = ?
         ORDER BY a.assembly_code, av.version_label`,
        [req.params.part_id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ assemblies: rows || [] });
        }
    );
});

// Permissions list for a part
app.get('/api/parts/:part_id/permissions', verifyToken, (req, res) => {
    db.all(
        `SELECT pp.*, u.username FROM part_permissions pp
         JOIN users u ON pp.user_id = u.id
         WHERE pp.part_id = ?`,
        [req.params.part_id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        }
    );
});

app.post('/api/parts/:part_id/versions', verifyToken, (req, res) => {
    const partId = req.params.part_id;
    const { version_label, working_path, change_notes } = req.body;

    canEditPart(req.user.id, req.user.role, partId, (permErr, allowed) => {
        if (permErr) return res.status(500).json({ error: permErr.message });
        if (!allowed) return res.status(403).json({ error: 'No edit permission for this part' });

        getLatestPartVersion(partId, (lastErr, lastVersion) => {
            if (lastErr) return res.status(500).json({ error: lastErr.message });
            if (lastVersion && lastVersion.status !== 'frozen') {
                return res.status(400).json({ error: 'Previous version must be frozen before creating a new version' });
            }

            db.get(
                `SELECT COUNT(*) as count FROM part_versions WHERE part_id = ?`,
                [partId],
                (countErr, countRow) => {
                    if (countErr) return res.status(500).json({ error: countErr.message });

                    const nextLabel = version_label || `V${(countRow?.count || 0) + 1}`;

                    db.run(
                        `INSERT INTO part_versions (part_id, version_label, status, working_path, change_notes) VALUES (?, ?, ?, ?, ?)`,
                        [partId, nextLabel, 'working', working_path || null, change_notes || null],
                        function(insertErr) {
                            if (insertErr) return res.status(500).json({ error: insertErr.message });

                            logActivity(req.user.id, req.user.username, `Created part version ${nextLabel}`, 'PART_VERSION_CREATED', {
                                part_id: partId,
                                version_label: nextLabel
                            });

                            res.status(201).json({ id: this.lastID, part_id: partId, version_label: nextLabel });
                        }
                    );
                }
            );
        });
    });
});

app.post('/api/parts/:part_id/versions/:version_id/freeze', verifyToken, (req, res) => {
    const partId = req.params.part_id;
    const versionId = req.params.version_id;

    if (!isApproverOrAdmin(req.user.role)) {
        return res.status(403).json({ error: 'Only approvers or admins can freeze versions' });
    }

    db.run(
        `UPDATE part_versions SET status = 'frozen', storage_path = COALESCE(storage_path, working_path), frozen_by = ?, frozen_at = CURRENT_TIMESTAMP WHERE id = ? AND part_id = ?`,
        [req.user.id, versionId, partId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Part version not found' });

            logActivity(req.user.id, req.user.username, `Froze part version ${versionId}`, 'PART_FROZEN', {
                part_id: partId,
                version_id: versionId
            });

            res.json({ success: true, message: 'Part version frozen' });
        }
    );
});

app.post('/api/parts/:part_id/rollback', verifyToken, (req, res) => {
    const partId = req.params.part_id;
    const { version_id } = req.body;

    if (!version_id) {
        return res.status(400).json({ error: 'version_id is required' });
    }

    canEditPart(req.user.id, req.user.role, partId, (permErr, allowed) => {
        if (permErr) return res.status(500).json({ error: permErr.message });
        if (!allowed) return res.status(403).json({ error: 'No edit permission for this part' });

        db.get(
            `SELECT COUNT(*) as count FROM assembly_parts WHERE part_version_id = ?`,
            [version_id],
            (linkErr, linkRow) => {
                if (linkErr) return res.status(500).json({ error: linkErr.message });
                if (linkRow?.count > 0) {
                    return res.status(400).json({ error: 'Rollback blocked: part version is referenced by assemblies' });
                }

                getLatestPartVersion(partId, (lastErr, lastVersion) => {
                    if (lastErr) return res.status(500).json({ error: lastErr.message });
                    if (lastVersion && lastVersion.status !== 'frozen') {
                        return res.status(400).json({ error: 'Freeze current version before rollback' });
                    }

                    db.get(
                        `SELECT COUNT(*) as count FROM part_versions WHERE part_id = ?`,
                        [partId],
                        (countErr, countRow) => {
                            if (countErr) return res.status(500).json({ error: countErr.message });

                            const nextLabel = `V${(countRow?.count || 0) + 1}`;

                            db.run(
                                `INSERT INTO part_versions (part_id, version_label, status) VALUES (?, ?, ?)`,
                                [partId, nextLabel, 'working'],
                                function(insertErr) {
                                    if (insertErr) return res.status(500).json({ error: insertErr.message });

                                    logActivity(req.user.id, req.user.username, `Rollback created part version ${nextLabel}`, 'PART_ROLLBACK', {
                                        part_id: partId,
                                        source_version_id: version_id
                                    });

                                    res.status(201).json({ id: this.lastID, part_id: partId, version_label: nextLabel });
                                }
                            );
                        }
                    );
                });
            }
        );
    });
});

// ====== Vault Rules: Assemblies ======
app.post('/api/assemblies', verifyToken, (req, res) => {
    if (req.user.role !== 'designer' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only designers or admins can create assemblies' });
    }

    const { assembly_code, name, part_version_ids, working_path, description, criticality, tags } = req.body;

    if (!assembly_code || !name || !Array.isArray(part_version_ids) || part_version_ids.length === 0) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Input length limits
    if (assembly_code.length > 50) return res.status(400).json({ error: 'Assembly code too long (max 50)' });
    if (name.length > 200) return res.status(400).json({ error: 'Name too long (max 200)' });
    if (description && description.length > 2000) return res.status(400).json({ error: 'Description too long (max 2000)' });

    db.all(
        `SELECT id, status FROM part_versions WHERE id IN (${part_version_ids.map(() => '?').join(',')})`,
        part_version_ids,
        (partErr, rows) => {
            if (partErr) return res.status(500).json({ error: partErr.message });
            if (rows.length !== part_version_ids.length) {
                return res.status(400).json({ error: 'One or more part versions not found' });
            }

            const notFrozen = rows.find((row) => row.status !== 'frozen');
            if (notFrozen) {
                return res.status(400).json({ error: 'All part versions must be frozen before creating assembly' });
            }

            db.run(
                `INSERT INTO assemblies (assembly_code, name, owner_id, description, criticality, tags) VALUES (?, ?, ?, ?, ?, ?)`,
                [assembly_code, name, req.user.id, description || null, criticality || 'normal', tags || null],
                function(err) {
                    if (err) {
                        if (err.message.includes('UNIQUE')) {
                            return res.status(400).json({ error: 'Assembly code already exists' });
                        }
                        return res.status(500).json({ error: err.message });
                    }

                    const assemblyId = this.lastID;

                    db.run(
                        `INSERT INTO assembly_versions (assembly_id, version_label, status, working_path) VALUES (?, ?, ?, ?)`,
                        [assemblyId, 'V1', 'working', working_path || null],
                        function(versionErr) {
                            if (versionErr) return res.status(500).json({ error: versionErr.message });

                            const assemblyVersionId = this.lastID;

                            const insertValues = part_version_ids.map((id) => [assemblyVersionId, id]);
                            const placeholders = insertValues.map(() => '(?, ?)').join(',');
                            const flatValues = insertValues.flat();

                            db.run(
                                `INSERT INTO assembly_parts (assembly_version_id, part_version_id) VALUES ${placeholders}`,
                                flatValues,
                                (mapErr) => {
                                    if (mapErr) return res.status(500).json({ error: mapErr.message });

                                    logActivity(req.user.id, req.user.username, `Created assembly ${assembly_code}`, 'ASSEMBLY_CREATED', {
                                        assembly_id: assemblyId,
                                        assembly_code: assembly_code
                                    });

                                    res.status(201).json({ id: assemblyId, assembly_code, name });
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});

app.get('/api/assemblies', verifyToken, (req, res) => {
    const { search, owner, criticality, lifecycle, tags } = req.query;
    let query = `SELECT a.*, u.username as owner_name,
        COALESCE(av_agg.version_count, 0) as version_count,
        av_agg.latest_status, av_agg.latest_version
        FROM assemblies a JOIN users u ON a.owner_id = u.id
        LEFT JOIN (
            SELECT assembly_id, COUNT(*) as version_count,
                   MAX(CASE WHEN rn = 1 THEN status END) as latest_status,
                   MAX(CASE WHEN rn = 1 THEN version_label END) as latest_version
            FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY assembly_id ORDER BY created_at DESC) as rn FROM assembly_versions) sub
            GROUP BY assembly_id
        ) av_agg ON av_agg.assembly_id = a.id`;
    const conditions = [];
    const params = [];

    if (search) {
        conditions.push(`(a.assembly_code LIKE ? OR a.name LIKE ? OR a.description LIKE ?)`);
        const s = `%${search}%`;
        params.push(s, s, s);
    }
    if (owner) { conditions.push(`u.username = ?`); params.push(owner); }
    if (criticality) { conditions.push(`a.criticality = ?`); params.push(criticality); }
    if (lifecycle) { conditions.push(`a.lifecycle_state = ?`); params.push(lifecycle); }
    if (tags) { conditions.push(`a.tags LIKE ?`); params.push(`%${tags}%`); }

    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY a.created_at DESC';

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.get('/api/assemblies/:assembly_id/versions', verifyToken, (req, res) => {
    db.all(
        `SELECT av.*, u.username as frozen_by_name FROM assembly_versions av
         LEFT JOIN users u ON av.frozen_by = u.id
         WHERE av.assembly_id = ? ORDER BY av.created_at DESC`,
        [req.params.assembly_id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        }
    );
});

// BOM view: get all parts in an assembly version
app.get('/api/assemblies/:assembly_id/versions/:version_id/bom', verifyToken, (req, res) => {
    db.all(
        `SELECT p.id as part_id, p.part_code, p.name as part_name, p.material, p.vendor, p.criticality,
         pv.id as part_version_id, pv.version_label, pv.status as version_status, pv.change_notes,
         u.username as owner_name
         FROM assembly_parts ap
         JOIN part_versions pv ON ap.part_version_id = pv.id
         JOIN parts p ON pv.part_id = p.id
         JOIN users u ON p.owner_id = u.id
         WHERE ap.assembly_version_id = ?
         ORDER BY p.part_code`,
        [req.params.version_id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ parts: rows || [] });
        }
    );
});

// Assembly detail
app.get('/api/assemblies/:assembly_id', verifyToken, (req, res) => {
    db.get(
        `SELECT a.*, u.username as owner_name FROM assemblies a JOIN users u ON a.owner_id = u.id WHERE a.id = ?`,
        [req.params.assembly_id],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'Assembly not found' });
            res.json(row);
        }
    );
});

// Update assembly metadata
app.put('/api/assemblies/:assembly_id', verifyToken, (req, res) => {
    const assemblyId = req.params.assembly_id;
    const { name, description, criticality, lifecycle_state, tags } = req.body;

    // Validate lifecycle_state if provided
    if (lifecycle_state && !VALID_LIFECYCLE.includes(lifecycle_state)) {
        return res.status(400).json({ error: `Invalid lifecycle state. Must be one of: ${VALID_LIFECYCLE.join(', ')}` });
    }

    db.get(`SELECT owner_id FROM assemblies WHERE id = ?`, [assemblyId], (err, asm) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!asm) return res.status(404).json({ error: 'Assembly not found' });
        if (asm.owner_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'No permission to edit this assembly' });
        }
        db.run(
            `UPDATE assemblies SET name = COALESCE(?, name), description = COALESCE(?, description),
             criticality = COALESCE(?, criticality), lifecycle_state = COALESCE(?, lifecycle_state),
             tags = COALESCE(?, tags), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [name, description, criticality, lifecycle_state, tags, assemblyId],
            function(updateErr) {
                if (updateErr) return res.status(500).json({ error: updateErr.message });
                logActivity(req.user.id, req.user.username, `Updated assembly metadata ${assemblyId}`, 'ASSEMBLY_UPDATED', { assembly_id: assemblyId });
                res.json({ success: true, message: 'Assembly updated' });
            }
        );
    });
});

// Delete assembly (admin only)
app.delete('/api/assemblies/:assembly_id', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can delete assemblies' });
    }
    const assemblyId = req.params.assembly_id;
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run(`DELETE FROM assembly_parts WHERE assembly_version_id IN (SELECT id FROM assembly_versions WHERE assembly_id = ?)`, [assemblyId]);
        db.run(`DELETE FROM assembly_versions WHERE assembly_id = ?`, [assemblyId]);
        db.run(`DELETE FROM assemblies WHERE id = ?`, [assemblyId], function(err) {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
            }
            db.run('COMMIT');
            logActivity(req.user.id, req.user.username, `Deleted assembly ${assemblyId}`, 'ASSEMBLY_DELETED', { assembly_id: assemblyId });
            res.json({ success: true, message: 'Assembly deleted' });
        });
    });
});

app.post('/api/assemblies/:assembly_id/versions', verifyToken, (req, res) => {
    const assemblyId = req.params.assembly_id;
    const { version_label, part_version_ids, working_path } = req.body;

    if (!Array.isArray(part_version_ids) || part_version_ids.length === 0) {
        return res.status(400).json({ error: 'part_version_ids is required' });
    }

    getLatestAssemblyVersion(assemblyId, (lastErr, lastVersion) => {
        if (lastErr) return res.status(500).json({ error: lastErr.message });
        if (lastVersion && lastVersion.status !== 'frozen') {
            return res.status(400).json({ error: 'Previous assembly version must be frozen before creating a new version' });
        }

        db.all(
            `SELECT id, status FROM part_versions WHERE id IN (${part_version_ids.map(() => '?').join(',')})`,
            part_version_ids,
            (partErr, rows) => {
                if (partErr) return res.status(500).json({ error: partErr.message });
                if (rows.length !== part_version_ids.length) {
                    return res.status(400).json({ error: 'One or more part versions not found' });
                }

                const notFrozen = rows.find((row) => row.status !== 'frozen');
                if (notFrozen) {
                    return res.status(400).json({ error: 'All part versions must be frozen before creating assembly version' });
                }

                db.get(
                    `SELECT COUNT(*) as count FROM assembly_versions WHERE assembly_id = ?`,
                    [assemblyId],
                    (countErr, countRow) => {
                        if (countErr) return res.status(500).json({ error: countErr.message });

                        const nextLabel = version_label || `V${(countRow?.count || 0) + 1}`;

                        db.run(
                            `INSERT INTO assembly_versions (assembly_id, version_label, status, working_path) VALUES (?, ?, ?, ?)`,
                            [assemblyId, nextLabel, 'working', working_path || null],
                            function(versionErr) {
                                if (versionErr) return res.status(500).json({ error: versionErr.message });

                                const assemblyVersionId = this.lastID;
                                const insertValues = part_version_ids.map((id) => [assemblyVersionId, id]);
                                const placeholders = insertValues.map(() => '(?, ?)').join(',');
                                const flatValues = insertValues.flat();

                                db.run(
                                    `INSERT INTO assembly_parts (assembly_version_id, part_version_id) VALUES ${placeholders}`,
                                    flatValues,
                                    (mapErr) => {
                                        if (mapErr) return res.status(500).json({ error: mapErr.message });

                                        logActivity(req.user.id, req.user.username, `Created assembly version ${nextLabel}`, 'ASSEMBLY_VERSION_CREATED', {
                                            assembly_id: assemblyId,
                                            version_label: nextLabel
                                        });

                                        res.status(201).json({ id: assemblyVersionId, assembly_id: assemblyId, version_label: nextLabel });
                                    }
                                );
                            }
                        );
                    }
                );
            }
        );
    });
});

app.post('/api/assemblies/:assembly_id/versions/:version_id/freeze', verifyToken, (req, res) => {
    const assemblyId = req.params.assembly_id;
    const versionId = req.params.version_id;

    if (!isApproverOrAdmin(req.user.role)) {
        return res.status(403).json({ error: 'Only approvers or admins can freeze versions' });
    }

    db.run(
        `UPDATE assembly_versions SET status = 'frozen', storage_path = COALESCE(storage_path, working_path), frozen_by = ?, frozen_at = CURRENT_TIMESTAMP WHERE id = ? AND assembly_id = ?`,
        [req.user.id, versionId, assemblyId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Assembly version not found' });

            logActivity(req.user.id, req.user.username, `Froze assembly version ${versionId}`, 'ASSEMBLY_FROZEN', {
                assembly_id: assemblyId,
                version_id: versionId
            });

            res.json({ success: true, message: 'Assembly version frozen' });
        }
    );
});

// ====== Vault Rules: Edit Requests ======
app.post('/api/parts/:part_id/edit-requests', verifyToken, (req, res) => {
    const partId = req.params.part_id;
    const { reason } = req.body;

    if (req.user.role !== 'designer') {
        return res.status(403).json({ error: 'Only designers can request edit access' });
    }

    db.run(
        `INSERT INTO edit_requests (part_id, requester_id, reason) VALUES (?, ?, ?)`,
        [partId, req.user.id, reason || null],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });

            logActivity(req.user.id, req.user.username, `Requested edit access for part ${partId}`, 'EDIT_REQUESTED', {
                part_id: partId
            });

            res.status(201).json({ id: this.lastID, part_id: partId });
        }
    );
});

app.get('/api/edit-requests', verifyToken, (req, res) => {
    if (!isApproverOrAdmin(req.user.role)) {
        return res.status(403).json({ error: 'Only approvers or admins can view edit requests' });
    }

    db.all(
        `SELECT er.*, u.username as requester_name, p.part_code
         FROM edit_requests er
         JOIN users u ON er.requester_id = u.id
         JOIN parts p ON er.part_id = p.id
         WHERE er.status = 'pending'
         ORDER BY er.created_at DESC`,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        }
    );
});

app.post('/api/edit-requests/:request_id/approve', verifyToken, (req, res) => {
    if (!isApproverOrAdmin(req.user.role)) {
        return res.status(403).json({ error: 'Only approvers or admins can approve edit requests' });
    }

    const requestId = req.params.request_id;

    db.get(`SELECT * FROM edit_requests WHERE id = ?`, [requestId], (err, request) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!request) return res.status(404).json({ error: 'Request not found' });

        db.run(
            `UPDATE edit_requests SET status = 'approved', decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [req.user.id, requestId],
            (updateErr) => {
                if (updateErr) return res.status(500).json({ error: updateErr.message });

                db.run(
                    `INSERT OR REPLACE INTO part_permissions (part_id, user_id, can_edit) VALUES (?, ?, 1)`,
                    [request.part_id, request.requester_id]
                );

                logActivity(req.user.id, req.user.username, `Approved edit request ${requestId}`, 'EDIT_REQUEST_APPROVED', {
                    part_id: request.part_id,
                    requester_id: request.requester_id
                });

                res.json({ success: true, message: 'Edit request approved' });
            }
        );
    });
});

app.post('/api/edit-requests/:request_id/reject', verifyToken, (req, res) => {
    if (!isApproverOrAdmin(req.user.role)) {
        return res.status(403).json({ error: 'Only approvers or admins can reject edit requests' });
    }

    const requestId = req.params.request_id;

    db.run(
        `UPDATE edit_requests SET status = 'rejected', decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [req.user.id, requestId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Request not found' });

            logActivity(req.user.id, req.user.username, `Rejected edit request ${requestId}`, 'EDIT_REQUEST_REJECTED', {
                request_id: requestId
            });

            res.json({ success: true, message: 'Edit request rejected' });
        }
    );
});

// ====== Vault Rules: Release Requests ======
app.post('/api/release-requests', verifyToken, (req, res) => {
    const { item_type, item_version_id, reason } = req.body;

    if (!item_type || !item_version_id) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (item_type !== 'part' && item_type !== 'assembly') {
        return res.status(400).json({ error: 'Invalid item_type' });
    }

    db.run(
        `INSERT INTO release_requests (item_type, item_version_id, requester_id, reason) VALUES (?, ?, ?, ?)`,
        [item_type, item_version_id, req.user.id, reason || null],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });

            logActivity(req.user.id, req.user.username, `Requested release for ${item_type} version ${item_version_id}`, 'RELEASE_REQUESTED', {
                item_type: item_type,
                item_version_id: item_version_id
            });

            res.status(201).json({ id: this.lastID, item_type, item_version_id });
        }
    );
});

app.get('/api/release-requests', verifyToken, (req, res) => {
    if (!isApproverOrAdmin(req.user.role)) {
        return res.status(403).json({ error: 'Only approvers or admins can view release requests' });
    }

    db.all(
        `SELECT * FROM release_requests WHERE status = 'pending' ORDER BY created_at DESC`,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        }
    );
});

app.post('/api/release-requests/:request_id/approve', verifyToken, (req, res) => {
    if (!isApproverOrAdmin(req.user.role)) {
        return res.status(403).json({ error: 'Only approvers or admins can approve release requests' });
    }

    const requestId = req.params.request_id;

    db.get(`SELECT * FROM release_requests WHERE id = ?`, [requestId], (err, request) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!request) return res.status(404).json({ error: 'Request not found' });

        db.run(
            `UPDATE release_requests SET status = 'approved', decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [req.user.id, requestId],
            (updateErr) => {
                if (updateErr) return res.status(500).json({ error: updateErr.message });

                const freezeQuery = request.item_type === 'part'
                    ? `UPDATE part_versions SET status = 'frozen', storage_path = COALESCE(storage_path, working_path) WHERE id = ?`
                    : `UPDATE assembly_versions SET status = 'frozen', storage_path = COALESCE(storage_path, working_path) WHERE id = ?`;

                db.run(freezeQuery, [request.item_version_id], (freezeErr) => {
                    if (freezeErr) return res.status(500).json({ error: freezeErr.message });

                    logActivity(req.user.id, req.user.username, `Approved release request ${requestId}`, 'RELEASE_APPROVED', {
                        item_type: request.item_type,
                        item_version_id: request.item_version_id
                    });

                    res.json({ success: true, message: 'Release request approved' });
                });
            }
        );
    });
});

app.post('/api/release-requests/:request_id/reject', verifyToken, (req, res) => {
    if (!isApproverOrAdmin(req.user.role)) {
        return res.status(403).json({ error: 'Only approvers or admins can reject release requests' });
    }

    const requestId = req.params.request_id;

    db.run(
        `UPDATE release_requests SET status = 'rejected', decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [req.user.id, requestId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Request not found' });

            logActivity(req.user.id, req.user.username, `Rejected release request ${requestId}`, 'RELEASE_REJECTED', {
                request_id: requestId
            });

            res.json({ success: true, message: 'Release request rejected' });
        }
    );
});

// Projects Routes
app.get('/api/projects', verifyToken, (req, res) => {
    const query = req.user.role === 'admin' 
        ? `SELECT p.*, u.username as owner_name FROM projects p JOIN users u ON p.owner_id = u.id`
        : `SELECT p.*, u.username as owner_name FROM projects p
           JOIN users u ON p.owner_id = u.id
           LEFT JOIN tasks t ON p.id = t.project_id 
           WHERE p.owner_id = ? OR t.designer_id = ? 
           GROUP BY p.id`;

    const params = req.user.role === 'admin' ? [] : [req.user.id, req.user.id];

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.post('/api/projects', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can create projects' });
    }

    const { name, status, deadline, manager } = req.body;

    // Input length limits
    if (!name || name.length > 200) return res.status(400).json({ error: 'Project name is required (max 200 chars)' });

    const plm_id = `PLM-PRI-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    db.run(
        `INSERT INTO projects (plm_id, name, owner_id, status, progress, deadline, manager) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [plm_id, name, req.user.id, status || 'active', 0, deadline || null, manager || req.user.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            // Log project creation
            logActivity(req.user.id, req.user.username, `Created project "${name}"`, 'PROJECT_CREATED', {
                plm_id: plm_id,
                projectName: name,
                status: status || 'active'
            });

            res.status(201).json({ id: this.lastID, plm_id, name, owner_id: req.user.id, status: status || 'active', progress: 0 });
        }
    );
});

// Update a project
app.put('/api/projects/:id', verifyToken, (req, res) => {
    const { name, status, progress, deadline, manager } = req.body;
    const projectId = req.params.id;

    // Build dynamic SET clause
    const fields = [];
    const values = [];

    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (status !== undefined) { fields.push('status = ?'); values.push(status); }
    if (progress !== undefined) {
        const p = Math.max(0, Math.min(100, parseInt(progress) || 0));
        fields.push('progress = ?'); values.push(p);
    }
    if (deadline !== undefined) { fields.push('deadline = ?'); values.push(deadline); }
    if (manager !== undefined) { fields.push('manager = ?'); values.push(manager); }

    if (fields.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(projectId);

    db.run(
        `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`,
        values,
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Project not found' });

            logActivity(req.user.id, req.user.username, `Updated project ${projectId}`, 'PROJECT_UPDATED', {
                projectId, progress, status
            });

            res.json({ success: true, message: 'Project updated' });
        }
    );
});

app.delete('/api/projects/:id', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can delete projects' });
    }

    // Get project name before deleting
    db.get(`SELECT name FROM projects WHERE id = ?`, [req.params.id], (err, project) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!project) return res.status(404).json({ error: 'Project not found' });
        db.run(`DELETE FROM projects WHERE id = ?`, [req.params.id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            // Log project deletion
            logActivity(req.user.id, req.user.username, `Deleted project "${project ? project.name : 'unknown'}"`, 'PROJECT_DELETED', {
                projectId: req.params.id,
                projectName: project ? project.name : 'unknown'
            });

            res.json({ success: true });
        });
    });
});

// Tasks Routes
app.get('/api/tasks', verifyToken, (req, res) => {
    const query = req.user.role === 'admin'
        ? `SELECT * FROM tasks`
        : `SELECT * FROM tasks WHERE designer_id = ?`;

    const params = req.user.role === 'admin' ? [] : [req.user.id];

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.post('/api/tasks', verifyToken, (req, res) => {
    const { project_id, title, description, priority, due_date } = req.body;

    db.run(
        `INSERT INTO tasks (project_id, designer_id, title, description, priority, due_date) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [project_id, req.user.id, title, description, priority || 'medium', due_date],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ id: this.lastID, project_id, designer_id: req.user.id, title, description, priority: priority || 'medium', due_date });
        }
    );
});

// Update task status (e.g., mark as completed)
app.put('/api/tasks/:id', verifyToken, (req, res) => {
    const { status, progress } = req.body;
    const taskId = req.params.id;

    // Only the assigned designer or admin can update
    db.get(`SELECT * FROM tasks WHERE id = ?`, [taskId], (err, task) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!task) return res.status(404).json({ error: 'Task not found' });

        if (req.user.role !== 'admin' && task.designer_id !== req.user.id) {
            return res.status(403).json({ error: 'Not authorized to update this task' });
        }

        const newStatus = status || task.status || 'completed';
        const newProgress = progress !== undefined ? progress : (newStatus === 'completed' ? 100 : task.progress);

        db.run(
            `UPDATE tasks SET status = ?, progress = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [newStatus, newProgress, taskId],
            function(updateErr) {
                if (updateErr) return res.status(500).json({ error: updateErr.message });
                logActivity(req.user.id, req.user.username, `Updated task "${task.title}" to ${newStatus}`, 'TASK_UPDATED', { taskId, status: newStatus });
                res.json({ success: true, message: `Task updated to ${newStatus}` });
            }
        );
    });
});

// Submissions Routes
app.get('/api/submissions', verifyToken, (req, res) => {
    const query = req.user.role === 'designer'
        ? `SELECT * FROM submissions WHERE designer_id = ?`
        : `SELECT * FROM submissions`;

    const params = req.user.role === 'designer' ? [req.user.id] : [];

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

app.post('/api/submissions', verifyToken, (req, res) => {
    const { project_id, submission_type, comments } = req.body;

    db.run(
        `INSERT INTO submissions (project_id, designer_id, submission_type, comments, status) 
         VALUES (?, ?, ?, ?, 'pending')`,
        [project_id, req.user.id, submission_type, comments],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ 
                id: this.lastID, 
                project_id, 
                designer_id: req.user.id, 
                submission_type, 
                comments, 
                status: 'pending' 
            });
        }
    );
});

app.delete('/api/submissions/:submission_id', verifyToken, (req, res) => {
    const submissionId = req.params.submission_id;

    if (req.user.role !== 'designer' && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only designers or admins can delete submissions' });
    }

    db.get(`SELECT designer_id, submission_type FROM submissions WHERE id = ?`, [submissionId], (err, submission) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!submission) return res.status(404).json({ error: 'Submission not found' });

        if (req.user.role === 'designer' && submission.designer_id !== req.user.id) {
            return res.status(403).json({ error: 'You can only delete your own submissions' });
        }

        db.run(`DELETE FROM submissions WHERE id = ?`, [submissionId], function(deleteErr) {
            if (deleteErr) return res.status(500).json({ error: deleteErr.message });

            logActivity(req.user.id, req.user.username, `Deleted submission ${submissionId}`, 'SUBMISSION_DELETED', {
                submission_id: submissionId,
                submission_type: submission.submission_type
            });

            res.json({ success: true });
        });
    });
});

// Approvals Routes
app.get('/api/approvals/pending', verifyToken, (req, res) => {
    if (req.user.role !== 'approver') {
        return res.status(403).json({ error: 'Only approvers can view approvals' });
    }

    db.all(
        `SELECT s.*, p.name as project_name FROM submissions s 
         JOIN projects p ON s.project_id = p.id 
         WHERE s.status = 'pending'`,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        }
    );
});

app.post('/api/approvals/:submission_id', verifyToken, (req, res) => {
    if (req.user.role !== 'approver') {
        return res.status(403).json({ error: 'Only approvers can approve submissions' });
    }

    const { decision, feedback } = req.body;
    const { submission_id } = req.params;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run(
            `UPDATE submissions SET status = ? WHERE id = ?`,
            [decision, submission_id],
            (err) => {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                }

                db.run(
                    `INSERT INTO approvals (submission_id, approver_id, decision, feedback, decision_date) 
                     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                    [submission_id, req.user.id, decision, feedback],
                    (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: err.message });
                        }

                        db.run('COMMIT');
                        res.json({ success: true, submission_id, decision });
                    }
                );
            }
        );
    });
});

// ========== USER APPROVAL ROUTES (ADMIN ONLY) ==========

// Get pending user approvals
app.get('/api/users/pending', verifyToken, (req, res) => {
    // Only admin can view pending approvals
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admin can view pending approvals' });
    }

    db.all(
        `SELECT id, username, email, role, created_at FROM users 
         WHERE is_active = 0 AND role IN ('approver', 'admin')
         ORDER BY created_at DESC`,
        (err, users) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(users || []);
        }
    );
});

// Approve a user (admin only)
app.post('/api/users/:user_id/approve', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admin can approve users' });
    }

    const { user_id } = req.params;

    // Get user info before updating
    db.get(`SELECT username, role FROM users WHERE id = ?`, [user_id], (err, user) => {
        db.run(
            `UPDATE users SET is_active = 1, approved_by = ?, approved_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [req.user.id, user_id],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'User not found' });
                }

                // Log user approval
                logActivity(req.user.id, req.user.username, `Approved ${user ? user.role : 'user'} account "${user ? user.username : 'unknown'}"`, 'USER_APPROVED', {
                    approvedUserId: user_id,
                    approvedUsername: user ? user.username : 'unknown',
                    role: user ? user.role : 'unknown'
                });

                res.json({ success: true, message: 'User approved and activated' });
            }
        );
    });
});

// Reject a user (admin only)
app.post('/api/users/:user_id/reject', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admin can reject users' });
    }

    const { user_id } = req.params;

    // Get user info before deleting
    db.get(`SELECT username, role FROM users WHERE id = ?`, [user_id], (err, user) => {
        db.run(
            `DELETE FROM users WHERE id = ? AND is_active = 0`,
            [user_id],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'User not found or already approved' });
                }

                // Log user rejection
                logActivity(req.user.id, req.user.username, `Rejected and deleted ${user ? user.role : 'user'} account "${user ? user.username : 'unknown'}"`, 'USER_REJECTED', {
                    rejectedUserId: user_id,
                    rejectedUsername: user ? user.username : 'unknown',
                    role: user ? user.role : 'unknown'
                });

                res.json({ success: true, message: 'User rejected and deleted' });
            }
        );
    });
});

// Get all active users (for admin dashboard)
app.get('/api/users', verifyToken, (req, res) => {
    // Only admin can view all users
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admin can view users' });
    }

    db.all(
        `SELECT id, username, email, role, is_active, created_at, approved_at 
         FROM users ORDER BY created_at DESC`,
        (err, users) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(users || []);
        }
    );
});

// Delete a user (admin only)
app.delete('/api/users/:user_id', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admin can delete users' });
    }

    const { user_id } = req.params;

    if (user_id === req.user.id) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    db.get(`SELECT username, role FROM users WHERE id = ?`, [user_id], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });

        db.run(`DELETE FROM users WHERE id = ?`, [user_id], function(deleteErr) {
            if (deleteErr) return res.status(500).json({ error: deleteErr.message });

            logActivity(req.user.id, req.user.username, `Deleted ${user.role} account "${user.username}"`, 'USER_DELETED', {
                deletedUserId: user_id,
                deletedUsername: user.username,
                role: user.role
            });

            res.json({ success: true, message: 'User deleted' });
        });
    });
});

// Update a user (admin only)
app.put('/api/users/:user_id', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admin can update users' });
    }

    const { user_id } = req.params;
    const { username, email, role, is_active } = req.body;

    if (!username || !email || !role) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (user_id === req.user.id && is_active === false) {
        return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }

    db.run(
        `UPDATE users SET username = ?, email = ?, role = ?, is_active = ? WHERE id = ?`,
        [username, email, role, is_active ? 1 : 0, user_id],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(400).json({ error: 'Username or email already exists' });
                }
                return res.status(500).json({ error: err.message });
            }

            if (this.changes === 0) {
                return res.status(404).json({ error: 'User not found' });
            }

            logActivity(req.user.id, req.user.username, `Updated user account "${username}"`, 'USER_UPDATED', {
                updatedUserId: user_id,
                updatedUsername: username,
                role: role,
                is_active: is_active ? 1 : 0
            });

            res.json({ success: true, message: 'User updated' });
        }
    );
});

// Get activity history (admin only)
app.get('/api/activity-history', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admin can view activity history' });
    }

    const limit = parseInt(req.query.limit) || 100;
    const actionType = req.query.actionType || null;

    let query = `SELECT * FROM activity_logs`;
    let params = [];

    if (actionType) {
        query += ` WHERE action_type = ?`;
        params.push(actionType);
    }

    query += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Convert timestamps to India Standard Time (IST)
        const convertedRows = rows.map((row) => ({
            ...row,
            timestamp: convertToIST(row.timestamp)
        }));
        
        res.json(convertedRows || []);
    });
});

// Change Password Route
app.post('/api/users/change-password', verifyToken, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user.id;

    // Validate inputs
    if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'New passwords do not match' });
    }

    // Validate password strength
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
        const errorMsg = 'Weak Password! Password must have: ' + passwordValidation.errors.join(', ');
        return res.status(400).json({ error: errorMsg });
    }

    // Get user's current password hash
    db.get(`SELECT password FROM users WHERE id = ?`, [userId], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Verify current password
        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        // Hash new password (async to avoid blocking event loop)
        const salt = await bcrypt.genSalt(10);
        const hashedNewPassword = await bcrypt.hash(newPassword, salt);

        // Update password
        db.run(
            `UPDATE users SET password = ? WHERE id = ?`,
            [hashedNewPassword, userId],
            (updateErr) => {
                if (updateErr) return res.status(500).json({ error: updateErr.message });

                // Log password change activity
                logActivity(userId, req.user.username, `${req.user.role} changed password`, 'PASSWORD_CHANGED', {
                    username: req.user.username
                });

                res.json({ success: true, message: 'Password changed successfully' });
            }
        );
    });
});

// Update Email
app.post('/api/users/update-email', verifyToken, (req, res) => {
    const { newEmail, password } = req.body;
    const userId = req.user.id;

    // Validate input
    if (!newEmail) {
        return res.status(400).json({ error: 'New email is required' });
    }

    if (!password) {
        return res.status(400).json({ error: 'Password is required for verification' });
    }

    // Validate email format
    if (!validateEmail(newEmail)) {
        return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    // Get user and verify password first
    db.get(`SELECT id, password FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Verify password
        const passwordMatch = bcrypt.compareSync(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Incorrect password' });
        }

        // Check if email already exists
        db.get(`SELECT id FROM users WHERE email = ? AND id != ?`, [newEmail, userId], (err, existingUser) => {
            if (err) return res.status(500).json({ error: err.message });
            if (existingUser) {
                return res.status(400).json({ error: 'This email is already in use' });
            }

            // Update email
            db.run(
                `UPDATE users SET email = ? WHERE id = ?`,
                [newEmail, userId],
                (updateErr) => {
                    if (updateErr) return res.status(500).json({ error: updateErr.message });

                    // Log email change activity
                    logActivity(userId, req.user.username, `${req.user.role} updated email to ${newEmail}`, 'EMAIL_UPDATED', {
                        username: req.user.username,
                        newEmail: newEmail
                    });

                    res.json({ success: true, message: 'Email updated successfully' });
                }
            );
        });
    });
});

// Get current user details
app.get('/api/users/current', verifyToken, (req, res) => {
    const userId = req.user.id;
    
    db.get(`SELECT id, username, email, role FROM users WHERE id = ?`, [userId], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        res.json(user);
    });
});

// Forgot Password - Generate Reset Token
app.post('/api/auth/forgot-password', (req, res) => {
    const { username, email } = req.body;

    if (!username || !email) {
        return res.status(400).json({ error: 'Username and email are required' });
    }

    db.get(
        `SELECT id, username, email FROM users WHERE username = ? AND email = ?`,
        [username, email],
        (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!user) {
                return res.status(404).json({ error: 'User not found with this username and email combination' });
            }

            // Generate a 6-digit reset code
            const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
            const resetExpiration = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now

            // Store reset code in database
            db.run(
                `UPDATE users SET reset_code = ?, reset_code_expiration = ? WHERE id = ?`,
                [resetCode, resetExpiration.toISOString(), user.id],
                (updateErr) => {
                    if (updateErr) return res.status(500).json({ error: updateErr.message });

                    // Log password reset request
                    logActivity(user.id, user.username, `Password reset requested`, 'PASSWORD_RESET_REQUESTED', {
                        username: user.username,
                        email: user.email
                    });

                    // In production, send reset code via email
                    console.log(`[DEV] Reset code for ${user.username}: ${resetCode}`);
                    res.json({
                        success: true,
                        message: 'Password reset code has been generated. Check the server console (dev mode).',
                        expiresIn: '30 minutes'
                    });
                }
            );
        }
    );
});

// Reset Password with Code
app.post('/api/auth/reset-password', async (req, res) => {
    const { username, email, resetCode, newPassword, confirmPassword } = req.body;

    // Validate inputs
    if (!username || !email || !resetCode || !newPassword || !confirmPassword) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'Passwords do not match' });
    }

    // Validate password strength
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
        const errorMsg = 'Weak Password! Password must have: ' + passwordValidation.errors.join(', ');
        return res.status(400).json({ error: errorMsg });
    }

    db.get(
        `SELECT id, username, email, reset_code, reset_code_expiration FROM users WHERE username = ? AND email = ?`,
        [username, email],
        async (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Check if reset code is valid
            if (!user.reset_code || user.reset_code !== resetCode) {
                return res.status(401).json({ error: 'Invalid reset code' });
            }

            // Check if reset code has expired
            const expirationTime = new Date(user.reset_code_expiration);
            if (new Date() > expirationTime) {
                return res.status(401).json({ error: 'Reset code has expired. Please request a new one.' });
            }

            // Hash new password (async to avoid blocking event loop)
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(newPassword, salt);

            // Update password and clear reset code
            db.run(
                `UPDATE users SET password = ?, reset_code = NULL, reset_code_expiration = NULL WHERE id = ?`,
                [hashedPassword, user.id],
                (updateErr) => {
                    if (updateErr) return res.status(500).json({ error: updateErr.message });

                    // Log password reset completion
                    logActivity(user.id, user.username, `Password reset successful`, 'PASSWORD_RESET_SUCCESSFUL', {
                        username: user.username
                    });

                    res.json({ success: true, message: 'Password reset successfully. You can now login with your new password.' });
                }
            );
        }
    );
});

// ====== Notifications ======
function createNotification(userId, title, message, type = 'info', link = null) {
    db.run(
        `INSERT INTO notifications (user_id, title, message, type, link) VALUES (?, ?, ?, ?, ?)`,
        [userId, title, message, type, link]
    );
}

app.get('/api/notifications', verifyToken, (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    db.all(
        `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
        [req.user.id, limit],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        }
    );
});

app.get('/api/notifications/unread-count', verifyToken, (req, res) => {
    db.get(
        `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0`,
        [req.user.id],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ count: row ? row.count : 0 });
        }
    );
});

app.post('/api/notifications/mark-read', verifyToken, (req, res) => {
    const { ids } = req.body; // array of notification IDs, or empty to mark all
    if (ids && ids.length) {
        const placeholders = ids.map(() => '?').join(',');
        db.run(`UPDATE notifications SET is_read = 1 WHERE id IN (${placeholders}) AND user_id = ?`, [...ids, req.user.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    } else {
        db.run(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [req.user.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    }
});

// ====== Engineering Change Orders ======
app.get('/api/ecos', verifyToken, (req, res) => {
    const { status, priority, search, page, limit: lim } = req.query;
    const pageNum = parseInt(page) || 1;
    const pageSize = parseInt(lim) || 50;
    const offset = (pageNum - 1) * pageSize;
    let where = '1=1';
    const params = [];
    if (status) { where += ' AND e.status = ?'; params.push(status); }
    if (priority) { where += ' AND e.priority = ?'; params.push(priority); }
    if (search) { where += ' AND (e.eco_number LIKE ? OR e.title LIKE ? OR e.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    params.push(pageSize, offset);
    db.all(
        `SELECT e.*, u.username as requester_name, r.username as reviewer_name
         FROM eco_orders e LEFT JOIN users u ON e.requester_id = u.id LEFT JOIN users r ON e.reviewer_id = r.id
         WHERE ${where} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`, params,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        }
    );
});

app.post('/api/ecos', verifyToken, (req, res) => {
    const { title, description, reason, priority, affected_parts, affected_assemblies } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const pErr = validateEnum(priority, VALID_PRIORITIES, 'priority');
    if (pErr) return res.status(400).json({ error: pErr });
    const ecoNumber = `ECO-${Date.now()}`;
    db.run(
        `INSERT INTO eco_orders (eco_number, title, description, reason, priority, requester_id, affected_parts, affected_assemblies) VALUES (?,?,?,?,?,?,?,?)`,
        [ecoNumber, title, description || null, reason || null, priority || 'medium', req.user.id, affected_parts || null, affected_assemblies || null],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            // Notify admins and approvers
            db.all(`SELECT id FROM users WHERE role IN ('admin','approver') AND is_active = 1`, [], (e, users) => {
                if (!e && users) users.forEach(u => createNotification(u.id, 'New ECO', `${req.user.username} created ${ecoNumber}: ${title}`, 'eco', '/ecos'));
            });
            logActivity(req.user.id, req.user.username, `Created ECO ${ecoNumber}`, 'ECO_CREATED', { eco_number: ecoNumber });
            res.status(201).json({ id: this.lastID, eco_number: ecoNumber, title, status: 'draft' });
        }
    );
});

app.put('/api/ecos/:id', verifyToken, (req, res) => {
    const { title, description, reason, priority, status, implementation_notes, affected_parts, affected_assemblies } = req.body;
    if (status) {
        const sErr = validateEnum(status, VALID_ECO_STATUS, 'status');
        if (sErr) return res.status(400).json({ error: sErr });
    }
    if (priority) {
        const pErr = validateEnum(priority, VALID_PRIORITIES, 'priority');
        if (pErr) return res.status(400).json({ error: pErr });
    }
    // Only admin/approver can approve/reject
    if (status && ['approved', 'rejected'].includes(status) && !isApproverOrAdmin(req.user.role)) {
        return res.status(403).json({ error: 'Only approvers/admins can approve or reject ECOs' });
    }
    const sets = [];
    const params = [];
    if (title) { sets.push('title = ?'); params.push(title); }
    if (description !== undefined) { sets.push('description = ?'); params.push(description); }
    if (reason !== undefined) { sets.push('reason = ?'); params.push(reason); }
    if (priority) { sets.push('priority = ?'); params.push(priority); }
    if (status) { sets.push('status = ?'); params.push(status); }
    if (implementation_notes !== undefined) { sets.push('implementation_notes = ?'); params.push(implementation_notes); }
    if (affected_parts !== undefined) { sets.push('affected_parts = ?'); params.push(affected_parts); }
    if (affected_assemblies !== undefined) { sets.push('affected_assemblies = ?'); params.push(affected_assemblies); }
    if (['approved', 'rejected'].includes(status)) {
        sets.push('reviewer_id = ?', 'decided_at = CURRENT_TIMESTAMP');
        params.push(req.user.id);
    }
    sets.push('updated_at = CURRENT_TIMESTAMP');
    params.push(req.params.id);
    db.run(`UPDATE eco_orders SET ${sets.join(', ')} WHERE id = ?`, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'ECO not found' });
        // Notify requester if status changed
        if (status) {
            db.get(`SELECT requester_id, eco_number FROM eco_orders WHERE id = ?`, [req.params.id], (e, eco) => {
                if (!e && eco) createNotification(eco.requester_id, `ECO ${status}`, `${eco.eco_number} has been ${status} by ${req.user.username}`, status === 'approved' ? 'success' : 'warning');
            });
        }
        res.json({ success: true });
    });
});

app.delete('/api/ecos/:id', verifyToken, requireRole('admin'), (req, res) => {
    db.run(`DELETE FROM eco_orders WHERE id = ?`, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'ECO not found' });
        res.json({ success: true });
    });
});

// ====== Comments ======
app.get('/api/comments/:entityType/:entityId', verifyToken, (req, res) => {
    db.all(
        `SELECT * FROM comments WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC`,
        [req.params.entityType, req.params.entityId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        }
    );
});

app.post('/api/comments/:entityType/:entityId', verifyToken, (req, res) => {
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });
    db.run(
        `INSERT INTO comments (entity_type, entity_id, user_id, username, message) VALUES (?,?,?,?,?)`,
        [req.params.entityType, req.params.entityId, req.user.id, req.user.username, message.trim()],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ id: this.lastID, entity_type: req.params.entityType, entity_id: req.params.entityId, username: req.user.username, message: message.trim(), created_at: new Date().toISOString() });
        }
    );
});

// ====== File Upload ======
app.post('/api/upload/:entityType/:entityId', verifyToken, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    db.run(
        `INSERT INTO attachments (entity_type, entity_id, filename, original_name, file_path, file_size, mime_type, uploaded_by) VALUES (?,?,?,?,?,?,?,?)`,
        [req.params.entityType, req.params.entityId, req.file.filename, req.file.originalname, req.file.path, req.file.size, req.file.mimetype, req.user.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ id: this.lastID, filename: req.file.filename, original_name: req.file.originalname, file_size: req.file.size });
        }
    );
});

app.get('/api/attachments/:entityType/:entityId', verifyToken, (req, res) => {
    db.all(
        `SELECT a.*, u.username as uploader_name FROM attachments a LEFT JOIN users u ON a.uploaded_by = u.id WHERE a.entity_type = ? AND a.entity_id = ? ORDER BY a.created_at DESC`,
        [req.params.entityType, req.params.entityId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        }
    );
});

app.get('/api/download/:attachmentId', verifyToken, (req, res) => {
    db.get(`SELECT * FROM attachments WHERE id = ?`, [req.params.attachmentId], (err, file) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!file) return res.status(404).json({ error: 'File not found' });
        res.download(file.file_path, file.original_name);
    });
});

// ====== CSV Export ======
// Sanitize cell value to prevent CSV formula injection
function csvSafe(val) {
    if (val == null) return '';
    const s = String(val);
    if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
    return s;
}

app.get('/api/export/parts', verifyToken, (req, res) => {
    db.all(`SELECT p.*, u.username as owner_name FROM parts p LEFT JOIN users u ON p.owner_id = u.id ORDER BY p.created_at DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const headers = 'Part Code,Name,Description,Material,Vendor,Criticality,Lifecycle,Owner,Tags,Created At\n';
        const csv = headers + (rows || []).map(r => `"${csvSafe(r.part_code)}","${csvSafe(r.name)}","${csvSafe(r.description)}","${csvSafe(r.material)}","${csvSafe(r.vendor)}","${csvSafe(r.criticality || 'normal')}","${csvSafe(r.lifecycle_state || 'draft')}","${csvSafe(r.owner_name)}","${csvSafe(r.tags)}","${csvSafe(r.created_at)}"`).join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=parts_export.csv');
        res.send(csv);
    });
});

app.get('/api/export/assemblies', verifyToken, (req, res) => {
    db.all(`SELECT a.*, u.username as owner_name FROM assemblies a LEFT JOIN users u ON a.owner_id = u.id ORDER BY a.created_at DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const headers = 'Assembly Code,Name,Description,Criticality,Lifecycle,Owner,Tags,Created At\n';
        const csv = headers + (rows || []).map(r => `"${csvSafe(r.assembly_code)}","${csvSafe(r.name)}","${csvSafe(r.description)}","${csvSafe(r.criticality || 'normal')}","${csvSafe(r.lifecycle_state || 'draft')}","${csvSafe(r.owner_name)}","${csvSafe(r.tags)}","${csvSafe(r.created_at)}"`).join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=assemblies_export.csv');
        res.send(csv);
    });
});

app.get('/api/export/bom/:assemblyId/:versionId', verifyToken, (req, res) => {
    db.all(
        `SELECT p.part_code, p.name as part_name, p.material, p.vendor, pv.version_label, pv.status
         FROM assembly_parts ap JOIN part_versions pv ON ap.part_version_id = pv.id JOIN parts p ON pv.part_id = p.id
         WHERE ap.assembly_version_id = ?`, [req.params.versionId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            const headers = 'Part Code,Part Name,Material,Vendor,Version,Status\n';
            const csv = headers + (rows || []).map(r => `"${csvSafe(r.part_code)}","${csvSafe(r.part_name)}","${csvSafe(r.material)}","${csvSafe(r.vendor)}","${csvSafe(r.version_label)}","${csvSafe(r.status)}"`).join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=bom_${req.params.assemblyId}_v${req.params.versionId}.csv`);
            res.send(csv);
        }
    );
});

// ====== Global Search ======
app.get('/api/search', verifyToken, (req, res) => {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    const term = `%${q.trim()}%`;
    const results = { parts: [], assemblies: [], projects: [], users: [], ecos: [] };
    let pending = 5;
    const done = () => { if (--pending === 0) res.json(results); };
    db.all(`SELECT id, part_code, name, material, criticality FROM parts WHERE part_code LIKE ? OR name LIKE ? OR material LIKE ? OR tags LIKE ? LIMIT 10`, [term, term, term, term], (e, r) => { if (!e) results.parts = r || []; done(); });
    db.all(`SELECT id, assembly_code, name, criticality FROM assemblies WHERE assembly_code LIKE ? OR name LIKE ? OR tags LIKE ? LIMIT 10`, [term, term, term], (e, r) => { if (!e) results.assemblies = r || []; done(); });
    db.all(`SELECT id, plm_id, name, status FROM projects WHERE plm_id LIKE ? OR name LIKE ? LIMIT 10`, [term, term], (e, r) => { if (!e) results.projects = r || []; done(); });
    db.all(`SELECT id, username, email, role FROM users WHERE username LIKE ? OR email LIKE ? LIMIT 10`, [term, term], (e, r) => { if (!e) results.users = r || []; done(); });
    db.all(`SELECT id, eco_number, title, status FROM eco_orders WHERE eco_number LIKE ? OR title LIKE ? OR description LIKE ? LIMIT 10`, [term, term, term], (e, r) => { if (!e) results.ecos = r || []; done(); });
});

// ====== Analytics / Reports ======
app.get('/api/analytics/dashboard', verifyToken, (req, res) => {
    const data = {};
    let pending = 8;
    const done = () => { if (--pending === 0) res.json(data); };
    db.get(`SELECT COUNT(*) as count FROM projects`, (e, r) => { data.totalProjects = r ? r.count : 0; done(); });
    db.get(`SELECT COUNT(*) as count FROM users WHERE is_active = 1`, (e, r) => { data.activeUsers = r ? r.count : 0; done(); });
    db.get(`SELECT COUNT(*) as count FROM parts`, (e, r) => { data.totalParts = r ? r.count : 0; done(); });
    db.get(`SELECT COUNT(*) as count FROM assemblies`, (e, r) => { data.totalAssemblies = r ? r.count : 0; done(); });
    db.get(`SELECT COUNT(*) as count FROM eco_orders WHERE status NOT IN ('implemented','rejected')`, (e, r) => { data.openECOs = r ? r.count : 0; done(); });
    db.get(`SELECT COUNT(*) as count FROM edit_requests WHERE status = 'pending'`, (e, r) => { data.pendingEditRequests = r ? r.count : 0; done(); });
    db.get(`SELECT COUNT(*) as count FROM release_requests WHERE status = 'pending'`, (e, r) => { data.pendingReleaseRequests = r ? r.count : 0; done(); });
    db.all(`SELECT lifecycle_state, COUNT(*) as count FROM parts GROUP BY lifecycle_state`, (e, r) => { data.partsByLifecycle = r || []; done(); });
});

// ====== Revision Comparison ======
app.get('/api/parts/:id/versions/compare', verifyToken, (req, res) => {
    const { v1, v2 } = req.query;
    if (!v1 || !v2) return res.status(400).json({ error: 'Two version IDs (v1, v2) are required' });
    db.all(
        `SELECT pv.*, u.username as frozen_by_name FROM part_versions pv LEFT JOIN users u ON pv.frozen_by = u.id WHERE pv.id IN (?, ?) AND pv.part_id = ?`,
        [v1, v2, req.params.id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            if (rows.length !== 2) return res.status(404).json({ error: 'One or both versions not found' });
            res.json({ version1: rows.find(r => String(r.id) === String(v1)), version2: rows.find(r => String(r.id) === String(v2)) });
        }
    );
});

// ====== Bulk Operations ======
app.post('/api/parts/bulk-delete', verifyToken, requireRole('admin'), (req, res) => {
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });
    const placeholders = ids.map(() => '?').join(',');
    // Check for assembly references first
    db.all(`SELECT DISTINCT p.part_code FROM parts p JOIN part_versions pv ON pv.part_id = p.id JOIN assembly_parts ap ON ap.part_version_id = pv.id WHERE p.id IN (${placeholders})`, ids, (err, referenced) => {
        if (err) return res.status(500).json({ error: err.message });
        if (referenced && referenced.length > 0) {
            return res.status(400).json({ error: `Cannot delete: parts ${referenced.map(r => r.part_code).join(', ')} are referenced by assemblies` });
        }
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            db.run(`DELETE FROM part_permissions WHERE part_id IN (${placeholders})`, ids);
            db.run(`DELETE FROM edit_requests WHERE part_id IN (${placeholders})`, ids);
            db.run(`DELETE FROM part_versions WHERE part_id IN (${placeholders})`, ids);
            db.run(`DELETE FROM parts WHERE id IN (${placeholders})`, ids, function(e) {
                if (e) { db.run('ROLLBACK'); return res.status(500).json({ error: e.message }); }
                db.run('COMMIT');
                res.json({ success: true, deleted: this.changes });
            });
        });
    });
});

app.post('/api/parts/bulk-freeze', verifyToken, requireRole('admin', 'approver'), (req, res) => {
    const { version_ids } = req.body;
    if (!version_ids || !version_ids.length) return res.status(400).json({ error: 'No version IDs provided' });
    const placeholders = version_ids.map(() => '?').join(',');
    db.run(
        `UPDATE part_versions SET status = 'frozen', frozen_by = ?, frozen_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders}) AND status = 'working'`,
        [req.user.id, ...version_ids],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, frozen: this.changes });
        }
    );
});

// Health check (enhanced)
app.get('/api/health', (req, res) => {
    db.get('SELECT COUNT(*) as count FROM users', (err) => {
        res.json({
            status: err ? 'Database error' : 'Server is running',
            timestamp: new Date().toISOString(),
            dbConnected: !err
        });
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    res.status(500).json({ error: 'Internal server error' });
});

// Initialize and start server
initializeDatabase();
initializeDefaultUsers();

const server = app.listen(PORT, () => {
    console.log(`\n✓ PLM System Server running on http://localhost:${PORT}`);
    console.log(`\n📝 Default Credentials:`);
    console.log(`   Admin: username=admin, password=Admin@123, role=admin`);
    console.log(`   Designer: username=designer, password=Admin@123, role=designer`);
    console.log(`   Approver: username=approver, password=Admin@123, role=approver\n`);
});

// Graceful shutdown
function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(() => {
        db.close((err) => {
            if (err) console.error('Error closing database:', err);
            else console.log('Database connection closed.');
            process.exit(0);
        });
    });
    setTimeout(() => { process.exit(1); }, 10000); // Force exit after 10s
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
