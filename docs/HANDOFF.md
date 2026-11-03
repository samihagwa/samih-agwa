# تقرير تسليم تقني — Market Whales OS

**تاريخ المراجعة: 4 نوفمبر 2026.**  
التقرير مبني على فحص الكود المحلي وGitHub والنشر الحالي ومخطط Supabase مباشرة. لم أغيّر بيانات أو أنشر إصدارًا أثناء المراجعة، ولم أدرج أي مفاتيح أو كلمات مرور أو توكنز.

أهم النتائج قبل التفاصيل:

- الموقع مبني على **Vinext المتوافق مع Next.js، وليس Next.js التقليدي**.
- استضافة OS الحالية على **Sites / Cloudflare Workers، وليست Hostinger VPS**.
- الكود المحلي وGitHub والنسخة المنشورة متطابقون عند الإصدار **104**.
- يوجد اختلاف مهم بين سجل migrations المحلي وسجل الإنتاج، يجب تسويته قبل أي `db push`.
- توجد مزامنة Google Sheet فاشلة لتسجيل حديث، رغم حفظ التسجيل في CRM.
- لم أعثر على مصدر مستقل لبوت تفعيل المؤشر أو كود Brevo؛ الجزء المؤكد داخل هذا المشروع هو **صفحة التسجيل ← CRM ← محاولة مزامنة الشيت + مهام التفعيل والمتابعة**.

---

## 1. مسارات المشروع والمكونات المرتبطة

### المشروع الرئيسي

[فتح فولدر Market Whales OS](/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os)

```text
/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os
```

### صفحة تسجيل Whales Zone

[فتح ملف الصفحة](/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/whales-zone/index.html)

```text
/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/whales-zone/index.html
```

