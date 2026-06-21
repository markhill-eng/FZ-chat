const DB_NAME = "fz-chat-v1";
const KEY_STORE = "keys";
const CONTACTS_KEY = "fz-chat-contacts";
const NAME_KEY = "fz-chat-display-name";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const state = {
  identity: null,
  contacts: [],
  selectedContactFingerprint: null
};

const els = {
  identityStatus: document.querySelector("#identity-status"),
  displayName: document.querySelector("#display-name"),
  saveName: document.querySelector("#save-name"),
  fingerprint: document.querySelector("#fingerprint"),
  copyPublicKey: document.querySelector("#copy-public-key"),
  tabs: document.querySelectorAll(".tab-button"),
  panels: document.querySelectorAll(".tab-panel"),
  contactCount: document.querySelector("#contact-count"),
  recipientSelect: document.querySelector("#recipient-select"),
  messageText: document.querySelector("#message-text"),
  encryptMessage: document.querySelector("#encrypt-message"),
  clearCompose: document.querySelector("#clear-compose"),
  encryptedOutput: document.querySelector("#encrypted-output"),
  copyPackage: document.querySelector("#copy-package"),
  packageInput: document.querySelector("#package-input"),
  decryptMessage: document.querySelector("#decrypt-message"),
  clearDecrypt: document.querySelector("#clear-decrypt"),
  verifyStatus: document.querySelector("#verify-status"),
  decryptedCard: document.querySelector("#decrypted-card"),
  contactKeyInput: document.querySelector("#contact-key-input"),
  saveContact: document.querySelector("#save-contact"),
  clearContact: document.querySelector("#clear-contact"),
  deleteContact: document.querySelector("#delete-contact"),
  contactList: document.querySelector("#contact-list"),
  toast: document.querySelector("#toast")
};

init().catch((error) => {
  console.error(error);
  showToast(error.message || "FZ-chat failed to initialize");
  setStatus(els.identityStatus, "Error", "danger");
});

async function init() {
  ensureCryptoSupport();
  state.identity = await loadOrCreateIdentity();
  state.contacts = loadContacts();
  bindEvents();
  renderIdentity();
  renderContacts();
  renderRecipientOptions();
  setStatus(els.identityStatus, "Ready", "success");
}

function ensureCryptoSupport() {
  if (!window.crypto?.subtle || !window.indexedDB) {
    throw new Error("This browser needs Web Crypto and IndexedDB support.");
  }
}

function bindEvents() {
  els.tabs.forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tab));
  });

  els.saveName.addEventListener("click", saveDisplayName);
  els.copyPublicKey.addEventListener("click", copyPublicContactKey);
  els.saveContact.addEventListener("click", saveContactFromInput);
  els.clearContact.addEventListener("click", () => {
    els.contactKeyInput.value = "";
  });
  els.deleteContact.addEventListener("click", deleteSelectedContacts);
  els.encryptMessage.addEventListener("click", encryptCurrentMessage);
  els.copyPackage.addEventListener("click", () => copyText(els.encryptedOutput.value, "Encrypted package copied"));
  els.clearCompose.addEventListener("click", () => {
    els.messageText.value = "";
    els.encryptedOutput.value = "";
  });
  els.decryptMessage.addEventListener("click", decryptCurrentPackage);
  els.clearDecrypt.addEventListener("click", () => {
    els.packageInput.value = "";
    renderEmptyDecryption();
  });
  els.recipientSelect.addEventListener("change", () => {
    state.selectedContactFingerprint = els.recipientSelect.value || null;
  });
}

