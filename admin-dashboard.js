// Admin Dashboard with User Approval System
let currentUser = null;
let selectedUserId = null;
let pendingUsers = [];
let usersCache = [];
let selectedEditUserId = null;
let partsCache = [];
let assembliesCache = [];
let selectedPartId = null;
let selectedAssemblyId = null;
let ecosCache = [];
let selectedEcoId = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
    // Get user from localStorage
    currentUser = getCurrentUser();
    
    if (!currentUser || currentUser.role !== 'admin') {
        window.location.href = 'index.html';
        return;
    }

    document.getElementById('username').textContent = currentUser.username;
    setHierarchyFlow(currentUser.role);
    setupMenuListeners();
    setupPasswordToggle();
    initCommonUI();
    
    // Load pending approvals on startup
    await loadPendingApprovals();
});

// Load pending user approvals
async function loadPendingApprovals() {
    try {
        const response = await apiRequest('/users/pending', { method: 'GET' });
        pendingUsers = response;
        displayPendingApprovals(response);
    } catch (error) {
        console.error('Error loading pending approvals:', error);
        document.getElementById('approvalsContainer').innerHTML = '<p style="color: red; text-align: center;">Error loading pending approvals</p>';
    }
}

// Display pending approvals as cards
function displayPendingApprovals(users) {
    const container = document.getElementById('approvalsContainer');
    
    if (!users || users.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">✅ No pending approvals</p>';
        return;
    }

    container.innerHTML = users.map(user => `
        <div class="approval-card" data-id="${user.id}">
            <div class="card-header">
                <h4>New ${escapeHtml(user.role).toUpperCase()} Account</h4>
                <span class="status-badge review">Pending</span>
            </div>
            <div class="card-body">
                <p><strong>Username:</strong> ${escapeHtml(user.username)}</p>
                <p><strong>Email:</strong> ${escapeHtml(user.email)}</p>
                <p><strong>Role:</strong> ${escapeHtml(user.role).toUpperCase()}</p>
                <p><strong>Registered:</strong> ${formatToIST(user.created_at)}</p>
            </div>
            <div class="approval-actions">
                <button class="btn btn-success" onclick="approveUserQuick('${user.id}')">✓ Approve</button>
                <button class="btn btn-danger" onclick="rejectUserQuick('${user.id}')">✗ Reject</button>
                <button class="btn btn-secondary" onclick="openUserApprovalModal('${user.id}')">👁️ Review</button>
            </div>
        </div>
    `).join('');
}

// Open user approval modal
function openUserApprovalModal(userId) {
    const user = pendingUsers.find(u => u.id === userId);
    if (!user) return;

    selectedUserId = userId;

    document.getElementById('approvalUsername').textContent = user.username;
    document.getElementById('approvalEmail').textContent = user.email;
    document.getElementById('approvalRole').textContent = user.role.toUpperCase();
    document.getElementById('approvalDate').textContent = formatToIST(user.created_at);

    openModal('userApprovalModal');
}

// Quick approve user
async function approveUserQuick(userId) {
    if (confirm('Approve this user account?')) {
        try {
            console.log('Approving user:', userId);
            const response = await apiRequest(`/users/${userId}/approve`, { 
                method: 'POST',
                body: JSON.stringify({})
            });
            console.log('Approve response:', response);
            showSuccess('User approved successfully!');
            await loadPendingApprovals();
        } catch (error) {
            console.error('Error approving user:', error);
            showError('Error approving user: ' + error.message);
        }
    }
}

// Quick reject user
async function rejectUserQuick(userId) {
    if (confirm('Reject and delete this user account?')) {
        try {
            console.log('Rejecting user:', userId);
            const response = await apiRequest(`/users/${userId}/reject`, { 
                method: 'POST',
                body: JSON.stringify({})
            });
            console.log('Reject response:', response);
            showSuccess('User rejected and deleted');
            await loadPendingApprovals();
        } catch (error) {
            console.error('Error rejecting user:', error);
            showError('Error rejecting user: ' + error.message);
        }
    }
}

// Approve user (from modal)
async function approveUser() {
    if (!selectedUserId) {
        showError('No user selected');
        return;
    }

    try {
        console.log('Approving user from modal:', selectedUserId);
        const response = await apiRequest(`/users/${selectedUserId}/approve`, { 
            method: 'POST',
            body: JSON.stringify({})
        });
        console.log('Approve response:', response);
        closeModal('userApprovalModal');
        showSuccess('User approved and activated!');
        await loadPendingApprovals();
    } catch (error) {
        console.error('Error approving user:', error);
        showError('Error approving user: ' + error.message);
    }
}

// Reject user (from modal)
async function rejectUser() {
    if (!selectedUserId) {
        showError('No user selected');
        return;
    }

    try {
        console.log('Rejecting user from modal:', selectedUserId);
        const response = await apiRequest(`/users/${selectedUserId}/reject`, { 
            method: 'POST',
            body: JSON.stringify({})
        });
        console.log('Reject response:', response);
        closeModal('userApprovalModal');
        showSuccess('User rejected and deleted');
        await loadPendingApprovals();
    } catch (error) {
        console.error('Error rejecting user:', error);
        showError('Error rejecting user: ' + error.message);
    }
}

// Setup menu listeners
function setupMenuListeners() {
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const menuType = item.dataset.menu;
            showSection(menuType);
            
            // Update active state
            document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
            item.classList.add('active');
            
            // Update page title
            const titles = {
                approvals: 'User Approvals',
                projects: 'Projects',
                users: 'Users',
                vault: 'Vault',
                requests: 'Requests',
                history: 'Activity History',
                reports: 'Reports & Analytics',
                ecos: 'Engineering Change Orders',
                settings: 'Settings'
            };
            document.getElementById('page-title').textContent = titles[menuType] || 'Dashboard';
            
            // Load data for the section
            if (menuType === 'approvals') loadPendingApprovals();
            else if (menuType === 'users') loadUsers();
            else if (menuType === 'settings') populateSettingsFields();
            else if (menuType === 'projects') loadProjects();
            else if (menuType === 'vault') loadVault();
            else if (menuType === 'requests') loadRequests();
            else if (menuType === 'history') loadHistory();
            else if (menuType === 'reports') loadAnalytics();
            else if (menuType === 'ecos') loadECOs();
        });
    });
}

