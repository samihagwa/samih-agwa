-- Telegram limits captions attached to photos and videos to 1024 characters.
-- Reject an invalid publication at creation time instead of failing at the due time.
alter table public.publishing_posts
  add constraint publishing_posts_media_caption_length check (
    media_kind = 'none'
    or (
      char_length(post_text)
      + case when link_url is null then 0 else char_length(link_url) + 2 end
    ) <= 1024
  );

