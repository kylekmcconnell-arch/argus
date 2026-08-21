-- Cover foreign-key maintenance paths introduced by the early-access growth schema.
create index if not exists feedback_items_created_by_idx
  on public.feedback_items (created_by);
create index if not exists feedback_items_report_version_idx
  on public.feedback_items (report_version_id)
  where report_version_id is not null;
create index if not exists referral_commissions_referred_idx
  on public.referral_commissions (referred_user_id, created_at desc);