// Show/hide sections
function showSection(sectionId) {
    document.querySelectorAll('.content-section').forEach(section => {
        section.style.display = 'none';
    });
    document.getElementById(sectionId + '-section').style.display = 'block';
}

// Load projects from API
async function loadProjects() {
    try {
        showLoading('projectsTable');
        const projects = await getProjects();
        currentProjects = projects || [];
        const tbody = document.getElementById('projectsTable');
        
        if (projects.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">No projects found</td></tr>';
            return;
        }

        tbody.innerHTML = projects.map(project => `
            <tr>
                <td>${escapeHtml(project.name)}</td>
                <td>${escapeHtml(project.plm_id)}</td>
                <td>${escapeHtml(project.owner_id)}</td>
                <td>${new Date(project.created_at).toLocaleDateString()}</td>
                <td><span class="status-badge ${project.status}">${escapeHtml(project.status)}</span></td>
                <td class="actions">
                    <button class="btn-icon" onclick="editProject(${project.id})">✏️</button>
                    <button class="btn-icon" onclick="deleteProjectConfirm(${project.id})">🗑️</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        showError('Failed to load projects: ' + error.message);
    }
}

// Load users from API
async function loadUsers() {
    try {
        const users = await getUsers();
        usersCache = users || [];
        const tbody = document.getElementById('usersTable');
        
        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">No users found</td></tr>';
            return;
        }

        tbody.innerHTML = users.map(user => `
            <tr>
                <td>${user.id}</td>
                <td>${user.username}</td>
                <td>${user.email}</td>
                <td><span class="role-badge">${user.role}</span></td>
                <td><span class="status-badge ${user.is_active ? 'active' : 'inactive'}">${user.is_active ? 'Active' : 'Inactive'}</span></td>
                <td class="actions">
                    <button class="btn-icon" onclick="editUser('${user.id}')">✏️</button>
                    <button class="btn-icon" onclick="deleteUser('${user.id}')">🗑️</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        showError('Failed to load users: ' + error.message);
    }
}

async function loadVault() {
    await Promise.all([loadParts(), loadAssemblies()]);
}

async function loadParts() {
    try {
        const parts = await apiRequest('/parts', { method: 'GET' });
        partsCache = parts || [];
        renderPartsTable(partsCache);
    } catch (error) {
        showError('Failed to load parts: ' + error.message);
    }
}

function renderPartsTable(parts) {
    const tbody = document.getElementById('partsTable');
    if (!parts.length) {
        tbody.innerHTML = '<tr><td colspan="9">No parts found</td></tr>';
        return;
    }
    tbody.innerHTML = parts.map(part => {
        const critClass = part.criticality === 'critical' ? 'danger' : part.criticality === 'high' ? 'review' : 'active';
        const statusClass = part.latest_status === 'frozen' ? 'approved' : 'review';
        return `<tr>
            <td><strong>${part.part_code}</strong></td>
            <td>${part.name}</td>
            <td>${part.material || '-'}</td>
            <td><span class="status-badge ${critClass}">${part.criticality || 'normal'}</span></td>
            <td><span class="status-badge ${part.lifecycle_state === 'released' ? 'approved' : 'active'}">${part.lifecycle_state || 'draft'}</span></td>
            <td>${part.owner_name || part.owner_id}</td>
            <td>${part.version_count || 0}</td>
            <td><span class="status-badge ${statusClass}">${part.latest_version || '-'} (${part.latest_status || '-'})</span></td>
            <td class="actions">
                <button class="btn-icon" title="Versions" onclick="openPartVersionsModal('${part.id}')">📄</button>
                <button class="btn-icon" title="Delete" onclick="deletePart('${part.id}')">🗑️</button>
            </td>
        </tr>`;
    }).join('');
}

function filterPartsTable() {
    const search = (document.getElementById('vaultPartSearch')?.value || '').toLowerCase();
    const crit = document.getElementById('vaultPartCriticality')?.value || '';
    const lifecycle = document.getElementById('vaultPartLifecycle')?.value || '';
    const filtered = partsCache.filter(p => {
        const matchSearch = !search || p.part_code.toLowerCase().includes(search) || p.name.toLowerCase().includes(search) || (p.material || '').toLowerCase().includes(search) || (p.vendor || '').toLowerCase().includes(search);
        const matchCrit = !crit || p.criticality === crit;
        const matchLife = !lifecycle || p.lifecycle_state === lifecycle;
        return matchSearch && matchCrit && matchLife;
    });
    renderPartsTable(filtered);
}

async function deletePart(partId) {
    if (!confirm('Are you sure you want to delete this part? This cannot be undone.')) return;
    try {
        await apiRequest(`/parts/${partId}`, { method: 'DELETE' });
        showSuccess('Part deleted');
        await loadParts();
    } catch (error) {
        showError('Failed to delete part: ' + error.message);
    }
}

async function loadAssemblies() {
    try {
        const assemblies = await apiRequest('/assemblies', { method: 'GET' });
        assembliesCache = assemblies || [];
        renderAssembliesTable(assembliesCache);
    } catch (error) {
        showError('Failed to load assemblies: ' + error.message);
    }
}

function renderAssembliesTable(assemblies) {
    const tbody = document.getElementById('assembliesTable');
    if (!assemblies.length) {
        tbody.innerHTML = '<tr><td colspan="8">No assemblies found</td></tr>';
        return;
    }
    tbody.innerHTML = assemblies.map(a => {
        const critClass = a.criticality === 'critical' ? 'danger' : a.criticality === 'high' ? 'review' : 'active';
        const statusClass = a.latest_status === 'frozen' ? 'approved' : 'review';
        return `<tr>
            <td><strong>${a.assembly_code}</strong></td>
            <td>${a.name}</td>
            <td><span class="status-badge ${critClass}">${a.criticality || 'normal'}</span></td>
            <td><span class="status-badge ${(a.lifecycle_state === 'released') ? 'approved' : 'active'}">${a.lifecycle_state || 'draft'}</span></td>
            <td>${a.owner_name || a.owner_id}</td>
            <td>${a.version_count || 0}</td>
            <td><span class="status-badge ${statusClass}">${a.latest_version || '-'} (${a.latest_status || '-'})</span></td>
            <td class="actions">
                <button class="btn-icon" title="Versions" onclick="openAssemblyVersionsModal('${a.id}')">📄</button>
                <button class="btn-icon" title="Delete" onclick="deleteAssembly('${a.id}')">🗑️</button>
            </td>
        </tr>`;
    }).join('');
}

function filterAssembliesTable() {
    const search = (document.getElementById('vaultAssemblySearch')?.value || '').toLowerCase();
    const crit = document.getElementById('vaultAssemblyCriticality')?.value || '';
    const filtered = assembliesCache.filter(a => {
        const matchSearch = !search || a.assembly_code.toLowerCase().includes(search) || a.name.toLowerCase().includes(search);
        const matchCrit = !crit || a.criticality === crit;
        return matchSearch && matchCrit;
    });
    renderAssembliesTable(filtered);
}

async function deleteAssembly(assemblyId) {
    if (!confirm('Are you sure you want to delete this assembly?')) return;
    try {
        await apiRequest(`/assemblies/${assemblyId}`, { method: 'DELETE' });
        showSuccess('Assembly deleted');
        await loadAssemblies();
    } catch (error) {
        showError('Failed to delete assembly: ' + error.message);
    }
}

function openCreatePartModal() {
    openModal('createPartModal');
}

function openCreateAssemblyModal() {
    openModal('createAssemblyModal');
}

async function createPart() {
    const partCode = document.getElementById('partCode').value.trim();
    const name = document.getElementById('partName').value.trim();
    const workingPath = document.getElementById('partWorkingPath').value.trim();
    const description = document.getElementById('partDescription')?.value.trim();
    const material = document.getElementById('partMaterial')?.value.trim();
    const vendor = document.getElementById('partVendor')?.value.trim();
    const criticality = document.getElementById('partCriticality')?.value;
    const tags = document.getElementById('partTags')?.value.trim();

    if (!partCode || !name) {
        showError('Part code and name are required');
        return;
    }

    try {
        await apiRequest('/parts', {
            method: 'POST',
            body: JSON.stringify({ part_code: partCode, name, working_path: workingPath || null, description, material, vendor, criticality, tags })
        });
        showSuccess('Part created successfully');
        closeModal('createPartModal');
        await loadParts();
    } catch (error) {
        showError('Failed to create part: ' + error.message);
    }
}

async function createAssembly() {
    const assemblyCode = document.getElementById('assemblyCode').value.trim();
    const name = document.getElementById('assemblyName').value.trim();
    const partVersions = document.getElementById('assemblyPartVersions').value;
    const workingPath = document.getElementById('assemblyWorkingPath').value.trim();
    const description = document.getElementById('assemblyDescription')?.value.trim();
    const criticality = document.getElementById('assemblyCriticality')?.value;
    const tags = document.getElementById('assemblyTags')?.value.trim();

    const partVersionIds = partVersions
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length)
        .map((value) => Number(value));

    if (!assemblyCode || !name || !partVersionIds.length || partVersionIds.some(Number.isNaN)) {
        showError('Assembly code, name, and valid part version IDs are required');
        return;
    }

    try {
        await apiRequest('/assemblies', {
            method: 'POST',
            body: JSON.stringify({
                assembly_code: assemblyCode, name,
                part_version_ids: partVersionIds,
                working_path: workingPath || null,
                description, criticality, tags
            })
        });
        showSuccess('Assembly created successfully');
        closeModal('createAssemblyModal');
        await loadAssemblies();
    } catch (error) {
        showError('Failed to create assembly: ' + error.message);
    }
}