async function loadOrCreateIdentity() {
  const db = await openDb();
  const existing = await getFromStore(db, "identity");
  if (existing?.receiveKeyPair?.privateKey && existing?.signKeyPair?.privateKey) {
    return existing;
  }

  const displayName = localStorage.getItem(NAME_KEY) || "FZ user";
  const receiveKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"]
  );
  const signKeyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  );
  const receivePublicKey = await crypto.subtle.exportKey("jwk", receiveKeyPair.publicKey);
  const signPublicKey = await crypto.subtle.exportKey("jwk", signKeyPair.publicKey);
  const fingerprint = await fingerprintForKeys(receivePublicKey, signPublicKey);

  const identity = {
    type: "fz-chat-identity",
    version: 1,
    displayName,
    createdAt: new Date().toISOString(),
    fingerprint,
    receiveKeyPair,
    signKeyPair,
    receivePublicKey,
    signPublicKey
  };

  await putInStore(db, "identity", identity);
  return identity;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(KEY_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getFromStore(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readonly");
    const request = tx.objectStore(KEY_STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putInStore(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readwrite");
    tx.objectStore(KEY_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function renderIdentity() {
  els.displayName.value = state.identity.displayName;
  els.fingerprint.textContent = formatFingerprint(state.identity.fingerprint);
}

async function saveDisplayName() {
  const name = els.displayName.value.trim() || "FZ user";
  state.identity.displayName = name;
  localStorage.setItem(NAME_KEY, name);
  const db = await openDb();
  await putInStore(db, "identity", state.identity);
  showToast("Display name saved");
}

function buildPublicContactKey() {
  return {
    type: "fz-chat-contact",
    version: 1,
    name: state.identity.displayName,
    createdAt: state.identity.createdAt,
    fingerprint: state.identity.fingerprint,
    receivePublicKey: state.identity.receivePublicKey,
    signPublicKey: state.identity.signPublicKey
  };
}

async function copyPublicContactKey() {
  await copyText(prettyJson(buildPublicContactKey()), "Public contact key copied");
}

function loadContacts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONTACTS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistContacts() {
  localStorage.setItem(CONTACTS_KEY, JSON.stringify(state.contacts));
}

async function saveContactFromInput() {
  const raw = els.contactKeyInput.value.trim();
  if (!raw) {
    showToast("Paste a public contact key first");
    return;
  }

  const contact = parseJson(raw, "Contact key");
  await validateContact(contact);

  if (contact.fingerprint === state.identity.fingerprint) {
    showToast("That is your own contact key");
    return;
  }

  const index = state.contacts.findIndex((item) => item.fingerprint === contact.fingerprint);
  if (index >= 0) {
    state.contacts[index] = contact;
  } else {
    state.contacts.push(contact);
  }

  state.contacts.sort((a, b) => a.name.localeCompare(b.name));
  persistContacts();
  els.contactKeyInput.value = "";
  renderContacts();
  renderRecipientOptions();
  activateTab("compose");
  showToast("Contact saved");
}

async function validateContact(contact) {
  if (contact?.type !== "fz-chat-contact" || contact.version !== 1) {
    throw new Error("This is not a FZ-chat contact key.");
  }

  if (!contact.receivePublicKey || !contact.signPublicKey || !contact.fingerprint) {
    throw new Error("Contact key is missing public key material.");
  }

  await importReceivePublicKey(contact.receivePublicKey);
  await importSignPublicKey(contact.signPublicKey);
  const expected = await fingerprintForKeys(contact.receivePublicKey, contact.signPublicKey);
  if (expected !== contact.fingerprint) {
    throw new Error("Contact fingerprint does not match its public keys.");
  }
}

function renderContacts() {
  els.contactCount.textContent = `${state.contacts.length} contact${state.contacts.length === 1 ? "" : "s"}`;

  if (!state.contacts.length) {
    els.contactList.innerHTML = `<div class="empty-state">No contacts saved.</div>`;
    return;
  }

  els.contactList.innerHTML = state.contacts
    .map((contact) => {
      const checked = contact.fingerprint === state.selectedContactFingerprint ? "checked" : "";
      return `
        <label class="contact-card">
          <input type="radio" name="contact-select" value="${escapeHtml(contact.fingerprint)}" ${checked}>
          <span>
            <strong>${escapeHtml(contact.name || "Unnamed contact")}</strong>
            <code>${escapeHtml(formatFingerprint(contact.fingerprint))}</code>
          </span>
        </label>
      `;
    })
    .join("");

  els.contactList.querySelectorAll("input[name='contact-select']").forEach((input) => {
    input.addEventListener("change", () => {
      state.selectedContactFingerprint = input.value;
      renderRecipientOptions();
    });
  });
}

function renderRecipientOptions() {
  if (!state.contacts.length) {
    els.recipientSelect.innerHTML = `<option value="">Import a contact first</option>`;
    els.recipientSelect.disabled = true;
    return;
  }

  els.recipientSelect.disabled = false;
  if (!state.selectedContactFingerprint) {
    state.selectedContactFingerprint = state.contacts[0].fingerprint;
  }

  els.recipientSelect.innerHTML = state.contacts
    .map((contact) => {
      const selected = contact.fingerprint === state.selectedContactFingerprint ? "selected" : "";
      return `<option value="${escapeHtml(contact.fingerprint)}" ${selected}>${escapeHtml(contact.name)} - ${escapeHtml(shortFingerprint(contact.fingerprint))}</option>`;
    })
    .join("");
}

function deleteSelectedContacts() {
  const selected = Array.from(els.contactList.querySelectorAll("input[name='contact-select']:checked"))
    .map((input) => input.value);
  if (!selected.length) {
    showToast("Select a contact to delete");
    return;
  }

  state.contacts = state.contacts.filter((contact) => !selected.includes(contact.fingerprint));
  if (selected.includes(state.selectedContactFingerprint)) {
    state.selectedContactFingerprint = null;
  }
  persistContacts();
  renderContacts();
  renderRecipientOptions();
  showToast("Contact deleted");
}

async function encryptCurrentMessage() {
  const text = els.messageText.value.trim();
  const contact = state.contacts.find((item) => item.fingerprint === els.recipientSelect.value);

  if (!contact) {
    showToast("Import and select a contact first");
    return;
  }
  if (!text) {
    showToast("Write a message first");
    return;
  }

  const packageJson = await encryptForContact(contact, text);
  els.encryptedOutput.value = prettyJson(packageJson);
  showToast("Message encrypted");
}

async function encryptForContact(contact, text) {
  const recipientPublicKey = await importReceivePublicKey(contact.receivePublicKey);
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );
  const aesKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: recipientPublicKey },
    ephemeralKeyPair.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  const messageId = crypto.randomUUID();
  const sentAt = new Date().toISOString();
  const signedContent = {
    messageId,
    recipientFingerprint: contact.fingerprint,
    senderFingerprint: state.identity.fingerprint,
    sentAt,
    text
  };
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    state.identity.signKeyPair.privateKey,
    encoder.encode(canonicalJson(signedContent))
  );

  const innerMessage = {
    messageId,
    text,
    sentAt,
    recipientFingerprint: contact.fingerprint,
    sender: {
      name: state.identity.displayName,
      fingerprint: state.identity.fingerprint,
      receivePublicKey: state.identity.receivePublicKey,
      signPublicKey: state.identity.signPublicKey
    },
    signature: toBase64Url(signature)
  };

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    encoder.encode(JSON.stringify(innerMessage))
  );
  const ephemeralPublicKey = await crypto.subtle.exportKey("jwk", ephemeralKeyPair.publicKey);

  return {
    type: "fz-chat-message",
    version: 1,
    algorithm: {
      exchange: "ECDH-P-256",
      cipher: "AES-256-GCM",
      signature: "ECDSA-P-256-SHA-256"
    },
    to: contact.fingerprint,
    createdAt: sentAt,
    ephemeralPublicKey,
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(ciphertext)
  };
}

async function decryptCurrentPackage() {
  const raw = els.packageInput.value.trim();
  if (!raw) {
    showToast("Paste an encrypted package first");
    return;
  }

  const encryptedPackage = parseJson(raw, "Encrypted package");
  const result = await decryptPackage(encryptedPackage);
  renderDecryptedMessage(result);
  showToast("Package decrypted");
}

async function decryptPackage(encryptedPackage) {
  if (encryptedPackage?.type !== "fz-chat-message" || encryptedPackage.version !== 1) {
    throw new Error("This is not a FZ-chat message package.");
  }

  if (encryptedPackage.to !== state.identity.fingerprint) {
    throw new Error("This package was not encrypted for this identity.");
  }

  const ephemeralPublicKey = await importReceivePublicKey(encryptedPackage.ephemeralPublicKey);
  const aesKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: ephemeralPublicKey },
    state.identity.receiveKeyPair.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(encryptedPackage.iv) },
    aesKey,
    fromBase64Url(encryptedPackage.ciphertext)
  );
  const message = JSON.parse(decoder.decode(plaintext));

  const senderFingerprint = await fingerprintForKeys(
    message.sender.receivePublicKey,
    message.sender.signPublicKey
  );
  const signedContent = {
    messageId: message.messageId,
    recipientFingerprint: message.recipientFingerprint,
    senderFingerprint: message.sender.fingerprint,
    sentAt: message.sentAt,
    text: message.text
  };
  const senderSignKey = await importSignPublicKey(message.sender.signPublicKey);
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    senderSignKey,
    fromBase64Url(message.signature),
    encoder.encode(canonicalJson(signedContent))
  );

  return {
    message,
    verified: verified && senderFingerprint === message.sender.fingerprint,
    senderFingerprint
  };
}

