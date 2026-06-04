# Supabase Auth email setup

Use this setup for the Confirm signup email. It keeps the main verification link on the Recho domain instead of the default `*.supabase.co` link, which is friendlier to strict inboxes such as QQ Mail.

## Supabase URL settings

In Supabase Dashboard -> Authentication -> URL Configuration:

```text
Site URL:
https://recho.sansenjian.asia
```

Add these redirect URLs while testing and deploying:

```text
https://recho.sansenjian.asia/auth/confirm
https://recho-ai.onrender.com/auth/confirm
http://localhost:5173/auth/confirm
http://localhost:5174/auth/confirm
http://127.0.0.1:5173/auth/confirm
http://127.0.0.1:5174/auth/confirm
```

The frontend passes `emailRedirectTo` as the current origin plus `/auth/confirm`, so the matching URL must be in the allow list.

If an existing Supabase email template still sends links like `https://recho.sansenjian.asia/?token_hash=...&type=email`, the Vue router forwards that root URL to `/auth/confirm` and preserves the query string. This keeps older QQ-mail links usable after deployment.

## Confirm signup template link

In Supabase Dashboard -> Authentication -> Email Templates -> Confirm signup, use this link format:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">确认邮箱</a>
```

You can place it inside a button-styled table or any other email HTML, but keep the `href` format unchanged. The `/auth/confirm` page reads `token_hash` and calls `supabase.auth.verifyOtp()`.

## Custom SMTP note

As of 2026-06-03, new free Supabase projects using Supabase's default email provider cannot customize auth email templates. Projects using a custom SMTP provider such as Resend can still customize templates.

## Render static site routing

The Render static site needs a rewrite from `/*` to `/index.html` so direct visits from email links like `/auth/confirm?...` load the Vue app. This is tracked in `render.yaml`.