function openPartVersionsModal(partId) {
    const part = partsCache.find((item) => String(item.id) === String(partId));
    if (!part) {
        showError('Part not found');
        return;
    }

    selectedPartId = partId;
    document.getElementById('partVersionsTitle').textContent = `${part.part_code} - ${part.name}`;
    // Populate metadata bar
    const metaBar = document.getElementById('partMetaBar');
    if (metaBar) {
        metaBar.innerHTML = `<span><strong>Material:</strong> ${part.material || '-'}</span>
            <span><strong>Vendor:</strong> ${part.vendor || '-'}</span>
            <span><strong>Criticality:</strong> ${part.criticality || 'normal'}</span>
            <span><strong>Lifecycle:</strong> ${part.lifecycle_state || 'draft'}</span>
            <span><strong>Tags:</strong> ${part.tags || '-'}</span>`;
    }
    openModal('partVersionsModal');
    loadPartVersions();
}

async function loadPartVersions() {
    if (!selectedPartId) return;
    try {
        const versions = await apiRequest(`/parts/${selectedPartId}/versions`, { method: 'GET' });
        const tbody = document.getElementById('partVersionsTable');

        if (!versions.length) {
            tbody.innerHTML = '<tr><td colspan="8">No versions found</td></tr>';
            return;
        }

        tbody.innerHTML = versions.map((version) => `
            <tr>
                <td>${version.id}</td>
                <td>${version.version_label}</td>
                <td><span class="status-badge ${version.status === 'frozen' ? 'approved' : 'review'}">${version.status}</span></td>
                <td>${version.change_notes || '-'}</td>
                <td>${version.frozen_by_name || '-'}</td>
                <td>${version.working_path || '-'}</td>
                <td>${version.storage_path || '-'}</td>
                <td class="actions">
                    ${version.status !== 'frozen' ? `<button class="btn-icon" title="Freeze" onclick="freezePartVersion('${version.id}')">❄️</button>` : ''}
                    <button class="btn-icon" title="Impact" onclick="showPartImpact('${selectedPartId}')">🔗</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        showError('Failed to load part versions: ' + error.message);
    }
}

function openCreatePartVersionModal() {
    if (!selectedPartId) return;
    openModal('createPartVersionModal');
}

async function createPartVersion() {
    const label = document.getElementById('partVersionLabel').value.trim();
    const workingPath = document.getElementById('partVersionWorkingPath').value.trim();
    const changeNotes = document.getElementById('partVersionChangeNotes')?.value.trim();

    try {
        await apiRequest(`/parts/${selectedPartId}/versions`, {
            method: 'POST',
            body: JSON.stringify({ version_label: label || null, working_path: workingPath || null, change_notes: changeNotes || null })
        });
        showSuccess('Part version created');
        closeModal('createPartVersionModal');
        await loadPartVersions();
    } catch (error) {
        showError('Failed to create part version: ' + error.message);
    }
}

async function freezePartVersion(versionId) {
    try {
        await apiRequest(`/parts/${selectedPartId}/versions/${versionId}/freeze`, {
            method: 'POST',
            body: JSON.stringify({})
        });
        showSuccess('Part version frozen');
        await loadPartVersions();
    } catch (error) {
        showError('Failed to freeze part version: ' + error.message);
    }
}

async function rollbackPartVersion() {
    const versionId = document.getElementById('rollbackVersionId').value.trim();
    if (!versionId) {
        showError('Version ID is required');
        return;
    }

    try {
        await apiRequest(`/parts/${selectedPartId}/rollback`, {
            method: 'POST',
            body: JSON.stringify({ version_id: Number(versionId) })
        });
        showSuccess('Rollback version created');
        await loadPartVersions();
    } catch (error) {
        showError('Failed to rollback part version: ' + error.message);
    }
}

function openAssemblyVersionsModal(assemblyId) {
    const assembly = assembliesCache.find((item) => String(item.id) === String(assemblyId));
    if (!assembly) {
        showError('Assembly not found');
        return;
    }

    selectedAssemblyId = assemblyId;
    document.getElementById('assemblyVersionsTitle').textContent = `${assembly.assembly_code} - ${assembly.name}`;
    const metaBar = document.getElementById('assemblyMetaBar');
    if (metaBar) {
        metaBar.innerHTML = `<span><strong>Criticality:</strong> ${assembly.criticality || 'normal'}</span>
            <span><strong>Lifecycle:</strong> ${assembly.lifecycle_state || 'draft'}</span>
            <span><strong>Tags:</strong> ${assembly.tags || '-'}</span>`;
    }
    openModal('assemblyVersionsModal');
    loadAssemblyVersions();
}

async function loadAssemblyVersions() {
    if (!selectedAssemblyId) return;
    try {
        const versions = await apiRequest(`/assemblies/${selectedAssemblyId}/versions`, { method: 'GET' });
        const tbody = document.getElementById('assemblyVersionsTable');

        if (!versions.length) {
            tbody.innerHTML = '<tr><td colspan="7">No versions found</td></tr>';
            return;
        }

        tbody.innerHTML = versions.map((version) => `
            <tr>
                <td>${version.id}</td>
                <td>${version.version_label}</td>
                <td><span class="status-badge ${version.status === 'frozen' ? 'approved' : 'review'}">${version.status}</span></td>
                <td>${version.frozen_by_name || '-'}</td>
                <td>${version.working_path || '-'}</td>
                <td>${version.storage_path || '-'}</td>
                <td class="actions">
                    ${version.status !== 'frozen' ? `<button class="btn-icon" title="Freeze" onclick="freezeAssemblyVersion('${version.id}')">❄️</button>` : ''}
                    <button class="btn-icon" title="BOM" onclick="showBOM('${selectedAssemblyId}', '${version.id}')">📋</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        showError('Failed to load assembly versions: ' + error.message);
    }
}

function openCreateAssemblyVersionModal() {
    if (!selectedAssemblyId) return;
    openModal('createAssemblyVersionModal');
}

async function createAssemblyVersion() {
    const label = document.getElementById('assemblyVersionLabel').value.trim();
    const partIds = document.getElementById('assemblyVersionPartIds').value;
    const workingPath = document.getElementById('assemblyVersionWorkingPath').value.trim();

    const partVersionIds = partIds
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length)
        .map((value) => Number(value));

    if (!partVersionIds.length || partVersionIds.some(Number.isNaN)) {
        showError('Valid part version IDs are required');
        return;
    }

    try {
        await apiRequest(`/assemblies/${selectedAssemblyId}/versions`, {
            method: 'POST',
            body: JSON.stringify({
                version_label: label || null,
                part_version_ids: partVersionIds,
                working_path: workingPath || null
            })
        });
        showSuccess('Assembly version created');
        closeModal('createAssemblyVersionModal');
        await loadAssemblyVersions();
    } catch (error) {
        showError('Failed to create assembly version: ' + error.message);
    }
}