function renderDecryptedMessage(result) {
  const { message, verified, senderFingerprint } = result;
  setStatus(els.verifyStatus, verified ? "Verified" : "Unverified", verified ? "success" : "danger");
  els.decryptedCard.classList.remove("empty");
  els.decryptedCard.innerHTML = `
    <div class="message-meta">
      <span>From: ${escapeHtml(message.sender.name || "Unknown sender")}</span>
      <span>Sent: ${escapeHtml(formatDate(message.sentAt))}</span>
      <span>Fingerprint: ${escapeHtml(formatFingerprint(senderFingerprint))}</span>
    </div>
    <div>${escapeHtml(message.text)}</div>
  `;
}

function renderEmptyDecryption() {
  setStatus(els.verifyStatus, "Waiting", "");
  els.decryptedCard.className = "message-card empty";
  els.decryptedCard.textContent = "No message decrypted yet.";
}

function activateTab(tabId) {
  els.tabs.forEach((button) => button.classList.toggle("active", button.dataset.tab === tabId));
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.id === tabId));
}

async function importReceivePublicKey(jwk) {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
}

async function importSignPublicKey(jwk) {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"]
  );
}

async function fingerprintForKeys(receivePublicKey, signPublicKey) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(canonicalJson({ receivePublicKey, signPublicKey }))
  );
  return toBase64Url(digest);
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function toBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function copyText(text, successMessage) {
  if (!text.trim()) {
    showToast("Nothing to copy");
    return;
  }
  await navigator.clipboard.writeText(text);
  showToast(successMessage);
}

function setStatus(element, label, variant) {
  element.textContent = label;
  element.className = "status-pill";
  if (variant) {
    element.classList.add(variant);
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.classList.remove("show");
  }, 2600);
}

function shortFingerprint(value) {
  return value ? `${value.slice(0, 8)}...${value.slice(-8)}` : "unknown";
}

function formatFingerprint(value) {
  return value ? value.match(/.{1,8}/g).join(" ") : "unknown";
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
