const createForm = document.getElementById("createAccountForm");
const createMessage = document.getElementById("createAccountMessage");

function setCreateMessage(text, type) {
  createMessage.textContent = text;
  createMessage.className = "login-message" + (type ? " " + type : "");
}

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setCreateMessage("Creating account...", "");

  const email = document.getElementById("newDoctorEmail").value.trim();
  const password = document.getElementById("newDoctorPass").value.trim();

  if (!email || !password) {
    setCreateMessage("Email and password are required.", "error");
    return;
  }

  if (password.length < 6) {
    setCreateMessage("Password must be at least 6 characters.", "error");
    return;
  }

  try {
    const response = await fetch("/registerDoctor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!data.success) {
      setCreateMessage(data.message || "Unable to create account.", "error");
      return;
    }

    setCreateMessage(data.message || "Account created.", "success");
    setTimeout(() => {
      window.location = "login.html";
    }, 1200);
  } catch (error) {
    setCreateMessage("Server error. Please try again.", "error");
  }
});
