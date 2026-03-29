const doctorTab = document.getElementById("doctorTab");
const patientTab = document.getElementById("patientTab");
const doctorForm = document.getElementById("doctorForm");
const patientForm = document.getElementById("patientForm");
const loginMessage = document.getElementById("loginMessage");

function setMessage(text, type) {
  loginMessage.textContent = text;
  loginMessage.className = "login-message" + (type ? " " + type : "");
}

function activateTab(tab) {
  const doctorActive = tab === "doctor";

  doctorTab.classList.toggle("active", doctorActive);
  patientTab.classList.toggle("active", !doctorActive);
  doctorTab.setAttribute("aria-selected", String(doctorActive));
  patientTab.setAttribute("aria-selected", String(!doctorActive));

  doctorForm.classList.toggle("active", doctorActive);
  patientForm.classList.toggle("active", !doctorActive);
  document.body.classList.toggle("patient-mode", !doctorActive);
  setMessage("", "");
}

doctorTab.addEventListener("click", () => activateTab("doctor"));
patientTab.addEventListener("click", () => activateTab("patient"));

doctorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("Signing in doctor...", "");

  const email = document.getElementById("doctorEmail").value.trim();
  const password = document.getElementById("doctorPass").value.trim();

  try {
    const response = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!data.success) {
      setMessage(data.message || "Invalid doctor credentials.", "error");
      return;
    }

    const doctorEmail = data.doctor_email || data.doctorEmail || email;
    localStorage.setItem("doctor_email", doctorEmail);
    localStorage.setItem("doctor", doctorEmail);
    localStorage.removeItem("patientSession");
    setMessage("Doctor login successful. Redirecting...", "success");
    window.location = "dashboard.html";
  } catch (error) {
    setMessage("Server error. Please try again.", "error");
  }
});

patientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("Signing in patient...", "");

  const watch_id = document.getElementById("patientWatchID").value.trim().toUpperCase();
  const email = document.getElementById("patientEmail").value.trim();

  try {
    const response = await fetch("/patientLogin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watch_id, email })
    });

    const data = await response.json();

    if (!data.success) {
      setMessage(data.message || "Invalid patient credentials.", "error");
      return;
    }

    localStorage.removeItem("doctor_email");
    localStorage.removeItem("doctor");
    localStorage.setItem("patientSession", JSON.stringify({ watch_id, email }));
    setMessage("Patient login successful. Redirecting...", "success");
    window.location = "patient-portal.html";
  } catch (error) {
    setMessage("Server error. Please try again.", "error");
  }
});