الصفحة المنشورة: [samihagwa.com/whales-zone](https://samihagwa.com/whales-zone/).

**التحقق الحالي:** الصفحة تعمل، ومحتواها مطابق للملف المحلي حرفيًا. استجابتها تأتي من GitHub Pages.

### استقبال التسجيل ومزامنة Google Sheet

[فتح lead-intake](/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/supabase/functions/lead-intake/index.ts)

```text
/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/supabase/functions/lead-intake/index.ts
```

هذا الملف يستقبل التسجيل، يحفظه في CRM، ثم يستدعي Google Apps Script.

**مصدر Google Apps Script نفسه غير موجود ضمن الملفات التي عثرت عليها.** الموجود هو عنوان الـWeb App داخل ثابت `sheetMirrorUrl`. يلزم تسليم مشروع Apps Script وحساب Google المالك له بشكل منفصل.

### بوت تليجرام

الموجود داخل OS:

```text
/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/supabase/functions/telegram-webhook/index.ts

/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/supabase/functions/telegram-publisher/index.ts

/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/supabase/functions/telegram-publishing-commands/index.ts
```

وظيفتها ربط أعضاء الفريق بتليجرام، الإشعارات، استقبال وسائط النشر، وموافقات ونشر المحتوى.

**لم أعثر على فولدر مستقل موثّق لبوت تفعيل المؤشر. لا يصح اعتبار بوت OS هو بوت المؤشر تلقائيًا.** كذلك لم أتحقق من سيرفر خارجي يشغّل هذا البوت.

---

## 2. GitHub وحالة الكود

المستودع:

[github.com/samihagwa/samih-agwa](https://github.com/samihagwa/samih-agwa)

| البند | الحالة المؤكدة |
|---|---|
| Git remote | `origin` يشير إلى المستودع أعلاه |
| الفرع المحلي | `agent/market-whales-os-foundation` |
| فرع GitHub الذي تم التحقق منه | `main` |
| التعديلات المحلية غير المرفوعة | لا توجد؛ working tree نظيفة |
| تطابق المحلي مع GitHub | نعم، نفس commit |
| تطابق النسخة المنشورة مع commit | نعم، Sites version 104 |

آخر commit:

```text
4143a7fd15794ff1607648be78ec7f2c9d2a57ea
```

التاريخ:

```text
2026-09-21 04:02:56 +03:00
```

الرسالة:

```text
Fix Cairo day-only intake and expose CRM profiles from follow-up tasks
```

[فتح الـcommit على GitHub](https://github.com/samihagwa/samih-agwa/commit/4143a7fd15794ff1607648be78ec7f2c9d2a57ea)

**مهم:** رفع الكود إلى GitHub ليس وحده نشرًا لواجهة OS؛ هناك خطوة نشر منفصلة على Sites.

---

## 3. الاستضافة وطريقة النشر

### التوزيع الحالي

| المكوّن | مكان التشغيل |
|---|---|
| واجهة OS وSSR | Cloudflare Workers عبر Sites |
| PostgreSQL / Auth / Realtime / Storage | Supabase |
| Backend commands وwebhooks | Supabase Edge Functions |
| صفحة Whales Zone | GitHub Pages على `samihagwa.com` |
| Google Sheet bridge | Google Apps Script خارجي |
| بوت تفعيل مستقل / Brevo | الاستضافة والمصدر غير متحققين |

روابط OS:

- الرئيسي: [os.samihagwa.com](https://os.samihagwa.com)
- عنوان Sites: [market-whales-os.samihsmaih1234.chatgpt.site](https://market-whales-os.samihsmaih1234.chatgpt.site)

بيانات المشروع غير السرية:

```text
Sites project_id:
appgprj_6a821567369c81919ca206eab3032f33

Live version:
104

Deployment:
appgdep_6ab082f752a081918f6839e221effab7

Deployment status:
succeeded
```

الاستجابة الحالية للدومين الرئيسي HTTP 200.

### هل يوجد pm2 أو Docker أو nginx؟

لم أجد إعداد تشغيل إنتاجي يعتمد عليها داخل مشروع OS.

- لا يوجد دليل أن OS يعمل على Hostinger VPS.
- `pnpm start` موجود لتشغيل Vinext، لكنه ليس دليل وجود daemon على VPS.
- `worker/index.ts` هو مدخل Cloudflare Worker.
- `vite.config.ts` و`build/sites-vite-plugin.ts` يجهزان بناء التطبيق للاستضافة.
- `.openai/hosting.json` يربط الفولدر بمشروع Sites.
- لا توجد قواعد D1 أو R2 مرتبطة في هذا الملف؛ البيانات والتخزين المستخدمان هنا على Supabase.

### أوامر التطوير والتحقق

```bash
cd "/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os"

pnpm install --frozen-lockfile
pnpm dev

pnpm typecheck
pnpm lint
pnpm test
git diff --check
```

`pnpm test` يشغّل البناء ثم الاختبارات. ويمكن فصل الخطوتين:

```bash
pnpm build
node --test tests/*.test.mjs
```

بعد مراجعة التعديلات، رفع GitHub يكون إلى `main`:

```bash
git push origin HEAD:main
```

لا يُنفّذ قبل تسجيل التغييرات المطلوبة في commit ومراجعة نطاقها.

### نشر واجهة OS

مسار النشر يعتمد على أدوات Sites، وليس أمر SSH:

1. فتح مشروع Sites الحالي والحصول على صلاحية مصدر مؤقتة.
2. بناء المصدر المحدد والتحقق منه.
3. تجهيز archive مربوط بنفس commit.
4. `save_site_version`.
5. `deploy_site_version`.
6. التحقق من نجاح deployment.

الـhelper الحالي المثبت على هذا الماك:

```bash
node /Users/samihagwa/.codex/plugins/cache/openai-curated-remote/sites/1.1.3/scripts/site-workflow.mjs \
  --project-id appgprj_6a821567369c81919ca206eab3032f33
```

يستقبل عبر stdin إعدادات `credential` و`source` و`commands` و`archivePath`. **بيانات الصلاحية لا توضع في الأمر أو المستودع.** هذا helper خاص ببيئة Sites المثبتة، وليس سكربتًا محمولًا داخل الريبو.

متغيرا Supabase العامّان يجب أن يكونا موجودين **وقت البناء**؛ تعديل runtime env وحده ليس بديلًا لإعادة بناء الواجهة.

### نشر Supabase

نشر Edge Functions منفصل عن نشر الواجهة. مثال لأمر CLI بعد إعداد حساب المطوّر وصلاحياته:

```bash
pnpm exec supabase functions deploy lead-intake \
  --project-ref xmnqwcevqahtoixvcdya
```

يجب الحفاظ على إعدادات JWT لكل function؛ بعض endpoints العامة تستخدم حماية مخصصة بدل JWT.

**لا أنصح بتشغيل `supabase db push` على هذا المشروع الآن قبل مطابقة سجل migrations، بالتفصيل في القسم 5.**

---

## 4. الستاك وهيكل الكود

### الإصدارات المثبتة

| التقنية | الإصدار |
|---|---|
| Vinext | `1.0.0-beta.2` |
| Vite | `8.0.13` |
| React / React DOM | `19.2.6` |
| TypeScript | `5.9.3` |
| Supabase JS | `2.112.3` |
| Tailwind CSS | `4.2.1` |
| Lucide React | `1.31.0` |
| IBM Plex Sans Arabic | `5.2.8` |
| Cloudflare Vite plugin | `1.37.1` |
| Supabase CLI | `2.114.0` |
| PGlite للاختبارات المعزولة | `0.5.8` |
| ESLint | `9.39.4` |
| الحد الأدنى لـNode | `22.13.0` |
| PostgreSQL الإنتاجي | `17.6` |

**لا توجد حزمة Next.js runtime في dependencies.** وجود `@next/eslint-plugin-next@16.2.6` و`next.config.ts` لا يعني أن التطبيق يعمل على Next.js 16.

بعض Edge Functions تستخدم:

```text
npm:@supabase/server@1.4.1
```

لإنشاء سياق المستخدم وقاعدة البيانات.

### الهيكل

```text
market-whales-os/
├── app/                     Routes + layouts + global styles
├── components/
│   ├── ui/                  عناصر الواجهة المشتركة
│   ├── layout/              التنقل وهيكل التطبيق
│   └── ...                  CRM / Tasks / Scripts / Content وغيرها
├── lib/                     منطق الدومين والتحويلات والتحقق
│   └── supabase/            client / auth session / database types
├── supabase/
│   ├── migrations/          SQL schema + policies + RPCs
│   ├── functions/           Edge Functions
│   └── config.toml
├── tests/                   اختبارات Node وSQL وواجهات اختبار
├── docs/                    قرارات التشغيل والعقود والتوثيق
├── whales-zone/index.html   صفحة التسجيل العامة
├── worker/index.ts          Cloudflare Worker entry
├── build/sites-vite-plugin.ts
├── .openai/hosting.json
├── .agents/skills/market-whales-os/
├── vite.config.ts
├── next.config.ts
├── package.json
└── pnpm-lock.yaml
```

المسار هو **`app/` في الجذر، وليس `src/app/`**.

### Routes الحالية

```text
/
/analytics
/auth/confirm
/brand
/campaigns
/chat
/content
/crm
/crm/[id]
/crm/customers
/crm/exness
/crm/operations
/join
/login
/planning
/publishing
/reset-password
/scripts
/scripts/[id]
/settings
/tasks
/tasks/[id]
/tasks/content/[id]
/team
```

لا يوجد Backend رئيسي على نمط `app/api/*`. التنفيذ يعتمد على Supabase Edge Functions وPostgreSQL RPCs، مع قراءات محكومة بـRLS.

### ملفات بداية مهمة للمطوّر

- [قواعد المشروع](/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/AGENTS.md)
- [README](/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/README.md)
- [خريطة التشغيل](/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/docs/operating-roadmap.md)
- [Supabase client](/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/lib/supabase/client.ts)
- [أنواع قاعدة البيانات](/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/lib/supabase/database.types.ts)

بعض فقرات README والتوثيق تصف مراحل أقدم؛ **الكود الحالي والمخطط الحي مقدّمان عليها عند التعارض**.

---

## 5. Supabase: الجداول وRLS وmigrations

### المشروع

```text
Project ref: xmnqwcevqahtoixvcdya
API URL: https://xmnqwcevqahtoixvcdya.supabase.co
Region: eu-central-1 — Frankfurt
Status: ACTIVE_HEALTHY
PostgreSQL: 17.6
```

[لوحة مشروع Supabase](https://supabase.com/dashboard/project/xmnqwcevqahtoixvcdya)

يوجد **82 جدول تطبيق: 73 في `public` و9 في `private`**.

القائمة التالية تشمل أسماء جميع جداول التطبيق وأعمدتها الأساسية. اختصرت أعمدة التدقيق المتكررة مثل `created_at` و`updated_at`، وبعض `id` و`organization_id` حيث لا يلزم تكرارها. ليست هذه نسخة DDL كاملة للـconstraints والـindexes.

### أ. المؤسسة والمستخدمون والصلاحيات — `public`

```text
organizations:
  id, name, slug, created_by

profiles:
  id, full_name, avatar_url

memberships:
  organization_id, user_id, role, status, allowed_sections,
  invited_by, onboarding_acknowledgements, onboarding_completed_at

team_invitations:
  organization_id, email, full_name, role, allowed_sections,
  token_hash, status, invited_by, expires_at, accepted_by, accepted_at

account_access_requests:
  organization_id, user_id, email, full_name, status,
  approved_role, approved_sections, reviewed_by, reviewed_at

password_recovery_requests:
  organization_id, user_id, status, requested_at,
  link_generated_at, resolved_at, handled_by

member_presence:
  organization_id, user_id, current_section,
  session_started_at, last_seen_at

notifications:
  id, organization_id, user_id, kind, title, body,
  entity_type, entity_id, url, dedupe_key, read_at

audit_events:
  id, organization_id, actor_id, action, entity_type,
  entity_id, before_data, after_data, request_id, occurred_at
```

`profiles.id` هو مرجع مستخدم Supabase Auth. الحساب والمصادقة داخل `auth.users`، بينما عضوية المؤسسة وصلاحيات الأقسام داخل `memberships`.

### ب. العملاء والتسجيلات — `public`

```text
crm_contacts:
  id, organization_id, full_name, stage, source, source_detail,
  interest, interest_detail, owner_id, consent_status,
  intake_origin, source_registered_at, trading_experience,
  follow_up_required, next_follow_up_at, last_contacted_at,
  converted_at, closure_reason, notes, version

crm_identities:
  contact_id, kind, value, normalized_value, is_primary, created_by

crm_conversation_links:
  contact_id, channel, label, url, is_primary, created_by

crm_activities:
  contact_id, actor_id, kind, from_stage, to_stage,
  summary, next_follow_up_at, occurred_at

crm_sales_profiles:
  contact_id, lead_temperature, preferred_contact_method,
  preferred_contact_time, needs, objections, next_action,
  tags, version

crm_customer_purchases:
  contact_id, product, product_detail, exness_account,
  tradingview_username, subscription_amount,
  subscription_currency, subscription_starts_on,
  subscription_ends_on, created_by

crm_creation_requests:
  organization_id, request_id, actor_id, payload_hash, contact_id

crm_import_batches:
  organization_id, source_system, status, total_rows,
  created_rows, duplicate_rows, error_rows,
  created_by, completed_at, rolled_back_at

crm_import_rows:
  batch_id, organization_id, source_system, external_id,
  contact_id, result, signal, source_registered_at,
  contact_version_at_import, error_message

crm_lead_intake_events:
  id, organization_id, source_system, external_id, contact_id,
  outcome, registered_at, payload_hash, request_fingerprint,
  sheet_mirror_status, sheet_mirrored_at, sheet_mirror_error

crm_lead_routing_members:
  organization_id, user_id, position

crm_indicator_workflow_settings:
  organization_id, activation_owner_id, sales_owner_id,
  sales_follow_up_delay_hours, updated_by

crm_indicator_workflows:
  intake_event_id, organization_id, contact_id,
  activation_owner_id, sales_owner_id,
  activation_task_id, sales_task_id, completed_at
```

التمييز المهم:

- تسجيل المؤشر: `crm_lead_intake_events`.
- ملف العميل: `crm_contacts`.
- الهاتف والإيميل وTradingView: `crm_identities`.
- منع تكرار الإنشاء اليدوي: `crm_creation_requests`.
- المشتريات والاشتراكات: `crm_customer_purchases`.
- فصل مصدر الإدخال اليدوي عن الخارجي: `intake_origin` مع `source` و`interest`.
- لا يوجد جدول مستقل اسمه `registrations` ضمن جداول التطبيق.

### ج. تكامل Exness — `public`

```text
broker_integrations:
  provider, display_name, status, base_url,
  account_lookup_enabled, last_sync_at, last_error

broker_client_accounts:
  integration_id, crm_contact_id, external_client_id,
  account_number, client_profile, is_active,
  lots, commission, commission_currency, last_synced_at

broker_sync_runs:
  integration_id, request_key, status,
  fetched_rows, upserted_rows, error_rows,
  error_message, triggered_by, started_at, completed_at
```

### د. المهام والتكرار وسعة الفريق — `public`

```text
tasks:
  id, organization_id, title, description, status, priority,
  owner_id, created_by, acceptance_criteria, due_at,
  started_at, completed_at, version, requires_review,
  is_work_item, estimated_minutes,
  crm_contact_id, crm_work_kind,
  content_item_id, content_step,
  launch_id, launch_gate, launch_deliverable_id,
  source_plan_item_id, recurring_template_id, recurrence_slot_at

task_attention:
  task_id, organization_id, assignee_id, revision, urgency, blocker

task_deliveries:
  task_id, result_note, result_url, version,
  submitted_by, submitted_at

task_dependencies:
  task_id, depends_on_task_id

task_discussion_messages:
  task_id, author_id, body, created_at

task_events:
  task_id, actor_id, event_type, from_status,
  to_status, details, occurred_at

task_revision_requests:
  task_id, requested_by, instructions, task_version, requested_at

recurring_task_templates:
  title, description, owner_id, priority, requires_review,
  estimated_minutes, weekday, time_local, starts_on, ends_on,
  paused, archived_at, version, last_materialized_at, last_error,
  content_bundle_id, content_bundle_title, content_bundle_request,
  content_bundle_format, content_step,
  bundle_anchor_weekday, bundle_anchor_time

recurring_content_occurrences:
  content_bundle_id, bundle_slot, content_item_id

team_capacity_settings:
  organization_id, user_id, daily_capacity_minutes, max_parallel_tasks
```

### هـ. المحتوى والخطة والتقويم — `public`

```text
content_items:
  id, organization_id, title, format, status, platforms,
  goal, hook, cta, publish_at, published_at, version,
  intake_request, intake_source_url, intake_request_key,
  script_outline, editing_brief, thumbnail_brief,
  brand_notes, copy_brief, design_brief, caption_brief

content_assets:
  content_item_id, stage, kind, title, url, notes, created_by

content_brand_references:
  content_item_id, brand_article_id, created_by

content_step_deliveries:
  content_item_id, task_id, step, result_note,
  result_url, result_images, version, submitted_by, submitted_at

content_revision_requests:
  content_item_id, task_id, stage, round, instructions,
  status, requested_by, assigned_to, resolved_by

content_timeline_cues:
  content_item_id, start_seconds, end_seconds, kind,
  action, source_url, sort_order, completed_by, completed_at

content_plans:
  name, starts_on, ends_on, objective, audience, offer,
  primary_metric, status, version, archived_at

content_plan_pillars:
  plan_id, title, purpose, target_quantity, sort_order, version

content_plan_items:
  plan_id, pillar_id, content_item_id, kind, title,
  objective, hook_direction, cta, platforms, owner_id,
  publish_at, status, estimated_minutes, version

content_calendar_slots:
  content_item_id, plan_item_id, platform, scheduled_at,
  revision, completed_at, completed_by
```

تجميع المنصات في كارت واحد بالواجهة لا يلغي أن الجدولة مخزنة لكل منصة. وعلامة اكتمال التقويم **ليست دليل نشر فعلي على المنصة**.

### و. السكريبتات — `public`

```text
scripts:
  id, organization_id, created_by, assigned_to, title,
  input_mode, source_url, source_text, objective, audience,
  platform, duration_seconds, content_pillar,
  hook_variants, spoken_script, cta, caption, hashtags,
  recording_notes, editing_notes, thumbnail_notes,
  on_screen_text, b_roll_notes, claims_notes,
  status, draft_stage, content_kind, edit_version,
  content_item_id, handed_off_at, archived_at,
  production_pack_source_version, production_pack_stale

script_versions:
  script_id, version_number, source, snapshot, note, created_by

script_review_access:
  script_id, organization_id, reviewer_id, granted_by

script_review_comments:
  script_id, organization_id, author_id, body, created_at

script_pages:
  script_id, parent_id, title, body, edit_version

script_research_items:
  assigned_to, kind, status, title, source_url, raw_notes,
  transcript, hook, transferable_principle, why_it_works,
  original_angles, performance_signal, brand_fit,
  freshness, linked_script_id, used_at

script_voice_profiles:
  organization_id, user_id, voice_summary, writing_rules,
  banned_phrases, story_bank, approved_examples,
  source_notes, edit_version

script_voice_samples:
  organization_id, owner_id, source_script_id,
  content_kind, sample_text, active
```

بقاء جدول مثل `script_pages` أو `script_research_items` لا يعني أن كل واجهاته مفعلة حاليًا؛ إخفاء ميزة لا يستلزم حذف بياناتها.

### ز. الحملات والإطلاقات — `public`

```text
launches:
  title, type, objective, audience, offer, primary_cta,
  starts_at, ends_at, lead_target, sales_target,
  revenue_target, currency, status, owner_id, version,
  cancelled_at, cancellation_reason

launch_documents:
  launch_id, gate, title, summary, document_url, status, version

launch_deliverables:
  launch_id, kind, title, brief, channel, destination,
  planned_quantity, owner_id, due_at, budget_category,
  budget_amount, currency, result_note, result_url,
  delivered_at, workflow_template, creation_request_id

launch_deliverable_dependencies:
  launch_id, deliverable_id, depends_on_deliverable_id

launch_content_items:
  launch_id, content_item_id, launch_deliverable_id,
  deliverable_sequence
```

### ح. النشر وتليجرام — `public`

```text
publishing_admin_connections:
  organization_id, user_id, telegram_chat_id, telegram_user_id,
  telegram_username, link_code_hash, link_expires_at,
  connected_at, notifications_enabled,
  workflow_notifications_enabled, workflow_last_sent_at,
  workflow_last_error, workflow_expected_username

publishing_channels:
  platform, telegram_chat_id, telegram_username, title,
  bot_username, bot_user_id, allowlisted, bot_can_post,
  verification_status, verified_at, last_error

publishing_controls:
  organization_id, kill_switch, generation, reason, updated_by

publishing_posts:
  content_item_id, name, post_text, link_url, media_kind,
  media_source, media_asset_id, disable_link_preview, status

publishing_schedules:
  post_id, schedule_type, once_at, weekdays, time_local,
  timezone_name, starts_on, ends_on, occurrence_limit,
  preview_policy, preview_lead_minutes, missed_grace_minutes,
  paused, deleted_at

publishing_schedule_channels:
  schedule_id, channel_id

publishing_occurrences:
  schedule_id, post_id, scheduled_at, status,
  snapshot_payload, snapshot_hash, approved_snapshot_hash,
  callback_token, callback_consumed_at,
  preview_claim_token, preview_claimed_at,
  preview_chat_id, preview_message_id, preview_sent_at,
  automation_generation, hold_reason, error, occurrence_key

publishing_publication_logs:
  occurrence_id, post_id, channel_id, status, claim_token,
  claim_generation, claim_expires_at, attempt_count,
  network_started_at, message_id, message_url,
  telegram_error_code, error, published_at

publishing_telegram_assets:
  received_by_user_id, telegram_chat_id, telegram_user_id,
  telegram_message_id, telegram_file_id, telegram_file_unique_id,
  media_kind, display_name, original_caption, file_name,
  mime_type, file_size, width, height, duration_seconds,
  preview_object_path, archived_at, last_received_at
```

### ط. AI والبراند والشات — `public`

```text
ai_providers:
  name, protocol, base_url, model, is_enabled, is_default,
  key_hint, last_tested_at, last_test_status, last_test_message

assistant_conversations:
  user_id, title, memory_summary, message_count, last_message_at

assistant_messages:
  conversation_id, user_id, role, body, provider_label, links

brand_articles:
  topic_id, version, edit_version, status, category, audiences,
  title, summary, guidelines, do_list, dont_list,
  examples, reference_urls, change_note, approved_by, approved_at

team_chat_rooms:
  name, slug, description, created_by, is_archived

team_chat_messages:
  room_id, author_id, body, reply_to_id, edited_at, deleted_at
```

### ي. الجداول الخاصة — `private`

```text
ai_provider_secrets:
  provider_id, organization_id, vault_secret_id

auth_access_attempts:
  id, scope, fingerprint_hash, email_hash, attempted_at

crm_conversation_images:
  id, organization_id, contact_id, created_by,
  object_path, content_hash, mime_type, caption, state, held_bytes

crm_lead_intake_rate_limits:
  id, request_fingerprint, received_at

team_presence_days:
  organization_id, user_id, day, first_seen, last_seen

team_report_coverage:
  singleton, presence_since

team_report_settings:
  organization_id, daily_enabled, weekly_enabled,
  delivery_hour, weekly_day, included_users, recipients, revision

team_reports:
  id, organization_id, recipient_id, scope, cadence,
  period_start, period_end, snapshot, created_at

telegram_notification_outbox:
  notification_id, organization_id, user_id, status,
  available_at, attempt_count, claim_token, claimed_at,
  network_started_at, telegram_message_id,
  telegram_error_code, error, sent_at
```

جداول Supabase النظامية مثل `auth.users` و`auth.sessions` و`storage.objects` و`storage.buckets` وVault ليست ضمن عدد جداول التطبيق أعلاه.

### العلاقات الأهم

- العميل ↔ المهام: `tasks.crm_contact_id`.
- تسجيل المؤشر ↔ العميل: `crm_lead_intake_events.contact_id`.
- التسجيل ↔ مهمتي التفعيل والمتابعة: `crm_indicator_workflows`.
- طلب المحتوى ↔ المهام: `tasks.content_item_id` و`content_step`.
- السكريبت ↔ طلب التنفيذ: `scripts.content_item_id`.
- الخطة ↔ التنفيذ: `content_plan_items.content_item_id`.
- الإشعار ↔ الكيان: `entity_type`, `entity_id`, `url`.
- منع تكرار عمليات التنفيذ يعتمد على request keys وunique constraints، وليس تعطيل الزر فقط.

### سياسات الصلاحيات المهمة

- **RLS مفعّل على جميع جداول `public` الـ73.**
- العزل الأساسي بالمؤسسة `organization_id` والعضوية النشطة.
- صلاحيات الأقسام محفوظة في `memberships.allowed_sections` وتُفحص مع الدور.
- CRM: رؤية العميل لمسؤوله أو القيادة المخوّلة، مع شرط الوصول للقسم.
- امتلاك صلاحية رؤية مهمة لا يمنح تلقائيًا صلاحية رؤية ملف العميل.
- تنفيذ المهمة وانتقالات حالتها محكومة بالمسؤول والأدوار والأوامر؛ ليست كتابة `status` عشوائية من الواجهة.
- الإشعارات مخصصة للمستخدم المستلم.
- السكريبتات خاصة بالمسؤول عنها أو من مُنح حق المراجعة؛ لا تفترض أن مالك المؤسسة يرى كل سكريبت خاص.
- بصمة الكتابة خاصة بصاحبها.
- البيانات المالية التفصيلية لـExness للمالك؛ فحص السيلز أضيق نطاقًا.
- جداول `private` ليست API عامة؛ كثير من عملياتها تمر عبر RPCs مضبوطة الصلاحيات. ليست جميعها معتمدة على RLS وحده.
- بعض جداول RLS بلا policies عمدًا لمنع الوصول المباشر واستخدام أوامر مضبوطة بدلًا منه.
- مفاتيح AI محفوظة عبر Vault ومراجع `private.ai_provider_secrets`، وليست نصًا عامًا في `ai_providers`.

### Storage

| Bucket | الخصوصية | الحد لكل ملف |
|---|---|---|
| `crm-conversation-images` | Private | 1 MiB، JPEG/WebP |
| `publishing-media-previews` | Private | 5 MiB، JPEG/PNG/WebP |

صور CRM تدعم ضغطًا وإزالة metadata وحجبًا يدويًا قبل الرفع. العقد الحالي:

- حتى 5 صور في الدفعة.
- حتى 200 صورة/حجز لكل عميل.
- سقف gallery يبلغ 700 MiB.
- فحص سقف مشترك 900 MiB مع استخدامات Storage الأخرى.
- الأرشفة لا تحرّر مساحة.
- لا يوجد حذف تلقائي.
- هذه الحدود **ليست ضمانًا لعدم وجود تكلفة**، خصوصًا نقل البيانات.

[تفاصيل عقد صور العملاء](/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/docs/crm-conversation-images.md)

### migrations — تنبيه تسليم أساسي

المسار:

[فتح migrations](/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/supabase/migrations)

```text
/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/supabase/migrations
```

نتيجة المقارنة الحالية:

- محليًا: **144 ملفًا**.
- سجل الإنتاج: **142 migration**.
- **135 اسمًا متطابقًا لكن version/timestamp مختلف** بين المحلي والإنتاج.
- اسمان محليان غير موجودين بالاسم في سجل الإنتاج:

```text
20260822182732_exness_agency_integration_foundation.sql
20260822184714_fix_crm_import_policy_execution.sql
```

هذا **لا يثبت أن تأثيرهما غير مطبق**؛ جداول Exness موجودة فعليًا. المشكلة المؤكدة هي عدم تطابق سجل الترحيلات، ويجب مقارنة التعريفات الفعلية قبل أي إصلاح للسجل.

آخر migration مطابق:

```text
20260921005630_content_request_cairo_day.sql
```

**لا تعمل reset، ولا تعِد تشغيل جميع migrations، ولا تستخدم db push عشوائيًا.** يلزم أولًا مطابقة history مع schema ومراجعة migrations التاريخية التي تتضمن تنظيف بيانات.

---

## 6. مسار تسجيل المؤشر والتكاملات

### المسار المؤكد من الكود والإنتاج

```text
صفحة Whales Zone
       │ POST
       ▼
Edge Function: lead-intake
       │
       ▼
RPC: ingest_whales_zone_lead
       ├── حفظ/مطابقة العميل وهوياته
       ├── تسجيل intake event
       ├── توزيع المسؤول
       └── إنشاء/ربط مهام التفعيل والمتابعة
       │
       ▼
محاولة إرسال نسخة إلى Google Apps Script
       │
       ▼
تسجيل نتيجة المزامنة داخل CRM
```

### 1. صفحة التسجيل

ترسل:

```text
name
email
tv_username
whatsapp
request_id
opened_at
company
```

- `request_id`: UUID للطلب.
- `company`: honeypot لمقاومة الطلبات الآلية.
- الزر يتعطل أثناء الإرسال.
- لا يظهر نجاح التسجيل إلا بعد قبول backend.

الـendpoint:

```text
POST https://xmnqwcevqahtoixvcdya.supabase.co/functions/v1/lead-intake
```

### 2. `lead-intake/index.ts`

مسؤول عن:

- قبول POST وOPTIONS.
- فحص Origin وحجم الطلب.
- التحقق من البيانات وتطبيعها.
- فحص وقت فتح النموذج.
- حساب بصمة للطلب وhash للبيانات.
- استدعاء RPC باستخدام صلاحية الخادم.
- التعامل مع التضارب وrate limiting.
- محاولة إرسال نسخة إلى الشيت.

### 3. قاعدة البيانات

الدوال المحورية:

```text
public.ingest_whales_zone_lead
public.ingest_whales_zone_lead_unrouted
private.pick_crm_lead_route
private.ensure_whales_zone_indicator_workflow
public.complete_whales_zone_sheet_mirror
```

النسخة الحالية من مسار workflow تتعامل مع `created` و`deduplicated`، وتحاول إعادة استخدام العمل المفتوح بدل تكوين مهام مكررة. كما تراعي `do_not_contact` ورفض الموافقة.

ملفات أساسية لفهم التاريخ:

```text
20260822191033_whales_zone_lead_intake.sql
20260822233859_canonical_deep_links_and_whales_zone_routing.sql
20260823030656_whales_zone_activation_and_sales_routing.sql
20260909010100_sales_crm_operational_repair.sql
20260913010000_separate_manual_sales_intake.sql
```

**لا تعتمد على أول تعريف للدالة فقط؛ migrations اللاحقة تستبدله.**

الإعداد الحالي الذي قرأته من القاعدة:

- مسؤول التفعيل: **دكتور أيمن**.
- مسؤول السيلز الاحتياطي: **أحمد مجدي**.
- مهلة متابعة السيلز المضبوطة: **4 ساعات**.
- توزيع السيلز قد يستخدم `crm_lead_routing_members` قبل المسؤول الاحتياطي.

مهمة التفعيل هنا تكليف بشري بمراجعة حساب TradingView وتفعيله. **لم أجد تنفيذًا داخل هذا المشروع يمنح صلاحية المؤشر على TradingView تلقائيًا.**

### 4. Google Sheet

`lead-intake` يستدعي Google Apps Script عبر GET، ببيانات التسجيل في query parameters، مع timeout مدته 6 ثوانٍ.

يحدّث:

```text
sheet_mirror_status
sheet_mirrored_at
sheet_mirror_error
```

نقاط مهمة:

- حفظ CRM لا يُلغى إذا فشل الشيت.
- النجاح في هذا الكود يعتمد على HTTP success، وليس تحققًا مستقلًا من وجود الصف داخل Sheet.
- عنوان Apps Script ثابت داخل الملف، وليس environment variable.
- إرسال بيانات شخصية عبر query string يستحق مراجعة وتحويلًا إلى عقد POST موثّق.
- لم أجد ضمن cron الحالية job مستقلة لإعادة محاولة مزامنة الشيت.

**الحالة الحية:** يوجد سجل فاشل بتاريخ `2026-11-02 22:05:25 UTC`، برسالة:

```text
The signal has been aborted
```

هذا يتوافق مع إلغاء/انتهاء مهلة الطلب، وليس دليلًا على فقد ملف العميل.

### 5. الجروب وBrevo

لم أجد في المسار السابق:

- إضافة عضو تلقائيًا لجروب تليجرام.
- استدعاء Brevo API.
- بيانات ربط Telegram user ID ضمن نموذج التسجيل.
- مصدر بوت مستقل ينفّذ ذلك.

لذلك **لا أستطيع توثيق سلسلة bot → group → Brevo باعتبارها جزءًا مؤكدًا من OS**. قد تكون داخل Google Apps Script أو بوت/خدمة خارجية لم تُسلَّم مصادرها.

المطلوب استلامه من صاحب التكامل القديم:

1. مستودع أو فولدر بوت التفعيل.
2. بيانات تعريف السيرفر وطريقة تشغيله، دون نشر أسراره.
3. مشروع Google Apps Script وصلاحيات الوصول للشيت.
4. إعدادات Brevo والـautomations أو webhooks المستخدمة.
5. اسم البوت والجروب وطريقة منح وصول المؤشر.

### 6. تليجرام الخاص بـOS

```text
/functions/v1/telegram-webhook
/functions/v1/telegram-publisher
/functions/v1/telegram-publishing-commands
```

- `telegram-webhook`: أوامر `/start` للربط، callbacks الخاصة بالنشر، واستقبال الوسائط. يتحقق من `TELEGRAM_WEBHOOK_SECRET`.
- `telegram-publisher`: تنفيذ النشر والإشعارات المحجوزة؛ محمي بـ`PUBLISHING_WORKER_SECRET`.
- `telegram-publishing-commands`: أوامر الإدارة المحكومة بهوية المستخدم.
- الإشعارات تمر عبر `notifications` ثم `private.telegram_notification_outbox`.

الـcron النشطة:

| Job | الجدولة |
|---|---|
| `market-whales-task-deadline-reminders` | كل 10 دقائق |
| `market-whales-telegram-publisher` | كل دقيقة |
| `market-whales-weekly-task-routines` | الدقيقة 17 من كل ساعة |
| `team-activity-reports` | كل 15 دقيقة |

وجود job نشطة لا يثبت وصول كل رسالة؛ التحقق التشغيلي يكون من outbox/logs والمستلم.

### Edge Functions المنشورة

جميع الآتية كانت `ACTIVE` وقت الفحص:

```text
account-access
ai-provider-commands
bootstrap-organization
brand-commands
broker-commands
chat-commands
content-commands
create-content-workflow
crm-commands
launch-commands
lead-intake
request-access-link
script-ai
script-commands
team-commands
telegram-publisher
telegram-publishing-commands
telegram-webhook
workspace-assistant
```

---

## 7. أسماء متغيرات البيئة — بدون قيم

### الموجودة فعلًا في `.env.local` و`.env.example`

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

وهما أيضًا الاسمان المسجلان في إعدادات بيئة Sites الحالية.

### المستخدمة في Edge Functions

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_SECRET_KEYS

TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
PUBLISHING_WORKER_SECRET

EXNESS_PARTNER_LOGIN
EXNESS_PARTNER_PASSWORD
```

`SUPABASE_SECRET_KEYS` مستخدم كمسار بديل داخل بعض وظائف تليجرام. لم أستخرج قيم أسرار الإنتاج.

### متغيرات أدوات البناء والاختبار

```text
CODEX_SANDBOX
WRANGLER_LOG_PATH
WRANGLER_WRITE_LOGS
MINIFLARE_REGISTRY_PATH
TZ
```

### أسماء مذكورة في إعداد Supabase المحلي/الاختياري

```text
OPENAI_API_KEY
SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN
SUPABASE_AUTH_EXTERNAL_APPLE_SECRET
S3_HOST
S3_REGION
S3_ACCESS_KEY
S3_SECRET_KEY
```

وموجودة في أمثلة معلّقة داخل config:

```text
SENDGRID_API_KEY
SECRET_VALUE
```

**هذه ليست قائمة خدمات مفعلة بالإنتاج:** مثلًا Twilio وApple معطلان في الإعداد المحلي. ومفاتيح مزودي AI داخل التطبيق تُدار عبر Vault، وليس بالضرورة عبر `OPENAI_API_KEY`.

لم أجد متغيرات Brevo أو Google Sheets credentials مستخدمة في مصدر OS. لا يمكن حصر متغيرات بوت خارجي غير متاح مصدره.

---

## 8. النواقص والمخاطر الحالية وآخر شغل

### نتائج التحقق الحالي

| الفحص | النتيجة |
|---|---|
| مطابقة HEAD مع GitHub `main` | ناجح |
| تطابق commit مع Sites version 104 | ناجح |
| استجابة OS | HTTP 200 |
| صفحة Whales Zone ومطابقتها محليًا | ناجح |
| TypeScript | ناجح |
| ESLint | ناجح |
| Production build | ناجح |
| اختبارات Node | **169 ناجح، 0 فاشل** |
| `git diff --check` | ناجح |

لم أرسل تسجيلًا تجريبيًا أو رسالة تليجرام، ولم أختبر كل رحلة بحساب عضو حقيقي. نجاح الاختبارات والبناء ليس شهادة بأن كل تكامل خارجي يعمل end-to-end.

### مشكلات ونواقص مؤكدة

**1. سجل migrations غير متطابق — أولوية عالية.**  
يجب تسويته قبل الاعتماد على CLI للنشر أو إعادة بناء قاعدة جديدة من الملفات وحدها.

**2. مزامنة شيت فاشلة.**  
يوجد تسجيل محفوظ فشلت مزامنته، ولا توجد job مستقلة واضحة لإعادة المحاولة. يلزم فحص Apps Script ثم تصميم retry آمن يمنع تكرار الصفوف.

**3. تسليم بوت المؤشر وBrevo غير مكتمل.**  
المصدر والاستضافة والعقود الخارجية غير موجودة ضمن ما أمكن التحقق منه. لا تُسلم للمطوّر على أنها منظومة موثقة بالكامل.

**4. تقارير الفريق مثبتة لكن الأتمتة غير مضبوطة حاليًا.**  
الـcron موجودة، لكن جدول `private.team_report_settings` فارغ وقت الفحص. الإعداد الافتراضي غير المحفوظ يعطّل اليومية والأسبوعية؛ يلزم اختيار المستلمين والجدولة وحفظ الإعدادات.

**5. نظام backup المخصص لم يُنفّذ.**  
لم أجد زرًا أو job تحقق مطلب النسخ الأسبوعي/الشهري داخل التطبيق. لم أتحقق من خطة النسخ المُدارة لدى Supabase أو اختبار استعادة فعلي. ويجب نسخ **ملفات Storage نفسها** بجانب SQL؛ نسخة قاعدة البيانات وحدها لا تحتوي صور العملاء.

**6. ملاحظات أمنية حية من Supabase Advisor.**

- تعطيل حماية كلمات المرور المسرّبة.
- extension `pg_net` موجودة في `public`.
- تحذيرات على **21 دالة SECURITY DEFINER قابلة للاستدعاء من authenticated**؛ تحتاج مراجعة ACL والتحقق الداخلي، وليست إثبات اختراق.
- 9 معلومات عن RLS بلا policies؛ عدد منها مقصود لمنع الوصول المباشر، فلا يُعالج بإضافة policy عامة.

هذه مراجعة تسليم، وليست تدقيقًا أمنيًا شاملًا.

**7. تكامل النشر الخارجي محدود.**  
التكامل المؤكد في المشروع للنشر الآلي هو Telegram. وجود Instagram/YouTube/Facebook في التقويم لا يعني وجود API publishing موصول لكل منصة.

**8. التشغيل على Vinext beta.**  
يلزم اختبار دقيق للتنقل وSSR والمكتبات قبل ترقية dependencies. لا تُحوّله إلى Next.js أو تحدّث lockfile باعتبار ذلك تعديلًا شكليًا.

**9. التوثيق يحتاج تحديثًا.**  
بعض ملفات README وdocs لا تزال تحتوي أوصافًا تاريخية مثل عدم وجود أعضاء/بيانات حقيقية أو خطوات إنتاج أقدم. يجب تحديثها من الحالة الحية، وليس استخدامها كمرجع وحيد.

### آخر تعديل برمجي منشور

آخر commit المذكور في القسم 2 أصلح:

1. **تاريخ طلبات Carousel وYouTube:** التعامل مع اليوم بتوقيت القاهرة وقبول اليوم الحالي، بدل رفضه بسبب توقيت ساعة ضمن اليوم.
2. **الانتقال من مهمة متابعة إلى العميل:** زر مستقل لفتح ملف العميل، بما في ذلك المهمة المكتملة، مع الحفاظ على صلاحيات CRM.

الملفات المحورية:

- [lib/content-calendar.ts](/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/lib/content-calendar.ts)
- [CrmTaskActions.tsx](/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/components/tasks/CrmTaskActions.tsx)
- [migration إصلاح تاريخ القاهرة](/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/supabase/migrations/20260921005630_content_request_cairo_day.sql)
- [create-content-workflow](/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os/supabase/functions/create-content-workflow/index.ts)

**قيد مهم:** إصلاح اليوم المذكور لا يعني توحيد كل أنواع المحتوى؛ الريلز ما زال لديه تحقق مرتبط بالتوقيت.

آخر متابعة غير برمجية كانت مناقشة اعتماد الفريق للنظام مقابل Telegram، واقتراح تجربة تشغيل محدودة؛ لم أجد إصدارًا أحدث ينفّذ خطة انتقال جديدة.

### ترتيب الاستلام المقترح للمطوّر

1. استلام صلاحيات GitHub وSites وSupabase بشكل آمن.
2. مطابقة migrations وتوثيق schema الفعلية قبل أي تعديل.
3. استلام Apps Script والبوت وBrevo والتحقق من الحدود بين الخدمات.
4. معالجة فشل مزامنة الشيت واختبار تسجيل واحد مصرح به end-to-end.
5. إعداد backup واختبار الاستعادة، شاملًا Storage.
6. اختبار رحلات المالك والسيلز وأيمن والمنفّذ بحسابات الصلاحيات الفعلية.
7. بعدها تطوير الواجهة والخصائص، مع الحفاظ على RLS ومنع التكرار وسجل التدقيق.

**الخلاصة:** مصدر OS نفسه موجود ومرفوع ومنشور وبناؤه واختباراته ناجحة. أكبر فجوات التسليم الآن هي **تطابق migrations، استكمال مصادر التكاملات الخارجية، مزامنة الشيت، والـbackup**—وليست الحاجة لإعادة بناء المشروع من الصفر.

<oai-mem-citation>
<citation_entries>
MEMORY.md:599-607|note=[Historical release and adoption context checked against current code and deployment]
</citation_entries>
<rollout_ids>
01a00b9a-e5e5-71e0-8425-bbfa57389ac2
</rollout_ids>
</oai-mem-citation>

---

## 9. أدوات وطريقة الشغل

### نطاق هذا القسم وحالة التقرير

هذا القسم مضاف إلى التقرير الأصلي دون إعادة صياغته. الأرقام وحالة الإنتاج والـcommit الواردة في الأقسام السابقة تخص لقطة المراجعة بتاريخ 4 نوفمبر 2026، قبل commit التوثيق هذا. إضافة الملف ورفعه على فرع GitHub ليست نشرًا جديدًا للموقع ولا تغييرًا لقاعدة البيانات.

ملاحظة النسخ الحرفي: احتُفظ بمسافتين في نهاية بعض أسطر التقرير الأصلي لأنها فواصل أسطر Markdown مقصودة. لذلك قد يُظهر `git diff --check` تحذير trailing whitespace لهذه الأسطر فقط؛ فحص الملف مع استثناء هذه العلامة وحدها هو `git -c core.whitespace=-blank-at-eol diff --cached --check`. لا يتغير إعداد Git الدائم ولا تُستثنى تحذيرات whitespace الأخرى.

حصر الأدوات أدناه مبني على سجل العمل المتاح لهذا المشروع، وملفات التعليمات، و`package.json` و`tests/` الفعلية. بعض أسماء plugins والـskills تغيرت مع تحديث Codex؛ ذكر النسخ القديمة يشرح تاريخ العمل ولا يعني ضرورة تثبيتها. وجود أداة في السجل لا يثبت نجاح كل عملية استُدعيت بها.

روابط الملفات المطلقة في التقرير الأصلي محفوظة كما كانت، وتفتح على الماك الأصلي. للتصفح داخل GitHub استخدم أيضًا: [تعليمات المشروع](../AGENTS.md)، [مهارة المشروع](../.agents/skills/market-whales-os/SKILL.md)، [package.json](../package.json)، [الاختبارات](../tests/)، [migrations](../supabase/migrations/)، [Edge Functions](../supabase/functions/)، [توثيق المعمارية](architecture.md).

### أ. الـSkills المستخدمة أو التي روجعت كمرجع أثناء العمل

الـSkill ملف تعليمات للعمل وليست dependency يشغّلها الموقع. القائمة تشمل المراجع التي ظهرت قراءتها أو الرجوع إليها في سجل المشروع؛ لا تعني تفعيل كل قدراتها أو إجراء تغييرات بكل الأدوات المرتبطة بها.

| المهارة | دورها في المشروع |
|---|---|
| `market-whales-os` | القواعد المحلية للمشروع: المعمارية، الصلاحيات، ملكية المكونات المشتركة، فحص الأثر بين الأقسام والتحقق قبل التسليم. المصدر داخل الريبو: `.agents/skills/market-whales-os/SKILL.md`. |
| `supabase:supabase` | مراجعة Auth وRLS وStorage وRPC وEdge Functions، اختيار الأدوات الصحيحة، مراجعة الصلاحيات والتحقق من نتائج تغييرات القاعدة. |
| `supabase:supabase-postgres-best-practices` | مرجع SQL وPostgres والفهارس وتصميم الاستعلامات والسياسات. ليس بديلًا عن فحص المخطط الحي. |
| `sites-building` و`sites-hosting` تاريخيًا؛ `sites:sites` حاليًا | بناء وتجهيز تطبيق Vinext وربط مصدره بمشروع Sites، حفظ الإصدارات والنشر والتحقق من deployment والدومين والبيئة. |
| `github` و`yeet` التاريخيتان | مرجع التعامل مع المستودع والـcommits والرفع وطلبات المراجعة. Git CLI مستخدم أيضًا مباشرة، وليس كل push عبر MCP. |
| `frontend-design` | تنظيم اتجاه التصميم والهرمية البصرية وتخفيف كثافة الواجهات. |
| `ui-ux-pro-max` | مراجعة تجربة الاستخدام والاستجابة وRTL والتفاعل والسحب والنوافذ والوصولية. |
| `sales:index` | توجيه العمل المتعلق بـCRM ولوحات السيلز إلى المرجع المناسب. |
| `sales-leadership-dashboard` | مرجع لوحات الإدارة ومؤشرات العمل والملكية والمتابعة. |
| `seller-account-dashboard` | مرجع عرض العملاء وحساباتهم والإجراءات التي يحتاجها عضو السيلز. |
| `enrich-company-and-contact-data` و`sales-company-research` | مراجع بحث وسياق بيانات الحسابات أثناء دراسة تكاملات العمل؛ لا تعني وجود enrichment آلي أو خدمة خارجية عاملة داخل OS. |
| `notion-research-documentation` | قراءة وتنظيم الأدلة والمراجع من Notion لفهم طريقة العرض والعمل المطلوبة. |
| `google-drive` و`google-sheets` | اكتشاف المراجع وقراءة الملفات وبيانات الشيت الموجودة. استخدامها لا يعني توفر مصدر Google Apps Script أو إضافة مزامنة جديدة. |
| `control-chrome` | تعليمات التحكم في Chrome وفحص الواجهات الموجودة والتفاعلات بصريًا. |
| `control-in-app-browser` | فحص صفحات التطبيق والمعاينات داخل متصفح Codex. |
| `computer-use` | مرجع التفاعل مع التطبيقات/السطوح المرئية حين لا يكفي فحص الملفات. |
| `imagegen` | إنتاج التصورات والصور المبدئية التي سبقت بعض تعديلات الواجهة؛ الصورة ليست تنفيذًا أو اختبارًا للكود. |
| `skill-creator` | مرجع إعداد تعليمات عمل قابلة لإعادة الاستخدام، ومنها قواعد العمل المحلية. |
| `openai-docs` | مراجعة استخدام أدوات وبيئة Codex/OpenAI عند الحاجة، وليس dependency مستقلة للموقع. |
| `dashboard-reference-audit` | مرجع محفوظ في ذاكرة العمل لمقارنة الواجهات المرجعية بالتدفق المملوك، وربط الملاحظة بتغيير قابل للتحقق. ليس ملفًا داخل الريبو ولا يلزم لتشغيل التطبيق. |

مصادر التعليمات الأساسية داخل الريبو:

- `AGENTS.md`.
- `.agents/skills/market-whales-os/SKILL.md`.
- `.agents/skills/market-whales-os/references/product-context.md`.
- `.agents/skills/market-whales-os/references/change-safety.md`.

المراجع الخارجية موجودة في تثبيت Codex على الماك، تحت `/Users/samihagwa/.codex/skills/` و`/Users/samihagwa/.codex/plugins/cache/`؛ مسارات الإصدارات داخل cache ليست ثابتة ولا ينبغي ربط build بها.

### ب. الـPlugins وMCP servers وأدوات التنفيذ

أسماء namespaces هنا كما ظهرت في بيئة العمل؛ ليست أسماء خدمات يجب تشغيلها على سيرفر OS.

| الأداة / الموصل | النوع | الاستخدام الفعلي |
|---|---|---|
| Supabase — `mcp__codex_apps__supabase` | Plugin / MCP | فحص المشروع والجداول والسياسات والدوال والمigrations والـlogs والـadvisors، تنفيذ SQL مصرح به، تطبيق migrations ونشر Edge Functions في مراحل التنفيذ السابقة، وتوليد أنواع TypeScript. أدوات مثل `list_tables`, `execute_sql`, `list_migrations`, `get_advisors`, `deploy_edge_function`. |
| Sites — `mcp__codex_apps__sites` | Plugin / MCP | إدارة مشروع الاستضافة ومصدره وبيئته والدومين، حفظ الإصدارات ونشرها والتحقق من حالتها وWorker logs. أدوات مثل `get_site`, `save_site_version`, `deploy_site_version`, `get_deployment_status`. |
| GitHub — `mcp__codex_apps__github` | Plugin / MCP | قراءة المستودع والملفات والـPRs وإنشاء/تحديث طلبات مراجعة في مراحل سابقة. إلى جانبه Git CLI للفحص والـcommit والـpush. |
| Notion — `mcp__codex_apps__notion` | Plugin / MCP | `search`, `fetch`, `query_data_sources` لقراءة المراجع وسير العمل. ليس قاعدة بيانات تشغيلية لـOS. |
| Google Drive — `mcp__codex_apps__google_drive` | Plugin / MCP | اكتشاف الملفات وقراءة metadata ونطاقات Sheets والتصدير/جلب المراجع. لا يُستخدم هذا الموصل بدل Apps Script في مسار التسجيل الإنتاجي. |
| Node REPL — `mcp__node_repl` | أداة جلسة / MCP | تنفيذ JavaScript لفحص البيانات والتعامل مع أدوات المتصفح والمعاينات أثناء العمل. ليس Node server للإنتاج. |
| CUA REPL — `mcp__cua_repl` | أداة تحكم بسطح المستخدم | فحص Chrome والمتصفح الداخلي والتطبيقات بالنقر والكتابة وقراءة حالتها ولقطات الشاشة. وثائق API تُقرأ عند بدء الجلسة؛ لا نفترض API ثابتة من الذاكرة. |
| Codex App — `codex_app` / `mcp__codex_app` | أدوات بيئة التطوير | معرفة مسارات runtimes والمكتبات المجمعة، قراءة terminal، وفتح المشروع داخل التطبيق. |
| `image_gen.imagegen` | أداة توليد صور | إنشاء mockups وتصوّرات قبل البرمجة. ليست خدمة مطلوبة لتشغيل OS. |
| `web.run` | أداة بحث/تصفح | الرجوع للمصادر والتوثيق عند الحاجة. ليست crawler أو رادارًا مفعّلًا بالموقع. |
| `functions.exec`, `exec_command`, `write_stdin` | أدوات تنفيذ محلية | تشغيل أوامر Git وpnpm وNode وcurl، تجميع نتائج الأدوات، ومتابعة العمليات. |
| `apply_patch` | أداة تحرير ملفات | التعديلات المحلية المحددة على الكود والتوثيق؛ تُراجع بعدها عبر Git diff. |
| `view_image` | أداة عرض محلية | فحص لقطات الشاشة والصور، وليس تعديلها. |
| أدوات التخطيط والأهداف و`collaboration` | تنسيق داخل المساعد | استُخدمت تاريخيًا لتقسيم بعض المراجعات وتتبع التقدم؛ ليست MCP dependency للموقع ولا خدمة خلفية. لا يلزم تفويض agents لتعديل توثيق كهذا. |

لا توجد حاجة لتثبيت كل هذه plugins لتشغيل التطبيق. الحد الأدنى لتطويره هو source + Node/pnpm + إعدادات البيئة + وصول Supabase المناسب. نشره بالطريقة الحالية يحتاج وصول مشروع Sites، بالإضافة إلى GitHub للرفع.

لا تُنسخ ملفات جلسات Codex أو credentials الخاصة بالموصلات إلى المستودع. الحصول على أسماء متغيرات أو فحص metadata لا يستلزم طباعة قيم الأسرار.

### ج. المكتبات المثبتة في package.json

الإصدارات التالية مثبتة نصيًا في `package.json` وقت إعداد هذا الملف، و`pnpm-lock.yaml` هو مرجع الحل الكامل للاعتماديات المتعدية.

#### Runtime dependencies

| الحزمة | الإصدار |
|---|---|
| `@fontsource/ibm-plex-sans-arabic` | `5.2.8` |
| `@supabase/supabase-js` | `2.112.3` |
| `lucide-react` | `1.31.0` |
| `react` | `19.2.6` |
| `react-dom` | `19.2.6` |

#### Development / build / test dependencies

| الحزمة | الإصدار |
|---|---|
| `@cloudflare/vite-plugin` | `1.37.1` |
| `@electric-sql/pglite` | `0.5.8` |
| `@eslint/js` | `9.39.4` |
| `@next/eslint-plugin-next` | `16.2.6` |
| `@tailwindcss/postcss` | `4.2.1` |
| `@types/node` | `22.19.19` |
| `@types/react` | `19.2.14` |
| `@types/react-dom` | `19.2.3` |
| `@vitejs/plugin-react` | `6.0.2` |
| `@vitejs/plugin-rsc` | `0.5.26` |
| `eslint` | `9.39.4` |
| `eslint-plugin-jsx-a11y` | `6.10.2` |
| `eslint-plugin-react` | `7.37.5` |
| `eslint-plugin-react-hooks` | `7.1.1` |
| `globals` | `16.4.0` |
| `react-server-dom-webpack` | `19.2.6` |
| `supabase` | `2.114.0` |
| `tailwindcss` | `4.2.1` |
| `typescript` | `5.9.3` |
| `typescript-eslint` | `8.59.3` |
| `vinext` | `1.0.0-beta.2` |
| `vite` | `8.0.13` |
| `wrangler` | `4.92.0` |

الاختبارات تستخدم `node:test` المدمج في Node؛ ليست Jest أو Vitest. لا توجد Playwright أو Cypress dependency ولا script باسم `test:e2e` في هذا الإصدار.

### د. قواعد العمل قبل أي تعديل

1. قراءة تعليمات الريبو أولًا، وفحص `git status --short` والفرع الحالي؛ تغييرات غيرنا لا تُمسح.
2. تحديد العقد الذي يتغير: هل هو UI مشترك، status مخزن، صلاحية، RPC، route، notification URL، أو workflow؟
3. البحث بـ`rg` عن كل استخدام للقيمة أو المكوّن عبر `app/`, `components/`, `lib/`, `supabase/`, `tests/` و`docs/`.
4. تعديل المصدر المشترك، لا إنشاء إصلاح منفصل متكرر لكل صفحة:
   - tokens والألوان في `app/globals.css`.
   - عناصر UI في `components/ui/`.
   - التنقل والـshell في `components/layout/`.
   - Supabase client/session في `lib/supabase/`.
   - انتقالات العمل والصلاحيات في قاعدة البيانات أو الخادم الموثوق.
5. إضافة regression test للعطل أو العقد الجديد، ومراجعة المستهلكين والروابط والإشعارات والتقارير ذات الصلة.
6. الحفاظ على RLS وtenant boundaries وملكية السجل؛ إخفاء زر لا يُعد تصريحًا أمنيًا.
7. اختبار السماح والرفض وCAS/version conflicts ومنع التكرار، وليس happy path فقط.
8. دعم RTL والموبايل من 320px، keyboard focus وEscape وreduced motion ورسائل الخطأ والتحميل.
9. عدم تنفيذ migrations تدميرية أو رسائل أو نشر على قنوات حقيقية باعتبارها اختبارًا عاديًا.
10. تعليمات `AGENTS.md` و`product-context.md` تحتوي افتراضات تأسيسية تاريخية عن الفريق والبيانات؛ لا تُستخدم لتصنيف بيانات الإنتاج الحالية كـ«تجارب» أو حذفها دون تأكيد حديث من المالك.

### هـ. أوامر التحقق بالضبط

من جذر الريبو، مع Node يحقق `>=22.13.0` وpnpm متاح في PATH:

```bash
cd "/Users/samihagwa/Documents/Codex/2026-08-16/new-chat/work/market-whales-os"

git status --short
git branch --show-current

pnpm typecheck
pnpm lint
pnpm build
pnpm test

git diff --check
git diff --stat
git status --short
```

هذه هي بوابات التحقق المطلوبة في `AGENTS.md`. `pnpm test` يعيد البناء بنفسه، لذلك يوجد بناء مكرر في التسلسل الحرفي أعلاه. لتشخيص أسرع مع بقاء نفس المدخلات دون تغيير يمكن تشغيل:

```bash
pnpm typecheck
pnpm lint
pnpm build
node --test tests/*.test.mjs
git diff --check
```

التوسعات الفعلية من `package.json`:

```text
typecheck = tsc --noEmit
lint      = eslint . --ignore-pattern dist --ignore-pattern .next
build     = WRANGLER_LOG_PATH=.wrangler/wrangler.log vinext build
test      = pnpm run build && node --test tests/*.test.mjs
dev       = WRANGLER_LOG_PATH=.wrangler/wrangler.log vinext dev
start     = WRANGLER_LOG_PATH=.wrangler/wrangler.log vinext start
```

مثال لفحص محدد بعد بناء حديث:

```bash
node --test tests/content-request-date.test.mjs
node --test tests/crm-images.test.mjs
node --test tests/team-reports.test.mjs tests/team-report-delivery.test.mjs
```

إن لم يوجد Node/pnpm في shell الخاص بـCodex، تُكتشف runtimes عبر أداة workspace dependencies ويُضبط PATH للجلسة. مسارات cache المحلية ليست متطلبًا يجب على المطوّر الآخر نسخه.

### و. ملفات الاختبارات وما تغطيه

المجلد: `tests/`.

| الملفات | التغطية الأساسية |
|---|---|
| `routes.test.mjs` | يستورد Worker المبني من `dist/server/index.js`، ويتحقق من SSR والـprivate gate والصفحات العامة وعدم كشف sidebar قبل المصادقة. لا يختبر جلسة مستخدم حقيقية. |
| `contracts.test.mjs` | عقود مشتركة للواجهات والتنقل والـworkflows والصلاحيات ومنع الأسرار في browser config. بعض الاختبارات تفحص المصدر والعقود؛ لا تساوي تنفيذًا حيًا لكل إجراء. |
| `task-workspace-ui.test.mjs` | عرض المهام والإجراءات المرتبطة بها. |
| `content-intake.test.mjs` و`content-presentation.test.mjs` | تحليل طلب المحتوى وعرضه والروابط والتعليمات والتفاصيل. |
| `content-request-date.test.mjs` | اليوم بتوقيت القاهرة، DST، رفض الأيام الماضية وربط تصحيح التاريخ بالـbackend. |
| `content-calendar.test.mjs` | grouping حسب المصدر واليوم، الجدولة، السحب، الاكتمال اليدوي، وعدم استنتاج النشر من العلامة. |
| `carousel-images.test.mjs` | ترتيب صور الكاروسيل والتحقق من الروابط وعقد التسليم. |
| `script-notebook.test.mjs`, `script-drag.test.mjs`, `script-writing-chat.test.mjs` | notebook والبورد والسحب ومساعد الكتابة. |
| `viewer-script-readonly.test.mjs` | منع الكتابة للحسابات ذات صلاحية القراءة فقط. |
| `sales-crm-operational-repair.test.mjs` | عقود إصلاح تشغيل CRM والسيلز. |
| `task-attention.test.mjs` | الاستعجال والإقرار بالمهمة وطلب المساعدة. |
| `crm-images.test.mjs` | PGlite معزول للصلاحيات والصور والحصص والتكرار والأرشفة. |
| `team-reports.test.mjs` | PGlite معزول لتجميع التقارير والخصوصية والمستلمين والتوقيت ومنع التكرار. |
| `team-report-delivery.test.mjs` | اختبار دالة worker الفعلية مع RPC/HTTP mocks؛ لا يرسل رسائل حقيقية. |

ملفات SQL للتحقق المعاملي:

```text
tests/content-calendar.rollback.sql
tests/content-request-day.rollback.sql
tests/carousel-workflow.rollback.sql
tests/script-board.rollback.sql
tests/task-attention.rollback.sql
```

هذه **ليست جزءًا يُنفّذ تلقائيًا بمجرد وجوده تحت tests** في أمر Node. تُراجع وتُشغّل منفصلة على قاعدة اختبار مناسبة وبسياق الصلاحيات الصحيح، وتستخدم rollback. لا تُنفّذ على الإنتاج آليًا؛ rollback لا يضمن التراجع عن أي أثر خارجي إذا استدعى الاختبار خدمة خارجية.

### ز. E2E وفحص المتصفح: الموجود وحدوده

لا يوجد حاليًا أمر `pnpm test:e2e` أو `playwright test` مع suite محفوظة ومجهزة في الريبو. لا ينبغي اختراع هذا الأمر أو اعتبار 169 اختبارًا تغطية E2E كاملة.

الفحص التفاعلي استُخدم عبر Chrome/المتصفح الداخلي وأدوات التحكم، مع fixtures منفصلة تعزل الـbackend عن الإنتاج. أمثلة تشغيل فعلية مدعومة بملفات config الحالية:

```bash
pnpm exec vite --config tests/content-preview.config.mjs
# http://127.0.0.1:4175/tests/content-preview.html

pnpm exec vite --config tests/script-board-preview.config.mjs
# http://127.0.0.1:4176/tests/script-board-preview.html

pnpm exec vite --config tests/attention-preview.config.mjs
# http://127.0.0.1:4186/tests/attention-preview.html

pnpm exec vite --config tests/calendar-preview.config.mjs
# http://127.0.0.1:4187/tests/calendar-preview.html

pnpm exec vite --config tests/team-report-preview.config.mjs
# http://127.0.0.1:4189/tests/team-report-preview.html

pnpm exec vite --config tests/crm-images-preview.config.mjs
# http://127.0.0.1:4190/tests/crm-images-preview.html
```

تُشغّل المعاينة المطلوبة فقط وفي terminal منفصلة عند الحاجة. ملفات `*-preview-backend.ts` توفر بيانات/خدمات اختبار، وليست دليلًا على نجاح Supabase في الإنتاج.

قائمة الفحص التفاعلي حسب التغيير:

- الموبايل 320px و390px، واللاب، وعدم وجود overflow غير مقصود.
- RTL، ترتيب الحقول والأزرار، لوحة المفاتيح، focus، إغلاق النافذة بـEscape.
- النوافذ في المنتصف، scroll داخلها، وعودة التركيز بعد الإغلاق.
- فصل ضغط checkbox/action عن فتح الكارت؛ لا event propagation غير مقصود.
- السحب بين الأعمدة وتغيير الحالة، مع بديل مناسب للموبايل وفحص refresh.
- عدم ضياع النصوص مع autosave أو نتيجة AI متأخرة.
- تعطيل الإرسال أثناء الطلب ومنع double-submit والتكرار بعد retry.
- نجاح الحفظ، ظهور الأخطاء، ورفض نسخة قديمة عند التعديل المتزامن.
- رؤية الأدوار المسموحة ورفض غير المخولين، لا مجرد إخفاء عناصر.
- فتح الروابط إلى الملف الصحيح من الإشعارات والمهام.
- في تغييرات الصور: المعاينة والضغط والحجب والصلاحيات والحصة والفشل وإعادة المحاولة.

المصفوفة الأساسية المذكورة في التعليمات تشمل `/`, `/tasks`, `/content`, `/campaigns`, `/crm`, `/analytics`, `/team`, `/settings`. ويُضاف `/scripts`, `/planning`, `/publishing` والصفحات التفصيلية متى تأثرت بالعقد المشترك.

### ح. إزاي يتم الفحص على الموقع المنشور بعد النشر

1. مطابقة `commit_sha` ونسخة Sites التي حُفظت مع الـarchive الذي بُني واختُبر؛ لا يُعتبر push إلى GitHub نشرًا.
2. متابعة `get_deployment_status` حتى `succeeded` أو فشل صريح. عند الفشل تُراجع رسالة deployment وWorker logs، ولا يُعلن نجاح.
3. التحقق من الدومين والتوجيه والصفحات الرئيسية باستعلامات قراءة فقط. مثال بدون طباعة cookies أو headers حساسة:

```bash
curl --fail --silent --show-error --location \
  --output /dev/null --write-out '%{http_code}\n' \
  https://os.samihagwa.com/

curl --fail --silent --show-error --location \
  --output /dev/null --write-out '%{http_code}\n' \
  https://os.samihagwa.com/login
```

4. فتح الموقع بالمتصفح وفحص الواجهة الفعلية؛ HTTP 200 قد يكون صفحة دخول أو private gate ولا يثبت نجاح رحلة مستخدم.
5. استخدام جلسات مصرح بها للأدوار المتأثرة: المالك، السيلز، منفّذ المحتوى، reviewer/viewer. لا تُغيّر صلاحيات أحد لتسهيل الاختبار.
6. تنفيذ رحلة التغيير فقط، ببيانات اختبار معزولة ومصرح بها عند احتياج الكتابة. إعادة فتح السجل أو refresh للتحقق من persistence.
7. التحقق من النتيجة في قاعدة البيانات/الـaudit والـlogs عند الحاجة، ومن عدم إنشاء مهمة أو إشعار أو صف مكرر.
8. للإشعارات: التحقق من notification وoutbox والحالة والمستلم والرابط. `queued` ليست `sent`، وتسليم worker ليس دائمًا تأكيد مشاهدة المستلم.
9. لتغييرات Supabase: التحقق من migration الفعلية ونسخة Edge Function والسياسات وgrants وتشغيل مسارات الرفض، ومراجعة advisors. لا يكفي نشر الواجهة.
10. لا تُرسل رسالة على قناة حقيقية، ولا تسجيل مؤشر أو عميل حقيقي، ولا رسالة Brevo كتجربة دون إذن محدد. عدم توفر جلسة أو موافقة يُذكر كحد تغطية بدل الادعاء أن الاختبار تم.
11. توثيق ما تم: البيئة، route، الدور، viewport، الإجراء، النتيجة المتوقعة والفعلية، commit/version، وما لم يمكن التحقق منه.
12. عند rollback يُستخدم إصدار واجهة سابق مناسب للعقد الحالي؛ لا تُحذف بيانات أو جداول أو صور لمجرد التراجع عن UI.

### ط. قواعد إضافية مهمة للاستلام

- الاختبار المعزول وSQL rollback وفحص المتصفح والإنتاج مستويات مختلفة، ويجب تسمية كل مستوى بوضوح.
- لا يوجد في المشروع ما يضمن تلقائيًا فحص كل الأدوار وكل التكاملات بمجرد نجاح build.
- تقارير حضور الفريق تقيس دلائل مسجلة، وليست قياسًا كاملًا للإنتاجية أو دليلًا على العمل خارج المنصة.
- تعليمات النشر وcache paths الخاصة بـCodex أدوات تطوير وليست أسرارًا أو متطلبات runtime.
- أي تعديل توثيق فقط يُراجع ليظل الـcommit مقتصرًا على ملف التوثيق؛ لا يستدعي نشر Sites أو Edge Functions أو تعديل قاعدة البيانات.
