// Approver Dashboard with Full API Integration
let currentUser = null;
let currentApprovals = [];
let selectedSubmissionId = null;
let partsCache = [];
let assembliesCache = [];
let selectedPartId = null;
let selectedAssemblyId = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    const token = getToken();
    const user = getCurrentUser();
    
    if (!token || !user || user.role !== 'approver') {
        window.location.href = 'index.html';
        return;
    }
    
    currentUser = user;
    document.getElementById('username').textContent = currentUser.username || 'Approver';
    setHierarchyFlow(currentUser.role || 'approver');
    
    if (typeof initCommonUI === 'function') initCommonUI();
    setupMenuListeners();
    setupPasswordToggle();
    
    // Load pending approvals on page load
    await loadPendingApprovals();
});

// setHierarchyFlow, setupPasswordToggle are now in api.js

// Load pending approvals from API
async function loadPendingApprovals() {
    try {
        const approvals = await getPendingApprovals();
        currentApprovals = approvals;
        displayApprovals(approvals);
    } catch (error) {
        console.error('Error loading approvals:', error);
        showError('Failed to load submissions for approval');
        document.getElementById('approvalsContainer').innerHTML = '<p style="color: red; text-align: center;">Error loading submissions</p>';
    }
}

// Display approvals as cards
function displayApprovals(approvals) {
    const container = document.getElementById('approvalsContainer');
    
    if (!approvals || approvals.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">✅ No pending approvals</p>';
        return;
    }
    
    container.innerHTML = approvals.map(approval => `
        <div class="approval-card" data-id="${approval.id}">
            <div class="card-header">
                <h4>${escapeHtml(approval.submission_type || 'Design')} - ${escapeHtml(approval.project_id)}</h4>
                <span class="status-badge review">Pending Review</span>
            </div>
            <div class="card-body">
                <p><strong>Submitted by:</strong> ${escapeHtml(approval.designer_id || 'Unknown')}</p>
                <p><strong>Project:</strong> ${escapeHtml(approval.project_id || 'N/A')}</p>
                <p><strong>Submitted on:</strong> ${formatToIST(approval.created_at)}</p>
                <p><strong>Type:</strong> ${escapeHtml(approval.submission_type || 'Design')}</p>
                ${approval.comments ? `<p><strong>Comments:</strong> ${escapeHtml(approval.comments)}</p>` : ''}
            </div>
            <div class="card-footer">
                <a href="#" class="link-btn" onclick="viewSubmissionDetails(${approval.id}); return false;">View Details →</a>
            </div>
            <div class="approval-actions">
                <button class="btn btn-success" onclick="quickApprove(${approval.id})">✓ Approve</button>
                <button class="btn btn-danger" onclick="quickReject(${approval.id})">✗ Reject</button>
                <button class="btn btn-secondary" onclick="openReviewModal(${approval.id})">💬 Review</button>
            </div>
        </div>
    `).join('');
}

// View submission details in modal
function viewSubmissionDetails(submissionId) {
    const submission = currentApprovals.find(a => a.id === submissionId);
    if (!submission) return;
    
    selectedSubmissionId = submissionId;
    
    // Populate details modal
    document.getElementById('viewDesigner').textContent = submission.designer_id || 'Unknown';
    document.getElementById('viewProject').textContent = submission.project_id || 'N/A';
    document.getElementById('viewType').textContent = submission.submission_type || 'Design';
    document.getElementById('viewStatus').innerHTML = `<span class="status-badge review">Pending Review</span>`;
    document.getElementById('viewDate').textContent = formatToIST(submission.created_at);
    document.getElementById('viewDescription').textContent = submission.comments || 'No description provided';
    
    // Load comments
    loadComments(submissionId);
    
    openModal('detailsModal');
}

// Load comments for a submission
function loadComments(submissionId) {
    const commentsSection = document.getElementById('commentsSection');
    
    // Check if there are any feedback/comments in the submission
    const submission = currentApprovals.find(a => a.id === submissionId);
    
    if (submission && submission.comments) {
        commentsSection.innerHTML = `
            <div class="comment" style="padding: 15px; background: rgba(0,123,255,0.1); border-radius: 8px; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                    <strong>Designer Comment</strong>
                    <span style="color: #999; font-size: 12px;">${formatToIST(submission.created_at)}</span>
                </div>
                <p>${escapeHtml(submission.comments)}</p>
            </div>
        `;
    } else {
        commentsSection.innerHTML = '<p style="color: #999; text-align: center;">No comments yet...</p>';
    }
}

