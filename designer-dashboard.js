// Designer Dashboard with API Integration
let currentUser = null;
let currentDesigns = [];
let selectedDesignId = null;
let currentProjects = [];
let partsCache = [];
let assembliesCache = [];
let selectedPartId = null;
let selectedAssemblyId = null;
let pendingEditPartId = null;
let pendingRelease = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('authToken');
    const userData = localStorage.getItem('currentUser');
    
    if (!token || !userData) {
        showError('Not authorized. Redirecting to login...');
        window.location.href = 'index.html';
        return;
    }

    try {
        currentUser = JSON.parse(userData);
        document.getElementById('username').textContent = currentUser.username || 'Designer';
        populateProfileFields();
        setHierarchyFlow(currentUser.role || 'designer');
        
        if (typeof initCommonUI === 'function') initCommonUI();
        setupMenuListeners();
        setupPasswordToggle();
        await loadProjects();
        await loadDesigns();
    } catch (error) {
        console.error('Initialization error:', error);
        showError('Error loading dashboard');
    }
});

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
                projects: 'My Projects',
                designs: 'My Designs',
                tasks: 'My Tasks',
                submissions: 'My Submissions',
                vault: 'Vault',
                profile: 'My Profile'
            };
            document.getElementById('page-title').textContent = titles[menuType] || 'Dashboard';

            if (menuType === 'vault') {
                loadVault();
            }
        });
    });
}

// setHierarchyFlow, setupPasswordToggle are now in api.js

// Show/hide sections
function showSection(sectionId) {
    document.querySelectorAll('.content-section').forEach(section => {
        section.style.display = 'none';
    });
    document.getElementById(sectionId + '-section').style.display = 'block';
}

function populateProfileFields() {
    const userIdInput = document.getElementById('profileUserId');
    const fullNameInput = document.getElementById('profileFullName');
    const emailInput = document.getElementById('profileEmail');
    const specializationInput = document.getElementById('profileSpecialization');

    if (!currentUser || !userIdInput || !fullNameInput || !emailInput || !specializationInput) {
        return;
    }

    userIdInput.value = currentUser.id || '';
    fullNameInput.value = currentUser.full_name || currentUser.username || '';
    emailInput.value = currentUser.email || '';
    specializationInput.value = currentUser.specialization || '';
}

async function loadVault() {
    await Promise.all([loadParts(), loadAssemblies()]);
}

async function loadParts() {
    try {
        const parts = await apiRequest('/parts', { method: 'GET' });
        partsCache = parts || [];
        renderDesignerPartsTable(partsCache);
    } catch (error) {
        showError('Failed to load parts: ' + error.message);
    }
}

