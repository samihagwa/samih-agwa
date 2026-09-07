alter type public.crm_source add value if not exists 'instagram';
alter type public.crm_source add value if not exists 'tiktok';
alter type public.crm_source add value if not exists 'meta_business';

alter type public.crm_conversation_channel add value if not exists 'tiktok';
alter type public.crm_conversation_channel add value if not exists 'meta_business';
alter type public.crm_conversation_channel add value if not exists 'email';