async function freezeAssemblyVersion(versionId) {
    try {
        await apiRequest(`/assemblies/${selectedAssemblyId}/versions/${versionId}/freeze`, {
            method: 'POST',
            body: JSON.stringify({})
        });
        showSuccess('Assembly version frozen');
        await loadAssemblyVersions();
    } catch (error) {
        showError('Failed to freeze assembly version: ' + error.message);
    }
}

async function showPartImpact(partId) {
    try {
        const data = await apiRequest(`/parts/${partId}/impact`, { method: 'GET' });
        const tbody = document.getElementById('impactTable');
        if (!data.assemblies || !data.assemblies.length) {
            tbody.innerHTML = '<tr><td colspan="3">No assemblies reference this part</td></tr>';
        } else {
            tbody.innerHTML = data.assemblies.map(a => `<tr>
                <td>${a.assembly_code}</td>
                <td>${a.name}</td>
                <td>${a.version_label}</td>
            </tr>`).join('');
        }
        openModal('impactModal');
    } catch (error) {
        showError('Failed to load impact analysis: ' + error.message);
    }
}

async function showBOM(assemblyId, versionId) {
    try {
        const data = await apiRequest(`/assemblies/${assemblyId}/versions/${versionId}/bom`, { method: 'GET' });
        const tbody = document.getElementById('bomTable');
        if (!data.parts || !data.parts.length) {
            tbody.innerHTML = '<tr><td colspan="4">No parts in BOM</td></tr>';
        } else {
            tbody.innerHTML = data.parts.map(p => `<tr>
                <td>${p.part_code}</td>
                <td>${p.name}</td>
                <td>${p.version_label}</td>
                <td><span class="status-badge ${p.status === 'frozen' ? 'approved' : 'review'}">${p.status}</span></td>
            </tr>`).join('');
        }
        openModal('bomModal');
    } catch (error) {
        showError('Failed to load BOM: ' + error.message);
    }
}

