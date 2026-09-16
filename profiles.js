/**
 * Project: BD Job Autofill
 * Module: Profiles Page Controller
 * Purpose: Loads, renders, creates, updates, and deletes profiles via the
 *          background message API, binding all profiles.html interactions.
 * Author: Lead Engineer
 * Version: 2.0.0 (Offline CV extraction — no network calls, no API key.
 *          PDF text is parsed locally via vendored PDF.js and mapped to
 *          profile fields using regex/keyword pattern matching.)
 * Dependencies: background.js (message API), lib/pdfjs/pdf.min.js (vendored)
 * Last Updated: 2026-07-09
 */

const TEXT_FIELD_KEYS = [
  'name',
  'fullName',
  'nameBn',
  'fatherName',
  'fatherBn',
  'motherName',
  'motherBn',
  'dateOfBirth',
  'gender',
  'nationality',
  'religion',
  'maritalStatus',
  'spouseName',
  'bloodGroup',
  'nidType',
  'nidNo',
  'birthRegNo',
  'passportNo',
  'mobile',
  'mobileConfirm',
  'email',
  'quota',
  'quotaDetails',
  'depStatus',
  'presentCareOf',
  'presentAddress',
  'presentDistrict',
  'presentUpazila',
  'presentPost',
  'presentPostcode',
  'permanentCareOf',
  'permanentAddress',
  'permanentDistrict',
  'permanentUpazila',
  'permanentPost',
  'permanentPostcode',
  'fatherOccupation',
  'sscExam',
  'sscRoll',
  'sscGroup',
  'sscGroupOther',
  'sscBoard',
  'sscBoardOther',
  'sscResultType',
  'sscResult',
  'sscYear',
  'hscExam',
  'hscRoll',
  'hscGroup',
  'hscGroupOther',
  'hscBoard',
  'hscBoardOther',
  'hscResultType',
  'hscResult',
  'hscYear',
  'graExam',
  'graInstitute',
  'graSubject',
  'graResultType',
  'graResult',
  'graYear',
  'graDuration',
  'masExam',
  'masInstitute',
  'masSubject',
  'masResultType',
  'masResult',
  'masYear',
  'masDuration',
  'bachelor',
  'master',
  'experienceComputer',
  'experienceSatlipi'
];

const CHECKBOX_FIELD_KEYS = ['sameAsPresent'];

const profileListEl = document.getElementById('profile-list');
const profileListEmptyEl = document.getElementById('profile-list-empty');
const profileFormEl = document.getElementById('profile-form');
const formEmptyHintEl = document.getElementById('form-empty-hint');
const formStatusEl = document.getElementById('form-status');
const newProfileBtn = document.getElementById('new-profile-btn');
const deleteProfileBtn = document.getElementById('delete-profile-btn');
const deleteProfileTopBtn = document.getElementById('delete-profile-top-btn');
const editorHeadingEl = document.getElementById('editor-heading');
const deleteModalEl = document.getElementById('delete-modal');
const modalProfileNameEl = document.getElementById('modal-profile-name');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalConfirmBtn = document.getElementById('modal-confirm-btn');
const modalCloseXBtn = document.getElementById('modal-close-x-btn');
const profileIdInput = document.getElementById('profile-id');
const copyFromProfileSelect = document.getElementById('copy-from-profile-select');
const copyFromProfileBtn = document.getElementById('copy-from-profile-btn');
const importJsonInput = document.getElementById('import-json-input');
const importJsonBtn = document.getElementById('import-json-btn');
const importStatusEl = document.getElementById('import-status');
const exportJsonBtn = document.getElementById('export-json-btn');
const backupAllBtn = document.getElementById('backup-all-btn');

// Production Search elements
const profileSearchInput = document.getElementById('profile-search-input');
const profileSearchBtn = document.getElementById('profile-search-btn');
const profileSearchClearBtn = document.getElementById('profile-search-clear-btn');
const profileSearchStatus = document.getElementById('profile-search-status');
const profileSearchStatusText = document.getElementById('profile-search-status-text');
const profileSearchResetLink = document.getElementById('profile-search-reset-link');
const profileCountBadge = document.getElementById('profile-count-badge');
const profileListNoMatchEl = document.getElementById('profile-list-no-match');

const ALL_PROFILE_FIELD_KEYS = [...TEXT_FIELD_KEYS, ...CHECKBOX_FIELD_KEYS];

let profiles = [];
let selectedProfileId = null;
let profileSearchQuery = '';
let pendingImportFile = null;

/**
 * Sends a message to the background service worker.
 * @param {string} type
 * @param {any} [payload]
 * @returns {Promise<any>}
 */
function sendMessage(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || !response.ok) {
        reject(new Error((response && response.error) || 'Unknown error.'));
        return;
      }
      resolve(response.data);
    });
  });
}

/**
 * Generates a reasonably unique identifier for a new profile.
 * @returns {string}
 */
