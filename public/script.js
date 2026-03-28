const doctorEmail = localStorage.getItem("doctor");

const form = document.getElementById("watchForm");
const statusMsg = document.getElementById("statusMsg");
const watchesList = document.getElementById("watchesList");
const doctorEmailText = document.getElementById("doctorEmailText");
const submitBtn = document.getElementById("submitBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const formTitle = document.getElementById("formTitle");
const watchIDInput = document.getElementById("watchID");
const nameInput = document.getElementById("name");
const emailInput = document.getElementById("email");
const ageInput = document.getElementById("age");
const conditionInput = document.getElementById("condition");
const phoneInput = document.getElementById("phone");
const logoutBtn = document.getElementById("logoutBtn");
const notificationBtn = document.getElementById("notificationBtn");
const notificationBadge = document.getElementById("notificationBadge");
const notificationPanel = document.getElementById("notificationPanel");
const notificationList = document.getElementById("notificationList");
const hardwareEndpoint = document.getElementById("hardwareEndpoint");

let editingWatchID = null;
let latestWatches = [];

if (!doctorEmail) {
  window.location = "login.html";
}

doctorEmailText.textContent = "Signed in doctor: " + doctorEmail;
if (hardwareEndpoint) {
  hardwareEndpoint.textContent = window.location.origin + "/update";
}

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("doctor");
  window.location = "login.html";
});

notificationBtn.addEventListener("click", () => {
  notificationPanel.hidden = !notificationPanel.hidden;
});

document.addEventListener("click", (event) => {
  if (!notificationPanel.hidden && !notificationPanel.contains(event.target) && !notificationBtn.contains(event.target)) {
    notificationPanel.hidden = true;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusMsg.textContent = "";

  const payload = {
    watchID: watchIDInput.value.trim().toUpperCase(),
    name: nameInput.value.trim(),
    email: emailInput.value.trim(),
    age: ageInput.value.trim(),
    condition: conditionInput.value.trim(),
    phone: phoneInput.value.trim(),
    doctorEmail
  };

  if (!payload.watchID || !payload.name || !payload.email) {
    statusMsg.textContent = "Please fill Watch ID, Patient Name and Email.";
    return;
  }

  const endpoint = editingWatchID ? "/updatePatient" : "/addPatient";
  const method = editingWatchID ? "PUT" : "POST";

  if (editingWatchID) {
    payload.watchID = editingWatchID;
  }

  try {
    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      statusMsg.textContent = result.message || "Unable to save watch link.";
      return;
    }

    statusMsg.textContent = result.message;
    resetEditMode();
    await loadDoctorWatches();
    await loadNotifications();
  } catch (error) {
    statusMsg.textContent = "Server error. Please restart server.";
  }
});

cancelEditBtn.addEventListener("click", () => {
  resetEditMode();
  statusMsg.textContent = "Edit canceled.";
});

function resetEditMode() {
  editingWatchID = null;
  form.reset();
  watchIDInput.disabled = false;
  submitBtn.textContent = "Add Watch Link";
  formTitle.textContent = "Add Watch and Link Patient";
  cancelEditBtn.hidden = true;
}

function startEdit(watch) {
  editingWatchID = watch.watchID;
  watchIDInput.value = watch.watchID;
  watchIDInput.disabled = true;
  nameInput.value = watch.name;
  emailInput.value = watch.email;
  ageInput.value = watch.age === "-" ? "" : watch.age;
  conditionInput.value = watch.condition === "-" ? "" : watch.condition;
  phoneInput.value = watch.phone === "-" ? "" : watch.phone;
  submitBtn.textContent = "Update Patient";
  formTitle.textContent = "Edit Linked Patient";
  cancelEditBtn.hidden = false;
  statusMsg.textContent = "Editing watch: " + watch.watchID;
}

function openStats(watchID) {
  const url = "patient-stats.html?watchID=" + encodeURIComponent(watchID);
  window.location = url;
}