async function loadRequests() {
    await Promise.all([loadEditRequests(), loadReleaseRequests()]);
}

async function loadEditRequests() {
    try {
        const requests = await apiRequest('/edit-requests', { method: 'GET' });
        const tbody = document.getElementById('editRequestsTable');

        if (!requests.length) {
            tbody.innerHTML = '<tr><td colspan="5">No edit requests</td></tr>';
            return;
        }

        tbody.innerHTML = requests.map((request) => `
            <tr>
                <td>${request.requester_name}</td>
                <td>${request.part_code}</td>
                <td>${request.reason || '-'}</td>
                <td><span class="status-badge review">Pending</span></td>
                <td class="actions">
                    <button class="btn-icon" onclick="approveEditRequest(${request.id})">✅</button>
                    <button class="btn-icon" onclick="rejectEditRequest(${request.id})">❌</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        showError('Failed to load edit requests: ' + error.message);
    }
}

async function approveEditRequest(requestId) {
    try {
        await apiRequest(`/edit-requests/${requestId}/approve`, { method: 'POST', body: JSON.stringify({}) });
        showSuccess('Edit request approved');
        await loadEditRequests();
    } catch (error) {
        showError('Failed to approve edit request: ' + error.message);
    }
}

async function rejectEditRequest(requestId) {
    try {
        await apiRequest(`/edit-requests/${requestId}/reject`, { method: 'POST', body: JSON.stringify({}) });
        showSuccess('Edit request rejected');
        await loadEditRequests();
    } catch (error) {
        showError('Failed to reject edit request: ' + error.message);
    }
}

async function loadReleaseRequests() {
    try {
        const requests = await apiRequest('/release-requests', { method: 'GET' });
        const tbody = document.getElementById('releaseRequestsTable');

        if (!requests.length) {
            tbody.innerHTML = '<tr><td colspan="6">No release requests</td></tr>';
            return;
        }

        tbody.innerHTML = requests.map((request) => `
            <tr>
                <td>${request.requester_id}</td>
                <td>${request.item_type}</td>
                <td>${request.item_version_id}</td>
                <td>${request.reason || '-'}</td>
                <td><span class="status-badge review">Pending</span></td>
                <td class="actions">
                    <button class="btn-icon" onclick="approveReleaseRequest(${request.id})">✅</button>
                    <button class="btn-icon" onclick="rejectReleaseRequest(${request.id})">❌</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        showError('Failed to load release requests: ' + error.message);
    }
}

async function approveReleaseRequest(requestId) {
    try {
        await apiRequest(`/release-requests/${requestId}/approve`, { method: 'POST', body: JSON.stringify({}) });
        showSuccess('Release request approved');
        await loadReleaseRequests();
    } catch (error) {
        showError('Failed to approve release request: ' + error.message);
    }
}

async function rejectReleaseRequest(requestId) {
    try {
        await apiRequest(`/release-requests/${requestId}/reject`, { method: 'POST', body: JSON.stringify({}) });
        showSuccess('Release request rejected');
        await loadReleaseRequests();
    } catch (error) {
        showError('Failed to reject release request: ' + error.message);
    }
}

// Load activity history from API
async function loadHistory() {
    try {
        const response = await apiRequest('/activity-history?limit=200', { method: 'GET' });
        displayHistory(response);
    } catch (error) {
        console.error('Error loading history:', error);
        document.getElementById('historyTable').innerHTML = '<tr><td colspan="5" style="color: red; text-align: center; padding: 20px;">Error loading history</td></tr>';
    }
}

// Display activity history in table
function displayHistory(activities) {
    const tbody = document.getElementById('historyTable');
    
    if (!activities || activities.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #999; padding: 40px;">No activity history found</td></tr>';
        return;
    }

    tbody.innerHTML = activities.map(activity => {
        // Timestamp is already in IST format from backend
        const timeString = activity.timestamp;
        
        // Get action type badge color
        const typeColors = {
            'LOGIN': 'primary',
            'ACCOUNT_CREATED': 'success',
            'USER_APPROVED': 'success',
            'USER_REJECTED': 'danger',
            'PROJECT_CREATED': 'primary',
            'PROJECT_DELETED': 'danger'
        };
        
        const color = typeColors[activity.action_type] || 'secondary';
        
        // Parse details if it's JSON
        let detailsText = '';
        try {
            if (activity.details) {
                const details = JSON.parse(activity.details);
                detailsText = Object.values(details).join(' | ');
            }
        } catch (e) {
            detailsText = activity.details;
        }

        return `
            <tr>
                <td><small>${timeString}</small></td>
                <td><strong>${activity.username}</strong></td>
                <td><span class="status-badge ${color}">${activity.action_type.replace(/_/g, ' ')}</span></td>
                <td>${activity.action}</td>
                <td><small style="color: #b0b3b8;">${detailsText}</small></td>
            </tr>
        `;
    }).join('');
}

// Filter history by action type
async function filterHistory() {
    const actionType = document.getElementById('historyFilter').value;
    
    try {
        const url = actionType 
            ? `/activity-history?limit=200&actionType=${actionType}`
            : '/activity-history?limit=200';
        
        const response = await apiRequest(url, { method: 'GET' });
        displayHistory(response);
    } catch (error) {
        console.error('Error filtering history:', error);
        showError('Error filtering history');
    }
}

function openCreateProjectModal() {
    openModal('projectModal');
}

function openCreateUserModal() {
    // Open the user creation section or modal
    showSection('users');
    showSuccess('Use the user management section to manage users');
}

// Project functions
async function submitCreateProject(event) {
    event.preventDefault();
    
    const nameInput = document.querySelector('#projectModal input[type="text"]');
    const name = nameInput.value.trim();
    const statusSelect = document.querySelector('#projectModal select');
    const status = statusSelect.value || 'active';

    if (!name) {
        showError('Please enter a project name');
        return;
    }

    try {
        const btn = event.target;
        btn.textContent = 'Creating...';
        btn.disabled = true;

        await createProject(name, status);
        showSuccess('Project created successfully!');
        closeModal('projectModal');
        document.querySelector('#projectModal form').reset();
        await loadProjects();

        btn.textContent = 'Create Project';
        btn.disabled = false;
    } catch (error) {
        showError('Failed to create project: ' + error.message);
        const btn = event.target;
        btn.textContent = 'Create Project';
        btn.disabled = false;
    }
}

function editProject(id) {
    const project = currentProjects.find(p => p.id === id);
    if (!project) { showError('Project not found'); return; }

    // Reuse the create project modal for editing
    const nameInput = document.querySelector('#projectModal input[type="text"]');
    const statusSelect = document.querySelector('#projectModal select');
    if (nameInput) nameInput.value = project.name;
    if (statusSelect) statusSelect.value = project.status || 'active';
    
    // Store edit state
    window._editingProjectId = id;
    openModal('projectModal');
}

async function deleteProjectConfirm(id) {
    if (confirm('Are you sure you want to delete this project?')) {
        try {
            await deleteProject(id);
            showSuccess('Project deleted successfully!');
            await loadProjects();
        } catch (error) {
            showError('Failed to delete project: ' + error.message);
        }
    }
}

// User functions
function editUser(id) {
    const user = usersCache.find((u) => u.id === id);
    if (!user) {
        showError('User not found');
        return;
    }

    selectedEditUserId = id;
    const userIdInput = document.getElementById('editUserId');
    const usernameInput = document.getElementById('editUsername');
    const emailInput = document.getElementById('editEmail');
    const roleSelect = document.getElementById('editRole');
    const statusSelect = document.getElementById('editStatus');

    userIdInput.value = user.id;
    usernameInput.value = user.username || '';
    emailInput.value = user.email || '';
    roleSelect.value = user.role || 'designer';
    statusSelect.value = user.is_active ? '1' : '0';

    openModal('editUserModal');
}

async function updateUser() {
    if (!selectedEditUserId) {
        showError('No user selected');
        return;
    }

    const usernameInput = document.getElementById('editUsername');
    const emailInput = document.getElementById('editEmail');
    const roleSelect = document.getElementById('editRole');
    const statusSelect = document.getElementById('editStatus');

    const username = usernameInput.value.trim();
    const email = emailInput.value.trim();
    const role = roleSelect.value;
    const isActive = statusSelect.value === '1';

    if (!username || !email) {
        showError('Username and email are required');
        return;
    }

    try {
        await apiRequest(`/users/${selectedEditUserId}`, {
            method: 'PUT',
            body: JSON.stringify({ username, email, role, is_active: isActive })
        });
        showSuccess('User updated successfully');
        closeModal('editUserModal');
        await loadUsers();
    } catch (error) {
        showError('Failed to update user: ' + error.message);
    }
}

async function deleteUser(id) {
    if (!currentUser) {
        showError('Not authorized');
        return;
    }

    if (id === currentUser.id) {
        showError('You cannot delete your own account');
        return;
    }

    if (confirm('Are you sure you want to delete this user?')) {
        try {
            await apiRequest(`/users/${id}`, { method: 'DELETE' });
            showSuccess('User deleted successfully');
            await loadUsers();
        } catch (error) {
            showError('Failed to delete user: ' + error.message);
        }
    }
}

// Report functions
function generateReport() {
    const reportData = {
        totalProjects: currentProjects.length,
        activeProjects: currentProjects.filter(p => p.status === 'active').length,
        completedProjects: currentProjects.filter(p => p.status === 'completed').length,
        totalUsers: usersCache ? usersCache.length : 0,
        pendingApprovals: pendingUsers ? pendingUsers.length : 0
    };
    
    let report = 'PLM System Report\n';
    report += '='.repeat(40) + '\n';
    report += `Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\n`;
    report += `Total Projects: ${reportData.totalProjects}\n`;
    report += `Active Projects: ${reportData.activeProjects}\n`;
    report += `Completed Projects: ${reportData.completedProjects}\n`;
    report += `Total Users: ${reportData.totalUsers}\n`;
    report += `Pending Approvals: ${reportData.pendingApprovals}\n`;
    
    // Download as text file
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `plm_report_${Date.now()}.txt`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    showSuccess('Report generated and downloaded!');
}

// Settings functions
function saveSettings() {
    showSuccess('Settings saved successfully!');
}

// handleChangePassword is now in api.js

async function handleUpdateEmail() {
    const newEmail = document.getElementById('newEmail').value.trim();
    const password = document.getElementById('emailPassword').value.trim();
    const errorDiv = document.getElementById('emailError');
    const successDiv = document.getElementById('emailSuccess');

    // Clear previous messages
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';

    // Validate input
    if (!newEmail) {
        errorDiv.textContent = 'Please enter a new email address';
        errorDiv.style.display = 'block';
        return;
    }

    if (!password) {
        errorDiv.textContent = 'Please enter your password for verification';
        errorDiv.style.display = 'block';
        return;
    }

    // Simple email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
        errorDiv.textContent = 'Please enter a valid email address';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        const result = await updateEmail(newEmail, password);
        
        // Update the current email field
        document.getElementById('currentEmail').value = newEmail;
        // Clear the new email and password fields
        document.getElementById('newEmail').value = '';
        document.getElementById('emailPassword').value = '';

        // Show success message
        successDiv.textContent = result.message || 'Email updated successfully!';
        successDiv.style.display = 'block';

        // Hide success message after 3 seconds
        setTimeout(() => {
            successDiv.style.display = 'none';
        }, 3000);
    } catch (error) {
        errorDiv.textContent = error.message || 'Error updating email';
        errorDiv.style.display = 'block';
    }
}