function generateProfileId() {
  return `profile_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Sets the form status line text and style.
 * @param {string} message
 * @param {'success'|'error'|''} tone
 */
function setFormStatus(message, tone) {
  formStatusEl.textContent = message;
  formStatusEl.className = 'form-status';
  if (tone) {
    formStatusEl.classList.add(`form-status--${tone}`);
  }
}

/**
 * Sets the import panel status line text and style.
 * @param {string} message
 * @param {'success'|'error'|''} tone
 */
function setImportStatus(message, tone) {
  importStatusEl.textContent = message;
  importStatusEl.className = 'form-status';
  if (tone) {
    importStatusEl.classList.add(`form-status--${tone}`);
  }
}

let profilePendingDeletionId = null;

/**
 * Opens the in-app confirmation modal to delete a profile safely.
 * @param {string} profileId
 * @param {string} [profileName]
 */
function promptDeleteProfile(profileId, profileName) {
  if (!profileId) return;
  profilePendingDeletionId = profileId;
  const targetProfile = profiles.find((p) => p.id === profileId);
  const name = profileName || (targetProfile && targetProfile.name) || 'Unnamed profile';

  if (modalProfileNameEl) {
    modalProfileNameEl.textContent = `"${name}"`;
  }
  if (deleteModalEl) {
    deleteModalEl.hidden = false;
    deleteModalEl.classList.remove('is-hidden');
    deleteModalEl.style.display = 'flex';
  }
}

/**
 * Closes the delete confirmation modal.
 */
function closeDeleteModal() {
  profilePendingDeletionId = null;
  if (deleteModalEl) {
    deleteModalEl.hidden = true;
    deleteModalEl.classList.add('is-hidden');
    deleteModalEl.style.display = 'none';
  }
}

/**
 * Confirms and executes profile deletion via message API without using window.confirm.
 */
async function confirmDeleteProfile() {
  const idToDelete = profilePendingDeletionId || selectedProfileId;
  if (!idToDelete) {
    closeDeleteModal();
    return;
  }

  try {
    profiles = await sendMessage('DELETE_PROFILE', idToDelete);
    if (typeof window !== 'undefined' && window.ProfileCapture) {
      window.ProfileCapture.deleteProfilePhoto(idToDelete).catch(() => {});
      window.ProfileCapture.deleteProfileSignature(idToDelete).catch(() => {});
    }
    if (selectedProfileId === idToDelete) {
      selectedProfileId = null;
      profileFormEl.hidden = true;
      formEmptyHintEl.hidden = false;
    }
    closeDeleteModal();
    setFormStatus('Profile removed successfully.', 'success');
    renderProfileList();
  } catch (error) {
    closeDeleteModal();
    setFormStatus(error.message, 'error');
  }
}

/**
 * Normalizes phone numbers for flexible search (e.g. +88017... -> 017...).
 */
function normalizeSearchDigits(val) {
  if (!val) return '';
  return String(val).replace(/[^0-9]/g, '').replace(/^880/, '0');
}

/**
 * Escapes HTML characters to prevent XSS.
 */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Highlights matched query substring inside text.
 */
function highlightMatch(text, query) {
  if (!text) return '';
  const str = String(text);
  if (!query || !query.trim()) return escapeHtml(str);
  const q = query.trim();
  const lowerText = str.toLowerCase();
  const lowerQ = q.toLowerCase();
  const idx = lowerText.indexOf(lowerQ);
  if (idx === -1) return escapeHtml(str);
  return `${escapeHtml(str.slice(0, idx))}<mark class="profile-item__highlight">${escapeHtml(str.slice(idx, idx + q.length))}</mark>${escapeHtml(str.slice(idx + q.length))}`;
}

/**
 * Checks if a profile matches the search query (name, mobile, NID, etc.).
 */
function profileMatchesQuery(profile, query) {
  if (!query || !query.trim()) return true;
  const q = query.trim().toLowerCase();

  // Name checks
  const name = (profile.name || '').toLowerCase();
  const fullName = (profile.fullName || '').toLowerCase();
  const nameBn = (profile.nameBn || '').toLowerCase();
  const fatherName = (profile.fatherName || '').toLowerCase();
  const motherName = (profile.motherName || '').toLowerCase();
  if (name.includes(q) || fullName.includes(q) || nameBn.includes(q) || fatherName.includes(q) || motherName.includes(q)) {
    return true;
  }

  // Mobile checks
  const qDigits = normalizeSearchDigits(q);
  const mobile = normalizeSearchDigits(profile.mobile);
  const mobileConfirm = normalizeSearchDigits(profile.mobileConfirm);
  if (qDigits.length >= 2) {
    if (mobile.includes(qDigits) || mobileConfirm.includes(qDigits)) {
      return true;
    }
  }

  // NID / Identification checks
  const nid = (profile.nidNo || '').toLowerCase();
  if (nid.includes(q)) {
    return true;
  }

  // Email check
  const email = (profile.email || '').toLowerCase();
  if (email.includes(q)) {
    return true;
  }

  return false;
}

/**
 * Renders the profile list sidebar based on current profiles array and search query.
 */
function renderProfileList() {
  profileListEl.innerHTML = '';

  // Update total profile count badge
  if (profileCountBadge) {
    profileCountBadge.textContent = `${profiles.length} Profiles`;
  }

  const query = (profileSearchQuery || '').trim();
  const filtered = profiles.filter((p) => profileMatchesQuery(p, query));

  if (profileSearchClearBtn) {
    profileSearchClearBtn.hidden = !query;
  }

  if (query) {
    if (profileSearchStatus && profileSearchStatusText) {
      profileSearchStatus.hidden = false;
      profileSearchStatusText.textContent = `Found ${filtered.length} of ${profiles.length} profiles`;
    }
  } else {
    if (profileSearchStatus) {
      profileSearchStatus.hidden = true;
    }
  }

  if (profiles.length === 0) {
    profileListEmptyEl.hidden = false;
    if (profileListNoMatchEl) profileListNoMatchEl.hidden = true;
  } else if (filtered.length === 0) {
    profileListEmptyEl.hidden = true;
    if (profileListNoMatchEl) profileListNoMatchEl.hidden = false;
  } else {
    profileListEmptyEl.hidden = true;
    if (profileListNoMatchEl) profileListNoMatchEl.hidden = true;

    for (const profile of filtered) {
      const li = document.createElement('li');
      li.className = 'profile-list__item';
      if (profile.id === selectedProfileId) {
        li.classList.add('profile-list__item--active');
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'profile-list__button';
      button.title = `${profile.name || 'Unnamed'}${profile.fullName ? ` (${profile.fullName})` : ''} - Click to edit`;

      const maritalVal = (profile.maritalStatus && profile.maritalStatus.toLowerCase() === 'unmarried')
        ? 'Single'
        : (profile.maritalStatus || 'Single');
      const isSingle = maritalVal.toLowerCase() === 'single';

      const headerRow = document.createElement('div');
      headerRow.className = 'profile-item__header-row';
      headerRow.innerHTML = `
        <span class="profile-item__name">${highlightMatch(profile.name || 'Unnamed', query)}</span>
        <span class="profile-item__badge ${isSingle ? 'profile-item__badge--single' : 'profile-item__badge--married'}">${escapeHtml(maritalVal)}</span>
      `;
      button.appendChild(headerRow);

      if (profile.fullName) {
        const fullRow = document.createElement('div');
        fullRow.className = 'profile-item__fullname';
        fullRow.innerHTML = highlightMatch(profile.fullName, query);
        button.appendChild(fullRow);
      }

      const metaRow = document.createElement('div');
      metaRow.className = 'profile-item__meta-row';
      const phoneText = profile.mobile ? `📱 ${highlightMatch(profile.mobile, query)}` : '📱 No mobile';
      const nidText = profile.nidNo ? `• 🆔 ${highlightMatch(profile.nidNo, query)}` : '';
      metaRow.innerHTML = `${phoneText} ${nidText}`;
      button.appendChild(metaRow);

      button.addEventListener('click', () => selectProfile(profile.id));
      li.appendChild(button);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'profile-list__delete-btn';
      delBtn.title = `Delete profile "${profile.name || 'Unnamed'}"`;
      delBtn.setAttribute('aria-label', `Delete profile ${profile.name || 'Unnamed'}`);
      delBtn.innerHTML = '🗑️';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        promptDeleteProfile(profile.id, profile.name);
      });
      li.appendChild(delBtn);

      profileListEl.appendChild(li);
    }
  }

  // Update export button state
  if (exportJsonBtn) {
    const active = profiles.find((p) => p.id === selectedProfileId);
    if (active) {
      exportJsonBtn.hidden = false;
      exportJsonBtn.textContent = `Download "${active.name || 'Profile'}" (JSON)`;
    } else {
      exportJsonBtn.hidden = true;
    }
  }

  renderCopyFromProfileOptions();
}

/**
 * Populates the "copy from a saved profile" dropdown from the current
 * profiles array, preserving the previously selected value if still valid.
 */
function renderCopyFromProfileOptions() {
  const previousValue = copyFromProfileSelect.value;
  copyFromProfileSelect.innerHTML = '<option value="">Select a profile…</option>';

  for (const profile of profiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    const phonePart = profile.mobile ? ` (${profile.mobile})` : '';
    option.textContent = `${profile.name || 'Unnamed profile'}${phonePart}`;
    copyFromProfileSelect.appendChild(option);
  }

  if (profiles.some((p) => p.id === previousValue)) {
    copyFromProfileSelect.value = previousValue;
  }
  copyFromProfileBtn.disabled = profiles.length === 0;
}

/**
 * Populates the form fields with a given profile's data.
 * @param {object} profile
 */
function populateForm(profile) {
  profileIdInput.value = profile.id || '';

  for (const key of TEXT_FIELD_KEYS) {
    const input = document.getElementById(`field-${key}`);
    if (!input) {
      continue;
    }
    if (key === 'nationality' && !profile.id && profile[key] === undefined) {
      input.value = 'Bangladeshi';
      continue;
    }
    if (key === 'maritalStatus') {
      const val = profile[key];
      input.value = (val && val.toLowerCase() === 'unmarried') ? 'Single' : (val || '');
      continue;
    }
    input.value = profile[key] || '';
  }

  for (const key of CHECKBOX_FIELD_KEYS) {
    const input = document.getElementById(`field-${key}`);
    if (input) {
      input.checked = Boolean(profile[key]);
    }
  }

  // Populate dynamic Custom Fields
  const container = document.getElementById('custom-fields-container');
  if (container) {
    container.innerHTML = '';
    if (profile && Array.isArray(profile.customFields)) {
      profile.customFields.forEach(field => {
        addCustomFieldRow(field.key, field.value);
      });
    }
  }

  // Initialize Photo & Signature Capture
  if (typeof window !== 'undefined' && window.ProfileCapture) {
    const activeProfileId = profile.id || profileIdInput.value;
    if (activeProfileId) {
      window.ProfileCapture.initPhotoCapture('#photoInput', '#photoPreview', activeProfileId);
      window.ProfileCapture.initSignatureCapture('#sigInput', '#sigPreview', activeProfileId);
    } else {
      const photoPrev = document.getElementById('photoPreview');
      const sigPrev = document.getElementById('sigPreview');
      if (photoPrev) photoPrev.innerHTML = '<span class="capture-placeholder-text">Save profile or select file to crop</span>';
      if (sigPrev) sigPrev.innerHTML = '<span class="capture-placeholder-text">Save profile or select file to scan</span>';
    }
  }
}

/**
 * Reads current form field values into a profile object.
 * @returns {object}
 */
function readFormData() {
  const data = { id: profileIdInput.value || generateProfileId() };

  for (const key of TEXT_FIELD_KEYS) {
    const input = document.getElementById(`field-${key}`);
    if (input) {
      data[key] = input.value.trim();
    }
  }

  for (const key of CHECKBOX_FIELD_KEYS) {
    const input = document.getElementById(`field-${key}`);
    if (input) {
      data[key] = input.checked;
    }
  }

  // Read dynamic Custom Fields
  const customFields = [];
  const rows = document.querySelectorAll('.custom-field-row');
  rows.forEach(row => {
    const keyInput = row.querySelector('.custom-field-key');
    const valInput = row.querySelector('.custom-field-value');
    if (keyInput && valInput) {
      const key = keyInput.value.trim();
      const value = valInput.value;
      if (key) {
        customFields.push({ key, value });
      }
    }
  });
  data.customFields = customFields;

  if (data.maritalStatus && data.maritalStatus.toLowerCase() === 'unmarried') {
    data.maritalStatus = 'Single';
  }

  return data;
}

/**
 * Selects a profile by id, populating the form for editing.
 * @param {string} profileId
 */
function selectProfile(profileId) {
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) {
    return;
  }

  selectedProfileId = profileId;
  formEmptyHintEl.hidden = true;
  profileFormEl.hidden = false;
  if (deleteProfileBtn) deleteProfileBtn.hidden = false;
  if (deleteProfileTopBtn) deleteProfileTopBtn.hidden = false;
  if (editorHeadingEl) editorHeadingEl.textContent = `Edit Profile: ${profile.name || 'Unnamed'}`;
  setFormStatus('', '');
  populateForm(profile);
  renderProfileList();
}

/**
 * Prepares the form for creating a new profile.
 */
function startNewProfile() {
  const newId = generateProfileId();
  selectedProfileId = null;
  formEmptyHintEl.hidden = true;
  profileFormEl.hidden = false;
  if (deleteProfileBtn) deleteProfileBtn.hidden = true;
  if (deleteProfileTopBtn) deleteProfileTopBtn.hidden = true;
  if (editorHeadingEl) editorHeadingEl.textContent = 'Create New Profile';
  setFormStatus('', '');
  populateForm({ id: newId });
  renderProfileList();
  document.getElementById('field-name').focus();
}

/**
 * Handles profile form submission: validates and saves via message API.
 * @param {SubmitEvent} event
 */
async function handleFormSubmit(event) {
  event.preventDefault();

  const name = document.getElementById('field-name').value.trim();
  if (!name) {
    setFormStatus('Profile label is required.', 'error');
    return;
  }

  const data = readFormData();

  try {
    profiles = await sendMessage('SAVE_PROFILE', data);
    selectedProfileId = data.id;
    setFormStatus('Profile saved.', 'success');
    renderProfileList();
    if (deleteProfileBtn) deleteProfileBtn.hidden = false;
    if (deleteProfileTopBtn) deleteProfileTopBtn.hidden = false;
    if (editorHeadingEl) editorHeadingEl.textContent = `Edit Profile: ${data.name || 'Unnamed'}`;
  } catch (error) {
    setFormStatus(error.message, 'error');
  }
}

/**
 * Handles delete button click: confirms and removes the selected profile using in-app modal.
 */
function handleDeleteClick() {
  if (!selectedProfileId) {
    return;
  }
  const current = profiles.find((p) => p.id === selectedProfileId);
  promptDeleteProfile(selectedProfileId, current ? current.name : '');
}

/**
 * Handles the "same as present address" checkbox: copies present address
 * fields into permanent address fields and disables permanent inputs.
 */
function handleSameAsPresentChange() {
  const checkbox = document.getElementById('field-sameAsPresent');
  const mapping = {
    presentCareOf: 'permanentCareOf',
    presentAddress: 'permanentAddress',
    presentDistrict: 'permanentDistrict',
    presentUpazila: 'permanentUpazila',
    presentPost: 'permanentPost',
    presentPostcode: 'permanentPostcode'
  };

  for (const [sourceKey, targetKey] of Object.entries(mapping)) {
    const sourceInput = document.getElementById(`field-${sourceKey}`);
    const targetInput = document.getElementById(`field-${targetKey}`);
    if (!sourceInput || !targetInput) {
      continue;
    }
    if (checkbox.checked) {
      targetInput.value = sourceInput.value;
      targetInput.disabled = true;
    } else {
      targetInput.disabled = false;
    }
  }
}

/**
 * Returns a sample profile object based on the data from the provided
 * "Save Document - Study Online Bd.html" file, now with values that match
 * the BSDB Teletalk form options exactly.
 * @returns {object}
 */
function getSampleProfileData() {
  return {
    id: '',
    name: 'Habib',
    fullName: 'MD. HABIBUR RAHMAN',
    nameBn: 'মোঃ হাবিবুর রহমান',
    fatherName: 'MD. ABDUS SOBAHAN',
    fatherBn: 'মোঃ আব্দুস সোবহান',
    motherName: 'MST. HAMIDA BEGUM',
    motherBn: 'মোছাঃ হামিদা বেগম',
    dateOfBirth: '1994-12-20',
    gender: 'Male',
    nationality: 'Bangladeshi',
    religion: 'Islam',
    maritalStatus: 'Married',
    spouseName: 'MST. SADIYA AKHTER',
    bloodGroup: '',
    nidType: 'NID',
    nidNo: '3254367778',
    birthRegNo: '',
    passportNo: '',
    mobile: '01771522503',
    mobileConfirm: '01771522503',
    email: 'habiblinkage@gmail.com',
    quota: 'Not Applicable',
    quotaDetails: '',
    depStatus: 'Not Applicable',
    presentCareOf: 'MD. ABDUS SOBAHAN',
    presentAddress: 'SHOHORDIGHI UTTAR PARA',
    presentDistrict: '10',
    presentUpazila: '43',
    presentPost: 'FAPORE',
    presentPostcode: '5800',
    permanentCareOf: 'MD. ABDUS SOBAHAN',
    permanentAddress: 'SHOHORDIGHI UTTAR PARA',
    permanentDistrict: '10',
    permanentUpazila: '43',
    permanentPost: 'FAPORE',
    permanentPostcode: '5800',
    sameAsPresent: true,
    fatherOccupation: '',
    sscExam: 'S.S.C',
    sscRoll: '124300',
    sscGroup: 'Science',
    sscGroupOther: '',
    sscBoard: 'Rajshahi',
    sscBoardOther: '',
    sscResultType: 'GPA(out of 5)',
    sscResult: '4.38',
    sscYear: '2010',
    hscExam: 'H.S.C',
    hscRoll: '130381',
    hscGroup: 'Science',
    hscGroupOther: '',
    hscBoard: 'Rajshahi',
    hscBoardOther: '',
    hscResultType: 'GPA(out of 5)',
    hscResult: '4.50',
    hscYear: '2012',
    graExam: 'Honors',
    graInstitute: 'National University',
    graSubject: 'Zoology',
    graResultType: 'CGPA(out of 4)',
    graResult: '3.43',
    graYear: '2016',
    graDuration: '04',
    masExam: 'Masters',
    masInstitute: 'National University',
    masSubject: 'Zoology',
    masResultType: 'CGPA(out of 4)',
    masResult: '3.61',
    masYear: '2017',
    masDuration: '01',
    bachelor: 'B.Sc (Honors) in Zoology, National University, 2016, CGPA 3.43',
    master: 'M.Sc in Zoology, National University, 2017, CGPA 3.61',
    experienceComputer: 'Yes',
    experienceSatlipi: 'Yes',
    customFields: [
      { key: 'Height (Inches)', value: '68' },
      { key: 'Weight (KG)', value: '65' }
    ]
  };
}

/**
 * Dynamically appends a custom field row to the profile form.
 * @param {string} [key]
 * @param {string} [value]
 */
function addCustomFieldRow(key = '', value = '') {
  const container = document.getElementById('custom-fields-container');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'custom-field-row';
  row.style.display = 'flex';
  row.style.gap = 'var(--spacing-sm)';
  row.style.alignItems = 'center';
  row.style.marginTop = 'var(--spacing-xs)';

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.className = 'custom-field-key';
  keyInput.placeholder = 'Key/Label (e.g. Height)';
  keyInput.value = key;
  keyInput.style.flex = '1';
  keyInput.style.padding = 'var(--spacing-sm)';
  keyInput.style.border = '1px solid var(--color-border)';
  keyInput.style.borderRadius = 'var(--radius)';
  keyInput.style.fontSize = '13px';

  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.className = 'custom-field-value';
  valueInput.placeholder = 'Value';
  valueInput.value = value;
  valueInput.style.flex = '1';
  valueInput.style.padding = 'var(--spacing-sm)';
  valueInput.style.border = '1px solid var(--color-border)';
  valueInput.style.borderRadius = 'var(--radius)';
  valueInput.style.fontSize = '13px';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'button button--danger remove-custom-field-btn';
  removeBtn.textContent = 'Remove';
  removeBtn.style.padding = 'var(--spacing-sm) var(--spacing-md)';
  removeBtn.style.fontSize = '13px';
  removeBtn.style.lineHeight = '1.2';
  removeBtn.style.margin = '0';
  removeBtn.style.minHeight = '34px';
  removeBtn.style.width = 'auto';
  removeBtn.addEventListener('click', () => {
    row.remove();
  });

  row.appendChild(keyInput);
  row.appendChild(valueInput);
  row.appendChild(removeBtn);
  container.appendChild(row);
}

/**
 * Loads all profiles from storage on page initialization and auto-migrates legacy values.
 * @returns {Promise<void>}
 */
async function initialize() {
  closeDeleteModal();
  try {
    profiles = await sendMessage('GET_PROFILES');
    if (!Array.isArray(profiles)) {
      profiles = [];
    }

    // Auto-migrate legacy 'Unmarried' to 'Single' in stored profiles
    for (const p of profiles) {
      if (p && p.maritalStatus && p.maritalStatus.toLowerCase() === 'unmarried') {
        p.maritalStatus = 'Single';
        try {
          await sendMessage('SAVE_PROFILE', p);
        } catch (e) {
          console.warn('Could not auto-migrate profile maritalStatus:', e);
        }
      }
    }

    renderProfileList();
    if (!profiles || profiles.length === 0) {
      startNewProfile();
    }
  } catch (error) {
    setFormStatus(error.message, 'error');
  }
}

// --- Event Listeners ---

if (newProfileBtn) newProfileBtn.addEventListener('click', startNewProfile);
if (profileFormEl) profileFormEl.addEventListener('submit', handleFormSubmit);
if (deleteProfileBtn) deleteProfileBtn.addEventListener('click', handleDeleteClick);
if (deleteProfileTopBtn) deleteProfileTopBtn.addEventListener('click', handleDeleteClick);
if (modalCancelBtn) {
  modalCancelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeDeleteModal();
  });
}
if (modalCloseXBtn) {
  modalCloseXBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeDeleteModal();
  });
}
if (modalConfirmBtn) {
  modalConfirmBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    confirmDeleteProfile();
  });
}
if (deleteModalEl) {
  deleteModalEl.addEventListener('click', (e) => {
    if (e.target === deleteModalEl) {
      closeDeleteModal();
    }
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && deleteModalEl && !deleteModalEl.hidden && deleteModalEl.style.display !== 'none') {
    closeDeleteModal();
  }
});
const sameAsPresentCheckbox = document.getElementById('field-sameAsPresent');
if (sameAsPresentCheckbox) {
  sameAsPresentCheckbox.addEventListener('change', handleSameAsPresentChange);
} else {
  console.warn('profiles.js: #field-sameAsPresent not found in the DOM; skipping listener.');
}

const addCustomFieldBtn = document.getElementById('add-custom-field-btn');
if (addCustomFieldBtn) {
  addCustomFieldBtn.addEventListener('click', () => {
    addCustomFieldRow('', '');
  });
}

// --- Search Event Listeners ---

function handleSearchClick() {
  const q = profileSearchInput ? profileSearchInput.value.trim() : '';
  profileSearchQuery = q;
  renderProfileList();
}

function handleSearchReset() {
  if (profileSearchInput) {
    profileSearchInput.value = '';
  }
  profileSearchQuery = '';
  renderProfileList();
}

if (profileSearchBtn) {
  profileSearchBtn.addEventListener('click', handleSearchClick);
}

if (profileSearchInput) {
  profileSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearchClick();
    } else if (e.key === 'Escape') {
      handleSearchReset();
    }
  });

  profileSearchInput.addEventListener('input', () => {
    profileSearchQuery = profileSearchInput.value;
    renderProfileList();
  });
}

if (profileSearchClearBtn) {
  profileSearchClearBtn.addEventListener('click', handleSearchReset);
}

if (profileSearchResetLink) {
  profileSearchResetLink.addEventListener('click', handleSearchReset);
}

// --- Data Backup & Transfer Handlers ---

function downloadJsonFile(filename, data) {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

if (exportJsonBtn) {
  exportJsonBtn.addEventListener('click', () => {
    const active = profiles.find((p) => p.id === selectedProfileId);
    if (!active) {
      setFormStatus('No profile selected to export.', 'error');
      return;
    }
    const safeName = (active.name || 'profile').toLowerCase().replace(/[^a-z0-9]/gi, '_');
    downloadJsonFile(`${safeName}_profile.json`, active);
    setFormStatus(`Exported "${active.name}" as JSON file.`, 'success');
  });
}

if (backupAllBtn) {
  backupAllBtn.addEventListener('click', () => {
    if (!profiles || profiles.length === 0) {
      setImportStatus('No profiles to backup yet.', 'error');
      return;
    }
    const backupData = {
      app: 'BD Job Autofill',
      version: '1.5.0',
      exportedAt: new Date().toISOString(),
      count: profiles.length,
      profiles: profiles
    };
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadJsonFile(`bd_job_autofill_profiles_backup_${dateStr}.json`, backupData);
    setImportStatus(`Successfully backed up ${profiles.length} profiles!`, 'success');
  });
}

if (importJsonInput) {
  importJsonInput.addEventListener('change', () => {
    const file = importJsonInput.files && importJsonInput.files[0];
    pendingImportFile = file || null;
    if (importJsonBtn) {
      importJsonBtn.disabled = !file;
    }
    if (file) {
      setImportStatus(`Selected: ${file.name}`, '');
    } else {
      setImportStatus('', '');
    }
  });
}

if (importJsonBtn) {
  importJsonBtn.addEventListener('click', async () => {
    if (!pendingImportFile) {
      setImportStatus('Please select a JSON file first.', 'error');
      return;
    }

    try {
      importJsonBtn.disabled = true;
      setImportStatus('Reading and validating JSON file...', '');

      const text = await pendingImportFile.text();
      const parsed = JSON.parse(text);

      let importedList = [];
      if (Array.isArray(parsed)) {
        importedList = parsed;
      } else if (parsed && Array.isArray(parsed.profiles)) {
        importedList = parsed.profiles;
      } else if (parsed && typeof parsed === 'object') {
        importedList = [parsed];
      } else {
        throw new Error('Invalid JSON format: expected a profile object or an array of profiles.');
      }

      if (importedList.length === 0) {
        throw new Error('No profile records found in the JSON file.');
      }

      let saveCount = 0;
      for (const item of importedList) {
        if (!item || typeof item !== 'object') continue;
        const profileToSave = { ...item };
        if (!profileToSave.id) {
          profileToSave.id = generateProfileId();
        }
        if (!profileToSave.name) {
          profileToSave.name = profileToSave.fullName || 'Imported Profile';
        }
        // Normalize marital status to Single
        if (profileToSave.maritalStatus && profileToSave.maritalStatus.toLowerCase() === 'unmarried') {
          profileToSave.maritalStatus = 'Single';
        }

        await sendMessage('SAVE_PROFILE', profileToSave);
        saveCount++;
      }

      profiles = await sendMessage('GET_PROFILES');
      renderProfileList();
      setImportStatus(`Successfully imported ${saveCount} profile(s)!`, 'success');
      importJsonInput.value = '';
      pendingImportFile = null;
      importJsonBtn.disabled = true;
    } catch (err) {
      setImportStatus(`Import failed: ${err.message}`, 'error');
      if (importJsonBtn) importJsonBtn.disabled = false;
    }
  });
}

if (copyFromProfileBtn) {
  copyFromProfileBtn.addEventListener('click', () => {
    const sourceId = copyFromProfileSelect.value;
    if (!sourceId) {
      setImportStatus('Please select a profile to copy.', 'error');
      return;
    }
    const source = profiles.find((p) => p.id === sourceId);
    if (!source) {
      setImportStatus('Selected profile not found.', 'error');
      return;
    }

    const cloned = JSON.parse(JSON.stringify(source));
    delete cloned.id;
    cloned.name = `${source.name || 'Profile'} (Copy)`;
    if (cloned.maritalStatus && cloned.maritalStatus.toLowerCase() === 'unmarried') {
      cloned.maritalStatus = 'Single';
    }

    selectedProfileId = null;
    formEmptyHintEl.hidden = true;
    profileFormEl.hidden = false;
    if (deleteProfileBtn) deleteProfileBtn.hidden = true;
    if (deleteProfileTopBtn) deleteProfileTopBtn.hidden = true;
    if (editorHeadingEl) editorHeadingEl.textContent = `Create New Profile (Copy of ${source.name || 'Profile'})`;
    setFormStatus(`Copied details from "${source.name}". Edit and click "Save Profile" to save as new.`, 'success');
    populateForm(cloned);
    renderProfileList();
    const nameField = document.getElementById('field-name');
    if (nameField) nameField.focus();
  });
}

// --- Sample Profile event listeners ---

const loadSampleBtn = document.getElementById('load-sample-btn');
const showSampleJsonBtn = document.getElementById('show-sample-json-btn');
const sampleJsonDisplay = document.getElementById('sample-json-display');

if (loadSampleBtn) {
  loadSampleBtn.addEventListener('click', () => {
    const sample = getSampleProfileData();
    selectedProfileId = null;
    formEmptyHintEl.hidden = true;
    profileFormEl.hidden = false;
    deleteProfileBtn.hidden = true;
    setFormStatus('Sample profile loaded. You can edit and save.', 'success');
    populateForm(sample);
    renderProfileList();
    const sameCheckbox = document.getElementById('field-sameAsPresent');
    if (sameCheckbox) {
      sameCheckbox.checked = true;
      sameCheckbox.dispatchEvent(new Event('change'));
    }
  });
}

if (showSampleJsonBtn) {
  showSampleJsonBtn.addEventListener('click', () => {
    if (sampleJsonDisplay.style.display === 'none') {
      const sample = getSampleProfileData();
      sampleJsonDisplay.textContent = JSON.stringify(sample, null, 2);
      sampleJsonDisplay.style.display = 'block';
      showSampleJsonBtn.textContent = 'Hide Sample JSON';
    } else {
      sampleJsonDisplay.style.display = 'none';
      showSampleJsonBtn.textContent = 'Show Sample JSON';
    }
  });
}

// ----- CV Import: fully offline PDF extraction (no network, no API key) -----
//
// PDF text is extracted locally using the vendored PDF.js build at
// lib/pdfjs/pdf.min.js (worker at lib/pdfjs/pdf.worker.min.js). Field values
// are then derived from that text with regex/keyword pattern matching in
// extractFieldsFromText(). If a PDF has no embedded text layer (e.g. a
// scanned/image-only form), each page is rendered to a canvas and OCR'd
// locally via the vendored Tesseract.js build at lib/tesseract/ (English +
// Bangla trained data, also vendored). Nothing in this section ever leaves
// the browser.

const cvStatusEl = document.getElementById('cv-status');
const cvFileInput = document.getElementById('cv-file-input');
const extractCvBtn = document.getElementById('extract-cv-btn');

/**
 * Lazily configures the vendored PDF.js worker. Safe to call repeatedly.
 */
function ensurePdfJsConfigured() {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error(
      'PDF.js is not loaded. Make sure lib/pdfjs/pdf.min.js is included ' +
      'before profiles.js and lib/pdfjs/pdf.worker.min.js is listed in ' +
      'web_accessible_resources in manifest.json.'
    );
  }
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdfjs/pdf.worker.min.js');
  }
}

/**
 * Checks that the vendored Tesseract.js build is loaded. Actual worker
 * creation happens lazily in runOcrOnPdf() since it's only needed when a
 * PDF has no extractable text layer.
 */
function ensureTesseractAvailable() {
  if (typeof Tesseract === 'undefined') {
    throw new Error(
      'Tesseract.js is not loaded. Make sure lib/tesseract/tesseract.min.js ' +
      'is included before profiles.js and the lib/tesseract/ assets are ' +
      'listed in web_accessible_resources in manifest.json.'
    );
  }
}

/** Set status for CV import area */
function setCvStatus(message, tone) {
  cvStatusEl.textContent = message;
  cvStatusEl.className = 'form-status';
  if (tone) {
    cvStatusEl.classList.add(`form-status--${tone}`);
  }
}

/** Enable/disable extract button based on file presence only (no API key needed) */
function updateExtractButton() {
  if (!cvFileInput || !extractCvBtn) return;
  const hasFile = cvFileInput.files && cvFileInput.files.length > 0;
  extractCvBtn.disabled = !hasFile;
}

if (cvFileInput) cvFileInput.addEventListener('change', updateExtractButton);

/** Read a File as an ArrayBuffer, for local PDF.js parsing. */
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Groups raw OCR word boxes into visual rows by y-position, filtering out
 * low-confidence/stray border-line characters. Shared by the flat
 * label:value reconstruction below and the multi-column table parsers
 * (address block, education table) further down, which need row/column
 * structure rather than a flattened string.
 * @param {Array<{text:string, bbox:{x0:number,y0:number,x1:number,y1:number}, confidence:number}>} words
 * @returns {Array<{yc:number, words: Array<{text:string,x0:number,x1:number,y0:number,y1:number,yc:number}>}>}
 */
function groupWordsIntoRows(words) {
  // Table cell borders are frequently misread by Tesseract as tiny stray
  // characters ("A", "H", a lone ":") sitting right at column boundaries —
  // e.g. "Gender : : Male" or "Applicant's Name A MD. HABIBUR RAHMAN".
  // These are near-always low-confidence single-character guesses, so we
  // drop them here rather than trying to patch every downstream regex.
  const CONFIDENCE_FLOOR = 40;
  const items = (words || [])
    .filter((w) => w.text && w.text.trim())
    .filter((w) => w.confidence === undefined || w.confidence >= CONFIDENCE_FLOOR)
    .filter((w) => !/^[:;|.,]{1,2}$/.test(w.text.trim()))
    .map((w) => ({
      text: w.text.trim(),
      x0: w.bbox.x0,
      x1: w.bbox.x1,
      y0: w.bbox.y0,
      y1: w.bbox.y1,
      yc: (w.bbox.y0 + w.bbox.y1) / 2,
    }));

  if (items.length === 0) return [];

  const heights = items.map((it) => it.y1 - it.y0).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 20;
  const Y_TOL = Math.max(8, medianHeight * 0.6);

  items.sort((a, b) => a.yc - b.yc);
  const rows = [];
  for (const it of items) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.yc - it.yc) <= Y_TOL) {
      row.words.push(it);
      row.yc = (row.yc * (row.words.length - 1) + it.yc) / row.words.length;
    } else {
      rows.push({ yc: it.yc, words: [it] });
    }
  }
  for (const row of rows) row.words.sort((a, b) => a.x0 - b.x0);
  return rows;
}

/**
 * Turns row-grouped words into "Label : Value" text lines by splitting each
 * row at its single widest x-gap. Good enough for simple 2-column forms;
 * genuine multi-column tables (3+ columns) need the specialized parsers
 * below instead, since a single gap can't disambiguate more than 2 columns.
 * @param {ReturnType<typeof groupWordsIntoRows>} rows
 * @param {number} pageWidth
 * @returns {string}
 */
function rowsToLines(rows, pageWidth) {
  const GAP_THRESHOLD = pageWidth * 0.025;
  const lines = [];
  for (const row of rows) {
    let maxGap = 0;
    let splitIdx = -1;
    for (let i = 1; i < row.words.length; i++) {
      const gap = row.words[i].x0 - row.words[i - 1].x1;
      if (gap > maxGap) {
        maxGap = gap;
        splitIdx = i;
      }
    }
    if (splitIdx > 0 && maxGap > GAP_THRESHOLD) {
      const label = row.words.slice(0, splitIdx).map((w) => w.text).join(' ');
      let valueWords = row.words.slice(splitIdx);
      // Safety net: even after confidence filtering, a stray single-char
      // border misread can slip through (e.g. no confidence field at all).
      // A real value is never a lone 1-character token followed by more
      // words, so drop it if that shape shows up.
      if (valueWords.length > 1 && valueWords[0].text.length === 1) {
        valueWords = valueWords.slice(1);
      }
      const value = valueWords.map((w) => w.text).join(' ');
      lines.push(`${label} : ${value}`);
    } else {
      lines.push(row.words.map((w) => w.text).join(' '));
    }
  }
  return lines.join('\n');
}

/**
 * Reconstructs "Label : Value" text lines from raw OCR word boxes, instead
 * of relying on Tesseract's default reading order. This matters for
 * two-column table forms (e.g. government application receipts where the
 * left column holds labels and the right column holds values) — Tesseract's
 * default text output reads such tables column-by-column ("Name of the
 * Post\nUser Id\n...\nMD. HABIBUR RAHMAN\n..."), which breaks every
 * label/value regex in extractFieldsFromText(). Grouping words into rows by
 * y-position and splitting each row into columns at its widest x-gap
 * restores the label-adjacent-to-value layout the regexes expect.
 * @param {Array<{text:string, bbox:{x0:number,y0:number,x1:number,y1:number}, confidence:number}>} words
 * @param {number} pageWidth
 * @returns {string}
 */
function reconstructRowsFromWords(words, pageWidth) {
  return rowsToLines(groupWordsIntoRows(words), pageWidth);
}

/**
 * Parses the side-by-side "Present Address / Permanent Address" block.
 * A single-gap split can't handle this (it's 2 label:value pairs sitting
 * next to each other per row), so instead we anchor a column boundary at
 * the "Permanent" header word and bucket every subsequent address-block
 * word left/right of it, then apply the normal sub-label regexes
 * (Care Of / Vill.../ District / Upazila/P.S. / Post Office / Post Code)
 * independently to each half.
 * @param {ReturnType<typeof groupWordsIntoRows>} rows
 * @returns {object} partial profile data (only fields that were found)
 */
function extractAddressTableFromRows(rows) {
  const out = {};
  const headerIdx = rows.findIndex((r) => {
    const t = r.words.map((w) => w.text).join(' ');
    return /(?:present\s*address|বর্তমান\s*ঠিকানা)/i.test(t) && /(?:permanent\s*address|স্থায়ী\s*ঠিকানা)/i.test(t);
  });
  if (headerIdx === -1) return out;

  const headerRow = rows[headerIdx];
  const permWordIdx = headerRow.words.findIndex((w) => /^(?:permanent|স্থায়ী)/i.test(w.text));
  let boundaryX;
  if (permWordIdx > 0) {
    boundaryX =
      headerRow.words[permWordIdx].x0 -
      (headerRow.words[permWordIdx].x0 - headerRow.words[permWordIdx - 1].x1) / 2;
  } else {
    const minX = Math.min(...headerRow.words.map((w) => w.x0));
    const maxX = Math.max(...headerRow.words.map((w) => w.x1));
    boundaryX = (minX + maxX) / 2;
  }

  const addrRowRegex = /(?:Care\s*Of|Care-Of|C\s*\/\s*O|প্রযত্নে|Vill|House|Road|Flat|District|Upazila|Thana|Post\s*Office|Post\s*Code|জেলা|উপজেলা|থানা|ডাকঘর|পোস্ট)/i;
  const subLabelPatterns = [
    ['careOf', /(?:Care\s*Of|Care-Of|C\s*\/\s*O|প্রযত্নে)\s*[:\-–]?\s*(.+)/i],
    ['district', /(?:District|জেলা)\s*[:\-–]?\s*(.+)/i],
    ['upazila', /(?:Upazila|Thana|উপজেলা|থানা)[^A-Za-z\u0980-\u09FF]*(?:P\.?S\.?)?\s*[:\-–]?\s*(.+)/i],
    ['post', /(?:Post\s*Office|Post|ডাকঘর)\s*[:\-–]?\s*(.+)/i],
    ['postcode', /(?:Post\s*[- ]?Code|Postal\s*Code|পোস্ট\s*কোড)\s*[:\-–]?\s*(.+)/i],
    ['address', /(?:Vill\/?\s*Road\/?|Village|Road|House|Flat|গ্রাম|রোড|বাসা|হোল্ডিং)[^\n:]*[:\-–]?\s*(.+)/i],
  ];

  const present = {};
  const permanent = {};
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const rowText = row.words.map((w) => w.text).join(' ');
    if (/educat|examination|academic/i.test(rowText)) break; // left the address block
    if (!addrRowRegex.test(rowText)) continue;

    const leftText = row.words.filter((w) => w.x0 < boundaryX).map((w) => w.text).join(' ');
    const rightText = row.words.filter((w) => w.x0 >= boundaryX).map((w) => w.text).join(' ');
    for (const [key, pat] of subLabelPatterns) {
      const lm = leftText.match(pat);
      if (lm && lm[1] && lm[1].trim() && !present[key]) present[key] = lm[1].trim();
      const rm = rightText.match(pat);
      if (rm && rm[1] && rm[1].trim() && !permanent[key]) permanent[key] = rm[1].trim();
    }
  }

  const cleanVal = (v) => (v ? v.replace(/^[:\-–\s]+|[:\-–\s]+$/g, '').trim() : '');

  if (present.careOf) out.presentCareOf = cleanVal(present.careOf);
  if (present.address) out.presentAddress = cleanVal(present.address);
  if (present.district) out.presentDistrict = cleanVal(present.district);
  if (present.upazila) out.presentUpazila = cleanVal(present.upazila);
  if (present.post) out.presentPost = cleanVal(present.post);
  if (present.postcode) {
    const pm = present.postcode.match(/\d{4}/);
    out.presentPostcode = pm ? pm[0] : cleanVal(present.postcode);
  }

  if (permanent.careOf) out.permanentCareOf = cleanVal(permanent.careOf);
  else if (out.presentCareOf) out.permanentCareOf = out.presentCareOf;

  if (permanent.address) out.permanentAddress = cleanVal(permanent.address);
  if (permanent.district) out.permanentDistrict = cleanVal(permanent.district);
  if (permanent.upazila) out.permanentUpazila = cleanVal(permanent.upazila);
  if (permanent.post) out.permanentPost = cleanVal(permanent.post);
  if (permanent.postcode) {
    const pm = permanent.postcode.match(/\d{4}/);
    out.permanentPostcode = pm ? pm[0] : cleanVal(permanent.postcode);
  }

  return out;
}

/**
 * Parses the Educational Info table (Examination | Board/University | Roll
 * | Result | Group/Subject | Year | Duration). This is a genuine N-column
 * table, so column boundaries are anchored from the header row's word
 * x-positions (midpoints between consecutive header words), and every data
 * row's words are bucketed into whichever column boundary they fall inside.
 * @param {ReturnType<typeof groupWordsIntoRows>} rows
 * @returns {object} partial profile data (only fields that were found)
 */
/**
 * Known Bangladesh Education Boards
 */
const BD_BOARDS = [
  { name: 'Dhaka', re: /\bdhaka\b/i },
  { name: 'Rajshahi', re: /\brajshahi\b/i },
  { name: 'Cumilla', re: /\b(?:cumilla|comilla)\b/i },
  { name: 'Chattogram', re: /\b(?:chattogram|chittagong)\b/i },
  { name: 'Barishal', re: /\b(?:barishal|barisal)\b/i },
  { name: 'Sylhet', re: /\bsylhet\b/i },
  { name: 'Dinajpur', re: /\bdinajpur\b/i },
  { name: 'Jessore', re: /\b(?:jessore|jashore)\b/i },
  { name: 'Mymensingh', re: /\bmymensingh\b/i },
  { name: 'Madrasah', re: /\b(?:madrasah|madrasa|bmeb)\b/i },
  { name: 'Technical', re: /\b(?:technical|bteb)\b/i },
];

/**
 * Known Bangladesh Secondary/Higher Secondary Groups
 */
const BD_GROUPS = [
  { name: 'Science', re: /\bscience\b/i },
  { name: 'Business Studies', re: /\b(?:business\s*studies|commerce|business)\b/i },
  { name: 'Humanities', re: /\b(?:humanities|arts)\b/i },
  { name: 'Vocational', re: /\bvocational\b/i },
  { name: 'General', re: /\bgeneral\b/i },
];

/**
 * Known University Degree Subjects
 */
const BD_SUBJECTS = [
  { name: 'Computer Science & Engineering', re: /\b(?:computer\s*science\s*(?:&|and)?\s*engineering|cse)\b/i },
  { name: 'Electrical & Electronic Engineering', re: /\b(?:electrical\s*(?:&|and)?\s*electronic\s*engineering|eee)\b/i },
  { name: 'Civil Engineering', re: /\bcivil\s*engineering\b/i },
  { name: 'Mechanical Engineering', re: /\bmechanical\s*engineering\b/i },
  { name: 'Software Engineering', re: /\bsoftware\s*engineering\b/i },
  { name: 'Information Technology', re: /\binformation\s*technology\b/i },
  { name: 'Physics', re: /\bphysics\b/i },
  { name: 'Chemistry', re: /\bchemistry\b/i },
  { name: 'Mathematics', re: /\b(?:applied\s*)?mathematics\b/i },
  { name: 'Statistics', re: /\bstatistics\b/i },
  { name: 'English', re: /\benglish\b/i },
  { name: 'Bangla', re: /\b(?:bangla|bengali)\b/i },
  { name: 'Economics', re: /\beconomics\b/i },
  { name: 'Sociology', re: /\bsociology\b/i },
  { name: 'Political Science', re: /\bpolitical\s*science\b/i },
  { name: 'International Relations', re: /\binternational\s*relations\b/i },
  { name: 'Public Administration', re: /\bpublic\s*administration\b/i },
  { name: 'Accounting', re: /\b(?:accounting|accounting\s*&\s*information\s*systems|ais)\b/i },
  { name: 'Finance', re: /\b(?:finance|finance\s*&\s*banking)\b/i },
  { name: 'Management', re: /\bmanagement\b/i },
  { name: 'Marketing', re: /\bmarketing\b/i },
  { name: 'Law', re: /\b(?:law|ll\.?b|ll\.?m)\b/i },
  { name: 'Pharmacy', re: /\bpharmacy\b/i },
  { name: 'Biochemistry', re: /\bbiochemistry\b/i },
  { name: 'Microbiology', re: /\bmicrobiology\b/i },
  { name: 'Agriculture', re: /\bagriculture\b/i },
  { name: 'Botany', re: /\bbotany\b/i },
  { name: 'Zoology', re: /\bzoology\b/i },
];

/**
 * Known Major Universities in Bangladesh
 */
const BD_UNIVERSITIES = [
  { name: 'University of Dhaka', re: /\b(?:university\s*of\s*dhaka|dhaka\s*university|\bdu\b)\b/i },
  { name: 'Bangladesh University of Engineering and Technology', re: /\b(?:buet|engineering\s*and\s*technology)\b/i },
  { name: 'National University', re: /\bnational\s*university\b/i },
  { name: 'University of Rajshahi', re: /\b(?:university\s*of\s*rajshahi|rajshahi\s*university|\bru\b)\b/i },
  { name: 'University of Chittagong', re: /\b(?:university\s*of\s*chittagong|chittagong\s*university|\bcu\b)\b/i },
  { name: 'Jahangirnagar University', re: /\b(?:jahangirnagar\s*university|\bju\b)\b/i },
  { name: 'Shahjalal University of Science and Technology', re: /\b(?:shahjalal|sust)\b/i },
  { name: 'Khulna University', re: /\b(?:khulna\s*university|\bku\b)\b/i },
  { name: 'Islamic University', re: /\bislamic\s*university\b/i },
  { name: 'BRAC University', re: /\bbrac\s*university\b/i },
  { name: 'North South University', re: /\bnorth\s*south\s*university\b/i },
  { name: 'Ahsanullah University of Science and Technology', re: /\b(?:ahsanullah|aust)\b/i },
  { name: 'Daffodil International University', re: /\b(?:daffodil|diu)\b/i },
  { name: 'American International University-Bangladesh', re: /\b(?:aiub|american\s*international)\b/i },
  { name: 'Independent University, Bangladesh', re: /\b(?:iub|independent\s*university)\b/i },
  { name: 'East West University', re: /\b(?:east\s*west\s*university|ewu)\b/i },
  { name: 'United International University', re: /\b(?:united\s*international|uiu)\b/i },
  { name: 'Bangladesh Open University', re: /\b(?:open\s*university|bou)\b/i },
  { name: 'Chittagong University of Engineering & Technology', re: /\bcuet\b/i },
  { name: 'Rajshahi University of Engineering & Technology', re: /\bruet\b/i },
  { name: 'Khulna University of Engineering & Technology', re: /\bkuet\b/i },
  { name: 'Dhaka University of Engineering & Technology', re: /\bduet\b/i },
];

/**
 * Parses the Educational Info table (Examination | Board/University | Roll
 * | Result | Group/Subject | Year | Duration). Both column-boundary bucketing
 * and robust semantic entity extraction are used to ensure that fields are
 * captured with high precision even when column spacing varies.
 * @param {ReturnType<typeof groupWordsIntoRows>} rows
 * @returns {object} partial profile data (only fields that were found)
 */
function extractEducationTableFromRows(rows) {
  const out = {};
  if (!rows || rows.length === 0) return out;

  const headerIdx = rows.findIndex((r) => {
    const t = r.words.map((w) => w.text).join(' ');
    return (/examination|exam/i.test(t) && /roll/i.test(t)) ||
           (/examination|exam/i.test(t) && /result|gpa|cgpa/i.test(t));
  });

  const boundaries = [];
  let colNames = [];

  if (headerIdx !== -1) {
    const headerWords = rows[headerIdx].words;
    for (let i = 1; i < headerWords.length; i++) {
      boundaries.push((headerWords[i - 1].x1 + headerWords[i].x0) / 2);
    }
    colNames = headerWords.map((w) => w.text.toLowerCase());
  }

  function bucketRow(row) {
    if (!boundaries.length || !colNames.length) {
      return { exam: '', board: '', roll: '', result: '', group: '', year: '', duration: '' };
    }
    const cells = colNames.map(() => []);
    for (const w of row.words) {
      let col = 0;
      while (col < boundaries.length && w.x0 >= boundaries[col]) col++;
      if (cells[col]) cells[col].push(w.text);
    }
    const cellFor = (matcher) => {
      const idx = colNames.findIndex(matcher);
      return idx >= 0 ? cells[idx].join(' ').trim() : '';
    };
    return {
      exam: cells[0] ? cells[0].join(' ').trim() : '',
      board: cellFor((c) => c.includes('board') || c.includes('university') || c.includes('inst')),
      roll: cellFor((c) => c.includes('roll')),
      result: cellFor((c) => c.includes('result') || c.includes('gpa') || c.includes('grade')),
      group: cellFor((c) => c.includes('group') || c.includes('subject') || c.includes('dept')),
      year: cellFor((c) => c.includes('year') || c.includes('passing')),
      duration: cellFor((c) => c.includes('duration')),
    };
  }

  const startIdx = headerIdx !== -1 ? headerIdx + 1 : 0;
  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    const rowText = row.words.map((w) => w.text).join(' ');
    if (/other\s*qualif|declare|signature/i.test(rowText)) break;

    // Detect level prefix
    let prefix = null;
    if (/\b(?:s\.?\s*s\.?\s*c\.?|dakhil|secondary\s*school)\b/i.test(rowText)) {
      prefix = 'ssc';
    } else if (/\b(?:h\.?\s*s\.?\s*c\.?|alim|higher\s*secondary|diploma\s*in)\b/i.test(rowText)) {
      prefix = 'hsc';
    } else if (/\b(?:m\.?\s*sc|m\.?\s*a\b|m\.?\s*b\.?\s*a|m\.?\s*com|master|masters|kamil)\b/i.test(rowText)) {
      prefix = 'mas';
    } else if (/\b(?:b\.?\s*sc|b\.?\s*a\b|b\.?\s*b\.?\s*a|b\.?\s*com|bachelor|honou?rs|mbbs|fazil|graduation)\b/i.test(rowText)) {
      prefix = 'gra';
    }
    if (!prefix) continue;

    const cell = bucketRow(row);

    // 1. Exam Name
    if (prefix === 'ssc') {
      out.sscExam = /dakhil/i.test(rowText)
        ? 'Dakhil'
        : (/vocational/i.test(rowText)
          ? 'S.S.C. (Vocational)'
          : (/o[\s\-]level/i.test(rowText) ? 'O Level' : 'S.S.C'));
    } else if (prefix === 'hsc') {
      out.hscExam = /alim/i.test(rowText)
        ? 'Alim'
        : (/diploma/i.test(rowText)
          ? 'Diploma in Engineering'
          : (/bm/i.test(rowText)
            ? 'H.S.C. (BM)'
            : (/vocational/i.test(rowText)
              ? 'H.S.C. (Vocational)'
              : (/a[\s\-]level/i.test(rowText) ? 'A Level' : 'H.S.C'))));
    } else if (prefix === 'gra') {
      out.graExam = /engineering|cse|eee/i.test(rowText)
        ? 'B.Sc (Engineering)'
        : (/b\.?b\.?a/i.test(rowText)
          ? 'B.B.A'
          : (/b\.?a\b/i.test(rowText)
            ? 'B.A (Honours)'
            : (/b\.?com/i.test(rowText)
              ? 'B.Com (Honours)'
              : (/mbbs/i.test(rowText)
                ? 'MBBS'
                : (/honou?rs/i.test(rowText) ? 'Honours' : 'B.Sc (Honours)')))));
      out.bachelor = 'Yes';
    } else if (prefix === 'mas') {
      out.masExam = /m\.?b\.?a/i.test(rowText)
        ? 'M.B.A'
        : (/m\.?a\b/i.test(rowText)
          ? 'M.A'
          : (/m\.?com/i.test(rowText) ? 'M.Com' : 'M.Sc'));
      out.master = 'Yes';
    }

    // 2. Passing Year
    const yearMatch = (cell.year || rowText).match(/\b(19[7-9]\d|20[0-3]\d)\b/);
    if (yearMatch) {
      out[`${prefix}Year`] = yearMatch[1];
    }

    // 3. Roll Number
    if (cell.roll && /^\d{4,10}$/.test(cell.roll.trim())) {
      out[`${prefix}Roll`] = cell.roll.trim();
    } else {
      const allNums = (rowText.match(/\b\d{4,10}\b/g) || []).filter(
        (n) => n !== (yearMatch ? yearMatch[1] : '')
      );
      if (allNums.length > 0) {
        out[`${prefix}Roll`] = allNums[0];
      }
    }

    // 4. Result & Result Type
    const resultMatch =
      (cell.result || rowText).match(/\b([2-5]\.\d{1,2})\b/) ||
      (cell.result || rowText).match(/(\d\.\d{1,2})/);
    if (resultMatch) {
      out[`${prefix}Result`] = resultMatch[1];
      if (prefix === 'ssc' || prefix === 'hsc') {
        out[`${prefix}ResultType`] = 'GPA';
      } else {
        out[`${prefix}ResultType`] = 'CGPA(out of 4)';
      }
    } else if (/1st\s*div|first\s*division|first\s*class/i.test(rowText)) {
      if (prefix === 'ssc' || prefix === 'hsc') {
        out[`${prefix}ResultType`] = 'Division';
        out[`${prefix}Result`] = '1st Division';
      } else {
        out[`${prefix}ResultType`] = 'First Class';
        out[`${prefix}Result`] = 'First Class';
      }
    } else if (/2nd\s*div|second\s*division|second\s*class/i.test(rowText)) {
      if (prefix === 'ssc' || prefix === 'hsc') {
        out[`${prefix}ResultType`] = 'Division';
        out[`${prefix}Result`] = '2nd Division';
      } else {
        out[`${prefix}ResultType`] = 'Second Class';
        out[`${prefix}Result`] = 'Second Class';
      }
    }

    // 5. Board / University / Institute
    if (prefix === 'ssc' || prefix === 'hsc') {
      const boardMatch = BD_BOARDS.find((b) => b.re.test(cell.board || rowText));
      if (boardMatch) {
        out[`${prefix}Board`] = boardMatch.name;
      } else if (cell.board && cell.board.trim().length >= 3) {
        out[`${prefix}Board`] = cell.board.trim();
      }
    } else {
      const uniMatch = BD_UNIVERSITIES.find((u) => u.re.test(cell.board || rowText));
      if (uniMatch) {
        out[`${prefix}Institute`] = uniMatch.name;
      } else if (cell.board && cell.board.trim().length >= 3) {
        out[`${prefix}Institute`] = cell.board.trim();
      } else {
        const uniTextM = rowText.match(
          /([A-Za-z\s]{4,40}(?:University|College|Institute)[A-Za-z\s]{0,20})/i
        );
        if (uniTextM) out[`${prefix}Institute`] = uniTextM[1].trim();
      }
    }

    // 6. Group / Subject
    if (prefix === 'ssc' || prefix === 'hsc') {
      const groupMatch = BD_GROUPS.find((g) => g.re.test(cell.group || rowText));
      if (groupMatch) {
        out[`${prefix}Group`] = groupMatch.name;
      } else if (cell.group && cell.group.trim().length >= 3) {
        out[`${prefix}Group`] = cell.group.trim();
      }
    } else {
      const subMatch = BD_SUBJECTS.find((s) => s.re.test(cell.group || rowText));
      if (subMatch) {
        out[`${prefix}Subject`] = subMatch.name;
      } else if (cell.group && cell.group.trim().length >= 3) {
        const cleaned = cell.group
          .replace(/\b(?:cgpa|gpa|out\s*of|division)\b/gi, '')
          .replace(/[()0-9.]/g, '')
          .trim();
        if (cleaned.length >= 3) out[`${prefix}Subject`] = cleaned;
      }
    }

    // 7. Course Duration
    if (prefix === 'gra') {
      const durM = (cell.duration || rowText).match(/\b0?([345])\s*(?:year|yr|years)?\b/i);
      out.graDuration = durM ? '0' + durM[1] : '04';
    } else if (prefix === 'mas') {
      const durM = (cell.duration || rowText).match(/\b0?([12])\s*(?:year|yr|years)?\b/i);
      out.masDuration = durM ? '0' + durM[1] : '01';
    }
  }

  return out;
}

/**
 * Renders every page of a PDF to an offscreen canvas and runs local OCR
 * (Tesseract.js, English + Bangla) on each page image. Used as a fallback
 * when a PDF has no embedded text layer (e.g. a scanned/image-only form).
 * Entirely local — model files are vendored, no network requests are made.
 * @param {File} file
 * @param {(status: string) => void} [onProgress] optional progress callback
 * @returns {Promise<string>}
 */
async function extractTextFromPdfViaOcr(file, onProgress) {
  ensurePdfJsConfigured();
  ensureTesseractAvailable();

  const arrayBuffer = await readFileAsArrayBuffer(file);
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  const worker = await Tesseract.createWorker('eng+ben', 1, {
    workerPath: chrome.runtime.getURL('lib/tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('lib/tesseract/tesseract-core-lstm.wasm.js'),
    langPath: chrome.runtime.getURL('lib/tesseract/lang-data'),
    gzip: true,
    // IMPORTANT: Tesseract.js defaults to wrapping workerPath in a Blob
    // (workerBlobURL: true) and creating the worker from a blob: URL. That
    // blob-origin worker then tries to importScripts() our
    // chrome-extension://.../worker.min.js URL, which Chrome blocks
    // cross-origin ("Failed to execute 'importScripts' ... failed to
    // load"). Setting this to false makes Tesseract instantiate the worker
    // directly from workerPath instead, which is allowed since the file is
    // declared in web_accessible_resources.
    workerBlobURL: false,
    logger: (msg) => {
      if (onProgress && msg.status) {
        onProgress(msg.status + (msg.progress ? ` (${Math.round(msg.progress * 100)}%)` : ''));
      }
    },
  });

  try {
    const pageTexts = [];
    const pageCanvases = [];
    const allWords = [];
    let tableFields = {};
    // Render at a higher scale than 1:1 for noticeably better OCR accuracy
    // on small form text.
    const RENDER_SCALE = 2;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      if (onProgress) onProgress(`Rendering page ${pageNum} of ${pdf.numPages}`);
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: RENDER_SCALE });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');

      await page.render({ canvasContext: ctx, viewport }).promise;
      pageCanvases.push(canvas);

      if (onProgress) onProgress(`Reading page ${pageNum} of ${pdf.numPages}`);
      const { data } = await worker.recognize(canvas);

      // Prefer position-aware row reconstruction (handles two-column table
      // forms correctly). Fall back to Tesseract's raw text if word boxes
      // are unavailable for some reason.
      const words = data.words && data.words.length ? data.words : null;
      if (words) allWords.push(words);
      const rows = words ? groupWordsIntoRows(words) : [];
      const reconstructed = rows.length ? rowsToLines(rows, canvas.width) : '';

      pageTexts.push(reconstructed || data.text || '');

      // Genuine multi-column tables (Present/Permanent address block,
      // Educational Info table) can't be captured by the flat 2-column
      // reconstruction above, so parse them separately per page and merge
      // in whatever they find.
      if (rows.length) {
        tableFields = {
          ...extractAddressTableFromRows(rows),
          ...extractEducationTableFromRows(rows),
          ...tableFields,
        };
      }
    }

    return { text: pageTexts.join('\n'), tableFields, pageCanvases, allWords, pdf };
  } finally {
    await worker.terminate();
  }
}

/**
 * Extracts all text content from a PDF file, entirely locally via PDF.js.
 * Preserves bounding boxes, groups words into rows, reconstructs structured text lines,
 * and parses multi-column address and education tables.
 * Also returns the loaded PDF document handle and word bounding boxes.
 * @param {File} file
 * @returns {Promise<{text: string, tableFields: object, allWords: Array<Array<object>>, pdf: any}>}
 */
async function extractTextFromPdf(file) {
  ensurePdfJsConfigured();
  const arrayBuffer = await readFileAsArrayBuffer(file);
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    throw new Error(
      'Could not open this PDF (' +
        (err && (err.message || err.name) ? err.message || err.name : 'unknown PDF.js error') +
        '). It may be corrupted, password-protected, or not a valid PDF.'
    );
  }

  const pageTexts = [];
  const allWords = [];
  let tableFields = {};
  const RENDER_SCALE = 2; // Matches pageCanvases scale in extractMediaFromPdf

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const textContent = await page.getTextContent();
    const pageWords = [];

    for (const item of textContent.items) {
      const str = (item.str || '').trim();
      if (!str) continue;

      // Extract coordinates in the canvas viewport space (origin top-left)
      const tx = item.transform[4];
      const ty = item.transform[5];
      const [vx, vy] = viewport.convertToViewportPoint(tx, ty);
      const itemW = (item.width || 0) * RENDER_SCALE;
      const itemH = Math.max(12, (item.height || Math.abs(item.transform[3]) || 12) * RENDER_SCALE);
      const x0 = Math.max(0, vx);
      const y0 = Math.max(0, vy - itemH);
      const x1 = x0 + itemW;
      const y1 = y0 + itemH;

      // Break composite string into individual word tokens if space-separated
      const tokens = str.split(/\s+/).filter(Boolean);
      if (tokens.length > 1) {
        const tokenW = itemW / tokens.length;
        for (let ti = 0; ti < tokens.length; ti++) {
          pageWords.push({
            text: tokens[ti],
            bbox: {
              x0: Math.round(x0 + ti * tokenW),
              y0: Math.round(y0),
              x1: Math.round(x0 + (ti + 1) * tokenW),
              y1: Math.round(y1),
            },
            confidence: 100,
          });
        }
      } else {
        pageWords.push({
          text: str,
          bbox: {
            x0: Math.round(x0),
            y0: Math.round(y0),
            x1: Math.round(x1),
            y1: Math.round(y1),
          },
          confidence: 100,
        });
      }
    }

    allWords.push(pageWords);

    if (pageWords.length) {
      const rows = groupWordsIntoRows(pageWords);
      const reconstructed = rowsToLines(rows, viewport.width);
      pageTexts.push(reconstructed || textContent.items.map((i) => i.str).join(' '));

      tableFields = {
        ...tableFields,
        ...extractAddressTableFromRows(rows),
        ...extractEducationTableFromRows(rows),
      };
    } else {
      pageTexts.push(textContent.items.map((i) => i.str).join(' '));
    }
  }

  return { text: pageTexts.join('\n'), tableFields, allWords, pdf };
}

/**
 * Runs a list of regex patterns against the CV text in order, returning the
 * first non-empty capture group match, trimmed. Patterns are tried in order
 * so more specific/labelled patterns should come first.
 * @param {string} text
 * @param {RegExp[]} patterns
 * @returns {string|null}
 */
function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1] && match[1].trim()) {
      return match[1]
        .trim()
        .replace(/\s{2,}/g, ' ')
        .replace(/^[,;:]+|[,;:]+$/g, '')
        .trim();
    }
  }
  return null;
}

/**
 * Normalizes a matched date string into YYYY-MM-DD where possible.
 * Accepts DD/MM/YYYY, DD-MM-YYYY, "20 December 1994", "December 20, 1994".
 * @param {string} raw
 * @returns {string|null}
 */
function normalizeDate(raw) {
  if (!raw) return null;
  const s = raw.trim();

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY or DD-MM-YYYY
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // "20 December 1994" or "20 Dec 1994"
  const months = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (m) {
    const mon = months[m[2].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[1].padStart(2, '0')}`;
  }

  // "20-Dec-1994" (hyphenated day-month name-year)
  m = s.match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{4})$/);
  if (m) {
    const mon = months[m[2].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[1].padStart(2, '0')}`;
  }

  // "December 20, 1994" or "December 20 1994"
  m = s.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mon = months[m[1].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[2].padStart(2, '0')}`;
  }

  return null; // leave unparsed dates unset rather than guessing wrong
}

