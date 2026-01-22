// SMS Consent Portal - Frontend Application

const API_BASE = '/api';

// State management
let state = {
  phoneNumber: '',
  sessionToken: null,
  currentStatus: null,
};

// DOM Elements
const sections = {
  phone: document.getElementById('phoneSection'),
  code: document.getElementById('codeSection'),
  status: document.getElementById('statusSection'),
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  loadComplianceInfo();
  setupEventListeners();
});

function setupEventListeners() {
  // Phone form submission
  document.getElementById('phoneForm').addEventListener('submit', handlePhoneSubmit);

  // Code form submission
  document.getElementById('codeForm').addEventListener('submit', handleCodeSubmit);

  // Secondary actions
  document.getElementById('resendCode').addEventListener('click', handleResendCode);
  document.getElementById('changeNumber').addEventListener('click', handleChangeNumber);

  // Consent actions
  document.getElementById('optInBtn').addEventListener('click', () => handleSetStatus('opted_in'));
  document.getElementById('optOutBtn').addEventListener('click', () => handleSetStatus('opted_out'));

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);

  // Format phone number as user types
  document.getElementById('phoneNumber').addEventListener('input', formatPhoneInput);

  // Auto-advance code input
  document.getElementById('verificationCode').addEventListener('input', handleCodeInput);
}

// Track previous phone digits for delete detection
let previousPhoneDigits = '';

// Phone number formatting
function formatPhoneInput(e) {
  const input = e.target;
  const cursorPos = input.selectionStart;
  const beforeCursor = input.value.substring(0, cursorPos);
  const digitsBeforeCursor = beforeCursor.replace(/\D/g, '').length;

  let digits = input.value.replace(/\D/g, '');

  if (digits.length > 10) {
    digits = digits.slice(0, 10);
  }

  // Format the number
  let formatted = '';
  if (digits.length > 0) {
    formatted = '(' + digits.substring(0, 3);
    if (digits.length >= 3) {
      formatted += ') ';
      if (digits.length > 3) {
        formatted += digits.substring(3, 6);
        if (digits.length > 6) {
          formatted += '-' + digits.substring(6);
        }
      }
    }
  }

  input.value = formatted;

  // Restore cursor position based on digit count
  let newCursorPos = 0;
  let digitCount = 0;
  for (let i = 0; i < formatted.length && digitCount < digitsBeforeCursor; i++) {
    newCursorPos = i + 1;
    if (/\d/.test(formatted[i])) {
      digitCount++;
    }
  }

  input.setSelectionRange(newCursorPos, newCursorPos);
  previousPhoneDigits = digits;
}

// Code input handling
function handleCodeInput(e) {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);

  // Auto-submit when 6 digits entered
  if (e.target.value.length === 6) {
    document.getElementById('codeForm').requestSubmit();
  }
}

// Handle phone number submission
async function handlePhoneSubmit(e) {
  e.preventDefault();

  const btn = e.target.querySelector('button[type="submit"]');
  const phoneInput = document.getElementById('phoneNumber');
  const errorEl = document.getElementById('phoneError');

  // Clean phone number
  const phoneNumber = '+1' + phoneInput.value.replace(/\D/g, '');
  state.phoneNumber = phoneNumber;

  setButtonLoading(btn, true);
  hideError(errorEl);

  try {
    const response = await fetch(`${API_BASE}/start-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber }),
    });

    const data = await response.json();

    if (data.success) {
      showSection('code');
      document.getElementById('maskedPhone').textContent = maskPhone(phoneNumber);
      document.getElementById('verificationCode').focus();
    } else {
      showError(errorEl, data.message);
    }
  } catch (error) {
    showError(errorEl, 'Failed to send verification code. Please try again.');
  } finally {
    setButtonLoading(btn, false);
  }
}

// Handle verification code submission
async function handleCodeSubmit(e) {
  e.preventDefault();

  const btn = e.target.querySelector('button[type="submit"]');
  const codeInput = document.getElementById('verificationCode');
  const errorEl = document.getElementById('codeError');

  setButtonLoading(btn, true);
  hideError(errorEl);

  try {
    const response = await fetch(`${API_BASE}/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: state.phoneNumber,
        code: codeInput.value,
      }),
    });

    const data = await response.json();

    if (data.success) {
      state.sessionToken = data.sessionToken;
      await loadStatus();
      showSection('status');
    } else {
      showError(errorEl, data.message);
      codeInput.value = '';
      codeInput.focus();
    }
  } catch (error) {
    showError(errorEl, 'Verification failed. Please try again.');
  } finally {
    setButtonLoading(btn, false);
  }
}

