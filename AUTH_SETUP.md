# Invite-only authentication

1. Enable Email/Password in Firebase Authentication for `theboard-6f283`.
2. Using trusted Application Default Credentials with Firebase Auth admin permissions, run `cd functions` then `node set-admin.js YOUR_ADMIN_EMAIL`. Your existing admin account needs this claim before the new rules are deployed. Log out and back in afterward.
3. Deploy together: `firebase deploy --only functions,firestore:rules,storage,hosting`. Storage rules now use `storage.rules`; approve Firebase's cross-service Firestore permission prompt if shown.
4. Log in at `/admin.html`, create an invitation, copy its link, and send it to your group. New links expire after seven days and allow repeated signups with the selected cooldown (1 minute, 5 minutes, or 1 hour) after each successful registration. Older links remain single-use. Anyone holding a link can redeem it; they are not bound to an email address.
5. Check signup, login, logout, reset password, cooldown enforcement, reused/expired invitations, and direct database/function access as a nonmember. Verify members cannot edit admin settings.

Firebase may still allow accounts created directly through its public Auth API. Such accounts have no membership and cannot read data or call member functions. The website only offers signup through the server-validated invitation flow. Disabling all underlying Auth API signup requires Identity Platform blocking functions or additional provider configuration.

Site data requires membership, but the static HTML shell remains public on Firebase Hosting. Existing Firebase download-token video URLs remain shareable by URL; revoke those tokens if past videos must also become private. The weekly wheel password is stored in admin-only `config/private`; members can only verify it through server functions.

If a registration process dies after reserving an invitation, that link stays reserved to fail closed; create a replacement invitation. Delete a member's Firestore membership document to revoke access (existing pages may still show already-loaded data).

The beer counter stores only an integer `count`. Member taps call `addBeer`, which increments transactionally; admin overrides must be nonnegative integers. The previous displayed counter is rounded once when migrated.