// Open review modal with submission details
function openReviewModal(submissionId) {
    const submission = currentApprovals.find(a => a.id === submissionId);
    if (!submission) return;
    
    selectedSubmissionId = submissionId;
    // Populate approval modal with submission details
    document.getElementById('detailDesigner').textContent = submission.designer_id || 'Unknown';
    document.getElementById('detailProject').textContent = submission.project_id || 'N/A';
    document.getElementById('detailType').textContent = submission.submission_type || 'Design';
    document.getElementById('detailDate').textContent = formatToIST(submission.created_at);
    
    // Reset form
    document.getElementById('approvalForm').reset();
    
    openModal('approvalModal');
}

// Open approval modal (called from details modal)
function openApprovalModal() {
    if (!selectedSubmissionId) return;
    const submission = currentApprovals.find(a => a.id === selectedSubmissionId);
    if (!submission) return;
    
    document.getElementById('detailDesigner').textContent = submission.designer_id || 'Unknown';
    document.getElementById('detailProject').textContent = submission.project_id || 'N/A';
    document.getElementById('detailType').textContent = submission.submission_type || 'Design';
    document.getElementById('detailDate').textContent = formatToIST(submission.created_at);
    
    document.getElementById('approvalForm').reset();
    openModal('approvalModal');
}

// Quick approve button
async function quickApprove(submissionId) {
    if (confirm('Are you sure you want to approve this submission?')) {
        try {
            await submitApprovalDecision(submissionId, 'approved', 'Approved');
            showSuccess('Submission approved successfully!');
            await loadPendingApprovals();
        } catch (error) {
            showError('Error approving submission: ' + error.message);
        }
    }
}

// Quick reject button
async function quickReject(submissionId) {
    const feedback = prompt('Please provide feedback for rejection:');
    if (feedback === null) return;
    
    if (!feedback.trim()) {
        showError('Feedback is required for rejection');
        return;
    }
    
    try {
        await submitApprovalDecision(submissionId, 'rejected', feedback);
        showSuccess('Submission rejected');
        await loadPendingApprovals();
    } catch (error) {
        showError('Error rejecting submission: ' + error.message);
    }
}

// Submit decision with comments
async function submitDecision(event) {
    event.preventDefault();
    
    if (!selectedSubmissionId) {
        showError('No submission selected');
        return;
    }
    
    const decision = document.getElementById('decision').value;
    const feedback = document.getElementById('feedbackText').value.trim();
    
    if (!decision || !feedback) {
        showError('Please select a decision and provide feedback');
        return;
    }
    
    try {
        await submitApprovalDecision(selectedSubmissionId, decision, feedback);
        
        closeModal('approvalModal');
        closeModal('detailsModal');
        showSuccess('Decision submitted successfully!');
        
        await loadPendingApprovals();
    } catch (error) {
        showError('Error submitting decision: ' + error.message);
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
                approvals: 'Pending Approvals',
                projects: 'Projects',
                submissions: 'All Submissions',
                vault: 'Vault',
                requests: 'Requests',
                feedback: 'Feedback & Comments'
            };
            document.getElementById('page-title').textContent = titles[menuType] || 'Dashboard';
            
            // Load data when switching to approvals
            if (menuType === 'approvals') {
                loadPendingApprovals();
            } else if (menuType === 'vault') {
                loadVault();
            } else if (menuType === 'requests') {
                loadRequests();
            }
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

// openModal, closeModal are now in api.js

async function loadVault() {
    await Promise.all([loadParts(), loadAssemblies()]);
}

async function loadParts() {
    try {
        const parts = await apiRequest('/parts', { method: 'GET' });
        partsCache = parts || [];
        renderApproverPartsTable(partsCache);
    } catch (error) {
        showError('Failed to load parts: ' + error.message);
    }
}

function renderApproverPartsTable(parts) {
    const tbody = document.getElementById('approverPartsTable');
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
                <button class="btn-icon" title="Versions" onclick="openApproverPartVersions('${part.id}')">📄</button>
            </td>
        </tr>`;
    }).join('');
}

function filterApproverParts() {
    const search = (document.getElementById('approverPartSearch')?.value || '').toLowerCase();
    const crit = document.getElementById('approverPartCriticality')?.value || '';
    const filtered = partsCache.filter(p => {
        const matchSearch = !search || p.part_code.toLowerCase().includes(search) || p.name.toLowerCase().includes(search) || (p.material || '').toLowerCase().includes(search);
        const matchCrit = !crit || p.criticality === crit;
        return matchSearch && matchCrit;
    });
    renderApproverPartsTable(filtered);
}

async function loadAssemblies() {
    try {
        const assemblies = await apiRequest('/assemblies', { method: 'GET' });
        assembliesCache = assemblies || [];
        renderApproverAssembliesTable(assembliesCache);
    } catch (error) {
        showError('Failed to load assemblies: ' + error.message);
    }
}

function renderApproverAssembliesTable(assemblies) {
    const tbody = document.getElementById('approverAssembliesTable');
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
                <button class="btn-icon" title="Versions" onclick="openApproverAssemblyVersions('${a.id}')">📄</button>
            </td>
        </tr>`;
    }).join('');
}