function renderDesignerPartsTable(parts) {
    const tbody = document.getElementById('designerPartsTable');
    if (!parts.length) {
        tbody.innerHTML = '<tr><td colspan="8">No parts found</td></tr>';
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
            <td>${part.owner_name || part.owner_id}</td>
            <td>${part.version_count || 0}</td>
            <td><span class="status-badge ${statusClass}">${part.latest_version || '-'} (${part.latest_status || '-'})</span></td>
            <td class="actions">
                <button class="btn-icon" title="Versions" onclick="openDesignerPartVersions('${part.id}')">📄</button>
                <button class="btn-icon" title="Edit Request" onclick="openEditRequest('${part.id}')">✍️</button>
            </td>
        </tr>`;
    }).join('');
}

function filterDesignerParts() {
    const search = (document.getElementById('designerPartSearch')?.value || '').toLowerCase();
    const crit = document.getElementById('designerPartCriticality')?.value || '';
    const filtered = partsCache.filter(p => {
        const matchSearch = !search || p.part_code.toLowerCase().includes(search) || p.name.toLowerCase().includes(search) || (p.material || '').toLowerCase().includes(search);
        const matchCrit = !crit || p.criticality === crit;
        return matchSearch && matchCrit;
    });
    renderDesignerPartsTable(filtered);
}

async function loadAssemblies() {
    try {
        const assemblies = await apiRequest('/assemblies', { method: 'GET' });
        assembliesCache = assemblies || [];
        renderDesignerAssembliesTable(assembliesCache);
    } catch (error) {
        showError('Failed to load assemblies: ' + error.message);
    }
}

function renderDesignerAssembliesTable(assemblies) {
    const tbody = document.getElementById('designerAssembliesTable');
    if (!assemblies.length) {
        tbody.innerHTML = '<tr><td colspan="7">No assemblies found</td></tr>';
        return;
    }
    tbody.innerHTML = assemblies.map(a => {
        const critClass = a.criticality === 'critical' ? 'danger' : a.criticality === 'high' ? 'review' : 'active';
        const statusClass = a.latest_status === 'frozen' ? 'approved' : 'review';
        return `<tr>
            <td><strong>${a.assembly_code}</strong></td>
            <td>${a.name}</td>
            <td><span class="status-badge ${critClass}">${a.criticality || 'normal'}</span></td>
            <td>${a.owner_name || a.owner_id}</td>
            <td>${a.version_count || 0}</td>
            <td><span class="status-badge ${statusClass}">${a.latest_version || '-'} (${a.latest_status || '-'})</span></td>
            <td class="actions">
                <button class="btn-icon" title="Versions" onclick="openDesignerAssemblyVersions('${a.id}')">📄</button>
            </td>
        </tr>`;
    }).join('');
}

function filterDesignerAssemblies() {
    const search = (document.getElementById('designerAssemblySearch')?.value || '').toLowerCase();
    const crit = document.getElementById('designerAssemblyCriticality')?.value || '';
    const filtered = assembliesCache.filter(a => {
        const matchSearch = !search || a.assembly_code.toLowerCase().includes(search) || a.name.toLowerCase().includes(search);
        const matchCrit = !crit || a.criticality === crit;
        return matchSearch && matchCrit;
    });
    renderDesignerAssembliesTable(filtered);
}

function openDesignerPartVersions(partId) {
    const part = partsCache.find((item) => String(item.id) === String(partId));
    if (!part) {
        showError('Part not found');
        return;
    }

    selectedPartId = partId;
    document.getElementById('designerPartVersionsTitle').textContent = `${part.part_code} - ${part.name}`;
    const metaBar = document.getElementById('designerPartMetaBar');
    if (metaBar) {
        metaBar.innerHTML = `<span><strong>Material:</strong> ${part.material || '-'}</span>
            <span><strong>Vendor:</strong> ${part.vendor || '-'}</span>
            <span><strong>Criticality:</strong> ${part.criticality || 'normal'}</span>
            <span><strong>Tags:</strong> ${part.tags || '-'}</span>`;
    }
    openModal('designerPartVersionsModal');
    loadDesignerPartVersions();
}

async function loadDesignerPartVersions() {
    if (!selectedPartId) return;
    try {
        const versions = await apiRequest(`/parts/${selectedPartId}/versions`, { method: 'GET' });
        const tbody = document.getElementById('designerPartVersionsTable');

        if (!versions.length) {
            tbody.innerHTML = '<tr><td colspan="6">No versions found</td></tr>';
            return;
        }

        tbody.innerHTML = versions.map((version) => `
            <tr>
                <td>${version.id}</td>
                <td>${version.version_label}</td>
                <td><span class="status-badge ${version.status === 'frozen' ? 'approved' : 'review'}">${version.status}</span></td>
                <td>${version.change_notes || '-'}</td>
                <td>${version.frozen_by_name || '-'}</td>
                <td class="actions">
                    <button class="btn-icon" title="Release Request" onclick="openReleaseRequest('part', '${version.id}')">🚀</button>
                    <button class="btn-icon" title="Impact" onclick="showDesignerPartImpact('${selectedPartId}')">🔗</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        showError('Failed to load part versions: ' + error.message);
    }
}

function openDesignerAssemblyVersions(assemblyId) {
    const assembly = assembliesCache.find((item) => String(item.id) === String(assemblyId));
    if (!assembly) {
        showError('Assembly not found');
        return;
    }

    selectedAssemblyId = assemblyId;
    document.getElementById('designerAssemblyVersionsTitle').textContent = `${assembly.assembly_code} - ${assembly.name}`;
    const metaBar = document.getElementById('designerAssemblyMetaBar');
    if (metaBar) {
        metaBar.innerHTML = `<span><strong>Criticality:</strong> ${assembly.criticality || 'normal'}</span>
            <span><strong>Tags:</strong> ${assembly.tags || '-'}</span>`;
    }
    openModal('designerAssemblyVersionsModal');
    loadDesignerAssemblyVersions();
}

