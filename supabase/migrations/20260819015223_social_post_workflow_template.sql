-- Add generic production stages before the workflow migration uses them.
-- PostgreSQL enum values must be committed before they can be referenced safely.

alter type public.content_step add value if not exists 'design' after 'caption';
alter type public.content_step add value if not exists 'scheduling' after 'approval';