// Handle resend code
async function handleResendCode() {
  const btn = document.getElementById('resendCode');
  const errorEl = document.getElementById('codeError');

  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const response = await fetch(`${API_BASE}/start-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: state.phoneNumber }),
    });

    const data = await response.json();

    if (data.success) {
      btn.textContent = 'Code Sent!';
      setTimeout(() => {
        btn.textContent = 'Resend Code';
        btn.disabled = false;
      }, 3000);
    } else {
      showError(errorEl, data.message);
      btn.textContent = 'Resend Code';
      btn.disabled = false;
    }
  } catch (error) {
    showError(errorEl, 'Failed to resend code.');
    btn.textContent = 'Resend Code';
    btn.disabled = false;
  }
}

// Handle change number
function handleChangeNumber() {
  state.phoneNumber = '';
  document.getElementById('verificationCode').value = '';
  hideError(document.getElementById('codeError'));
  showSection('phone');
  document.getElementById('phoneNumber').focus();
}

// Load current consent status
async function loadStatus() {
  try {
    const response = await fetch(`${API_BASE}/get-status`, {
      headers: {
        'Authorization': `Bearer ${state.sessionToken}`,
      },
    });

    const data = await response.json();
    state.currentStatus = data.status;
    updateStatusDisplay(data);
  } catch (error) {
    console.error('Failed to load status:', error);
  }
}

// Update status display
function updateStatusDisplay(data) {
  const indicator = document.getElementById('statusIndicator');
  const icon = document.getElementById('statusIcon');
  const text = document.getElementById('statusText');
  const detail = document.getElementById('statusDetail');

  // Remove existing classes
  indicator.className = 'status-indicator';

  switch (data.status) {
    case 'opted_in':
      indicator.classList.add('opted-in');
      icon.textContent = '✓';
      text.textContent = 'Opted In';
      detail.textContent = 'You are currently receiving SMS messages.';
      break;
    case 'opted_out':
      indicator.classList.add('opted-out');
      icon.textContent = '✕';
      text.textContent = 'Opted Out';
      detail.textContent = 'You are not receiving SMS messages.';
      break;
    default:
      indicator.classList.add('unknown');
      icon.textContent = '?';
      text.textContent = 'Not Set';
      detail.textContent = 'Your SMS preference has not been set.';
  }

  if (data.lastUpdated) {
    const date = new Date(data.lastUpdated);
    detail.textContent += ` Last updated: ${date.toLocaleDateString()}`;
  }

  // Update button states
  document.getElementById('optInBtn').disabled = data.status === 'opted_in';
  document.getElementById('optOutBtn').disabled = data.status === 'opted_out';
}

// Handle status change
async function handleSetStatus(newStatus) {
  const btn = document.getElementById(newStatus === 'opted_in' ? 'optInBtn' : 'optOutBtn');
  const successEl = document.getElementById('statusSuccess');
  const errorEl = document.getElementById('statusError');

  setButtonLoading(btn, true);
  hideError(errorEl);
  successEl.hidden = true;

  try {
    const response = await fetch(`${API_BASE}/set-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.sessionToken}`,
      },
      body: JSON.stringify({ status: newStatus }),
    });

    const data = await response.json();

    if (data.success) {
      state.currentStatus = data.status;
      await loadStatus();
      successEl.textContent = data.message;
      successEl.hidden = false;
    } else {
      showError(errorEl, data.message);
    }
  } catch (error) {
    showError(errorEl, 'Failed to update preference. Please try again.');
  } finally {
    setButtonLoading(btn, false);
  }
}

// Handle logout
function handleLogout() {
  state = {
    phoneNumber: '',
    sessionToken: null,
    currentStatus: null,
  };

  document.getElementById('phoneNumber').value = '';
  document.getElementById('verificationCode').value = '';
  document.getElementById('statusSuccess').hidden = true;

  showSection('phone');
  document.getElementById('phoneNumber').focus();
}

// Load compliance information
async function loadComplianceInfo() {
  try {
    const response = await fetch(`${API_BASE}/compliance-info`);
    const data = await response.json();

    document.getElementById('brandName').textContent = data.brandName;

    const messageTypesList = document.getElementById('messageTypes');
    messageTypesList.innerHTML = data.messageTypes
      .map(type => `<li>${type}</li>`)
      .join('');

    document.getElementById('messageFrequency').textContent =
      `Message frequency: ${data.messageFrequency}`;

    document.getElementById('optOutInstructions').textContent =
      `${data.optOutInstructions}. Message and data rates may apply.`;

    document.getElementById('privacyLink').href = data.privacyPolicyUrl;
    document.getElementById('termsLink').href = data.termsUrl;
  } catch (error) {
    console.error('Failed to load compliance info:', error);
  }
}

// Utility functions
function showSection(sectionName) {
  Object.entries(sections).forEach(([name, el]) => {
    el.hidden = name !== sectionName;
  });
}

function setButtonLoading(btn, loading) {
  btn.disabled = loading;
  btn.querySelector('.btn-text').hidden = loading;
  btn.querySelector('.btn-loading').hidden = !loading;
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

function hideError(el) {
  el.hidden = true;
}

function maskPhone(phone) {
  // Show last 4 digits only
  const digits = phone.replace(/\D/g, '');
  return `(***) ***-${digits.slice(-4)}`;
}
