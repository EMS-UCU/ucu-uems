# Run this so vetters receive "Vetting Session Started" notifications

**Session starting is the most important notification** — vetters must see it to know they can join. **Do this once** so the Chief Examiner can create notifications for vetters and the bell shows them.

## Steps

1. Open **Supabase Dashboard**: https://supabase.com/dashboard  
   (Log in and select your project.)

2. In the left sidebar, click **SQL Editor**.

3. Click **New query**.

4. Open the file **`notifications_table_and_rls.sql`** in this project folder, copy **all** its contents, and paste them into the SQL Editor.

5. Click **Run** (or press Ctrl+Enter / Cmd+Enter).

6. You should see: **"✅ Notifications table and RLS ready. Chief can notify vetters; bell will show notifications."**

7. If you see any error about "publication" or "realtime", you can ignore it and continue. Notifications will still work.

After this, when the Chief starts a vetting session, vetters will get the notification in the bell and as a toast.

## If you see "foreign key constraint notifications_user_id_fkey" or "0 sent, 1 failed"

Your `notifications` table is still pointing at `auth.users(id)`. User ids in this app come from `user_profiles`, so you need to fix the foreign key:

1. In Supabase → **SQL Editor** → **New query**.
2. Open **`fix_notifications_foreign_key.sql`** in this project, copy all of it, paste into the editor, and **Run**.
3. You should see: **"✅ Notifications FK updated..."**
4. Have the Chief **start the vetting session again**. Vetters should now receive the notification.

## If vetters still don't see notifications

1. **Chief must start the session again** — Start the vetting session (click "Start Session") *after* you ran the SQL. Notifications are created only when the Chief starts the session.
2. **Check `user_profiles.roles`** — In Supabase → Table Editor → user_profiles, the vetter’s row must have `roles` containing `"Vetter"` (e.g. `["Vetter"]` or `["Lecturer","Vetter"]`). If it’s a single string `"Vetter"`, the app now supports that too.
3. **Check the `notifications` table** — In Table Editor → notifications, look for rows where `user_id` = the vetter’s auth user id. If there are none, the Chief’s "notify vetters" step didn’t run or failed (check browser console when the Chief starts the session).
4. **Browser console (F12)** — As a vetter, open the console; you may see a 🔔 message explaining why the list is empty.

## If vetters see "Vetting Session Started" when Chief hasn't started

If you ran `seed_all_notification_messages.sql` before we removed session notifications from it, vetters may have fake "Vetting Session Started" / "Vetter re-activated" rows. To fix:

1. In Supabase → **SQL Editor** → **New query**.
2. Open **`clear_seeded_session_notifications.sql`**, copy all of it, paste, and **Run**.
3. Chief should **Start Session** again. Vetters will then receive only the real notification.