async function loadDesignerAssemblyVersions() {
    if (!selectedAssemblyId) return;
    try {
        const versions = await apiRequest(`/assemblies/${selectedAssemblyId}/versions`, { method: 'GET' });
        const tbody = document.getElementById('designerAssemblyVersionsTable');

        if (!versions.length) {
            tbody.innerHTML = '<tr><td colspan="5">No versions found</td></tr>';
            return;
        }

        tbody.innerHTML = versions.map((version) => `
            <tr>
                <td>${version.id}</td>
                <td>${version.version_label}</td>
                <td><span class="status-badge ${version.status === 'frozen' ? 'approved' : 'review'}">${version.status}</span></td>
                <td>${version.frozen_by_name || '-'}</td>
                <td class="actions">
                    <button class="btn-icon" title="BOM" onclick="showDesignerBOM('${selectedAssemblyId}', '${version.id}')">📋</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        showError('Failed to load assembly versions: ' + error.message);
    }
}

async function showDesignerPartImpact(partId) {
    try {
        const data = await apiRequest(`/parts/${partId}/impact`, { method: 'GET' });
        const tbody = document.getElementById('designerImpactTable');
        if (!data.assemblies || !data.assemblies.length) {
            tbody.innerHTML = '<tr><td colspan="3">No assemblies reference this part</td></tr>';
        } else {
            tbody.innerHTML = data.assemblies.map(a => `<tr>
                <td>${a.assembly_code}</td>
                <td>${a.name}</td>
                <td>${a.version_label}</td>
            </tr>`).join('');
        }
        openModal('designerImpactModal');
    } catch (error) {
        showError('Failed to load impact analysis: ' + error.message);
    }
}

async function showDesignerBOM(assemblyId, versionId) {
    try {
        const data = await apiRequest(`/assemblies/${assemblyId}/versions/${versionId}/bom`, { method: 'GET' });
        const tbody = document.getElementById('designerBomTable');
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
        openModal('designerBomModal');
    } catch (error) {
        showError('Failed to load BOM: ' + error.message);
    }
}

function openEditRequest(partId) {
    pendingEditPartId = partId;
    document.getElementById('editRequestReason').value = '';
    openModal('requestEditModal');
}

async function submitEditRequest() {
    if (!pendingEditPartId) return;
    const reason = document.getElementById('editRequestReason').value.trim();

    try {
        await apiRequest(`/parts/${pendingEditPartId}/edit-requests`, {
            method: 'POST',
            body: JSON.stringify({ reason })
        });
        showSuccess('Edit request submitted');
        closeModal('requestEditModal');
    } catch (error) {
        showError('Failed to submit edit request: ' + error.message);
    }
}

function openReleaseRequest(itemType, versionId) {
    pendingRelease = { itemType, versionId };
    document.getElementById('releaseRequestReason').value = '';
    openModal('requestReleaseModal');
}

async function submitReleaseRequest() {
    if (!pendingRelease) return;
    const reason = document.getElementById('releaseRequestReason').value.trim();

    try {
        await apiRequest('/release-requests', {
            method: 'POST',
            body: JSON.stringify({
                item_type: pendingRelease.itemType,
                item_version_id: Number(pendingRelease.versionId),
                reason
            })
        });
        showSuccess('Release request submitted');
        closeModal('requestReleaseModal');
    } catch (error) {
        showError('Failed to submit release request: ' + error.message);
    }
}

// ============= DESIGNS API FUNCTIONS =============

// Load projects for dropdown AND display project cards
async function loadProjects() {
    try {
        currentProjects = await getProjects();
        populateProjectDropdowns();
        displayProjectCards(currentProjects);
    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

function getStatusLabel(status) {
    const map = {
        'active': 'Active',
        'inprogress': 'In Progress',
        'completed': 'Completed',
        'inactive': 'Inactive'
    };
    return map[status] || status;
}

function getStatusBadgeClass(status) {
    const map = {
        'active': 'active',
        'inprogress': 'inprogress',
        'completed': 'completed',
        'inactive': 'inactive'
    };
    return map[status] || 'active';
}

function displayProjectCards(projects) {
    const grid = document.getElementById('projectsGrid');
    if (!grid) return;

    if (!projects || projects.length === 0) {
        grid.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">No projects assigned yet.</p>';
        return;
    }

    grid.innerHTML = projects.map(project => {
        const progress = project.progress || 0;
        const deadline = project.deadline || 'N/A';
        const manager = project.owner_name || project.manager || project.owner_id;
        const statusLabel = getStatusLabel(project.status);
        const badgeClass = getStatusBadgeClass(project.status);

        return `
            <div class="project-card">
                <div class="card-header">
                    <h4>${project.name}</h4>
                    <span class="status-badge ${badgeClass}">${statusLabel}</span>
                </div>
                <div class="card-body">
                    <p><strong>PLM ID:</strong> ${project.plm_id}</p>
                    <p><strong>Manager:</strong> ${manager}</p>
                    <p><strong>Deadline:</strong> ${deadline}</p>
                    <p><strong>Progress:</strong> ${progress}%</p>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progress}%"></div>
                    </div>
                </div>
                <div class="card-actions">
                    <button class="btn btn-small" onclick="viewProject(${project.id})">View Details</button>
                    <button class="btn btn-small btn-primary" onclick="updateProgress(${project.id})">Update Progress</button>
                </div>
            </div>
        `;
    }).join('');
}

function populateProjectDropdowns() {
    const selects = ['designProject', 'designFilter'];
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            const currentValue = select.value;
            select.innerHTML = '<option value="">Select Project</option>';
            currentProjects.forEach(project => {
                const option = document.createElement('option');
                option.value = project.id;
                option.textContent = project.name;
                select.appendChild(option);
            });
            select.value = currentValue;
        }
    });
}

// Load designs from API
async function loadDesigns() {
    try {
        const submissions = await getSubmissions();
        
        // Filter to get only user's submissions (which are designs)
        currentDesigns = submissions.filter(s => s.designer_id === currentUser.id);
        displayDesigns(currentDesigns);
        updateDesignDropdowns();
    } catch (error) {
        console.error('Error loading designs:', error);
        showError('Failed to load designs');
    }
}

function displayDesigns(designs) {
    const tbody = document.getElementById('designsTable');
    
    if (!designs || designs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">No designs created yet. Click "Create Design" to start.</td></tr>';
        return;
    }

    tbody.innerHTML = designs.map(design => `
        <tr>
            <td><strong>${design.submission_type || 'Unnamed'}</strong></td>
            <td>${design.project_id || 'N/A'}</td>
            <td>
                <span class="status-badge ${getStatusClass(design.status)}">
                    ${design.status ? design.status.charAt(0).toUpperCase() + design.status.slice(1) : 'Draft'}
                </span>
            </td>
            <td>
                <span class="task-priority ${design.priority || 'medium'}">${design.priority ? design.priority.toUpperCase() : 'MEDIUM'}</span>
            </td>
            <td>${new Date(design.created_at).toLocaleDateString()}</td>
            <td>${new Date(design.created_at).toLocaleDateString()}</td>
            <td class="actions">
                <button class="btn-icon" onclick="viewDesignDetails(${design.id})" title="View">👁️</button>
                <button class="btn-icon" onclick="submitDesignFlow(${design.id})" title="Submit">📤</button>
                <button class="btn-icon" onclick="deleteDesignConfirm(${design.id})" title="Delete">🗑️</button>
            </td>
        </tr>
    `).join('');
}

function getStatusClass(status) {
    const statusMap = {
        'draft': 'assigned',
        'inprogress': 'inprogress',
        'submitted': 'review',
        'approved': 'completed',
        'rejected': 'rejected'
    };
    return statusMap[status] || 'assigned';
}

function updateDesignDropdowns() {
    const select = document.getElementById('submitDesignSelect');
    if (select) {
        select.innerHTML = '<option value="">Select Design</option>';
        currentDesigns.forEach(design => {
            const option = document.createElement('option');
            option.value = design.id;
            option.textContent = `${design.submission_type} (${design.status || 'Draft'})`;
            select.appendChild(option);
        });
    }
}

// Create Design
function openCreateDesignModal() {
    document.getElementById('createDesignModal').classList.add('open');
}

async function createDesign(event) {
    event.preventDefault();
    
    const designName = document.getElementById('designName').value.trim();
    const projectId = document.getElementById('designProject').value;
    const description = document.getElementById('designDescription').value.trim();
    const priority = document.getElementById('designPriority').value;

    if (!designName) {
        showError('Please enter a design name');
        return;
    }

    if (!projectId) {
        showError('Please select a project');
        return;
    }

    try {
        const result = await submitWork(projectId, designName, description);
        showSuccess('Design created successfully!');
        closeModal('createDesignModal');
        document.querySelector('#createDesignModal form').reset();
        await loadDesigns();
    } catch (error) {
        showError('Error creating design: ' + error.message);
    }
}

// Submit Design for Review
function openSubmitDesignModal() {
    document.getElementById('submitDesignModal').classList.add('open');
}

function submitDesignFlow(designId) {
    selectedDesignId = designId;
    document.getElementById('submitDesignSelect').value = designId;
    document.getElementById('submitDesignModal').classList.add('open');
}

async function submitDesign(event) {
    event.preventDefault();
    
    const designId = document.getElementById('submitDesignSelect').value;
    const submissionType = document.getElementById('submissionType').value;
    const comments = document.getElementById('submissionComments').value.trim();

    if (!designId) {
        showError('Please select a design');
        return;
    }

    if (!submissionType) {
        showError('Please select submission type');
        return;
    }

    try {
        const result = await submitApprovalDecision(designId, 'submitted', comments);
        showSuccess('Design submitted for review! Waiting for approver feedback.');
        closeModal('submitDesignModal');
        document.querySelector('#submitDesignModal form').reset();
        await loadDesigns();
    } catch (error) {
        showError('Error submitting design: ' + error.message);
    }
}

// View Design Details
function viewDesignDetails(designId) {
    const design = currentDesigns.find(d => d.id === designId);
    if (!design) {
        showError('Design not found');
        return;
    }

    selectedDesignId = designId;
    
    const statusText = design.status ? design.status.charAt(0).toUpperCase() + design.status.slice(1) : 'Draft';
    const statusClass = getStatusClass(design.status);

    const detailsHtml = `
        <div class="design-details">
            <div class="detail-row">
                <label>Design Type:</label>
                <span>${design.submission_type || 'Unnamed'}</span>
            </div>
            <div class="detail-row">
                <label>Project ID:</label>
                <span>${design.project_id || 'N/A'}</span>
            </div>
            <div class="detail-row">
                <label>Status:</label>
                <span><span class="status-badge ${statusClass}">${statusText}</span></span>
            </div>
            <div class="detail-row">
                <label>Created Date:</label>
                <span>${formatToIST(design.created_at)}</span>
            </div>
            <div class="detail-row">
                <label>Comments:</label>
                <span>${design.comments || 'No comments'}</span>
            </div>
            <div class="detail-row">
                <label>File Path:</label>
                <span>${design.file_path || 'No file attached'}</span>
            </div>
        </div>
    `;

    document.getElementById('designDetailsContent').innerHTML = detailsHtml;
    document.getElementById('detailsModalTitle').textContent = `Design: ${design.submission_type}`;
    document.getElementById('designDetailsModal').classList.add('open');
}

// Delete Design
function openDesignSubmitFlow() {
    closeModal('designDetailsModal');
    submitDesignFlow(selectedDesignId);
}

async function deleteDesignConfirm(designId) {
    if (confirm('Are you sure you want to delete this design? This action cannot be undone.')) {
        await deleteDesign(designId);
    }
}

async function deleteCurrentDesign() {
    if (selectedDesignId) {
        if (confirm('Are you sure you want to delete this design? This action cannot be undone.')) {
            await deleteDesign(selectedDesignId);
            closeModal('designDetailsModal');
        }
    }
}

async function deleteDesign(designId) {
    try {
        const result = await apiRequest(`/submissions/${designId}`, { method: 'DELETE' });
        showSuccess('Design deleted successfully!');
        await loadDesigns();
    } catch (error) {
        showError('Error deleting design: ' + error.message);
    }
}

// openModal, closeModal, handleChangePassword, logout are now in api.js

// ============= UTILITY FUNCTIONS =============
// showError/showSuccess delegate to api.js showToast

// ============= EXISTING FUNCTIONS (KEPT FOR COMPATIBILITY) =============

// Project functions
function viewProject(id) {
    const project = currentProjects.find(p => p.id === id);
    if (!project) { showError('Project not found'); return; }

    const progress = project.progress || 0;
    const deadline = project.deadline || 'N/A';
    const manager = project.owner_name || project.manager || project.owner_id;

    showSuccess(
        `Project: ${project.name}\n` +
        `PLM ID: ${project.plm_id}\n` +
        `Manager: ${manager}\n` +
        `Status: ${project.status}\n` +
        `Progress: ${progress}%\n` +
        `Deadline: ${deadline}`
    );
}

let pendingProgressProjectId = null;

function updateProgress(id) {
    const project = currentProjects.find(p => p.id === id);
    if (!project) { showError('Project not found'); return; }

    pendingProgressProjectId = id;
    const progress = project.progress || 0;

    document.getElementById('progressProjectInfo').innerHTML =
        `<p><strong>${project.name}</strong> (${project.plm_id})</p>`;
    document.getElementById('progressSlider').value = progress;
    document.getElementById('progressValue').textContent = progress + '%';
    document.getElementById('progressStatus').value = project.status || 'active';

    openModal('updateProgressModal');
}

async function saveProgress() {
    if (!pendingProgressProjectId) return;

    const progress = parseInt(document.getElementById('progressSlider').value) || 0;
    const status = document.getElementById('progressStatus').value;

    try {
        await apiRequest(`/projects/${pendingProgressProjectId}`, {
            method: 'PUT',
            body: JSON.stringify({ progress, status })
        });
        showSuccess('Progress updated successfully!');
        closeModal('updateProgressModal');
        pendingProgressProjectId = null;
        await loadProjects();
    } catch (error) {
        showError('Failed to update progress: ' + error.message);
    }
}

// Task functions
function completeTask(id) {
    apiRequest(`/tasks/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'completed' })
    }).then(() => {
        showSuccess('Task marked as completed!');
        if (typeof loadTasks === 'function') loadTasks();
    }).catch(err => {
        showError('Failed to complete task: ' + err.message);
    });
}