function filterApproverAssemblies() {
    const search = (document.getElementById('approverAssemblySearch')?.value || '').toLowerCase();
    const crit = document.getElementById('approverAssemblyCriticality')?.value || '';
    const filtered = assembliesCache.filter(a => {
        const matchSearch = !search || a.assembly_code.toLowerCase().includes(search) || a.name.toLowerCase().includes(search);
        const matchCrit = !crit || a.criticality === crit;
        return matchSearch && matchCrit;
    });
    renderApproverAssembliesTable(filtered);
}

function openApproverPartVersions(partId) {
    const part = partsCache.find((item) => String(item.id) === String(partId));
    if (!part) {
        showError('Part not found');
        return;
    }

    selectedPartId = partId;
    document.getElementById('approverPartVersionsTitle').textContent = `${part.part_code} - ${part.name}`;
    const metaBar = document.getElementById('approverPartMetaBar');
    if (metaBar) {
        metaBar.innerHTML = `<span><strong>Material:</strong> ${part.material || '-'}</span>
            <span><strong>Vendor:</strong> ${part.vendor || '-'}</span>
            <span><strong>Criticality:</strong> ${part.criticality || 'normal'}</span>
            <span><strong>Tags:</strong> ${part.tags || '-'}</span>`;
    }
    openModal('approverPartVersionsModal');
    loadApproverPartVersions();
}

async function loadApproverPartVersions() {
    if (!selectedPartId) return;
    try {
        const versions = await apiRequest(`/parts/${selectedPartId}/versions`, { method: 'GET' });
        const tbody = document.getElementById('approverPartVersionsTable');

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
                    ${version.status !== 'frozen' ? `<button class="btn-icon" title="Freeze" onclick="freezePartVersion('${version.id}')">❄️</button>` : ''}
                    <button class="btn-icon" title="Impact" onclick="showApproverPartImpact('${selectedPartId}')">🔗</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        showError('Failed to load part versions: ' + error.message);
    }
}

async function freezePartVersion(versionId) {
    try {
        await apiRequest(`/parts/${selectedPartId}/versions/${versionId}/freeze`, {
            method: 'POST',
            body: JSON.stringify({})
        });
        showSuccess('Part version frozen');
        await loadApproverPartVersions();
    } catch (error) {
        showError('Failed to freeze part version: ' + error.message);
    }
}

function openApproverAssemblyVersions(assemblyId) {
    const assembly = assembliesCache.find((item) => String(item.id) === String(assemblyId));
    if (!assembly) {
        showError('Assembly not found');
        return;
    }

    selectedAssemblyId = assemblyId;
    document.getElementById('approverAssemblyVersionsTitle').textContent = `${assembly.assembly_code} - ${assembly.name}`;
    const metaBar = document.getElementById('approverAssemblyMetaBar');
    if (metaBar) {
        metaBar.innerHTML = `<span><strong>Criticality:</strong> ${assembly.criticality || 'normal'}</span>
            <span><strong>Tags:</strong> ${assembly.tags || '-'}</span>`;
    }
    openModal('approverAssemblyVersionsModal');
    loadApproverAssemblyVersions();
}

