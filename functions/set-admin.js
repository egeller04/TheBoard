// Run with trusted Application Default Credentials; never ship credentials to the browser.
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "theboard-6f283" });
(async () => {
  if (!process.argv[2]) throw new Error("Usage: node set-admin.js ADMIN_EMAIL");
  const user = await admin.auth().getUserByEmail(process.argv[2]);
  await admin.auth().setCustomUserClaims(user.uid, { ...user.customClaims, admin: true });
  console.log("Admin access granted. Log out and back in to refresh your token.");
})().catch(error => { console.error(error.message); process.exitCode = 1; });