// Submission functions
function openSubmitModal() {
    document.getElementById('submitModal').classList.add('open');
}

function viewSubmission(id) {
    showSuccess('Viewing submission: ' + id);
}

// Profile functions
function saveProfile() {
    const emailInput = document.getElementById('profileEmail');
    const newEmail = emailInput ? emailInput.value.trim() : '';
    if (!newEmail) {
        showError('Email cannot be empty');
        return;
    }
    // Use existing updateEmail function from api.js
    const password = prompt('Enter your password to confirm email change:');
    if (!password) return;
    updateEmail(newEmail, password).then(() => {
        showSuccess('Profile updated successfully!');
    }).catch(err => {
        showError('Failed to update profile: ' + err.message);
    });
}

// Search and filter functions
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    const statusFilter = document.getElementById('statusFilter');
    
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterProjects(e.target.value);
        });
    }
    
    if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
            filterByStatus(e.target.value);
        });
    }
});

function filterProjects(searchTerm) {
    const cards = document.querySelectorAll('.project-card');
    cards.forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(searchTerm.toLowerCase()) ? '' : 'none';
    });
}

function filterByStatus(status) {
    const cards = document.querySelectorAll('.project-card');
    if (!status) {
        cards.forEach(card => card.style.display = '');
        return;
    }
    
    cards.forEach(card => {
        const statusBadge = card.querySelector('.status-badge');
        if (statusBadge && statusBadge.classList.contains(status)) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
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
