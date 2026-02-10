# PLM System - Setup Guide

## 🚀 Quick Start

### Prerequisites
- Node.js (v14 or higher)
- npm (comes with Node.js)

### Installation

1. **Navigate to project folder:**
   ```bash
   cd "c:\html css"
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the server:**
   ```bash
   npm start
   ```
   
   The server will start on `http://localhost:5000`

### 🔓 Default Test Credentials

#### Admin Account
- **Username:** admin
- **Password:** password123
- **Role:** admin

#### Designer Account
- **Username:** designer
- **Password:** password123
- **Role:** designer

#### Approver Account
- **Username:** approver
- **Password:** password123
- **Role:** approver

---

## 📁 Project Structure

```
c:\html css\
├── index.html                 # Login/Signup Page
├── admin-dashboard.html       # Admin Dashboard
├── designer-dashboard.html    # Designer Dashboard
├── approver-dashboard.html    # Approver Dashboard
│
├── style.css                  # Login Page Styles
├── dashboard.css              # Dashboard Styles
│
├── script.js                  # Login Page JS (with API calls)
├── admin-dashboard.js         # Admin Dashboard JS (with API calls)
├── designer-dashboard.js      # Designer Dashboard JS
├── approver-dashboard.js      # Approver Dashboard JS
│
├── api.js                     # API Helper Functions
├── server.js                  # Express Backend Server
│
├── package.json               # Node Dependencies
├── .env                       # Environment Variables
└── plm_database.db           # SQLite Database (auto-created)
```

---

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/login` - Login user
- `POST /api/auth/signup` - Register new user

### Projects
- `GET /api/projects` - Get all projects (role-based)
- `POST /api/projects` - Create new project (admin only)
- `DELETE /api/projects/:id` - Delete project (admin only)

### Users
- `GET /api/users` - Get all users (admin only)

### Tasks
- `GET /api/tasks` - Get tasks (role-based)
- `POST /api/tasks` - Create task

### Submissions
- `GET /api/submissions` - Get submissions (role-based)
- `POST /api/submissions` - Submit work

### Approvals
- `GET /api/approvals/pending` - Get pending approvals (approver only)
- `POST /api/approvals/:submission_id` - Submit approval decision

---

## 🔑 Frontend Features

### Login Page (`index.html`)
- ✅ Login with ID, Password, Role
- ✅ Signup with ID, Email, Password, Role
- ✅ Flipping Logo animation
- ✅ Connected to backend API
- ✅ Automatic redirect to dashboard after login

### Admin Dashboard
- ✅ View all projects
- ✅ Create new projects
- ✅ Delete projects
- ✅ Manage users
- ✅ View system reports
- ✅ System settings

### Designer Dashboard
- ✅ View assigned projects
- ✅ Track progress
- ✅ Submit work
- ✅ View tasks
- ✅ Edit profile

### Approver Dashboard
- ✅ Review pending submissions
- ✅ Approve/Reject/Request changes
- ✅ View all projects
- ✅ Track submission status
- ✅ Add feedback

---

## 🛠️ Development Notes

### Adding New Features

1. **Create API endpoint** in `server.js`
2. **Create API helper function** in `api.js`
3. **Use in dashboard JS** file

### Example:
```javascript
// In server.js (API)
app.get('/api/custom', verifyToken, (req, res) => {
    // Your logic here
    res.json(data);
});

// In api.js (Helper)
async function getCustomData() {
    return await apiRequest('/custom', { method: 'GET' });
}

// In dashboard JS
const data = await getCustomData();
```

---

## 📊 Database Schema

### Users
- `id` - User ID (primary key)
- `username` - Username
- `email` - Email address
- `password` - Hashed password
- `role` - admin/designer/approver
- `created_at` - Creation timestamp

### Projects
- `id` - Project ID (primary key)
- `plm_id` - PLM identifier
- `name` - Project name
- `owner_id` - Owner user ID
- `status` - active/inactive/completed
- `created_at` - Creation timestamp

### Submissions
- `id` - Submission ID (primary key)
- `project_id` - Project ID
- `designer_id` - Designer user ID
- `submission_type` - Type of submission
- `status` - pending/approved/rejected
- `file_path` - File path
- `comments` - Comments
- `created_at` - Creation timestamp

### Tasks
- `id` - Task ID (primary key)
- `project_id` - Project ID
- `designer_id` - Assigned designer
- `title` - Task title
- `description` - Task description
- `priority` - high/medium/low
- `due_date` - Due date
- `completed` - Completion status
- `created_at` - Creation timestamp

### Approvals
- `id` - Approval ID (primary key)
- `submission_id` - Submission ID
- `approver_id` - Approver user ID
- `decision` - approved/rejected/changes_requested
- `feedback` - Feedback text
- `decision_date` - Decision timestamp

---

## 🔐 Security Features

- ✅ JWT token-based authentication
- ✅ Password hashing with bcrypt
- ✅ Token verification on protected routes
- ✅ Role-based access control
- ✅ CORS enabled for frontend

---

## 🐛 Troubleshooting

### Port Already in Use
If port 5000 is already in use, change it in `.env`:
```
PORT=5001
```

### Database Issues
If database is corrupted, delete `plm_database.db` and restart the server to recreate it.

### API Connection Issues
Make sure the server is running and accessible at `http://localhost:5000`

---

## 📝 Next Steps

1. Test the login with default credentials
2. Create new projects and users
3. Submit work as designer
4. Approve/reject as approver
5. Customize and extend features as needed

---

## 💡 Support

For issues or questions, check the console logs in browser developer tools (F12) and server terminal for error messages.

Enjoy using PLM System! 🚀