async function loadApproverAssemblyVersions() {
    if (!selectedAssemblyId) return;
    try {
        const versions = await apiRequest(`/assemblies/${selectedAssemblyId}/versions`, { method: 'GET' });
        const tbody = document.getElementById('approverAssemblyVersionsTable');

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
                    ${version.status !== 'frozen' ? `<button class="btn-icon" title="Freeze" onclick="freezeAssemblyVersion('${version.id}')">❄️</button>` : ''}
                    <button class="btn-icon" title="BOM" onclick="showApproverBOM('${selectedAssemblyId}', '${version.id}')">📋</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        showError('Failed to load assembly versions: ' + error.message);
    }
}

async function showApproverPartImpact(partId) {
    try {
        const data = await apiRequest(`/parts/${partId}/impact`, { method: 'GET' });
        const tbody = document.getElementById('approverImpactTable');
        if (!data.assemblies || !data.assemblies.length) {
            tbody.innerHTML = '<tr><td colspan="3">No assemblies reference this part</td></tr>';
        } else {
            tbody.innerHTML = data.assemblies.map(a => `<tr>
                <td>${a.assembly_code}</td>
                <td>${a.name}</td>
                <td>${a.version_label}</td>
            </tr>`).join('');
        }
        openModal('approverImpactModal');
    } catch (error) {
        showError('Failed to load impact analysis: ' + error.message);
    }
}

async function showApproverBOM(assemblyId, versionId) {
    try {
        const data = await apiRequest(`/assemblies/${assemblyId}/versions/${versionId}/bom`, { method: 'GET' });
        const tbody = document.getElementById('approverBomTable');
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
        openModal('approverBomModal');
    } catch (error) {
        showError('Failed to load BOM: ' + error.message);
    }
}

async function freezeAssemblyVersion(versionId) {
    try {
        await apiRequest(`/assemblies/${selectedAssemblyId}/versions/${versionId}/freeze`, {
            method: 'POST',
            body: JSON.stringify({})
        });
        showSuccess('Assembly version frozen');
        await loadApproverAssemblyVersions();
    } catch (error) {
        showError('Failed to freeze assembly version: ' + error.message);
    }
}

async function loadRequests() {
    await Promise.all([loadEditRequests(), loadReleaseRequests()]);
}

async function loadEditRequests() {
    try {
        const requests = await apiRequest('/edit-requests', { method: 'GET' });
        const tbody = document.getElementById('approverEditRequestsTable');

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
        const tbody = document.getElementById('approverReleaseRequestsTable');

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

// handleChangePassword, logout, showError, showSuccess are now in api.js

// Search and filter functions
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    const typeFilter = document.getElementById('typeFilter');
    const statusFilter = document.getElementById('statusFilter');
    
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterSubmissions(e.target.value);
        });
    }
    
    if (typeFilter) {
        typeFilter.addEventListener('change', (e) => {
            filterByType(e.target.value);
        });
    }
    
    if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
            filterByStatus(e.target.value);
        });
    }
});

function filterSubmissions(searchTerm) {
    const cards = document.querySelectorAll('.approval-card');
    cards.forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(searchTerm.toLowerCase()) ? '' : 'none';
    });
}

function filterByType(type) {
    if (!type) {
        document.querySelectorAll('.approval-card').forEach(card => card.style.display = '');
        return;
    }
    
    const cards = document.querySelectorAll('.approval-card');
    cards.forEach(card => {
        const cardText = card.textContent.toLowerCase();
        card.style.display = cardText.includes(type.toLowerCase()) ? '' : 'none';
    });
}

function filterByStatus(status) {
    const rows = document.querySelectorAll('tbody tr');
    if (!status) {
        rows.forEach(row => row.style.display = '');
        return;
    }
    
    rows.forEach(row => {
        const statusBadge = row.querySelector('.status-badge');
        if (statusBadge && statusBadge.classList.contains(status)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
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
