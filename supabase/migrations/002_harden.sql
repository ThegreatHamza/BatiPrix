-- Trigger functions must not be callable through the REST API.
revoke execute on function public.bati_profile_guard(), public.bati_payment_guard() from public, anon, authenticated;