/**
 * Extracts profile field values from raw CV text using regex/keyword
 * pattern matching. Entirely local — no network calls. Field labels are
 * matched loosely (case-insensitive, optional colon, flexible spacing) to
 * accommodate varied CV formatting.
 * @param {string} text
 * @returns {object} partial profile data, only fields that were found
 */
function extractFieldsFromText(text) {
  // Normalize whitespace/newlines into single spaces for label matching,
  // but keep an original-lines version for name/first-line heuristics.
  const flat = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const data = {};

  // --- Full name: prefer an explicit "Name:" label, else first non-empty line ---
  data.fullName = firstMatch(flat, [
    /(?:Applicant'?s?|Candidate'?s?)\s*Name\s*[:\-]\s*([A-Za-z.,' 	]{3,60})(?:\n|$)/i,
    /(?:^|\n)\s*Full\s*Name\s*[:\-]\s*([A-Za-z.,' 	]{3,60})(?:\n|$)/i,
    /(?:^|\n)\s*Name\s*[:\-]\s*([A-Za-z.,' 	]{3,60})(?:\n|$)/i
  ]) || (lines[0] && /^[A-Za-z.\s'-]{3,60}$/.test(lines[0]) ? lines[0] : null);

  data.fatherName = firstMatch(flat, [
    /Father'?s?\s*(?:Full\s*)?Name\s*[:\-]\s*([A-Za-z.,' 	]{3,60})/i,
    /Father\s*[:\-]\s*([A-Za-z.,' 	]{3,60})/i
  ]);

  // --- Mother's Name (English) ---
  data.motherName = firstMatch(flat, [
    /(?:Mother'?s?\s*(?:Full\s*)?Name|Name\s*of\s*Mother|Mothers\s*Name)\s*(?:\([^\)]*(?:English|in\s*English)[^\)]*\))?\s*[:\-]\s*([A-Za-z.,' 	]{3,60})/i,
    /Mother'?s?\s*Name\s*[:\-]\s*([A-Za-z.,' 	]{3,60})/i,
    /Mother\s*[:\-]\s*([A-Za-z.,' 	]{3,60})/i,
    new RegExp(`(?:মাতার\\s*নাম\\s*(?:\\([^\\)]*(?:ইংরেজি|English)[^\\)]*\\)))\\s*[:\\-]?\\s*([A-Za-z.,' 	]{3,60})`, 'i')
  ]);

  data.spouseName = firstMatch(flat, [
    /Spouse'?s?\s*Name\s*[:\-]\s*([A-Za-z.,' 	]{3,60})/i,
    /(?:Husband|Wife)'?s?\s*Name\s*[:\-]\s*([A-Za-z.,' 	]{3,60})/i
  ]);

  // --- Full Name (Bangla) & Parents' Bangla Names ---
  const BN = '\\u0980-\\u09FF';
  data.nameBn = firstMatch(flat, [
    new RegExp(`(?:Full\\s*Name|Name)\\s*\\((?:বাংলা|Bangla|Bengali)\\)\\s*[:\\-]?\\s*([${BN}.,' 	]{2,60})`, 'i'),
    new RegExp(`(?:পূর্ণ|প্রার্থীর|আবেদনকারীর)?\\s*নাম\\s*\\((?:বাংলা)\\)\\s*[:\\-]?\\s*([${BN}.,' 	]{2,60})`, 'i'),
    new RegExp(`(?:পূর্ণ|প্রার্থীর|আবেদনকারীর)\\s*নাম\\s*[:\\-]?\\s*([${BN}.,' 	]{2,60})`, 'i'),
    new RegExp(`(?:^|\\n)\\s*নাম\\s*[:\\-]?\\s*([${BN}.,' 	]{2,60})`, 'i'),
    new RegExp(`Name\\s*in\\s*Bangla\\s*[:\\-]?\\s*([${BN}.,' 	]{2,60})`, 'i'),
    new RegExp(`Bangla\\s*Name\\s*[:\\-]?\\s*([${BN}.,' 	]{2,60})`, 'i')
  ]);
  if (!data.nameBn) {
    for (const l of lines) {
      const bnChars = (l.match(/[\u0980-\u09FF]/g) || []).length;
      if (bnChars >= 4 && bnChars > l.length * 0.6 && !/পিতা|মাতা|ঠিকানা|জেলা|পোস্ট|বিভাগ|পরীক্ষা|স্বাক্ষর|কোটা/i.test(l)) {
        data.nameBn = l.replace(/^[:\-\s]+|[:\-\s]+$/g, '').trim();
        break;
      }
    }
  }

  data.fatherBn = firstMatch(flat, [
    new RegExp(`পিতার\\s*নাম\\s*[:\\-]?\\s*([${BN}.,' 	]{2,60})`, 'i'),
    new RegExp(`Father'?s?\\s*Name\\s*\\((?:বাংলা|Bangla)\\)\\s*[:\\-]?\\s*([${BN}.,' 	]{2,60})`, 'i')
  ]);
  data.motherBn = firstMatch(flat, [
    new RegExp(`মাতার\\s*নাম\\s*[:\\-]?\\s*([${BN}.,' 	]{2,60})`, 'i'),
    new RegExp(`Mother'?s?\\s*Name\\s*\\((?:বাংলা|Bangla)\\)\\s*[:\\-]?\\s*([${BN}.,' 	]{2,60})`, 'i')
  ]);

  // --- Date of birth ---
  const dobRaw = firstMatch(flat, [
    /Date\s*of\s*Birth\s*[:\-]\s*([0-9A-Za-z,\/\-\s]{6,25})/i,
    /D\.?O\.?B\.?\s*[:\-]\s*([0-9A-Za-z,\/\-\s]{6,25})/i,
    /Birth\s*Date\s*[:\-]\s*([0-9A-Za-z,\/\-\s]{6,25})/i,
    /জন্ম\s*(?:তারিখ|দিন)\s*[:\-]\s*([0-9A-Za-z,\/\-\s]{6,25})/i
  ]);
  const normalizedDob = normalizeDate(dobRaw);
  if (normalizedDob) data.dateOfBirth = normalizedDob;

  // --- Gender ---
  const genderRaw = firstMatch(flat, [
    /(?:Gender|Sex|লিঙ্গ)\s*[:\-\/]?\s*(Male|Female|Other|পুরুষ|মহিলা|অন্যান্য|M|F)\b/i,
    /(?:Gender|Sex)\s*[:\-]?\s*\[(?:X|x|✓|v)\]\s*(Male|Female|Other)/i
  ]);
  if (genderRaw) {
    const gLower = genderRaw.toLowerCase();
    if (gLower === 'male' || gLower === 'm' || gLower === 'পুরুষ') {
      data.gender = 'Male';
    } else if (gLower === 'female' || gLower === 'f' || gLower === 'মহিলা') {
      data.gender = 'Female';
    } else {
      data.gender = 'Other';
    }
  }

  // --- Nationality ---
  data.nationality = firstMatch(flat, [
    /Nationality\s*[:\-]\s*([A-Za-z 	]{4,30})/i,
    /জাতীয়তা\s*[:\-]\s*([A-Za-z 	\u0980-\u09FF]{4,30})/i
  ]) || 'Bangladeshi';

  // --- Religion ---
  data.religion = firstMatch(flat, [
    /Religion\s*[:\-]\s*([A-Za-z 	]{3,20})/i,
    /ধর্ম\s*[:\-]\s*([A-Za-z 	\u0980-\u09FF]{3,20})/i
  ]);

  // --- Marital status ---
  const maritalRaw = firstMatch(flat, [
    /Marital\s*Status\s*[:\-]\s*(Married|Unmarried|Single|Divorced|Widowed)/i,
    /বৈবাহিক\s*অবস্থা\s*[:\-]\s*(বিবাহিত|অবিবাহিত)/i
  ]);
  if (maritalRaw) {
    if (/বিবাহিত/.test(maritalRaw) && !/অবিবাহিত/.test(maritalRaw)) {
      data.maritalStatus = 'Married';
    } else if (/অবিবাহিত/.test(maritalRaw) || /single|unmarried/i.test(maritalRaw)) {
      data.maritalStatus = 'Single';
    } else {
      data.maritalStatus = maritalRaw[0].toUpperCase() + maritalRaw.slice(1).toLowerCase();
    }
  }

  // --- Blood group ---
  data.bloodGroup = firstMatch(flat, [
    /Blood\s*Group\s*[:\-]\s*(A\+|A-|B\+|B-|AB\+|AB-|O\+|O-)/i,
    /রক্তের\s*গ্রুপ\s*[:\-]\s*(A\+|A-|B\+|B-|AB\+|AB-|O\+|O-)/i
  ]);

  // --- Quota ---
  data.quota = firstMatch(flat, [
    /Quota\s*(?:Type)?\s*[:\-]\s*([A-Za-z0-9&/,\-\s\(\)\u0980-\u09FF]{3,50})(?:\n|$)/i,
    /কোটা\s*[:\-]\s*([A-Za-z0-9&/,\-\s\(\)\u0980-\u09FF]{3,50})(?:\n|$)/i
  ]);
  if (data.quota && /^none|no|n\/a|not\s*applicable|general|non[\s\-]*quota$/i.test(data.quota.trim())) {
    data.quota = 'Non Quota';
  }

  // --- Departmental Candidate Status ---
  data.depStatus = firstMatch(flat, [
    /Departmental\s*(?:Candidate)?\s*(?:Status)?\s*[:\-]\s*([A-Za-z0-9&/,\-\s\.\(\)\u0980-\u09FF]{3,60})(?:\n|$)/i,
    /Dept\.?\s*(?:Candidate)?\s*(?:Status)?\s*[:\-]\s*([A-Za-z0-9&/,\-\s\.\(\)\u0980-\u09FF]{3,60})(?:\n|$)/i,
    /বিভাগীয়\s*প্রার্থ(?:ী|ীর)?\s*(?:অবস্থা|স্ট্যাটাস)?\s*[:\-]\s*([A-Za-z0-9&/,\-\s\.\(\)\u0980-\u09FF]{3,60})(?:\n|$)/i
  ]);
  if (data.depStatus && /^none|no|n\/a|not\s*applicable$/i.test(data.depStatus.trim())) {
    data.depStatus = 'None';
  }

  // --- NID / birth reg / passport ---
  data.nidNo = firstMatch(flat, [
    /N\.?I\.?D\.?\s*(?:No\.?|Number)?\s*[:\-]\s*([0-9]{10,17})/i,
    /National\s*ID\s*(?:No\.?)?\s*[:\-]\s*([0-9]{10,17})/i,
    /জাতীয়\s*পরিচয়পত্র\s*(?:নম্বর|নং)?\s*[:\-]\s*([0-9]{10,17})/i
  ]);
  if (data.nidNo) data.nidType = 'NID';

  data.birthRegNo = firstMatch(flat, [
    /Birth\s*Reg(?:istration)?\.?\s*(?:No\.?)?\s*[:\-]\s*([0-9]{10,20})/i,
    /জন্ম\s*নিবন্ধন\s*(?:নম্বর|নং)?\s*[:\-]\s*([0-9]{10,20})/i
  ]);

  data.passportNo = firstMatch(flat, [
    /Passport\s*(?:No\.?|Number|ID)?\s*[:\-]\s*([A-Z0-9]{6,12})/i
  ]);
  if (data.passportNo && /^n\W*a$/i.test(data.passportNo)) data.passportNo = null;

  // --- Contact info ---
  const mobile = firstMatch(flat, [
    /(?:Mobile|Phone|Cell|Contact)\s*(?:No\.?|Number)?\s*[:\-]\s*(\+?88)?(01[3-9]\d{8})/i,
    /(01[3-9]\d{8})/
  ]) || firstMatch(flat, [/(\+?880\s?1[3-9]\d{8})/]);
  if (mobile) {
    const digitsOnly = mobile.replace(/\D/g, '').replace(/^880/, '0');
    data.mobile = digitsOnly;
    data.mobileConfirm = digitsOnly;
  }

  data.email = firstMatch(flat, [
    /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/
  ]);

  // --- Care Of ---
  data.presentCareOf = firstMatch(flat, [
    /Present\s*(?:Address\s*)?Care\s*Of\s*[:\-]\s*([A-Za-z0-9.,' \u0980-\u09FF]{2,60})/i,
    /(?:Care\s*Of|C\/O|Careof)\s*[:\-]\s*([A-Za-z0-9.,' \u0980-\u09FF]{2,60})/i,
    /অভিভাবক|প্রযোজ্য\s*[:\-]\s*([A-Za-z0-9.,' \u0980-\u09FF]{2,60})/i
  ]);
  data.permanentCareOf = firstMatch(flat, [
    /Permanent\s*(?:Address\s*)?Care\s*Of\s*[:\-]\s*([A-Za-z0-9.,' \u0980-\u09FF]{2,60})/i
  ]) || data.presentCareOf;

  // --- Address blocks ---
  data.presentAddress = firstMatch(flat, [
    /Present\s*Address\s*[:\-]\s*([^\n]{5,120})/i,
    /বর্তমান\s*ঠিকানা\s*[:\-]\s*([^\n]{5,120})/i
  ]);
  data.permanentAddress = firstMatch(flat, [
    /Permanent\s*Address\s*[:\-]\s*([^\n]{5,120})/i,
    /স্থায়ী\s*ঠিকানা\s*[:\-]\s*([^\n]{5,120})/i
  ]);
  data.presentDistrict = firstMatch(flat, [
    /Present\s*(?:Address\s*)?District\s*[:\-]\s*([A-Za-z\s\u0980-\u09FF]{3,30})/i
  ]);
  data.permanentDistrict = firstMatch(flat, [
    /Permanent\s*(?:Address\s*)?District\s*[:\-]\s*([A-Za-z\s\u0980-\u09FF]{3,30})/i
  ]);
  data.presentPostcode = firstMatch(flat, [
    /Present\s*(?:Address\s*)?Post\s*[- ]?Code\s*[:\-]\s*(\d{4})/i
  ]);
  data.permanentPostcode = firstMatch(flat, [
    /Permanent\s*(?:Address\s*)?Post\s*[- ]?Code\s*[:\-]\s*(\d{4})/i
  ]);

  data.fatherOccupation = firstMatch(flat, [
    /Father'?s?\s*Occupation\s*[:\-]\s*([A-Za-z 	\u0980-\u09FF]{3,40})/i
  ]);

  // --- SSC / Equivalent ---
  data.sscExam = firstMatch(flat, [
    /S\.?S\.?C\.?[^\n]*(?:Exam|Examination)\s*[:\-]\s*([A-Za-z\s\/\.]{3,30})/i,
    /(?:Examination|Exam)\s*[:\-]\s*(S\.?S\.?C\.?|Dakhil|O[\s\-]?Level|S\.?S\.?C\.?\s*Vocational)/i
  ]) || (flat.includes('S.S.C') || flat.includes('SSC') ? 'S.S.C' : (flat.includes('Dakhil') ? 'Dakhil' : null));

  data.sscRoll = firstMatch(flat, [
    /S\.?S\.?C\.?[^\n]*Roll\s*(?:No\.?)?\s*[:\-]\s*(\d{4,10})/i,
    /Roll\s*(?:No\.?)?[^\n]{0,20}(?:SSC|S\.S\.C)[^\n]{0,20}[:\-]\s*(\d{4,10})/i
  ]);

  data.sscGroup = firstMatch(flat, [
    /S\.?S\.?C\.?[^\n]*Group\s*[:\-]\s*([A-Za-z\s]{3,30})/i
  ]);
  if (!data.sscGroup) {
    const sscGrpM = flat.match(/S\.?S\.?C\.?[^\n]*(Science|Commerce|Arts|Humanities|Business\s*Studies|Vocational)/i);
    if (sscGrpM) data.sscGroup = sscGrpM[1];
  }

  data.sscBoard = firstMatch(flat, [
    /S\.?S\.?C\.?[^\n]*Board\s*[:\-]\s*([A-Za-z\s]{3,25})/i
  ]);

  data.sscResult = firstMatch(flat, [
    /S\.?S\.?C\.?[^\n]*(?:GPA|Result|CGPA)\s*[:\-]\s*(\d\.\d{1,2})/i,
    /S\.?S\.?C\.?[^\n]*Result\s*[:\-]\s*([A-Za-z0-9\.\s]{3,20})/i
  ]);

  data.sscResultType = firstMatch(flat, [
    /S\.?S\.?C\.?[^\n]*Result\s*Type\s*[:\-]\s*([A-Za-z0-9\(\)\s]{3,20})/i
  ]) || (data.sscResult && /\d\.\d+/.test(data.sscResult) ? 'GPA' : (data.sscResult && /division|class/i.test(data.sscResult) ? 'Division' : null));

  data.sscYear = firstMatch(flat, [
    /S\.?S\.?C\.?[^\n]*(?:Passing\s*Year|Year)\s*[:\-]\s*(\d{4})/i,
    /S\.?S\.?C\.?[^\n]{0,80}(?<!\d)((?:19|20)\d{2})(?!\d)/i
  ]);

  // --- HSC / Equivalent ---
  data.hscExam = firstMatch(flat, [
    /H\.?S\.?C\.?[^\n]*(?:Exam|Examination)\s*[:\-]\s*([A-Za-z\s\/\.]{3,30})/i,
    /(?:Examination|Exam)\s*[:\-]\s*(H\.?S\.?C\.?|Alim|A[\s\-]?Level|H\.?S\.?C\.?\s*Vocational|Diploma)/i
  ]) || (flat.includes('H.S.C') || flat.includes('HSC') ? 'H.S.C' : (flat.includes('Alim') ? 'Alim' : null));

  data.hscRoll = firstMatch(flat, [
    /H\.?S\.?C\.?[^\n]*Roll\s*(?:No\.?)?\s*[:\-]\s*(\d{4,10})/i
  ]);

  data.hscGroup = firstMatch(flat, [
    /H\.?S\.?C\.?[^\n]*Group\s*[:\-]\s*([A-Za-z\s]{3,30})/i
  ]);
  if (!data.hscGroup) {
    const hscGrpM = flat.match(/H\.?S\.?C\.?[^\n]*(Science|Commerce|Arts|Humanities|Business\s*Studies|Vocational)/i);
    if (hscGrpM) data.hscGroup = hscGrpM[1];
  }

  data.hscBoard = firstMatch(flat, [
    /H\.?S\.?C\.?[^\n]*Board\s*[:\-]\s*([A-Za-z\s]{3,25})/i
  ]);

  data.hscResult = firstMatch(flat, [
    /H\.?S\.?C\.?[^\n]*(?:GPA|Result|CGPA)\s*[:\-]\s*(\d\.\d{1,2})/i,
    /H\.?S\.?C\.?[^\n]*Result\s*[:\-]\s*([A-Za-z0-9\.\s]{3,20})/i
  ]);

  data.hscResultType = firstMatch(flat, [
    /H\.?S\.?C\.?[^\n]*Result\s*Type\s*[:\-]\s*([A-Za-z0-9\(\)\s]{3,20})/i
  ]) || (data.hscResult && /\d\.\d+/.test(data.hscResult) ? 'GPA' : (data.hscResult && /division|class/i.test(data.hscResult) ? 'Division' : null));

  data.hscYear = firstMatch(flat, [
    /H\.?S\.?C\.?[^\n]*(?:Passing\s*Year|Year)\s*[:\-]\s*(\d{4})/i,
    /H\.?S\.?C\.?[^\n]{0,80}(?<!\d)((?:19|20)\d{2})(?!\d)/i
  ]);

  // --- Graduation / Bachelor's ---
  data.graExam = firstMatch(flat, [
    /(?:Graduation|Bachelor'?s?)[^\n]*(?:Exam|Examination)\s*[:\-]\s*([A-Za-z\s\/\.]{3,40})/i,
    /(?:Examination|Exam)[^\n]{0,20}[:\-]\s*(B\.?Sc\.?|B\.?A\.?|B\.?B\.?A\.?|B\.?Com\.?|B\.?S\.?S\.?|LL\.?B|MBBS|Bachelor[A-Za-z\s]*)/i
  ]);
  if (!data.graExam && /(?:B\.?Sc\.?|Bachelor|B\.?B\.?A\.?|B\.?A\b|Honours)/i.test(flat)) {
    data.graExam = /engineering|cse|eee/i.test(flat)
      ? 'B.Sc (Engineering)'
      : (/b\.?b\.?a/i.test(flat)
        ? 'B.B.A'
        : (/b\.?a\b/i.test(flat) ? 'B.A (Honours)' : 'B.Sc (Honours)'));
    data.bachelor = 'Yes';
  }

  data.graInstitute = firstMatch(flat, [
    /(?:B\.?Sc\.?|B\.?A\.?|B\.?B\.?A\.?|Bachelor)[^\n]*(?:from|,)\s*([A-Za-z\s]{5,60}(?:University|College|Institute))/i,
    /Bachelor'?s?[^\n]*Institut(?:e|ion)\s*[:\-]\s*([A-Za-z\s]{5,60})/i
  ]);

  data.graSubject = firstMatch(flat, [
    /(?:B\.?Sc\.?|Bachelor)[^\n]*in\s+([A-Za-z 	]{3,40})/i,
    /(?:Graduation|Bachelor)[^\n]*(?:Subject|Dept)\s*[:\-]\s*([A-Za-z 	]{3,40})/i
  ]);

  data.graResult = firstMatch(flat, [
    /(?:B\.?Sc\.?|Bachelor|Graduation)[^\n]*(?:CGPA|GPA)\s*[:\-]?\s*(\d\.\d{1,2})/i,
    /(?:B\.?Sc\.?|Bachelor|Graduation)[^\n]*Result\s*[:\-]?\s*([A-Za-z0-9\.\s]{3,20})/i
  ]);

  data.graResultType = firstMatch(flat, [
    /(?:Graduation|Bachelor'?s?)[^\n]*Result\s*Type\s*[:\-]\s*([A-Za-z0-9\(\)\s]{3,25})/i
  ]) || (data.graResult && /\d\.\d+/.test(data.graResult) ? 'CGPA(out of 4)' : (data.graResult && /class|division/i.test(data.graResult) ? 'First Class' : null));

  data.graYear = firstMatch(flat, [
    /(?:B\.?Sc\.?|Bachelor|Graduation)[^\n]*(?:Passing\s*Year|Year)\s*[:\-]\s*(\d{4})/i,
    /(?:B\.?Sc\.?|Bachelor)[^\n]{0,60}(\d{4})/i
  ]);
  data.graDuration = data.graDuration || '04';

  // --- Masters ---
  data.masExam = firstMatch(flat, [
    /(?:Masters?|Master'?s?)[^\n]*(?:Exam|Examination)\s*[:\-]\s*([A-Za-z\s\/\.]{3,40})/i,
    /(?:Examination|Exam)[^\n]{0,20}[:\-]\s*(M\.?Sc\.?|M\.?A\.?|M\.?B\.?A\.?|M\.?Com\.?|M\.?S\.?S\.?|LL\.?M|Master[A-Za-z\s]*)/i
  ]);
  if (!data.masExam && /(?:M\.?Sc\.?|Master'?s?|M\.?B\.?A\.?|M\.?A\b)/i.test(flat)) {
    data.masExam = /m\.?b\.?a/i.test(flat)
      ? 'M.B.A'
      : (/m\.?a\b/i.test(flat) ? 'M.A' : 'M.Sc');
    data.master = 'Yes';
  }

  data.masInstitute = firstMatch(flat, [
    /(?:M\.?Sc\.?|M\.?A\.?|M\.?B\.?A\.?|Master'?s?)[^\n]*(?:from|,)\s*([A-Za-z\s]{5,60}(?:University|College|Institute))/i,
    /Master'?s?[^\n]*Institut(?:e|ion)\s*[:\-]\s*([A-Za-z\s]{5,60})/i
  ]);

  data.masSubject = firstMatch(flat, [
    /(?:M\.?Sc\.?|Master'?s?)[^\n]*in\s+([A-Za-z 	]{3,40})/i,
    /(?:Masters?|Master)[^\n]*(?:Subject|Dept)\s*[:\-]\s*([A-Za-z 	]{3,40})/i
  ]);

  data.masResult = firstMatch(flat, [
    /(?:M\.?Sc\.?|Master'?s?)[^\n]*(?:CGPA|GPA)\s*[:\-]?\s*(\d\.\d{1,2})/i,
    /(?:M\.?Sc\.?|Master'?s?)[^\n]*Result\s*[:\-]?\s*([A-Za-z0-9\.\s]{3,20})/i
  ]);

  data.masResultType = firstMatch(flat, [
    /(?:Masters?|Master'?s?)[^\n]*Result\s*Type\s*[:\-]\s*([A-Za-z0-9\(\)\s]{3,25})/i
  ]) || (data.masResult && /\d\.\d+/.test(data.masResult) ? 'CGPA(out of 4)' : (data.masResult && /class|division/i.test(data.masResult) ? 'First Class' : null));

  data.masYear = firstMatch(flat, [
    /(?:M\.?Sc\.?|Master'?s?)[^\n]*(?:Passing\s*Year|Year)\s*[:\-]\s*(\d{4})/i,
    /(?:M\.?Sc\.?|Master'?s?)[^\n]{0,60}(\d{4})/i
  ]);
  data.masDuration = data.masDuration || '01';

  // --- Skills / experience flags (keyword presence, not labelled fields) ---
  data.experienceComputer = /computer\s*(?:literate|skills?|experience)/i.test(flat) ? 'Yes' : null;
  data.experienceSatlipi = /(typing\s*speed|satlipi|words?\s*per\s*minute|wpm)/i.test(flat) ? 'Yes' : null;

  // Strip null/empty values so callers can treat "not present" uniformly.
  for (const key of Object.keys(data)) {
    if (data[key] === null || data[key] === undefined || data[key] === '') {
      delete data[key];
    }
  }

  return data;
}

/**
 * Safely fetches a PDF.js image object from page.objs or page.commonObjs
 * @param {object} page PDF.js page proxy
 * @param {string} objId
 * @returns {Promise<any>}
 */
function getPdfObject(page, objId) {
  return new Promise((resolve) => {
    if (!objId) return resolve(null);
    try {
      if (page.objs && typeof page.objs.get === 'function') {
        page.objs.get(objId, (obj) => {
          if (obj) return resolve(obj);
          if (page.commonObjs && typeof page.commonObjs.get === 'function') {
            page.commonObjs.get(objId, resolve);
          } else {
            resolve(null);
          }
        });
      } else if (page.commonObjs && typeof page.commonObjs.get === 'function') {
        page.commonObjs.get(objId, resolve);
      } else {
        resolve(null);
      }
    } catch (e) {
      resolve(null);
    }
  });
}

/**
 * Converts a PDF.js image object or data dictionary to an HTMLCanvasElement
 * @param {any} obj
 * @returns {HTMLCanvasElement|null}
 */
function imageObjToCanvas(obj) {
  if (!obj) return null;
  const w = obj.width || (obj.data && obj.width);
  const h = obj.height || (obj.data && obj.height);
  if (!w || !h) return null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  if (typeof ImageBitmap !== 'undefined' && obj instanceof ImageBitmap) {
    ctx.drawImage(obj, 0, 0);
    return canvas;
  }
  if (obj instanceof HTMLImageElement || obj instanceof HTMLCanvasElement) {
    ctx.drawImage(obj, 0, 0);
    return canvas;
  }

  if (obj.data) {
    const imgData = ctx.createImageData(w, h);
    const src = obj.data;
    const dst = imgData.data;
    if (src.length === w * h * 4) {
      dst.set(src);
    } else if (src.length === w * h * 3) {
      for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
        dst[j] = src[i];
        dst[j + 1] = src[i + 1];
        dst[j + 2] = src[i + 2];
        dst[j + 3] = 255;
      }
    } else if (src.length === w * h) {
      for (let i = 0, j = 0; i < src.length; i++, j += 4) {
        dst[j] = src[i];
        dst[j + 1] = src[i];
        dst[j + 2] = src[i];
        dst[j + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }
  return null;
}

/**
 * Checks if a canvas contains meaningful non-uniform visual image content
 * (avoids mistaking empty white background or solid color blocks for photos).
 * @param {HTMLCanvasElement} canvas
 * @param {number} [minVariance]
 * @returns {boolean}
 */
function hasImageContent(canvas, minVariance = 12) {
  if (!canvas || canvas.width < 30 || canvas.height < 30) return false;
  try {
    const ctx = canvas.getContext('2d');
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0, sumSq = 0, count = 0;
    const step = Math.max(1, Math.floor(d.length / 4000));
    for (let i = 0; i < d.length; i += step * 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sum += lum;
      sumSq += lum * lum;
      count++;
    }
    if (count === 0) return false;
    const mean = sum / count;
    const variance = Math.sqrt(Math.max(0, sumSq / count - mean * mean));
    return variance >= minVariance;
  } catch (e) {
    return false;
  }
}

/**
 * Checks if a canvas contains dark ink strokes (signature)
 * @param {HTMLCanvasElement} canvas
 * @param {number} [threshold]
 * @param {number} [minDarkPixels]
 * @returns {boolean}
 */
function hasSignatureInk(canvas, threshold = 210, minDarkPixels = 40) {
  if (!canvas || canvas.width < 40 || canvas.height < 15) return false;
  try {
    const ctx = canvas.getContext('2d');
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let darkPixels = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (lum < threshold) {
        darkPixels++;
        if (darkPixels >= minDarkPixels) return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Crops the photo region from a document canvas using Human Face & Skin Tone recognition.
 * If a human face is found, perfectly centers a 1:1 passport crop on the face and shoulders,
 * eliminating outside text, form headers, and unwanted document margins.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Array<object>} [words]
 * @returns {HTMLCanvasElement|null}
 */
function cropPhotoFromCanvas(canvas, words = []) {
  if (!canvas || !window.ImageTools) return null;
  const w = canvas.width;
  const h = canvas.height;

  // 1. Primary: Search standard Bangladeshi job application photo quadrant: Top-Right (48% to 98% X, 1% to 42% Y)
  const topRxZone = {
    x: Math.round(w * 0.48),
    y: Math.round(h * 0.01),
    w: Math.round(w * 0.50),
    h: Math.round(h * 0.42),
  };
  const trFace = window.ImageTools.detectFaceRegion(canvas, topRxZone, words);
  if (trFace && trFace.faceFound && trFace.cropRect) {
    const r = trFace.cropRect;
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = r.w;
    cropCanvas.height = r.h;
    cropCanvas.getContext('2d').drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    cropCanvas._cropRect = r;
    return cropCanvas;
  }

  // 2. Secondary: Search upper 65% of the document (covers Top-Left or centered photos)
  const upperZone = {
    x: 0,
    y: 0,
    w: w,
    h: Math.round(h * 0.65),
  };
  const faceResult = window.ImageTools.detectFaceRegion(canvas, upperZone, words);
  if (faceResult && faceResult.faceFound && faceResult.cropRect) {
    const r = faceResult.cropRect;
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = r.w;
    cropCanvas.height = r.h;
    cropCanvas.getContext('2d').drawImage(
      canvas,
      r.x, r.y, r.w, r.h,
      0, 0, r.w, r.h
    );
    cropCanvas._cropRect = r;
    return cropCanvas;
  }

  // 3. Fallback: Bounded candidate zones
  const candidateZones = [
    topRxZone,
    { x: Math.round(w * 0.02), y: Math.round(h * 0.02), w: Math.round(w * 0.46), h: Math.round(h * 0.38) },
  ];

  for (const zone of candidateZones) {
    const subFace = window.ImageTools.detectFaceRegion(canvas, zone, words);
    if (subFace && subFace.faceFound && subFace.cropRect) {
      const r = subFace.cropRect;
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = r.w;
      cropCanvas.height = r.h;
      cropCanvas.getContext('2d').drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      cropCanvas._cropRect = r;
      return cropCanvas;
    }
  }

  // 4. Fallback: Bounded high-variance photo box (excluding uniform text blocks)
  for (const zone of candidateZones) {
    const testCanvas = document.createElement('canvas');
    testCanvas.width = zone.w;
    testCanvas.height = zone.h;
    testCanvas.getContext('2d').drawImage(canvas, zone.x, zone.y, zone.w, zone.h, 0, 0, zone.w, zone.h);
    if (hasImageContent(testCanvas, 18)) {
      testCanvas._cropRect = zone;
      return testCanvas;
    }
  }

  return null;
}

/**
 * Crops the signature region from a document canvas using multi-zone keyword inspection,
 * baseline detection, or cursive ink cluster analysis.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Array<object>} [words]
 * @returns {HTMLCanvasElement|null}
 */
function cropSignatureFromCanvas(canvas, words = []) {
  if (!canvas || !window.ImageTools) return null;
  const w = canvas.width;
  const h = canvas.height;

  // 1. Keyword search across OCR words (English & Bengali)
  const sigKeywords = ['signature', 'sign', 'applicant', 'candidate', 'স্বাক্ষর', 'দস্তখত', 'প্রার্থী', 'আবেদনকারী'];
  const keywordBoxes = [];

  if (words && words.length) {
    for (const word of words) {
      const txt = (word.text || '').toLowerCase().trim();
      const isMatch = sigKeywords.some(kw => txt.includes(kw) && !txt.includes('design') && !txt.includes('assign'));
      if (isMatch && word.bbox && word.bbox.y0 > h * 0.35) {
        keywordBoxes.push(word.bbox);
      }
    }
  }

  for (const bbox of keywordBoxes) {
    const kwW = Math.max(60, bbox.x1 - bbox.x0);
    const kwH = Math.max(16, bbox.y1 - bbox.y0);

    // Zone A: Above the keyword label (where candidates sign above "Signature of Applicant")
    const zoneAbove = {
      x: Math.max(0, Math.round(bbox.x0 - kwW * 0.6)),
      y: Math.max(0, Math.round(bbox.y0 - Math.max(65, kwW * 1.2))),
      w: Math.min(w, Math.round(kwW * 2.6)),
      h: Math.round(Math.max(60, kwW * 1.2)),
    };
    const resAbove = window.ImageTools.detectSignatureRegion(canvas, zoneAbove);
    if (resAbove && resAbove.inkCount >= 35) {
      const c = document.createElement('canvas');
      c.width = resAbove.w;
      c.height = resAbove.h;
      c.getContext('2d').drawImage(canvas, resAbove.x, resAbove.y, resAbove.w, resAbove.h, 0, 0, resAbove.w, resAbove.h);
      c._cropRect = resAbove;
      return c;
    }

    // Zone B: Below the keyword label (e.g. "Applicant's Signature:" with box below)
    const zoneBelow = {
      x: Math.max(0, Math.round(bbox.x0 - kwW * 0.3)),
      y: Math.min(h - 40, Math.round(bbox.y1 + 4)),
      w: Math.min(w, Math.round(kwW * 2.5)),
      h: Math.round(Math.max(55, kwW * 1.0)),
    };
    const resBelow = window.ImageTools.detectSignatureRegion(canvas, zoneBelow);
    if (resBelow && resBelow.inkCount >= 35) {
      const c = document.createElement('canvas');
      c.width = resBelow.w;
      c.height = resBelow.h;
      c.getContext('2d').drawImage(canvas, resBelow.x, resBelow.y, resBelow.w, resBelow.h, 0, 0, resBelow.w, resBelow.h);
      c._cropRect = resBelow;
      return c;
    }

    // Zone C: To the right of the keyword label (e.g. "Signature: [    ]")
    const zoneRight = {
      x: Math.min(w - 60, Math.round(bbox.x1 + 6)),
      y: Math.max(0, Math.round(bbox.y0 - 20)),
      w: Math.min(w - bbox.x1 - 6, Math.max(180, kwW * 2.2)),
      h: Math.round(Math.max(50, kwH * 3.0)),
    };
    const resRight = window.ImageTools.detectSignatureRegion(canvas, zoneRight);
    if (resRight && resRight.inkCount >= 35) {
      const c = document.createElement('canvas');
      c.width = resRight.w;
      c.height = resRight.h;
      c.getContext('2d').drawImage(canvas, resRight.x, resRight.y, resRight.w, resRight.h, 0, 0, resRight.w, resRight.h);
      c._cropRect = resRight;
      return c;
    }
  }

  // 2. Horizontal baseline / rule line search in lower 45% of page
  try {
    const ctx = canvas.getContext('2d');
    const startY = Math.round(h * 0.52);
    const checkH = Math.round(h * 0.44);
    const sampleData = ctx.getImageData(0, startY, w, checkH).data;

    let bestLineY = -1;
    let bestLineX0 = -1;
    let bestLineLen = 0;

    for (let ly = 10; ly < checkH - 10; ly += 3) {
      let runLen = 0;
      let runStart = 0;
      for (let lx = 10; lx < w - 10; lx += 4) {
        const idx = (ly * w + lx) * 4;
        const lum = 0.299 * sampleData[idx] + 0.587 * sampleData[idx + 1] + 0.114 * sampleData[idx + 2];
        if (lum < 160) {
          if (runLen === 0) runStart = lx;
          runLen += 4;
        } else {
          if (runLen > bestLineLen && runLen >= 60 && runLen <= 400) {
            bestLineLen = runLen;
            bestLineX0 = runStart;
            bestLineY = startY + ly;
          }
          runLen = 0;
        }
      }
    }

    if (bestLineY > 0 && bestLineLen >= 60) {
      const zoneLine = {
        x: Math.max(0, bestLineX0 - 20),
        y: Math.max(0, bestLineY - 85),
        w: Math.min(w - bestLineX0, bestLineLen + 40),
        h: 80,
      };
      const resLine = window.ImageTools.detectSignatureRegion(canvas, zoneLine);
      if (resLine && resLine.inkCount >= 30) {
        const c = document.createElement('canvas');
        c.width = resLine.w;
        c.height = resLine.h;
        c.getContext('2d').drawImage(canvas, resLine.x, resLine.y, resLine.w, resLine.h, 0, 0, resLine.w, resLine.h);
        c._cropRect = resLine;
        return c;
      }
    }
  } catch (lineErr) {
    console.warn('Baseline search warning:', lineErr);
  }

  // 3. Fallback: Search candidate quadrants across the lower half of the document
  const candidateQuadrants = [
    // Bottom-Right (standard Teletalk applicant signature position)
    { x: Math.round(w * 0.45), y: Math.round(h * 0.68), w: Math.round(w * 0.52), h: Math.round(h * 0.29) },
    // Bottom-Left
    { x: Math.round(w * 0.04), y: Math.round(h * 0.68), w: Math.round(w * 0.50), h: Math.round(h * 0.29) },
    // Bottom-Center
    { x: Math.round(w * 0.22), y: Math.round(h * 0.65), w: Math.round(w * 0.56), h: Math.round(h * 0.32) },
    // Mid-Right (for single-page compact forms)
    { x: Math.round(w * 0.45), y: Math.round(h * 0.45), w: Math.round(w * 0.52), h: Math.round(h * 0.25) },
  ];

  for (const quad of candidateQuadrants) {
    const res = window.ImageTools.detectSignatureRegion(canvas, quad);
    if (res && res.inkCount >= 35 && res.w >= 50 && res.h >= 15) {
      const c = document.createElement('canvas');
      c.width = res.w;
      c.height = res.h;
      c.getContext('2d').drawImage(canvas, res.x, res.y, res.w, res.h, 0, 0, res.w, res.h);
      c._cropRect = res;
      return c;
    }
  }

  return null;
}

/**
 * Extracts passport photo (300x300px) and signature (300x80px) from a PDF.
 * Checks embedded XObjects with face & ink validation, then falls back to visual canvas detection.
 *
 * @param {object} pdf PDF.js document handle
 * @param {Array<HTMLCanvasElement>} [pageCanvases]
 * @param {Array<Array<object>>} [wordsList]
 * @param {(status: string) => void} [onProgress]
 * @returns {Promise<{photo: object|null, signature: object|null, photoSourceCanvas: HTMLCanvasElement|null, signatureSourceCanvas: HTMLCanvasElement|null}>}
 */
async function extractMediaFromPdf(pdf, pageCanvases = [], wordsList = [], onProgress) {
  let photo = null;
  let signature = null;
  let photoSourceCanvas = null;
  let signatureSourceCanvas = null;

  if (onProgress) onProgress('Scanning PDF for passport photo & signature...');

  // 1. Scan embedded PDF images (XObjects) across all pages
  if (pdf && pdf.numPages) {
    try {
      const candidates = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const ops = await page.getOperatorList();
        const fnArray = ops.fnArray;
        const argsArray = ops.argsArray;

        for (let i = 0; i < fnArray.length; i++) {
          const fn = fnArray[i];
          if (fn === pdfjsLib.OPS.paintImageXObject || fn === pdfjsLib.OPS.paintInlineImageXObject) {
            const objId = argsArray[i][0];
            try {
              const rawObj = await getPdfObject(page, objId);
              const imgCanvas = imageObjToCanvas(rawObj);
              if (imgCanvas && imgCanvas.width >= 35 && imgCanvas.height >= 15) {
                const skinRatio = window.ImageTools ? window.ImageTools.getSkinDensity(imgCanvas) : 0;
                candidates.push({
                  canvas: imgCanvas,
                  width: imgCanvas.width,
                  height: imgCanvas.height,
                  ratio: imgCanvas.width / imgCanvas.height,
                  skinRatio,
                  pageNum: p,
                });
              }
            } catch (e) {}
          }
        }
      }

      // Identify Photo candidate: MUST have human skin tones (skinRatio >= 0.03) and size >= 55x55
      const photoCandidates = candidates.filter(
        (c) => c.skinRatio >= 0.03 && c.width >= 55 && c.height >= 55
      );
      photoCandidates.sort((a, b) => {
        const scoreA = a.skinRatio * 2 + (a.ratio >= 0.7 && a.ratio <= 1.4 ? 1 : 0);
        const scoreB = b.skinRatio * 2 + (b.ratio >= 0.7 && b.ratio <= 1.4 ? 1 : 0);
        return scoreB - scoreA;
      });

      if (photoCandidates.length > 0 && window.ImageTools) {
        const bestPhoto = photoCandidates[0];
        photoSourceCanvas = bestPhoto.canvas;
        photo = await window.ImageTools.processPhotoCanvas(bestPhoto.canvas, {
          targetW: 300,
          targetH: 300,
          maxKB: 100,
          faceDetect: true,
        });
      }

      // Identify Signature candidate:
      // ZERO or negligible skin tones (skinRatio < 0.02), has distinct ink strokes, width >= 50, height >= 15
      const sigCandidates = candidates.filter((c) => {
        if (c.skinRatio >= 0.02) return false;
        if (photoCandidates.length > 0 && c === photoCandidates[0]) return false;
        return c.width >= 50 && c.height >= 15 && hasSignatureInk(c.canvas, 220, 20);
      });

      sigCandidates.sort((a, b) => {
        const diffA = Math.abs(a.ratio - 3.75);
        const diffB = Math.abs(b.ratio - 3.75);
        return diffA - diffB;
      });

      if (sigCandidates.length > 0 && window.ImageTools) {
        const bestSig = sigCandidates[0];
        signatureSourceCanvas = bestSig.canvas;
        signature = await window.ImageTools.processSignatureCanvas(bestSig.canvas, {
          targetW: 300,
          targetH: 80,
          maxKB: 60,
        });
      }
    } catch (xErr) {
      console.warn('XObject media extraction warning:', xErr);
    }
  }

  // 2. Fallback: If either media is missing, render page canvases
  if ((!photo || !signature) && pdf && pdf.numPages) {
    if (!pageCanvases || pageCanvases.length === 0) {
      const RENDER_SCALE = 2;
      try {
        const p1 = await pdf.getPage(1);
        const v1 = p1.getViewport({ scale: RENDER_SCALE });
        const c1 = document.createElement('canvas');
        c1.width = v1.width;
        c1.height = v1.height;
        await p1.render({ canvasContext: c1.getContext('2d'), viewport: v1 }).promise;
        pageCanvases = [c1];

        if (pdf.numPages > 1) {
          const pLast = await pdf.getPage(pdf.numPages);
          const vLast = pLast.getViewport({ scale: RENDER_SCALE });
          const cLast = document.createElement('canvas');
          cLast.width = vLast.width;
          cLast.height = vLast.height;
          await pLast.render({ canvasContext: cLast.getContext('2d'), viewport: vLast }).promise;
          pageCanvases.push(cLast);
        }
      } catch (rErr) {
        console.warn('Canvas rendering for media extraction warning:', rErr);
      }
    }

    const firstCanvas = pageCanvases[0];
    const lastCanvas = pageCanvases[pageCanvases.length - 1];

    if (!photo && firstCanvas && window.ImageTools) {
      try {
        const page1Words = (wordsList && wordsList[0]) || (wordsList || []).flat();
        const crop = cropPhotoFromCanvas(firstCanvas, page1Words);
        if (crop) {
          photoSourceCanvas = firstCanvas;
          photo = await window.ImageTools.processPhotoCanvas(crop, {
            targetW: 300,
            targetH: 300,
            maxKB: 100,
            faceDetect: true,
          });
          if (photo) photo._cropRect = crop._cropRect;
        }
      } catch (e) {
        console.warn('Visual photo detection error:', e);
      }
    }

    if (!signature && window.ImageTools) {
      const pagesToCheck = [lastCanvas];
      if (firstCanvas && firstCanvas !== lastCanvas) pagesToCheck.push(firstCanvas);

      for (const pCanvas of pagesToCheck) {
        if (!pCanvas) continue;
        try {
          const allWords = (wordsList || []).flat();
          const crop = cropSignatureFromCanvas(pCanvas, allWords);
          if (crop) {
            signatureSourceCanvas = pCanvas;
            signature = await window.ImageTools.processSignatureCanvas(crop, {
              targetW: 300,
              targetH: 80,
              maxKB: 60,
            });
            if (signature) signature._cropRect = crop._cropRect;
            break;
          }
        } catch (e) {
          console.warn('Visual signature detection error:', e);
        }
      }
    }
  }

  return { photo, signature, photoSourceCanvas, signatureSourceCanvas };
}

/**
 * Extracts form fields, passport photo, and signature from an uploaded image file
 * @param {File} file
 * @param {(status: string) => void} [onProgress]
 * @returns {Promise<{fields: object, photo: object|null, signature: object|null, photoSourceCanvas: HTMLCanvasElement, signatureSourceCanvas: HTMLCanvasElement}>}
 */
async function extractFromImage(file, onProgress) {
  ensureTesseractAvailable();
  if (onProgress) onProgress('Loading document image...');
  const img = await window.ImageTools.loadImage(file);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const canvas = window.ImageTools.toCanvas(img, w, h);

  if (onProgress) onProgress('Reading text via local OCR...');
  const worker = await Tesseract.createWorker('eng+ben', 1, {
    workerPath: chrome.runtime.getURL('lib/tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('lib/tesseract/tesseract-core-lstm.wasm.js'),
    langPath: chrome.runtime.getURL('lib/tesseract/lang-data'),
    gzip: true,
    workerBlobURL: false,
    logger: (msg) => {
      if (onProgress && msg.status) {
        onProgress(msg.status + (msg.progress ? ` (${Math.round(msg.progress * 100)}%)` : ''));
      }
    },
  });

  let words = [];
  let reconstructed = '';
  let tableFields = {};
  try {
    const { data } = await worker.recognize(canvas);
    words = data.words && data.words.length ? data.words : [];
    const rows = words.length ? groupWordsIntoRows(words) : [];
    reconstructed = rows.length ? rowsToLines(rows, canvas.width) : (data.text || '');
    if (rows.length) {
      tableFields = {
        ...extractAddressTableFromRows(rows),
        ...extractEducationTableFromRows(rows),
      };
    }
  } finally {
    await worker.terminate();
  }

  const regexFields = extractFieldsFromText(reconstructed);
  const fields = { ...regexFields, ...tableFields };

  if (onProgress) onProgress('Detecting photo & signature with human face analysis...');
  let photo = null;
  let signature = null;

  try {
    const pCrop = cropPhotoFromCanvas(canvas, words);
    if (pCrop && window.ImageTools) {
      photo = await window.ImageTools.processPhotoCanvas(pCrop, {
        targetW: 300,
        targetH: 300,
        maxKB: 100,
        faceDetect: true,
      });
      if (photo) photo._cropRect = pCrop._cropRect;
    }
  } catch (e) {
    console.warn('Photo extraction from image failed:', e);
  }

  try {
    const sCrop = cropSignatureFromCanvas(canvas, words);
    if (sCrop && window.ImageTools) {
      signature = await window.ImageTools.processSignatureCanvas(sCrop, {
        targetW: 300,
        targetH: 80,
        maxKB: 60,
      });
      if (signature) signature._cropRect = sCrop._cropRect;
    }
  } catch (e) {
    console.warn('Signature extraction from image failed:', e);
  }

  return {
    fields,
    photo,
    signature,
    photoSourceCanvas: canvas,
    signatureSourceCanvas: canvas,
  };
}

/**
 * Runs the full offline extraction pipeline: parse PDF or document image locally,
 * pattern-match it into profile fields, and automatically extract:
 *   - Passport photo: 300 × 300 px, <= 100 KB
 *   - Signature: 300 × 80 px (W 300px, H 80px), <= 60 KB
 *
 * @param {File} file
 * @param {(status: string) => void} [onProgress] optional progress callback
 * @returns {Promise<{fields: object, photo: object|null, signature: object|null}>}
 */
async function extractCvData(file, onProgress) {
  const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);
  if (isImage) {
    return extractFromImage(file, onProgress);
  }

  // PDF processing
  const { text: rawText, pdf } = await extractTextFromPdf(file);
  let text = rawText;
  let tableFields = {};
  let pageCanvases = [];
  let wordsList = [];

  if (!text || text.trim().length < 40) {
    if (onProgress) onProgress('No text layer found — running local OCR');
    const ocrResult = await extractTextFromPdfViaOcr(file, onProgress);
    text = ocrResult.text;
    tableFields = ocrResult.tableFields || {};
    pageCanvases = ocrResult.pageCanvases || [];
    wordsList = ocrResult.allWords || [];
  }

  if (!text || !text.trim()) {
    throw new Error('No extractable text found in this PDF, even after OCR. The scan quality may be too low to read.');
  }

  const regexFields = extractFieldsFromText(text);
  const fields = { ...regexFields, ...tableFields };

  // Automated extraction of passport photo (300x300) and signature (300x80)
  const { photo, signature, photoSourceCanvas, signatureSourceCanvas } = await extractMediaFromPdf(pdf, pageCanvases, wordsList, onProgress);

  return { fields, photo, signature, photoSourceCanvas, signatureSourceCanvas };
}

/** Populate the profile form with extracted data */
function populateFormWithExtracted(extractedData) {
  // Ensure profile has an ID
  if (!profileIdInput.value) {
    profileIdInput.value = generateProfileId();
  }

  // Initialize Photo & Signature capture tools for this profile
  if (typeof window !== 'undefined' && window.ProfileCapture) {
    window.ProfileCapture.initPhotoCapture('#photoInput', '#photoPreview', profileIdInput.value);
    window.ProfileCapture.initSignatureCapture('#sigInput', '#sigPreview', profileIdInput.value);
  }

  // For each text field, set value if present
  for (const key of TEXT_FIELD_KEYS) {
    const input = document.getElementById(`field-${key}`);
    if (input && extractedData[key] !== undefined && extractedData[key] !== null) {
      input.value = extractedData[key];
    }
  }
  // Checkboxes
  for (const key of CHECKBOX_FIELD_KEYS) {
    const input = document.getElementById(`field-${key}`);
    if (input && extractedData[key] !== undefined) {
      input.checked = Boolean(extractedData[key]);
      // If sameAsPresent is checked, trigger change to copy fields
      if (key === 'sameAsPresent' && input.checked) {
        input.dispatchEvent(new Event('change'));
      }
    }
  }
  // If we have a fullName but no name, set name to the first word of fullName as a label
  if (extractedData.fullName && !document.getElementById('field-name').value) {
    const name = extractedData.fullName.split(' ')[0] || 'Profile';
    document.getElementById('field-name').value = name;
  }
  // Optionally set gender, nationality defaults
  if (!document.getElementById('field-nationality').value) {
    document.getElementById('field-nationality').value = 'Bangladeshi';
  }
  // Trigger any dependent logic (e.g., sameAsPresent)
  const sameCheckbox = document.getElementById('field-sameAsPresent');
  if (sameCheckbox.checked) {
    sameCheckbox.dispatchEvent(new Event('change'));
  }
  // Show form if hidden
  if (profileFormEl.hidden) {
    formEmptyHintEl.hidden = true;
    profileFormEl.hidden = false;
    deleteProfileBtn.hidden = true; // new unsaved profile
  }
}

/** Main handler for Extract button */
async function handleExtractCv() {
  const file = cvFileInput.files[0];
  if (!file) {
    setCvStatus('Please select a file.', 'error');
    return;
  }
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);
  if (!isPdf && !isImage) {
    setCvStatus('Please select a PDF or Image file (JPEG/PNG/WebP).', 'error');
    return;
  }

  extractCvBtn.disabled = true;
  setCvStatus('Extracting data, photo & signature offline... please wait.', '');
  try {
    const { fields, photo, signature, photoSourceCanvas, signatureSourceCanvas } = await extractCvData(file, (status) => setCvStatus(status, ''));
    populateFormWithExtracted(fields);

    const activeProfileId = profileIdInput.value;
    const mediaList = [];

    if (photo && photo.base64 && window.ProfileCapture) {
      await window.ProfileCapture.saveProfilePhoto(activeProfileId, photo);
      if (photoSourceCanvas) {
        window.ProfileCapture.setActiveMediaSource(activeProfileId, 'photo', {
          canvas: photoSourceCanvas,
          rect: photo._cropRect,
        });
      }
      mediaList.push(`Passport Photo (300×300px, ${photo.kb} KB)`);
    }

    if (signature && signature.base64 && window.ProfileCapture) {
      await window.ProfileCapture.saveProfileSignature(activeProfileId, signature);
      if (signatureSourceCanvas) {
        window.ProfileCapture.setActiveMediaSource(activeProfileId, 'signature', {
          canvas: signatureSourceCanvas,
          rect: signature._cropRect,
        });
      }
      mediaList.push(`Signature (300×80px, ${signature.kb} KB)`);
    }

    if (window.ProfileCapture && window.ProfileCapture.refreshPreviews) {
      await window.ProfileCapture.refreshPreviews(activeProfileId);
    }

    const foundCount = Object.keys(fields).length;
    let successMsg = `Extracted ${foundCount} field(s) offline.`;
    if (mediaList.length > 0) {
      successMsg += ` Captured ${mediaList.join(' & ')}.`;
    }
    successMsg += ` Review and click "Save Profile".`;
    setCvStatus(successMsg, 'success');

    // Scroll to form
    profileFormEl.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    const message =
      (err && typeof err.message === 'string' && err.message) ||
      (typeof err === 'string' && err) ||
      (err && err.name) ||
      'Unknown error while extracting the document. See console for details.';
    console.error('CV/Document extraction failed:', err);
    setCvStatus('Error: ' + message, 'error');
  } finally {
    extractCvBtn.disabled = false;
  }
}

if (extractCvBtn) extractCvBtn.addEventListener('click', handleExtractCv);

if (cvFileInput && extractCvBtn) updateExtractButton();

// Initialize the page
initialize();