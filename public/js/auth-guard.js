import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
export async function requireLogin() {
  const user = await new Promise(resolve => {
    const unsubscribe = onAuthStateChanged(auth, user => { unsubscribe(); resolve(user); });
  });
  try {
    if (!user) throw new Error("Login required");
    const token = await user.getIdTokenResult();
    if (!token.claims.admin && !(await getDoc(doc(db, "members", user.uid))).exists()) throw new Error("Invitation required");
    document.body.style.visibility = "visible";
    const button = document.createElement("button");
    button.textContent = "Log out";
    button.className = "logout-btn";
    button.addEventListener("click", async () => { await signOut(auth); location.replace("login.html"); });
    document.querySelector("nav").appendChild(button);
    return user;
  } catch {
    location.replace("login.html");
    await new Promise(() => {});
  }
}
