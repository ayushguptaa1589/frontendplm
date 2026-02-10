# ⚡ Quick Start Commands

## Windows Users

### Method 1: Automatic (Easiest)
```
1. Double-click: start.bat
2. Wait for "Server running at: http://localhost:5000"
3. Open browser → http://localhost:5000/index.html
```

### Method 2: Manual
```powershell
# Open PowerShell or Command Prompt in project folder

# Install dependencies (first time only)
npm install

# Start the server
npm start

# You should see:
# Server running on port 5000
# Press Ctrl+C to stop
```

---

## Mac/Linux Users

```bash
# Navigate to project folder
cd "/path/to/html css"

# Install dependencies (first time only)
npm install

# Start the server
npm start

# You should see:
# Server running on port 5000
# Press Ctrl+C to stop
```

---

## Next Steps After Starting Server

1. **Open Browser**
   ```
   http://localhost:5000/index.html
   ```

2. **Login with Test Account**
   ```
   Username: 
   Password
   Role: 
   ```

3. **Explore Admin Dashboard**
   - View projects
   - Create new project
   - Delete project
   - View users

4. **Try Other Roles**
   ```
   Designer:
   Username: 
   Password: 
   
   Approver:
   Username: 
   Password: 
   ```

---

## Troubleshooting

### If `npm install` fails:
```bash
# Clear npm cache
npm cache clean --force

# Try again
npm install
```

### If port 5000 is in use:
```bash
# Change PORT in .env file from:
PORT=5000
# to:
PORT=5001

# Then restart
npm start
```

### If "node command not found":
```bash
# Install Node.js from https://nodejs.org/
# Then try again
npm start
```

### If database error:
```bash
# Delete the database file
rm plm_database.db (Mac/Linux)
del plm_database.db (Windows)

# Restart server - it will recreate
npm start
```

---

## Browser Access

After starting server, open:
```
http://localhost:5000/index.html
```

or try:
```
http://127.0.0.1:5000/index.html
```

---

## Stop the Server

Press: **Ctrl + C** in the terminal

---

## Check if Server is Running

Open browser DevTools (F12) → Network tab
Try to login - should see requests to:
```
http://localhost:5000/api/auth/login
```

---

## Common Port Issues

### See what's using port 5000

**Windows:**
```powershell
netstat -ano | findstr :5000
```

**Mac/Linux:**
```bash
lsof -i :5000
```

---

## Development Tips

1. **Keep server running** while developing
2. **Check browser console** (F12) for API errors
3. **Check server terminal** for backend errors
4. **Hard refresh** (Ctrl+Shift+R) if stuck
5. **Check .env** for PORT and JWT_SECRET

---

## API Health Check

To verify server is working, open in browser:
```
http://localhost:5000/api/health
```

Should return:
```json
{
  "status": "success",
  "message": "PLM API is running"
}
```

---

## Session Management

- Login token persists in browser storage
- Valid for 24 hours after login
- Auto-included in all API requests
- Clear by logging out or deleting localStorage

---

## That's It! 🎉

You're ready to go! Start with:
```bash
npm start
```

Then open:
```
http://localhost:5000/index.html
```

Enjoy your PLM System! 🚀
