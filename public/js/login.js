import { auth, functions } from "./firebase-init.js";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";
const token = new URLSearchParams(location.hash.slice(1)).get("invite");
let signup = Boolean(token);
const status = document.getElementById("status");
function render() {
  document.getElementById("intro").textContent = signup ? "You're invited. Create an account to join The Board." : "Log in to see this week's matchup. New members need an invitation.";
  document.getElementById("submitBtn").textContent = signup ? "Create account" : "Log in";
  document.getElementById("password").minLength = signup ? 12 : 1;
  document.getElementById("password").autocomplete = signup ? "new-password" : "current-password";
  document.getElementById("switchBtn").hidden = !token;
  document.getElementById("switchBtn").textContent = signup ? "Already have an account? Log in" : "Use invitation to create an account";
}
render();
document.getElementById("switchBtn").onclick = () => { signup = !signup; status.textContent = ""; render(); };
document.getElementById("authForm").onsubmit = async event => {
  event.preventDefault();
  const button = document.getElementById("submitBtn");
  button.disabled = true; status.textContent = "Please wait…";
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  try {
    if (signup) {
      await httpsCallable(functions, "registerWithInvitation")({ token, email, password });
      // Registration succeeded: allow normal login if the following request fails.
      signup = false; history.replaceState(null, "", "login.html"); render();
    }
    await signInWithEmailAndPassword(auth, email, password);
    location.replace("index.html");
  } catch (error) { status.textContent = error.code?.startsWith("auth/") ? "Could not log in. Check your email and password, or reset your password." : error.message; }
  finally { button.disabled = false; }
};
document.getElementById("resetBtn").onclick = async () => {
  const email = document.getElementById("email");
  if (!email.value || !email.checkValidity()) { status.textContent = "Enter your email first."; return; }
  try { await sendPasswordResetEmail(auth, email.value.trim()); status.textContent = "If that account exists, a password reset email is on its way."; }
  catch { status.textContent = "Could not send the reset email. Please try again."; }
};