function createActionButton(label, className, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function getConnectionLabelFromData(readings) {
  if (!Array.isArray(readings) || !readings.length) {
    return { text: "Not connected", className: "conn-offline" };
  }

  const latest = readings[readings.length - 1];
  const timestamp = new Date(latest.time).getTime();
  if (Number.isNaN(timestamp)) {
    return { text: "Unknown", className: "conn-offline" };
  }

  const ageMs = Date.now() - timestamp;
  if (ageMs <= 75 * 1000) {
    return { text: "Live", className: "conn-live" };
  }

  if (ageMs <= 5 * 60 * 1000) {
    return { text: "Idle", className: "conn-idle" };
  }

  return { text: "Offline", className: "conn-offline" };
}

async function updateConnectivityForWatches(watches) {
  const cells = Array.from(document.querySelectorAll("[data-conn-watch]"));
  if (!cells.length) return;

  const readingsByWatch = await Promise.all(
    watches.map(async (watch) => {
      try {
        const response = await fetch("/data/" + encodeURIComponent(watch.watchID));
        const data = await response.json();
        return { watchID: watch.watchID, readings: data };
      } catch (error) {
        return { watchID: watch.watchID, readings: [] };
      }
    })
  );

  const map = {};
  readingsByWatch.forEach((entry) => {
    map[entry.watchID] = getConnectionLabelFromData(entry.readings);
  });

  cells.forEach((cell) => {
    const watchID = cell.getAttribute("data-conn-watch");
    const status = map[watchID] || { text: "Unknown", className: "conn-offline" };
    cell.textContent = status.text;
    cell.className = "conn-pill " + status.className;
  });
}

async function loadDoctorWatches() {
  try {
    const response = await fetch("/doctorWatches?doctorEmail=" + encodeURIComponent(doctorEmail));
    const result = await response.json();

    if (!response.ok || !result.success) {
      watchesList.innerHTML = "<p>Unable to load linked watches.</p>";
      return;
    }

    latestWatches = result.watches;

    if (!result.watches.length) {
      watchesList.innerHTML = "<p>No watches linked yet. Add one above.</p>";
      return;
    }

    const table = document.createElement("table");
    table.className = "watches-table";
    table.innerHTML = "<thead><tr><th>Watch ID</th><th>Device</th><th>Patient</th><th>Email</th><th>Age</th><th>Condition</th><th>Phone</th><th>Actions</th></tr></thead>";

    const body = document.createElement("tbody");

    result.watches.forEach((watch) => {
      const row = document.createElement("tr");

      row.innerHTML = "<td>" + watch.watchID + "</td><td><span class='conn-pill conn-loading' data-conn-watch='" + watch.watchID + "'>Checking...</span></td><td>" + watch.name + "</td><td>" + watch.email + "</td><td>" + watch.age + "</td><td>" + watch.condition + "</td><td>" + watch.phone + "</td>";

      const actionCell = document.createElement("td");
      actionCell.className = "action-cell";

      const editBtn = createActionButton("Edit", "secondary-btn", () => startEdit(watch));
      const statsBtn = createActionButton("View Stats", "stats-btn", () => openStats(watch.watchID));

      actionCell.appendChild(editBtn);
      actionCell.appendChild(statsBtn);
      row.appendChild(actionCell);

      body.appendChild(row);
    });

    table.appendChild(body);
    watchesList.innerHTML = "";
    watchesList.appendChild(table);
    await updateConnectivityForWatches(result.watches);
  } catch (error) {
    watchesList.innerHTML = "<p>Server error while loading watches.</p>";
  }
}

function renderNotifications(notifications) {
  if (!notifications.length) {
    notificationList.innerHTML = "<li class='notif-empty'>No critical alerts right now.</li>";
    notificationBadge.hidden = true;
    return;
  }

  notificationBadge.hidden = false;
  notificationBadge.textContent = notifications.length;

  notificationList.innerHTML = "";
  notifications.forEach((item) => {
    const li = document.createElement("li");
    li.className = "notif-item";
    li.innerHTML = "<strong>" + item.patientName + "</strong> (" + item.watchID + ")<br>HR: " + item.hr + " | SpO2: " + item.spo2 + "<br><span class='notif-time'>" + new Date(item.time).toLocaleString() + "</span>";
    notificationList.appendChild(li);
  });
}

async function loadNotifications() {
  try {
    const response = await fetch("/criticalNotifications?doctorEmail=" + encodeURIComponent(doctorEmail));
    const result = await response.json();

    if (!response.ok || !result.success) {
      renderNotifications([]);
      return;
    }

    renderNotifications(result.notifications || []);
  } catch (error) {
    renderNotifications([]);
  }
}

loadDoctorWatches();
loadNotifications();
setInterval(loadNotifications, 15000);
setInterval(() => {
  if (latestWatches.length) {
    updateConnectivityForWatches(latestWatches);
  }
}, 20000);