function populateSettingsFields() {
    const currentEmailField = document.getElementById('currentEmail');
    if (currentEmailField && currentUser) {
        // Try to get email from currentUser or make API call
        if (currentUser.email) {
            currentEmailField.value = currentUser.email;
        } else {
            // Fetch current user details from API
            apiRequest('/users/current', { method: 'GET' })
                .then(user => {
                    if (user && user.email) {
                        currentEmailField.value = user.email;
                        // Update currentUser object
                        currentUser.email = user.email;
                    }
                })
                .catch(err => console.error('Error fetching user details:', err));
        }
    }
}

// logout, openModal, closeModal, modal event listeners are now in api.js

// Search and filter functions
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    const statusFilter = document.getElementById('statusFilter');
    
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterTable(e.target.value);
        });
    }
    
    if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
            filterByStatus(e.target.value);
        });
    }
});

function filterTable(searchTerm) {
    const rows = document.querySelectorAll('tbody tr');
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchTerm.toLowerCase()) ? '' : 'none';
    });
}

function filterByStatus(status) {
    if (!status) {
        document.querySelectorAll('tbody tr').forEach(row => row.style.display = '');
        return;
    }
    
    const rows = document.querySelectorAll('tbody tr');
    rows.forEach(row => {
        const statusBadge = row.querySelector('.status-badge');
        if (statusBadge && statusBadge.classList.contains(status)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

// ====== Analytics / Reports ======
async function loadAnalytics() {
    try {
        const data = await apiRequest('/analytics/dashboard', { method: 'GET' });
        document.getElementById('statProjects').textContent = data.totalProjects || 0;
        document.getElementById('statUsers').textContent = data.activeUsers || 0;
        document.getElementById('statParts').textContent = data.totalParts || 0;
        document.getElementById('statAssemblies').textContent = data.totalAssemblies || 0;
        document.getElementById('statECOs').textContent = data.openECOs || 0;
        document.getElementById('statEditReqs').textContent = data.pendingEditRequests || 0;
        document.getElementById('statReleaseReqs').textContent = data.pendingReleaseRequests || 0;
        
        // Lifecycle distribution bar chart
        const tbody = document.getElementById('lifecycleTable');
        if (data.partsByLifecycle && data.partsByLifecycle.length) {
            const maxCount = Math.max(...data.partsByLifecycle.map(r => r.count));
            tbody.innerHTML = data.partsByLifecycle.map(r => {
                const pct = maxCount > 0 ? Math.round((r.count / maxCount) * 100) : 0;
                return `<tr>
                    <td><span class="status-badge ${r.lifecycle_state === 'released' ? 'approved' : 'active'}">${r.lifecycle_state || 'unknown'}</span></td>
                    <td>${r.count}</td>
                    <td><div style="background:var(--primary-color);height:20px;width:${pct}%;border-radius:4px;min-width:4px;"></div></td>
                </tr>`;
            }).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="3">No data</td></tr>';
        }
    } catch (error) {
        showError('Failed to load analytics: ' + error.message);
    }
}

// ====== ECO Functions ======
async function loadECOs() {
    const search = document.getElementById('ecoSearchInput')?.value || '';
    const status = document.getElementById('ecoStatusFilter')?.value || '';
    const priority = document.getElementById('ecoPriorityFilter')?.value || '';
    let url = '/ecos?';
    if (search) url += `search=${encodeURIComponent(search)}&`;
    if (status) url += `status=${status}&`;
    if (priority) url += `priority=${priority}&`;
    
    try {
        const ecos = await apiRequest(url, { method: 'GET' });
        ecosCache = ecos || [];
        const container = document.getElementById('ecoList');
        if (!ecos.length) {
            container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">No ECOs found. Create your first Engineering Change Order.</div>';
            return;
        }
        container.innerHTML = ecos.map(eco => {
            const priorityClass = eco.priority === 'critical' ? 'danger' : eco.priority === 'high' ? 'review' : 'active';
            const statusClass = eco.status === 'approved' ? 'approved' : eco.status === 'rejected' ? 'danger' : 'review';
            return `<div class="eco-card" onclick="openEcoDetail('${eco.id}')">
                <div class="eco-header">
                    <span class="eco-number">${eco.eco_number}</span>
                    <div style="display:flex;gap:8px;">
                        <span class="status-badge ${priorityClass}">${eco.priority}</span>
                        <span class="status-badge ${statusClass}">${eco.status}</span>
                    </div>
                </div>
                <div class="eco-title">${eco.title}</div>
                <div class="eco-meta">
                    <span>By: ${eco.requester_name || 'Unknown'}</span>
                    <span>Created: ${formatToIST(eco.created_at)}</span>
                    ${eco.affected_parts ? `<span>Parts: ${eco.affected_parts}</span>` : ''}
                    ${eco.affected_assemblies ? `<span>Assemblies: ${eco.affected_assemblies}</span>` : ''}
                </div>
            </div>`;
        }).join('');
    } catch (error) {
        showError('Failed to load ECOs: ' + error.message);
    }
}

async function createECO() {
    const title = document.getElementById('ecoTitle').value.trim();
    const description = document.getElementById('ecoDescription').value.trim();
    const reason = document.getElementById('ecoReason').value.trim();
    const priority = document.getElementById('ecoPriority').value;
    const affectedParts = document.getElementById('ecoAffectedParts').value.trim();
    const affectedAssemblies = document.getElementById('ecoAffectedAssemblies').value.trim();
    
    if (!title) { showError('Title is required'); return; }
    
    try {
        await apiRequest('/ecos', {
            method: 'POST',
            body: JSON.stringify({ title, description, reason, priority, affected_parts: affectedParts, affected_assemblies: affectedAssemblies })
        });
        showSuccess('ECO created successfully');
        closeModal('createEcoModal');
        await loadECOs();
    } catch (error) {
        showError('Failed to create ECO: ' + error.message);
    }
}

async function openEcoDetail(ecoId) {
    selectedEcoId = ecoId;
    const eco = ecosCache.find(e => String(e.id) === String(ecoId));
    if (!eco) return;
    
    document.getElementById('ecoDetailTitle').textContent = `${eco.eco_number} - ${eco.title}`;
    document.getElementById('ecoDetailContent').innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
            <div><strong>Status:</strong> <span class="status-badge ${eco.status === 'approved' ? 'approved' : 'review'}">${eco.status}</span></div>
            <div><strong>Priority:</strong> <span class="status-badge ${eco.priority === 'critical' ? 'danger' : 'active'}">${eco.priority}</span></div>
            <div><strong>Requester:</strong> ${escapeHtml(eco.requester_name || 'Unknown')}</div>
            <div><strong>Reviewer:</strong> ${escapeHtml(eco.reviewer_name || 'None yet')}</div>
        </div>
        ${eco.description ? `<div style="margin-bottom:12px;"><strong>Description:</strong><br>${escapeHtml(eco.description)}</div>` : ''}
        ${eco.reason ? `<div style="margin-bottom:12px;"><strong>Reason:</strong><br>${escapeHtml(eco.reason)}</div>` : ''}
        ${eco.affected_parts ? `<div style="margin-bottom:12px;"><strong>Affected Parts:</strong> ${escapeHtml(eco.affected_parts)}</div>` : ''}
        ${eco.affected_assemblies ? `<div style="margin-bottom:12px;"><strong>Affected Assemblies:</strong> ${escapeHtml(eco.affected_assemblies)}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;">
            ${eco.status === 'draft' ? `<button class="btn btn-primary" onclick="updateEcoStatus('${ecoId}','submitted')">Submit for Review</button>` : ''}
            ${eco.status === 'submitted' || eco.status === 'in_review' ? `
                <button class="btn btn-primary" onclick="updateEcoStatus('${ecoId}','approved')">Approve</button>
                <button class="btn" style="background:var(--danger-color);color:#fff;" onclick="updateEcoStatus('${ecoId}','rejected')">Reject</button>
            ` : ''}
            ${eco.status === 'approved' ? `<button class="btn btn-primary" onclick="updateEcoStatus('${ecoId}','implemented')">Mark Implemented</button>` : ''}
            <button class="btn" style="background:var(--danger-color);color:#fff;" onclick="deleteECO('${ecoId}')">Delete</button>
        </div>
    `;
    
    // Load comments
    await loadEcoComments(ecoId);
    openModal('ecoDetailModal');
}

async function updateEcoStatus(ecoId, status) {
    try {
        await apiRequest(`/ecos/${ecoId}`, { method: 'PUT', body: JSON.stringify({ status }) });
        showSuccess(`ECO ${status}`);
        closeModal('ecoDetailModal');
        await loadECOs();
    } catch (error) {
        showError('Failed to update ECO: ' + error.message);
    }
}

async function deleteECO(ecoId) {
    if (!confirm('Delete this ECO?')) return;
    try {
        await apiRequest(`/ecos/${ecoId}`, { method: 'DELETE' });
        showSuccess('ECO deleted');
        closeModal('ecoDetailModal');
        await loadECOs();
    } catch (error) {
        showError('Failed to delete ECO: ' + error.message);
    }
}

async function loadEcoComments(ecoId) {
    try {
        const comments = await apiRequest(`/comments/eco/${ecoId}`, { method: 'GET' });
        const container = document.getElementById('ecoCommentsList');
        container.innerHTML = comments.length ? comments.map(c => `
            <div class="comment-item">
                <div class="comment-header">
                    <span class="comment-user">${escapeHtml(c.username)}</span>
                    <span>${formatToIST(c.created_at)}</span>
                </div>
                <div>${escapeHtml(c.message)}</div>
            </div>
        `).join('') : '<div style="padding:8px;color:var(--text-muted);">No comments yet</div>';
    } catch (e) { /* silent */ }
}

async function addEcoComment() {
    const input = document.getElementById('ecoCommentInput');
    const message = input.value.trim();
    if (!message || !selectedEcoId) return;
    try {
        await apiRequest(`/comments/eco/${selectedEcoId}`, { method: 'POST', body: JSON.stringify({ message }) });
        input.value = '';
        await loadEcoComments(selectedEcoId);
    } catch (error) {
        showError('Failed to add comment: ' + error.message);
    }
}